# GeoSport Tracker 🌎

A small dashboard for tracking daily [GeoSports](https://geosports.app) scores with friends. Log each day's five taps and get an all-time leaderboard, 1-week and 1-month trends, a points race, per-question averages, tap-quality breakdowns, head-to-head records, a calendar heatmap and all-time records.

No build step: plain HTML, CSS and JS, with Chart.js from a CDN.

## Scoring

The scoring follows [geosports.app/how-it-works](https://geosports.app/how-it-works). Each question has a base score of 0–100, based on distance from the answer, and the app applies the multipliers for you:

| Q1 | Q2 | Q3 | Q4 | Q5 | Max |
|----|----|----|----|----|-----|
| ×1 | ×1 | ×2 | ×3 | ×3 | 1,000 |

Tap tiers: 100 is Perfect, 90–99 Great, 50–89 Ballpark, 1–49 Miles off, and 0 Antipodal.

## Using it

1. **Settings → Players.** Add everyone you're tracking.
2. **+ Add score.** Pick the player and date, then type the five base scores. You can also paste text containing them, and the numbers are pulled out automatically. Press Enter to jump between fields. Saving again for the same player and date replaces that entry.
3. Use the **1W / 1M / 3M / All** filter to change the window for the charts and leaderboard.

## Admin vs viewers

By default the site is read-only. To unlock editing in your own browser, open `…/GeoSport-Leaderboard/#admin` once and paste a [fine-grained token](https://github.com/settings/personal-access-tokens/new) scoped to this repo with *Contents: Read and write*. That browser can then add and edit scores, and every save is committed to `data/scores.json`. Everyone else only sees the repo copy. Use **Settings → Lock this browser** to remove the token.

## Where the data lives

- Your working copy is saved in your browser (localStorage).
- `data/scores.json` in this repo is the shared copy. On load, the app uses whichever is newer.
- There are two ways to get your changes into the repo:
  - **Export JSON** in Settings, then commit the downloaded file as `data/scores.json`.
  - **GitHub sync** in Settings. Paste a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with *Contents: Read and write* on this repo only, and the app commits `data/scores.json` for you, either automatically after each save or with a click. The token stays in your browser.

The badge in the header tells you whether you have changes that aren't in the repo yet.

## Hosting (GitHub Pages)

Go to Settings → Pages → Deploy from branch → `main` / root. The site is served at `https://<you>.github.io/geosport-tracker/`.

## Run locally

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## Auto-tracking

GeoSports doesn't have a public API, so entry is manual for now.
