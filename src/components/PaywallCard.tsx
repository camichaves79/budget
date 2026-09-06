import { useState } from 'react';
import { useEntitlement } from '../state/entitlement';

/**
 * The card smart entry shows when the free allowance (10 parses/day) is used
 * up and no active license is stored. Primary action: the Lemon Squeezy
 * checkout (overlay in-app, tab/redirect fallback). Manual entry stays one
 * tap away and always works.
 */
export function PaywallCard({ onClose, onManual }: { onClose: () => void; onManual: () => void }) {
  const { buy, busy, checkoutReady, completePendingPurchase, freeDaily, pendingOrder } = useEntitlement();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');

  const unlock = async () => {
    if (opening || busy) return;
    setError('');
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
        disabled={!checkoutReady || opening || busy === 'redeeming'}
      >
        {busy === 'redeeming' ? 'Completing purchase…' : opening ? 'Opening checkout…' : 'Unlock unlimited smart entry · $5/year'}
      </button>
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
