/**
 * GET /api/ledger/export?format=csv|json — accountant export of the sales
 * ledger (every sale and refund: date, gross, fees estimate, net estimate,
 * currency, buyer, license id, receipt/invoice links, refund fields).
 *
 * Protected by the x-budget-admin header (BUDGET_ADMIN_SECRET) — same
 * shared-secret posture as the rest of the service (A10). Fees/net are
 * ESTIMATES (5% + $0.50 baseline); Lemon Squeezy payout reports are the
 * reconciliation source of truth (skills/paywall-ops.md).
 */

import { handleCors, send } from '../_http.js';
import { db } from '../_firebase.js';
import { ledgerToCsv } from '../_license.js';

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export default async function handler(req, res) {
  const { cors, done } = handleCors(req, res);
  if (done) return;
  if (req.method === 'OPTIONS') {
    send(res, 204, null, cors);
    return;
  }
  if (req.method !== 'GET') {
    send(res, 405, { ok: false, code: 'bad-request' }, cors);
    return;
  }

  const raw = req.headers['x-budget-admin'];
  const given = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
  const expected = process.env.BUDGET_ADMIN_SECRET ?? '';
  if (expected === '' || given !== expected) {
    send(res, 401, { ok: false, code: 'unauthorized' }, cors);
    return;
  }

  const fire = db();
  if (!fire) {
    send(res, 503, { ok: false, code: 'not-configured' }, cors);
    return;
  }

  try {
    const snap = await fire.collection('sales').get();
    const rows = snap.docs
      .map((d) => /** @type {Record<string, unknown>} */ (d.data()))
      .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));

    const url = req.url ?? '';
    if (url.includes('format=json')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="budget-sales.json"');
      res.statusCode = 200;
      res.end(JSON.stringify({ exportedAt: new Date().toISOString(), sales: rows }, null, 2));
      return;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="budget-sales.csv"');
    res.statusCode = 200;
    res.end(ledgerToCsv(rows));
  } catch (err) {
    console.error('ledger export failed', /** @type {Error} */ (err).message);
    send(res, 500, { ok: false, code: 'export-failed' }, cors);
  }
}
