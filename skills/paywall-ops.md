# Skill — Smart-Entry Paywall & License Ops

> Operating guide for the smart-entry paywall (shipped on `main` ≈ `b5094b5`,
> **user-approved 2026-09-06**, ADRs A12–A14 in `ARCHITECTURE.md`). Read
> `skills/project-skill.md` for conventions. **Everything below is verified
> against Lemon Squeezy and Firebase docs as of 2026-09** — cite this file
> when the UI drifts.

## 1. What the feature does

- Free: **10 smart parses/day** (client-side counter; server per-IP limiter is
  the backstop).
- Beyond that: paywall card → **sign in with Google (mandatory for purchases —
  every license is account-bound at mint time)** → **Lemon Squeezy checkout
  overlay** → confirmation button returns to the app with
  `?key=[license_key]&order_id=[order_id]` → the app **auto-redeems** at
  `/api/license/redeem` (the license key resolves through LS's License API; the
  order is verified `paid`; the redeem endpoint rejects requests without a
  valid Firebase idToken) → an **HMAC-signed license** is minted server-side,
  stored on-device, and bound to the signed-in account. The paste field in
  Settings is recovery-only (also requires sign-in).
- **Ownership (2026-09):** redeem and paste-key check require the signed-in
  account's email to match the order's LS `user_email` (409 `email-mismatch`
  otherwise) — LS order ids are numeric and enumerable, so sign-in alone is
  not authorization. **Consequence: buyers must purchase with the same email
  as their Google sign-in.** The license endpoints are also per-IP
  rate-limited (30/10min) as enumeration damping.
- The paste fallback accepts **either** the app's own license token **or** a
  Lemon Squeezy license key from the purchase email (resolved via the License
  API at `/api/license/check`) — it rescues purchases whose redirect never
  completed. Still never the main path.
- Every parse with a license is verified (signature + expiry) and metered
  (**100/day** per license, instance-local).
- **Sales ledger** in Firestore (webhook-fed), exported for the accountant at
  `GET /api/ledger/export?format=csv` (header `x-budget-admin`).

## 2. Pricing (approved, amended 2026-09-09)

- **US$5.00/year, SUBSCRIPTION with auto-renew** — the live product
  ("$5 Budget — Smart Entry (1 year)"). The user re-priced it from the
  interim COP 17,500 to USD 5.00 on 2026-09-09 (same product/checkout
  UUID; the store currency stays COP, so payouts convert). The original
  $5-one-time/manual-renewal plan was superseded at product creation
  (user's call, 2026-09-09); license keys are enabled with UNLIMITED
  activations. First real sale: order `9426883` (the COP-era price,
  ≈ US$5.62 at LS's `currency_rate` 0.00032112, renews 2027-09-09).
  Brand-aligned; expected earnings at 50 paying users ≈ $55–100/yr (see
  the session cost model).
- Cost math: Gemini ≈ $0.00036–0.00048/parse (Lite→Flash, paid key); LS fee
  5% + $0.50 per sale (**+1.5% international-card / PayPal, +0.5% subscription
  now applies**); the ledger's fee/net columns are ESTIMATES (currency-aware
  since v0.1.117: the $0.50 baseline converts via the order's
  `currency_rate`); payout reports are the reconciliation truth;
  chargebacks: **$15 dispute fee**. Store currency is COP — expect COP
  payout reports.
- **Play fee (Android, A18 — not yet shipped):** **15%** of the price, no
  fixed per-transaction fee (Google's subscription rate; it can drop to 10%
  after a subscriber's 12-month anniversary — the ledger keeps 15% as the
  conservative estimate, `estimatePlayFeeCents`). Play has no per-order
  invoice/receipt URL and no $0.50 floor; reconcile Play rows against the
  Play earnings/Finance reports (never LS payouts). An Android cohort nets
  ~$4.25 of $5 vs LS's ~$4.25 (LS) after fees — both roughly net $4.25 at
  this price, so the Play 15% is the same net as LS's 5% + $0.50 at $5.
- Scale knobs (documented, not implemented): conversion %, free-allowance size,
  Gemini context caching, price. See `ARCHITECTURE.md` §5.

## 3. Lemon Squeezy setup

1. Create the store (seller in Colombia: bank payouts via Stripe are
   [supported](https://docs.lemonsqueezy.com/help/getting-started/supported-countries);
   PayPal also works). **Verify during onboarding:** sub-$10 products may require
   [custom pricing](https://docs.lemonsqueezy.com/help/getting-started/fees)
   ("contact us for products < $10") — if a $5 product is rejected in the
   dashboard, ask LS support or raise the test price.
2. **Product:** one-time, USD 5.00, **License keys enabled** (any length;
   activation limit high/unlimited — we never consume activations, we only
   *validate* keys).
3. **Confirmation button link** (the post-purchase redirect): set it to
   `https://5budget.app/?key=[license_key]&order_id=[order_id]`
   (Cloudflare, 2026-09-08 migration, A15) — both are documented
   [link variables](https://docs.lemonsqueezy.com/help/products/link-variables)
   (square-bracket syntax). The app accepts `key`/`license_key`/`order_id`/
   `order_identifier` query params and strips them on boot.
4. **Webhook:** Settings → Webhooks → add `https://api.5budget.app/api/webhooks/ls`
   with a signing secret (6–40 chars) → this becomes `LEMONSQUEEZY_WEBHOOK_SECRET`.
   Events: `order_created`, `order_refunded` (minimum `order_created`).
5. **API key:** Settings → API → create key → `LEMONSQUEEZY_API_KEY` (server-only).
   Copy the **store id** into `LEMONSQUEEZY_STORE_ID` (webhooks are filtered by it).
6. Test end-to-end with a **test-mode** checkout before going live.

## 4. Firebase setup

1. Create a project at console.firebase.google.com (Spark plan).
2. **Security → Authentication → Sign-in method → Google → Enable → Save.**
3. **Security → Authentication → Settings → Authorized domains**: add
   `5budget.app` and `localhost`.
4. **Databases & Storage → Firestore → Create database → Production mode**, then
   set rules to deny ALL client access (the Admin SDK bypasses rules):
   `match /{document=**} { allow read, write: if false; }`
5. **Project settings ⚙ → Service accounts → Generate new private key** (JSON).
   Minify it to ONE line and copy it into the Worker's Secret variable
   `FIREBASE_SERVICE_ACCOUNT` (Cloudflare → `budget-api` → Settings →
   Variables and Secrets). **The key must stay ACTIVE** — deleting it in the
   Firebase console orphans the Worker's copy and every Firestore read fails
   with `firebase: token endpoint 400` (2026-09-08 incident).
6. **Project settings → General → Your apps → Web app → Config**: copy
   `apiKey`, `authDomain`, `projectId`, `appId` into the client env vars.
7. **Worker runtime:** the functions are dependency-free (hand-rolled Firebase
   REST client — tracing silently dropped `firebase-admin` from serverless
   bundles, see `ARCHITECTURE.md` §1); the Worker runs `nodejs_compat` and
   the Firebase OAuth JWT is signed with WebCrypto (workerd lacks
   `crypto.createSign`).

Collections created at runtime (never touch them by hand): `licenses/{lic}`,
`entitlements/{uid}`, `sales/{orderId}`.

## 5. Environment variables

**Cloudflare Worker (`budget-api`, served at `api.5budget.app`):**

| Var | Purpose |
|---|---|
| `GEMINI_API_KEY` | free-tier key (existing) |
| `GEMINI_PAID_API_KEY` | paid key (Cloud billing + spend cap) for licensed parses; falls back to the free key until set, and at runtime when the paid key is rejected with a config-type error (400/401/403/404) |
| `GEMINI_FALLBACK_MODEL` | existing; licensed parses run this model as PRIMARY |
| `BUDGET_PARSE_SECRET` | existing; also guards the license endpoints |
| `BUDGET_LICENSE_SECRET` | HMAC secret signing license tokens — **generate fresh, keep private** |
| `LICENSE_DAILY_CAP` | optional, default 100 |
| `LEMONSQUEEZY_API_KEY` / `LEMONSQUEEZY_WEBHOOK_SECRET` / `LEMONSQUEEZY_STORE_ID` | LS integration |
| `FIREBASE_SERVICE_ACCOUNT` | service-account JSON (single line) |
| `BUDGET_ADMIN_SECRET` | protects `/api/ledger/export` |

**Cloudflare Pages env vars (build-time) + local `.env`** — see `.env.example`:
`VITE_PARSE_ENDPOINT` (= `https://api.5budget.app/api/parse`), `VITE_PARSE_SECRET`
(existing), `VITE_API_BASE` (= `https://api.5budget.app`),
`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
`VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_CHECKOUT_URL`
(the store's buy link).

## 6. Verify after setup

**Client error-code map (for debugging "Complete purchase" failures):**
(i18n note 2026-09: these strings now render in the app's UI language via the
`paywall.*`/`licensing.*` catalog keys — the English text below remains the
canonical form for the map.)
- "Couldn't reach the licensing service…" → function 500/network (check the Worker logs — Cloudflare → `budget-api` → Logs — for `firebase:` lines)
- "The licensing service isn't fully set up yet…" → `not-configured` (FIREBASE_SERVICE_ACCOUNT missing/unparseable in the Worker variables, or the variable change wasn't Deployed)
- "That purchase couldn't be completed…" → order not paid/found/refunded (test-mode or link-variable issue)
- "Your payment hasn't been confirmed yet…" → order still pending

```bash
# 1. Redeem a TEST-mode order (license key from the test purchase email):
curl -s -X POST https://api.5budget.app/api/license/redeem \
  -H 'Content-Type: application/json' -H "x-budget-secret: $SECRET" \
  -d '{"key":"<test-license-key>"}'

# 2. Parse with the returned license:
curl -s -X POST https://api.5budget.app/api/parse \
  -H 'Content-Type: application/json' -H "x-budget-secret: $SECRET" \
  -H 'Origin: https://5budget.app' \
  -d '{"utterance":"300 in bread","categories":[],"today":"2026-09-05","license":"<token>"}'

# 3. Ledger export (accountant CSV):
curl -s -H "x-budget-admin: $ADMIN" \
  "https://api.5budget.app/api/ledger/export?format=csv" -o sales.csv

# 4. Webhook signature (sanity): the function answers 401 to a bad signature.
curl -s -X POST https://api.5budget.app/api/webhooks/ls \
  -H 'X-Signature: deadbeef' -d '{}'
```

Then: buy the $5 product in **test mode** from the phone → tap the confirmation
button → app should toast "License active ✓"; check Settings → Smart entry and
the CSV row.

**Firestore check (non-negotiable):** after a successful redeem, the Firebase
console → Firestore must show the `sales`, `licenses` and `entitlements`
collections (each with at least one doc), plus — after any Play purchase —
the `playTokens` map (a 4th collection keyed by Play `purchaseToken` →
`{ license_id }`). If the console stays empty, the REST
write path is failing silently — stop and diagnose per §9 before treating the
feature as working (restore alone is NOT proof: it self-heals from the LS
orders API without Firestore).

**Live-side credentials (2026-09-09):** LS splits test/live across API keys,
webhooks AND products — a key only works on its own side, webhooks must be
added per side, and the checkout's test-mode toggle does NOT turn a live
product's order into a test order. The Worker now holds LIVE values: API key,
a fresh signing secret (the post-approval 401s were a test-side secret), and
store id `468123`. The accountant CSV renders `fees_estimate`/`net_estimate`
correctly since v0.1.117 (legacy `fees`/`net` doc keys fall back).

## 7. Operations

- **Accountant export:** `curl -H "x-budget-admin: <secret>"
  https://api.5budget.app/api/ledger/export?format=csv`. Columns:
  source (ls|play), date, order_number, status, gross, tax, total,
  fees_estimate, net_estimate,
  currency, buyer_email, license_id, receipt_url, invoice_url, refunded,
  refunded_amount, refunded_at, test_mode. Invoices are generated
  automatically on first sight of a paid order (`generate-invoice` endpoint —
  LS only; Play has no invoices).
- **Reconcile monthly:** diff the CSV against BOTH merchants, split by the
  `source` column — LS rows vs the LS orders list + payout reports (fees incl.
  surcharges are only exact there; payouts twice monthly, **13-day hold**,
  **$50 minimum payout threshold**, USD), Play rows vs the Play earnings /
  Finance reports (15% fee, no fixed floor, no invoice/receipt URL).
- **Refunds:** LS refund → `order_refunded` webhook → ledger refund fields +
  license marked `refunded`. Known v1 gap: parse verification is stateless
  (HMAC + expiry only), so a refunded license stays usable until expiry —
  acceptable for a $5 product; enforcement would add a Firestore check per
  licensed parse.
- **Refunds/revocation (Play, A18):** a `SUBSCRIPTION_REVOKED` / `EXPIRED`
  notification or a `voidedPurchaseNotification` (refund/chargeback) marks the
  license `refunded` via the `playTokens` map; `ON_HOLD` / `IN_GRACE_PERIOD` /
  `PAUSED` / `CANCELED` set `status: 'at-risk'` without changing expiry. Same
  stateless-verification gap as LS.
- **Revoke/rotate:** delete the `licenses/{id}` doc (also removes the
  restore path). Rotating `BUDGET_LICENSE_SECRET` invalidates every issued
  token — only as a last resort.
- **Watch:** license meters (parse `license-limit` responses), ledger rows,
  Worker logs (Cloudflare → `budget-api` → Logs) for
  `license-invalid`/`bad-signature`.

## 8. Apple sign-in — DISCARDED (2026-09-06)

Removed from the roadmap: the $99/yr Apple Developer Program requirement was
never justified for this product, and Google sign-in covers the identity
need. (If ever revisited, the swap is still config-only behind the existing
auth boundary: `OAuthProvider('apple.com')` + a Service ID + private key.)

## 9. Known gotchas

- **Secret placement (2026-09 incident):** the Firebase **service-account JSON**
  (with its `private_key`) was once pasted into the client secret
  `VITE_FIREBASE_API_KEY` and shipped inside the public bundle. It belongs ONLY
  in the Worker's Secret variable `FIREBASE_SERVICE_ACCOUNT`; the client secret
  takes the web-app
  `apiKey` (an `AIza…` token from Project settings → General → Your apps →
  Config). After rotation, the build now REJECTS any `VITE_FIREBASE_API_KEY`
  that doesn't match `AIza…` (`src/lib/auth.ts`), so a wrong paste degrades to
  "sign-in unavailable" instead of leaking. If a server key ever leaks again:
  generate a new key, delete the old one, update the Worker variable, redeploy.

- **Google sign-in is popup-first** with a redirect fallback: since June 2024,
  third-party-storage blocking breaks `signInWithRedirect` on shared-hosting
  domains (Firebase's
  [redirect best practices](https://firebase.google.com/docs/auth/web/redirect-best-practices)).
  On the custom domain `5budget.app` redirect auth works normally.
- **LS overlay** in Safari: known 404 issue (lmsqueezy/lemonsqueezy.js#68);
  the app falls back to a new tab / full redirect automatically.
- **Order fetch** uses the NUMERIC id; `order_number` is separate; the
  `[license_key]` path avoids both ambiguities.
- **order_created webhook** can carry non-paid statuses; the function only
  mints/entitles on `status: 'paid'`.
- **License tokens are bearer tokens** (meter-bounded); keep them out of logs.
- Never log buyer emails or license keys outside the ledger collection.
- **Silent Firestore write failures (2026-09, the reason this guide now
  insists on the §6 Firestore check):** `api/_firebase.js` swallows write/read
  failures by design (never throws), so a redeem can mint and return a VALID
  license while the ledger/license/entitlement docs never land. The confirmed
  root cause in prod was the **commit REST shape**: `updateMask` was nested
  inside `update` instead of sitting beside it as a field of the Write —
  Firestore answered `INVALID_ARGUMENT … Unknown name "updateMask"` on every
  merge-set. Fixed (updateMask as a Write-level sibling + a body-capturing
  smoke regression test); the smoke suite can no longer be fooled by a stub
  that accepts any body. Future triage via the Worker logs (Cloudflare →
  `budget-api` → Logs): `firebase: token
  endpoint <status>` = the service-account JWT was rejected at the OAuth
  endpoint (revoked/wrong/mismatched key after rotation — re-paste a FRESH
  key; the 2026-09-08 instance was an orphaned key, 400), `firebase: commit
  failed <status>` = Firestore answered the
  commit with an error. Restore keeps working in both cases because
  `/api/license/lookup` self-heals from the Lemon Squeezy orders API, which
  is exactly why this failure is invisible to the user and must be checked
  in the console. **Verified fixed end-to-end in prod (2026-09-06, re-verified
  2026-09-08 on the Worker):** all
  three collections populated for the test orders and the accountant CSV
  export has the rows.
- **Test/live split (2026-09-09, the post-approval surprise):** once a store is
  activated, test mode is a SEPARATE environment with its own products, API
  keys and webhooks. Pre-approval credentials silently stop working on live
  orders (redeem 404s; webhooks 401 or never arrive); the checkout's test-mode
  toggle alone does not produce test orders for a live product. To test
  post-approval, either flip the whole admin panel to Test mode and recreate
  the product/webhook/key there, or — the chosen path at 1 user — make the
  first sale REAL and verify against the live webhook deliveries + Firestore.
- **Ledger CSV/invoice regressions (fixed `74c99d4` + `0f033d0`, v0.1.117 +
  v0.1.122):** the CSV's
  fee/net columns rendered empty since ship (doc keys `fees`/`net` vs the
  `fees_estimate`/`net_estimate` contract — now canonical with legacy
  fallback), the +$0.50 fee baseline was USD-only (now converts via
  `currency_rate`), webhook/redeem merge-sets wrote `invoice_url: null`
  over stored URLs (now routed through `saleRowForMerge`), and
  `generate-invoice` was called with the order's UUID `identifier` while
  the LS API wants the NUMERIC order id (404 — the first live sale lost
  its invoice link this way; fixed by passing `data.id` in the webhook and
  the resolved numeric id in redeem). If a sales row is
  ever missing its `invoice_url`, re-send the LS `order_created` webhook —
  the handler regenerates it.

## 10. Play Billing (Android) ops — A18 (implemented, not yet shipped)

The Android build is the same PWA inside a Bubblewrap **Trusted Web Activity**
(`app.fivebudget`, `startUrl "/"` + `?src=play`). Google is the Android
merchant; LS stays the web/iOS merchant. Both mints mint the SAME HMAC license
into the SAME `licenses`/`entitlements`/`sales` ledger (+ `playTokens`), so the
accountant CSV stays one file with a `source` column.

**Client flow (TWA):** `?src=play` → `budget.playBuild` (hides LS checkout +
paste-key; sign-in + restore keep working) → paywall/License shows
"Subscribe · $5 USD/year" → Google sign-in (email-authorization) → Digital
Goods API `PaymentRequest.show()` → `purchaseToken` → `POST
/api/license/redeem-play` → server verifies + acknowledges + mints → license
stored (same "License active ✓" path).

**Server flow (`/api/license/redeem-play`):** verify Firebase idToken → Play
Developer API `purchases.subscriptions` (classic resource for the purchaser
`emailAddress`) → `paymentState === 1` (paid) → `emailsMatch(firebaseEmail,
emailAddress)` → mint via `ensureLicenseForPlayPurchase` (sales keyed by Play
`orderId`, license term = `expiryTimeMillis`, `playTokens/{purchaseToken}`
map) → `:acknowledge` (Play auto-refunds after 3 days unacknowledged).

**Renewals/refunds (`/api/webhooks/play`, Cloud Pub/Sub PUSH):** OIDC bearer
JWT (Google OAuth2 certs, `iss`/`aud`/`exp` + optional pinned email) →
`parseDeveloperNotification` + `classifyPlayNotification` →
`grant` (PURCHASED/RENEWED/RECOVERED/RESTARTED/DEFERRED) extends `exp` +
writes a new `sales/{orderId}` row; `loss` (REVOKED/EXPIRED/voided) marks
`refunded`; `risk` (CANCELED/ON_HOLD/GRACE/PAUSED) sets `at-risk`. Never trust
the notification alone — every path re-queries the Play API for state.

**Play Console setup (user-side, in order):**
1. Verify the developer account + link a Google Payments **merchant account**.
2. Monetize → Subscriptions → create `smart_entry_yearly` (US$5.00/year, base
   plan `p1y`).
3. API access → link the service account (grant `androidpublisher`); export its
   JSON → `GOOGLE_PLAY_SERVICE_ACCOUNT` (single line, Secret).
4. Monetization setup → **Real-time developer notifications** → Pub/Sub topic →
   create a **PUSH subscription** → endpoint
   `https://api.5budget.app/api/webhooks/play`. (Optionally pin the push
   service-account email via `GOOGLE_PLAY_PUBSUB_EMAIL`.)
5. Bubblewrap: enable `features.playBilling.enabled: true` **and**
   `alphaDependencies.enabled: true` in `android/twa-manifest.json`; generate
   the keystore (record the password); `bubblewrap update --manifest android`
   → `validate --url=https://5budget.app` → `build --manifest android` → AAB.
6. Upload to an **internal testing track**, add license testers, install on a
   device, and run the end-to-end test below.

**Env vars (Cloudflare Worker, Secret-type; add to `worker.js` `ENV_KEYS`):**
`GOOGLE_PLAY_SERVICE_ACCOUNT`, `GOOGLE_PLAY_PACKAGE_NAME` (`app.fivebudget`),
`GOOGLE_PLAY_SUBSCRIPTION_ID`, `GOOGLE_PLAY_PUBSUB_AUDIENCE` (optional —
defaults to `https://<host>/api/webhooks/play`), `GOOGLE_PLAY_PUBSUB_EMAIL`
(optional). Client (Pages Production + local `.env`): `VITE_PLAY_SUBSCRIPTION_ID`.

**Client error-code map (Android "Subscribe" failures):**
- "Google Play Billing is not available in this view…" → `paywall.playUnavailable` (Digital Goods API absent — not the TWA, or the `playBilling` feature is off).
- "This purchase belongs to a different email…" → `play-email-mismatch` (the Play account ≠ signed-in Google account).
- "Your payment hasn't been confirmed yet…" → `play-not-paid` (`paymentState ≠ 1`).
- "That purchase reference wasn't found…" → `play-purchase-not-found` (bad token/productId, or the service account lacks access).
- Worker logs for `play: token endpoint <status>` = the Play OAuth JWT was rejected (wrong/revoked `GOOGLE_PLAY_SERVICE_ACCOUNT`).

**Verify after setup:**
```bash
# 1. Redeem a Play purchase token (from a license-tester purchase):
curl -s -X POST https://api.5budget.app/api/license/redeem-play \
  -H 'Content-Type: application/json' -H "x-budget-secret: $SECRET" \
  -d '{"purchaseToken":"<token>","productId":"smart_entry_yearly","idToken":"<firebase-id-token>"}'

# 2. Webhook signature (sanity): a bad bearer answers 401.
curl -s -X POST https://api.5budget.app/api/webhooks/play \
  -H 'Authorization: Bearer garbage' -d '{}'

# 3. Ledger (must show a source=play row):
curl -s -H "x-budget-admin: $ADMIN" \
  "https://api.5budget.app/api/ledger/export?format=csv"
```
Then: internal-track install → in-app purchase via Digital Goods API → app
toasts "License active ✓" → Firestore shows `sales`/`licenses`/`entitlements`/
`playTokens` (the §6 non-negotiable check) → CSV has a `play` row.
