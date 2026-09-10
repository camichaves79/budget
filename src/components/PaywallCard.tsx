import { useState } from 'react';
import { t } from '../lib/i18n';
import { useEntitlement } from '../state/entitlement';

/**
 * The card smart entry shows when the free allowance (10 parses/day) is used
 * up and no active license is stored. Purchases are ALWAYS account-bound
 * (product decision 2026-09), so the primary action first requires Google
 * sign-in and then opens the Lemon Squeezy checkout (overlay in-app,
 * tab/redirect fallback). Manual entry stays one tap away and always works.
 */
export function PaywallCard({ onClose, onManual }: { onClose: () => void; onManual: () => void }) {
  const {
    account,
    buy,
    buyPlay,
    busy,
    checkoutReady,
    completePendingPurchase,
    freeDaily,
    pendingOrder,
    playBuild,
    redeemError,
    signIn,
  } = useEntitlement();
  const [opening, setOpening] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [error, setError] = useState('');

  const unlock = async () => {
    if (opening || busy || signingIn) return;
    setError('');
    // Step 1: identity. The watcher updates `account` after the popup/redirect,
    // which flips this button into its checkout label.
    if (!account) {
      setSigningIn(true);
      await signIn();
      setSigningIn(false);
      return;
    }
    // A parked purchase reference means the user already paid: complete it
    // instead of charging again.
    if (pendingOrder) {
      const outcome = await completePendingPurchase();
      if (outcome === 'none') setError(t('paywall.purchaseFailed'));
      else if (outcome === 'error') setError(t('paywall.unreachable'));
      return;
    }
    setOpening(true);
    const mode = await buy();
    setOpening(false);
    if (mode === 'unavailable') {
      setError(t('paywall.checkoutMissing'));
    }
  };

  const label = !account
    ? signingIn
      ? t('paywall.signingIn')
      : t('paywall.signInToUnlock')
    : busy === 'redeeming'
      ? t('paywall.completing')
      : opening
        ? t('paywall.opening')
        : pendingOrder
          ? t('paywall.completePurchase')
          : t('paywall.unlock');

  // Play Store build: purchases go through Google Play Billing (the Digital
  // Goods API), never the Lemon Squeezy checkout. Same sign-in-first rule.
  const subscribe = async () => {
    if (subscribing || signingIn || busy) return;
    setError('');
    if (!account) {
      setSigningIn(true);
      await signIn();
      setSigningIn(false);
      return;
    }
    setSubscribing(true);
    const outcome = await buyPlay();
    setSubscribing(false);
    if (outcome === 'unavailable') setError(t('paywall.playUnavailable'));
    else if (outcome === 'error') setError(redeemError ?? t('paywall.unreachable'));
    // 'ok' → the license applied and "License active ✓" fired; 'cancelled' → silent.
  };

  if (playBuild) {
    return (
      <div className="paywall-card">
        <p className="paywall-title">{t('paywall.title')}</p>
        <p className="field-hint">{t('paywall.body', { n: freeDaily })}</p>
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={subscribe}
          disabled={subscribing || signingIn || busy === 'redeeming'}
        >
          {subscribing
            ? t('paywall.playOpening')
            : !account
              ? signingIn
                ? t('paywall.signingIn')
                : t('paywall.signInToUnlock')
              : t('paywall.playSubscribe')}
        </button>
        {!account && (
          <p className="field-hint smart-disclosure">{t('paywall.signInHint')}</p>
        )}
        {error && <p className="error-text">{error}</p>}
        <button type="button" className="btn btn-block" onClick={onManual}>
          {t('smart.manualInstead')}
        </button>
        <button type="button" className="btn btn-block" onClick={onClose}>
          {t('close')}
        </button>
        <p className="field-hint smart-disclosure">{t('paywall.resetMidnight')}</p>
      </div>
    );
  }

  return (
    <div className="paywall-card">
      <p className="paywall-title">{t('paywall.title')}</p>
      <p className="field-hint">
        {t('paywall.body', { n: freeDaily })}
      </p>
      <button
        type="button"
        className="btn btn-primary btn-block"
        onClick={unlock}
        disabled={!checkoutReady || opening || signingIn || busy === 'redeeming'}
      >
        {label}
      </button>
      {!account && (
        <p className="field-hint smart-disclosure">
          {t('paywall.signInHint')}
        </p>
      )}
      {error && <p className="error-text">{error}</p>}
      <button type="button" className="btn btn-block" onClick={onManual}>
        {t('smart.manualInstead')}
      </button>
      <button type="button" className="btn btn-block" onClick={onClose}>
        {t('close')}
      </button>
      <p className="field-hint smart-disclosure">
        {t('paywall.resetMidnight')}
      </p>
    </div>
  );
}
