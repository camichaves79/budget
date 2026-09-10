/**
 * Play Store build detection (2026-09, the PWA-in-Play exploration — stance B:
 * the Play app is the free tier and purchases stay web-only).
 *
 * The Android TWA launches the same site with `?src=play` in its start URL.
 * Detection is synchronous and idempotent (StrictMode-safe, same pattern as
 * `takePurchaseParam` in state/entitlement.tsx): the param is consumed once,
 * the flag is persisted to localStorage, and the param is stripped so a
 * reload of the page (inside the TWA or in a browser opened from it) cannot
 * re-mark a browser context.
 *
 * The pure core (`playBuildDecision`) is smoke-tested; the DOM wrapper is a
 * thin, guarded shell.
 */

export const PLAY_BUILD_KEY = 'budget.playBuild';

/**
 * Pure decision core: a boot marks the Play build when the flag was already
 * persisted OR the start URL carries `?src=play`.
 */
export function playBuildDecision(storedFlag: boolean, srcParam: string | null): boolean {
  return storedFlag || srcParam === 'play';
}

let cached: boolean | null = null;

/**
 * Run once at boot (EntitlementProvider's first render). Returns whether this
 * is a Play Store build and persists the flag. Idempotent: after the first
 * call the param is gone and the cached value is authoritative.
 */
export function detectPlayBuild(): boolean {
  if (cached !== null) return cached;
  cached = false;
  if (typeof window === 'undefined') return cached;
  try {
    const params = new URLSearchParams(window.location.search);
    const src = params.get('src');
    if (src === 'play') {
      cached = true;
      localStorage.setItem(PLAY_BUILD_KEY, '1');
      params.delete('src');
      const rest = params.toString();
      window.history.replaceState(
        null,
        '',
        window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash,
      );
      return cached;
    }
    if (localStorage.getItem(PLAY_BUILD_KEY) === '1') cached = true;
  } catch {
    cached = false;
  }
  return cached;
}

/** The cached play-build flag (call after `detectPlayBuild` ran at boot). */
export function isPlayBuild(): boolean {
  return cached === true;
}
