/**
 * EntitlementProvider — client-side license/auth state.
 *
 * Owns: the stored license token (localStorage), the free daily quota
 * counter, the signed-in account, the pending post-purchase reference, and
 * the one-shot events the UI turns into toasts ("License active ✓").
 *
 * Boot sequence (StrictMode-safe: query params are stripped synchronously
 * before any await; the Firebase redirect result is consumed through a
 * module-level memoized promise; effects that subscribe re-subscribe on the
 * double mount):
 *   1. strip + park a purchase reference from the URL (?key= / ?order_id=)
 *   2. collect any Google sign-in redirect result
 *   3. redeem a pending purchase (server is idempotent)
 *   4. on sign-in, auto-restore the license bound to the account
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { todayISO } from '../lib/dates';
import {
  clearLicenseToken,
  formatLicenseExpiry,
  licenseIsActive,
  loadLicenseToken,
  parseLicenseToken,
  saveLicenseToken,
} from '../lib/license';
import type { LicensePayload } from '../lib/license';
import { FREE_DAILY_PARSES, loadQuota, nextQuota, remainingFreeToday, saveQuota } from '../lib/quota';
import { checkLicenseKey, lookupLicense, redeemLicense } from '../lib/licenseService';
import { useI18n } from '../lib/i18n';
import {
  authConfigured as authEnvConfigured,
  getUserIdToken,
  handleAuthRedirect,
  signInWithGoogle,
  signOutUser,
  watchAuthUser,
} from '../lib/auth';
import type { AuthUser } from '../lib/auth';
import { checkoutConfigured, openCheckout } from '../lib/checkout';
import { detectPlayBuild } from '../lib/playBuild';

const PENDING_ORDER_KEY = 'budget.pendingOrder.v1';

export interface EntitlementEvent {
  kind: 'licensed' | 'license-lost';
  at: number;
}

export interface EntitlementValue {
  /** Raw signed token, null when unlicensed. */
  licenseToken: string | null;
  /** Parsed payload (client view — the server verifies the signature). */
  license: LicensePayload | null;
  licensedActive: boolean;
  licenseExpiryLabel: string | null;
  /** Free allowance left today. */
  remaining: number;
  freeDaily: number;
  account: AuthUser | null;
  authConfigured: boolean;
  checkoutReady: boolean;
  pendingOrder: string | null;
  busy: 'redeeming' | null;
  lastEvent: EntitlementEvent | null;
  /** Specific failure message from the last redeem/check attempt (e.g. the
   * email-mismatch guidance) — null after a success or a new attempt. */
  redeemError: string | null;
  /** Count one parse attempt against the free allowance. */
  recordParseUse: () => void;
  activateLicenseToken: (token: string) => void;
  /** Clear a license the server has rejected. */
  dropLicense: () => void;
  signIn: () => Promise<'popup' | 'redirect' | 'cancelled' | 'failed'>;
  signOut: () => Promise<void>;
  restoreLicense: () => Promise<'ok' | 'none' | 'error'>;
  activatePastedKey: (key: string) => Promise<'ok' | 'invalid' | 'error'>;
  completePendingPurchase: () => Promise<'ok' | 'none' | 'error'>;
  buy: () => Promise<'overlay' | 'tab' | 'unavailable'>;
  /** True inside the Play Store build (TWA): purchases stay web-only, so
   * purchase UI is hidden while sign-in + license restore keep working. */
  playBuild: boolean;
}

const EntitlementContext = createContext<EntitlementValue | null>(null);

function pendingOrderStored(): string | null {
  try {
    const v = localStorage.getItem(PENDING_ORDER_KEY);
    return v && v.trim() !== '' ? v.trim() : null;
  } catch {
    return null;
  }
}

function setPendingOrderStored(value: string | null): void {
  try {
    if (value) localStorage.setItem(PENDING_ORDER_KEY, value);
    else localStorage.removeItem(PENDING_ORDER_KEY);
  } catch {
    // Best-effort; a lost pending reference is recoverable via sign-in.
  }
}

/**
 * Read and REMOVE a purchase reference from the URL, synchronously, before
 * any async work (React StrictMode runs effects twice; the second pass must
 * find nothing). Accepts the Lemon Squeezy link-variable params we configure
 * in the checkout's confirmation button (skills/paywall-ops.md).
 */
function takePurchaseParam(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const keys = ['key', 'license_key', 'order_id', 'order_identifier'];
    let found: string | null = null;
    for (const k of keys) {
      const v = params.get(k);
      if (v && v.trim() !== '') {
        found = v.trim();
        break;
      }
    }
    if (!found) return null;
    for (const k of keys) params.delete(k);
    const rest = params.toString();
    const nextUrl = window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash;
    window.history.replaceState(null, '', nextUrl);
    return found;
  } catch {
    return null;
  }
}

export function EntitlementProvider({ children }: { children: ReactNode }) {
  const [licenseToken, setLicenseTokenState] = useState<string | null>(() => loadLicenseToken());
  const [license, setLicense] = useState<LicensePayload | null>(() => {
    const token = loadLicenseToken();
    return token ? parseLicenseToken(token) : null;
  });
  const [remaining, setRemaining] = useState<number>(() => {
    const today = todayISO();
    const quota = loadQuota(today);
    return remainingFreeToday(quota.date, quota.used, today);
  });
  const [account, setAccount] = useState<AuthUser | null>(null);
  // The purchase reference is read AND the URL param stripped synchronously in
  // the lazy initializer (StrictMode-safe: the second pass finds nothing and
  // returns the same stored value), so the boot effect needs no setState.
  const [pendingOrder, setPendingOrder] = useState<string | null>(() => {
    const param = takePurchaseParam();
    if (param) setPendingOrderStored(param);
    return param ?? pendingOrderStored();
  });
  const [busy, setBusy] = useState<'redeeming' | null>(null);
  const [lastEvent, setLastEvent] = useState<EntitlementEvent | null>(null);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  // Play-build detection: synchronous + idempotent in the lazy initializer
  // (StrictMode-safe), so the flag is set before any child renders purchase UI.
  const [playBuild] = useState<boolean>(() => detectPlayBuild());

  const licensedActive = licenseIsActive(license);
  const { intl } = useI18n();
  const licenseExpiryLabel = license ? formatLicenseExpiry(license.exp, intl) : null;

  const applyToken = useCallback((token: string, event: EntitlementEvent['kind'] | null) => {
    saveLicenseToken(token);
    setLicenseTokenState(token);
    setLicense(parseLicenseToken(token));
    if (event) setLastEvent({ kind: event, at: Date.now() });
  }, []);

  const recordParseUse = useCallback(() => {
    const today = todayISO();
    setRemaining(() => {
      const quota = loadQuota(today);
      const next = nextQuota(quota.date, quota.used, today);
      saveQuota(next);
      return remainingFreeToday(next.date, next.used, today);
    });
  }, []);

  const dropLicense = useCallback(() => {
    clearLicenseToken();
    setLicenseTokenState(null);
    setLicense(null);
    setLastEvent({ kind: 'license-lost', at: Date.now() });
  }, []);

  /** Redeem a purchase reference; keeps it pending when the network fails. */
  const redeemAndApply = useCallback(
    async (reference: string): Promise<'ok' | 'none' | 'error'> => {
      setBusy('redeeming');
      setRedeemError(null);
      // Purchases are always account-bound: the server requires the idToken,
      // so an unsigned redeem is a guaranteed 401. The UI gates on sign-in
      // too — this is the defensive layer (keeps the reference parked).
      const idToken = await getUserIdToken();
      if (!idToken) {
        setBusy(null);
        return 'error';
      }
      const result = await redeemLicense(reference, idToken);
      setBusy(null);
      if (result.ok) {
        setPendingOrderStored(null);
        setPendingOrder(null);
        applyToken(result.license, 'licensed');
        return 'ok';
      }
      if (result.code === 'purchase-not-paid' || result.code === 'purchase-not-found' || result.code === 'purchase-refunded') {
        // The reference will never become payable — stop retrying it.
        setPendingOrderStored(null);
        setPendingOrder(null);
        return 'none';
      }
      // email-mismatch keeps the reference parked: signing in with the
      // buyer's account and retrying is the recovery path.
      setRedeemError(
        result.code === 'email-mismatch' || result.code === 'internal' || result.code === 'rate-limited'
          ? result.message
          : null,
      );
      return 'error';
    },
    [applyToken],
  );

  useEffect(() => {
    let cancelled = false;

    // 1. Google sign-in redirect result, then the pending purchase. (The
    // purchase reference itself was parked by the lazy initializer above.)
    void (async () => {
      await handleAuthRedirect();
      if (cancelled) return;
      const reference = pendingOrderStored();
      if (reference) await redeemAndApply(reference);
    })();

    // 3. Account watcher + automatic restore on sign-in.
    const unsubscribe = watchAuthUser((user) => {
      setAccount(user);
      if (!user) return;
      const local = parseLicenseToken(loadLicenseToken() ?? '');
      if (!licenseIsActive(local)) {
        void (async () => {
          const idToken = await getUserIdToken();
          if (!idToken) return;
          const result = await lookupLicense(idToken);
          if (result.ok && result.license) applyToken(result.license, 'licensed');
        })();
      }
    });

    // 4. Refresh the allowance + expiry when the app regains focus
    //    (midnight rollover, license expiring while open).
    const onFocus = () => {
      const today = todayISO();
      const quota = loadQuota(today);
      setRemaining(remainingFreeToday(quota.date, quota.used, today));
    };
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener('focus', onFocus);
    };
  }, [applyToken, redeemAndApply]);

  const signIn = useCallback(() => signInWithGoogle(), []);
  const signOut = useCallback(async () => {
    await signOutUser();
    // The watcher clears `account`; the local license stays (bearer, offline).
  }, []);

  const restoreLicense = useCallback(async (): Promise<'ok' | 'none' | 'error'> => {
    const idToken = await getUserIdToken();
    if (!idToken) return 'error';
    const result = await lookupLicense(idToken);
    if (!result.ok) return 'error';
    if (result.license) {
      applyToken(result.license, 'licensed');
      return 'ok';
    }
    return 'none';
  }, [applyToken]);

  const activatePastedKey = useCallback(
    async (key: string): Promise<'ok' | 'invalid' | 'error'> => {
      const trimmed = key.trim();
      setRedeemError(null);
      const idToken = await getUserIdToken();
      const result = await checkLicenseKey(trimmed, idToken ?? undefined);
      if (!result.ok) {
        setRedeemError(result.message);
        return 'error';
      }
      if (!result.active) return 'invalid';
      applyToken(trimmed, 'licensed');
      return 'ok';
    },
    [applyToken],
  );

  const completePendingPurchase = useCallback(async (): Promise<'ok' | 'none' | 'error'> => {
    const reference = pendingOrderStored();
    if (!reference) return 'none';
    return redeemAndApply(reference);
  }, [redeemAndApply]);

  const buy = useCallback(() => openCheckout(), []);

  const value = useMemo<EntitlementValue>(
    () => ({
      licenseToken,
      license,
      licensedActive,
      licenseExpiryLabel,
      remaining,
      freeDaily: FREE_DAILY_PARSES,
      account,
      authConfigured: authEnvConfigured(),
      checkoutReady: checkoutConfigured(),
      pendingOrder,
      busy,
      lastEvent,
      redeemError,
      recordParseUse,
      activateLicenseToken: (token: string) => applyToken(token, null),
      dropLicense,
      signIn,
      signOut,
      restoreLicense,
      activatePastedKey,
      completePendingPurchase,
      buy,
      playBuild,
    }),
    [
      licenseToken,
      license,
      licensedActive,
      licenseExpiryLabel,
      remaining,
      account,
      pendingOrder,
      busy,
      lastEvent,
      redeemError,
      recordParseUse,
      applyToken,
      dropLicense,
      signIn,
      signOut,
      restoreLicense,
      activatePastedKey,
      completePendingPurchase,
      buy,
      playBuild,
    ],
  );

  return <EntitlementContext.Provider value={value}>{children}</EntitlementContext.Provider>;
}

export function useEntitlement(): EntitlementValue {
  const ctx = useContext(EntitlementContext);
  if (!ctx) throw new Error('useEntitlement must be used within EntitlementProvider');
  return ctx;
}
