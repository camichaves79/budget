# Play Billing retry — operational runbook (2026-09-11 late → 2026-09-12)

Written at the START of the session that was told to "wait for the 24 h mark and
retry the purchase". It records what that session found BEFORE the wait, because
one of the findings invalidates part of `skills/next-session-prompt.md`.

## 0. Read this first — two measurements taken 2026-09-11 ~22:15

**(a) The production Worker was MISSING `GOOGLE_PLAY_PACKAGE_NAME` — FIXED and
re-verified at 2026-09-12 10:13.** Not a hypothesis — the live endpoint said so
itself, twice, on 2026-09-11 ~22:15:

```bash
node tools/verify-redeem-play.mjs --sa ~/Desktop/budget-app-11d48-firebase-adminsdk-fbsvc-56556dae7a.json --email camicha747@gmail.com
# BEFORE (2026-09-11 22:15):
#   HTTP 503 {"ok":false,"code":"play-not-configured",
#             "reason":"GOOGLE_PLAY_PACKAGE_NAME is not set on the worker"}
# AFTER the v0.3.15 deploy (2026-09-12 10:13):
#   HTTP 503 {"ok":false,"code":"play-not-configured",
#             "reason":"play api 400 for app.fivebudget — Invalid Value (invalid)"}
```

The second line is the probe's SUCCESS case: the Worker now builds a real Play
URL, reaches the API with the package name set, and Google rejects only the
deliberately bogus token. Before the fix a retry could not have reached the Play
API at all, so it would have proved nothing about the purchase, the token or
propagation.

**Why it went missing.** `deploy-worker.yml` runs `wrangler deploy` on every push
to `main`, which uploads the bindings `wrangler.toml` declares — a plain-text
variable that exists only in the dashboard is overwritten by it, while **secrets
survive** (Cloudflare cannot re-send a secret it never sees). Measured: the var
was set in the dashboard at ~18:00 on 2026-09-11 and was gone by 22:15, after
four pushes to main, while `GOOGLE_PLAY_SERVICE_ACCOUNT`,
`FIREBASE_SERVICE_ACCOUNT` and `BUDGET_PARSE_SECRET` were all still live (the
probe got past the shared secret, past id-token verification, and Google issued
an access token). See [workers-sdk#8871](https://github.com/cloudflare/workers-sdk/issues/8871)
and [#4453](https://github.com/cloudflare/workers-sdk/issues/4453).

**Why it is the prime suspect for the unexplained 400.** With an empty package
name the URL collapses to `.../applications//purchases/subscriptions/...`, which
Google answers with the same generic `400 Invalid Value` a bad purchase token
gets — and before v0.3.6 nothing logged the value, so the failure was invisible
and indistinguishable. The failing purchase (~16:00, 2026-09-11) ran on
pre-v0.3.6 code, and the guard's own message was first seen at ~17:55, which says
the variable was unset for that purchase.

**The fix is durable**: `GOOGLE_PLAY_PACKAGE_NAME` and
`GOOGLE_PLAY_SUBSCRIPTION_ID` are now declared in `wrangler.toml` `[vars]`
(v0.3.15), so every deploy re-applies them, and three smoke checks pin them there
so this regression fails the suite instead of a purchase.


**(b) The "fingerprint" that identified the wrong key does not exist.** The repo
says the Firebase admin key can never call the Play API and that the tokenless
probe distinguishes the two keys. Measured, with a purpose-built matrix script,
on 2026-09-11 at 22:20:

| call | `play-billing@` key | `firebase-adminsdk-fbsvc@` key |
|---|---|---|
| `voidedpurchases.list` (no token) | **HTTP 200** | **HTTP 200** |
| `subscriptions.get` bogus 6-char token | 400 Invalid Value | 400 Invalid Value |
| `subscriptions.get` bogus 40-char token | 400 Invalid Value | 400 Invalid Value |
| `subscriptions.get` bogus dotted token | 400 Invalid Value | 400 Invalid Value |
| `subscriptions.get` bogus 60-char token | 400 Invalid Value | 400 Invalid Value |

So: `voidedpurchases.list → 200` proves the **financial permission** is in effect
for the account that called it, but it does **not** prove which key the Worker
holds; and `400 Invalid Value` proves nothing about the key either (it is the
generic bad-token answer under both). The declared fingerprint
("Firebase key → 401 permissionDenied") is **not reproducible**. The only
reliable identity signal is the Worker's own log line introduced in v0.3.13:
`play: authenticating as <client_email>`.

Consequence: the 400 on the real purchase token is still unexplained, and it is
NOT explained by "the Worker held the Firebase key" — both keys answer
identically for a bad token. The live possibilities remain (in order):
1. the Play Console permission grant had not finished propagating when that
   purchase was redeemed (Google's own 24 h / staged-propagation note);
2. the token itself (wrong package/product, whitespace/truncation, or a purchase
   Play was still settling) — which the v0.3.11 fingerprint will now show;
3. something Play-side about a brand-new subscription product.

## 1. Preconditions — ALL must be green before a purchase is attempted

| # | precondition | how it is checked | state 2026-09-12 10:15 |
|---|---|---|---|
| 1 | `GOOGLE_PLAY_PACKAGE_NAME` = `app.fivebudget` | `node tools/verify-redeem-play.mjs …` → reason must be `play api 400 … Invalid Value`, NOT "is not set on the worker" | ✅ fixed (v0.3.15, declared in `wrangler.toml`) |
| 2 | the Play service account's financial permission is live | `node tools/play-credentials-check.mjs ~/Desktop/budget-app-11d48-2acaa9d4ef00.json` → `[3] … HTTP 200` | ✅ 200 |
| 3 | the Worker holds the right key | Cloudflare → Workers & Pages → `budget-api` → **Logs** (observability is on, so logs are retained) → search `play: authenticating as` | ⏳ 2-minute dashboard check — worth doing BEFORE the purchase |
| 4 | the device is a TWA in app mode | `tools/adb/adb.sh devices` (phone on USB) then `node tools/twa-display-mode.mjs` → `display-mode standalone`, no `browser` | ⏳ no device attached |
| 5 | the buying account is on **License testing** | Play Console → Testing → License testing | ⏳ user is adding it before the retry (otherwise: a REAL COP 15,500 charge) |
| 6 | the Play purchaser email == the app's signed-in account | switch the Play Store account if needed | ⏳ |
| 7 | no Play row exists yet (baseline) | `ADMIN=$(sed -n 's/^BUDGET_ADMIN_SECRET=//p' .dev.vars); curl -s -H "x-budget-admin: $ADMIN" "https://api.5budget.app/api/ledger/export?format=csv"` | ✅ exactly 1 row (`source=ls`, order `4681231`) |

The 24 h mark from the permission grant (~17:24 on 2026-09-11) is
**2026-09-12 17:24 (-05)** — the same day this runbook was finished, ~7 h later.
Do not purchase before then.

**Note the frontend redeployed with `main` (v0.3.15).** The app's bundled Play
code is unchanged, but the TWA can serve a stale bundle: if anything looks like
the old build, reload the page with `ignoreCache` over DevTools (the loaded
bundle hash is readable with `tools/twa-display-mode.mjs`-style evaluates).

## 2. At the mark — the retry, in order

```bash
# 0. phone on USB, app installed, capture patch FIRST (a reload drops it)
tools/adb/adb.sh devices
tools/adb/adb.sh forward tcp:9222 localabstract:chrome_devtools_remote
tools/adb/twa-forensics.sh start retry24h        # clears + sizes logcat buffers
# launch the app ON THE PHONE (the DevTools page target only exists while it runs)
node tools/twa-display-mode.mjs                  # must be app mode: standalone, no browser
node tools/play-capture.mjs install              # patch fetch in the live page
node tools/play-capture.mjs status               # confirm: "patch installed …"

# 1. Sign in with the SAME Google account that owns the Play purchase, then
#    tap Subscribe and complete the free license-tester purchase.

# 2. client layer — the exact token the app sent + the server's own reply
node tools/play-capture.mjs dump --raw

# 3. ask Google DIRECTLY with that token (no Worker, no Cloudflare dashboard)
node tools/play-credentials-check.mjs ~/Desktop/budget-app-11d48-2acaa9d4ef00.json \
  --token "$(cat /tmp/twa-forensics/playretry/client-token.txt)"

# 4. device layer + the entitlement question
tools/adb/twa-forensics.sh stop retry24h          # verdict.txt: TWA / billing lines
ADMIN=$(sed -n 's/^BUDGET_ADMIN_SECRET=//p' .dev.vars); curl -s -H "x-budget-admin: $ADMIN" "https://api.5budget.app/api/ledger/export?format=csv" | wc -l
```

## 3. How to read the result

| observation | meaning |
|---|---|
| client dump has no entry | the app never posted — the purchase flow stopped before redeem (TWA mode, sign-in, or the Play sheet). Read `verdict.txt`. |
| `reason` = `… is not set on the worker` | precondition #1 regressed again (a `wrangler deploy` wiped the var). |
| step 3 returns **200** but the Worker 503s | the token is valid → the fault is the Worker's configuration/identity (check `play: authenticating as …`). |
| step 3 returns **400/404** | the token itself is the problem — read the decoded payload from the dump (package/product must be `app.fivebudget` / `smart_entry_yearly`) and Google's message. |
| step 3 returns **200** and the Worker mints | the purchase worked end to end. Check the CSV for a `source=play` row and stop worrying about the two refunded charges. |
| `play-email-mismatch` (409) | with a buyer email present, the Play buyer and the signed-in account differ; without one, the token is already bound to another account. |

Never let a purchase be the first test of a path: run the whole of §1 (except
#5/#6) immediately before it, and re-run #1 after ANY push to `main`.

## 4. RESULT — the retry SUCCEEDED, 2026-09-12 18:19 (-05)

Run ~24 h 55 min after the permission grant, as a REAL purchase (the buyer chose
a real charge over waiting for a license-tester entry). Every layer was captured
at once, which is what no previous attempt managed.

```
client dump  POST /api/license/redeem-play -> 200
             body keys=[purchaseToken, productId, idToken] productId=smart_entry_yearly
             token len=123 head=anhohp… tail=…eO1Q whitespace=false segments=2 charset=url-safe
             reply {"ok":true,"license":"…lic=7bc6ea9f-6926-40a4-866f-aa35bdd8dfd9, plan=yearly,
                    uid=smT0ykphpHhOA3tPdo5FchKmCyu1, iat=1789255140, exp=1820791140"}
Google       subscriptions.get -> 200  paymentState=1  acknowledgementState=1
             orderId GPA.3305-9810-4634-23661  expiry 2027-09-12T23:19:00.879Z  autoRenewing=true
             (emailAddress: still ABSENT, as measured — see §0b)
Firestore    sales/GPA.3305-9810-4634-23661   source=play status=paid gross=1550000
                                              fees_estimate=232500 net_estimate=1317500
                                              license_id=7bc6ea9f… buyer_email=""
             licenses/7bc6ea9f…               source=play status=active uid=smT0yk…
             entitlements/smT0ykphpHhOA3tPdo5FchKmCyu1  lic=7bc6ea9f… plan=yearly
             playTokens/anhohp…eO1Q           license_id + orderId
ledger CSV   2 rows: the LS row + play,…,GPA.3305-9810-4634-23661,paid,1550000,…,1317500,COP
app          "License active ✓ — smart entry is unlimited."
             "Unlimited license · Unlimited smart entry until Sep 12, 2027 · Active"
artifacts    /tmp/twa-forensics/retry24h3
```

The purchase was KEPT (no refund, no revoke): a real, acknowledged subscription,
renewal due 2027-09-12. `test_mode=false` says nothing about license testing —
the live resource no longer carries `purchaseType`, so the ledger maps it false
either way.

**Both real faults were found BEFORE the purchase, purchase-free** — do this on
every future Play change:
1. `GOOGLE_PLAY_PACKAGE_NAME` unset on the Worker (v0.3.15). An empty package
   name collapses the URL to `.../applications//purchases/...`, which Google
   answers with the generic `400 Invalid Value` — THE original mystery. The token
   was never at fault: Google returns 200 for it, and so does the Worker's own
   `getSubscription` once the package name is set.
2. The ownership rule required `purchase.emailAddress`, which Google no longer
   returns, so EVERY real purchase would have answered `409 play-email-mismatch`
   (v0.3.16). Fixed with `playOwnershipDecision`: strict email when present,
   otherwise bind the token to the first redeeming account.

## 5. Traps that cost time on the retry (all measured)

- **Play picks the billing account from the INSTALLER**, not from the app's
  sign-in: `I/Finsky: app.fivebudget: Account determined from installer data -
  [obfuscated]`. The charge came from that account while the app was signed in as
  `camicha747@gmail.com`, and the licence went to the SIGNED-IN account because
  the buyer email is not available to compare. **So a purchase paid by one
  account can entitle another signed-in account** — the ownership proof is
  possession of the token plus first-redemption binding, and that limitation is
  real, not theoretical.
- **`getDigitalGoodsService` OK but `getDetails` → `OperationError:
  clientAppUnavailable`, and a Subscribe tap that does nothing**: the billing
  client inside the long-running Chrome process was stuck in `CONNECTING`. Fix =
  restart **Chrome** (`am force-stop com.android.chrome`, then relaunch the TWA).
  Force-stopping Play Store and Play Services did nothing, and a page reload did
  nothing. Unrelated to the older `unsupported context` fault.
- **After a refund+revoke Play still answers `ITEM_ALREADY_OWNED` (7)**
  (`TwaBilling.P: Purchases updated: 7`, the flow returning in <100 ms without
  ever rendering the sheet) while `subscriptions.get` says
  `SUBSCRIPTION_STATE_EXPIRED` and `listPurchases()` returns 0 owned. That is the
  Play Store app's persisted owned-items cache:
  `pm clear --cache-only com.android.vending` (supported on Android 16 /
  HyperOS 3.0) plus a fresh Play sync cleared it, and the next tap opened the
  sheet.
- **`pm clear --cache-only com.android.vending` can take >2 minutes over adb**,
  and a killed shell may leave Chrome dead too — which destroys the injected
  `tools/play-capture.mjs` patch. Always re-run `play-capture.mjs status` after
  any device-side cleanup, and re-install if the bundle reloaded.
- **A refunded-but-unacknowledged purchase stays ACTIVE**: order
  GPA.3369-2577-4782-70001 was REFUNDED on 2026-09-11 and its resource still
  reported `SUBSCRIPTION_STATE_ACTIVE` until 2027 — the cause of the "You're
  already subscribed / no subscriptions listed" loop. Revoke it with the Play
  service account: `POST …/purchases/subscriptions/smart_entry_yearly/tokens/
  {token}:revoke` → HTTP 204, after which `listPurchases()` reports none.
- **`tokenless voidedpurchases.list -> 200` does not identify the key** — the
  Firebase admin key returns 200 too (§0b). Only `play: authenticating as
  <client_email>` names the identity.
- **A page reload or an app relaunch drops the injected capture patch**, and a
  Google sign-in can reload the page. Install it AFTER sign-in, immediately
  before the purchase, and confirm with `play-capture.mjs status`.
