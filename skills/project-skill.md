# Project Skill — $5 Budget App (COP)

> Read this file FIRST when starting a new session on this project. It captures the
> product, architecture, design system, and working conventions as of the latest state.
> Feature history/spec for smart entry: `skills/speech-entry.md` (implemented, revised).
> Architecture decisions + "-ilities" scorecard: `ARCHITECTURE.md` (update it whenever
> the app ships a meaningful change).

---

## 1. What this is

A **mobile-first personal budget web app** for a single user. Colombian Peso (COP).
Budget data is fully client-side and offline: it lives in the browser's `localStorage`
and (except for smart entry) never leaves the device.

- Repo: https://github.com/camichaves79/budget
- Live site: https://5budget.app/ (custom domain on Cloudflare Pages,
  auto-deployed from `main` — hosting migration A15, completed 2026-09-08;
  `budget-7ad.pages.dev` and the old GitHub Pages URL still resolve but are
  not the product URL. Migration plan + ops: `skills/hosting-migration.md`)
- Local dev: `npm run dev` → http://localhost:5173/
- **PWA install name: "$5 Budget"** (manifest + apple meta in `index.html`; icons
  mint `#60c784` + engraving-green banknote with a bold "$5" center in `public/`;
  source in `tools/icon.svg`).
- **API backend** (the app's only backend, since 2026-09-08): ONE Cloudflare
  Worker at `https://api.5budget.app` — `/api/parse` (Gemini proxy; free-tier
  resilience: transient 429/5xx retried with backoff, quota-blocked calls fall
  back to `gemini-3.5-flash-lite`, warm-instance response cache 1h) plus
  `/api/license/*` (redeem / lookup / check), `/api/webhooks/ls` and
  `/api/ledger/export`. Vercel is RETIRED (A15). Firebase Auth (Google) +
  Firestore hold identity, entitlement and the sales ledger (server-side REST
  writes, client never touches Firestore). Lemon Squeezy is the merchant of
  record. Ops checklist: `skills/paywall-ops.md`.
- **Google Play (Android, A18 — in progress on `play-billing-logic`, NOT yet
  shipped):** the PWA is packaged as a Bubblewrap Trusted Web Activity
  (`app.fivebudget`); Google is the Android merchant (Play Billing
  subscriptions) while Lemon Squeezy stays the web/iOS merchant. Play
  purchases mint the SAME HMAC license into the SAME ledger
  (`/api/license/redeem-play` + `/api/webhooks/play` + a `playTokens` map),
  and the accountant CSV gains a `source` column (ls|play).

## 2. Product scope & confirmed decisions

**In scope (v1):**
- **Cash Flow** tab: period summary (Income / Expenses / Balance), day-grouped
  transaction list (add / edit / delete), pinned header + internally scrolling list
- **Smart entry** (AI-assisted): the tab-bar coin "$" button (see below) opens a
  natural-language field; dictate
  via the native keyboard mic (NO SpeechRecognition API). **Submit** → parse
  microservice → **instant save + fading toast** when the parse is complete;
  ambiguous parses (no mappable category) fall back to the review form
  (`TransactionForm`); errors show as fading toasts and keep the text for retry.
  Manual entry stays one tap away ("Enter manually instead").
  **Multi-transaction (2026-09, approved):** one utterance may list several
  transactions — the LLM returns an array (one element each, capped at 20).
  Confident complete entries instant-save; entries under the confidence threshold
  (0.8) or without a category NEVER save silently — they queue through the review
  form pre-filled with the guess. After a batch, the sheet shows a "Recorded ✓"
  summary (rows + total + edit-anytime hint). Single-entry flow unchanged.
- **Budgets** tab: monthly limit per expense category, progress bars, over-budget
  highlighting, pinned period selector + summary, scrolling category lists
- **Categories** tab (2026-09 four-section redesign): category management
  (add / edit / delete) split out of Settings; bullet-list tab icon;
  pinned-header layout
- **Settings** tab: JSON export / import, two-step reset, budget period,
  **License** section (smart-entry status, sign in with Google,
  paste-key recovery fallback)
- **Smart-entry paywall (2026-09):** 10 free parses/day; beyond that, smart entry
  invites the user to buy a **$5/year** license through a Lemon Squeezy checkout
  overlay. After payment the app redeems the order id server-side for an
  HMAC-signed license, stores it automatically, and binds it to the signed-in
  account (restored on any device or reinstall). Server-side sales ledger +
  accountant CSV/JSON export. See `ARCHITECTURE.md` A12–A14 and
  `skills/paywall-ops.md`.
- COP currency, eleven-language UI (English default), single user,
  offline-first (except smart entry)

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
- The add button is a **coin-style "$"** (2026-09): a circular engraving-green
  button with a thin white rim + green outer ring and a bold Rajdhani `$`,
  centered on the tab bar (visible in all four sections), its horizontal
  diameter aligned with the bar's upper side so the top half floats above it;
  tapping it switches to Cash Flow and opens smart entry. A lightning overlay
  and the old bottom-right FAB were tried/removed; the "+" glyph itself was
  replaced on the user's coin direction.
- The parse button label is **"Submit"**, not "Parse" (user-friendly copy).
- **Certainty grading:** each parsed element carries a `confidence` grade (0–1,
  self-assessed). `needsReview` = no category **or** confidence <
  `REVIEW_CONFIDENCE_THRESHOLD` (**0.8**, user-chosen). Missing confidence counts as
  1 (behaves like before); malformed counts as 0 (always review).
- **Paywall (2026-09, approved):** price **$5/year**; free allowance 10 parses/day;
  Lemon Squeezy as MoR (5% + $0.50/txn); license HMAC-signed server-side, verified
  on every parse with a 100/day meter; Firebase Auth (Google sign-in only —
  Apple sign-in discarded 2026-09-06); licensed tier runs
  on a paid Gemini key with `gemini-3.5-flash-lite` primary + `gemini-3.6-flash`
  fallback. The Settings paste-key is a recovery fallback only, never the main
  path. Cost model + scale math live in `skills/paywall-ops.md`.

## 3. Tech stack & tooling

- Vite 8 (Rolldown-based) + React 19 + TypeScript 6, plain CSS (no framework)
- **Zero server-side npm dependencies** — Firebase access is a hand-rolled
  REST client (`api/_firebase.js`: service-account JWT → OAuth → Firestore REST
  + JWKS token verification). Vercel's zero-config tracing silently dropped
  `firebase-admin` from function bundles, and the REST client has nothing for
  the bundler to lose. Client dep: `firebase` (auth module only, modular
  imports) — the one deliberate dependency addition, justified by A13.
- No router, no UI library, no icon library (inline stroke SVGs)
- Lint: `oxlint` · Tests: hand-rolled smoke suite (`tests/smoke.ts`, 366 checks)
- npm scripts: `dev` · `build` (tsc -b && vite build) · `lint` · `preview` ·
  `test` (bundles tests/smoke.ts via `vite.test.config.ts` into `.smoke/` and runs it)
- **Local npm quirk:** the global npm cache in this environment has permission issues.
  Use `npm_config_cache="$PWD/.npm-cache" npm install ...` for installs (incl. any
  temporary tool like `sharp --no-save`; `npm uninstall --no-save sharp` after, and
  confirm `package-lock.json` stayed clean).
- `vite.config.ts` uses `base: './'` so the build works from the `/budget/` subpath on
  GitHub Pages. Vite rebases `/…` asset refs in `index.html` automatically.
- **No SVG→PNG rasterizer with emoji fonts is available here** (qlmanage fails,
  sharp/librsvg renders the 💰 emoji as a black box) — regular TEXT glyphs do
  render (fontconfig → DejaVu fallback). Icon source of truth:
  `tools/icon.svg` (mint rounded square + engraving-green banknote, two side
  dots + a centered "$5" sized half the bill's height — 2026-09 redesign) →
  `tools/render-icons.mjs` (sharp, install `--no-save` with the npm cache
  workaround).

## 4. Architecture & file map

```
src/
  lib/
    types.ts        # TxType, Transaction, Category, Budget, AppData
    money.ts        # formatCOP (integer pesos, NBSP), parseAmountToCents
    emoji.ts        # firstGrapheme: category emojis capped to ONE glyph cluster
    dates.ts        # toISODate, todayISO, isValidISODate, parseISODate, formatDate*
    periods.ts      # configurable start-day periods (1–28), majority-month labels
    storage.ts      # StorageAdapter interface + localStorageAdapter (schema v1)
    seed.ts         # defaultCategories() + PALETTE (category colors unused in UI)
    selectors.ts    # periodTransactions, totalsFor, spentByCategory, categoryById,
                    # activeCategories, isInPeriod
    importExport.ts # validateAppData, exportData (JSON backup download)
    parseService.ts # THE client service boundary: calls the parse microservice
                    # (VITE_PARSE_ENDPOINT + VITE_PARSE_SECRET, baked at build time),
                    # pure validateParsedTransaction + validateParsedTransactions
                    # (LLM-output trust boundary, array of 1–20 elements),
                    # needsReview (confidence < 0.8 or no category),
                    # one automatic retry (~2s) on transient busy/provider errors
                    # (licensed requests attach the stored license token)
    quota.ts       # free allowance: 10 parses/day counter (localStorage, resets
                    # at local midnight) — UX counter, NOT server security
    license.ts     # license token type + payload parse + expiry check (display/
                    # gating only; the server verifies the HMAC on every parse)
    licenseService.ts # /api/license/* calls: redeem(orderId), lookup(idToken),
                    # check(key); stores the license in localStorage
    auth.ts        # lazy Firebase Auth init (env-configured), Google redirect
                    # sign-in, getRedirectResult, idToken provider
    checkout.ts    # Lemon Squeezy overlay loader (lemonsqueezy.js) + fallback
                    # to top-level redirect; builds embed URL from VITE_CHECKOUT_URL
    installPrompt.ts # PWA install detection (install-app-signal): standalone/
                    # iOS sniffing, beforeinstallprompt capture, one-time
                    # localStorage dismissal, useInstallSignal hook
    playBuild.ts    # Play Store build detection (?src=play, idempotent) — A18
    playBilling.ts  # Digital Goods API purchase flow (TWA, Payment Request)
    welcome.ts      # first-open welcome decision core (storage flag + delay)
  state/store.tsx   # Context + useReducer, auto-saves to localStorage on every change
  state/entitlement.tsx # EntitlementProvider: license token, quota remaining,
                    # auth user; actions: recordParseUse, applyLicense,
                    # signIn/signOut/restore
  components/       # TabBar, Sheet (className prop + keyboard inset), ConfirmDialog,
                    # ProgressBar, AmountInput (floating-label variant), PeriodNav,
                    # EmptyState, TransactionForm (submitLabel prop),
                    # SmartEntry (smart input + instant save + review fallback +
                    # batch flow: instant-save confident items, queue the rest
                    # through review, then a "Recorded ✓" summary),
                    # PaywallCard (allowance-exhausted card: copy + LS checkout
                    # button + manual-entry pointer),
                    # FloatField (label-inside-box pattern), Toast (fading feedback),
                    # InstallBanner (one-time PWA install nudge: iOS share tip +
                    # Chromium install button), WelcomeModal (one-time first-open
                    # welcome: what the app is + the 3 essential first steps)
  pages/            # Dashboard.tsx (Cash Flow + smart sheet + toast), Budgets.tsx,
                    # Categories.tsx (category management), Settings.tsx
api/parse.js        # Vercel Function (route /api/parse): Gemini proxy. Plain JS with
                    # JSDoc (no build step; checked via tsconfig.node checkJs).
                    # Node-style handler(req, res) — Vercel does NOT use Web Request.
                    # Shared-secret header + origin allow-list + per-IP rate limit
                    # (40/10min) + Gemini retry/backoff + fallback model +
                    # warm-instance response cache (1h TTL).
                    # License path: optional signed license in the body → HMAC
                    # verify + 100/day per-license meter → paid-key model order
                    # (Lite primary, Flash fallback).
api/_license.js     # pure helpers shared by the functions: sign/verify license
                    # tokens (HMAC-SHA256), per-license daily meter, LS-fee math,
                    # order→ledger mapping, ledger→CSV builder, webhook signature
                    # verification (all smoke-tested)
api/license.js      # POST /api/license/redeem (order id + optional idToken →
                    # LS order verified paid → mint + sign license → Firestore
                    # entitlement/ledger → return token), /api/license/lookup
                    # (idToken → entitlement → re-signed token),
                    # /api/license/check (key → verify + payload)
api/webhooks/ls.js  # POST /api/webhooks/ls: verifies LS X-Signature (HMAC-SHA256
                    # of raw body), order_created/order_refunded → sales ledger
api/ledger/export.js # GET /api/ledger/export?format=csv|json (x-budget-admin
                    # header) — accountant export
api/_firebase.js    # zero-dependency Firebase REST client: FIREBASE_SERVICE_ACCOUNT
                    # (JSON) → RS256 JWT → OAuth token (cached) → Firestore REST
                    # (get/merge-set/list) + securetoken JWKS id-token verify +
                    # accounts:lookup (email → uid)
api/_play.js        # Play Developer API (OAuth + purchases.subscriptions get/
                    # acknowledge) + Pub/Sub push parse/classify + OIDC verify — A18
api/license/redeem-play.js # POST /api/license/redeem-play: Play purchase →
                    # verify → email-authorize → acknowledge → mint license
api/webhooks/play.js # POST /api/webhooks/play: Cloud Pub/Sub push (OIDC) →
                    # grant/loss/risk → extend/revoke the SAME license
tests/smoke.ts      # logic tests: money, periods, selectors, LLM validators,
                    # microservice helpers (rate limiter, sanitizer, Gemini array
                    # parser, retry policy, response cache), 237 checks
public/             # favicon.svg (mint + banknote + "$5"), manifest.webmanifest
                    # ("$5 Budget"), icon-192/512.png, apple-touch-icon.png,
                    # sw.js (network-first, no pre-cache, prod-only registration)
tools/              # icon.svg (icon source of truth) + og.svg (share-card
                    # source) + render-icons.mjs (sharp: icons + public/og.png)
.github/workflows/deploy.yml  # GitHub Pages on push to main; bakes VITE_* repo secrets
```

**Smart-entry flow:** tab-bar + (any section → Cash Flow) → SmartEntry textarea →
`parseUtterance(utterance,
categories)` → POST microservice → Gemini `gemini-3.6-flash` (free tier,
`thinkingLevel: 'low'` so hidden thoughts don't eat the output budget) → structured
JSON **array** (one element per transaction, each with a `confidence` grade) →
client-side `validateParsedTransactions` → confident complete elements
instant-`addTransaction` + success toast; doubtful/ambiguous elements queue through
the review form (never saved silently); batches end in a "Recorded ✓" summary.

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
  ISO date validation, **LLM-output validators** (`validateParsedTransaction`,
  `validateParsedTransactions`, `needsReview`), **microservice helpers** (rate
  limiter, request sanitizer, Gemini array parser, retry policy, response cache),
  **license/paywall logic** (token sign/verify/meter, free-allowance quota, LS fee
  math, order→ledger mapping, webhook signature, CSV export) plus the
  install-nudge decision core and the emoji grapheme cap. 366 checks.
- `npm run build` + `npm run lint` before shipping. Lint has 5 known harmless
  warnings (react-refresh export rules in `store.tsx`/`entitlement.tsx`/
  `AmountInput.tsx` and one set-state-in-effect in `App.tsx`).
- `api/parse.js` logic is tested via tests/smoke.ts imports; the handler itself can be
  smoke-tested locally by stubbing `fetch` and calling it with fake Node-style
  req/res objects (see session history pattern).
- No UI test framework installed.

## 8. Git & deploy workflow

- One feature branch per change, created from `main` (user picks the name; recent:
  `speech-entry`, `smart-entry-ux`, `ui-miscelaneous-0002…0007`, `ios-keyboard-fixes`,
  `floating-field-labels`, `select-chevron-fix`, `icon-color`, `parse-resilience`,
  `multi-transaction-entry`, `paid-key-fallback`, `four-sections`,
  `plus-sing-relocation`, `install-app-signal`, `budgets-no-categories-guard`,
  `category-emoji-field`, `default-emoji-moneybag`, `first-open-welcome`,
  `smart-submit-lock`, `i18n-german`, `og-share-preview`, `ledger-csv-invoice-fix`, `ledger-invoice-numeric-id`,
   `ui-miscelaneous-0013`…`0015`, `paywall-copy-about-5`, `paywall-copy-usd5`,
   `paywall-copy-usd-label`).
- **Only commit/push when the user explicitly says so.**
- **"ship"** = commit → push branch → fast-forward merge into `main` → push → delete
  branch locally and remotely → verify deploys. History stays linear (no merge commits).
- **Version ritual (2026-09):** every shipped change bumps the visible version.
  `v0.1.N` with N = the commit count of `main` **after** the merge
  (`git rev-list --count main`) — the version always equals main's commit
  count. Update ALL THREE version spots: `package.json` `version` (and the
  lockfile's), `src/lib/version.ts` (`APP_VERSION`), and the Settings →
  About line (`Budget v0.1.N`, driven by `APP_VERSION`). Ask the user to classify the change
  as **breaking / major / minor**; pre-1.0 everything rides the patch slot — a
  breaking or major change (storage schema, big rewrite) bumps minor/major
  instead.
- **Frontend deploy (Cloudflare Pages):** git-connected project `budget` (build
  `npm run build`, output `dist`, `NODE_VERSION=22`), custom domain
  `5budget.app`. The `VITE_*` vars live in Cloudflare Pages → Settings →
  Environment variables (Production + Preview; both endpoints point at
  `https://api.5budget.app`). Verify with
  `curl -s -o /dev/null -w "%{http_code}" https://5budget.app/` and the
  Deployments tab. Saving env vars redeploys automatically; otherwise push a
  trivial commit (docs touch). The GitHub Pages workflow was retired
  (`5a8033c`); repo secrets `VITE_*` are unused (prune any time).
- **API deploy (Cloudflare Worker):** one worker `budget-api` (`worker.js` +
  `wrangler.toml`, `nodejs_compat`) served at `api.5budget.app` (dashboard
  custom-domain route) with **Smart Placement** enabled (near Gemini — the
  latency fix). GitHub Actions `.github/workflows/deploy-worker.yml` runs
  `cloudflare/wrangler-action@v3` on push to `main` (secrets
  `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`). The 11 server vars are
  **Secret-type variables on the Worker** (Settings → Variables and Secrets)
  — they survive `wrangler deploy`. Vercel is RETIRED (A15). The `/api`
  handlers stay dependency-free Node-style `handler(req, res)` code, bridged
  by `worker.js` — Vercel's zero-config tracing originally forced the
  hand-rolled REST client in `api/_firebase.js`, and the same
  dependency-free rule now keeps the Worker bundle trivial. Function URLs:
  `https://api.5budget.app/api/parse` + `/api/license/*`, `/api/webhooks/ls`,
  `/api/ledger/export`.
- Local `.env` (gitignored) holds `VITE_PARSE_ENDPOINT` + `VITE_PARSE_SECRET` for dev;
  pattern in `.env.example`. New client vars: `VITE_API_BASE` (license endpoints),
  `VITE_FIREBASE_API_KEY` / `VITE_FIREBASE_AUTH_DOMAIN` /
  `VITE_FIREBASE_PROJECT_ID` / `VITE_FIREBASE_APP_ID`, `VITE_CHECKOUT_URL`
  (LS buy link). Same names in the Cloudflare Pages env vars for the build.
  Play (Android, A18): `VITE_PLAY_SUBSCRIPTION_ID` (client, build-time); server
  Secret vars `GOOGLE_PLAY_SERVICE_ACCOUNT` / `GOOGLE_PLAY_PACKAGE_NAME` /
  `GOOGLE_PLAY_SUBSCRIPTION_ID` / `GOOGLE_PLAY_PUBSUB_AUDIENCE` (optional) /
  `GOOGLE_PLAY_PUBSUB_EMAIL` (optional) — the Worker now carries 16 Secret
  vars (was 11).
- Local Worker dev: `npx wrangler dev --port 8787` reads `.dev.vars`
  (gitignored; same 11 names, dummy values fine for guard-path testing).
  Wrangler is installed `--no-save` — check `package-lock.json` stays clean.

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
- **Cloudflare Workers gotchas (all diagnosed live, 2026-09-08):**
  - workerd's `nodejs_compat` does NOT implement `node:crypto` `createSign` /
    `createVerify` (asymmetric RSA) — `[unenv] crypto.createSign is not
    implemented yet!` in the logs. `api/_firebase.js` signs the Firebase OAuth
    JWT with WebCrypto `crypto.subtle` (`signJwt` is async; PEM→DER via
    `pemToDer`). Keep new server crypto on WebCrypto.
  - Worker env **bindings are non-enumerable getters**: `Object.assign(process.env,
    env)` copies NOTHING in production (local `wrangler dev` passes a plain
    object, so it only works there). `worker.js` hydrates `process.env` by an
    explicit key list (`hydrateEnv`, ENV_KEYS).
  - The Workers Variables page keeps edits as a **draft** until you click the
    Deploy button/banner — "saved but not deployed" looks like a missing var.
  - The dashboard **Quick Edit** diverges the deployed script from the repo;
    the next `wrangler deploy` (any push to `main`) overwrites it — keep
    prod-only tweaks in the repo instead.
  - `firebase: token endpoint 400` = the Worker's `FIREBASE_SERVICE_ACCOUNT`
    private key doesn't match an ACTIVE Firebase key (old/revoked/mangled
    paste). Fix: generate a fresh key, minify (`python3 -c "import json;print(json.dumps(json.load(open(PATH))))"`),
    re-paste as a Secret. A good key parses with `private_key length` ≈ 1704.
- **Vercel is retired (A15)** — the Node-style `handler(req, res)` contract now
  lives behind `worker.js`'s Web-Request shim; handlers stay unmodified.
- **Gemini**: model string must be current for NEW accounts (2.5-flash is retired for
  them; now `gemini-3.6-flash`). Gemini 3.x thinks by default and hidden thoughts
  consume `maxOutputTokens` — keep `thinkingConfig: { thinkingLevel: 'low' }` or the
  JSON gets truncated mid-object. Google's error messages name the replacement model.
- **Gemini free tier is shared and 429s are common**: the function retries
  transient failures (honoring `RetryInfo.retryDelay` when ≤5s), then tries the
  fallback model; the app auto-retries once (~2s, label "Retrying…") and
  re-submitting the same text hits the warm-instance cache. Response codes:
  `provider-busy` (503) = Gemini quota/transient; `rate-limited` (429) = the
  function's own per-IP limiter (40/10min). Logs carry model/status/`retryDelay`
  metadata only. RPD resets at midnight Pacific.
- Dates are local-only ISO strings (`YYYY-MM-DD`); no timezone math.
- **Service worker (install-app-signal):** registered ONLY in prod builds
  (`import.meta.env.PROD` in `main.tsx`) — local dev is unaffected.
  Network-first with NO pre-cache: a new deploy is picked up on the next
  load, so a stale shell never outlives a ship. Same-origin GETs only; the
  API/Firebase/LS traffic (other origins) passes through untouched.
- **Category emojis are ONE glyph cluster** (`firstGrapheme` in
  `src/lib/emoji.ts`, `Intl.Segmenter`): ZWJ families (👨‍👩‍👧) count as one;
  every rendering surface is a small circle sized for a single glyph.
- Installing sharp or other temp tools: use the `npm_config_cache` workaround,
  `--no-save`, and check `package-lock.json` is untouched afterwards.
- **Lemon Squeezy**: link variables use square brackets (`[order_id]`,
  `[license_key]` — not `{…}`); orders are fetched by NUMERIC id (`order_number`
  is separate); the checkout overlay script is `app.lemonsqueezy.com/js/lemon.js`
  with `LemonSqueezy.Url.Open(url)` (no `Checkout.Open`); the overlay has a known
  Safari 404 issue → the app falls back to a tab/redirect. Sub-$10 products may
  need LS "custom pricing" support; payouts have a $50 minimum and a 13-day hold.
- **Firebase**: `signInWithRedirect` is broken on shared-hosting domains by
  third-party-storage blocking (Safari 16.1+/Chrome 115+) → the app is
  popup-first with redirect fallback; on the custom domain (`5budget.app`)
  redirect auth works normally. **Local dev:** a build without the
  `VITE_FIREBASE_*` vars in `.env` renders the sign-in button DISABLED
  (`authConfigured()` false — by design, not a bug); set the four public
  web-app config values (apiKey must match `AIza…`) to enable it.
  Server-side, never rely on Vercel
  zero-config tracing for npm packages in `/api` functions: it silently
  dropped `firebase-admin` from the bundles (diagnosed via a temp endpoint
  showing "Cannot find package … imported from /var/task/api/"). The repo's
  rule: **server functions stay dependency-free**.
- **License tokens are bearer tokens** verified server-side on every parse
  (100/day meter); client-side checks are display-only. Firestore is admin-SDK
  only (rules deny all client access). The free-allowance counter is cosmetic —
  resetting localStorage resets it (A12).
- The user approves UI/behavior changes **after** testing in prod — ship on request,
  expect "I'll approve" flow; keep deploys verified and report bundle/branch state.

## 10. Current state & next-session context

**IN PROGRESS — Play Store + Play Billing (A18, branch `play-billing-logic`,
NOT yet shipped, NOT yet committed):** the full Play Billing integration is
implemented across four phases on one branch. (1) Pure logic + tests:
`estimatePlayFeeCents` (15%) / `playPurchaseToLedger` / a `source` CSV column
+ default in `api/_license.js`, RTDN parse/classify in `api/_play.js`,
`?src=play` detection in `src/lib/playBuild.ts`. (2) Client: Digital Goods
purchase (`src/lib/playBilling.ts`), `playBuild` + `buyPlay` in
`entitlement.tsx`, `redeemPlay` in `licenseService.ts`, Play branches in
`PaywallCard`/`LicenseSection`, 3 new i18n keys ×11 languages, client var
`VITE_PLAY_SUBSCRIPTION_ID`. (3) Server: Play Developer API client
(`api/_play.js`), `ensureLicenseForPlayPurchase` + `playTokens` map
(`api/_licenseops.js`), `POST /api/license/redeem-play`, worker route + 5
`GOOGLE_PLAY_*` env keys. (4) Webhook: Pub/Sub OIDC verify + message parse
(`api/_play.js`), `POST /api/webhooks/play` (grant→extend / loss→revoke /
risk→note). Suite now 426 checks; lint 5 warnings / 0 errors. Remaining:
Play Console setup + Bubblewrap keystore/update/validate/build/AAB + on-device
approval, then the ship ritual (version bump + docs header hash). One branch
per the user's "one branch for this feature" — no separate docs branch.

Everything below is **shipped and live** (main ≈ `2e31abf`, v0.1.126,
2026-09-09):

- Smart entry end-to-end: PWA → Vercel microservice → Gemini 3.6 Flash → instant save
  with fading toasts; review form only for ambiguous parses. Full spec (revised):
  `skills/speech-entry.md`.
- iOS keyboard/zoom fixes, floating labels + tight form rhythm, single SVG select
  chevron, "$5 Budget" PWA manifest + mint icons — all approved by the user.
- Configurable budget period start day (Settings → Budget period, 1–28) with
  majority-month period labels — approved by the user.
- Parse-service resilience: Gemini retry/backoff, `gemini-3.5-flash-lite` quota
  fallback (verified available on the user's AI Studio account), warm-instance
  response cache, per-IP limiter 40/10min, `provider-busy` diagnostics, one
  automatic client retry ("Retrying…") — approved by the user.
- Multi-transaction smart entry: one utterance → an array of transactions;
  confident entries instant-save, doubtful (< 0.8) or ambiguous ones queue through
  pre-filled review, batches end in a "Recorded ✓" summary — approved by the user.
- **Smart-entry paywall — APPROVED by the user (2026-09-06):** 10 free parses/day
  → paywall card → **Google sign-in required to buy** (every license
  account-bound; server rejects unsigned redeems with `sign-in-required`) →
  $5/year Lemon Squeezy checkout overlay → redirect-back auto-redeem → HMAC
  license (server-verified per parse, 100/day meter) → Firebase Auth +
  Firestore binding/restore → sales ledger + accountant CSV/JSON export →
  licensed tier runs Lite→Flash on a paid Gemini key. ADRs A11–A14 in
  `ARCHITECTURE.md`; ops in `skills/paywall-ops.md`; tax evidence in `TAX.md`.
  The two bugs found during validation, both fixed and shipped:
  (1) `FIREBASE_SERVICE_ACCOUNT` had a mangled `private_key` (flattened
  newlines) → RSA sign threw → redeem 500; fixed by re-pasting + redeploy.
  (2) `GEMINI_PAID_API_KEY` was rejected 400 by Gemini (invalid key/project),
  which bricked licensed parses → `98d0757` added the paid-key→free-key
  fallback on config errors (A14 safety floor).
- **Redemption email-authorization (`redeem-email-check`, 2026-09):** redeem
  and the paste-key check now require the signed-in Google email to match the
  LS buyer email (409 `email-mismatch` otherwise) — numeric order ids are
  enumerable, so sign-in alone was not authorization; the license endpoints
  also got per-IP rate limits (30/10min). Buyers must use their Google email
  at checkout.
- **Four-section redesign (`5700d69`, user-approved):** Categories split out of
  Settings into its own tab — Cash Flow · Budgets · Categories · Settings;
  Categories gets the bullet-list icon + pinned layout; Settings keeps Data,
  Budget period, License, About.
- **Global + in the tab bar (`b5094b5`, user-approved):** the add button is a
  circular "+" centered on the tab bar (visible in all four sections), its
  horizontal diameter aligned with the bar's upper side; tapping it switches
  to Cash Flow and opens smart entry. Old bottom-right FAB removed.
- **Icon redesign (`ui-miscelaneous-0008`, `f8b842e`):** the dark center ring
  was replaced by a bold "$5" sized half the bill's height and centered; the
  two side dots were preserved at their original positions. Icon source of
  truth now `tools/icon.svg` + `tools/render-icons.mjs`.

**RESOLVED (2026-09-06):** the Firebase console initially showed NO
collections because every Firestore merge-set was rejected — `updateMask`
was nested inside `update` in the commit REST body instead of sitting beside
it as a field of the Write (`INVALID_ARGUMENT … Unknown name "updateMask"`
in Vercel logs). Restore still worked because `/api/license/lookup`
self-heals from the Lemon Squeezy orders API. Fixed on
`firestore-commit-shape` (`9068739`, with a body-capturing smoke
regression) and **verified in prod**: all three collections (`sales`,
`licenses`, `entitlements`) are populated for both test orders and the
accountant CSV has the rows.

**NEW since 2026-09-06 (all shipped, user-tested where noted):**
- **Ledger-by-construction (`7f5e995`):** `ensureLicenseForOrder` now writes
  the COMPLETE sales-ledger row (money columns from the LS order attributes)
  on every mint/restore path, backfills rows that only had
  `license_id`/`redeemed_at`, and never downgrades a recorded refund or the
  generated invoice/receipt URLs (`saleRowForMerge`). Smoke suite now 282
  checks. The console-clearing prod walkthrough stayed parked; the code is
  live on the Worker.
- **Two discards recorded (`6b693ad`):** Apple sign-in DISCARDED and the BYOK
  stash dropped (A11/A12 docs).
- **Cloudflare migration A15 — COMPLETE and user-verified (2026-09-08):**
  frontend on **`https://5budget.app/`** (Cloudflare Pages, custom domain,
  `VITE_*` + `NODE_VERSION=22` env vars); the six API functions on ONE Worker
  at **`https://api.5budget.app`** (dashboard route + Smart Placement near
  Gemini — the latency fix); Vercel and GitHub Pages fully retired. Fixed
  along the way, all verified in prod: non-enumerable env bindings
  (`hydrateEnv`, `f831b92`), `5budget.app` origin allow-lists (`066b75e`),
  workerd's missing `createSign` → WebCrypto `signJwt` (`4658257`), and a
  fresh Firebase service-account key (the old one was orphaned → `firebase:
  token endpoint 400`). License sign-in/restore + licensed parses + the
  accountant CSV all verified from the phone against prod.
- **User-side dashboard state to remember:** the 11 Worker variables are
  Secret-type on `budget-api`; `BUDGET_LICENSE_SECRET` was REGENERATED
  (2026-09-07) — old tokens invalidate, restore re-mints; `BUDGET_ADMIN_SECRET`
  is a fresh user-recorded value; `GEMINI_PAID_API_KEY` was re-pasted and
  should be re-verified against a licensed parse.

**UI polish batch — shipped and APPROVED on the iPhone (2026-09-08, main ≈ `c4afbe3`):**
- **Cash Flow summary (`8bc7c03`):** ONE shared white card around Income /
  Expenses / Balance (the three per-value boxes read as input fields);
  distribution unchanged. Negative balance renders in terracotta
  (`--terracotta`), the palette's reddish "over" accent.
- **Coin-style add button (`4d020ed`, `d3cd63e`):** the tab-bar button is now
  a bold Rajdhani `$` (white) on the engraving-green disc with a thin white
  rim and a thin green outer ring; still opens smart entry on Cash Flow,
  aria-label unchanged.
- **Smart-entry sheet copy (`6a851c7`, `8d43c4d`):** title **"Tell me what
  the transaction is:"**, "What happened?" label removed (aria-label kept),
  placeholder **"Use your keyboard's microphone 🎤"**, the "Type, or use…"
  hint and the "Your text is sent…" disclosure removed.
- **Amount echo hidden (`8d43c4d`):** `amountHint` no longer shows the
  under-box `= $ 1.234` replica — hints appear only for problems.
- **Toasts centered (`8d43c4d`):** `translateX(-50%)` lives on the element;
  the hold phase no longer drifts right.
- **Empty Cash Flow state (`8d43c4d`):** "Tap **$** to record income or an
  expense." with the `$` bold and one size larger.
- **Settings copy trimmed (`c4afbe3`):** Data / Budget period / About /
  Smart-entry rows summarized; safety confirmations and the paywall-ops
  error-map strings kept as-is.
- **No seeded categories (`no-seeded-categories`, iPhone-approved):** new installs start with
  zero categories and land on the Categories tab; the Categories page shows
  an empty-state sign ("Start by adding some categories…"); smart entry shows
  a friendly add-categories-first guard when none exist.
- **Icon tweak (`ui-miscelaneous-0011`):** the banknote's rectangle
  border on the app icon is now white (dots + $5 stay engraving green); PNGs
  and favicon re-rendered from `tools/icon.svg`.
- **Version ritual (`c4afbe3`):** every ship bumps `v0.1.N` (N = main's
  commit count) with a breaking/major/minor classification — `v0.1.94`,
  classified **Minor**. See §8.

**Localization (2026-09, four ships, iPhone-approved):** eleven UI languages
behind `src/lib/i18n.ts` — `i18n-core` (`32350a9`, en/es/fr/pt, v0.1.96
major), `i18n-review-fixes` (`b79b62e`, 22 wording corrections, v0.1.97
minor), `i18n-scripts` (`ebce377`, zh/hi/bn/ru/ur/ar + RTL, v0.1.98 major),
`i18n-german` (`51b902b`, de, v0.1.113 major).
First-run auto-detect + Settings → Language picker (localStorage
`budget.language`); locale money (`formatMoney`), dates, period labels;
localized seeded categories for NEW installs only; RTL layout for ar/ur
(logical CSS properties); the parse request carries a whitelisted `language`
hint (`api/parse.js`). Two independent translation reviews applied (42 fixes
total); catalogs model-authored.

**PWA install nudge (`install-app-signal`, `0db4679`, v0.1.103 minor,
iPhone-approved):** one-time install banner (fixed under the status area,
4s delay, dismiss ✕) — iOS Safari gets a Share → "Add to Home Screen" tip
(`install.iosTip` in all eleven catalogs) and Chromium gets an Install button
wired to a captured `beforeinstallprompt`; never shows inside the
installed app (`navigator.standalone` + `display-mode: standalone`) or
after dismissal (localStorage `budget.installTipDismissed`). Shipped with
a minimal network-first service worker (`public/sw.js`, no pre-cache,
prod-only) that unlocks Chromium installability + offline reloads of
visited pages (A17). Pure decision logic in `src/lib/installPrompt.ts`,
smoke-tested (suite now 353 checks).

**UX batch (`ui-miscelaneous-0012` + follow-ups, v0.1.105–v0.1.108 minor,
iPhone-approved 2026-09-08):**
- **Voice auto-send (v0.1.105):** the smart-entry textarea auto-submits
  2.5s after the last input event (dictation or typing goes quiet) — a
  "Sending in 2s…/1s…" countdown with a Cancel link shows while waiting;
  any edit resets it, transitions cancel it, and it never re-arms for the
  same text after a failed parse. Minimum utterance length **3 chars**
  gates both auto-send and the Submit button (accidental short entries).
  Constants `AUTO_SEND_PAUSE_MS` / `MIN_SEND_LENGTH` in `SmartEntry.tsx`
  (see `skills/speech-entry.md` §16).
- **Categories guard (v0.1.105):** the smart-entry "no categories" guard's
  button now closes the sheet and switches to the Categories tab
  (`cats.goToCategories`).
- **Bolder icon border (v0.1.105):** banknote stroke 11 → 18 on the 512
  canvas (favicon 2.2 → 3.5); all four public icons re-rendered.
- **Settings select chevron (v0.1.105):** the legacy two-triangle chevron
  collided with the day text; now the single SVG chevron at 10px with
  32px end padding (RTL mirrored).
- **Budgets guard (v0.1.106):** rewritten copy — "No categories to budget
  yet" + a hint that budgets apply to expense categories while income is
  tracked in Cash Flow — plus the same Go-to-Categories action.
- **Category emoji field (v0.1.107):** compact 64px one-glyph box capped
  to the first grapheme cluster (`src/lib/emoji.ts`, 6 smoke checks).
- **Default emoji (v0.1.108):** new categories pre-fill with 💰.

**First-open welcome (`first-open-welcome`, `bd9e324`, v0.1.110 minor,
iPhone-approved 2026-09-08):** a one-time welcome modal 500ms after first
open — "Welcome to $5 Budget", one sentence on what the app is for, and
the three essential first moves (add categories → tap $ to record → set
monthly budgets). Deep-mint card (`--accent` #2d6a4f) with white text
(AA contrast), white inverted "Get started" CTA, white coin badge; any
dismissal path (button / backdrop / Escape) marks it seen
(localStorage `budget.welcomeSeen`); all eleven languages + RTL; decision
core in `src/lib/welcome.ts`, smoke-tested (suite now 353 checks).

**Smart-entry submit lock (`smart-submit-lock`, `6af5573`, v0.1.112 minor,
iPhone-approved 2026-09-08):** while a parse is in flight, the smart-entry
textarea and the "Enter manually instead" switch are disabled (the field
fades to 55%) — mid-parse edits can no longer be lost by the closing sheet
or mismatch a failed parse. A failed parse refocuses the textarea with the
text kept for retry (keyboard returns). CSS: `.input:disabled`.

**German locale (`i18n-german`, `51b902b`, v0.1.113 major, iPhone-approved
2026-09-08):** the eleventh catalog — full 215 keys in informal "du" tone,
one/other plurals ("1/3 Transaktionen"), suffix money ("123.456 $"),
ordinals ("1.", "2."); `de` added to the parse language-hint whitelist
(`api/parse.js`); first-run auto-detect + picker pick it up automatically.
Suite now 353 checks.

**Open Graph share previews (`og-share-preview`, `78bb1df`, v0.1.114 minor,
iPhone-approved 2026-09-08):** a 1200×630 deep-mint share card
(`public/og.png`, source `tools/og.svg`, rendered by `render-icons.mjs`)
plus `og:*` + `twitter:*` tags in `index.html` with the ABSOLUTE image URL
`https://5budget.app/og.png` — WhatsApp/Telegram/iMessage/LinkedIn previews
show the card, "$5 Budget" title and a friendly description. Note:
WhatsApp caches previews per URL; the Facebook Sharing Debugger can force a
re-scrape.

Candidate next steps (ask the user, don't assume):
- **LS STORE APPROVED + FIRST LIVE SALE VERIFIED (2026-09-09):** the whole
  post-approval chain is proven end-to-end — live checkout → phone redeem
  ("License active ✓") → Firestore (sales/licenses/entitlements, the
  paywall-ops §6 non-negotiable check) → LS webhook 200 → accountant CSV;
  `GEMINI_PAID_API_KEY` verified against licensed parses (local mint +
  prod parse with zero `paid key rejected` log lines). The live product:
  **"$5 Budget — Smart Entry (1 year)"** — **US$5.00/year SUBSCRIPTION**
  (auto-renew, re-priced by the user on 2026-09-09; the COP 17,500 price
  was interim), license keys enabled with unlimited activations, checkout
  UUID `37a51134-…` (old: `3ea610ea-…`); `VITE_CHECKOUT_URL` updated in
  Pages (Production) + local `.env`. The Worker holds **LIVE LS
  credentials**: API key, a fresh webhook signing secret (the 401s came
  from a test-side secret), and store id `468123` — LS splits test/live
  keys, webhooks AND products per side; a test-mode toggle on a live
  product does NOT produce a test order. First sale: order `9426883`
  (order_number `4681231`, license `03ec4a76-…`, renews 2027-09-09; it
  predates the USD re-price). Firestore holds this one clean real row; the
  test-side webhook and test API key are deleted/revoked (housekeeping
  done). The store currency is COP — USD product prices convert at payout.
- **Ledger fixes (v0.1.117 + v0.1.122, minor):** the accountant CSV's
  `fees_estimate`/`net_estimate` columns rendered EMPTY since ship (doc
  keys were `fees`/`net`) — now canonical + legacy fallback; the +$0.50
  fee baseline converts via the order's `currency_rate` for non-USD
  orders; webhook/redeem merges route through `saleRowForMerge` so they
  can no longer null out a stored `invoice_url`; and `generate-invoice`
  takes the NUMERIC LS order id (the identifier UUID answers 404 — the
  root cause of the missing invoice link). One `order_created` resend
  healed the live row: every CSV column is now populated (fees/net,
  receipt_url, invoice_url). Suite now 366 checks.
- **UI guard batch, iPhone-approved (2026-09-09, v0.1.119–0.1.121):** the
  smart-entry sheet drops its title in the no-categories guard state, and
  the smart-entry + Budgets guard buttons ARE the add-category action —
  they land on Categories with the add-category form already open.
- **Paywall copy final (2026-09-09, v0.1.123–0.1.125):** every catalog
  states the exact price with currency — "Unlock · $5 USD/year" (en),
  "· 5 USD/año" (es), each language's idiomatic form. The "About $5"
  wording was tried and reverted by the user.
- **Parked:** Preview env vars on Pages (only NODE_VERSION there — harmless,
  branch previews unused); any translation nits found while using the app.
- Always read `skills/speech-entry.md` for the feature spec and this file for
  conventions before coding.
