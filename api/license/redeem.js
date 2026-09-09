/**
 * POST /api/license/redeem — exchange a purchase reference (Lemon Squeezy
 * order id / order number / license key from the post-purchase redirect) for
 * an HMAC-signed license. The LS API key never reaches the client.
 *
 * Body: { orderId?: string, key?: string, idToken: string (required) }
 *   → 200 { ok: true, license }
 *   → 404 purchase-not-found · 409 purchase-not-paid / email-mismatch ·
 *     429 rate-limited · 401 unauthorized / sign-in-required / bad-id-token ·
 *     400 bad-request · 503 not-configured
 *
 * Idempotent: re-redeeming the same order returns the SAME license.
 * Ownership (2026-09): the signed-in account's email must match the order's
 * buyer email — LS order ids are numeric and enumerable, so sign-in alone
 * is not authorization.
 */

import { checkIpRateLimit, createIpRateLimiter, handleCors, hasSharedSecret, readJsonBody, send } from '../_http.js';
import { db, verifyIdTokenSafe } from '../_firebase.js';
import { fetchOrderById, findOrderByNumber, generateOrderInvoice, validateLicenseKey } from '../_ls.js';
import { emailsMatch, orderToLedger } from '../_license.js';
import { ensureLicenseForOrder, saleRowForMerge } from '../_licenseops.js';

/** Dampens order-id enumeration (defense-in-depth under the email check). */
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
    console.error('redeem internal error', e.message, (e.stack ?? '').split('\n')[1] ?? '');
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
  const orderId = body && typeof body.orderId === 'string' ? body.orderId.trim() : '';
  const key = body && typeof body.key === 'string' ? body.key.trim() : '';
  const idToken = body && typeof body.idToken === 'string' ? body.idToken : '';
  if (!orderId && !key) {
    send(res, 400, { ok: false, code: 'bad-request' }, cors);
    return;
  }

  // Identity is MANDATORY for purchases (product decision 2026-09): every
  // license is bound to a Google account at mint time, so it can always be
  // restored on any device. Free use stays account-less (A13).
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

  // Resolve the reference to order attributes. The key path goes through the
  // License API's validate endpoint (no activation consumed), which yields
  // meta.order_id.
  let attributes = null;
  if (key) {
    const validated = await validateLicenseKey(key);
    const metaOrderId = validated.valid && validated.meta ? validated.meta.order_id : null;
    if (typeof metaOrderId === 'number' || (typeof metaOrderId === 'string' && metaOrderId !== '')) {
      const byId = await fetchOrderById(String(metaOrderId));
      attributes = byId.attributes;
    }
  }
  if (!attributes && orderId) {
    const byId = await fetchOrderById(orderId);
    if (byId.attributes) attributes = byId.attributes;
    else if (/^\d+$/.test(orderId)) attributes = await findOrderByNumber(orderId);
  }
  if (!attributes) {
    send(res, 404, { ok: false, code: 'purchase-not-found' }, cors);
    return;
  }
  const status = typeof attributes.status === 'string' ? attributes.status : '';
  if (status !== 'paid') {
    send(res, 409, { ok: false, code: status === 'refunded' ? 'purchase-refunded' : 'purchase-not-paid' }, cors);
    return;
  }

  // Ownership (2026-09): the redeemer's account email must match the LS buyer
  // email. Without this, an attacker could enumerate numeric order ids and
  // claim any paid order for their own account — sign-in is identity, this
  // is authorization.
  if (!emailsMatch(verified.email, attributes.user_email)) {
    send(res, 409, { ok: false, code: 'email-mismatch' }, cors);
    return;
  }

  // Sales ledger (authoritative copy comes from webhooks; this is the
  // client-side write path) + best-effort invoice download link.
  const ledger = orderToLedger(attributes);
  const fire = db();
  if (fire && ledger.order_id) {
    const salesRef = fire.collection('sales').doc(ledger.order_id);
    const existing = await salesRef.get();
    const existingData = existing.exists ? /** @type {Record<string, unknown>} */ (existing.data() ?? {}) : {};
    // Merge through saleRowForMerge: the raw ledger carries invoice_url:
    // null, which would clobber a URL a webhook wrote earlier.
    await salesRef.set({ ...saleRowForMerge(ledger, existingData), updatedAt: new Date().toISOString() }, { merge: true });
    if (!existingData.invoice_url) {
      const invoiceUrl = await generateOrderInvoice(ledger.order_id);
      if (invoiceUrl) await salesRef.set({ invoice_url: invoiceUrl }, { merge: true });
    }
  }

  const minted = await ensureLicenseForOrder(attributes, uid);
  if (!minted.ok) {
    send(res, 503, { ok: false, code: minted.code }, cors);
    return;
  }
  send(res, 200, { ok: true, license: minted.license }, cors);
}
