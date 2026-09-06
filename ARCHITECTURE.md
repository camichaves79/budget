# Architecture — $5 Budget App

> **Living record** — updated whenever the app ships a meaningful change.
> Last updated: **2026-09-06** (main ≈ `9068739`; smart-entry paywall
> **user-approved and verified end-to-end** — Firestore collections +
> accountant ledger populated; paid-key→free-key fallback shipped;
> four-section tab bar with the + add button in the bar).
> Read alongside `skills/project-skill.md` (conventions + current state) and
> `skills/speech-entry.md` (smart-entry spec). Keep this file honest: if a
> trade-off changes, update the table, not just the date.

## 1. System context (today)

```
iPhone PWA ──HTTPS──▶ GitHub Pages (static, CDN)                    [free]
   │  smart entry text + categories (+ signed license when licensed)
   ├───────────────▶ Vercel Functions                                [Hobby, free]
   │                    /api/parse          Gemini proxy (licensed path: paid key,
   │                                        Lite→Flash; free path: A6 resilience)
   │                    /api/license/*      redeem / lookup / check (HMAC licenses)
   │                    /api/webhooks/ls    Lemon Squeezy webhooks → sales ledger
   │                    /api/ledger/export  accountant CSV/JSON
   ├───────────────▶ Firebase Auth (Google now, Apple later)         [Spark, free]
   │                    + Firestore (entitlements + sales ledger; REST writes
   │                    via service-account OAuth, client never touches Firestore)
   └───────────────▶ Lemon Squeezy checkout overlay (Merchant of Record)
                        orders API verifies purchases; webhooks feed the ledger
```

- **Client:** React 19 + TS 6 + Vite 8 PWA, `base: './'`, no router/UI/framework.
  All budget data lives in `localStorage` behind a `StorageAdapter` interface.
- **Backend:** a small set of Vercel Functions (`api/parse.js` + the license/ledger
  endpoints above, Node-style handlers). No database of our own: Firestore holds
  entitlement + sales-ledger documents only (identity/entitlement/purchase
  metadata — budget data still never reaches the cloud, see A1/A13). Firebase
  access is a zero-dependency REST client (service-account JWT → OAuth →
  Firestore REST + JWKS token verification): Vercel's zero-config tracing
  silently dropped the firebase-admin package from function bundles, and the
  hand-rolled client has nothing for the bundler to lose.
- **AI:** free tier — Gemini `gemini-3.6-flash` primary + `gemini-3.5-flash-lite`
  fallback (A6); licensed tier — paid key, Lite primary + Flash fallback (A14).
  Structured JSON **array** out (1 element per transaction, cap 20, each with a
  0–1 `confidence` grade).
- **Cost today: $0** — GitHub Pages free, Vercel Hobby (1M function invocations/mo,
  300s max duration), Gemini free tier, Firebase Spark. The license sale is the
  app's first revenue (A12).

## 2. Decision records

| ID | Decision | Why | Status |
|---|---|---|---|
| A1 | Client-first storage: budget data in `localStorage` behind an adapter (schema v1) | Privacy (data never leaves device), zero backend cost, works offline; adapter anticipates SQLite later | Accepted |
| A2 | No accounts, no auth, single user | Scope; the phone IS the identity | Superseded by A13 — identity exists only for license binding; free use stays account-less |
| A3 | AI parsing behind a serverless proxy (`/api/parse`); LLM key never reaches the client | Credential safety; provider swap stays server-side | Accepted |
| A4 | LLM output is **untrusted external data**: the client re-validates every element (`validateParsedTransactions`); one bad element rejects the whole parse | Never save silently; never drop a transaction silently | Accepted |
| A5 | Instant save + confidence-graded review: entries below 0.8 or without a category go to a pre-filled review form; batches end in a "Recorded ✓" summary | User chose speed with a safety gate; approval happens by testing in prod | Accepted |
| A6 | Engineer resilience into the free tier rather than paying: retry/backoff (honoring `RetryInfo`), fallback model with its own quota, warm-instance response cache, 40/10min per-IP limiter | $0 today; availability bounded by free quotas, mitigations raise the ceiling | Accepted |
| A7 | One utterance → one JSON **array** (multi-transaction entry), cap 20, per-element dates/notes/confidence | "300 in bread, 2000 bus home…" must record each transaction properly | Accepted |
| A8 | Plain stack: no router, no UI library, no icon library, plain CSS design system, hand-rolled smoke suite (~157 checks) | Small surface, no dependency drift, fast builds | Accepted |
| A9 | Linear git history, feature branch per change, ff-merge to `main`, rollback = a revert commit; Pages Actions + Vercel Git integration auto-deploy | Deterministic, reviewable, instantly reversible | Accepted |
| A10 | Shared-secret header + origin allow-list + input whitelisting on the function | Cheap defense layers; acknowledged as obfuscation, not auth (see §4) | Accepted |
| A11 | Rejected: bring-your-own-key (BYOK) and the fixed 50-user capacity plans | BYOK was built then abandoned (stash parked); quota-cap option reverted; the paywall (A12) is the chosen monetization path | Rejected → superseded by A12 |
| A12 | Smart-entry paywall: 10 free parses/day (client-side counter, UX not security), then a **$5/year** license sold through Lemon Squeezy (MoR, 5% + $0.50/txn) with an in-app checkout overlay; the post-purchase redirect carries the order id and the app auto-redeems it server-side into an **HMAC-signed license** (verified on every parse, 100/day meter); **buying always requires Google sign-in — every license is account-bound at mint time**; a Settings paste-key is a recovery fallback only | Price chosen for brand fit + positive expected earnings at 50+ users (~40–70% ROI, break-even ~10–12 payers); license minting stays server-side so keys can't be forged client-side; mandatory sign-in makes restore airtight and kills the unsigned-buyer edge cases | Accepted |
| A13 | Identity for license binding: **Firebase Auth** (Google sign-in now; Apple deferred — $99/yr developer account, config-only later) + **Firestore** for entitlements and the sales ledger, written via a zero-dependency REST client (service-account JWT → Firestore REST; the client never touches Firestore) | Firebase over Supabase: $0 Spark tier with no project-pause risk and the same Google account as Gemini; cloud holds identity/entitlement/purchase metadata only — budget data stays on-device | Accepted |
| A14 | Licensed tier runs on a **paid Gemini key** with `gemini-3.5-flash-lite` primary and `gemini-3.6-flash` fallback (inverted from the free tier), and a cache-friendly system prompt ready for context-caching savings. **Safety floor (2026-09-06):** when the paid key is rejected with a config-type error (400/401/403/404 — invalid key, permissions, billing, unknown model), the parse retries with the free key so a broken paid key never bricks licensed parses; quota/transient failures stay on the paid key | Free-tier quotas can't back a paid product; Lite ≈25% cheaper per parse and is already the proven fallback; paid tier also opts out of training use; the fallback keeps paying users working through key-rotation/billing mishaps (validated in prod) | Accepted |

## 3. The "-ilities" — where we stand

| Quality attribute | Standing (n = 1 user) | Evidence / limit |
|---|---|---|
| **Resilience** | Good | Server retries transient 429/5xx; fallback model doubles effective quota; instance cache makes retries instant; client auto-retries once. Limit: free-tier RPD exhaustion degrades smart entry until midnight PT; **manual entry always works, offline** — the app never hard-fails. |
| **Availability** | No SLA, graceful degradation | Depends on free services (Pages, Vercel, Gemini, Firebase, Lemon Squeezy). Worst case the app remains fully usable minus smart entry; a locally stored license keeps working offline and signed-out. |
| **Scalability** | Ready to grow, not yet proven | Static frontend scales via CDN for free. The license flow assumes ≤ hundreds of payers: Firestore Spark ceilings are far away; the shared client secret (A10) and the client-side free allowance must be replaced by identity-gated quota around 10k+ installs (see §5). |
| **Security** | Thin but layered | Origin allow-list, secret header, request whitelisting, rate limiting, LLM-output validation. Licenses are HMAC bearer tokens verified server-side on every parse (100/day meter); new endpoints keep the A10 posture; Firestore is admin-SDK-only. The parse secret is baked into the static bundle — readable by any client: **obfuscation, not authentication**. |
| **Privacy** | Strong | Transaction history never leaves the device; only utterance + category list are sent; logs carry metadata only (status/model/retryDelay). The cloud now stores identity, entitlement and purchase metadata (A13) — budget data still never leaves the device. Free-tier Gemini data-use caveat remains; the licensed tier uses a paid key (the opt-out). |
| **Maintainability** | Good | ~2k LOC app + one 600-line function; pure logic modules; docs in `skills/`; conventions in `project-skill.md`. |
| **Observability** | Weakest link | Vercel logs are metadata-only and ad-hoc; no metrics, no alerting, no error budget. The sales ledger + per-license usage meters improve visibility; diagnosis still = user report + log grep. |
| **Testability** | Solid for logic, thin for UI | 220 smoke checks cover money/periods/validators/microservice helpers/license+paywall logic (incl. the paid-key fallback); no UI test framework; handler smoke-testable via fetch stubbing. |
| **Cost efficiency** | $5/yr license, ~40–70% ROI | Infra stays free at current scale; operating cost is almost entirely Gemini usage. The free tier's cross-subsidy is the scale risk (A12, §5) — free users' Gemini ≈ $0.14/user/yr vs $4.25 net per payer. |
| **Portability** | Medium | Provider swap is one function + one client module; storage adapter swappable; backend pinned to Vercel's Node handler signature (`handler(req, res)`). |

## 4. Known limits & single points of failure

1. **Free-tier quota exhaustion** (Gemini RPM/TPM/RPD, shared capacity): smart entry
   degrades to "busy" — mitigated, not eliminated. RPD resets at midnight Pacific.
2. **Shared client secret** (A10): anyone who extracts it can call the function up to
   the per-IP limiter. Fine for one user; must be replaced by real auth before the
   user base grows.
3. **Instance-local cache**: Vercel may run several warm instances; cache hits are not
   guaranteed, and cold starts lose it. Free-tier trade-off (no KV/Redis on Hobby).
4. **Per-IP rate limiter is best-effort**: instances are ephemeral, so counters reset;
   it damps abuse, it does not guarantee anything.
5. **Single deployment path**: main = production for both Pages and Vercel; no staging,
   no preview gate beyond local testing. Rollback = revert commit + PWA refresh
   (the service worker caches the old build).
6. **No observability/alerting**: we learn about problems from the user.
7. **No data sync**: each device is its own island (JSON export/import is the bridge).
8. **Lemon Squeezy dependency**: checkout, orders API and webhooks are external.
   A purchase whose redirect is interrupted is retried from a pending order id in
   localStorage; the ledger self-heals from webhooks.
9. **Firebase dependency**: if Firebase is down, sign-in/restore are unavailable; the
   locally stored license (bearer) keeps smart entry working.
10. **License is a bearer token**: whoever holds the key can parse up to the daily
    meter; no revocation UI in v1 (revoke = delete the Firestore doc).
11. **Client-side free allowance is cosmetic**: resetting localStorage restores the
    10/day counter; the server's per-IP limiter is the backstop until identity-gated
    quota (planned at scale).
12. **Manual renewal**: v1 licenses expire 365 days after purchase; revenue depends on
    users renewing (auto-renew subscriptions later).
13. **Firestore writes failed silently until 2026-09-06**: the merge-set commit
    nested `updateMask` inside the update document, and Firestore rejected every
    write with `INVALID_ARGUMENT` while redeem/restore kept working (licenses are
    HMAC-stateless; lookup self-heals from LS). Fixed on `firestore-commit-shape`
    with a body-capturing smoke regression; verified in prod — all three
    collections populated, accountant CSV has rows. The design gap remains:
    `ensureLicenseForOrder` does not upsert the ledger row itself (only the
    redeem path and the webhook do).

## 5. Where we might go next (as the user base grows)

| Stage | Paying users | Changes |
|---|---|---|
| **Now** | 1 | Keep $0 infra. Watch the ledger, license meters and Vercel logs. Reconcile the ledger monthly against LS payouts. |
| **A few trusted users** | 2–20 | Invite a few testers; free allowance stays 10/day; monitor per-license usage counters for the heavy tail (each $5 payer nets $4.25; their own Gemini ≈ $2–9/yr depending on usage). |
| **Growth** | 20–500 | Identity-gate the free allowance (anonymous Firebase auth) so it stops being client-enforced; watch the free-tier cross-subsidy (the dominant scale variable); enable Gemini context caching for the static share of the prompt; add Apple sign-in ($99/yr developer account). |
| **Scale** | 500+ | Auto-renew subscriptions in LS; revisit the $5 price and the 50¢ fee floor; move functions off Vercel Hobby ceilings; alerting on usage/costs; staging environment. |

**Pivots to anticipate** (each is localized by design): A10 shared secret → authenticated
backend; A6 per-model fallback → provider-agnostic adapter; instance cache → shared cache;
localStorage island → synced datastore (adapter already exists); manual deploy verification →
CI previews; client-side free allowance → identity-gated quota; manual renewal →
subscription auto-renew.

## 6. Update ritual

Every time the app ships a meaningful change: bump the date + `main` hash above, add/amend
ADRs, re-check §3 rows and §4 items, and keep it terse — this file is a scoreboard, not a log.
`skills/project-skill.md` is the companion "how we work" file; they are updated together.
