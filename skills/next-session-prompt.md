# Next-session prompt — Play Billing E2E (hand-off)

> Paste the block below into a fresh session. It is self-contained: the new
> session should read the docs it names before touching anything. Written
> 2026-09-11 at the end of the session that **fixed the TWA/DAL blocker and the
> Play credential** and shipped v0.3.11.

---

Continue the $5 Budget project in /Users/camichaves/Development/deepseek/budget
(repo github.com/camichaves79/budget, currently main @ v0.3.11).

READ FIRST: skills/project-skill.md §10 (current state + next-session context),
skills/paywall-ops.md §10 (Play Billing ops, incl. the CURRENT Play Console /
Google Cloud paths), ARCHITECTURE.md A18 + A19.

## DO THIS FIRST — WAIT 24 HOURS, THEN RETRY ★

Google's own [`chromeos/pwa-play-billing`](https://github.com/chromeos/pwa-play-billing)
sample says, verbatim:

> *"Note that this takes a good while to propagate, so if you are getting
> permission errors while trying to make purchases, you need to **wait up to 24
> hours**. Note that the permissions seem to **propagate in STAGES**, so it is
> possible to **successfully purchase an item and then get errors while
> confirming it**. If this happens just wait a little more!"*

That is exactly this failure. The two billing permissions were ticked at
**~17:24**; stage 1 propagated within ~2 minutes (the API moved 401 -> 400) and
the failing purchase followed shortly after. So **the first action of the next
session is a retry a full day after the grant**, on a licence-tester account
(free). If it mints, this whole thing was propagation and the two refunded
charges were never a code defect.

Only if it STILL returns `play: subscriptions.get 400 Invalid Value` after 24h
should you work the token-decode path below.

Also read `configure.md` in the repo root — it is a condensation of Google's
own guidance (same `serviceAccountEmail` + `serviceAccountPrivateKey` shape as
the official sample), and the repo now carries a status table mapping it to this
implementation.

## THE ONE REMAINING UNKNOWN (only if the 24h retry fails)

A real Play purchase charges the buyer and returns a purchase token, and the
Worker's verification of that token fails:

    play: subscriptions.get 400 Invalid Value     -> HTTP 503, no license minted

The Worker, the credential and the endpoint are all now verified good, so this
400 is about the TOKEN VALUE. Two charges were made and both were refunded, yet
Play's Purchase history and Play Console's Order management show **no order at
all** — unreconciled, and possibly the clue itself.

NEXT SESSION, in order:
1. **One free license-tester purchase** on an account that has never bought, with
   all three layers captured simultaneously — that is the whole point, since
   every previous attempt was missing at least one layer:
   - **Cloudflare**: Workers & Pages -> `budget-api` -> Logs -> **Begin log
     stream**. v0.3.11 makes the Worker log a safe `tokenFingerprint` (len / head
     / tail / dot-segments / whitespace / charset) plus Google's FULL error body.
     The line to read is `play: subscriptions.get 400 {...}`.
   - **Device**: `tools/adb/twa-forensics.sh start wallet` clears and sizes the
     logcat buffers; `stop wallet` captures the verdict. Launch the app BEFORE
     attaching the client capture, because the DevTools page target only exists
     while the app is running.
   - **Client**: attach the fetch interceptor to the live page (snippet in §10)
     to record the exact request body — the purchaseToken's length/head/tail and
     the productId exactly as the APP sent them.
2. **Decode the token.** A Google Play purchase token carries a base64 payload
   naming the package and product it was issued for. If it names anything other
   than `app.fivebudget` / `smart_entry_yearly`, that alone explains the 400 and
   needs no further purchase. Watch for whitespace or truncation — the
   fingerprint reports both.
3. If the token looks perfect and still 400s, the open hypotheses are: the
   purchase belongs to a different Google account than the app signs in with; the
   purchase is pending/incomplete on Google's side; or the classic
   `purchases.subscriptions` resource rejects a token Play is still settling.
   Capture a fresh token and repeat step 1 rather than guessing.

## WHAT IS NOW SOLVED (do not re-litigate)

- **`OperationError: unsupported context` — FIXED and verified on the device.**
  The root cause was a **fourth signing certificate**
  (`ED:93:38:AE:20:F3:92:27:E2:6D:AE:8B:EE:6B:85:B9:86:F8:20:9D:2C:24:ED:74:A6:EA:CB:FA:C9:13:6C:15`)
  that the installed app carries and `assetlinks.json` did not list. Adding it
  (now entry #1; all originals kept) flipped the device from
  `5budget.app: 1024` (STATE_VERIFICATION_FAILURE) to **`verified`**, removed
  Chrome's `Statement failure matching fingerprint`, and turned TWA app mode ON.
  Proof: `getDigitalGoodsService('https://play.google.com/billing')` -> **OK**,
  returning `smart_entry_yearly`, COP 15,500, `subscriptionPeriod P1Y`, with
  `canPay: true` and `display-mode: standalone` (no `browser`).
- **Both earlier hypotheses are dead, with evidence**: the
  androidbrowserhelper `customtabs` fallback never fired
  (`TWAProviderPicker: Found TWA provider` + `TwaLauncher: Launching Trusted Web
  Activity`), and the install is a real Play split install from
  `com.android.vending` — not an internal-app-sharing re-sign.
- **The Play credential is correct.** `GOOGLE_PLAY_SERVICE_ACCOUNT` had been the
  FIREBASE admin key, which can never call the Play API. A purpose-built
  `play-billing@budget-app-11d48.iam.gserviceaccount.com` now exists, is invited
  in Play Console with BOTH billing permissions, and passes the check that cannot
  lie — the tokenless `voidedpurchases.list` -> **HTTP 200**.
- **The "dead invitation link"** was an account mismatch: the phone was signed
  into a different Play account than the tester list held.

## TRAPS THAT COST TIME THIS SESSION (also in §10 / paywall-ops §10)

- **`400 Invalid Value` is NOT evidence of a working credential.** It is the
  generic bad-token response for `purchases.*`: every synthetic token shape
  returns it, with a good key AND with the Firebase key. Only the tokenless
  `voidedpurchases.list -> 200` proves authorization. (The first version of
  `tools/play-credentials-check.mjs` got this wrong; fixed.)
- **A Play Console invite SAVES THE TWO BILLING PERMISSIONS UNCHECKED.** The
  account still looks active with app access. Tick *"View financial data, orders,
  and cancellation survey responses"* AND *"Manage orders and subscriptions"*;
  propagation took ~2 minutes (401 -> 400 -> 200).
- **`Setup → API access` is a DEAD NAV PATH.** Keys come only from Google Cloud
  (IAM & Admin -> Service Accounts -> Keys); the API is enabled in Google Cloud;
  Play Console only GRANTS permission (Users & permissions). No GCP-project
  linking is needed any more.
- **Cloudflare secret edits stay a DRAFT until Deploy is clicked.** Prefer
  `npx wrangler secret put <KEY> --env=""` (the `--env=""` is required because
  `wrangler.toml` declares `[env.staging]`), which deploys immediately.
- **The shared secret the app sends is `VITE_PARSE_SECRET`**, checked against
  **`BUDGET_PARSE_SECRET`** — NOT `BUDGET_LICENSE_SECRET`. The wrong one gives a
  bare 401 before any Play work happens.
- **`.dev.vars` is stale in two ways**: `BUDGET_LICENSE_SECRET` predates the
  2026-09-07 regeneration, and `FIREBASE_SERVICE_ACCOUNT` is a **placeholder**
  (`fake@local-test…`, no `private_key_id`) that cannot mint a token Firebase
  accepts. Use a real key with `--sa`.
- **`api/_firebase.js#signJwt` emits no `kid`**, but a Firebase CUSTOM token
  requires it — hence the probe's own signer.
- **`.smoke/` is wiped by every `npm test`** (it is the vite test build's
  `outDir`). Device tooling lives in `tools/adb/`; artifacts go to
  `/tmp/twa-forensics/`.
- **`adb` needs BOTH `HOME` and `ANDROID_USER_HOME`** set to a writable dir, or
  it aborts on `Cannot mkdir ~/.android`. `tools/adb/adb.sh` handles this.
- **Keep Bot Fight Mode / zone-wide security OFF** — it would break Chrome's DAL
  fetch and the LS/Play webhooks, undoing the fix.

## TOOLING ADDED (all committed)

    tools/cert-fingerprint.mjs        JDK-free APK signing-cert reader (APK v2/v3 block)
    tools/twa-display-mode.mjs        reads display-mode/app mode inside the LIVE TWA via DevTools
    tools/play-credentials-check.mjs  3-step Play credential check (parse -> OAuth -> authorization)
    tools/verify-redeem-play.mjs      drives the real redeem-play with a real Firebase ID token
    tools/adb/adb.sh                  adb wrapper fixing the HOME/ANDROID_USER_HOME trap
    tools/adb/twa-forensics.sh        clears/sizes logcat buffers, captures the launch verdict

Reading the device without eyes: `tools/adb/adb.sh shell uiautomator dump
/sdcard/ui.xml` plus grep `text="…"` prints the whole rendered UI (that is how
the "already subscribed" dialog was read). DevTools reads the signed-in account
and the LOADED BUNDLE HASH — note a stale bundle survived a normal relaunch and
only a `Page.reload` with `ignoreCache` cleared it.

## CONVENTIONS (unchanged)

- One kebab-case feature branch from main. Commit/push ONLY on explicit say-so,
  with a patch/minor/major classification. Every commit bumps semver in
  `package.json` + `package-lock.json` + `src/lib/version.ts` +
  `android/twa-manifest.json` `appVersionName`.
- `ship` = commit -> push branch -> ff-merge -> push main -> delete branch.
  Frontend auto-deploys on push to main; the Worker deploys via
  `deploy-worker.yml`. Web-only changes need no AAB rebuild.
- The user has no Cloudflare credentials locally, no gh CLI, and no JDK or
  Android SDK on this machine. They do the dashboard, Play Console and AAB steps,
  and prefer to read labels off their own console rather than paste URLs.
- Work ONE step at a time, and verify each step from this machine before moving
  on. **Never let a purchase be the first test of a path** — that is what
  produced two charges with no entitlement.

## OTHER OPEN ITEMS (non-Play)

- **Closed test: 12 testers × 14 continuous days** before production access can
  even be requested — the long pole, and the clock has not started.
- Set `info@5budget.app` as the Play **developer contact** and store-listing
  contact (unverified).
- **`budget.playBuild` leak**: the flag persists in the localStorage shared
  between the TWA and Chrome, and it *hides the LS checkout* in browser contexts
  while offering a Play button that cannot work there. v0.3.3 honours it only in
  a `standalone` display context, which fixes ordinary tabs; whether the
  Chrome-installed PWA on the same device is covered too was reasoned but **not
  re-tested on the device**. Worth verifying.
- Parked: Preview env vars on Pages; translation nits.
