/**
 * Play Store build detection (2026-09, Play Billing integration — Google is
 * the Android merchant). Phase 1: detection only; the Digital Goods billing
 * path is a separate module (src/lib/playBilling.ts) that lands later.
 *
 * The Android TWA launches the same site with `?src=play` in its start URL.
 * Detection is synchronous and idempotent (StrictMode-safe, same pattern as
 * `takePurchaseParam` in state/entitlement.tsx): the param is consumed once,
 * the flag is persisted to localStorage, and the param is stripped so a
 * reload of the page cannot re-mark it from the URL.
 *
 * IMPORTANT: a TWA and a Chrome tab share this origin's localStorage, so the
 * persisted flag LEAKS between them. It is therefore only honoured in a
 * standalone (app-mode) display context — see `persistedPlayBuildUsable`.
 *
 * The pure cores (`playBuildDecision`, `persistedPlayBuildUsable`) are
 * smoke-tested; the DOM wrapper is a thin, guarded shell.
 */

export const PLAY_BUILD_KEY = 'budget.playBuild';

/**
 * Pure decision core: a boot marks the Play build when the flag was already
 * persisted OR the start URL carries `?src=play`.
 */
export function playBuildDecision(storedFlag: boolean, srcParam: string | null): boolean {
  return storedFlag || srcParam === 'play';
}

/**
 * Pure: may a PERSISTED Play-build flag be honoured in this context?
 *
 * The flag itself is a true fact ("this profile has been used inside the Play
 * TWA"), but the UI it drives is Play-billing-only: with the flag set, the
 * Lemon Squeezy checkout and the paste-key affordance are hidden and the sole
 * CTA is the Play subscribe button. Play Billing is only reachable from a TWA
 * in app mode, so honouring a persisted flag inside an ordinary browser tab
 * hides the only payment path that works there — a dead-end purchase
 * (bug found 2026-09-11 via DevTools on the device: the TWA and a Chrome tab
 * share this origin's localStorage, and the flag was never cleared).
 *
 * `standalone` is the current `(display-mode: standalone)` media query, which
 * is what separates the two contexts: a TWA in app mode reports it (measured
 * on-device: `standalone` alone, no `browser`), while a plain Chrome tab
 * reports `browser`. A TWA that stripped `?src=play` via `history.replaceState`
 * still reports `standalone` on reload, so its own reload path keeps working.
 *
 * An explicit `?src=play` is NOT subject to this check: that is the TWA's own
 * start URL, and honouring it is what establishes the flag in the first place.
 */
export function persistedPlayBuildUsable(storedFlag: boolean, standalone: boolean): boolean {
  return storedFlag && standalone;
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
    // A persisted flag only counts when this context can actually bill.
    const stored = localStorage.getItem(PLAY_BUILD_KEY) === '1';
    cached = persistedPlayBuildUsable(stored, isStandaloneDisplay());
  } catch {
    cached = false;
  }
  return cached;
}

/** Whether the page is running in a standalone (app-mode) display context. */
function isStandaloneDisplay(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

/** The cached play-build flag (call after `detectPlayBuild` ran at boot). */
export function isPlayBuild(): boolean {
  return cached === true;
}
