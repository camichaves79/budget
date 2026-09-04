# 💰 Budget

A mobile-first personal budget tracker for a single user. Works fully offline — all data lives in your browser's local storage and never leaves the device.

Built with React + TypeScript + Vite. See `REQUIREMENTS.md` for the full spec.

## Features

- **Dashboard** — one scrollable view: period summary (income, expenses, balance), the transaction list (add / edit / delete), and budget progress
- **Category budgets** — monthly limit per category with progress bars and over-budget alerts
- **Settings** — manage categories, export/import JSON backups, reset all data
- **COP currency** — amounts formatted `$ 1.234,56` (dots group thousands, comma decimals, whole values without decimals), stored as integer centavos

## Budget periods

A budget period runs from the **25th** of one month to the **24th** of the next (e.g., "October" = Oct 25 – Nov 24).

## Getting started

```bash
npm install
npm run dev        # start the dev server (default: http://localhost:5173)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build locally
npm test           # run the logic smoke test (currency and period math)
```

## Data & persistence

- Data auto-saves to `localStorage` on every change and survives reloads and browser restarts.
- **Export a JSON backup** regularly from Settings → Data → Export. The backup is the only copy if you clear site data or change devices.
- Import a backup to restore on another device.

## Deploying to GitHub Pages

The repo includes `.github/workflows/deploy.yml`, which builds and deploys automatically on every push to `main`. The workflow also enables Pages itself (`enablement: true`), so there is no manual setup in the repo settings.

1. Create a repository on GitHub (e.g. `budget`) — **do not** initialize it with a README.
2. Push this repo:
   ```bash
   git remote add origin https://github.com/<your-username>/budget.git
   git push -u origin main
   ```
3. The push triggers the deploy. Your site will be live at `https://<your-username>.github.io/budget/` (watch the Actions tab for progress).

If the deploy step ever complains that Pages is not enabled, set it once in the repo: **Settings → Pages → Source: GitHub Actions**.

Notes:

- `vite.config.ts` uses `base: './'` (relative paths), so the app works from the `/<repo>/` subpath without any extra configuration.
- Data is stored per browser per origin: data you enter on `localhost:5173` is separate from data on the GitHub Pages URL. Move it with Settings → Export/Import.

## Project structure

```
src/
  lib/          # pure logic: types, money, dates, periods, storage adapter, selectors, import/export
  state/        # React store (context + reducer) with localStorage persistence
  components/   # reusable UI: tabs, sheets, forms, progress bars
  pages/        # Dashboard, Budgets, Settings
```

## Notes

- The storage layer (`src/lib/storage.ts`) is an adapter interface, so the backend can be swapped (e.g., SQLite via WASM) without touching UI code.
