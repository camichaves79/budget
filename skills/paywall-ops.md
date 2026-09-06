# Skill — Smart-Entry Paywall & License Ops

> Operating guide for the smart-entry paywall (shipped on `main` ≈ `22227c4`,
> ADRs A12–A14 in `ARCHITECTURE.md`). Read `skills/project-skill.md` for
> conventions. **Everything below is verified against Lemon Squeezy and Firebase
> docs as of 2026-09** — cite this file when the UI drifts.

## 1. What the feature does

- Free: **10 smart parses/day** (client-side counter; server per-IP limiter is
  the backstop).
- Beyond that: paywall card → **Lemon Squeezy checkout overlay** → confirmation
  button returns to the app with `?key=[license_key]&order_id=[order_id]` →
  the app **auto-redeems** at `/api/license/redeem` (the license key resolves
  through LS's License API; the order is verified `paid`) → an **HMAC-signed
  license** is minted server-side, stored on-device, and bound to the signed-in
  account. The paste field in Settings is recovery-only.
- The paste fallback accepts **either** the app's own license token **or** a
  Lemon Squeezy license key from the purchase email (resolved via the License
  API at `/api/license/check`) — it rescues purchases whose redirect never
  completed. Still never the main path.
- Every parse with a license is verified (signature + expiry) and metered
  (**100/day** per license, instance-local).
- **Sales ledger** in Firestore (webhook-fed), exported for the accountant at
  `GET /api/ledger/export?format=csv` (header `x-budget-admin`).

## 2. Pricing (approved)

- **$5/year**, one-time product, manual renewal (v1). Brand-aligned; expected
  earnings at 50 paying users ≈ $55–100/yr (see the session cost model).
- Cost math: Gemini ≈ $0.00036–0.00048/parse (Lite→Flash, paid key); LS fee
  5% + $0.50 per sale (**+1.5% international-card / PayPal, +0.5% subscription**
  surcharges may apply — the ledger's fee/net columns are ESTIMATES; payout
  reports are the reconciliation truth); chargebacks: **$15 dispute fee**.
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
   `https://camichaves79.github.io/budget/?key=[license_key]&order_id=[order_id]`
   — both are documented [link variables](https://docs.lemonsqueezy.com/help/products/link-variables)
   (square-bracket syntax). The app accepts `key`/`license_key`/`order_id`/
   `order_identifier` query params and strips them on boot.
4. **Webhook:** Settings → Webhooks → add `https://budget-beta-two.vercel.app/api/webhooks/ls`
   with a signing secret (6–40 chars) → this becomes `LEMONSQUEEZY_WEBHOOK_SECRET`.
   Events: `order_created`, `order_refunded` (minimum `order_created`).
5. **API key:** Settings → API → create key → `LEMONSQUEEZY_API_KEY` (server-only).
   Copy the **store id** into `LEMONSQUEEZY_STORE_ID` (webhooks are filtered by it).
6. Test end-to-end with a **test-mode** checkout before going live.

## 4. Firebase setup

1. Create a project at console.firebase.google.com (Spark plan).
2. **Security → Authentication → Sign-in method → Google → Enable → Save.**
3. **Security → Authentication → Settings → Authorized domains**: add
   `camichaves79.github.io` and `localhost`.
4. **Databases & Storage → Firestore → Create database → Production mode**, then
   set rules to deny ALL client access (the Admin SDK bypasses rules):
   `match /{document=**} { allow read, write: if false; }`
5. **Project settings ⚙ → Service accounts → Generate new private key** (JSON).
   Copy its contents into the Vercel env var `FIREBASE_SERVICE_ACCOUNT`
   (single line, ~2.3 KB — fine for Node functions' 64 KB env budget).
6. **Project settings → General → Your apps → Web app → Config**: copy
   `apiKey`, `authDomain`, `projectId`, `appId` into the client env vars.
7. **Vercel Node version:** the functions are dependency-free (hand-rolled
   Firebase REST client — Vercel's tracing silently dropped `firebase-admin`
   from the bundles, see `ARCHITECTURE.md` §1), so the default Node 24 runtime
   is fine.

Collections created at runtime (never touch them by hand): `licenses/{lic}`,
`entitlements/{uid}`, `sales/{orderId}`.

## 5. Environment variables

**Vercel project (`budget-beta-two`):**

| Var | Purpose |
|---|---|
| `GEMINI_API_KEY` | free-tier key (existing) |
| `GEMINI_PAID_API_KEY` | paid key (Cloud billing + spend cap) for licensed parses; falls back to the free key until set |
| `GEMINI_FALLBACK_MODEL` | existing; licensed parses run this model as PRIMARY |
| `BUDGET_PARSE_SECRET` | existing; also guards the license endpoints |
| `BUDGET_LICENSE_SECRET` | HMAC secret signing license tokens — **generate fresh, keep private** |
| `LICENSE_DAILY_CAP` | optional, default 100 |
| `LEMONSQUEEZY_API_KEY` / `LEMONSQUEEZY_WEBHOOK_SECRET` / `LEMONSQUEEZY_STORE_ID` | LS integration |
| `FIREBASE_SERVICE_ACCOUNT` | service-account JSON (single line) |
| `BUDGET_ADMIN_SECRET` | protects `/api/ledger/export` |

**GitHub repo secrets (Pages build) + local `.env`** — see `.env.example`:
`VITE_PARSE_ENDPOINT`, `VITE_PARSE_SECRET` (existing), `VITE_API_BASE`
(= `https://budget-beta-two.vercel.app`), `VITE_FIREBASE_API_KEY`,
`VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`,
`VITE_CHECKOUT_URL` (the store's buy link).

## 6. Verify after setup

```bash
# 1. Redeem a TEST-mode order (license key from the test purchase email):
curl -s -X POST https://budget-beta-two.vercel.app/api/license/redeem \
  -H 'Content-Type: application/json' -H "x-budget-secret: $SECRET" \
  -d '{"key":"<test-license-key>"}'

# 2. Parse with the returned license:
curl -s -X POST https://budget-beta-two.vercel.app/api/parse \
  -H 'Content-Type: application/json' -H "x-budget-secret: $SECRET" \
  -H 'Origin: https://camichaves79.github.io' \
  -d '{"utterance":"300 in bread","categories":[],"today":"2026-09-05","license":"<token>"}'

# 3. Ledger export (accountant CSV):
curl -s -H "x-budget-admin: $ADMIN" \
  "https://budget-beta-two.vercel.app/api/ledger/export?format=csv" -o sales.csv

# 4. Webhook signature (sanity): the function answers 401 to a bad signature.
curl -s -X POST https://budget-beta-two.vercel.app/api/webhooks/ls \
  -H 'X-Signature: deadbeef' -d '{}'
```

Then: buy the $5 product in **test mode** from the phone → tap the confirmation
button → app should toast "License active ✓"; check Settings → Smart entry and
the CSV row.

## 7. Operations

- **Accountant export:** `curl -H "x-budget-admin: <secret>"
  https://budget-beta-two.vercel.app/api/ledger/export?format=csv`. Columns:
  date, order_number, status, gross, tax, total, fees_estimate, net_estimate,
  currency, buyer_email, license_id, receipt_url, invoice_url, refunded,
  refunded_amount, refunded_at, test_mode. Invoices are generated
  automatically on first sight of a paid order (`generate-invoice` endpoint).
- **Reconcile monthly:** diff the CSV against LS orders list + payout reports
  (fees incl. surcharges are only exact there). Payouts: twice monthly,
  **13-day hold**, **$50 minimum payout threshold**, USD.
- **Refunds:** LS refund → `order_refunded` webhook → ledger refund fields +
  license marked `refunded`. Known v1 gap: parse verification is stateless
  (HMAC + expiry only), so a refunded license stays usable until expiry —
  acceptable for a $5 product; enforcement would add a Firestore check per
  licensed parse.
- **Revoke/rotate:** delete the `licenses/{id}` doc (also removes the
  restore path). Rotating `BUDGET_LICENSE_SECRET` invalidates every issued
  token — only as a last resort.
- **Watch:** license meters (parse `license-limit` responses), ledger rows,
  Vercel logs for `license-invalid`/`bad-signature`.

## 8. Apple sign-in (later — config-only)

Requires an **Apple Developer Program account ($99/yr)**: associate the website,
register return URL `https://<project>.firebaseapp.com/__/auth/handler`, create a
**Service ID** + private key; then enable **Security → Authentication → Apple** in
Firebase with the Service ID + Team ID + key. No client code change
(`OAuthProvider('apple.com')` swap behind the existing auth boundary).

## 9. Known gotchas

- **Google sign-in is popup-first** with a redirect fallback: since June 2024,
  third-party-storage blocking breaks `signInWithRedirect` on GitHub Pages
  domains (Firebase's
  [redirect best practices](https://firebase.google.com/docs/auth/web/redirect-best-practices)).
  If popup misbehaves in the installed PWA, the documented fix is self-hosting
  the `__/auth/*` helper files on Pages (option 4) — test empirically.
- **LS overlay** in Safari: known 404 issue (lmsqueezy/lemonsqueezy.js#68);
  the app falls back to a new tab / full redirect automatically.
- **Order fetch** uses the NUMERIC id; `order_number` is separate; the
  `[license_key]` path avoids both ambiguities.
- **order_created webhook** can carry non-paid statuses; the function only
  mints/entitles on `status: 'paid'`.
- **License tokens are bearer tokens** (meter-bounded); keep them out of logs.
- Never log buyer emails or license keys outside the ledger collection.
