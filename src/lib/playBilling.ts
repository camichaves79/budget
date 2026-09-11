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
 *
 * `OperationError: unsupported context` (2026-09-11 investigation, confirmed
 * against Chromium): `getDigitalGoodsService()` is refused by exactly three
 * conditions in `DigitalGoodsFactoryImpl#getResponseCode()` — the
 * `AppStoreBilling` feature being off (on-by-default on Android and not
 * user-reachable via chrome://flags), the displaying Activity not being a
 * `CustomTabActivity`, or `CustomTabActivity#isInTwaMode()` being false. That
 * last one is `mTwaCoordinator != null && shouldUseAppModeUi()`, where app mode
 * is denied ONLY while the page verifier reports `FAILURE`
 * (`SharedActivityCoordinator#appModeUiAllowedFor`) — a pending or absent
 * verification still allows app mode. So the error means "this is not a
 * verified TWA view", and the distinguishing UI symptom is a visible Custom Tab
 * toolbar (app mode off).
 *
 * The trap that cost a session: `canMakePayment()` is NOT a TWA signal. It
 * returns true even in an ordinary Chrome tab (measured on-device 2026-09-11),
 * so a dump reading `canPay=yes` next to `service=unavailable` is NOT a
 * contradiction — it says nothing about TWA mode. Never debug this from
 * `canPay`.
 *
 * Consequently a FAILED service acquisition is never cached
 * (`serviceAcquisitionDecision`): a transient refusal — the activity still
 * settling, Chrome momentarily unable to host the TWA — must not poison every
 * later probe and Subscribe tap for the rest of the session. `probePlay(true)`
 * forces a fresh attempt, which is what the Settings support-mode "Re-probe"
 * button uses.
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
  /** How many times the service was acquired this session, and when (last try). */
  serviceTry: number;
  serviceAt: string;
  canPay: string;
  details: string;
  lastFailure: string;
  /** Which `display-mode` media queries match — see `describeDisplayModes`. */
  displayModes: string;
  /** Viewport vs screen geometry — see `describeViewport`. */
  viewport: string;
  url: string;
  standalone: boolean;
  userAgent: string;
}

/**
 * Pure: should a previous service acquisition be reused, or should we ask
 * Chrome again? A cached SUCCESS is reused (the service object is stable for
 * the session); a cached FAILURE never is — Chrome refuses this view while the
 * activity is still settling, and a single refusal must not make every later
 * probe and Subscribe tap fail. `force` bypasses even a cached success, which
 * is what the support-mode re-probe uses.
 */
export function serviceAcquisitionDecision(cachedOk: boolean, force: boolean): 'reuse' | 'acquire' {
  return !force && cachedOk ? 'reuse' : 'acquire';
}

/**
 * Pure: name the matching `display-mode` media queries. In a TWA running in app
 * mode the web app manifest's `display: standalone` is in force; a Custom Tab
 * reports `browser`. Reported as a SET because Chrome can match more than one
 * (e.g. `standalone` together with `minimal-ui`), and because the single
 * boolean this dump used to carry could not tell those apart.
 */
export function describeDisplayModes(matches: string[]): string {
  return matches.length === 0 ? '(none)' : matches.join('+');
}

/**
 * Pure: describe the viewport/screen geometry, whose DELTA is the browser-UI
 * footprint (status bar + any Custom Tab toolbar). Approximate by nature —
 * `screen.height` is the display in CSS pixels and `visualViewport` may differ
 * when the keyboard is up — so it is reported as numbers, not a verdict.
 */
export function describeViewport(innerHeight: number, screenHeight: number): string {
  const chrome = Math.max(0, Math.round(screenHeight - innerHeight));
  return `inner ${Math.round(innerHeight)} / screen ${Math.round(screenHeight)} / chrome≈${chrome}px`;
}

/**
 * Pure: render a diagnostics snapshot as compact ASCII, one fact per line.
 * Untranslated on purpose — this is a support dump, not user-facing copy.
 */
export function formatPlayDiagnostics(d: PlayDiagnostics): string {
  const or = (value: string, fallback: string) => (value === '' ? fallback : value);
  const tries = d.serviceTry > 0 ? ` [try ${d.serviceTry}${d.serviceAt === '' ? '' : ` @ ${d.serviceAt}`}]` : '';
  return [
    `api=${d.apiPresent ? 'yes' : 'NO'}`,
    `sku=${or(d.sku, '(unset)')}`,
    `service=${or(d.service, '(not probed)')}${tries}`,
    `canPay=${or(d.canPay, '(not probed)')}`,
    `details=${or(d.details, '(not probed)')}`,
    `lastFail=${or(d.lastFailure, '(none)')}`,
    `display=${or(d.displayModes, '(unknown)')}`,
    `viewport=${or(d.viewport, '(unknown)')}`,
    `url=${or(d.url, '(unknown)')}`,
    `standalone=${d.standalone ? 'yes' : 'no'}`,
    `ua=${d.userAgent}`,
  ].join('\n');
}

/** The acquired service; kept for the session because a success is stable. */
let cachedService: PlayDigitalGoodsService | null = null;
/** The acquisition in flight, so concurrent callers share one attempt. */
let servicePromise: Promise<PlayDigitalGoodsService | null> | null = null;
/** Why the last acquisition came back empty ('' when it succeeded). */
let serviceError = '';
/** How many acquisitions were attempted, and when the last one ran. */
let serviceTries = 0;
let serviceAt = '';
/** Why the last purchase attempt failed ('' when none has failed). */
let lastFailure = '';

/** @returns the recorded reason the last purchase attempt failed. */
export function lastPlayFailure(): string {
  return lastFailure;
}

/** Local wall clock as HH:MM:SS — a support dump needs ordering, not dates. */
function clockLabel(): string {
  try {
    return new Date().toTimeString().slice(0, 8);
  } catch {
    return '';
  }
}

/** One acquisition attempt: ask Chrome for the Digital Goods service. */
async function acquireService(): Promise<PlayDigitalGoodsService | null> {
  serviceTries += 1;
  serviceAt = clockLabel();
  const w = window as DigitalGoodsWindow;
  if (typeof w.getDigitalGoodsService !== 'function') {
    // Not a billing-capable TWA (plain browser tab, WebAPK, WebView).
    serviceError = 'api missing';
    return null;
  }
  try {
    const service = await w.getDigitalGoodsService(PLAY_BILLING_METHOD);
    cachedService = service;
    serviceError = '';
    return service;
  } catch (error) {
    // Chrome knows the API but refuses this view/billing method.
    serviceError = describeError(error);
    return null;
  }
}

/**
 * Acquire the Play Billing Digital Goods service. A success is reused for the
 * session; a failure is NOT cached, so the next probe or purchase retries (see
 * `serviceAcquisitionDecision`). `force` re-acquires even after a success.
 */
function getService(force = false): Promise<PlayDigitalGoodsService | null> {
  if (serviceAcquisitionDecision(cachedService !== null, force) === 'reuse' && cachedService) {
    return Promise.resolve(cachedService);
  }
  if (servicePromise) return servicePromise;
  const attempt = acquireService();
  servicePromise = attempt;
  void attempt.then((service) => {
    // Forget a failed attempt so the next caller really does try again.
    if (!service && servicePromise === attempt) servicePromise = null;
  });
  return attempt;
}

function currentUserAgent(): string {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent;
}

/** The display-mode queries worth naming — a Custom Tab reports `browser`. */
const DISPLAY_MODES = ['standalone', 'minimal-ui', 'fullscreen', 'browser'];

/** Which `display-mode` queries match right now ([] when unprobeable). */
function matchedDisplayModes(): string[] {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return [];
  const matched: string[] = [];
  for (const mode of DISPLAY_MODES) {
    try {
      if (window.matchMedia(`(display-mode: ${mode})`).matches) matched.push(mode);
    } catch {
      /* an unsupported query is simply not a match */
    }
  }
  return matched;
}

/** Viewport vs screen geometry ('' when the numbers are unavailable). */
function currentViewport(): string {
  if (typeof window === 'undefined') return '';
  const inner = typeof window.innerHeight === 'number' ? window.innerHeight : 0;
  const screen = window.screen as Screen | undefined;
  const screenHeight = screen && typeof screen.height === 'number' ? screen.height : 0;
  if (inner <= 0 || screenHeight <= 0) return '';
  return describeViewport(inner, screenHeight);
}

/**
 * The current page URL, for the verified-origin check. Purchase-reference
 * params are stripped at boot (`takePurchaseParam`), so this carries no secret.
 */
function currentUrl(): string {
  if (typeof window === 'undefined' || !window.location) return '';
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}`;
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
 * Note that `canPay=yes` does NOT imply TWA mode (see the module header).
 *
 * `force` re-acquires the service instead of reusing a cached success, which is
 * what the support-mode re-probe uses to test whether a refusal persists.
 */
export async function probePlay(force = false): Promise<PlayDiagnostics> {
  const apiPresent = playBillingSupported();
  const service = await getService(force);
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
  const modes = matchedDisplayModes();
  return {
    apiPresent,
    sku: PLAY_SUBSCRIPTION_ID,
    service: service ? 'ok' : `unavailable (${serviceError || 'not attempted'})`,
    serviceTry: serviceTries,
    serviceAt,
    canPay,
    details,
    lastFailure,
    displayModes: describeDisplayModes(modes),
    viewport: currentViewport(),
    url: currentUrl(),
    standalone: modes.includes('standalone'),
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
