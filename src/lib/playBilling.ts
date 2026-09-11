/**
 * Google Play Billing via the Digital Goods API + Payment Request API
 * (Trusted Web Activity only, Chrome ≥ 101). Phase 2: the client-side
 * purchase flow. The purchase token is handed to /api/license/redeem-play,
 * which verifies the purchase server-side, acknowledges it, and mints the
 * license (phase 3). The client never acknowledges — the server does — so a
 * purchase is never confirmed before the entitlement is granted.
 *
 * Detection split: `playBuild` (state/entitlement) marks the Play build via
 * the `?src=play` start URL; this module gates the ACTUAL billing surface on
 * the Digital Goods API being present (TWA-only), so a browser tab opened
 * from the TWA can never show a Play button that cannot pay.
 *
 * Failure honesty (2026-09-11): a purchase attempt returns a DISCRIMINATED
 * status instead of `null`, because "the user dismissed the sheet" and "the
 * purchase could not start" are different outcomes — conflating them made a
 * missing `VITE_PLAY_SUBSCRIPTION_ID` (empty SKU → PaymentRequest throws)
 * look like a user cancel, so the UI stayed silent and the misconfiguration
 * was invisible. Only a genuine `AbortError` is a cancel now; everything
 * else surfaces. An unset/blank SKU is reported up front.
 */

const PLAY_BILLING_METHOD = 'https://play.google.com/billing';

/** The subscription productId; baked at build time. */
export const PLAY_SUBSCRIPTION_ID = (import.meta.env.VITE_PLAY_SUBSCRIPTION_ID ?? '').trim();

interface PlayItemDetails {
  itemId: string;
  title: string;
  description: string;
  price: { currency: string; value: string };
  type: 'product' | 'subscription';
}

interface PlayDigitalGoodsService {
  getDetails: (skus: string[]) => Promise<PlayItemDetails[]>;
}

interface DigitalGoodsWindow extends Window {
  getDigitalGoodsService?: (method: string) => Promise<PlayDigitalGoodsService>;
}

/** Synchronous signal that the Digital Goods API exists in this environment. */
export function playBillingSupported(): boolean {
  return typeof window !== 'undefined' && 'getDigitalGoodsService' in window;
}

/**
 * Pure: can a purchase actually start? The Digital Goods API must exist AND a
 * productId must be configured — an empty SKU would otherwise reach
 * `PaymentRequest` and fail as an opaque error (the 2026-09-11 incident).
 */
export function playBillingReady(supported: boolean, productId: string): boolean {
  return supported && productId.trim() !== '';
}

/**
 * Pure: classify a `PaymentRequest.show()` rejection. Chrome rejects with
 * `AbortError` when the user dismisses the Play sheet; every other name
 * (NotSupportedError, InvalidStateError, …) is a real failure that must be
 * visible rather than swallowed as a cancel.
 */
export function classifyPlayFailure(errorName: string): 'cancelled' | 'error' {
  return errorName === 'AbortError' ? 'cancelled' : 'error';
}

/** @param error unknown thrown value → its `name` when it looks like an Error. */
function errorNameOf(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  return '';
}

/** Outcome of a purchase attempt — never a bare `null` (see the header note). */
export type PlayPurchaseResult =
  | { status: 'ok'; purchaseToken: string; productId: string }
  | { status: 'unavailable' }
  | { status: 'cancelled' }
  | { status: 'error' };

let servicePromise: Promise<PlayDigitalGoodsService | null> | null = null;

/** Acquire the Play Billing Digital Goods service once per session. */
function getService(): Promise<PlayDigitalGoodsService | null> {
  if (!servicePromise) {
    servicePromise = (async () => {
      const w = window as DigitalGoodsWindow;
      if (typeof w.getDigitalGoodsService !== 'function') return null;
      try {
        return await w.getDigitalGoodsService(PLAY_BILLING_METHOD);
      } catch {
        return null;
      }
    })();
  }
  return servicePromise;
}

/**
 * Open the Play subscription flow via the Payment Request API and report the
 * purchase token + productId. The Play sheet shows the real price; the client
 * never acknowledges (the server does after verification).
 */
export async function purchasePlaySubscription(productId: string): Promise<PlayPurchaseResult> {
  const sku = productId.trim();
  if (sku === '') {
    // Loud on purpose: this is a build-configuration bug, not a user action.
    console.warn('play: VITE_PLAY_SUBSCRIPTION_ID is not set — Play Billing cannot start.');
    return { status: 'unavailable' };
  }
  const service = await getService();
  if (!service) return { status: 'unavailable' };
  let response: PaymentResponse;
  try {
    // The total is a placeholder: Play ignores it and shows its own price.
    const request = new PaymentRequest(
      [{ supportedMethods: PLAY_BILLING_METHOD, data: { sku } }],
      { total: { label: 'Smart entry', amount: { currency: 'USD', value: '0' } } },
    );
    response = await request.show();
  } catch (error) {
    return { status: classifyPlayFailure(errorNameOf(error)) };
  }
  const details = response.details as { purchaseToken?: unknown; productId?: unknown };
  const purchaseToken = typeof details.purchaseToken === 'string' ? details.purchaseToken : '';
  const purchasedProductId = typeof details.productId === 'string' ? details.productId : sku;
  // The payment already happened; closing the sheet must not lose the token.
  try {
    await response.complete('success');
  } catch {
    /* the sheet was already gone — the token below is what matters */
  }
  if (purchaseToken === '') return { status: 'error' };
  return { status: 'ok', purchaseToken, productId: purchasedProductId };
}
