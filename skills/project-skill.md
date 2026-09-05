# Project Skill — Budget App (COP)

> Read this file FIRST when starting a new session on this project. It captures the
> product, architecture, design system, and working conventions as of the latest state.
> For the next planned feature, see `skills/speech-entry.md`.

---

## 1. What this is

A **mobile-first personal budget web app** for a single user, fully client-side and
offline. Colombian Peso (COP). Data lives in the browser's `localStorage` and never
leaves the device.

- Repo: https://github.com/camichaves79/budget
- Live site: https://camichaves79.github.io/budget/ (auto-deployed from `main`)
- Local dev: `npm run dev` → http://localhost:5173/

## 2. Product scope & confirmed decisions

**In scope (v1):**
- **Cash Flow** tab: period summary (Income / Expenses / Balance), day-grouped
  transaction list (add / edit / delete), pinned header + internally scrolling list
- **Budgets** tab: monthly limit per expense category, progress bars, over-budget
  highlighting, pinned period selector + summary, scrolling category lists
- **Settings** tab: category management (add / edit / delete), JSON export / import,
  two-step reset
- COP currency, English UI, single user, offline-first

**Confirmed decisions:**
- Budget period runs **25th → 24th** of the next month, **labeled by the month it ENDS
  in** (Aug 25 – Sep 24 = "September").
- COP display: **integer pesos only** — `$ 1.234` (non-breaking space between `$` and
  number, dots for thousands, cents rounded to nearest peso on display).
- Storage: `localStorage` behind an adapter interface (SQLite-swappable later).
- Savings goals feature was **removed entirely** (page, tab, state, types, CSS, docs).
- Demo transaction seeder was **removed**.
- No app header bar (tab bar is the navigation identity).

## 3. Tech stack & tooling

- Vite 8 (Rolldown-based) + React 19 + TypeScript 6, plain CSS (no framework)
- No router, no UI library, no icon library (inline stroke SVGs), no backend
- Lint: `oxlint` · Tests: hand-rolled smoke suite (`tests/smoke.ts`)
- npm scripts: `dev` · `build` (tsc -b && vite build) · `lint` · `preview` ·
  `test` (bundles tests/smoke.ts via `vite.test.config.ts` into `.smoke/` and runs it)
- **Local npm quirk:** the global npm cache in this environment has permission issues.
  Use `npm_config_cache="$PWD/.npm-cache" npm install ...` for installs.
- `vite.config.ts` uses `base: './'` so the build works from the `/budget/` subpath on
  GitHub Pages.

## 4. Architecture & file map

```
src/
  lib/
    types.ts        # TxType, Transaction, Category, Budget, AppData
    money.ts        # formatCOP (integer pesos, NBSP), parseAmountToCents
    dates.ts        # toISODate, todayISO, parseISODate, formatDate*, daysUntil
    periods.ts      # 25th→24th periods, labeled by END month
    storage.ts      # StorageAdapter interface + localStorageAdapter (schema v1)
    seed.ts         # defaultCategories() + PALETTE (category colors now unused in UI)
    selectors.ts    # periodTransactions, totalsFor, spentByCategory, categoryById,
                    # activeCategories, isInPeriod
    importExport.ts # validateAppData, exportData (JSON backup download)
  state/store.tsx   # Context + useReducer, auto-saves to localStorage on every change
  components/       # TabBar, Sheet, ConfirmDialog, ProgressBar, AmountInput,
                    # PeriodNav, EmptyState, TransactionForm
  pages/            # Dashboard.tsx (Cash Flow), Budgets.tsx, Settings.tsx
tests/smoke.ts      # logic tests (money, periods, selectors)
public/favicon.svg  # engraving-green 💰
.github/workflows/deploy.yml  # GitHub Pages deploy on push to main (self-enabling)
```

**State actions:** `addTransaction`, `updateTransaction`, `deleteTransaction`,
`addCategory`, `updateCategory`, `deleteCategory` (reassigns transactions to a
same-kind fallback category), `setBudget` (null = remove), `importData`, `resetAll`.
No goal actions (feature removed).

## 5. Domain rules

- **Money:** stored as integer **centavos** everywhere. `formatCOP` renders integer
  pesos, dots thousands, `$` + non-breaking space, `-` prefix for negatives.
  `parseAmountToCents` accepts flexible input (`$ 1.234,56`, `1.234.567,89`,
  `1,234.56`, `1234`). NBSP in output means test expectations must use `\u00A0`.
- **Periods:** start day 25. `periodForDate`, `currentPeriod`, `shiftPeriod`,
  `isCurrentPeriod`. Key = `YYYY-MM` of the END month. Year rollover handled via
  Date construction (there was a `2026-00` bug — regression-tested).
- **Categories:** user-editable (defaults: Vivienda, Servicios, Mercado, Transporte,
  Salud, Educación, Entretenimiento, Restaurantes, Ropa, Otros + Salario, Freelance,
  Otros ingresos). Categories have `kind` ('expense' | 'income'), `emoji`, `color`
  (unused visually now), `archived` (model-only, no UI toggle).
- **Budgets:** one limit per expense category, applies to every period.
- **Privacy:** no network calls today; export/import is the backup path.

## 6. Design system

**Palette** (CSS variables in `src/index.css :root`):

| Var | Value | Use |
|---|---|---|
| `--primary` | `#1b3022` | engraving green: buttons, active tab, headings, text ink |
| `--bg` | `#f4f4f4` | flat gray canvas |
| `--surface` | `#ffffff` | cards, rows, sheets |
| `--text` | `#1b3022` | primary text (expense amounts are dark, not red) |
| `--muted` | `#64748b` | secondary text |
| `--border` | `#e2e8f0` | hairlines, progress track |
| `--tab-inactive` | `#94a3b8` | inactive tab icons |
| `--accent` / `--income` | `#2d6a4f` | mint: on-budget bar (0–75%), income numbers |
| `--terracotta` | `#c05621` | copper: over-budget bar (100%+), over amounts/chip |
| `--coral-soft` | `rgba(192,86,33,.15)` | over-budget row background tint |
| `--danger` | `#e11d48` | destructive actions ONLY (delete, reset) |
| `--neutral-tint` | `#f1f5f9` | expense emoji circles |
| `--income-soft` | `#e9f2ed` | income emoji circles |

**Progress bars** are tonal (no traffic lights): 6px slate track; fill = mint 0–75%,
primary 76–99%, terracotta 100%+; over-budget row gets the coral tint.

**Typography:** self-hosted Rajdhani (weights 400/600/700, woff2 in
`src/assets/fonts/`). Scale: `--fs-sm` 12, `--fs-md` 14, `--fs-lg` 16;
`--fs-amount` (16) for ALL money amounts.

**Spacing:** `--pad-sm` 8, `--pad-md` 16, `--pad-lg` 24 (multiples of 2). All
paddings use these vars. Header/list spacing is deliberately tight.

**Layout patterns:**
- `.app` is fixed `100dvh` with `overflow: hidden` — the page never scrolls.
- Tabs with pinned headers use `fixed-main` + `pinned-page` / `pinned-head` /
  `pinned-scroll` (Cash Flow and Budgets).
- Bottom `TabBar` (3 tabs): Cash Flow (banknote SVG), Budgets (bar-chart SVG),
  Settings (sliders SVG). Active = primary color + 2px underline bar.
- Bottom sheets (`Sheet`) for forms; `ConfirmDialog` for confirmations.
- FAB "+" opens the manual transaction form (`TransactionForm`).
- Cash flow tiles: 3-across; ≤400px: Income + Expenses side by side, Balance spans
  both columns (`.summary-card.balance`).

## 7. Testing & verification

- `npm test` — smoke suite (money format/parse incl. rounding & NBSP, period math
  incl. end-month labels and year rollover, in-period bounds). ~34 checks.
- `npm run build` + `npm run lint` before shipping. Lint has 3 known harmless
  react-refresh warnings.
- No UI test framework installed.

## 8. Git & deploy workflow

- One feature branch per change, created from `main` (user picks the name; past
  examples: `ui-miscelaneous-0001`, `colored-progress-lines`, `screen-size`).
- **Only commit/push when the user explicitly says so.**
- **"ship"** = commit → push branch → merge into `main` → push → delete branch
  locally and remotely → verify deploy.
- Deploy: GitHub Actions workflow builds and publishes to GitHub Pages on every push
  to `main` (Pages auto-enabled via `enablement: true`). Verify with:
  `curl -s -o /dev/null -w "%{http_code}" https://camichaves79.github.io/budget/`
  and poll the Actions API (`/repos/camichaves79/budget/actions/runs`).
- Deploys typically take 1–3 minutes; poll every ~10s until `completed success`.

## 9. Gotchas

- `formatCOP` output contains `\u00A0` (non-breaking space) — copy-pasting `$ 1.234`
  into tests will fail; write `'$\u00A01.234'`.
- localStorage schema version is 1; extra keys from old backups (e.g. removed `goals`)
  are ignored, but don't bump the version casually or users lose data.
- `validateAppData` is the trust boundary for imports and (future) LLM output.
- React StrictMode is on; reducer initializer runs twice in dev (harmless).
- Dates are local-only ISO strings (`YYYY-MM-DD`); no timezone math.

## 10. Planned next feature

**Speech entry** (branch `speech-entry`, nothing committed yet). Full spec in
`skills/speech-entry.md`. Key architectural implication: this will be the app's
FIRST backend — a serverless LLM endpoint is required (API key must never reach the
client). Categories must be sent to the LLM from the user's current list; amounts
must map to integer COP centavos; review UI should reuse `TransactionForm`.
