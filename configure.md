# Agent Directive: Implement Google Play Billing (TWA + Cloudflare Workers + Firestore)

> **⚠️ READ THE STATUS SECTION AT THE END FIRST.** This directive is a good
> *shopping list* of the code you need, and it is accurate about the API surface.
> But it omits the two setup facts that determine whether any of it works at all
> (Digital Asset Links and Play Console permissions), and one of its
> recommendations — `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
> as separate variables — turned out to be a *better* design than what this repo
> actually implemented, for a reason it does not explain. Measured history in
> `skills/project-skill.md` §10 and `skills/paywall-ops.md` §10.

## Objective
Implement Google Play Billing in a Progressive Web App (PWA) wrapped with Bubblewrap (Trusted Web Activity). You will update the frontend PWA to request subscriptions via the Digital Goods & Payment Request APIs, construct a Cloudflare Worker endpoint to verify purchases via the Google Play Developer API, and persist subscription state in Firebase Firestore.

---

## Architectural Workflow

1. **Bubblewrap TWA (`twa-manifest.json`)**: Enable the `playBilling` feature flag.
2. **Frontend (PWA on Cloudflare Pages)**: 
   - Detect `window.getDigitalGoodsService`.
   - Call `PaymentRequest` targeting `https://play.google.com/billing`.
   - Send `purchaseToken` to backend.
3. **Backend Verification (Cloudflare Worker)**:
   - Receive `{ subscriptionSku, purchaseToken, userId }`.
   - Authenticate with Google Play Developer API using Service Account credentials.
   - Verify purchase token validity and expiry.
4. **Database (Firebase Firestore)**:
   - Update `users/{userId}` document with active subscription state and expiration date.

---

## Step-by-Step Task Execution

### Task 1: Update Bubblewrap Manifest
Locate or create `twa-manifest.json` in the root/mobile directory and ensure `playBilling` is enabled:

```json
{
  "features": {
    "playBilling": {
      "enabled": true
    }
  }
}
```

---

### Task 2: Create Client-Side Purchase Utility
Create `src/utils/playBilling.js` (or `.ts` depending on project setup):

- Implement `getPlayBillingService()` using `window.getDigitalGoodsService('https://play.google.com/billing')`.
- Implement `requestSubscription(sku, userId)`:
  - Construct a `PaymentRequest` with method `https://play.google.com/billing` and `data: { sku }`.
  - Execute `paymentRequest.show()`.
  - Extract `purchaseToken` from `paymentResponse.details`.
  - Send POST request to `/api/verify-subscription`.
  - Call `paymentResponse.complete('success')` on success, or `paymentResponse.complete('fail')` on error.

---

### Task 3: Create Verification Cloudflare Worker Endpoint
Create or update `functions/api/verify-subscription.js` (Cloudflare Pages Functions) or `src/index.js` (Cloudflare Worker):

**Required Environment Variables:**
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
- `PACKAGE_NAME` (Android app package ID, e.g., `com.example.app`)
- `FIREBASE_PROJECT_ID`

**Implementation Steps:**
1. Generate a JWT / OAuth2 access token for `https://www.googleapis.com/auth/androidpublisher` using the service account credentials.
2. Call Google Play Android Publisher API v3:
   `GET https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{packageName}/purchases/subscriptions/{subscriptionId}/tokens/{token}`
3. Validate response:
   - Confirm `expiryTimeMillis > Date.now()`.
4. Update Firestore via REST API:
   - Send `PATCH` request to `https://firestore.googleapis.com/v1/projects/{FIREBASE_PROJECT_ID}/databases/(default)/documents/users/{userId}`.
   - Set fields: `subscriptionStatus` (`ACTIVE`), `subscriptionSku`, `purchaseToken`, `expiresAt`.
5. Return JSON response `{ success: true }` or error code.

---

### Task 4: Error Handling & Fallbacks
- Include grace checks: If `getDigitalGoodsService` is undefined (e.g., user is running standard web browser outside TWA), fall back gracefully or provide standard web billing options.
- Add try/catch blocks around network calls and PaymentRequest cancellation handlers.

---

## Verification Criteria
- [ ] `twa-manifest.json` contains `"playBilling": { "enabled": true }`.
- [ ] Frontend billing wrapper safely checks for API existence before triggering `PaymentRequest`.
- [ ] Cloudflare Worker handles JWT generation or auth exchange without relying on Node.js-only native binaries incompatible with edge runtimes (use `crypto.subtle` or standard Web Crypto / JS JWT library if needed).
- [ ] User document in Firestore properly updates subscription status and timestamps.

---

# Status of this directive against the REAL implementation (2026-09-11)

Written after implementing all of the above and then spending two sessions on
failures this document does not mention. Its code surface is correct; the
*setup* omissions are what cost the time.

| Directive item | Status here |
|---|---|
| Bubblewrap `playBilling` flag | done (`android/twa-manifest.json`) |
| Detect `getDigitalGoodsService` | done (`src/lib/playBilling.ts`). Note the shared secret is **`VITE_PARSE_SECRET`**, checked against `BUDGET_PARSE_SECRET` — not the licence secret |
| `PaymentRequest` -> `purchaseToken` -> backend | done (`purchasePlaySubscription`, then `POST /api/license/redeem-play`) |
| Verify via Android Publisher v3 | done, and the endpoint URL in this directive is exactly right — confirmed by direct experiment |
| `crypto.subtle` instead of Node crypto | REQUIRED and done: workerd's `nodejs_compat` lacks `createSign`, so `api/_firebase.js#signJwt` uses WebCrypto |
| Store state + expiry | done, and richer than this: `sales`/`licenses`/`entitlements`/`playTokens`, plus a `source=ls|play` column so one accountant CSV covers both merchants |
| Graceful fallback outside the TWA | done — and this directive's advice was RIGHT where our first implementation was wrong: the Play build used to HIDE the Lemon Squeezy checkout everywhere, including browser tabs where Play Billing cannot work (a dead-end purchase). Fixed in v0.3.3 |
| **Digital Asset Links** | **ABSENT FROM THIS DOCUMENT — and it is MANDATORY.** `getDigitalGoodsService` answers `OperationError: unsupported context` until the INSTALLED app's signing certificate is listed in `https://<origin>/.well-known/assetlinks.json`. Play publishes three identities (classical app-signing, post-quantum app-signing, developer upload); this repo listed those three, yet the device's own `base.apk` carried a FOURTH fingerprint that was not in the file. Read the certificate off the DEVICE with `tools/cert-fingerprint.mjs` — never from the console |
| **Play Console billing permissions** | **ABSENT FROM THIS DOCUMENT.** The service account must be invited in Play Console -> **Users and permissions** with *"View financial data, orders, and cancellation survey responses"* AND *"Manage orders and subscriptions"*. **The invite SAVES BOTH UNCHECKED** while the account still shows as active with app access. Keys are issued only in Google Cloud (IAM & Admin -> Service Accounts -> Keys); `Setup -> API access` is a dead nav path |
| Env var shape | this directive's split (`..._EMAIL` + `..._PRIVATE_KEY`) is BETTER than the single JSON blob this repo used: with separate variables the service-account **identity is visible at a glance**, whereas one opaque `GOOGLE_PLAY_SERVICE_ACCOUNT` silently held the Firebase admin key for most of a session and surfaced only as an opaque `400 Invalid Value`. `api/_play.js` now logs the identity on load and rejects a `firebase-adminsdk` key by name |
| Validation rule here | the directive checks only `expiryTimeMillis > now`. The live server additionally requires `paymentState === 1` and that the purchaser email matches the signed-in account (`play-email-mismatch`) — stricter, and the source of its own failure modes |

**Verdict:** useful as an implementation checklist, misleading as a setup guide.
Follow its code shape; take the DAL file and the Play Console permissions from
`skills/paywall-ops.md` §10. Nothing in this document would have prevented the
two failures that actually blocked the launch.
