/**
 * POST /api/license/check — validate a pasted key (Settings recovery
 * fallback, never the main path).
 *
 * Accepts BOTH of:
 *   1. one of our signed license tokens (pure HMAC + expiry check), and
 *   2. a Lemon Squeezy license key from the purchase email — resolved via
 *      the LS License API (validate, no activation consumed) to its order,
 *      which is then minted into a signed token on the spot. This rescues
 *      purchases whose redirect/redemption never completed.
 *
 * Body: { key: string }
 *   → 200 { ok: true, active: boolean, license: string | null }
 *   · 503 not-configured
 */

import { handleCors, hasSharedSecret, readJsonBody, send } from '../_http.js';
import { verifyLicenseToken } from '../_license.js';
import { verifyIdTokenSafe } from '../_firebase.js';
import { fetchOrderById, validateLicenseKey } from '../_ls.js';
import { ensureLicenseForOrder, licenseSecret } from '../_licenseops.js';

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

  const body = await readJsonBody(req);
  const key = body && typeof body.key === 'string' ? body.key.trim() : '';
  if (!key) {
    send(res, 400, { ok: false, code: 'bad-request' }, cors);
    return;
  }

  const secret = licenseSecret();
  if (!secret) {
    send(res, 503, { ok: false, code: 'not-configured' }, cors);
    return;
  }

  // Path 1: our own signed token (identity-independent — it is already valid).
  const verified = verifyLicenseToken(key, secret);
  if (verified.ok) {
    send(res, 200, { ok: true, active: true, license: key }, cors);
    return;
  }

  // Path 2: Lemon Squeezy license key → order → mint our token. Purchases are
  // always account-bound (2026-09 decision), so this requires sign-in.
  const body2 = body && typeof body.idToken === 'string' ? body.idToken : '';
  if (!body2) {
    send(res, 401, { ok: false, code: 'sign-in-required' }, cors);
    return;
  }
  const verifiedUser = await verifyIdTokenSafe(body2);
  if (!verifiedUser.ok) {
    send(res, 401, { ok: false, code: 'bad-id-token' }, cors);
    return;
  }

  const validated = await validateLicenseKey(key);
  const metaOrderId = validated.valid && validated.meta ? validated.meta.order_id : null;
  if ((typeof metaOrderId === 'number' || (typeof metaOrderId === 'string' && metaOrderId !== ''))) {
    const byId = await fetchOrderById(String(metaOrderId));
    const attributes = byId.attributes;
    if (attributes && attributes.status === 'paid') {
      const minted = await ensureLicenseForOrder(attributes, verifiedUser.uid);
      if (minted.ok) {
        send(res, 200, { ok: true, active: true, license: minted.license }, cors);
        return;
      }
    }
  }

  send(res, 200, { ok: true, active: false, license: null }, cors);
}
