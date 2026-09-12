/**
 * Google Play Billing helpers (server-side only) — phase 1: the PURE
 * parsing/classification core for real-time developer notifications (Cloud
 * Pub/Sub push), smoke-tested. Zero npm dependencies, like `_ls.js`.
 *
 * The Play Developer API network calls (purchases.subscriptions get /
 * acknowledge, orders.get) and the Pub/Sub OIDC signature check land in a
 * later phase, reusing `signJwt`/JWKS verification from `_firebase.js`.
 *
 * RTDN shape (base64 JSON in the Pub/Sub `message.data` field), per
 * developer.android.com/google/play/billing/rtdn-reference: a top-level
 * `DeveloperNotification` carries EXACTLY ONE of `subscriptionNotification`,
 * `oneTimeProductNotification`, `voidedPurchaseNotification`, or
 * `testNotification`. The handler must never trust the notification alone —
 * it re-queries the Play Developer API for the canonical state and updates
 * the ledger/license from that (see skills/paywall-ops.md §Play).
 */

import { Buffer } from 'node:buffer';
import { decodeJwtParts, signJwt } from './_firebase.js';

/**
 * Subscription notification types (notificationType enum). Codes 14–16 and 21
 * are unassigned; types 8 (PRICE_CHANGE_CONFIRMED) is deprecated in favour of
 * 19. Sourced from the RTDN reference table (2026-09).
 * @type {Record<string, number>}
 */
export const PLAY_SUBSCRIPTION_NOTIFICATION_TYPES = {
  SUBSCRIPTION_RECOVERED: 1,
  SUBSCRIPTION_RENEWED: 2,
  SUBSCRIPTION_CANCELED: 3,
  SUBSCRIPTION_PURCHASED: 4,
  SUBSCRIPTION_ON_HOLD: 5,
  SUBSCRIPTION_IN_GRACE_PERIOD: 6,
  SUBSCRIPTION_RESTARTED: 7,
  SUBSCRIPTION_PRICE_CHANGE_CONFIRMED: 8,
  SUBSCRIPTION_DEFERRED: 9,
  SUBSCRIPTION_PAUSED: 10,
  SUBSCRIPTION_PAUSE_SCHEDULE_CHANGED: 11,
  SUBSCRIPTION_REVOKED: 12,
  SUBSCRIPTION_EXPIRED: 13,
};

/** Notification types that mean "entitled / active" (grant or extend access). */
const GRANT_TYPES = new Set([1, 2, 4, 7, 9]); // RECOVERED, RENEWED, PURCHASED, RESTARTED, DEFERRED
/** Notification types that mean "revoke access now" (refund / expiration). */
const LOSS_TYPES = new Set([12, 13]); // REVOKED, EXPIRED
/** Notification types that mean "at risk" — keep access, re-query the API. */
const RISK_TYPES = new Set([3, 5, 6, 10]); // CANCELED, ON_HOLD, IN_GRACE_PERIOD, PAUSED

/**
 * Decode a Pub/Sub `message.data` field (base64 JSON) into a normalized
 * DeveloperNotification, or null when it is not one of ours / malformed.
 * @param {string | null | undefined} data
 * @returns {PlayNotification | null}
 */
export function parseDeveloperNotification(data) {
  if (typeof data !== 'string' || data.length === 0) return null;
  let raw;
  try {
    raw = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const envelope = /** @type {Record<string, unknown>} */ (raw);
  const base = {
    version: typeof envelope.version === 'string' ? envelope.version : '',
    packageName: typeof envelope.packageName === 'string' ? envelope.packageName : '',
    eventTimeMillis: typeof envelope.eventTimeMillis === 'string' ? envelope.eventTimeMillis : '',
    kind: /** @type {PlayNotification['kind']} */ ('unknown'),
    notificationType: /** @type {number | null} */ (null),
    purchaseToken: /** @type {string | null} */ (null),
    subscriptionId: /** @type {string | null} */ (null),
    orderId: /** @type {string | null} */ (null),
    productType: /** @type {number | null} */ (null),
    refundType: /** @type {number | null} */ (null),
  };

  const sub = envelope.subscriptionNotification;
  if (sub && typeof sub === 'object' && !Array.isArray(sub)) {
    const s = /** @type {Record<string, unknown>} */ (sub);
    return {
      ...base,
      kind: 'subscription',
      notificationType: typeof s.notificationType === 'number' ? s.notificationType : null,
      purchaseToken: typeof s.purchaseToken === 'string' ? s.purchaseToken : null,
      subscriptionId: typeof s.subscriptionId === 'string' ? s.subscriptionId : null,
    };
  }
  const voided = envelope.voidedPurchaseNotification;
  if (voided && typeof voided === 'object' && !Array.isArray(voided)) {
    const v = /** @type {Record<string, unknown>} */ (voided);
    return {
      ...base,
      kind: 'voided',
      purchaseToken: typeof v.purchaseToken === 'string' ? v.purchaseToken : null,
      orderId: typeof v.orderId === 'string' ? v.orderId : null,
      productType: typeof v.productType === 'number' ? v.productType : null,
      refundType: typeof v.refundType === 'number' ? v.refundType : null,
    };
  }
  if (envelope.testNotification && typeof envelope.testNotification === 'object') {
    return { ...base, kind: 'test' };
  }
  if (envelope.oneTimeProductNotification && typeof envelope.oneTimeProductNotification === 'object') {
    return { ...base, kind: 'one_time' };
  }
  return null;
}

/**
 * Bucket a parsed notification into the action the webhook should take.
 * The actual state update always comes from a Play Developer API re-query;
 * this is the triage signal only.
 *
 * @param {PlayNotification | null | undefined} notification
 * @returns {'grant' | 'loss' | 'risk' | 'ignore'}
 */
export function classifyPlayNotification(notification) {
  if (!notification || typeof notification !== 'object') return 'ignore';
  if (notification.kind === 'voided') return 'loss'; // refund/chargeback/revocation → revoke
  if (notification.kind !== 'subscription') return 'ignore'; // test / one_time / unknown
  const t = notification.notificationType;
  if (t !== null && GRANT_TYPES.has(t)) return 'grant';
  if (t !== null && LOSS_TYPES.has(t)) return 'loss';
  if (t !== null && RISK_TYPES.has(t)) return 'risk';
  return 'ignore';
}

/**
 * @typedef {object} PlayNotification
 * @property {string} version
 * @property {string} packageName
 * @property {string} eventTimeMillis
 * @property {'subscription' | 'voided' | 'test' | 'one_time' | 'unknown'} kind
 * @property {number | null} notificationType
 * @property {string | null} purchaseToken
 * @property {string | null} subscriptionId
 * @property {string | null} orderId
 * @property {number | null} productType
 * @property {number | null} refundType
 */

/* ---------- Play Developer API (server-side, phase 3) ---------- */

const PLAY_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const PLAY_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const PLAY_API = 'https://androidpublisher.googleapis.com/androidpublisher/v3';

let playServiceAccount = /** @type {{ client_email: string, private_key: string } | null} */ (null);
let playServiceAccountLoaded = false;

/**
 * Is this service-account email one that can never reach the Play API?
 *
 * `firebase-adminsdk-*` keys sign fine and Google WILL issue them an access
 * token (the token endpoint does not scope-check), so a wrong key is not
 * self-evident: the failure only appears later as an authorization error from
 * the Play API. Measured 2026-09-11, when GOOGLE_PLAY_SERVICE_ACCOUNT held the
 * Firebase admin key and produced `play: subscriptions.get 400 Invalid Value`
 * across most of a session. Detecting the identity by name turns that into an
 * immediate, named error.
 *
 * Exported for the smoke suite.
 * @param {string} email
 * @returns {boolean}
 */
export function isUnusablePlayIdentity(email) {
  const e = (email ?? '').toLowerCase();
  if (e === '') return false;
  // Firebase/GCP service-account families that have no Play Console access.
  return e.includes('firebase-adminsdk') || e.endsWith('@developer.gserviceaccount.com');
}

/** @returns {{ client_email: string, private_key: string } | null} */
function getPlayServiceAccount() {
  if (playServiceAccountLoaded) return playServiceAccount;
  playServiceAccountLoaded = true;
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT ?? '';
  if (!raw) {
    console.error('play: GOOGLE_PLAY_SERVICE_ACCOUNT missing');
    return null;
  }
  try {
    const sa = JSON.parse(raw);
    if (typeof sa.client_email === 'string' && typeof sa.private_key === 'string') {
      playServiceAccount = /** @type {{ client_email: string, private_key: string }} */ (sa);
      // Announce the identity ONCE per isolate. A service account's email is not
      // a secret (it is an address, and it must be visible in Play Console to be
      // granted access), and naming the identity is what makes a misconfigured
      // key obvious in the log stream instead of surfacing as an opaque
      // "Invalid Value" three steps later.
      console.log('play: authenticating as', playServiceAccount.client_email);
      if (isUnusablePlayIdentity(playServiceAccount.client_email)) {
        console.error(
          'play: THIS IDENTITY CANNOT CALL THE PLAY API —',
          playServiceAccount.client_email,
          'is a Firebase/GCP-default account. GOOGLE_PLAY_SERVICE_ACCOUNT must hold a',
          'dedicated service account that has been invited in Play Console ->',
          'Users and permissions with the two billing permissions.',
        );
      }
      return playServiceAccount;
    }
  } catch (err) {
    console.error('play: service account JSON invalid', /** @type {Error} */ (err).message);
  }
  console.error('play: service account fields missing');
  return null;
}

/** @returns {string} the app's Play package id (app.fivebudget). */
function packageName() {
  return (process.env.GOOGLE_PLAY_PACKAGE_NAME ?? '').trim();
}

let playTokenCache = { token: '', expiresAt: 0 };

/**
 * OAuth access token for the Play Developer API (service account, cached) —
 * the Play twin of _firebase.js's getAccessToken, with the androidpublisher
 * scope. Signed with the shared WebCrypto `signJwt` (workerd lacks createSign).
 * @returns {Promise<string | null>}
 */
async function getPlayAccessToken() {
  if (playTokenCache.token && Date.now() < playTokenCache.expiresAt - 60_000) return playTokenCache.token;
  const sa = getPlayServiceAccount();
  if (!sa) return null;
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt(
    { iss: sa.client_email, scope: PLAY_SCOPE, aud: PLAY_TOKEN_ENDPOINT, iat: now, exp: now + 3600 },
    sa.private_key,
  );
  try {
    const res = await fetch(PLAY_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });
    if (!res.ok) {
      console.error('play: token endpoint', res.status);
      return null;
    }
    const payload = /** @type {Record<string, unknown> | null} */ (await res.json());
    const token = payload && typeof payload.access_token === 'string' ? payload.access_token : '';
    if (!token || !payload) return null;
    const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 3600;
    playTokenCache = { token, expiresAt: Date.now() + expiresIn * 1000 };
    return token;
  } catch {
    return null;
  }
}

/**
 * GET the classic subscription purchase resource. Non-deprecated state checks
 * should use subscriptionsv2; the classic resource is fetched for the
 * purchaser `emailAddress` (which v2 drops) + `orderId`/`paymentState`.
 * @param {string} purchaseToken
 * @param {string} productId
 * @returns {Promise<{ status: number, purchase: Record<string, unknown> | null, reason?: string }>}
 */
/**
 * A non-secret fingerprint of a purchase token, for correlation in logs.
 *
 * A purchase token is bearer-like (anyone holding it can query and acknowledge
 * the purchase), so it must NOT be logged verbatim. But "Google says Invalid
 * Value" is undiagnosable without knowing WHICH token was sent: how long it is,
 * whether it carries whitespace or a newline, and whether it looks like a
 * subscription or a one-time-product token. Length + head/tail + character
 * classes answer all of that without exposing a usable token. Added 2026-09-11,
 * after a REAL purchase token drew HTTP 400 while every synthetic token we could
 * invent drew the identical error — leaving nothing to distinguish.
 * @param {string} t
 */
export function tokenFingerprint(t) {
  return {
    len: t.length,
    head: t.slice(0, 6),
    tail: t.slice(-4),
    whitespace: /\s/.test(t),
    segments: t.split('.').length,
    charset: /^[A-Za-z0-9._-]+$/.test(t) ? 'url-safe' : 'other',
  };
}

/**
 * @param {string} purchaseToken
 * @param {string} productId
 * @returns {Promise<{ status: number, purchase: Record<string, unknown> | null, reason?: string }>}
 */
export async function getSubscription(purchaseToken, productId) {
  const token = await getPlayAccessToken();
  const pkg = packageName();
  // Why the call failed, in a form safe to show a user in support mode and to
  // log. Never includes the token, the key, or the purchase token — those must
  // not reach a client or a log line. `play-not-configured` used to be a single
  // opaque code, which is why a real purchase failing left no actionable trace.
  if (!token) return { status: 0, purchase: null, reason: 'play oauth token unavailable (see worker logs: play: token endpoint / GOOGLE_PLAY_SERVICE_ACCOUNT)' };
  if (!pkg) return { status: 0, purchase: null, reason: 'GOOGLE_PLAY_PACKAGE_NAME is not set on the worker' };
  if (!productId) return { status: 0, purchase: null, reason: 'no productId supplied' };
  if (!purchaseToken) return { status: 0, purchase: null, reason: 'no purchaseToken supplied' };
  try {
    const res = await fetch(
      `${PLAY_API}/applications/${encodeURIComponent(pkg)}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      // Google's own error text. `error.message` alone ("Invalid Value") cannot
      // distinguish a bad token from a bad product id, so log the whole body.
      let detail = '';
      let raw = '';
      try {
        raw = await res.text();
        const body = /** @type {Record<string, unknown>} */ (JSON.parse(raw));
        const err = /** @type {Record<string, unknown> | undefined} */ (body?.error);
        detail = typeof err?.message === 'string' ? err.message : '';
        const errors = /** @type {Array<Record<string, unknown>> | undefined} */ (err?.errors);
        const reason0 = Array.isArray(errors) && errors[0] ? errors[0].reason : undefined;
        if (typeof reason0 === 'string') detail = `${detail} (${reason0})`;
      } catch {
        raw = String(raw).slice(0, 200);
      }
      console.error(
        'play: subscriptions.get',
        res.status,
        JSON.stringify({
          pkg,
          productId,
          token: tokenFingerprint(purchaseToken),
          google: raw.slice(0, 300),
        }),
      );
      return {
        status: res.status,
        purchase: null,
        reason: `play api ${res.status} for ${pkg}${detail ? ` — ${detail}` : ''}`,
      };
    }
    return { status: 200, purchase: /** @type {Record<string, unknown>} */ (await res.json()) };
  } catch {
    return { status: 0, purchase: null, reason: 'play api unreachable from the worker' };
  }
}

/**
 * Acknowledge the subscription AFTER the entitlement is granted (Play
 * auto-refunds unacknowledged purchases after 3 days). Best-effort: a
 * re-redeem re-acknowledges.
 * @param {string} productId
 * @param {string} purchaseToken
 * @returns {Promise<boolean>}
 */
export async function acknowledgeSubscription(productId, purchaseToken) {
  const token = await getPlayAccessToken();
  const pkg = packageName();
  if (!token || !pkg || !purchaseToken || !productId) return false;
  try {
    const res = await fetch(
      `${PLAY_API}/applications/${encodeURIComponent(pkg)}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * GET one Play order by id (the `orders` resource — a non-deprecated source
 * of the buyer's `userEmail` when the classic subscription resource does not
 * carry `emailAddress`). Used as the email-mapping fallback.
 * @param {string} orderId
 * @returns {Promise<{ status: number, order: Record<string, unknown> | null }>}
 */
export async function getOrder(orderId) {
  const token = await getPlayAccessToken();
  const pkg = packageName();
  if (!token || !pkg || !orderId) return { status: 0, order: null };
  try {
    const res = await fetch(
      `${PLAY_API}/applications/${encodeURIComponent(pkg)}/orders/${encodeURIComponent(orderId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return { status: res.status, order: null };
    return { status: 200, order: /** @type {Record<string, unknown>} */ (await res.json()) };
  } catch {
    return { status: 0, order: null };
  }
}

/* ---------- Cloud Pub/Sub push (real-time developer notifications) ---------- */

const OAUTH2_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';

let oauth2JwksCache = { keys: /** @type {Array<{ kid?: string, n?: string, e?: string }>} */ ([]), expiresAt: 0 };

/** @returns {Promise<Array<{ kid?: string, n?: string, e?: string }>>} */
async function getOAuth2Jwks() {
  if (oauth2JwksCache.keys.length > 0 && Date.now() < oauth2JwksCache.expiresAt) return oauth2JwksCache.keys;
  try {
    const res = await fetch(OAUTH2_JWKS);
    if (!res.ok) return oauth2JwksCache.keys;
    const payload = /** @type {Record<string, unknown> | null} */ (await res.json());
    const keys = Array.isArray(payload?.keys) ? /** @type {Array<{ kid?: string, n?: string, e?: string }>} */ (payload.keys) : [];
    oauth2JwksCache = { keys, expiresAt: Date.now() + 6 * 60 * 60 * 1000 };
    return keys;
  } catch {
    return oauth2JwksCache.keys;
  }
}

/**
 * Parse a Cloud Pub/Sub push request body into its message fields. The push
 * envelope is `{ message: { data (base64), messageId, attributes }, subscription }`.
 * @param {string | null} rawBody
 * @returns {{ data: string, messageId: string, subscription: string } | null}
 */
export function parsePubSubMessage(rawBody) {
  if (typeof rawBody !== 'string' || rawBody === '') return null;
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  const p = /** @type {Record<string, unknown>} */ (payload);
  const message = p.message && typeof p.message === 'object' ? /** @type {Record<string, unknown>} */ (p.message) : null;
  const data = message && typeof message.data === 'string' ? message.data : '';
  if (!data) return null;
  const messageId = message && typeof message.messageId === 'string' ? message.messageId : '';
  const subscription = typeof p.subscription === 'string' ? p.subscription : '';
  return { data, messageId, subscription };
}

/**
 * Validate the CLAIMS of a Pub/Sub push OIDC token (pure, sync — the signature
 * is checked separately in `verifyPubSubToken`). Authentic only when it is
 * Google-issued (iss), targets OUR endpoint (aud), is unexpired, and — when the
 * subscription pins a service account — carries that verified email.
 * @param {Record<string, unknown>} payload
 * @param {{ audience?: string, expectedEmail?: string, nowMs?: number }} [opts]
 * @returns {boolean}
 */
export function validatePubSubClaims(payload, { audience = '', expectedEmail = '', nowMs = Date.now() } = {}) {
  if (!payload || typeof payload !== 'object') return false;
  const iss = payload.iss === 'https://accounts.google.com' || payload.iss === 'accounts.google.com';
  if (!iss) return false;
  const aud = typeof payload.aud === 'string' ? payload.aud : '';
  if (audience && aud !== audience) return false;
  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  if (exp * 1000 <= nowMs) return false;
  if (expectedEmail) {
    if (payload.email !== expectedEmail) return false;
    if (payload.email_verified !== true) return false;
  }
  return true;
}

/**
 * Verify a Pub/Sub push OIDC bearer token: signature against Google's OAuth2
 * certs, then the claim checks. Returns ok only for authentic push messages.
 * @param {string | null | undefined} idToken
 * @param {{ audience?: string, expectedEmail?: string }} [opts]
 * @returns {Promise<{ ok: true, email: string | null } | { ok: false }>}
 */
export async function verifyPubSubToken(idToken, { audience = '', expectedEmail = '' } = {}) {
  if (!idToken) return { ok: false };
  const parts = idToken.split('.');
  const decoded = decodeJwtParts(idToken);
  if (!decoded || parts.length !== 3) return { ok: false };
  const { header, payload } = decoded;
  const kid = typeof header.kid === 'string' ? header.kid : '';
  const jwks = await getOAuth2Jwks();
  const jwk = jwks.find((k) => k.kid === kid);
  if (!jwk || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') return { ok: false };
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const sig = Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data);
    if (!valid) return { ok: false };
  } catch {
    return { ok: false };
  }
  if (!validatePubSubClaims(payload, { audience, expectedEmail })) return { ok: false };
  return { ok: true, email: typeof payload.email === 'string' ? payload.email : null };
}
