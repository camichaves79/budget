/**
 * POST /api/license/lookup — restore the license bound to a signed-in
 * account (new device, reinstall, cleared storage). Self-heals: when no
 * entitlement exists yet, the user's latest PAID Lemon Squeezy order
 * (matched by the verified email) is minted and bound on the spot.
 *
 * Body: { idToken: string }
 *   → 200 { ok: true, license: string | null } · 401 bad-id-token ·
 *     503 not-configured
 */

import { handleCors, hasSharedSecret, readJsonBody, send } from '../_http.js';
import { db, verifyIdTokenSafe } from '../_firebase.js';
import { findOrdersByEmail } from '../_ls.js';
import { makeLicensePayload, signLicense } from '../_license.js';
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
  const idToken = body && typeof body.idToken === 'string' ? body.idToken : null;
  if (!idToken) {
    send(res, 400, { ok: false, code: 'bad-request' }, cors);
    return;
  }
  const verified = await verifyIdTokenSafe(idToken);
  if (!verified.ok) {
    send(res, 401, { ok: false, code: 'bad-id-token' }, cors);
    return;
  }

  const fire = db();
  if (!fire) {
    send(res, 503, { ok: false, code: 'not-configured' }, cors);
    return;
  }

  const entitlement = await fire.collection('entitlements').doc(verified.uid).get();
  if (!entitlement.exists) {
    // Self-heal: latest paid order for this email → mint + bind.
    if (verified.email) {
      const orders = await findOrdersByEmail(verified.email);
      const paid = orders.find((o) => o.status === 'paid');
      if (paid) {
        const minted = await ensureLicenseForOrder(paid, verified.uid);
        if (minted.ok) {
          send(res, 200, { ok: true, license: minted.license }, cors);
          return;
        }
      }
    }
    send(res, 200, { ok: true, license: null }, cors);
    return;
  }

  const data = /** @type {Record<string, unknown>} */ (entitlement.data() ?? {});
  const licId = typeof data.lic === 'string' ? data.lic : null;
  if (!licId) {
    send(res, 200, { ok: true, license: null }, cors);
    return;
  }
  const licDoc = await fire.collection('licenses').doc(licId).get();
  if (!licDoc.exists) {
    send(res, 200, { ok: true, license: null }, cors);
    return;
  }
  const licData = /** @type {Record<string, unknown>} */ (licDoc.data());
  const secret = licenseSecret();
  if (!secret) {
    send(res, 503, { ok: false, code: 'not-configured' }, cors);
    return;
  }
  const payload = makeLicensePayload({
    lic: licId,
    uid: typeof licData.uid === 'string' ? licData.uid : verified.uid,
    iatSeconds: typeof licData.iat === 'number' ? licData.iat : Math.floor(Date.now() / 1000),
    expSeconds: typeof licData.exp === 'number' ? licData.exp : 0,
  });
  send(res, 200, { ok: true, license: signLicense(payload, secret) }, cors);
}
