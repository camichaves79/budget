# Next-session prompt — Play Billing E2E (hand-off)

> Paste the block below into a fresh session to continue this work. It is
> self-contained: the new session should read the three docs it names before
> touching anything. Written 2026-09-11 at the end of the session that shipped
> v0.3.0 and stood up the staging environment.

---

Continue the $5 Budget project in /Users/camichaves/Development/deepseek/budget
(repo github.com/camichaves79/budget, currently main @ v0.3.0).

READ FIRST: skills/project-skill.md §10 (current state + next-session context),
skills/paywall-ops.md §10 (Play Billing ops), ARCHITECTURE.md A18 + A19.

WHERE WE ARE
- **Production is healthy and untouched**: `5budget.app` (Pages project `budget`,
  production branch `main`) + `api.5budget.app` (Worker `budget-api`) at v0.3.0.
  476 smoke checks, lint 5 warnings / 0 errors.
- **Staging now exists and is verified end to end (v0.3.0, ADR A19)**: Pages
  project `budget-staging` (production branch `staging`) at `staging.5budget.app`
  + Worker `budget-api-staging` at `api-staging.5budget.app`. Its env points at
  the staging API and deliberately omits `VITE_CHECKOUT_URL`,
  `VITE_PLAY_SUBSCRIPTION_ID` and `VITE_FIREBASE_*`, so the money path and
  identity are inert there; `VITE_ENV_LABEL=staging` renders a STAGING badge. A
  real smart-entry parse on staging was confirmed by the user. **Do all web
  development on staging or a feature-branch preview; only `main` reaches real
  users.**
- **The Play Billing on-device purchase is still NOT done**, and it is not a repo
  problem. Chrome keeps the installed app out of TWA app mode, so
  `getDigitalGoodsService` answers `OperationError: unsupported context`. Every
  input was verified correct: the `assetlinks.json` statement is served 200 /
  `application/json` / no redirect with all three fingerprints matching Play
  Console character for character (classical `78:9C:A65F…FFE2`, upload
  `7EAE:C070…4395`, post-quantum `00:0617 52…B3B2`), the app-side
  `assetStatements`/`DelegationService`/`autoVerify`/billing `PaymentService` are
  present, Google's DAL API resolves all three statements from the phone, the
  start URL `/?src=play` does not redirect, and both Play endpoints are live.
- The proof that it is a *context* refusal, not a verification mismatch: the app
  displays a **Custom Tab toolbar** (URL bar visible with `display: standalone`),
  which per Chromium source means `isInTwaMode()` is false, which means either
  the Activity is not a `CustomTabActivity` at all (a WebAPK can never be) or the
  page verifier reports `FAILURE` — the only two ways that gate closes.
- **The agreed next move is device forensics with `adb`** (the user declined it
  once, then agreed): enable Developer options → USB debugging on the Xiaomi 14T
  Pro (HyperOS) and plug it into the Mac. `adb` (platform-tools 37.0.1) is
  already fetched on this machine and runs with
  `ANDROID_USER_HOME=/tmp/adbhome /tmp/pt/platform-tools/adb` (no elevated
  permissions; re-download from dl.google.com if /tmp was cleared). The exact
  read-only command set and what each line answers is in
  skills/project-skill.md §10 item 2 — start with
  `dumpsys package app.fivebudget` (the INSTALLED app's signing certificate, the
  one fact that could never be read without a cable) and the
  `TWAProviderPicker`/`TwaLauncher` + `cr_OriginVerifier` logcat lines.
- **Strongest unproven hypothesis**: the installed copy was delivered by Play
  **internal app sharing**, which Google re-signs with its own per-app key
  ("Every APK is re-signed with this test certificate, regardless of which
  certificate you used to sign your app" —
  https://support.google.com/googleplay/android-developer/answer/9844679). That
  certificate is not (and cannot be, unless we add it) in `assetlinks.json`,
  which would produce exactly this failure. Ask for the **Internal test
  certificate** fingerprint (Play Console → Test and release → Internal testing →
  Internal app sharing → Uploaders and testers tab) and compare it with the
  installed app's cert from `dumpsys`. Second candidate: androidbrowserhelper's
  `fallbackType: 'customtabs'` fallback, which opens a plain Custom Tab (no
  `EXTRA_LAUNCH_AS_TRUSTED_WEB_ACTIVITY`) when the provider cannot create a
  session.
- **Play-side state to re-establish**: the tester **invitation link stopped
  working**. Search-invisibility is normal for an unpublished testing-track app
  (access comes via the Console app or the invitation link), so the dead link is
  the anomaly — check that the track still has an active release and that the
  intended account is still a tester. Add the buying account to **License
  testing** so the purchase is free (`test_mode: true`), and remember the Play
  purchaser email must equal the app's signed-in account or the server answers
  `play-email-mismatch`.

GOAL THIS SESSION
1. Inventory the device with `adb` and settle the certificate/hosting-Activity
   question (does the installed app carry a certificate that is in
   `assetlinks.json`, and is the view a TWA, a plain Custom Tab, or a WebAPK?).
2. Depending on the answer: either add the missing certificate to
   `public/.well-known/assetlinks.json` (frontend-only, auto-deploys, no AAB
   rebuild — but ONLY if the certificate is a legitimate one for this app), or
   reinstall from the testing track under the account that will buy, or fix the
   fallback path.
3. Then finish the E2E purchase: TWA app mode → Subscribe · $5 USD/year → Play
   sheet with the "test purchase" notice → "License active ✓" → Firestore shows
   `sales`/`licenses`/`entitlements`/`playTokens` → the accountant CSV gains a
   row with `source=play`.

TRAPS THAT COST HOURS (all documented in detail in §10 / paywall-ops §10)
- `unsupported context` has exactly three causes (the `AppStoreBilling` feature,
  a non-`CustomTabActivity` host, or `isInTwaMode()` false); the user-facing copy
  says none of them. **`canPay=yes` is NOT a TWA signal** — it is true in an
  ordinary Chrome tab too, so never read it as evidence.
- Extra fingerprints in `assetlinks.json` are harmless; the rule (verified in
  `digital_asset_links_handler.cc`) is that **every certificate the INSTALLED app
  carries must be listed**. A correct-looking file still fails if the installed
  app carries a certificate you did not list.
- Chrome fetches `assetlinks.json` itself (no Play Services call), and a
  `kFailure` DELETES the stored success, while DNS/offline/5xx do not.
- Support mode (`?diag=1`) is read **once per JS session** — arm it in a browser,
  then fully close the app before relaunching, or the dump never appears.
- On Pages, a custom domain always serves that project's PRODUCTION deployment,
  and the environment-variables page has two independently-saved lists
  (Production / Preview); a missed save shows up as a byte-identical bundle hash
  after a redeploy.
- Worker dashboard variable edits stay a draft until the **Deploy** banner is
  clicked. Never add a second top-level `name` to `wrangler.toml`.
- Keep Bot Fight Mode / zone-wide security levels OFF: they would break Chrome's
  DAL fetch (`/.well-known/assetlinks.json`) and the LS/Play webhooks.

CONVENTIONS (unchanged)
- One kebab-case feature branch from main. Commit/push ONLY on the user's explicit
  say-so, with a patch/minor/major classification.
- Every commit bumps semver in package.json + package-lock.json +
  src/lib/version.ts + android/twa-manifest.json appVersionName.
- "ship" = commit → push branch → ff-merge → push main → delete branch.
  Frontend auto-deploys on push to main; web-only changes need no AAB rebuild.
  **Merge into `staging` when you want the change live on staging.**
- The user has no Cloudflare credentials, no gh CLI, and there is no JDK or
  Android SDK on this machine (Bubblewrap runs via `npx`); they do the dashboard,
  Play Console and AAB steps, and prefer to read labels off their own console
  rather than pasting URLs.
- Work ONE step (or sub-step) at a time with the user, and verify each step from
  this machine before moving on.
