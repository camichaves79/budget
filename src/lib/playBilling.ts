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
 *
 * Diagnostics (2026-09-12): one failure mode is still structurally invisible —
 * when Chrome cannot reach a payment app it rejects `show()` with `AbortError`,
 * the SAME error a user dismiss produces, so "the sheet never opened" and "the
 * user closed the sheet" cannot be told apart from the return value alone.
 * `probePlay()` answers the questions the UI cannot: is the Digital Goods API
 * even present in this view, does the configured SKU resolve through Play
 * (`getDetails`), and does Chrome know a payment app for the billing method
 * (`canMakePayment`). It never charges and never opens a sheet, so it is safe
 * to run on render. `formatPlayDiagnostics` renders the snapshot as ASCII for
 * the Settings panel — deliberately untranslated, it is a support dump.
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

/** @param error unknown thrown value → `Name: message` for the diagnostics dump. */
function describeError(error: unknown): string {
  const name = errorNameOf(error) || 'Error';
  let message = '';
  if (typeof error === 'object' && error !== null) {
    const text = (error as { message?: unknown }).message;
    if (typeof text === 'string') message = text;
  }
  return message === '' ? name : `${name}: ${message}`;
}

/** Outcome of a purchase attempt — never a bare `null` (see the header note). */
export type PlayPurchaseResult =
  | { status: 'ok'; purchaseToken: string; productId: string }
  | { status: 'unavailable' }
  | { status: 'cancelled' }
  | { status: 'error' };

/** A diagnostics snapshot; every field is text so it can be dumped verbatim. */
export interface PlayDiagnostics {
  apiPresent: boolean;
  sku: string;
  service: string;
  canPay: string;
  details: string;
  lastFailure: string;
  standalone: boolean;
  userAgent: string;
}

/**
 * Pure: render a diagnostics snapshot as compact ASCII, one fact per line.
 * Untranslated on purpose — this is a support dump, not user-facing copy.
 */
export function formatPlayDiagnostics(d: PlayDiagnostics): string {
  const or = (value: string, fallback: string) => (value === '' ? fallback : value);
  return [
    `api=${d.apiPresent ? 'yes' : 'NO'}`,
    `sku=${or(d.sku, '(unset)')}`,
    `service=${or(d.service, '(not probed)')}`,
    `canPay=${or(d.canPay, '(not probed)')}`,
    `details=${or(d.details, '(not probed)')}`,
    `lastFail=${or(d.lastFailure, '(none)')}`,
    `standalone=${d.standalone ? 'yes' : 'no'}`,
    `ua=${d.userAgent}`,
  ].join('\n');
}

let servicePromise: Promise<PlayDigitalGoodsService | null> | null = null;
/** Why `getService()` came back empty ('' when it succeeded or was not tried). */
let serviceError = '';
/** Why the last purchase attempt failed ('' when none has failed). */
let lastFailure = '';

/** @returns the recorded reason the last purchase attempt failed. */
export function lastPlayFailure(): string {
  return lastFailure;
}

/** Acquire the Play Billing Digital Goods service once per session. */
function getService(): Promise<PlayDigitalGoodsService | null> {
  if (!servicePromise) {
    servicePromise = (async () => {
      const w = window as DigitalGoodsWindow;
      if (typeof w.getDigitalGoodsService !== 'function') {
        // Not a billing-capable TWA (plain browser tab, WebAPK, WebView).
        serviceError = 'api missing';
        return null;
      }
      try {
        return await w.getDigitalGoodsService(PLAY_BILLING_METHOD);
      } catch (error) {
        // Chrome knows the API but refuses this view/billing method.
        serviceError = describeError(error);
        return null;
      }
    })();
  }
  return servicePromise;
}

function currentUserAgent(): string {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent;
}

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

/** Does Chrome believe a payment app handles the Play billing method? */
async function probeCanMakePayment(sku: string): Promise<string> {
  try {
    // Same method data as a real purchase: the TWA billing app reads the SKU.
    const request = new PaymentRequest(
      [{ supportedMethods: PLAY_BILLING_METHOD, data: { sku } }],
      { total: { label: 'probe', amount: { currency: 'USD', value: '0' } } },
    );
    return (await request.canMakePayment()) ? 'yes' : 'NO';
  } catch (error) {
    return `err (${describeError(error)})`;
  }
}

/**
 * Inspect the Play billing surface WITHOUT charging or opening a sheet:
 * API presence, service acquisition, SKU resolution through Play, and whether
 * Chrome has a payment app for the billing method.
 *
 * `canMakePayment` is probed even when the Digital Goods service fails, because
 * the two failures are different faults with different fixes: "no payment app"
 * means the INSTALLED APK does not advertise the TWA billing services
 * (`PaymentService` / `IS_READY_TO_PAY`) — a stale or billing-less bundle —
 * while a service-level rejection means Chrome refused this context outright.
 */
export async function probePlay(): Promise<PlayDiagnostics> {
  const apiPresent = playBillingSupported();
  const service = await getService();
  const canPay = await probeCanMakePayment(PLAY_SUBSCRIPTION_ID);
  let details = '';
  if (service && PLAY_SUBSCRIPTION_ID !== '') {
    try {
      const items = await service.getDetails([PLAY_SUBSCRIPTION_ID]);
      details =
        items.length === 0
          ? 'empty (Play returned no item)'
          : items
              .map((i) => `${i.itemId} "${i.title}" ${i.price.value} ${i.price.currency} ${i.type}`)
              .join(' | ');
    } catch (error) {
      details = `err (${describeError(error)})`;
    }
  }
  return {
    apiPresent,
    sku: PLAY_SUBSCRIPTION_ID,
    service: service ? 'ok' : `unavailable (${serviceError || 'not attempted'})`,
    canPay,
    details,
    lastFailure,
    standalone: isStandaloneDisplay(),
    userAgent: currentUserAgent(),
  };
}

/**
 * Open the Play subscription flow via the Payment Request API and report the
 * purchase token + productId. The Play sheet shows the real price; the client
 * never acknowledges (the server does after verification).
 */
export async function purchasePlaySubscription(productId: string): Promise<PlayPurchaseResult> {
  lastFailure = '';
  const sku = productId.trim();
  if (sku === '') {
    // Loud on purpose: this is a build-configuration bug, not a user action.
    lastFailure = 'no SKU configured';
    console.warn('play: VITE_PLAY_SUBSCRIPTION_ID is not set — Play Billing cannot start.');
    return { status: 'unavailable' };
  }
  const service = await getService();
  if (!service) {
    lastFailure = `no service (${serviceError || 'not attempted'})`;
    return { status: 'unavailable' };
  }
  let response: PaymentResponse;
  try {
    // The total is a placeholder: Play ignores it and shows its own price.
    const request = new PaymentRequest(
      [{ supportedMethods: PLAY_BILLING_METHOD, data: { sku } }],
      { total: { label: 'Smart entry', amount: { currency: 'USD', value: '0' } } },
    );
    response = await request.show();
  } catch (error) {
    const status = classifyPlayFailure(errorNameOf(error));
    // Even an AbortError is recorded: it may mean the sheet never opened.
    lastFailure = `${status === 'cancelled' ? 'show aborted' : 'show failed'} (${describeError(error)})`;
    return { status };
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
  if (purchaseToken === '') {
    lastFailure = 'sheet completed without a purchase token';
    return { status: 'error' };
  }
  return { status: 'ok', purchaseToken, productId: purchasedProductId };
}
