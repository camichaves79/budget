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

export type PlayPurchase = { purchaseToken: string; productId: string } | null;

/**
 * Open the Play subscription flow via the Payment Request API and return the
 * purchase token + productId. Returns null when the user cancels or the
 * Digital Goods API is unavailable. The Play sheet shows the real price; the
 * client never acknowledges (the server does after verification).
 */
export async function purchasePlaySubscription(productId: string): Promise<PlayPurchase> {
  const service = await getService();
  if (!service) return null;
  try {
    // The total is a placeholder: Play ignores it and shows its own price.
    const request = new PaymentRequest(
      [{ supportedMethods: PLAY_BILLING_METHOD, data: { sku: productId } }],
      { total: { label: 'Smart entry', amount: { currency: 'USD', value: '0' } } },
    );
    const response = await request.show();
    const details = response.details as { purchaseToken?: unknown; productId?: unknown };
    const purchaseToken = typeof details.purchaseToken === 'string' ? details.purchaseToken : '';
    const purchasedProductId = typeof details.productId === 'string' ? details.productId : productId;
    await response.complete('success');
    if (!purchaseToken) return null;
    return { purchaseToken, productId: purchasedProductId };
  } catch {
    return null; // user cancelled, or the API is unavailable in this view
  }
}
