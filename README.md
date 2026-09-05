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

A budget period runs from the **25th** of one month to the **24th** of the next (e.g., "November" = Oct 25 – Nov 24), labeled by the month it ends in.

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

### One-time setup

1. **Google AI Studio key** — create one at https://aistudio.google.com/apikey (free tier).
2. **Deploy the microservice** (`api/parse.js`) to Vercel:
   - Create a Vercel project importing this repo. In *Build and Output Settings* use the
     **Other** framework preset, no build command, no output directory (only `/api` is needed).
   - Add environment variables on the project: `GEMINI_API_KEY` (your AI Studio key) and
     `BUDGET_PARSE_SECRET` (any long random string — pick your own).
   - Deploy. Note the function URL: `https://<project>.vercel.app/api/parse`.
3. **Point the app at it** — the app reads two build-time vars (see `.env.example`):
   - `VITE_PARSE_ENDPOINT` = the function URL above
   - `VITE_PARSE_SECRET` = the same value as `BUDGET_PARSE_SECRET`
   - For the live site: set both as **GitHub repo secrets**
     (Settings → Secrets and variables → Actions → `VITE_PARSE_ENDPOINT`, `VITE_PARSE_SECRET`);
     the Pages workflow bakes them into the build.
   - For local dev: copy `.env.example` to `.env` and fill it in; deploy the function once
     (or use `vercel dev`) and set the endpoint to the deployed or local URL.

The Gemini model used is a single constant (`GEMINI_MODEL` in `api/parse.js`, currently
`gemini-3.6-flash`, free tier) and is trivial to swap.

### Architecture notes

- `src/lib/parseService.ts` is the only client code that knows about the microservice —
  the service boundary the UI talks to.
- The microservice validates the request (origin allow-list, shared-secret header,
  per-IP rate limit, body whitelisting) and returns only the structured LLM JSON;
  the app re-validates it (`validateParsedTransaction`, covered by `npm test`) before
  showing the review form. The LLM output is untrusted external data at every step.
- Rate limiting is per warm instance (best-effort; serverless instances are ephemeral).

### Troubleshooting the microservice

- **`FUNCTION_INVOCATION_FAILED` / 500 on every call** — Vercel invokes functions with
  Node-style `handler(req, res)`; the handler must use `req.headers`/`res.end()`, not the
  Web-standard `Request`/`Response` objects.
- **`{ ok: false, code: 'provider' }` / 502** — the Gemini call failed. Check the function's
  logs in Vercel ("gemini error …" lines): 404 usually means the model was retired — update
  `GEMINI_MODEL` in `api/parse.js` and redeploy (Gemini's error message names the
  recommended replacement). 429 means the free quota is exhausted.
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
