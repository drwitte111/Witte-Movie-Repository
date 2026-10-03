# drwitte / films

Static GitHub Pages site (no build step): `index.html`, `style.css`, `app.js`, `web.js`, `sw.js`.

## Deployment
- **Push all updates straight to production** (`main`), which GitHub Pages deploys automatically.
  No feature branches or PRs needed.

## Data
- `diary.csv` and `ratings.csv` come from the same Letterboxd export (Settings → Import & Export).
  Always update both together.
- `ratings.csv` holds each film's current rating and overrides the diary entry's rating.
- Rating conventions: blank (in both files) = owned, not watched yet; `0.5` = seen, not rated; `1`–`5` = rated.

## Service worker
- `sw.js` caches the app shell network-first. Add any new top-level file to its `SHELL` list.
