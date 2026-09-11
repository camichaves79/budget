/**
 * Support mode (2026-09-12): a persisted, opt-in switch for the technical
 * surfaces that are useful while diagnosing a device (the Play Billing
 * diagnostics dump in Settings → Smart entry) but must never appear on a
 * normal screen.
 *
 * Armed and disarmed by URL so it needs no hidden gesture inside the installed
 * app: open `https://5budget.app/?diag=1` in a browser to arm it, `?diag=0` to
 * disarm. The flag is persisted in localStorage, which the Play-installed TWA
 * shares with Chrome for this origin (proven during the 2026-09-12 Play Billing
 * investigation), so arming it in a browser arms it for the app too.
 *
 * The pure core (`supportModeDecision`) is smoke-tested; the DOM wrapper is a
 * thin, guarded shell — the same split as lib/playBuild.ts.
 */

export const SUPPORT_MODE_KEY = 'budget.supportMode.v1';

/**
 * Pure decision core: an explicit `?diag=` value wins (so the switch can always
 * be flipped from a URL), otherwise the persisted flag decides.
 */
export function supportModeDecision(stored: boolean, diagParam: string | null): boolean {
  if (diagParam === '1') return true;
  if (diagParam === '0') return false;
  return stored;
}

let cached: boolean | null = null;

/** Read (and apply) the support-mode flag once per boot. Idempotent. */
export function supportModeEnabled(): boolean {
  if (cached !== null) return cached;
  cached = false;
  if (typeof window === 'undefined') return cached;
  try {
    const param = new URLSearchParams(window.location.search).get('diag');
    const stored = localStorage.getItem(SUPPORT_MODE_KEY) === '1';
    cached = supportModeDecision(stored, param);
    if (param === '1') localStorage.setItem(SUPPORT_MODE_KEY, '1');
    else if (param === '0') localStorage.removeItem(SUPPORT_MODE_KEY);
  } catch {
    cached = false;
  }
  return cached;
}
