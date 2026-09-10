/**
 * Shared license operations for the Vercel Functions: mint-or-return the
 * signed license for a paid Lemon Squeezy order, idempotently, with the
 * entitlement bound to a Firebase uid when one is known.
 *
 * Used by /api/license/redeem (client round-trip), /api/webhooks/ls (sale
 * recorded without the client — license mints for known users even when
 * they never tap "return to the app"), and /api/license/lookup (self-heal
 * for a paid order tied to the signed-in email).
 *
 * Ledger guarantee (2026-09): every path leaves the sales/{orderId} doc
 * with the COMPLETE ledger row — money columns come from orderToLedger.
 * The webhook is the authoritative writer, but a restore-only sale whose
 * webhook never landed must still produce an accountant-ready row, not a
 * doc holding only license_id/redeemed_at.
 */

import { randomUUID } from 'node:crypto';
import { db } from './_firebase.js';
import { LICENSE_TERM_SECONDS, makeLicensePayload, orderToLedger, playPurchaseToLedger, signLicense } from './_license.js';

export function licenseSecret() {
  return (process.env.BUDGET_LICENSE_SECRET ?? '').trim();
}

/**
 * Complete a ledger row for a merge-write without downgrading data the
 * order attributes cannot know about: a recorded refund (order_refunded
 * webhooks beat a possibly-staler mint/restore) and the generated invoice /
 * receipt URLs (invoice_url comes from OUR invoice endpoint, not LS).
 * Exported for the smoke suite.
 * @param {ReturnType<typeof orderToLedger>} ledger
 * @param {Record<string, unknown>} existing
 * @returns {ReturnType<typeof orderToLedger>}
 */
export function saleRowForMerge(ledger, existing) {
  const row = { ...ledger };
  if (typeof existing.invoice_url === 'string' && existing.invoice_url !== '') row.invoice_url = existing.invoice_url;
  if (typeof existing.receipt_url === 'string' && existing.receipt_url !== '') row.receipt_url = existing.receipt_url;
  if (existing.refunded === true) {
    row.status = existing.status === 'refunded' ? 'refunded' : row.status;
    row.refunded = true;
    row.refunded_amount = typeof existing.refunded_amount === 'number' ? existing.refunded_amount : row.refunded_amount;
    row.refunded_at = typeof existing.refunded_at === 'string' ? existing.refunded_at : row.refunded_at;
  }
  return row;
}

/**
 * @param {Record<string, unknown> | null | undefined} attributes LS order attributes
 * @param {string | null} uid Firebase uid to bind the license to (optional)
 * @returns {Promise<{ ok: true, license: string, payload: ReturnType<typeof makeLicensePayload> } | { ok: false, code: string }>}
 */
export async function ensureLicenseForOrder(attributes, uid) {
  const identifier = attributes?.identifier;
  const orderId = typeof identifier === 'string' ? identifier : '';
  if (!orderId) return { ok: false, code: 'bad-order' };
  const fire = db();
  if (!fire) return { ok: false, code: 'not-configured' };
  const secret = licenseSecret();
  if (!secret) return { ok: false, code: 'not-configured' };

  const ledger = orderToLedger(attributes);

  // Idempotent by order id: a previous mint (webhook or an earlier redeem)
  // is returned re-signed instead of minting a second license.
  const salesRef = fire.collection('sales').doc(orderId);
  const existingSale = await salesRef.get();
  const existingData = existingSale.exists
    ? /** @type {Record<string, unknown>} */ (existingSale.data() ?? {})
    : {};
  const existingLicenseId = existingData.license_id;
  if (typeof existingLicenseId === 'string' && existingLicenseId !== '') {
    const licDoc = await fire.collection('licenses').doc(existingLicenseId).get();
    if (licDoc.exists) {
      // Backfill: heal rows written before the by-construction upsert (a
      // restore once left only license_id/redeemed_at) without clobbering
      // fresher refund state.
      await salesRef.set(saleRowForMerge(ledger, existingData), { merge: true });
      const data = /** @type {Record<string, unknown>} */ (licDoc.data());
      const payload = makeLicensePayload({
        lic: existingLicenseId,
        uid: typeof data.uid === 'string' ? data.uid : null,
        iatSeconds: typeof data.iat === 'number' ? data.iat : Math.floor(Date.now() / 1000),
        expSeconds: typeof data.exp === 'number' ? data.exp : Math.floor(Date.now() / 1000) + LICENSE_TERM_SECONDS,
      });
      return { ok: true, license: signLicense(payload, secret), payload };
    }
  }

  // Mint: the license runs LICENSE_TERM_SECONDS from the PURCHASE date, so a
  // late redemption does not extend the term.
  const created = attributes?.created_at;
  const createdMs = typeof created === 'string' && created !== '' ? Date.parse(created) : NaN;
  const iatSeconds = Number.isFinite(createdMs) ? Math.floor(createdMs / 1000) : Math.floor(Date.now() / 1000);
  const expSeconds = iatSeconds + LICENSE_TERM_SECONDS;
  const lic = randomUUID();
  const payload = makeLicensePayload({ lic, uid, iatSeconds, expSeconds });
  const token = signLicense(payload, secret);

  const now = new Date().toISOString();
  await fire
    .collection('licenses')
    .doc(lic)
    .set({ lic, orderId, uid: uid ?? null, plan: 'yearly', iat: iatSeconds, exp: expSeconds, status: 'active', createdAt: now }, { merge: true });
  // The sales row is written COMPLETE here, by construction: money columns
  // from the order attributes + the license binding, whichever path mints.
  await salesRef.set({ ...saleRowForMerge(ledger, existingData), license_id: lic, redeemed_at: now }, { merge: true });
  if (uid) {
    await fire
      .collection('entitlements')
      .doc(uid)
      .set({ lic, plan: 'yearly', iat: iatSeconds, exp: expSeconds, orderId, updatedAt: now }, { merge: true });
  }
  return { ok: true, license: token, payload };
}

/**
 * Mint-or-return the signed license for a verified Google Play subscription
 * purchase — the Play twin of `ensureLicenseForOrder`. Same license shape and
 * the same `licenses`/`entitlements` collections; the sales row is keyed by
 * the Play `orderId` (one row per charge — a renewal is a NEW orderId and
 * lands as a new row; the webhook chains renewals via `linkedPurchaseToken`).
 * Idempotent by orderId. The license term follows Play's actual
 * `expiryTimeMillis` when present (fallback: start + one year).
 *
 * @param {Record<string, unknown> | null | undefined} purchase classic purchases.subscriptions resource
 * @param {string | null} purchaseToken the token that was redeemed (trace field)
 * @param {string | null} uid Firebase uid to bind the license to (optional)
 * @returns {Promise<{ ok: true, license: string, payload: ReturnType<typeof makeLicensePayload> } | { ok: false, code: string }>}
 */
export async function ensureLicenseForPlayPurchase(purchase, purchaseToken, uid) {
  const orderId = typeof purchase?.orderId === 'string' && purchase.orderId !== '' ? purchase.orderId : '';
  if (!orderId) return { ok: false, code: 'bad-order' };
  const fire = db();
  if (!fire) return { ok: false, code: 'not-configured' };
  const secret = licenseSecret();
  if (!secret) return { ok: false, code: 'not-configured' };

  const ledger = playPurchaseToLedger(purchase);

  const salesRef = fire.collection('sales').doc(orderId);
  const existingSale = await salesRef.get();
  const existingData = existingSale.exists
    ? /** @type {Record<string, unknown>} */ (existingSale.data() ?? {})
    : {};
  const existingLicenseId = existingData.license_id;
  if (typeof existingLicenseId === 'string' && existingLicenseId !== '') {
    const licDoc = await fire.collection('licenses').doc(existingLicenseId).get();
    if (licDoc.exists) {
      await salesRef.set(
        { ...saleRowForMerge(ledger, existingData), purchase_token: purchaseToken ?? null },
        { merge: true },
      );
      // Token → license map: lets a later renewal/refund webhook resolve this
      // purchaseToken back to the license it must extend or revoke (no uid).
      await fire
        .collection('playTokens')
        .doc(purchaseToken ?? orderId)
        .set({ license_id: existingLicenseId, orderId, updatedAt: new Date().toISOString() }, { merge: true });
      const data = /** @type {Record<string, unknown>} */ (licDoc.data());
      const payload = makeLicensePayload({
        lic: existingLicenseId,
        uid: typeof data.uid === 'string' ? data.uid : null,
        iatSeconds: typeof data.iat === 'number' ? data.iat : Math.floor(Date.now() / 1000),
        expSeconds: typeof data.exp === 'number' ? data.exp : Math.floor(Date.now() / 1000) + LICENSE_TERM_SECONDS,
      });
      return { ok: true, license: signLicense(payload, secret), payload };
    }
  }

  // Mint: the term follows Play's expiry (renewals extend it server-side via
  // the webhook), falling back to start + one year when expiry is missing.
  const startMs = Number(purchase?.startTimeMillis);
  const expMs = Number(purchase?.expiryTimeMillis);
  const iatSeconds = Number.isFinite(startMs) ? Math.floor(startMs / 1000) : Math.floor(Date.now() / 1000);
  const expSeconds =
    Number.isFinite(expMs) && expMs > startMs ? Math.floor(expMs / 1000) : iatSeconds + LICENSE_TERM_SECONDS;
  const lic = randomUUID();
  const payload = makeLicensePayload({ lic, uid, iatSeconds, expSeconds });
  const token = signLicense(payload, secret);

  const now = new Date().toISOString();
  await fire
    .collection('licenses')
    .doc(lic)
    .set(
      {
        lic,
        orderId,
        purchaseToken: purchaseToken ?? null,
        uid: uid ?? null,
        plan: 'yearly',
        source: 'play',
        iat: iatSeconds,
        exp: expSeconds,
        status: 'active',
        createdAt: now,
      },
      { merge: true },
    );
  await salesRef.set({ ...saleRowForMerge(ledger, existingData), license_id: lic, purchase_token: purchaseToken ?? null, redeemed_at: now }, { merge: true });
  if (uid) {
    await fire
      .collection('entitlements')
      .doc(uid)
      .set({ lic, plan: 'yearly', source: 'play', iat: iatSeconds, exp: expSeconds, orderId, updatedAt: now }, { merge: true });
  }
  // Token → license map: lets a later renewal/refund webhook resolve this
  // purchaseToken back to the license it must extend or revoke (no uid).
  await fire
    .collection('playTokens')
    .doc(purchaseToken ?? orderId)
    .set({ license_id: lic, orderId, updatedAt: now }, { merge: true });
  return { ok: true, license: token, payload };
}
