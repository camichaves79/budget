/**
 * First-open welcome (2026-09, `first-open-welcome`): a one-time modal that
 * says what the app is for and points at the first three moves. "One-time"
 * is a localStorage flag; the decision core is pure for the smoke suite.
 */

export const WELCOME_SEEN_KEY = 'budget.welcomeSeen';

/** How long after launch before the welcome appears (ms) — lets the first
 *  paint land before the modal pops in. */
export const WELCOME_DELAY_MS = 500;

/** Pure decision core (smoke-tested): show exactly once, on first open. */
export function shouldShowWelcome(seen: boolean): boolean {
  return !seen;
}

export function welcomeSeen(): boolean {
  try {
    return localStorage.getItem(WELCOME_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markWelcomeSeen(): void {
  try {
    localStorage.setItem(WELCOME_SEEN_KEY, '1');
  } catch {
    /* storage unavailable — the welcome may reappear next visit; harmless */
  }
}
