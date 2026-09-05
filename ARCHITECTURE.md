# Architecture — $5 Budget App

> **Living record** — updated whenever the app ships a meaningful change.
> Last updated: **2026-09-05** (main ≈ `248e1e6`).
> Read alongside `skills/project-skill.md` (conventions + current state) and
> `skills/speech-entry.md` (smart-entry spec). Keep this file honest: if a
> trade-off changes, update the table, not just the date.

## 1. System context (today)

```
iPhone PWA ──HTTPS──▶ GitHub Pages (static, CDN)          [free]
   │  smart entry text + categories only
   └───────────────▶ Vercel Function /api/parse           [Hobby, free]
                       │  retry/backoff + fallback model
                       ▼
                    Google Gemini API                     [free tier]
```

- **Client:** React 19 + TS 6 + Vite 8 PWA, `base: './'`, no router/UI/framework.
  All budget data lives in `localStorage` behind a `StorageAdapter` interface.
- **Backend:** exactly one Vercel Function (`api/parse.js`, Node-style handler).
  It is the app's only server-side code; there is no database, no auth, no queues.
- **AI:** Gemini `gemini-3.6-flash` (primary) with `gemini-3.5-flash-lite` quota
  fallback; structured JSON **array** out (1 element per transaction, cap 20, each
  with a 0–1 `confidence` grade).
- **Cost today: $0** — GitHub Pages free, Vercel Hobby (1M function invocations/mo,
  300s max duration), Gemini free tier (per-project RPM/TPM/RPD; RPD resets at
  midnight Pacific; capacity is shared).

## 2. Decision records

| ID | Decision | Why | Status |
|---|---|---|---|
| A1 | Client-first storage: budget data in `localStorage` behind an adapter (schema v1) | Privacy (data never leaves device), zero backend cost, works offline; adapter anticipates SQLite later | Accepted |
| A2 | No accounts, no auth, single user | Scope; the phone IS the identity | Accepted |
| A3 | AI parsing behind a serverless proxy (`/api/parse`); LLM key never reaches the client | Credential safety; provider swap stays server-side | Accepted |
| A4 | LLM output is **untrusted external data**: the client re-validates every element (`validateParsedTransactions`); one bad element rejects the whole parse | Never save silently; never drop a transaction silently | Accepted |
| A5 | Instant save + confidence-graded review: entries below 0.8 or without a category go to a pre-filled review form; batches end in a "Recorded ✓" summary | User chose speed with a safety gate; approval happens by testing in prod | Accepted |
| A6 | Engineer resilience into the free tier rather than paying: retry/backoff (honoring `RetryInfo`), fallback model with its own quota, warm-instance response cache, 40/10min per-IP limiter | $0 today; availability bounded by free quotas, mitigations raise the ceiling | Accepted |
| A7 | One utterance → one JSON **array** (multi-transaction entry), cap 20, per-element dates/notes/confidence | "300 in bread, 2000 bus home…" must record each transaction properly | Accepted |
| A8 | Plain stack: no router, no UI library, no icon library, plain CSS design system, hand-rolled smoke suite (~157 checks) | Small surface, no dependency drift, fast builds | Accepted |
| A9 | Linear git history, feature branch per change, ff-merge to `main`, rollback = a revert commit; Pages Actions + Vercel Git integration auto-deploy | Deterministic, reviewable, instantly reversible | Accepted |
| A10 | Shared-secret header + origin allow-list + input whitelisting on the function | Cheap defense layers; acknowledged as obfuscation, not auth (see §4) | Accepted |

## 3. The "-ilities" — where we stand

| Quality attribute | Standing (n = 1 user) | Evidence / limit |
|---|---|---|
| **Resilience** | Good | Server retries transient 429/5xx; fallback model doubles effective quota; instance cache makes retries instant; client auto-retries once. Limit: free-tier RPD exhaustion degrades smart entry until midnight PT; **manual entry always works, offline** — the app never hard-fails. |
| **Availability** | No SLA, graceful degradation | Depends on three free services (Pages, Vercel, Gemini). Worst case the app remains fully usable minus smart entry. |
| **Scalability** | By design for 1 | Static frontend scales for free via CDN. The function does not: per-IP limiter, shared secret, one shared Gemini quota, Vercel Hobby ceilings. Growing users = rework of A2/A10 (see §5). |
| **Security** | Thin but layered | Origin allow-list, secret header, request whitelisting, rate limiting, LLM-output validation. The secret is baked into the static bundle — readable by any client: **obfuscation, not authentication**. |
| **Privacy** | Strong | Transaction history never leaves the device; only utterance + category list are sent; logs carry metadata only (status/model/retryDelay). Caveat: Gemini's free tier may use prompts to improve products — paid tier is the opt-out. |
| **Maintainability** | Good | ~2k LOC app + one 600-line function; pure logic modules; docs in `skills/`; conventions in `project-skill.md`. |
| **Observability** | Weakest link | Vercel logs are metadata-only and ad-hoc; no metrics, no alerting, no error budget. Diagnosis today = user report + log grep. |
| **Testability** | Solid for logic, thin for UI | 157 smoke checks cover money/periods/validators/microservice helpers; no UI test framework; handler smoke-testable via fetch stubbing. |
| **Cost efficiency** | $0, with quantified trade-offs | Every resilience mechanism is free; the price is bounded availability + free-tier data-use caveat. |
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

## 5. Where we might go next (as the user base grows)

| Stage | Users | Changes |
|---|---|---|
| **Now** | 1 | Keep $0. Watch Vercel logs when "busy" appears (`retryDelay` tells traffic vs daily quota). |
| **A few trusted users** | 2–20 | **Bring-your-own-key candidate**: each user pastes their own AI Studio key (stored device-side) — quota and blame become per-user, $0 preserved, no backend auth needed. Otherwise: split secrets per build, tighten limiter keys, document free-tier limits in-app, add structured logs + a tiny metrics endpoint. |
| **Many users** | 20+ | Real auth (sessions/tokens); paid Gemini tier with spend caps (also opts out of training use); server-side sync with SQLite/Postgres behind the existing `StorageAdapter`; shared cache (Redis/KV — paid); a queue to smooth parse bursts; monitoring + 429-rate alerting; staging environment. |
| **Scale** | 100s+ | Provider abstraction with contracts, multi-region functions, error budgets, incident runbooks, sync conflict policies. |

**Pivots to anticipate** (each is localized by design): A10 shared secret → authenticated
backend; A6 per-model fallback → provider-agnostic adapter; instance cache → shared cache;
localStorage island → synced datastore (adapter already exists); manual deploy verification →
CI previews.

## 6. Update ritual

Every time the app ships a meaningful change: bump the date + `main` hash above, add/amend
ADRs, re-check §3 rows and §4 items, and keep it terse — this file is a scoreboard, not a log.
`skills/project-skill.md` is the companion "how we work" file; they are updated together.
