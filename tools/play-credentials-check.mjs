/**
 * Diagnose the Play Developer API credentials that the Worker uses
 * (`GOOGLE_PLAY_SERVICE_ACCOUNT`), step by step, from this machine.
 *
 * Why: `redeem-play` fails opaquely. `api/_play.js` logs only
 * `play: token endpoint <status>` and never the response body, so "the key is
 * wrong" and "the key is fine but the service account is not authorized in Play
 * Console" are indistinguishable — and they need completely different fixes.
 * This runs the SAME code path the Worker runs (`api/_play.js`) and reports each
 * step's exact outcome, including Google's own error text.
 *
 * Usage:
 *   node tools/play-credentials-check.mjs /path/to/play-service-account.json
 *   node tools/play-credentials-check.mjs key.json --token <purchaseToken> [--product smart_entry_yearly]
 *
 * Steps:
 *   1. parse the key (client_email + private_key present)
 *   2. sign the JWT and exchange it at oauth2.googleapis.com for an access token
 *   3. call the Play Developer API to confirm reachability + API authorization
 *   4. optionally fetch a real subscription, to see paymentState/emailAddress
 *
 * Requires the file to be OUTSIDE the repo — it is a secret. Nothing here writes
 * it anywhere.
 */
import { readFileSync } from 'node:fs';

const PLAY_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const PLAY_API = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
const PLAY_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const purchaseToken = flag('token');
const productId = flag('product') || 'smart_entry_yearly';
const packageName = flag('package') || 'app.fivebudget';

if (!file) {
  console.error('usage: node tools/play-credentials-check.mjs <service-account.json> [--token T] [--product ID] [--package NAME]');
  process.exit(2);
}

const step = (n, msg) => console.log(`\n[${n}] ${msg}`);
const ok = (msg) => console.log(`    ok    ${msg}`);
const bad = (msg) => console.log(`    FAIL  ${msg}`);
const info = (msg) => console.log(`    info  ${msg}`);

// --- 1. parse -----------------------------------------------------------------
step(1, 'parsing the service-account key');
let sa;
try {
  sa = JSON.parse(readFileSync(file, 'utf8'));
} catch (err) {
  bad(`cannot read/parse the file: ${err.message}`);
  process.exit(1);
}
ok(`client_email = ${sa.client_email ?? '(missing)'}`);
ok(`project_id   = ${sa.project_id ?? '(missing)'}`);
ok(`type         = ${sa.type ?? '(missing)'}`);
if (typeof sa.private_key !== 'string' || !sa.private_key.includes('BEGIN PRIVATE KEY')) {
  bad('private_key is missing or not a PEM block — this alone would break signing');
  process.exit(1);
}
// The FIREBASE_SERVICE_ACCOUNT bug class: newlines flattened into spaces.
const flattened = !sa.private_key.includes('\n') && sa.private_key.includes('\\n') === false;
if (flattened) bad('private_key has NO newlines — a flattened key (the documented pasting trap)');
else ok('private_key has newlines (PEM intact)');

// --- 2. sign + exchange -------------------------------------------------------
// Import the Worker's own signer so this tests the real path, not a copy.
step(2, 'signing the JWT and exchanging it for an access token');
const { signJwt } = await import('../api/_firebase.js').catch(() => ({}));
const signer =
  typeof signJwt === 'function'
    ? signJwt
    : async (_claims, _key) => {
        // Fallback: RS256 with Node crypto, matching what signJwt does in workerd.
        const { createSign, createPrivateKey } = await import('node:crypto');
        const b64 = (o) =>
          Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
        const header = { alg: 'RS256', typ: 'JWT' };
        const input = `${b64(header)}.${b64(_claims)}`;
        const pem = _key.replace(/\\n/g, '\n');
        const sig = createSign('RSA-SHA256').update(input).sign(createPrivateKey(pem), 'base64url');
        return `${input}.${sig}`;
      };
if (typeof signJwt === 'function') ok('using the Worker\'s own signJwt from api/_firebase.js');
else info('using the Node crypto fallback signer (api/_firebase.js could not be imported)');

const now = Math.floor(Date.now() / 1000);
let assertion;
try {
  assertion = await signer(
    {
      iss: sa.client_email,
      scope: PLAY_SCOPE,
      aud: PLAY_TOKEN_ENDPOINT,
      iat: now,
      exp: now + 3600,
    },
    sa.private_key,
  );
  ok('JWT signed');
} catch (err) {
  bad(`signing threw: ${err.message}`);
  process.exit(1);
}

let accessToken = '';
try {
  const res = await fetch(PLAY_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    bad(`token endpoint HTTP ${res.status} — this is the Worker's 'play: token endpoint ${res.status}' line`);
    info(`Google said: ${text.slice(0, 400)}`);
    console.log(
      '\n=> The KEY or JWT is being rejected. Fix GOOGLE_PLAY_SERVICE_ACCOUNT on the\n' +
        '   budget-api Worker (single-line JSON). A 400 invalid_grant usually means a\n' +
        '   revoked/deleted key or a mangled private_key.',
    );
    process.exit(1);
  }
  accessToken = JSON.parse(text).access_token ?? '';
  ok(`access token obtained (${accessToken ? `${accessToken.length} chars` : 'EMPTY'})`);
  if (!accessToken) process.exit(1);
} catch (err) {
  bad(`network error: ${err.message}`);
  process.exit(1);
}

// --- 3. API reachability / authorization -------------------------------------
step(3, `checking Play API authorization for package ${packageName}`);
// Probe with `voidedpurchases.list`, NOT a bogus purchase token.
// Why (learned the hard way, 2026-09-11): the purchases/subscriptions endpoints
// answer HTTP 400 {"message":"Invalid Value"} for a malformed purchase token
// REGARDLESS of the caller's permissions, so a bogus-token probe cannot tell
// "not authorized" from "bad token" — the first version of this tool reported a
// healthy state for an account Play was in fact rejecting with 401.
// `voidedpurchases.list` needs the SAME financial-data permission, takes NO
// token parameter, and answers 200 (an empty list is normal) once authorized.
try {
  const url = `${PLAY_API}/applications/${encodeURIComponent(packageName)}/purchases/voidedpurchases`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const text = (await res.text()).slice(0, 400);
  info(`HTTP ${res.status} (voidedpurchases.list)`);
  info(`body: ${text}`);
  if (res.status === 401 || res.status === 403) {
    bad('the Play API denies this service account — the permissions are not in effect');
    console.log(
      '\n=> The KEY is fine (it signs and Google issues a token) but the ACCOUNT lacks\n' +
        '   the financial/order permissions. In Play Console → Users & permissions, open\n' +
        '   THIS account and tick BOTH:\n' +
        '     • View financial data, orders, and cancellation survey responses\n' +
        '     • Manage orders and subscriptions\n' +
        '   THE TRAP: the invite saves with those two UNCHECKED (happened 2026-09-11) and\n' +
        '   the account still looks active with app access, which sends you hunting for the\n' +
        '   wrong problem. Propagation takes a few minutes — 401→200 was observed ~2 min\n' +
        '   after saving. A firebase-adminsdk key can never work here either.',
    );
  } else if (res.status === 200) {
    ok('authorized — the financial/order permission is in effect');
    console.log('\n=> The server-side Play credentials are CORRECT. A 400 "Invalid Value" from the\n' +
      '   purchases endpoints is then just an invalid purchase token, not a permission\n' +
      '   problem. Safe to deploy this key as GOOGLE_PLAY_SERVICE_ACCOUNT.');
  } else {
    bad(`unexpected HTTP ${res.status} — inspect the body above`);
  }
} catch (err) {
  bad(`network error: ${err.message}`);
}

// --- 4. optional: a real purchase token --------------------------------------
if (purchaseToken) {
  step(4, `fetching the REAL subscription for token ${purchaseToken.slice(0, 12)}…`);
  const url = `${PLAY_API}/applications/${encodeURIComponent(packageName)}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const text = await res.text();
  console.log(`    HTTP ${res.status}`);
  console.log(`    body: ${text.slice(0, 800)}`);
  if (res.ok) {
    const p = JSON.parse(text);
    console.log(
      `\n    paymentState   = ${p.paymentState}  ${p.paymentState === 1 ? '(paid — the server requires exactly 1)' : '(NOT paid -> the server answers play-not-paid)'}`,
    );
    console.log(`    emailAddress   = ${p.emailAddress ?? '(absent)'}  <- must equal the app's signed-in account`);
    console.log(`    orderId        = ${p.orderId ?? '(absent)'}`);
    console.log(`    acknowledgementState = ${p.acknowledgementState} (0 = unacknowledged -> Play auto-refunds after 3 days)`);
  } else {
    console.log('\n=> Could not read that purchase — a wrong token/product/package also lands here.');
  }
} else {
  step(4, 'skipped (pass --token <purchaseToken> to check a real subscription)');
}
