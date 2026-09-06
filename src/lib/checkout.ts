/**
 * Lemon Squeezy checkout overlay (client).
 *
 * The app opens the store's buy link inside the Lemon Squeezy overlay script
 * (an in-app iframe/popup). If the script fails to load — or the overlay is
 * broken in the current browser — we fall back to opening the checkout in a
 * new tab, and finally to a same-tab navigation. In every case the checkout
 * redirects back to the app with the order reference (see skills/paywall-ops.md
 * for the redirect placeholders).
 */

const CHECKOUT_URL = (import.meta.env.VITE_CHECKOUT_URL ?? '').trim();
// Current documented Lemon.js URL (docs.lemonsqueezy.com/help/lemonjs).
const OVERLAY_SCRIPT_URL = 'https://app.lemonsqueezy.com/js/lemon.js';

export function checkoutConfigured(): boolean {
  return CHECKOUT_URL.length > 0;
}

/** The buy link with Lemon's "bare checkout" embed parameters applied. */
export function buildCheckoutUrl(): string {
  const url = new URL(CHECKOUT_URL);
  url.searchParams.set('embed', '1');
  url.searchParams.set('media', '0');
  url.searchParams.set('logo', '0');
  url.searchParams.set('desc', '0');
  url.searchParams.set('discount', '0');
  return url.toString();
}

let scriptPromise: Promise<boolean> | null = null;

/** Load lemonsqueezy.js once per session; resolves to its availability. */
function loadOverlayScript(): Promise<boolean> {
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve) => {
      try {
        const existing = document.querySelector(`script[src="${OVERLAY_SCRIPT_URL}"]`);
        if (existing) {
          resolve(true);
          return;
        }
        const script = document.createElement('script');
        script.src = OVERLAY_SCRIPT_URL;
        script.async = true;
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.head.appendChild(script);
        setTimeout(() => resolve(false), 10000);
      } catch {
        resolve(false);
      }
    });
  }
  return scriptPromise;
}

type LemonSqueezyGlobal = {
  Url?: { Open?: (url: string) => void };
};

export type CheckoutOpenMode = 'overlay' | 'tab' | 'unavailable';

/**
 * Open the checkout. Preference order: overlay (in-app) → new tab → same-tab
 * navigation. Returns how it was opened so the UI can narrate a fallback.
 */
export async function openCheckout(): Promise<CheckoutOpenMode> {
  if (!checkoutConfigured()) return 'unavailable';
  const url = buildCheckoutUrl();

  if (await loadOverlayScript()) {
    const g = (window as unknown as { LemonSqueezy?: LemonSqueezyGlobal }).LemonSqueezy;
    const opener = g?.Url?.Open;
    if (typeof opener === 'function') {
      try {
        opener(url);
        return 'overlay';
      } catch {
        // Fall through to a tab.
      }
    }
  }

  const tab = window.open(url, '_blank');
  if (tab) return 'tab';
  window.location.href = url;
  return 'tab';
}
