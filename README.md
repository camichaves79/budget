# 💰 Budget

A mobile-first personal budget tracker for a single user. Works fully offline — all data lives in your browser's local storage and never leaves the device.

Built with React + TypeScript + Vite. See `REQUIREMENTS.md` for the full spec.

**For AI agents / new sessions:** start by reading `skills/project-skill.md` (full
project context and conventions) and `skills/speech-entry.md` (next planned feature).

## Features

- **Cash Flow** — one scrollable view: period summary (income, expenses, balance), the transaction list (add / edit / delete), and budget progress
- **Smart entry (AI parsing)** — the "+" button opens a natural-language field: type or dictate
  (keyboard mic) something like *"I spent 35 on lunch yesterday"*, and the app turns it into a
  transaction you review and confirm. Manual entry stays one tap away.
- **Category budgets** — monthly limit per category with progress bars and over-budget alerts
- **Settings** — manage categories, export/import JSON backups, reset all data
- **COP currency** — amounts formatted `$ 1.234` (integer pesos only, dots for thousands; stored as integer centavos, cents rounded away on display)

## Budget periods

A budget period runs from a **configurable start day** (Settings → Budget period, 1–28,
default 25) to the day before it in the next month (e.g., start day 25 = Oct 25 – Nov 24).
Periods are labeled by the month containing the **majority** of their days (ties go to the
starting month) — so with the default 25th, "November" = Oct 25 – Nov 24.

## Getting started

```bash
npm install
npm run dev        # start the dev server (default: http://localhost:5173)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build locally
npm test           # run the logic smoke test (currency and period math)
```

## Smart entry (AI parsing)

Smart entry parses natural language through a small **parse microservice** — this app's
first backend. The LLM API key lives server-side and never reaches the client.

```
React PWA (GitHub Pages) → HTTPS → Parse microservice (Vercel Function) → Google Gemini
```

Only the transaction text you submit and your category list are sent. Transaction history
never leaves the device, and nothing is saved until you confirm it in the review step.

One utterance can describe **several transactions at once** ("300 in bread, 2000 bus
home, 30000 in a hamburger…"). Confident entries save immediately; entries the model is
unsure about (or can't map to a category) go through the review form — pre-filled with
the model's guess — before anything is saved, and a summary shows exactly what was
recorded.

### One-time setup

1. **Google AI Studio key** — create one at https://aistudio.google.com/apikey (free tier).
2. **Deploy the microservice** (`api/parse.js`) to Vercel:
   - Create a Vercel project importing this repo. In *Build and Output Settings* use the
     **Other** framework preset, no build command, no output directory (only `/api` is needed).
   - Add environment variables on the project: `GEMINI_API_KEY` (your AI Studio key),
     `BUDGET_PARSE_SECRET` (any long random string — pick your own), and optionally
     `GEMINI_FALLBACK_MODEL` (the quota-fallback model; defaults to
     `gemini-3.5-flash-lite`, set it to an empty string to disable the fallback).
   - Deploy. Note the function URL: `https://<project>.vercel.app/api/parse`.
3. **Point the app at it** — the app reads two build-time vars (see `.env.example`):
   - `VITE_PARSE_ENDPOINT` = the function URL above
   - `VITE_PARSE_SECRET` = the same value as `BUDGET_PARSE_SECRET`
   - For the live site: set both as **GitHub repo secrets**
     (Settings → Secrets and variables → Actions → `VITE_PARSE_ENDPOINT`, `VITE_PARSE_SECRET`);
     the Pages workflow bakes them into the build.
   - For local dev: copy `.env.example` to `.env` and fill it in; deploy the function once
     (or use `vercel dev`) and set the endpoint to the deployed or local URL.

The primary Gemini model is a single constant (`GEMINI_MODEL` in `api/parse.js`,
currently `gemini-3.6-flash`, free tier) and is trivial to swap. When the primary is
blocked by quota, the function falls back to `GEMINI_FALLBACK_MODEL` (default
`gemini-3.5-flash-lite`), which has its own separate free-tier quota.

### Architecture notes

- `src/lib/parseService.ts` is the only client code that knows about the microservice —
  the service boundary the UI talks to.
- The microservice validates the request (origin allow-list, shared-secret header,
  per-IP rate limit, body whitelisting) and returns only the structured LLM JSON — a
  non-empty array, one element per transaction, each with a `confidence` grade (0–1);
  the app re-validates every element (`validateParsedTransactions`, covered by
  `npm test`) before saving anything. The LLM output is untrusted external data at
  every step; entries below the confidence threshold (`REVIEW_CONFIDENCE_THRESHOLD`
  in `parseService.ts`, 0.8) or without a category go to review instead of instant-save.
- Rate limiting is per warm instance (best-effort; serverless instances are ephemeral):
  40 requests / 10 min per IP, applied after the origin and secret checks.
- Free-tier resilience: transient Gemini failures (429/5xx) are retried with backoff
  (honoring Google's retry delay when it's short), then the fallback model gets a turn.
  Successful parses are cached on the warm instance for 1h, so re-submitting the same
  text — the natural retry after a "busy" response — answers instantly with no Gemini
  call. The app also retries once automatically before showing an error.

### Troubleshooting the microservice

- **`FUNCTION_INVOCATION_FAILED` / 500 on every call** — Vercel invokes functions with
  Node-style `handler(req, res)`; the handler must use `req.headers`/`res.end()`, not the
  Web-standard `Request`/`Response` objects.
- **`{ ok: false, code: 'provider-busy' }` / 503** — Gemini answered 429 (free quota) or was
  unreachable after the function's own retries and fallback. Check the function's logs in
  Vercel ("gemini error …" lines): the logged `retryDelay` shows whether it was a short
  traffic delay (seconds) or the daily quota (hours — resets at midnight Pacific). The
  app retries once automatically, and re-submitting the same text is served from the
  warm-instance cache without a Gemini call.
- **`{ ok: false, code: 'provider' }` / 502** — the Gemini call failed for another reason.
  Check the logs: 404 usually means the model was retired — update `GEMINI_MODEL` in
  `api/parse.js` and redeploy (Gemini's error message names the recommended replacement).
- **`{ ok: false, code: 'rate-limited' }` / 429** — the function's own per-IP limiter
  (40 requests / 10 min per warm instance). Space out submissions; identical text within
  the hour is served from the cache.
- **`{ ok: false, code: 'invalid-response' }` with truncated JSON** — Gemini 3.x models
  "think" before answering and hidden thoughts consume the output budget. Keep
  `generationConfig.thinkingConfig.thinkingLevel: 'low'` in the function.

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
  pages/        # Cash Flow, Budgets, Settings
api/
  parse.js      # parse microservice (Vercel Function): Gemini proxy, key server-side
```

## Notes

- The storage layer (`src/lib/storage.ts`) is an adapter interface, so the backend can be swapped (e.g., SQLite via WASM) without touching UI code.
