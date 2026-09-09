/**
 * POST /api/webhooks/ls — Lemon Squeezy webhook receiver.
 *
 * Configure this URL in the LS dashboard (Settings → Webhooks) with the
 * signing secret matching LEMONSQUEEZY_WEBHOOK_SECRET. The signature is the
 * hex HMAC-SHA256 of the RAW body (docs: help/webhooks/signing-requests);
 * we read the raw body text before parsing so the verification is exact.
 *
 * order_created  → sales-ledger upsert; for PAID orders, mints the license
 *                  right away (bound to the Firebase uid whose email matches
 *                  the buyer, when one exists) so a user who never taps
 *                  "return to the app" still gets a restorable license.
 * order_refunded → refund fields on the ledger doc + license marked refunded.
 * Unknown events answer 200 so LS stops retrying.
 */

import { handleCors, readBodyText, send } from '../_http.js';
import { verifyWebhookSignature, webhookToLedger } from '../_license.js';
import { db, getUserByEmailSafe } from '../_firebase.js';
import { generateOrderInvoice } from '../_ls.js';
import { ensureLicenseForOrder, saleRowForMerge } from '../_licenseops.js';

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

  const rawBody = await readBodyText(req, 128_000);
  if (rawBody === null) {
    send(res, 413, { ok: false, code: 'too-large' }, cors);
    return;
  }
  const signatureHeader = req.headers['x-signature'];
  const signature = Array.isArray(signatureHeader) ? (signatureHeader[0] ?? '') : (signatureHeader ?? '');
  const webhookSecret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? '';
  if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
    send(res, 401, { ok: false, code: 'bad-signature' }, cors);
    return;
  }

  /** @type {unknown} */
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    send(res, 400, { ok: false, code: 'bad-request' }, cors);
    return;
  }
  const p = payload && typeof payload === 'object' ? /** @type {Record<string, unknown>} */ (payload) : {};
  const meta = p.meta && typeof p.meta === 'object' ? /** @type {Record<string, unknown>} */ (p.meta) : {};
  const eventName = typeof meta.event_name === 'string' ? meta.event_name : '';
  const data = p.data && typeof p.data === 'object' ? /** @type {Record<string, unknown>} */ (p.data) : {};
  const attributes =
    data.attributes && typeof data.attributes === 'object' ? /** @type {Record<string, unknown>} */ (data.attributes) : {};

  // Store check: only sales from OUR store (best-effort when the env is set).
  const expectedStore = process.env.LEMONSQUEEZY_STORE_ID ?? '';
  if (expectedStore && typeof attributes.store_id === 'string' && attributes.store_id !== expectedStore) {
    send(res, 200, { ok: true, ignored: 'store' }, cors);
    return;
  }

  const mapped = webhookToLedger(eventName, attributes);
  if (!mapped) {
    send(res, 200, { ok: true, ignored: 'event' }, cors);
    return;
  }

  const orderId = typeof attributes.identifier === 'string' ? attributes.identifier : '';
  // NUMERIC LS order id (payload data.id) — the generate-invoice endpoint
  // rejects the UUID identifier with a 404, so the two ids stay separate.
  const numericId = typeof data.id === 'string' ? data.id : typeof data.id === 'number' ? String(data.id) : '';
  const fire = db();
  if (!fire || !orderId) {
    send(res, 200, { ok: true, stored: false }, cors);
    return;
  }

  const salesRef = fire.collection('sales').doc(orderId);
  const existingSnap = await salesRef.get();
  const existing = existingSnap.exists ? /** @type {Record<string, unknown>} */ (existingSnap.data() ?? {}) : {};
  const status = typeof attributes.status === 'string' ? attributes.status : '';

  if (eventName === 'order_refunded' && typeof existing.license_id === 'string') {
    await fire
      .collection('licenses')
      .doc(existing.license_id)
      .set({ status: 'refunded', refundedAt: typeof attributes.refunded_at === 'string' ? attributes.refunded_at : null }, { merge: true });
  }

  // Merge through saleRowForMerge: the raw orderToLedger carries
  // invoice_url: null, which would clobber a URL a redeem wrote earlier.
  await salesRef.set({ ...saleRowForMerge(mapped.ledger, existing), updatedAt: new Date().toISOString() }, { merge: true });

  if (eventName === 'order_created' && status === 'paid') {
    // Bind to a known user by buyer email; mint when the webhook beats the
    // client's redeem round-trip.
    let uid = null;
    const email = typeof attributes.user_email === 'string' && attributes.user_email !== '' ? attributes.user_email : null;
    if (email) {
      const byEmail = await getUserByEmailSafe(email);
      if (byEmail) uid = byEmail.uid;
    }
    await ensureLicenseForOrder(attributes, uid);
    if (!existing.invoice_url && numericId !== '') {
      const invoiceUrl = await generateOrderInvoice(numericId);
      if (invoiceUrl) await salesRef.set({ invoice_url: invoiceUrl }, { merge: true });
    }
  }

  send(res, 200, { ok: true }, cors);
}
