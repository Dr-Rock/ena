# Ena — bilingual language log

A capture app for a parent-run language study. It records daily words, the monthly
checklist session, weekly exposure, firsts and recording sessions, entirely on the phone.
The app files contain no data and no names; everything you enter stays in the phone's own
storage until you send a backup.

## 1. Put it online (once, about 10 minutes)

The phone needs an https address to install the app and use it offline. GitHub Pages is free.

1. Sign in at github.com (create a free account if needed).
2. **New repository** → name `ena` → **Public** → **Create repository**.
3. Click **uploading an existing file**, drag in every file from this folder
   (`index.html`, `core.js`, `sw.js`, `manifest.webmanifest`, the three `icon-*.png`, this README) → **Commit changes**.
4. **Settings → Pages** → Source: **Deploy from a branch** → Branch: **main**, folder **/ (root)** → **Save**.
5. After a minute or two the address appears at the top of that page:
   `https://YOUR-USERNAME.github.io/ena/`

Public is fine: the repository only holds the empty app.

## 2. Install on the iPhone

1. Open the address in **Safari**.
2. **Share → Add to Home Screen → Add**.
3. From now on, open Ena **only from the home-screen icon**. A Safari tab keeps a separate,
   empty storage — entries made there are not on the icon.

## 3. First start on the main phone

1. Name the phone and choose **Yes — main phone**. Monthly sessions only count from the main phone.
2. **Import file…** → choose the workbook import file (`ena-import-….json`) prepared from your workbook.
3. Send a first backup straight away (gear icon → **Send backup** → **Save to Files** → iCloud Drive).

## 4. Second phone (optional)

1. Same address, Add to Home Screen, choose **No — second phone**.
2. Import the latest backup from the main phone (AirDrop it).
3. Once a week, send this phone's backup to the main phone, which imports it. Importing merges
   by entry ID: the same file twice adds nothing, and nothing from a second phone can change a month.

## 5. Routine

| When | Where | What |
|---|---|---|
| Every day | Today | One entry per notable word: as heard first, then target word |
| Sunday | Week | Exposure estimates, then **Send backup** to iCloud Drive |
| Recording week | Record | Tap **Starting a recording now**; rename the camera file to the name shown |
| On the day | Firsts | Enter a first the day it happens, with its evidence level |
| Month-day | Month | Words → Review → Gestures → Grammar → Close, then **Send backup** |
| After closing a month | Claude | Upload the backup; it becomes the dated workbook snapshot |

## 6. What it never does

No counts, charts, trends, norms or percentiles. Results belong in the workbook dashboard,
read after a month is closed.

## 7. Updating the app

Replace the files in the repository with the new version. Data on the phones is not touched.
Removing the home-screen icon **does** delete the data on that phone — keep backups current.
