# Skill — Hosting Migration to Cloudflare (Pages + Workers)

> Decision record: **user-directed 2026-09-07.** ADR A15 in `ARCHITECTURE.md`.
> Read `skills/project-skill.md` for conventions; everything here respects
> "one feature branch per change" and "commit/push only on explicit say-so".
>
> **Progress:** **MIGRATION COMPLETE 2026-09-08, user-verified** — the live
> site is `https://5budget.app/` (Cloudflare Pages, custom domain); the six
> API functions run on ONE Worker at `https://api.5budget.app` (dashboard
> custom-domain route, Smart Placement enabled near Gemini — the latency
> fix); Vercel and GitHub Pages are fully retired. Repo anchors: origin
> allow-lists incl. `5budget.app` (`066b75e`), explicit-key env hydration
> (`f831b92`), WebCrypto `signJwt` replacing workerd's missing `createSign`
> (`4658257`). A fresh Firebase service-account key fixed the last breakage
> (`firebase: token endpoint 400` = orphaned key). License sign-in/restore,
> licensed parses and the accountant CSV verified in prod. §3/§4 below stay
> as the reference for future moves or rollbacks.

## 1. Why: the ToS problem (the trigger)

- **GitHub Pages** ToS: not for sites "primarily directed at facilitating
  commercial transactions". The $5/year license (A12) makes this app exactly
  that.
- **Vercel Hobby**: personal/non-commercial use only — and that is where the
  paid API (parse + license + ledger) ran until 2026-09-08. Same problem, one
  layer deeper.
- **Cloudflare** free tiers have no such restriction: Pages serves the static
  site (unlimited requests/bandwidth, 500 builds/mo, free custom domain +
  SSL); Workers free = 100k requests/day (our volume is orders of magnitude
  below that).
- Honest scope note: at 1 user this is a diligence item, not an emergency.
  The migration is staged so each phase is independently shippable and
  reversible.

## 2. Target architecture

```
iPhone PWA ──HTTPS──▶ Cloudflare Pages (static, CDN)              [free]
   │  smart entry text + categories (+ signed license when licensed)
   ├───────────────▶ Cloudflare Worker  (one worker, six routes)  [free]
   │                    /api/parse          Gemini proxy
   │                    /api/license/*      redeem / lookup / check
   │                    /api/webhooks/ls    Lemon Squeezy webhooks
   │                    /api/ledger/export  accountant CSV/JSON
   ├───────────────▶ Firebase Auth + Firestore (unchanged)
   └───────────────▶ Lemon Squeezy (unchanged)
```

Two shapes on the table (user picks at implementation time):

1. **Pages (frontend) + Workers (API)** — recommended. Each phase verifiable
   on its own; lowest risk.
2. **Workers Static Assets serve everything** — one worker project also serves
   `dist/` (`assets` binding + fall-through to `env.ASSETS.fetch`). Cleaner
   end state; fold in as optional Phase 3 after Phase 2 proves the worker.

## 3. Phase 1 — frontend to Cloudflare Pages ✅ SHIPPED (2026-09-07)

Executed as planned below; the final state: Pages project `budget` on
`budget-7ad.pages.dev`, env vars + `NODE_VERSION=22` set, `*.pages.dev`
origin wildcard shipped (`65568f1`), Firebase + LS dashboards updated, the
whole flow re-verified from the iPhone (smart entry, sign-in, restore, PWA,
test-mode purchase → auto-redeem), GitHub Pages workflow deleted
(`5a8033c`) and the Pages site disabled. The step list below stays as the
reference for any future re-migration or a second domain.

`base: './'` in `vite.config.ts` means **zero client code changes** — the app
already works at any path; on the new domain it simply lives at the root (no
`/budget/` subpath).

1. Cloudflare dashboard → **Workers & Pages → Create → Pages** → connect
   `camichaves79/budget`. Build command `npm run build`, output dir `dist`.
2. Copy the build-time env vars from the **GitHub repo secrets** into the
   Pages project (Production + Preview): `VITE_PARSE_ENDPOINT`,
   `VITE_PARSE_SECRET`, `VITE_API_BASE`, `VITE_FIREBASE_API_KEY`,
   `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
   `VITE_FIREBASE_APP_ID`, `VITE_CHECKOUT_URL` (see `.env.example`).
3. Decide the domain: `*.pages.dev` first (free, instant), custom domain
   later (also free). **Note the URL** — it is needed for every step below.
4. **Code change (one commit, own branch):** add the new origin to
   `ALLOWED_ORIGINS` in **both** `api/parse.js` (~line 95) and
   `api/_http.js` (line 11). **Keep the old origin** during cutover so both
   sites work. Vercel redeploys on push to `main`.
5. Firebase console → **Authentication → Settings → Authorized domains**:
   add the new domain (and the `*.pages.dev` URL while testing) or Google
   sign-in fails on the new site.
6. Verify on the new domain (phone + desktop): smart entry parses, Google
   sign-in popup works, license restore works (Settings → License → sign in),
   PWA installs.
7. Only then: Lemon Squeezy → product → **confirmation button URL** →
   `https://<new-domain>/?key=[license_key]&order_id=[order_id]`.
8. Retire: remove the old origin from both `ALLOWED_ORIGINS` lists, disable
   GitHub Pages, delete `.github/workflows/deploy.yml` + the now-unused repo
   secrets (after Phase 2's Actions workflow lands, keep `main`-push deploys
   working the whole time).

**Accepted losses (2026-09-07, user's call — NOT blockers):**

- `localStorage` is per-origin: budget data does not migrate. Export/Import
  in Settings remains the bridge if ever wanted.
- The stored license token does not migrate — but restore is automatic
  (Firestore entitlement is account-bound; sign in and it returns).
- The installed PWA must be re-added from the new origin; service-worker
  scopes are per-origin so there is no conflict.

## 4. Phase 2 — functions to Cloudflare Workers ✅ SHIPPED (2026-09-08)

Executed as planned below (Worker `budget-api` on `api.5budget.app`, dual-run
cutover, Vercel retired). **Extra gotchas discovered during the port, all
fixed in prod** (they also live in `skills/project-skill.md` §9):
workerd's `nodejs_compat` lacks `crypto.createSign` → JWT signing moved to
WebCrypto; Worker env bindings are non-enumerable → explicit-key
`hydrateEnv`; the Variables page needs an explicit Deploy click; a dashboard
Quick Edit diverges from the repo and is overwritten by the next
`wrangler deploy`; `firebase: token endpoint 400` = orphaned service-account
key (fresh key + minify + re-paste).

Small because the functions are **zero-dependency** and the pure modules
(`_license.js`, `_firebase.js`, `_http.js`, `_ls.js`, `_licenseops.js`) never
touch Node's HTTP layer — only the six `handler(req, res)` entry files do.
The smoke suite already drives handlers with fake `req`/`res` objects, which
is exactly the shim contract.

### 4.1 The shim (`worker.js`, new file)

```js
export default {
  async fetch(request, env) {
    Object.assign(process.env, env);            // per-request env hydration
    const req = toNodeReq(request);             // ↓ adapter, ~60–100 lines
    const res = toNodeRes();                    // captures statusCode/headers/body
    // route table → the EXISTING handlers, unmodified:
    //   /api/parse            → parseHandler
    //   /api/license/redeem   → redeemHandler
    //   /api/license/lookup   → lookupHandler
    //   /api/license/check    → checkHandler
    //   /api/webhooks/ls      → webhookHandler
    //   /api/ledger/export    → ledgerExportHandler
    return res.toResponse();
  },
};
```

Adapter contract (mirrors the Vercel runtime the handlers already see):

- `req.method`, `req.headers` — plain object with **lowercased keys**
  (handlers read `origin`, `x-budget-secret`, `x-signature`,
  `x-forwarded-for`), `req` is async-iterable over body `Buffer` chunks
  (`readBodyText`/`readJsonBody` in `_http.js` consume it).
- **IP fidelity bonus:** set `x-forwarded-for` from the
  `cf-connecting-ip` header so the existing rate limiters get the real client
  IP for free (better than Vercel's forwarded headers).
- `res.setHeader(k, v)` + `res.statusCode = n` + `res.end(text?)`; the shim
  builds a Web `Response`. Careful with **204**: no body allowed.
- `process.env` comes from the Worker's `env` binding (hydrate per request;
  do NOT rely on nodejs_compat auto-populating it).

### 4.2 Runtime compatibility

- `wrangler.toml`: recent `compatibility_date` + `nodejs_compat` flag → covers
  `Buffer` and `node:crypto` (`createHmac`, `createSign`, `timingSafeEqual`,
  `randomUUID`); `crypto.subtle` is native WebCrypto (already used by
  `_firebase.js`).
- **Still zero runtime npm dependencies** — `wrangler` is dev-only tooling
  (local installs use the `npm_config_cache` workaround).
- Instance-local state (parse response cache, license meters, rate limiter
  maps) behaves like Vercel warm instances: per-isolate, not shared. Same
  caveats as today (A6, §4 of ARCHITECTURE).
- Env var size limit 5 KB/var: `FIREBASE_SERVICE_ACCOUNT` ≈ 2.3 KB single
  line — fits.

### 4.3 The secrets harvest (do this FIRST, on paper)

Vercel never re-shows secret values, so every var must be recovered or
regenerated before cutover. Fold in the parked items:

| Var | Recovery |
|---|---|
| `GEMINI_API_KEY` | re-copy from AI Studio (user has it) |
| `GEMINI_PAID_API_KEY` | **fresh value** — folds in the parked re-paste (current key is 400-rejected) |
| `GEMINI_FALLBACK_MODEL` | re-type (`gemini-3.5-flash-lite`) |
| `BUDGET_PARSE_SECRET` | known — it matches `VITE_PARSE_SECRET` in local `.env` / GitHub secret |
| `BUDGET_LICENSE_SECRET` | recover if recorded; otherwise **generate fresh** (invalidates issued tokens → they restore via the LS self-heal; fine at 1 payer) |
| `LICENSE_DAILY_CAP` | optional, re-type (`100`) |
| `LEMONSQUEEZY_API_KEY` | LS dashboard → API → re-copy (or regenerate) |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | LS webhook config; if not re-shown, regenerate **and update the webhook** |
| `LEMONSQUEEZY_STORE_ID` | visible in the LS dashboard |
| `FIREBASE_SERVICE_ACCOUNT` | re-download the JSON key from Firebase console (single line; **private key intact** — see the 2026-09 incident in paywall-ops §9) |
| `BUDGET_ADMIN_SECRET` | **NEW value you choose and record** — folds in the parked rotation; finally makes the accountant export usable |

Secrets land via `wrangler secret put <NAME>` (or Workers → Settings →
Variables). Client `VITE_*` stay build-time (Pages env vars).

### 4.4 Deploy & cutover

1. GitHub Actions: `cloudflare/wrangler-action@v3` on push to `main`, repo
   secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (replaces the
   retired Pages workflow — one deploy path stays: `main` = production).
2. **Dual-run:** add the Workers origin to `ALLOWED_ORIGINS` (both files),
   deploy worker, re-point `VITE_PARSE_ENDPOINT` + `VITE_API_BASE` at the
   Workers URL (new Pages build), and verify each endpoint against prod —
   the `skills/paywall-ops.md` §6 curl map, with new URLs.
3. Flip the LS webhook URL to the Worker, confirm an `order_created` lands
   (test-mode purchase).
4. Retire Vercel (pause/delete project), remove the old origin from the
   allow-lists, prune GitHub secrets.
5. Optional Phase 3: Workers Static Assets serve `dist/` too → retire the
   Pages project → single platform, single deploy.

## 5. Verification & rollback

- Phase 1 checklist: smart entry parse on new domain · Google sign-in popup ·
  license restore after sign-in · PWA install · LS confirmation URL returns
  and redeems.
- Phase 2 checklist: `paywall-ops.md` §6 endpoint probes (new URLs) · Firestore
  collections populated after a test purchase (the §6 non-negotiable check) ·
  ledger CSV rows complete · webhook signature accepted.
- Rollback at any point: revert the commit → previous deploy stays live;
  because Phase 2 is dual-run, Vercel functions remain the fallback until
  retirement. Allow-lists keeping BOTH origins during cutover is what makes
  rollback a one-commit affair.

## 6. Completion ritual

When the migration ships: ARCHITECTURE.md header date/hash + §1 diagram +
A15 status → Shipped; `skills/project-skill.md` §10 status + §8 deploy
workflow; this file's status line; clean up the old platform (GitHub Pages
disabled, Vercel retired, secrets pruned). The completion ceremony (user
tests on iPhone against prod) applies to each phase separately.
