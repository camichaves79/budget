/**
 * POST /api/webhooks/play — Google Play real-time developer notifications via
 * Cloud Pub/Sub PUSH (subscription / voided / test events).
 *
 * Auth differs from the Lemon Squeezy webhook: Pub/Sub push carries an OIDC
 * bearer JWT in the Authorization header, signed by Google's OAuth2 keys. We
 * verify signature + iss/aud/exp (and the pinned push email when configured),
 * then decode `message.data`, classify, and — for state changes — re-query the
 * Play Developer API for the CANONICAL state before touching the license /
 * ledger (never trust the notification alone). Always answers 200/401 so
 * Pub/Sub stops retrying once authenticated.
 */

import { handleCors, readBodyText, send } from '../_http.js';
import { db, getUserByEmailSafe } from '../_firebase.js';
import { playPurchaseToLedger } from '../_license.js';
import { ensureLicenseForPlayPurchase, saleRowForMerge } from '../_licenseops.js';
import {
  classifyPlayNotification,
  getSubscription,
  parseDeveloperNotification,
  parsePubSubMessage,
  verifyPubSubToken,
} from '../_play.js';

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

  // Pub/Sub push auth: Authorization: Bearer <OIDC JWT>.
  const authHeader = req.headers['authorization'];
  const auth = Array.isArray(authHeader) ? (authHeader[0] ?? '') : (authHeader ?? '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const host = Array.isArray(req.headers.host) ? (req.headers.host[0] ?? '') : (req.headers.host ?? '');
  const pathname = (req.url ?? '').split('?')[0];
  const configuredAudience = (process.env.GOOGLE_PLAY_PUBSUB_AUDIENCE ?? '').trim();
  const audience = configuredAudience || (host ? `https://${host}${pathname}` : '');
  const expectedEmail = (process.env.GOOGLE_PLAY_PUBSUB_EMAIL ?? '').trim();
  const verified = await verifyPubSubToken(token, { audience, expectedEmail });
  if (!verified.ok) {
    send(res, 401, { ok: false, code: 'bad-signature' }, cors);
    return;
  }

  const parsed = parsePubSubMessage(rawBody);
  if (!parsed) {
    send(res, 200, { ok: true, ignored: 'empty' }, cors);
    return;
  }
  const notification = parseDeveloperNotification(parsed.data);
  if (!notification) {
    send(res, 200, { ok: true, ignored: 'unrecognized' }, cors);
    return;
  }

  const fire = db();
  if (!fire) {
    // Answer 200 so Pub/Sub stops retrying; a misconfigured service account
    // must not wedge the subscription.
    send(res, 200, { ok: true, ignored: 'not-configured' }, cors);
    return;
  }

  await applyNotification(fire, notification);
  send(res, 200, { ok: true }, cors);
}

/**
 * @param {NonNullable<ReturnType<typeof import('../_firebase.js').db>>} fire
 * @param {import('../_play.js').PlayNotification} notification
 */
async function applyNotification(fire, notification) {
  const action = classifyPlayNotification(notification);
  if (action === 'ignore') return;

  const purchaseToken = notification.purchaseToken;
  if (!purchaseToken) return;

  // Voided (refund/chargeback/revocation): revoke immediately, no re-query.
  if (notification.kind === 'voided') {
    const tokenDoc = await fire.collection('playTokens').doc(purchaseToken).get();
    if (tokenDoc.exists) {
      const data = tokenDoc.data();
      const licId = data && typeof data.license_id === 'string' ? data.license_id : '';
      if (licId !== '') {
        await fire.collection('licenses').doc(licId).set({ status: 'refunded' }, { merge: true });
      }
    }
    if (notification.orderId) {
      await fire
        .collection('sales')
        .doc(notification.orderId)
        .set({ refunded: true, refunded_at: new Date().toISOString(), status: 'refunded' }, { merge: true });
    }
    return;
  }

  // Subscription state change: re-query the Play API for the canonical state.
  const productId = notification.subscriptionId || (process.env.GOOGLE_PLAY_SUBSCRIPTION_ID ?? '').trim();
  const { purchase } = await getSubscription(purchaseToken, productId);
  if (!purchase) return; // re-query failed → let Pub/Sub retry the delivery

  const paymentState = Number(purchase.paymentState);
  const orderId = typeof purchase.orderId === 'string' ? purchase.orderId : '';
  const expMs = Number(purchase.expiryTimeMillis);
  const expSeconds = Number.isFinite(expMs) && expMs > 0 ? Math.floor(expMs / 1000) : null;

  // Resolve the license: by this token, then by the linked (prior) token.
  let licenseId = /** @type {string | null} */ (null);
  const tokenDoc = await fire.collection('playTokens').doc(purchaseToken).get();
  if (tokenDoc.exists) {
    const data = tokenDoc.data();
    const v = data ? data.license_id : undefined;
    if (typeof v === 'string' && v !== '') licenseId = v;
  }
  if (!licenseId) {
    const linked = typeof purchase.linkedPurchaseToken === 'string' ? purchase.linkedPurchaseToken : '';
    if (linked) {
      const linkedDoc = await fire.collection('playTokens').doc(linked).get();
      if (linkedDoc.exists) {
        const data = linkedDoc.data();
        const v = data ? data.license_id : undefined;
        if (typeof v === 'string' && v !== '') licenseId = v;
      }
    }
  }

  if (action === 'grant') {
    if (!licenseId) {
      // Webhook beat the client's redeem: mint (bound to the purchaser's
      // Firebase account when the email resolves), which also writes the token
      // map for later renewals.
      if (paymentState === 1) {
        let uid = null;
        const email = typeof purchase.emailAddress === 'string' && purchase.emailAddress !== '' ? purchase.emailAddress : null;
        if (email) {
          const byEmail = await getUserByEmailSafe(email);
          if (byEmail) uid = byEmail.uid;
        }
        await ensureLicenseForPlayPurchase(purchase, purchaseToken, uid);
      }
      return;
    }
    // Renewal / recovery / restart / defer: extend the license expiry, refresh
    // status, and record the charge as its own sales row (one per orderId).
    /** @type {Record<string, unknown>} */
    const licUpdate = { status: 'active' };
    if (expSeconds) licUpdate.exp = expSeconds;
    await fire.collection('licenses').doc(licenseId).set(licUpdate, { merge: true });
    if (orderId) {
      const existingSale = await fire.collection('sales').doc(orderId).get();
      const existingData = existingSale.exists ? /** @type {Record<string, unknown>} */ (existingSale.data() ?? {}) : {};
      await fire
        .collection('sales')
        .doc(orderId)
        .set(
          {
            ...saleRowForMerge(playPurchaseToLedger(purchase), existingData),
            license_id: licenseId,
            purchase_token: purchaseToken ?? null,
            updatedAt: new Date().toISOString(),
          },
          { merge: true },
        );
    }
    return;
  }

  if (action === 'loss') {
    if (licenseId) {
      await fire.collection('licenses').doc(licenseId).set({ status: 'refunded' }, { merge: true });
    }
    if (orderId) {
      await fire
        .collection('sales')
        .doc(orderId)
        .set({ refunded: true, refunded_at: new Date().toISOString(), status: 'refunded' }, { merge: true });
    }
    return;
  }

  // 'risk' (canceled / on-hold / grace / paused): keep exp, note the state.
  if (licenseId) {
    await fire.collection('licenses').doc(licenseId).set({ status: 'at-risk' }, { merge: true });
  }
}
