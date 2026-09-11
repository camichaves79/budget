/**
 * POST /api/license/redeem-play — exchange a Google Play subscription
 * purchase token for an HMAC-signed license (the Play twin of
 * /api/license/redeem). The Play Developer API key never reaches the client.
 *
 * Body: { purchaseToken: string, productId: string, idToken: string }
 *   → 200 { ok: true, license }
 *   → 404 play-purchase-not-found · 409 play-not-paid / play-email-mismatch ·
 *     429 rate-limited · 401 unauthorized / sign-in-required / bad-id-token ·
 *     400 bad-request · 503 not-configured
 *
 * Ownership: the signed-in account's email must match the Play purchaser's
 * email (the classic purchases.subscriptions `emailAddress`) — the Play
 * account itself is the authorization, mapped onto the same Google account
 * that signs in (no Lemon Squeezy user_email).
 */

import { checkIpRateLimit, createIpRateLimiter, handleCors, hasSharedSecret, readJsonBody, send } from '../_http.js';
import { verifyIdTokenSafe } from '../_firebase.js';
import { emailsMatch } from '../_license.js';
import { ensureLicenseForPlayPurchase } from '../_licenseops.js';
import { acknowledgeSubscription, getSubscription } from '../_play.js';

/** Dampens token replay/enumeration (defense-in-depth under the email check). */
const rateLimiter = createIpRateLimiter();

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export default async function handler(req, res) {
  const { cors, done } = handleCors(req, res);
  if (done) return;
  if (req.method !== 'POST') {
    send(res, 405, { ok: false, code: 'bad-request' }, cors);
    return;
  }
  if (!hasSharedSecret(req)) {
    send(res, 401, { ok: false, code: 'unauthorized' }, cors);
    return;
  }
  if (!checkIpRateLimit(rateLimiter, req)) {
    send(res, 429, { ok: false, code: 'rate-limited' }, cors);
    return;
  }

  try {
    await redeem(req, res, cors);
  } catch (err) {
    const e = /** @type {Error} */ (err);
    console.error('redeem-play internal error', e.message, (e.stack ?? '').split('\n')[1] ?? '');
    send(res, 500, { ok: false, code: 'internal', reason: `${e.message}` }, cors);
  }
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {Record<string, string>} cors
 */
async function redeem(req, res, cors) {
  const body = await readJsonBody(req);
  const purchaseToken = body && typeof body.purchaseToken === 'string' ? body.purchaseToken.trim() : '';
  const productId = body && typeof body.productId === 'string' ? body.productId.trim() : '';
  const idToken = body && typeof body.idToken === 'string' ? body.idToken : '';
  if (!purchaseToken || !productId) {
    send(res, 400, { ok: false, code: 'bad-request' }, cors);
    return;
  }

  // Identity is MANDATORY for purchases (same rule as the web path): every
  // license is bound to a Google account at mint time (A13).
  if (!idToken) {
    send(res, 401, { ok: false, code: 'sign-in-required' }, cors);
    return;
  }
  const verified = await verifyIdTokenSafe(idToken);
  if (!verified.ok) {
    send(res, 401, { ok: false, code: 'bad-id-token' }, cors);
    return;
  }
  const uid = verified.uid;

  const { status, purchase, reason } = await getSubscription(purchaseToken, productId);
  if (!purchase) {
    // `reason` is a safe, non-secret explanation (package id + Google's status and
    // error message — never the key or the purchase token). Without it a real
    // purchase failure was reported as a bare `play-not-configured`, which named
    // nothing and cost a session.
    send(
      res,
      status === 404 ? 404 : 503,
      { ok: false, code: status === 404 ? 'play-purchase-not-found' : 'play-not-configured', reason: reason ?? '' },
      cors,
    );
    return;
  }
  const paymentState = Number(purchase.paymentState);
  if (paymentState !== 1) {
    send(res, 409, { ok: false, code: 'play-not-paid' }, cors);
    return;
  }

  // Ownership: the Play purchaser's email must match the signed-in account.
  if (!emailsMatch(verified.email, purchase.emailAddress)) {
    send(res, 409, { ok: false, code: 'play-email-mismatch' }, cors);
    return;
  }

  const minted = await ensureLicenseForPlayPurchase(purchase, purchaseToken, uid);
  if (!minted.ok) {
    send(res, 503, { ok: false, code: minted.code }, cors);
    return;
  }

  // Acknowledge AFTER the entitlement is granted (Play auto-refunds
  // unacknowledged purchases after 3 days); re-redeem re-acknowledges.
  await acknowledgeSubscription(productId, purchaseToken);

  send(res, 200, { ok: true, license: minted.license }, cors);
}
