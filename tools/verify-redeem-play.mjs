/**
 * Exercise `/api/license/redeem-play` END TO END from this machine, with a real
 * Firebase ID token, and report the server's exact answer.
 *
 * Why: a real Play purchase must never be the first thing that tests this path.
 * That is precisely how a charge produced no license and no diagnosis on
 * 2026-09-11. This mints an ID token the Worker will accept (a Firebase custom
 * token signed by FIREBASE_SERVICE_ACCOUNT, exchanged at Google's secure-token
 * endpoint) and then calls the endpoint with a deliberately invalid purchase
 * token. The reply tells us exactly how far the server got:
 *
 *   code=play-not-configured  -> a config value is missing, OR the API answered (reason says which; a 400 "Invalid Value" on a BOGUS token is the SUCCESS case)
 *   code=play-purchase-not-found -> Google answered 404: the credential WORKS and nothing was found
 *   code=play-email-mismatch  -> credential works AND a purchase was read
 *   code=sign-in-required / bad-id-token -> our own token was rejected
 *   code=unauthorized         -> wrong x-budget-secret
 *
 * Usage (secrets stay in .dev.vars; nothing is written to disk):
 *   node tools/verify-redeem-play.mjs [--email someone@example.com]
 */
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

/**
 * Sign an RS256 JWT WITH a `kid` header.
 *
 * `api/_firebase.js#signJwt` deliberately omits `kid` (the Worker never needs
 * it), but a Firebase CUSTOM token must carry `kid` = the service account's
 * `private_key_id`, or the secure-token exchange answers INVALID_CUSTOM_TOKEN.
 * Hence a local signer rather than reusing the Worker's.
 */
function signJwtWithKid(claims, privateKeyPem, kid) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = `${b64({ alg: 'RS256', typ: 'JWT', kid })}.${b64(claims)}`;
  const sig = createSign('RSA-SHA256')
    .update(input)
    .sign(privateKeyPem.replace(/\\n/g, '\n'), 'base64url');
  return `${input}.${sig}`;
}

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const email = arg('email', 'probe@example.com');
const API = arg('api', 'https://api.5budget.app');
const saPath = arg('sa', '');

// --- service account: prefer the real one on disk, fall back to .dev.vars -----
// `.dev.vars` ships a PLACEHOLDER account (fake@local-test...) for local runs, so
// it cannot mint a token Firebase will accept; pass --sa <real key.json>.
// --- shared secret ------------------------------------------------------------
// The value the app sends as `x-budget-secret` is VITE_PARSE_SECRET (see
// src/lib/licenseService.ts) and the Worker checks it against
// BUDGET_PARSE_SECRET — NOT BUDGET_LICENSE_SECRET. Sending the wrong one yields a
// bare 401 unauthorized before any Play work happens. .env is authoritative here
// because this exact value is present in the served bundle (verified 2026-09-11).
const envFile = {};
try {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = /^([A-Z_0-9]+)=(.*)$/.exec(line.trim());
    if (m) envFile[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  /* .env is optional */
}
const env = {};
for (const line of readFileSync('.dev.vars', 'utf8').split('\n')) {
  const m = /^([A-Z_0-9]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const secret = envFile.VITE_PARSE_SECRET || env.BUDGET_PARSE_SECRET || '';
let sa;
if (saPath) {
  sa = JSON.parse(readFileSync(saPath, 'utf8'));
} else {
  sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT ?? '{}');
}
if (!secret) {
  console.error('need VITE_PARSE_SECRET in .env (the value the app sends as x-budget-secret)');
  process.exit(2);
}
if (!sa.private_key || !sa.private_key_id) {
  console.error(
    'the service account has no private_key_id (the .dev.vars placeholder cannot mint\n' +
      'tokens). Pass a real key:  node tools/verify-redeem-play.mjs --sa ~/Desktop/<key>.json',
  );
  process.exit(2);
}
const projectId = sa.project_id;
const webKey = env.FIREBASE_WEB_API_KEY;
if (!webKey) {
  console.error('need FIREBASE_WEB_API_KEY in .dev.vars (it ships in the browser bundle)');
  process.exit(2);
}
console.log(`[0] service account ${sa.client_email} (project ${projectId})`);

// --- 1. mint a custom token ---------------------------------------------------
const now = Math.floor(Date.now() / 1000);
const customToken = signJwtWithKid(
  {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now,
    exp: now + 3600,
    uid: 'dsh-probe-uid',
    claims: { email },
  },
  sa.private_key,
  sa.private_key_id,
);
console.log(`[1] custom token minted for ${email}`);

// --- 2. exchange it for an ID token -------------------------------------------
const xr = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY ?? '')}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  },
);
const xt = await xr.text();
if (!xr.ok) {
  console.log(`[2] custom-token exchange HTTP ${xr.status}: ${xt.slice(0, 300)}`);
  console.log(
    '\n=> Needs a Web API key. Add FIREBASE_WEB_API_KEY=<the key from Firebase console →\n' +
      '   Project settings → Web API Key> to .dev.vars, or skip and let the app do the test.',
  );
  process.exit(1);
}
const idToken = JSON.parse(xt).idToken;
console.log(`[2] ID token obtained (${idToken.length} chars)`);

// --- 3. call the endpoint -----------------------------------------------------
const body = {
  purchaseToken: 'dsh-not-a-real-token',
  productId: env.GOOGLE_PLAY_SUBSCRIPTION_ID || 'smart_entry_yearly',
  idToken,
};
const r = await fetch(`${API}/api/license/redeem-play`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-budget-secret': secret, Origin: 'https://5budget.app' },
  body: JSON.stringify(body),
});
const text = await r.text();
console.log(`\n[3] POST ${API}/api/license/redeem-play -> HTTP ${r.status}`);
console.log(`    ${text.slice(0, 500)}`);

// --- 4. interpret ------------------------------------------------------------
let payload = {};
try {
  payload = JSON.parse(text);
} catch {
  /* non-JSON */
}
const code = payload.code ?? '(none)';
console.log('\n[4] reading');
if (code === 'play-purchase-not-found') {
  console.log('    *** The Play credential WORKS. Google answered for a bogus token, which is');
  console.log('        exactly right. A real purchase should now mint successfully. ***');
} else if (code === 'play-not-configured' && /play api 400 .*Invalid Value/.test(payload.reason ?? '')) {
  // Not a failure. Measured contrast (2026-09-11):
  //   Firebase admin key  -> 401 permissionDenied   (authorization rejected)
  //   play-billing@… key  -> 400 Invalid Value      (authorized; the TOKEN is bad)
  // So a 400 on a deliberately bogus token means the credential is fine.
  console.log('    reason =', payload.reason);
  console.log('    *** This is the SUCCESS case for a bogus token. ***');
  console.log('        400 "Invalid Value" = the credential passed authorization and Google');
  console.log('        rejected the TOKEN (ours is fake). An unauthorized credential answers');
  console.log('        401 permissionDenied instead — that is the distinction.');
  console.log('        Config is complete: the key loads, signs, and is authorized.');
} else if (code === 'play-not-configured') {
  const reason = payload.reason ?? '(none)';
  console.log('    reason =', reason);
  // `reason` is specific — read it rather than assuming the credential is at fault.
  if (/GOOGLE_PLAY_PACKAGE_NAME/.test(reason)) {
    console.log('    => Set GOOGLE_PLAY_PACKAGE_NAME = app.fivebudget on the Worker.');
  } else if (/oauth token unavailable|GOOGLE_PLAY_SERVICE_ACCOUNT/.test(reason)) {
    console.log('    => GOOGLE_PLAY_SERVICE_ACCOUNT is missing, malformed, or a key Play rejects.');
  } else if (/play api /.test(reason)) {
    console.log('    => Google answered the API call — read its status in the reason above.');
  } else {
    console.log('    => Fix the configuration value named above, then re-run.');
  }
  console.log('    (Check Variables and Secrets: editing one entry can drop another.)');
} else if (code === 'bad-id-token' || code === 'sign-in-required') {
  console.log('    Our own token was rejected — the probe, not the Play path.');
} else if (code === 'unauthorized') {
  console.log('    x-budget-secret mismatch — the value must be VITE_PARSE_SECRET / BUDGET_PARSE_SECRET.');
} else {
  console.log('    unexpected code:', code);
}
