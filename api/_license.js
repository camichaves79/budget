/**
 * Pure license/ledger/webhook logic shared by the Vercel Functions.
 * No dependencies beyond node:crypto — everything here is smoke-tested
 * (tests/smoke.ts) because it is the trust boundary for a paid feature.
 *
 * License token: `<base64url(json payload)>.<base64url(hmac-sha256)>`, HMAC
 * keyed with BUDGET_LICENSE_SECRET (server-side only). The client parses but
 * cannot forge tokens; the parse endpoint re-verifies on every call.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const LICENSE_VERSION = 1;
export const LICENSE_KID = 'budget-license-v1';
export const LICENSE_PLAN = 'yearly';
/** v1 licenses run 365 days from purchase (manual renewal). */
export const LICENSE_TERM_SECONDS = 365 * 24 * 60 * 60;
export const DEFAULT_LICENSE_DAILY_CAP = 100;

/**
 * @typedef {{ v: 1, kid: 'budget-license-v1', lic: string, plan: 'yearly',
 *   uid: string | null, iat: number, exp: number }} LicensePayload
 */

/**
 * @param {LicensePayload} payload
 * @param {string} secret
 * @returns {string} signed token
 */
export function signLicense(payload, secret) {
  const json = JSON.stringify(payload);
  const sig = createHmac('sha256', secret).update(json).digest('base64url');
  return `${Buffer.from(json, 'utf8').toString('base64url')}.${sig}`;
}

/**
 * @param {{ lic: string, uid: string | null, iatSeconds: number, expSeconds: number }} fields
 * @returns {LicensePayload}
 */
export function makeLicensePayload({ lic, uid, iatSeconds, expSeconds }) {
  return {
    v: LICENSE_VERSION,
    kid: LICENSE_KID,
    lic,
    plan: LICENSE_PLAN,
    uid: uid ?? null,
    iat: iatSeconds,
    exp: expSeconds,
  };
}

/**
 * Verify a license token: structure → signature (constant-time) → expiry.
 * @param {string | null | undefined} token
 * @param {string} secret
 * @param {number} [nowSeconds]
 * @returns {{ ok: true, payload: LicensePayload } | { ok: false, reason: 'malformed' | 'signature' | 'expired' }}
 */
export function verifyLicenseToken(token, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string' || token.length === 0 || token.length > 4000) {
    return { ok: false, reason: 'malformed' };
  }
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };

  let json;
  try {
    json = Buffer.from(parts[0], 'base64url').toString('utf8');
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  /** @type {unknown} */
  let payload;
  try {
    payload = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, reason: 'malformed' };
  const p = /** @type {Record<string, unknown>} */ (payload);
  if (p.v !== LICENSE_VERSION || p.kid !== LICENSE_KID || p.plan !== LICENSE_PLAN) {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof p.lic !== 'string' || p.lic === '') return { ok: false, reason: 'malformed' };
  if (p.uid !== null && typeof p.uid !== 'string') return { ok: false, reason: 'malformed' };
  if (typeof p.iat !== 'number' || !Number.isFinite(p.iat)) return { ok: false, reason: 'malformed' };
  if (typeof p.exp !== 'number' || !Number.isFinite(p.exp)) return { ok: false, reason: 'malformed' };

  let given;
  try {
    given = Buffer.from(parts[1], 'base64url');
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const expected = createHmac('sha256', secret).update(json).digest();
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'signature' };
  }
  if (p.exp <= nowSeconds) return { ok: false, reason: 'expired' };
  return {
    ok: true,
    payload: /** @type {LicensePayload} */ ({
      v: 1,
      kid: LICENSE_KID,
      lic: p.lic,
      plan: LICENSE_PLAN,
      uid: p.uid,
      iat: p.iat,
      exp: p.exp,
    }),
  };
}

/* ---------- Per-license daily meter (instance-local) ---------- */

/**
 * Meter licensed parses per license per UTC day. Instance-local like the
 * parse endpoint's per-IP limiter: warm instances share nothing, so the cap
 * is a cost bound, not a guarantee. Bounds the heavy-tail usage behind a
 * $5 license (ARCHITECTURE.md A12).
 * @param {{ limitPerDay?: number, maxEntries?: number }} [options]
 */
export function createLicenseMeter({ limitPerDay = DEFAULT_LICENSE_DAILY_CAP, maxEntries = 5000 } = {}) {
  /** @type {Map<string, { day: string, count: number }>} */
  const usage = new Map();

  /**
   * @param {string} lic
   * @param {Date} [now]
   * @returns {boolean} true when the parse is allowed
   */
  const allow = (lic, now = new Date()) => {
    const day = now.toISOString().slice(0, 10);
    const entry = usage.get(lic);
    if (!entry || entry.day !== day) {
      usage.set(lic, { day, count: 1 });
      prune(now);
      return true;
    }
    if (entry.count >= limitPerDay) return false;
    entry.count += 1;
    return true;
  };

  /** @param {Date} now */
  const prune = (now) => {
    if (usage.size <= maxEntries) return;
    const day = now.toISOString().slice(0, 10);
    for (const [key, entry] of usage) {
      if (entry.day !== day) usage.delete(key);
    }
    while (usage.size > maxEntries) {
      const first = usage.keys().next();
      if (first.done) break;
      usage.delete(first.value);
    }
  };

  return { allow };
}

/* ---------- Redemption ownership ---------- */

/**
 * Ownership check for redemptions (2026-09): the signed-in account's email
 * must match the LS order's buyer email (case-insensitive, trimmed). LS
 * order ids are small NUMERIC values, so without this check anyone could
 * enumerate them through the redeem endpoint and claim a paid order for
 * their own account. Empty/missing/non-string values never match.
 * @param {unknown} accountEmail Firebase id-token email
 * @param {unknown} buyerEmail   LS order user_email
 * @returns {boolean}
 */
export function emailsMatch(accountEmail, buyerEmail) {
  const a = typeof accountEmail === 'string' ? accountEmail.trim().toLowerCase() : '';
  const b = typeof buyerEmail === 'string' ? buyerEmail.trim().toLowerCase() : '';
  return a !== '' && a === b;
}

/* ---------- Lemon Squeezy webhook signature ---------- */

/**
 * Verify the LS webhook signature: hex HMAC-SHA256 of the RAW body, keyed
 * with the webhook signing secret (docs: help/webhooks/signing-requests).
 * @param {string} rawBody
 * @param {string | null | undefined} signatureHeader
 * @param {string} secret
 * @returns {boolean}
 */
export function verifyWebhookSignature(rawBody, signatureHeader, secret) {
  if (typeof rawBody !== 'string' || rawBody.length === 0) return false;
  if (typeof signatureHeader !== 'string' || signatureHeader.length === 0 || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const given = signatureHeader.trim().toLowerCase();
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(given, 'utf8'));
}

/* ---------- Lemon Squeezy fee math (ESTIMATE — see docs) ---------- */

/**
 * LS platform fee estimate: 5% + $0.50 baseline. The order API does not
 * expose per-sale fee breakdowns (international-card +1.5%, PayPal +1.5%,
 * subscription +0.5% surcharges may apply), so the ledger's fee/net columns
 * are ESTIMATES; payout reports are the source of truth for reconciliation
 * (skills/paywall-ops.md).
 *
 * The fixed $0.50 component is converted into the order currency when the
 * order carries a `currency_rate` (USD per 1 unit of the order currency —
 * LS includes it on non-USD orders); without a rate the USD baseline is
 * kept, so a missing rate never silently drops the fixed fee.
 * @param {number} subtotalCents
 * @param {string} [currency]
 * @param {unknown} [currencyRate]
 * @returns {number}
 */
export function estimateLsFeeCents(subtotalCents, currency = 'USD', currencyRate = null) {
  if (!Number.isFinite(subtotalCents) || subtotalCents <= 0) return 0;
  const rate = Number(currencyRate);
  const fixed = currency !== 'USD' && Number.isFinite(rate) && rate > 0 ? Math.round(50 / rate) : 50;
  return Math.round(subtotalCents * 0.05) + fixed;
}

/**
 * @param {number} subtotalCents
 * @param {string} [currency]
 * @param {unknown} [currencyRate]
 * @returns {number}
 */
export function estimateNetCents(subtotalCents, currency = 'USD', currencyRate = null) {
  return subtotalCents - estimateLsFeeCents(subtotalCents, currency, currencyRate);
}

/* ---------- Google Play fee math (ESTIMATE — see docs) ---------- */

/**
 * Google Play service fee estimate: 15% of the price (subscription rate;
 * there is no fixed per-transaction fee, unlike Lemon Squeezy's $0.50). The
 * fee may drop to 10% after a subscriber's 12-month anniversary (footnote in
 * skills/paywall-ops.md); the ledger keeps 15% as the conservative estimate,
 * and Play earnings reports are the reconciliation source of truth.
 * @param {number} subtotalCents
 * @returns {number}
 */
export function estimatePlayFeeCents(subtotalCents) {
  if (!Number.isFinite(subtotalCents) || subtotalCents <= 0) return 0;
  return Math.round(subtotalCents * 0.15);
}

/**
 * @param {number} subtotalCents
 * @returns {number}
 */
export function estimatePlayNetCents(subtotalCents) {
  return subtotalCents - estimatePlayFeeCents(subtotalCents);
}

/**
 * Map a Google Play subscription purchase (the classic
 * purchases.subscriptions resource) into the SAME sales-ledger shape the
 * Lemon Squeezy path uses, with `source: 'play'`. Amounts are integer cents
 * in the order currency — Play reports `priceAmountMicros` (1/1,000,000 of a
 * currency unit), so cents = micros / 10,000. `order_id`/`order_number` are
 * the Play order id (`GPA.xxx-n`, one per charge; renewals chain via
 * `linkedPurchaseToken`). Play has no per-order invoice/receipt URL, so those
 * stay null and reconciliation uses the earnings reports.
 * @param {Record<string, unknown> | null | undefined} purchase
 */
export function playPurchaseToLedger(purchase) {
  const p = purchase ?? {};
  const micros = Number(p.priceAmountMicros);
  const gross = Number.isFinite(micros) && micros > 0 ? Math.round(micros / 10000) : 0;
  const startMs = Number(p.startTimeMillis);
  const paymentState = Number(p.paymentState);
  const status =
    paymentState === 1
      ? 'paid'
      : paymentState === 2
        ? 'trial'
        : paymentState === 0 || paymentState === 3
          ? 'pending'
          : 'unknown';
  const orderId = typeof p.orderId === 'string' ? p.orderId : '';
  return {
    source: 'play',
    order_id: orderId,
    order_number: orderId !== '' ? orderId : null,
    date: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
    status,
    gross,
    tax: 0,
    total: gross,
    fees_estimate: estimatePlayFeeCents(gross),
    net_estimate: estimatePlayNetCents(gross),
    currency: typeof p.priceCurrencyCode === 'string' ? p.priceCurrencyCode : 'USD',
    buyer_email: typeof p.emailAddress === 'string' ? p.emailAddress : '',
    receipt_url: null,
    invoice_url: null,
    test_mode: Number(p.purchaseType) === 0,
    refunded: false,
    refunded_amount: 0,
    refunded_at: null,
  };
}

/* ---------- LS order → sales-ledger mapping ---------- */

/**
 * Map a Lemon Squeezy order `data.attributes` object (webhook or
 * GET /v1/orders/{id}) into the sales-ledger document shape. Amounts are
 * integer cents in the order currency.
 * @param {Record<string, unknown> | null | undefined} attributes
 */
export function orderToLedger(attributes) {
  const a = attributes ?? {};
  const subtotal = Number.isFinite(a.subtotal) ? /** @type {number} */ (a.subtotal) : 0;
  const urls = a.urls && typeof a.urls === 'object' ? /** @type {Record<string, unknown>} */ (a.urls) : {};
  return {
    source: 'ls',
    order_id: String(a.identifier ?? ''),
    order_number: a.order_number ?? null,
    date: typeof a.created_at === 'string' ? a.created_at : null,
    status: typeof a.status === 'string' ? a.status : 'unknown',
    gross: subtotal,
    tax: Number.isFinite(a.tax) ? /** @type {number} */ (a.tax) : 0,
    total: Number.isFinite(a.total) ? /** @type {number} */ (a.total) : 0,
    fees_estimate: estimateLsFeeCents(subtotal, typeof a.currency === 'string' ? a.currency : 'USD', a.currency_rate),
    net_estimate: estimateNetCents(subtotal, typeof a.currency === 'string' ? a.currency : 'USD', a.currency_rate),
    currency: typeof a.currency === 'string' ? a.currency : 'USD',
    buyer_email: typeof a.user_email === 'string' ? a.user_email : '',
    receipt_url: typeof urls.receipt === 'string' ? urls.receipt : null,
    invoice_url: /** @type {string | null} */ (null), // filled by our generate-invoice endpoint
    test_mode: Boolean(a.test_mode),
    refunded: Boolean(a.refunded),
    refunded_amount: Number.isFinite(a.refunded_amount) ? /** @type {number} */ (a.refunded_amount) : 0,
    refunded_at: typeof a.refunded_at === 'string' ? a.refunded_at : null,
  };
}

/**
 * Map a webhook event to a ledger write, or null for events we ignore.
 * @param {string} eventName
 * @param {Record<string, unknown> | null | undefined} attributes
 */
export function webhookToLedger(eventName, attributes) {
  if (eventName === 'order_created' || eventName === 'order_refunded') {
    return { ledger: orderToLedger(attributes) };
  }
  return null;
}

/* ---------- Ledger → CSV (accountant export) ---------- */

export const LEDGER_CSV_COLUMNS = [
  'source',
  'date',
  'order_number',
  'status',
  'gross',
  'tax',
  'total',
  'fees_estimate',
  'net_estimate',
  'currency',
  'buyer_email',
  'license_id',
  'receipt_url',
  'invoice_url',
  'refunded',
  'refunded_amount',
  'refunded_at',
  'test_mode',
];

/** @param {unknown} value */
function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Legacy doc keys: rows written before 2026-09 stored the fee columns as
 * `fees`/`net`; the CSV contract (paywall-ops) is `fees_estimate`/
 * `net_estimate`. Read the canonical key with the legacy fallback so old
 * sales docs still render their values.
 * @type {Record<string, string>}
 */
const CSV_FIELD_ALIASES = { fees_estimate: 'fees', net_estimate: 'net' };

/**
 * Columns whose empty/missing value falls back to a default. Rows written
 * before the dual-merchant split carry no `source`; they render as `ls`.
 * @type {Record<string, string>}
 */
const CSV_FIELD_DEFAULTS = { source: 'ls' };

/**
 * @param {Array<Record<string, unknown>>} rows
 * @returns {string} CSV text (CRLF, \uFEFF BOM for spreadsheet apps)
 */
export function ledgerToCsv(rows) {
  const lines = [LEDGER_CSV_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(
      LEDGER_CSV_COLUMNS.map((col) => {
        const legacy = CSV_FIELD_ALIASES[col];
        const value = row[col] ?? (legacy !== undefined ? row[legacy] : undefined);
        return csvEscape(
          value === null || value === undefined || value === '' ? CSV_FIELD_DEFAULTS[col] : value,
        );
      }).join(','),
    );
  }
  return `\uFEFF${lines.join('\r\n')}`;
}
