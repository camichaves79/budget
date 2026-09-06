import { useState } from 'react';
import { useEntitlement } from '../state/entitlement';

/**
 * The card smart entry shows when the free allowance (10 parses/day) is used
 * up and no active license is stored. Purchases are ALWAYS account-bound
 * (product decision 2026-09), so the primary action first requires Google
 * sign-in and then opens the Lemon Squeezy checkout (overlay in-app,
 * tab/redirect fallback). Manual entry stays one tap away and always works.
 */
export function PaywallCard({ onClose, onManual }: { onClose: () => void; onManual: () => void }) {
  const { account, buy, busy, checkoutReady, completePendingPurchase, freeDaily, pendingOrder, signIn } = useEntitlement();
  const [opening, setOpening] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
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
      if (outcome === 'none') setError("That purchase couldn't be completed. Contact the app owner if the payment went through.");
      else if (outcome === 'error') setError("Couldn't reach the licensing service. Check your connection and try again.");
      return;
    }
    setOpening(true);
    const mode = await buy();
    setOpening(false);
    if (mode === 'unavailable') {
      setError('The checkout link is not set up for this build yet. Contact the app owner.');
    }
  };

  const label = !account
    ? signingIn
      ? 'Signing in…'
      : 'Sign in with Google to unlock'
    : busy === 'redeeming'
      ? 'Completing purchase…'
      : opening
        ? 'Opening checkout…'
        : pendingOrder
          ? 'Complete your purchase'
          : 'Unlock unlimited smart entry · $5/year';

  return (
    <div className="paywall-card">
      <p className="paywall-title">You've used today's free smart entries</p>
      <p className="field-hint">
        Smart entry is free for {freeDaily} parses a day. Get unlimited smart entry for a full year — $5 USD.
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
          Sign in with Google first — your license gets saved to your account and restored on any device or reinstall.
        </p>
      )}
      {error && <p className="error-text">{error}</p>}
      <button type="button" className="btn btn-block" onClick={onManual}>
        Enter manually instead
      </button>
      <button type="button" className="btn btn-block" onClick={onClose}>
        Close
      </button>
      <p className="field-hint smart-disclosure">
        Free entries reset at midnight. Manual entry always works, with or without a license.
      </p>
    </div>
  );
}
