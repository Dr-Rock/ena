/* Ena core — data layer for the bilingual study capture app.
 * Pure functions only: no DOM, no storage. Runs in the browser (window.EnaCore)
 * and in Node (module.exports) so the same code is tested and shipped.
 *
 * Design rules (from study protocol v1.1 / workbook v1.3):
 *  - Append-only: every change is a new event; nothing is overwritten.
 *  - Merge = union of events by id, so importing the same file twice is harmless.
 *  - Monthly-session data (vocabulary, gestures, grammar, longest utterance,
 *    month close/reopen, new words) counts only from the MAIN device. A second
 *    phone can never overwrite the official month.
 *  - Daily log, exposure, milestones and recordings count from every device.
 *  - Ages use the same rule as the workbook: completed months via DATEDIF "m",
 *    days = date - EDATE(DOB, months). No "md".
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EnaCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FORMAT = 'ena-backup';
  var FORMAT_VERSION = 1;
  var SCHEMA = 'v1.3';
  var CODES = ['XX', 'XV', 'XS', 'VX', 'VV', 'VS', 'SX', 'SV', 'SS'];
  var FIRST_MONTH = 15, LAST_MONTH = 36;

  var MAIN_ONLY = {
    'vocab.set': 1, 'gesture.set': 1, 'grammar.first': 1, 'grammar.tick': 1,
    'longest.set': 1, 'month.close': 1, 'month.reopen': 1, 'item.add': 1
  };
  var KNOWN = {
    'vocab.set': 1, 'gesture.set': 1, 'grammar.first': 1, 'grammar.tick': 1,
    'longest.set': 1, 'month.close': 1, 'month.reopen': 1, 'item.add': 1,
    'log.add': 1, 'log.void': 1, 'exp.add': 1, 'exp.void': 1, 'ms.set': 1,
    'rec.add': 1, 'rec.update': 1, 'rec.void': 1
  };

  /* ---------------------------------------------------------------- dates */
  function pad(n, w) { n = String(n); while (n.length < (w || 2)) n = '0' + n; return n; }

  // 'YYYY-MM-DD' -> {y,m,d} or null. Strict: rejects 2026-02-30.
  function parseDate(s) {
    if (typeof s !== 'string') return null;
    var mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
    if (!mt) return null;
    var y = +mt[1], m = +mt[2], d = +mt[3];
    if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
    return { y: y, m: m, d: d };
  }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function toUTC(p) { return Date.UTC(p.y, p.m - 1, p.d); }
  function fmtDate(p) { return p.y + '-' + pad(p.m) + '-' + pad(p.d); }

  // Excel DATEDIF(start, end, "m"): complete months. null if end < start.
  function datedifM(a, b) {
    if (toUTC(b) < toUTC(a)) return null;
    var m = (b.y - a.y) * 12 + (b.m - a.m);
    if (b.d < a.d) m -= 1;
    return m;
  }
  // Excel EDATE: add months, clamp day to the end of the target month.
  function edate(p, months) {
    var total = p.y * 12 + (p.m - 1) + months;
    var y = Math.floor(total / 12), m = total - y * 12 + 1;
    return { y: y, m: m, d: Math.min(p.d, daysInMonth(y, m)) };
  }
  // Age {m, d} exactly as workbook v1.3 computes it; null when invalid or before DOB.
  function ageParts(dob, date) {
    var a = parseDate(dob), b = parseDate(date);
    if (!a || !b) return null;
    var m = datedifM(a, b);
    if (m === null) return null;
    var days = Math.round((toUTC(b) - toUTC(edate(a, m))) / 86400000);
    return { m: m, d: days };
  }
  function ageText(dob, date) {
    var p = ageParts(dob, date);
    return p ? p.m + ';' + p.d : '';
  }
  // Month block label as in '07 Recordings' column D: "m;0".
  function monthLabel(dob, date) {
    var p = ageParts(dob, date);
    return p ? p.m + ';0' : '';
  }
  function monthLabels() {
    var out = [];
    for (var m = FIRST_MONTH; m <= LAST_MONTH; m++) out.push(m + ';0');
    return out;
  }
  function labelToMonth(label) {
    var mt = /^(\d+);0$/.exec(label || '');
    return mt ? +mt[1] : null;
  }
  // Session ID as in '07 Recordings' column A: YYYY-MM-DD-HHMM.
  function sessionId(date, start) {
    if (!parseDate(date)) return '';
    var mt = /^(\d{1,2}):(\d{2})$/.exec(start || '');
    if (!mt || +mt[1] > 23 || +mt[2] > 59) return '';
    return date + '-' + pad(mt[1]) + mt[2];
  }
  function mondayOf(dateStr) {
    var p = parseDate(dateStr);
    if (!p) return '';
    var t = new Date(toUTC(p));
    var dow = (t.getUTCDay() + 6) % 7; // Monday = 0
    t.setUTCDate(t.getUTCDate() - dow);
    return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
  }

  /* ----------------------------------------------------------------- codes */
  function isCode(c) { return CODES.indexOf(c) >= 0; }
  function combine(ka, de) { return (ka || '') + (de || ''); }

  /* ---------------------------------------------------------------- events */
  function uuid() {
    var c = (typeof crypto !== 'undefined') ? crypto : null;
    if (c && c.randomUUID) return c.randomUUID();
    var b = new Uint8Array(16);
    if (c && c.getRandomValues) c.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return pad(x.toString(16)); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  // device = {id, label, main}
  function makeEvent(device, type, data, nowIso) {
    if (!KNOWN[type]) throw new Error('Unknown event type: ' + type);
    return {
      id: uuid(),
      t: nowIso || new Date().toISOString(),
      dev: device.id,
      main: !!device.main,
      type: type,
      data: data || {}
    };
  }

  function validEvent(e) {
    return e && typeof e.id === 'string' && e.id &&
      typeof e.t === 'string' && typeof e.type === 'string' &&
      typeof e.dev === 'string' && e.data && typeof e.data === 'object';
  }

  function sortEvents(list) {
    return list.slice().sort(function (a, b) {
      if (a.t < b.t) return -1;
      if (a.t > b.t) return 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }

  // Union by id. Returns {events, added, rejected}.
  function mergeEvents(local, incoming) {
    var seen = Object.create(null), out = [];
    var i, added = 0, rejected = 0;
    for (i = 0; i < local.length; i++) { seen[local[i].id] = 1; out.push(local[i]); }
    for (i = 0; i < (incoming || []).length; i++) {
      var e = incoming[i];
      if (!validEvent(e)) { rejected++; continue; }
      if (seen[e.id]) continue;
      seen[e.id] = 1; out.push(e); added++;
    }
    return { events: out, added: added, rejected: rejected };
  }

  /* ------------------------------------------------------------------ fold */
  function emptyDefs() { return { items: [], gestures: [], grammar: [], milestones: [] }; }

  function fold(events, defs) {
    defs = defs || emptyDefs();
    var st = {
      items: (defs.items || []).map(function (x) { return Object.assign({}, x); }),
      gestures: defs.gestures || [],
      grammar: defs.grammar || [],
      milestoneDefs: defs.milestones || [],
      vocab: {}, monthStatus: {}, gestureTicks: {}, grammarFirst: {},
      grammarTick: {}, longest: {},
      log: [], exposure: [], milestones: {}, recordings: [],
      ignored: 0
    };
    var itemIds = {};
    st.items.forEach(function (it) { itemIds[it.id] = 1; });
    var byId = {}, voids = [], recUpdates = [];

    sortEvents(events).forEach(function (e) {
      if (!KNOWN[e.type]) { st.ignored++; return; }
      if (MAIN_ONLY[e.type] && !e.main) { st.ignored++; return; }
      var d = e.data;
      switch (e.type) {
        case 'vocab.set':
          if (!st.vocab[d.month]) st.vocab[d.month] = {};
          if (d.code === '' || d.code === null) delete st.vocab[d.month][d.item];
          else if (isCode(d.code)) st.vocab[d.month][d.item] = d.code;
          break;
        case 'item.add':
          if (!itemIds[d.id]) {
            itemIds[d.id] = 1;
            st.items.push({ id: d.id, cat: d.cat || '', de: d.de || '', kaRef: d.ka || '',
              kaChild: d.ka || '', en: d.en || '', added: true });
          }
          break;
        case 'month.close': st.monthStatus[d.month] = { state: 'closed', t: e.t, dev: e.dev }; break;
        case 'month.reopen': st.monthStatus[d.month] = { state: 'open', t: e.t, dev: e.dev, reason: d.reason || '' }; break;
        case 'gesture.set':
          if (!st.gestureTicks[d.month]) st.gestureTicks[d.month] = {};
          if (d.on) st.gestureTicks[d.month][d.id] = true; else delete st.gestureTicks[d.month][d.id];
          break;
        case 'grammar.tick':
          if (!st.grammarTick[d.month]) st.grammarTick[d.month] = {};
          if (d.on) st.grammarTick[d.month][d.id] = true; else delete st.grammarTick[d.month][d.id];
          break;
        case 'grammar.first':
          if (d.date) st.grammarFirst[d.id] = { date: d.date, evidence: d.evidence || '', reason: d.reason || '', t: e.t };
          else delete st.grammarFirst[d.id];
          break;
        case 'longest.set':
          if (!st.longest[d.month]) st.longest[d.month] = {};
          st.longest[d.month][d.lang] = d.text || '';
          break;
        case 'log.add': case 'exp.add': case 'rec.add':
          byId[e.id] = { ev: e, kind: e.type.split('.')[0] };
          break;
        case 'log.void': case 'exp.void': case 'rec.void':
          voids.push(e); break;
        case 'rec.update': recUpdates.push(e); break;
        case 'ms.set':
          if (d.date || d.form) st.milestones[d.id] = Object.assign({ t: e.t, dev: e.dev }, d);
          else delete st.milestones[d.id];
          break;
      }
    });

    // A void applies when it comes from the same device as the entry, or from the main device.
    voids.forEach(function (v) {
      var target = byId[v.data.target];
      if (target && (v.main || v.dev === target.ev.dev)) { target.voided = true; target.voidReason = v.data.reason || ''; }
    });
    recUpdates.forEach(function (u) {
      var target = byId[u.data.target];
      if (target && target.kind === 'rec' && (u.main || u.dev === target.ev.dev)) {
        target.updates = Object.assign(target.updates || {}, u.data.fields || {});
      }
    });
    Object.keys(byId).forEach(function (id) {
      var x = byId[id];
      if (x.voided) return;
      var row = Object.assign({ id: id, t: x.ev.t, dev: x.ev.dev }, x.ev.data, x.updates || {});
      if (x.kind === 'log') st.log.push(row);
      else if (x.kind === 'exp') st.exposure.push(row);
      else st.recordings.push(row);
    });
    var byDateThenT = function (k) {
      return function (a, b) {
        var ka = (a[k] || '') + (a.start || '') + a.t, kb = (b[k] || '') + (b.start || '') + b.t;
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      };
    };
    st.log.sort(byDateThenT('date'));
    st.exposure.sort(byDateThenT('week'));
    st.recordings.sort(byDateThenT('date'));
    st.items.sort(function (a, b) { return a.id - b.id; });
    return st;
  }

  /* ------------------------------------------------------- month helpers */
  function monthIndex(label) { return labelToMonth(label); }

  // Latest month strictly before `label` that has any vocabulary code.
  function previousCodedMonth(st, label) {
    var cur = monthIndex(label), best = null;
    Object.keys(st.vocab).forEach(function (l) {
      var m = monthIndex(l);
      if (m !== null && m < cur && Object.keys(st.vocab[l]).length && (best === null || m > monthIndex(best))) best = l;
    });
    return best;
  }

  // S is permanent (protocol 2.1): a language is locked to S if any earlier month had S.
  function sLocks(st, label, itemId) {
    var cur = monthIndex(label), ka = false, de = false;
    Object.keys(st.vocab).forEach(function (l) {
      var m = monthIndex(l);
      if (m === null || m >= cur) return;
      var c = st.vocab[l][itemId];
      if (!c) return;
      if (c[0] === 'S') ka = true;
      if (c[1] === 'S') de = true;
    });
    return { ka: ka, de: de };
  }

  // Gestures are cumulative (sheet 03): ticked in any earlier month stays ticked.
  function carriedGestures(st, label) {
    var cur = monthIndex(label), out = {};
    Object.keys(st.gestureTicks).forEach(function (l) {
      var m = monthIndex(l);
      if (m === null || m >= cur) return;
      Object.keys(st.gestureTicks[l]).forEach(function (id) { out[id] = true; });
    });
    return out;
  }

  // An item already S in both languages has nothing left to code: it counts as done
  // and is written as SS when the month closes (like carried gestures).
  function fullyLocked(st, label, itemId) { var l = sLocks(st, label, itemId); return l.ka && l.de; }
  function isDone(st, label, itemId) { return isCode((st.vocab[label] || {})[itemId]) || fullyLocked(st, label, itemId); }
  function carriedSS(st, label) {
    var codes = st.vocab[label] || {};
    return st.items.filter(function (it) { return !codes[it.id] && fullyLocked(st, label, it.id); }).map(function (it) { return it.id; });
  }
  function monthProgress(st, label) {
    var done = 0;
    st.items.forEach(function (it) { if (isDone(st, label, it.id)) done++; });
    return { done: done, total: st.items.length };
  }

  // Items whose code differs from the previous coded month, in BOTH directions.
  function changesSincePrevious(st, label) {
    var prev = previousCodedMonth(st, label);
    if (!prev) return { prev: null, rows: [] };
    var a = st.vocab[prev] || {}, b = st.vocab[label] || {}, rows = [];
    st.items.forEach(function (it) {
      var was = a[it.id] || '', now = b[it.id] || '';
      if (now && was !== now) rows.push({ item: it, was: was, now: now });
    });
    return { prev: prev, rows: rows };
  }

  function nextItemId(st) {
    var max = 0;
    st.items.forEach(function (it) { if (it.id > max) max = it.id; });
    return max + 1;
  }

  /* ------------------------------------------------------------------- CSV */
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    v = String(v);
    return /[",\n\r;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function toCSV(rows) {
    return '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }
  function csvDailyLog(st, dob) {
    var rows = [['Date', 'Age (auto)', 'What he said (as heard)', 'Target word', 'Language', 'Spontaneous / imitated', 'Who / where', 'Note']];
    st.log.forEach(function (r) { rows.push([r.date, ageText(dob, r.date), r.heard, r.target, r.lang, r.mode, r.where, r.note]); });
    return toCSV(rows);
  }
  function csvExposure(st, dob) {
    var rows = [['Week starting', 'Age (auto)', 'KA hrs (awake, home)', 'Kita hrs attended', 'German outside Kita', 'Other language', 'Days ill / absent', 'Disruption flag', 'Notes']];
    st.exposure.forEach(function (r) { rows.push([r.week, ageText(dob, r.week), r.ka, r.kita, r.deOut, r.other, r.ill, r.flag, r.notes]); });
    return toCSV(rows);
  }
  function csvMilestones(st, dob) {
    var rows = [['Milestone', 'Date', 'Age (auto)', 'Language', 'Exact form', 'Context', 'Evidence', 'Recording session ID']];
    st.milestoneDefs.forEach(function (m) {
      var r = st.milestones[m.id] || {};
      rows.push([m.text, r.date || '', r.date ? ageText(dob, r.date) : '', r.lang || '', r.form || '', r.context || '', r.evidence || '', r.session || '']);
    });
    return toCSV(rows);
  }
  function csvRecordings(st, dob) {
    var rows = [['Session ID (auto)', 'Date', 'Start time', 'Month block (auto)', 'Age (auto)', 'Duration (min)', 'Activity', 'Language spoken to him', 'Who present', 'File name', 'Noise / problems', 'Transcribed?', 'MLU sample lines used']];
    st.recordings.forEach(function (r) {
      rows.push([sessionId(r.date, r.start), r.date, r.start, monthLabel(dob, r.date), ageText(dob, r.date), r.dur, r.activity, r.lang, r.who, r.file, r.noise, r.transcribed, r.mlu]);
    });
    return toCSV(rows);
  }
  function csvMonth(st, label) {
    var rows = [['Sheet', 'ID', 'Item', label]];
    var v = st.vocab[label] || {}, g = st.gestureTicks[label] || {}, gt = st.grammarTick[label] || {};
    st.items.forEach(function (it) { rows.push(['02 Vocabulary', it.id, it.de, v[it.id] || '']); });
    st.gestures.forEach(function (x) { rows.push(['03 Gestures', x.id, x.item, g[x.id] ? 'x' : '']); });
    st.grammar.forEach(function (x) {
      var f = st.grammarFirst[x.id] || {};
      rows.push(['04 Grammar', x.id, x.text, gt[x.id] ? 'x' : '', f.date || '', f.evidence || '']);
    });
    var lo = st.longest[label] || {};
    rows.push(['Longest utterance', 'KA', '', lo.ka || '']);
    rows.push(['Longest utterance', 'DE', '', lo.de || '']);
    rows.push(['Longest utterance', 'mixed', '', lo.mixed || '']);
    return toCSV(rows);
  }

  /* ---------------------------------------------------------------- backup */
  function buildBackup(opts) {
    var st = fold(opts.events, opts.defs);
    return {
      format: FORMAT, formatVersion: FORMAT_VERSION, schema: SCHEMA, appVersion: opts.appVersion || '',
      exported: opts.nowIso || new Date().toISOString(),
      device: { id: opts.device.id, label: opts.device.label || '', main: !!opts.device.main },
      settings: { dob: opts.settings.dob || '', fileSuffix: opts.settings.fileSuffix || '' },
      background: opts.background || {},
      seedId: opts.seedId || '',
      defs: opts.defs,
      events: sortEvents(opts.events),
      state: {
        vocab: st.vocab, monthStatus: st.monthStatus, gestureTicks: st.gestureTicks,
        grammarFirst: st.grammarFirst, grammarTick: st.grammarTick, longest: st.longest,
        items: st.items, log: st.log, exposure: st.exposure, milestones: st.milestones,
        recordings: st.recordings
      }
    };
  }

  // Validate an incoming backup/seed against local data. Returns {ok, error, warnings}.
  function checkImport(file, local) {
    if (!file || file.format !== FORMAT) return { ok: false, error: 'This is not an Ena backup or workbook import file.' };
    if (file.formatVersion > FORMAT_VERSION) return { ok: false, error: 'This file was made by a newer version of the app. Update the app first.' };
    var fdob = file.settings && file.settings.dob;
    if (fdob && local.dob && fdob !== local.dob)
      return { ok: false, error: 'Date of birth in the file (' + fdob + ') differs from this device (' + local.dob + '). Wrong file or wrong child — nothing was imported.' };
    var warnings = [];
    if (file.seedId && local.seedId && file.seedId !== local.seedId)
      warnings.push('A different workbook was already imported on this device. Importing a second workbook can miss its changes. The safe route is to erase this device and import once.');
    return { ok: true, warnings: warnings };
  }

  // Merge definitions: keep local entries, add anything missing by id.
  function mergeDefs(local, incoming) {
    var out = emptyDefs();
    ['items', 'gestures', 'grammar', 'milestones'].forEach(function (k) {
      var seen = {}, list = [];
      (local && local[k] || []).forEach(function (x) { seen[x.id] = 1; list.push(x); });
      (incoming && incoming[k] || []).forEach(function (x) { if (!seen[x.id]) { seen[x.id] = 1; list.push(x); } });
      list.sort(function (a, b) { return a.id - b.id; });
      out[k] = list;
    });
    return out;
  }

  return {
    FORMAT: FORMAT, FORMAT_VERSION: FORMAT_VERSION, SCHEMA: SCHEMA, CODES: CODES,
    parseDate: parseDate, fmtDate: fmtDate, ageParts: ageParts, ageText: ageText,
    monthLabel: monthLabel, monthLabels: monthLabels, labelToMonth: labelToMonth,
    sessionId: sessionId, mondayOf: mondayOf, isCode: isCode, combine: combine,
    uuid: uuid, makeEvent: makeEvent, validEvent: validEvent, sortEvents: sortEvents,
    mergeEvents: mergeEvents, fold: fold, emptyDefs: emptyDefs, mergeDefs: mergeDefs,
    previousCodedMonth: previousCodedMonth, sLocks: sLocks, carriedGestures: carriedGestures,
    monthProgress: monthProgress, isDone: isDone, fullyLocked: fullyLocked, carriedSS: carriedSS, changesSincePrevious: changesSincePrevious, nextItemId: nextItemId,
    csvDailyLog: csvDailyLog, csvExposure: csvExposure, csvMilestones: csvMilestones,
    csvRecordings: csvRecordings, csvMonth: csvMonth,
    buildBackup: buildBackup, checkImport: checkImport
  };
});
