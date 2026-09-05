# Project Skill — $5 Budget App (COP)

> Read this file FIRST when starting a new session on this project. It captures the
> product, architecture, design system, and working conventions as of the latest state.
> Feature history/spec for smart entry: `skills/speech-entry.md` (implemented, revised).

---

## 1. What this is

A **mobile-first personal budget web app** for a single user. Colombian Peso (COP).
Budget data is fully client-side and offline: it lives in the browser's `localStorage`
and (except for smart entry) never leaves the device.

- Repo: https://github.com/camichaves79/budget
- Live site: https://camichaves79.github.io/budget/ (auto-deployed from `main`)
- Local dev: `npm run dev` → http://localhost:5173/
- **PWA install name: "$5 Budget"** (manifest + apple meta in `index.html`; icons mint
  `#60c784` + engraving-green banknote in `public/`).
- **Parse microservice** (the app's first backend): Vercel Function
  `https://budget-beta-two.vercel.app/api/parse` — see §4/§8.

## 2. Product scope & confirmed decisions

**In scope (v1):**
- **Cash Flow** tab: period summary (Income / Expenses / Balance), day-grouped
  transaction list (add / edit / delete), pinned header + internally scrolling list
- **Smart entry** (AI-assisted): the "+" FAB opens a natural-language field; dictate
  via the native keyboard mic (NO SpeechRecognition API). **Submit** → parse
  microservice → **instant save + fading toast** when the parse is complete;
  ambiguous parses (no mappable category) fall back to the review form
  (`TransactionForm`); errors show as fading toasts and keep the text for retry.
  Manual entry stays one tap away ("Enter manually instead").
- **Budgets** tab: monthly limit per expense category, progress bars, over-budget
  highlighting, pinned period selector + summary, scrolling category lists
- **Settings** tab: category management (add / edit / delete), JSON export / import,
  two-step reset
- COP currency, English UI, single user, offline-first (except smart entry)

**Confirmed decisions:**
- Budget period start day is **user-configurable (1–28, default 25)** via Settings →
  Budget period ("Period starts on"). The period runs from that day to the day before it
  next month, labeled by the month containing the **majority** of its days (ties go to
  the starting month). With the default 25th that reproduces Aug 25 – Sep 24 =
  "September". Period keys are the start date `YYYY-MM-DD`.
- COP display: **integer pesos only** — `$ 1.234` (non-breaking space between `$` and
  number, dots for thousands, cents rounded to nearest peso on display).
- Storage: `localStorage` behind an adapter interface (SQLite-swappable later).
- Savings goals feature was **removed entirely** (page, tab, state, types, CSS, docs).
- Demo transaction seeder was **removed**.
- No app header bar (tab bar is the navigation identity).
- FAB is a **plain "+"** — a lightning overlay was tried and removed (2026-09).
- The parse button label is **"Submit"**, not "Parse" (user-friendly copy).

## 3. Tech stack & tooling

- Vite 8 (Rolldown-based) + React 19 + TypeScript 6, plain CSS (no framework)
- No router, no UI library, no icon library (inline stroke SVGs)
- Lint: `oxlint` · Tests: hand-rolled smoke suite (`tests/smoke.ts`, ~90 checks)
- npm scripts: `dev` · `build` (tsc -b && vite build) · `lint` · `preview` ·
  `test` (bundles tests/smoke.ts via `vite.test.config.ts` into `.smoke/` and runs it)
- **Local npm quirk:** the global npm cache in this environment has permission issues.
  Use `npm_config_cache="$PWD/.npm-cache" npm install ...` for installs (incl. any
  temporary tool like `sharp --no-save`; `npm uninstall --no-save sharp` after, and
  confirm `package-lock.json` stayed clean).
- `vite.config.ts` uses `base: './'` so the build works from the `/budget/` subpath on
  GitHub Pages. Vite rebases `/…` asset refs in `index.html` automatically.
- **No SVG→PNG rasterizer with emoji fonts is available here** (qlmanage fails,
  sharp/librsvg renders the 💰 emoji as a black box). For icon PNGs, draw vector
  shapes (the current banknote icon was authored as SVG paths + rendered via
  `sharp --no-save`).

## 4. Architecture & file map

```
src/
  lib/
    types.ts        # TxType, Transaction, Category, Budget, AppData
    money.ts        # formatCOP (integer pesos, NBSP), parseAmountToCents
    dates.ts        # toISODate, todayISO, isValidISODate, parseISODate, formatDate*
    periods.ts      # configurable start-day periods (1–28), majority-month labels
    storage.ts      # StorageAdapter interface + localStorageAdapter (schema v1)
    seed.ts         # defaultCategories() + PALETTE (category colors unused in UI)
    selectors.ts    # periodTransactions, totalsFor, spentByCategory, categoryById,
                    # activeCategories, isInPeriod
    importExport.ts # validateAppData, exportData (JSON backup download)
    parseService.ts # THE client service boundary: calls the parse microservice
                    # (VITE_PARSE_ENDPOINT + VITE_PARSE_SECRET, baked at build time),
                    # pure validateParsedTransaction (LLM-output trust boundary)
  state/store.tsx   # Context + useReducer, auto-saves to localStorage on every change
  components/       # TabBar, Sheet (className prop + keyboard inset), ConfirmDialog,
                    # ProgressBar, AmountInput (floating-label variant), PeriodNav,
                    # EmptyState, TransactionForm (submitLabel prop),
                    # SmartEntry (smart input + instant save + review fallback),
                    # FloatField (label-inside-box pattern), Toast (fading feedback)
  pages/            # Dashboard.tsx (Cash Flow + smart sheet + toast), Budgets.tsx,
                    # Settings.tsx
api/parse.js        # Vercel Function (route /api/parse): Gemini proxy. Plain JS with
                    # JSDoc (no build step; checked via tsconfig.node checkJs).
                    # Node-style handler(req, res) — Vercel does NOT use Web Request.
                    # Shared-secret header + origin allow-list + per-IP rate limit.
tests/smoke.ts      # logic tests: money, periods, selectors, LLM validator,
                    # microservice helpers (rate limiter, sanitizer, Gemini parser)
public/             # favicon.svg (mint + 💰), manifest.webmanifest ("$5 Budget"),
                    # icon-192/512.png, apple-touch-icon.png (banknote vector icon)
.github/workflows/deploy.yml  # GitHub Pages on push to main; bakes VITE_* repo secrets
```

**Smart-entry flow:** FAB → SmartEntry textarea → `parseUtterance(utterance,
categories)` → POST microservice → Gemini `gemini-3.6-flash` (free tier,
`thinkingLevel: 'low'` so hidden thoughts don't eat the output budget) → structured
JSON → client-side `validateParsedTransaction` → instant `addTransaction` + success
toast (or review form when categoryId is null).

**State actions:** `addTransaction`, `updateTransaction`, `deleteTransaction`,
`addCategory`, `updateCategory`, `deleteCategory` (reassigns transactions to a
same-kind fallback category), `setBudget` (null = remove), `importData`, `resetAll`.

## 5. Domain rules

- **Money:** stored as integer **centavos** everywhere. `formatCOP` renders integer
  pesos, dots thousands, `$` + non-breaking space, `-` prefix for negatives.
  `parseAmountToCents` accepts flexible input. NBSP in output means test expectations
  must use `\u00A0`.
- **Periods:** configurable start day (1–28, default 25; `clampStartDay`). Functions take
  `startDay` (`periodForDate(date, day)`, `currentPeriod(day)`, …). Key = start date
  `YYYY-MM-DD`. Label = month with the majority of the period's days (tie → start month).
  Year rollover regression-tested.
- **Categories:** user-editable defaults (Vivienda, Servicios, Mercado, Transporte,
  Salud, Educación, Entretenimiento, Restaurantes, Ropa, Otros + Salario, Freelance,
  Otros ingresos). `kind`, `emoji`, `color` (unused visually), `archived` (model-only).
- **Budgets:** one limit per expense category, applies to every period.
- **Privacy:** only smart-entry text + the category list are sent (to the parse
  microservice). Transaction history never leaves the device. Never log transaction
  text; the function logs Gemini status/code only.

## 6. Design system

**Palette** (CSS variables in `src/index.css :root`):

| Var | Value | Use |
|---|---|---|
| `--primary` | `#1b3022` | engraving green: buttons, active tab, headings, text ink |
| `--bg` | `#f8f7f4` | parchment cream canvas |
| `--surface` | `#ffffff` | cards, rows, sheets |
| `--text` | `#1b3022` | primary text (expense amounts are dark, not red) |
| `--muted` | `#64748b` | secondary text |
| `--border` | `#e2e8f0` | hairlines, progress track |
| `--tab-inactive` | `#94a3b8` | inactive tab icons |
| `--accent` / `--income` | `#2d6a4f` | mint: on-budget bar, income numbers |
| `--terracotta` | `#c05621` | copper: over-budget bar (100%+), over amounts/chip |
| `--coral-soft` | `rgba(192,86,33,.15)` | over-budget row background tint |
| `--danger` | `#e11d48` | destructive actions ONLY (delete, reset) |
| `--neutral-tint` | `#f1f5f9` | expense emoji circles |
| `--income-soft` | `#e9f2ed` | income emoji circles |

Icon color: **mint `#60c784`** (RGB 96,199,132) + engraving-green strokes (PNG icons +
favicon bg). Not a CSS var (icons only).

**Progress bars** are tonal (no traffic lights): 6px slate track; fill = mint 0–75%,
primary 76–99%, terracotta 100%+; over-budget row gets the coral tint.

**Typography:** self-hosted Rajdhani (400/600/700 woff2 in `src/assets/fonts/`).
Scale: `--fs-sm` 12, `--fs-md` 14, `--fs-lg` 16; `--fs-amount` (16) for ALL money.

**Spacing:** `--pad-sm` 8, `--pad-md` 16, `--pad-lg` 24. Tightened form rhythm
(`.sheet-tight` on transaction/category/budget sheets) uses even values (4/6/8/10) —
**every vertical value must be a multiple of 2**; deviate from the 8/16/24 vars only
in those tight overrides.

**Layout patterns:**
- `.app` is fixed `100dvh`, `overflow: hidden` — the page never scrolls.
- Tabs with pinned headers use `fixed-main` + `pinned-page` / `pinned-head` /
  `pinned-scroll`.
- Bottom `TabBar` (3 tabs), bottom sheets (`Sheet`, supports `className`), `ConfirmDialog`.
- **Floating labels**: `FloatField` puts each form label INSIDE its box (centered
  placeholder when empty → small top label when focused/filled). `AmountInput` has a
  `label` prop for this; the `$` prefix only shows when floated. Category select and
  date input hide their native hint text while the centered label is showing
  (`.text-hidden`). Selects use a single SVG chevron + `-webkit-appearance: none`.
- **Toasts**: transient feedback (`.toast`) — appears, holds ~4s, fades out
  (`toast-in`/`toast-out` keyframes), removed by `Toast.tsx` timer. Success = mint ✓,
  error = terracotta ⚠, `aria-live`.
- Cash flow tiles: 3-across; ≤400px: Income + Expenses side by side, Balance spans
  both columns.

## 7. Testing & verification

- `npm test` — smoke suite: money format/parse incl. rounding & NBSP, period math,
  ISO date validation, **LLM-output validator** (`validateParsedTransaction`),
  **microservice helpers** (rate limiter, request sanitizer, Gemini response parser).
  ~90 checks.
- `npm run build` + `npm run lint` before shipping. Lint has 3 known harmless
  react-refresh warnings (store.tsx exports).
- `api/parse.js` logic is tested via tests/smoke.ts imports; the handler itself can be
  smoke-tested locally by stubbing `fetch` and calling it with fake Node-style
  req/res objects (see session history pattern).
- No UI test framework installed.

## 8. Git & deploy workflow

- One feature branch per change, created from `main` (user picks the name; recent:
  `speech-entry`, `smart-entry-ux`, `ui-miscelaneous-0002…0007`, `ios-keyboard-fixes`,
  `floating-field-labels`, `select-chevron-fix`, `icon-color`).
- **Only commit/push when the user explicitly says so.**
- **"ship"** = commit → push branch → fast-forward merge into `main` → push → delete
  branch locally and remotely → verify deploys. History stays linear (no merge commits).
- **GitHub Pages**: Actions on push to `main`. Verify with
  `curl -s -o /dev/null -w "%{http_code}" https://camichaves79.github.io/budget/` and
  poll `/repos/camichaves79/budget/actions/runs` every ~10s until `completed success`.
  Repo secrets `VITE_PARSE_ENDPOINT` / `VITE_PARSE_SECRET` are baked at build time.
- **Vercel**: Git integration auto-deploys `main` to the `budget-beta-two` project
  (Framework: Other, no build command). Env vars there: `GEMINI_API_KEY`,
  `BUDGET_PARSE_SECRET`. Function URL: `https://budget-beta-two.vercel.app/api/parse`.
- Local `.env` (gitignored) holds `VITE_PARSE_ENDPOINT` + `VITE_PARSE_SECRET` for dev;
  pattern in `.env.example`.
- To trigger a Pages rebuild without code changes (e.g. after setting repo secrets),
  push a trivial commit (docs touch) — workflow_dispatch re-runs need a token.

## 9. Gotchas

- `formatCOP` output contains `\u00A0` — write `'$\u00A01.234'` in tests.
- localStorage schema version 1; don't bump casually.
- React StrictMode is on; effects run twice in dev (the OAuth/URL effects are written
  to survive it — strip query params synchronously before async work).
- **iOS Safari**: form fields must be ≥16px font or iOS auto-zooms on focus; buttons
  need `touch-action: manipulation` (double-tap zoom). The keyboard overlays fixed
  layouts — `Sheet` lifts via `window.visualViewport` delta → `--kb-inset` on `:root`
  + `.sheet-backdrop { padding-bottom: var(--kb-inset) }` + `max-height: 100%`;
  `html.kb-open .sheet` rounds the bottom corners while floating.
- **Vercel** invokes functions Node-style `handler(req, res)` — a Web-standard
  `Request` handler throws FUNCTION_INVOCATION_FAILED.
- **Gemini**: model string must be current for NEW accounts (2.5-flash is retired for
  them; now `gemini-3.6-flash`). Gemini 3.x thinks by default and hidden thoughts
  consume `maxOutputTokens` — keep `thinkingConfig: { thinkingLevel: 'low' }` or the
  JSON gets truncated mid-object. Google's error messages name the replacement model.
- Dates are local-only ISO strings (`YYYY-MM-DD`); no timezone math.
- Installing sharp or other temp tools: use the `npm_config_cache` workaround,
  `--no-save`, and check `package-lock.json` is untouched afterwards.
- The user approves UI/behavior changes **after** testing in prod — ship on request,
  expect "I'll approve" flow; keep deploys verified and report bundle/branch state.

## 10. Current state & next-session context

Everything below is **shipped and live** (main ≈ `ef9f63e`, 2026-09-05):

- Smart entry end-to-end: PWA → Vercel microservice → Gemini 3.6 Flash → instant save
  with fading toasts; review form only for ambiguous parses. Full spec (revised):
  `skills/speech-entry.md`.
- iOS keyboard/zoom fixes, floating labels + tight form rhythm, single SVG select
  chevron, "$5 Budget" PWA manifest + mint icons — all approved by the user.
- Configurable budget period start day (Settings → Budget period, 1–28) with
  majority-month period labels — approved by the user.

Candidate next steps (ask the user, don't assume):
- Category | Date side-by-side row in TransactionForm (was offered, not done).
- Anything else the user raises; always read `skills/speech-entry.md` for the feature
  spec and this file for conventions before coding.
