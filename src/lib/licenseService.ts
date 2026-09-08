/**
 * Client boundary for the license endpoints on the app's microservice
 * (api/license/*.js on Vercel). Mirrors parseService: endpoints and the
 * shared secret come from build-time env vars, and nothing here ever
 * handles the Lemon Squeezy API key or the license-signing secret.
 */

import { parseLicenseToken } from './license';
import { t } from './i18n';
import type { LicensePayload } from './license';

const API_BASE = (import.meta.env.VITE_API_BASE ?? '').trim();
const SECRET = (import.meta.env.VITE_PARSE_SECRET ?? '').trim();

export type LicenseResult =
  | { ok: true; license: string; payload: LicensePayload }
  | { ok: false; code: string; message: string };

export type LookupResult =
  | { ok: true; license: string | null; payload: LicensePayload | null }
  | { ok: false; message: string };

export type CheckResult =
  | { ok: true; active: boolean; payload: LicensePayload | null }
  | { ok: false; message: string };

interface EndpointReply {
  status: number;
  payload: Record<string, unknown> | null;
}

async function postLicense(path: string, body: Record<string, unknown>): Promise<EndpointReply> {
  if (!API_BASE || !SECRET) {
    return { status: 0, payload: { code: 'not-configured' } };
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-budget-secret': SECRET,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { status: 0, payload: null };
  }
  let payload: Record<string, unknown> | null = null;
  try {
    payload = (await res.json()) as Record<string, unknown>;
  } catch {
    payload = null;
  }
  return { status: res.status, payload };
}

/**
 * Exchange a Lemon Squeezy purchase reference for a signed license. The
 * reference may be a numeric order id / order number (the [order_id] link
 * variable) or a license key (the [license_key] link variable — the primary
 * path, since the License API resolves it without consuming an activation).
 * The server verifies the order is paid with the LS API, mints the license,
 * records the sale, and (when the user is signed in) binds it to the
 * account. Idempotent: re-redeeming the same order returns the same license.
 */
export async function redeemLicense(reference: string, idToken?: string): Promise<LicenseResult> {
  const isNumeric = /^\d+$/.test(reference);
  const { status, payload } = await postLicense('/api/license/redeem', {
    orderId: isNumeric ? reference : null,
    key: isNumeric ? null : reference,
    idToken: idToken ?? null,
  });
  if (payload && payload.ok === true && typeof payload.license === 'string') {
    const parsed = parseLicenseToken(payload.license);
    if (parsed) return { ok: true, license: payload.license, payload: parsed };
    return { ok: false, code: 'unexpected', message: t('licensing.unexpected') };
  }
  const code = typeof payload?.code === 'string' ? payload.code : '';
  if (code === 'email-mismatch') {
    return {
      ok: false,
      code: 'email-mismatch',
      message: t('licensing.emailMismatch'),
    };
  }
  if (code === 'rate-limited') {
    return {
      ok: false,
      code: 'rate-limited',
      message: t('licensing.rateLimited'),
    };
  }
  if (code === 'purchase-not-paid' || status === 409) {
    return { ok: false, code: 'purchase-not-paid', message: t('licensing.notPaid') };
  }
  if (code === 'purchase-refunded') {
    return { ok: false, code: 'purchase-refunded', message: t('licensing.refunded') };
  }
  if (code === 'purchase-not-found' || status === 404) {
    return {
      ok: false,
      code: 'purchase-not-found',
      message: t('licensing.notFound'),
    };
  }
  if (status === 401 || status === 403) {
    return { ok: false, code: 'unauthorized', message: t('licensing.unauthorized') };
  }
  if (code === 'not-configured' || status === 503) {
    return {
      ok: false,
      code: 'not-configured',
      message: t('licensing.notConfigured'),
    };
  }
  if (code === 'internal' && typeof payload?.reason === 'string' && payload.reason !== '') {
    return { ok: false, code: 'internal', message: t('licensing.serverError', { reason: payload.reason.slice(0, 160) }) };
  }
  return { ok: false, code: 'network', message: t('licensing.unreachable') };
}

/** Restore the license bound to the signed-in account (new device/reinstall). */
export async function lookupLicense(idToken: string): Promise<LookupResult> {
  const { status, payload } = await postLicense('/api/license/lookup', { idToken });
  if (payload && payload.ok === true) {
    if (typeof payload.license === 'string' && payload.license !== '') {
      const parsed = parseLicenseToken(payload.license);
      return { ok: true, license: parsed ? payload.license : null, payload: parsed };
    }
    return { ok: true, license: null, payload: null };
  }
  if (status === 401 || status === 403) {
    return { ok: false, message: t('licensing.verifyFailed') };
  }
  return { ok: false, message: t('licensing.unreachable') };
}

/**
 * Validate a pasted key (Settings recovery fallback, never primary). A Lemon
 * Squeezy license key can only be redeemed into a license for the SIGNED-IN
 * account (purchases are always account-bound), so the idToken is required
 * for that path; our own signed tokens verify without it.
 */
export async function checkLicenseKey(key: string, idToken?: string): Promise<CheckResult> {
  const { payload } = await postLicense('/api/license/check', { key, idToken: idToken ?? null });
  if (payload && payload.ok === true) {
    const token = typeof payload.license === 'string' ? payload.license : '';
    const parsed = parseLicenseToken(token);
    return { ok: true, active: typeof payload.active === 'boolean' ? payload.active : false, payload: parsed };
  }
  const code = typeof payload?.code === 'string' ? payload.code : '';
  if (code === 'license-invalid') {
    return { ok: true, active: false, payload: null };
  }
  if (code === 'sign-in-required') {
    return { ok: false, message: t('licensing.signInRequired') };
  }
  if (code === 'email-mismatch') {
    return {
      ok: false,
      message: t('licensing.keyEmailMismatch'),
    };
  }
  if (code === 'rate-limited') {
    return { ok: false, message: t('licensing.rateLimited') };
  }
  return { ok: false, message: t('licensing.unreachable') };
}
