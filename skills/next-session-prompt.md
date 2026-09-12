# Next-session prompt — $5 Budget (hand-off)

> Paste the block below into a fresh session. It is self-contained: the new
> session should read the docs it names before touching anything. Written
> 2026-09-12 at the end of the session that **closed the Play Billing E2E**
> (v0.3.15 + v0.3.16 + v0.3.17, main).

---

Continue the $5 Budget project in /Users/camichaves/Development/deepseek/budget
(repo github.com/camichaves79/budget, main @ v0.3.17).

READ FIRST: `skills/project-skill.md` §10 (the new top block supersedes the
older "one unknown" and "propagation" blocks), `skills/paywall-ops.md` §10 +
§10b, `skills/play-retry-runbook.md` (the full retry procedure and every trap),
ARCHITECTURE.md A18 + A19.

## PLAY BILLING E2E: SOLVED — do not re-litigate

A real purchase mints a licence through the whole chain (2026-09-12 18:19 -05):

    order       GPA.3305-9810-4634-23661 · COP 15,500 · paymentState 1 · acknowledged
    licence     7bc6ea9f-6926-40a4-866f-aa35bdd8dfd9 · uid smT0ykphpHhOA3tPdo5FchKmCyu1
                (camicha747@gmail.com) · active until 2027-09-12
    app         "License active ✓ — smart entry is unlimited."
    Firestore   sales + licenses + entitlements + playTokens all written
    CSV         two rows: the LS row + a source=play row

The purchase was KEPT at the user's instruction (no refund, no revoke);
renewal is due 2027-09-12. **The purchase is real, not a license-tester one** —
License testing was never set up, and `test_mode=false` does NOT indicate that:
the live Play resource no longer carries `purchaseType`.

There were TWO faults, both of which only surfaced once a genuine token existed,
and BOTH were found purchase-free before the retry:

1. **`GOOGLE_PLAY_PACKAGE_NAME` was unset on the production Worker.** With an
   empty package name the Play URL becomes `.../applications//purchases/...`,
   which Google answers with the generic `400 Invalid Value` — that was the
   original mystery behind the two charged-but-unlicensed purchases. The token
   was never at fault. The var had been set in the dashboard and was wiped by
   `wrangler deploy` (which runs on every push to `main` and overwrites
   plain-text dashboard vars while SECRETS survive). Fixed by declaring it in
   `wrangler.toml` `[vars]` with smoke checks that fail the suite if it goes.
2. **The ownership rule required `purchase.emailAddress`, which Google no longer
   returns** — so every real purchase would have answered
   `409 play-email-mismatch`. Fixed with `playOwnershipDecision`: strict email
   match when the field is present, otherwise the purchase token must not
   already be bound to another account (`playTokens/{token}` →
   `licenses/{lic}.uid`, i.e. first redemption binds it).

**Two repo claims are CORRECTED by measurement; do not quote the old ones:**
- `voidedpurchases.list -> 200` does **not** prove which service account the
  Worker holds — the Firebase admin key returns 200 for it too, and both keys
  return `400 Invalid Value` for every bogus token. The only identity signal is
  the Worker log line `play: authenticating as <client_email>` (v0.3.13).
- `400 Invalid Value` is evidence about neither the credential nor the token: an
  empty package segment in the URL produces it as well.

⚠️ **Known limitation, observed live:** Play bills the account that INSTALLED the
app (`Finsky: Account determined from installer data`), which need not be the
app's signed-in account — and with no buyer email to compare, the licence went to
the signed-in account. A purchase paid by one account can therefore entitle a
different signed-in account. Hardening is an open item (see below).

## OPEN ITEMS, in priority order

1. **Closed test: 12 testers × 14 continuous days** before production access can
   even be requested — the long pole, and the clock has not started.
2. **Real-time developer notifications** (Play Console → Pub/Sub PUSH →
   `https://api.5budget.app/api/webhooks/play`). Not needed for a purchase, but
   it is the ONLY mechanism that revokes an entitlement on refund/cancellation:
   today a refunded subscription leaves the app's local licence valid until its
   `exp` (the token is verified client-side).
3. **Ownership hardening** (the limitation above): either require the app to be
   signed in as the device's Play billing account where that is observable, or
   accept and document first-redemption binding — but decide it deliberately.
4. **Audit the Worker's dashboard-only plain-text vars** for other silent losses
   of the same kind (`LICENSE_DAILY_CAP`, `GEMINI_FALLBACK_MODEL`). Parse,
   admin-export, licence-check and all Play secrets were verified live on
   2026-09-12; the fallback model and daily cap were not separately confirmed.
   Anything non-secret belongs in `wrangler.toml` `[vars]`.
5. Set `info@5budget.app` as the Play **developer contact** and store-listing
   contact (unverified).
6. **`budget.playBuild` leak**: v0.3.3 honours a persisted flag only in a
   `standalone` context, which fixes ordinary tabs; whether the
   Chrome-installed PWA on the same device is covered was reasoned but **not
   re-tested on the device**.
7. `android/twa-manifest.json` `versionCode` is still 133 and only bumps on the
   next AAB build (this machine has no JDK/Android SDK).
8. Parked: Preview env vars on Pages; translation nits.

## DEVICE AND DASHBOARD FACTS THAT COST TIME (all measured 2026-09-12)

- **Restarting CHROME fixes `OperationError: clientAppUnavailable`** from
  `getDetails` (billing client stuck in `CONNECTING`); force-stopping Play Store
  or Play Services fixes nothing. This is NOT the old `unsupported context`
  fault.
- **`ITEM_ALREADY_OWNED` (7) with nothing owned** is the Play Store's persisted
  owned-items cache: `pm clear --cache-only com.android.vending` (Android 16 /
  HyperOS 3.0 supports the flag) + a fresh Play sync. It can take >2 minutes over
  adb and may kill Chrome — re-check `play-capture.mjs status` afterwards.
- **A refunded purchase can stay ACTIVE** and block purchases with "You're
  already subscribed" while Play Console lists no subscription. Revoke it with
  the service account: `POST …/purchases/subscriptions/smart_entry_yearly/
  tokens/{token}:revoke` -> HTTP 204.
- **The injected capture patch dies with the page**: a reload, a relaunch, or a
  Google sign-in reload. Install it AFTER sign-in, immediately before the
  purchase, and confirm with status.
- **This phone is a Xiaomi 14T Pro / HyperOS 3.0 (Android 16)** — don't send the
  user hunting through stock-Android menu paths; `pm`/`am` over adb usually does
  it, and the user prefers reading their own console labels.
- `adb` needs BOTH `HOME` and `ANDROID_USER_HOME` writable (`tools/adb/adb.sh`).
- `.smoke/` is wiped by every `npm test`; artifacts go to
  `/tmp/twa-forensics/<tag>`.

## CONVENTIONS (unchanged)

- One kebab-case feature branch from main. Commit/push ONLY on explicit say-so,
  with a patch/minor/major classification. Every commit bumps semver in
  `package.json` + `package-lock.json` + `src/lib/version.ts` +
  `android/twa-manifest.json` `appVersionName`.
- `ship` = commit → push branch → ff-merge → push main → delete branch.
  Frontend auto-deploys on push to main; the Worker deploys via
  `deploy-worker.yml` (`wrangler deploy`, no `--keep-vars` — see open item 4).
- **Never let a purchase be the first test of a path.** Guard the Play path
  purchase-free with, in order: `node tools/play-credentials-check.mjs
  ~/Desktop/budget-app-11d48-2acaa9d4ef00.json` (tokenless, must be 200),
  `node tools/verify-redeem-play.mjs --sa <firebase-admin-key>
  --email <account>` (a bogus token must answer `play api 400 … Invalid Value`,
  which proves the Worker reaches Play with the right package), and the device
  checks (`twa-display-mode.mjs`, `getDetails`).
- The Play service-account key lives at
  `~/Desktop/budget-app-11d48-2acaa9d4ef00.json`
  (`play-billing@budget-app-11d48.iam.gserviceaccount.com`) — it is a secret,
  keep it out of the repo.
- The shared secret the app sends is `VITE_PARSE_SECRET`, checked against
  `BUDGET_PARSE_SECRET` — NOT `BUDGET_LICENSE_SECRET`.
- Keep Bot Fight Mode / zone-wide security OFF (it would break Chrome's DAL
  fetch and the LS/Play webhooks).

## TOOLING

    tools/play-capture.mjs            client-layer capture inside the live TWA (NEW)
    skills/play-retry-runbook.md      the retry procedure + every trap (NEW)
    tools/play-credentials-check.mjs  key parse -> OAuth -> authorization; --token for a real one
    tools/verify-redeem-play.mjs      drives the live redeem-play with a real Firebase id token
    tools/twa-display-mode.mjs        display-mode evaluation inside the live TWA
    tools/cert-fingerprint.mjs        JDK-free APK signing-cert reader
    tools/adb/adb.sh                  adb wrapper fixing the HOME/ANDROID_USER_HOME trap
    tools/adb/twa-forensics.sh        clears/sizes logcat buffers, captures the launch verdict
