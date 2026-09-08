import { useEffect, useSyncExternalStore, useState } from 'react';

/**
 * PWA install detection (2026-09, `install-app-signal`).
 *
 * Two different facts:
 * - "running as an installed PWA" — detectable everywhere via
 *   `navigator.standalone` (iOS) and the `display-mode: standalone` media
 *   query (Chromium + iOS 13+ Safari).
 * - "installable right now" — only Chromium says so, through the
 *   `beforeinstallprompt` event; iOS has no install API at all, so iPhone
 *   users get a one-time Share → "Add to Home Screen" tip instead.
 *
 * Both nudges are one-time: dismissing stores a flag in localStorage, and
 * neither signal ever shows inside the installed app. The tip delay gives
 * the first paint room to breathe before the nudge appears.
 */

export const INSTALL_TIP_STORAGE_KEY = 'budget.installTipDismissed';

/** How long after launch before the nudge may appear (ms). */
export const INSTALL_TIP_DELAY_MS = 4000;

export type InstallSignalKind = 'ios-tip' | 'install-button';

export interface InstallSignal {
  kind: InstallSignalKind;
}

/** Pure decision core (smoke-tested): what nudge to show, if any. */
export function decideInstallSignal(opts: {
  standalone: boolean;
  dismissed: boolean;
  ios: boolean;
  canInstall: boolean;
}): InstallSignal | null {
  if (opts.standalone || opts.dismissed) return null;
  if (opts.ios) return { kind: 'ios-tip' };
  if (opts.canInstall) return { kind: 'install-button' };
  return null;
}

/**
 * iOS user-agent sniff, pure for tests. iPadOS ≥ 13 lies ("Macintosh") —
 * a touch-capable Mac UA is the tell. Only used to pick which nudge copy
 * to show; it never gates functionality.
 */
export function uaLooksIos(ua: string, maxTouchPoints: number | undefined): boolean {
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  return /macintosh/i.test(ua) && typeof maxTouchPoints === 'number' && maxTouchPoints > 1;
}

export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { maxTouchPoints?: number };
  return uaLooksIos(nav.userAgent ?? '', nav.maxTouchPoints);
}

/** Running from the home-screen icon (installed PWA), not a browser tab. */
export function isStandalone(): boolean {
  if (typeof navigator !== 'undefined') {
    // Non-standard but stable on iOS; dropped from TS's DOM lib.
    const nav = navigator as Navigator & { standalone?: boolean };
    if (nav.standalone === true) return true;
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    try {
      return window.matchMedia('(display-mode: standalone)').matches;
    } catch {
      /* very old engines: fall through to "not standalone" */
    }
  }
  return false;
}

export function installTipDismissed(): boolean {
  try {
    return localStorage.getItem(INSTALL_TIP_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissInstallTip(): void {
  try {
    localStorage.setItem(INSTALL_TIP_STORAGE_KEY, '1');
  } catch {
    /* storage unavailable — the tip may reappear next visit; harmless */
  }
}

/* ------------------------------------------------------------------ */
/* beforeinstallprompt capture (Chromium; never fires on iOS)         */
/* ------------------------------------------------------------------ */

/**
 * Chromium's deferred-install event. Fired once the site meets the
 * installability criteria (manifest + service worker + HTTPS); capturing it
 * suppresses the browser's own mini-infobar so our button can call
 * `prompt()` instead.
 */
export interface DeferredInstallPrompt {
  prompt(): void;
  /** Resolves with the user's choice in the native install dialog. */
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type PromptEvent = Event & DeferredInstallPrompt;

let captured: PromptEvent | null = null;
let listening = false;
const subscribers = new Set<() => void>();

function onBeforeInstallPrompt(ev: Event) {
  ev.preventDefault();
  captured = ev as PromptEvent;
  for (const cb of subscribers) cb();
}

export function hasCapturedPrompt(): boolean {
  return captured !== null;
}

/** Subscribe to capture/consume notifications (idempotent listener). */
export function subscribeInstallPrompt(cb: () => void): () => void {
  if (typeof window !== 'undefined' && !listening) {
    listening = true;
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  }
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

/** Show the native install dialog (must follow a user gesture). */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const ev = captured;
  if (!ev) return 'unavailable';
  captured = null; // a deferred prompt is single-use
  for (const cb of subscribers) cb(); // the button disappears once used
  try {
    ev.prompt();
  } catch {
    /* the gesture is gone or the criteria lapsed — nothing to show */
  }
  try {
    const choice = await ev.userChoice;
    return choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    return 'dismissed';
  }
}

/* ------------------------------------------------------------------ */
/* React view                                                         */
/* ------------------------------------------------------------------ */

export interface InstallSignalApi {
  /** Non-null once the delay has passed and a nudge applies. */
  signal: InstallSignal | null;
  dismiss: () => void;
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

/** The install nudge as React state (client-only, like the rest of the app). */
export function useInstallSignal(): InstallSignalApi {
  const canInstall = useSyncExternalStore(subscribeInstallPrompt, hasCapturedPrompt);
  const [dismissed, setDismissed] = useState(installTipDismissed);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), INSTALL_TIP_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  const signal = ready
    ? decideInstallSignal({ standalone: isStandalone(), dismissed, ios: isIosDevice(), canInstall })
    : null;

  const dismiss = () => {
    dismissInstallTip();
    setDismissed(true);
  };

  return { signal, dismiss, promptInstall };
}
