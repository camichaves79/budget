/**
 * License token (client view).
 *
 * The token is `<base64url(payload)>.<base64url(hmac)>`, minted and signed by
 * the microservice with a server-side secret (api/_license.js). The client
 * only PARSES it — it cannot verify the signature (that would require the
 * secret in the bundle). Client-side checks are for display and gating only;
 * the parse microservice re-verifies the signature on every parse.
 */

export interface LicensePayload {
  v: 1;
  kid: 'budget-license-v1';
  /** License id (UUID) — the meter key server-side. */
  lic: string;
  plan: 'yearly';
  /** Firebase uid the license is bound to, or null when bought unsigned-in. */
  uid: string | null;
  /** Issued at, unix seconds. */
  iat: number;
  /** Expires at, unix seconds (iat + 365 days). */
  exp: number;
}

const LICENSE_STORAGE_KEY = 'budget.license.v1';

/**
 * Parse a license token into its payload. Returns null for anything that
 * does not look like one of our tokens — the server remains the authority.
 */
export function parseLicenseToken(token: string): LicensePayload | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > 4000) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  let decoded: string;
  try {
    decoded = decodeBase64Url(parts[0]);
  } catch {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (p.v !== 1 || p.kid !== 'budget-license-v1') return null;
  if (typeof p.lic !== 'string' || p.lic === '' || p.plan !== 'yearly') return null;
  if (p.uid !== null && typeof p.uid !== 'string') return null;
  if (typeof p.iat !== 'number' || !Number.isFinite(p.iat)) return null;
  if (typeof p.exp !== 'number' || !Number.isFinite(p.exp)) return null;
  return {
    v: 1,
    kid: 'budget-license-v1',
    lic: p.lic,
    plan: 'yearly',
    uid: p.uid,
    iat: p.iat,
    exp: p.exp,
  };
}

/** True while the license is still in its validity window (client view). */
export function licenseIsActive(payload: LicensePayload | null, nowMs = Date.now()): boolean {
  return payload !== null && payload.exp * 1000 > nowMs;
}

/** "Sep 4, 2027" — the date the current license runs out. */
export function formatLicenseExpiry(expSeconds: number): string {
  return new Date(expSeconds * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function loadLicenseToken(): string | null {
  try {
    return localStorage.getItem(LICENSE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveLicenseToken(token: string): void {
  try {
    localStorage.setItem(LICENSE_STORAGE_KEY, token);
  } catch {
    // Storage unavailable — the license can be restored later via sign-in.
  }
}

export function clearLicenseToken(): void {
  try {
    localStorage.removeItem(LICENSE_STORAGE_KEY);
  } catch {
    // Nothing to do.
  }
}

function decodeBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, '=');
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
