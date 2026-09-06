import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useEntitlement } from '../state/entitlement';

/**
 * Settings → "Smart entry" section: plan status, sign-in account, pending
 * purchase completion, and the paste-key fallback (recovery ONLY — the main
 * path is the automatic redirect redeem; ARCHITECTURE.md A12).
 */
export function LicenseSection() {
  const {
    account,
    activatePastedKey,
    authConfigured,
    buy,
    checkoutReady,
    completePendingPurchase,
    freeDaily,
    lastEvent,
    licenseExpiryLabel,
    licensedActive,
    pendingOrder,
    remaining,
    restoreLicense,
    signIn,
    signOut,
  } = useEntitlement();

  const [keyInput, setKeyInput] = useState('');
  const [note, setNote] = useState<{ text: string; kind: 'error' | 'success' } | null>(null);
  const [busy, setBusy] = useState(false);

  // The one-shot license events ("License active ✓") normally surface as the
  // dashboard toast, but a purchase completed HERE fires while the dashboard
  // is unmounted — so the Settings section shows the event once too.
  const shownEventRef = useRef<number | null>(null);
  useEffect(() => {
    if (!lastEvent || shownEventRef.current === lastEvent.at) return;
    shownEventRef.current = lastEvent.at;
    setNote(
      lastEvent.kind === 'licensed'
        ? { text: 'License active ✓ — smart entry is now unlimited.', kind: 'success' }
        : { text: 'Your license is no longer valid — smart entry is back to the free plan.', kind: 'error' },
    );
  }, [lastEvent]);

  const unlock = async () => {
    setNote(null);
    // Purchases are always account-bound: identity first, then checkout.
    if (!account) {
      await signIn();
      return;
    }
    if (pendingOrder) {
      setBusy(true);
      const outcome = await completePendingPurchase();
      setBusy(false);
      if (outcome === 'none')
        setNote({ text: "That purchase couldn't be completed. Contact the app owner if the payment went through.", kind: 'error' });
      else if (outcome === 'error')
        setNote({ text: "Couldn't reach the licensing service. Check your connection and try again.", kind: 'error' });
      return;
    }
    await buy();
  };

  const doSignIn = async () => {
    setNote(null);
    await signIn();
  };

  const doRestore = async () => {
    setNote(null);
    setBusy(true);
    const outcome = await restoreLicense();
    setBusy(false);
    if (outcome === 'none')
      setNote({ text: 'No license found for this account. Buy one from the smart-entry screen.', kind: 'error' });
    else if (outcome === 'error')
      setNote({ text: 'Sign-in could not be verified. Try signing out and back in.', kind: 'error' });
  };

  const activateKey = async (e: FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim()) return;
    setNote(null);
    // The pasted LS key can only be redeemed for the signed-in account.
    if (!account) {
      setNote({ text: 'Sign in with Google first — licenses are tied to your account.', kind: 'error' });
      await signIn();
      return;
    }
    setBusy(true);
    const outcome = await activatePastedKey(keyInput);
    setBusy(false);
    if (outcome === 'ok') setKeyInput('');
    else if (outcome === 'invalid') setNote({ text: 'That key is not valid. Check it and try again.', kind: 'error' });
    else setNote({ text: "Couldn't reach the licensing service. Check your connection and try again.", kind: 'error' });
  };

  return (
    <>
      <h2 className="settings-h">Smart entry</h2>
      <div className="card">
        <div className="setting-row">
          <div>
            <div className="setting-name">{licensedActive ? 'Unlimited license' : 'Free plan'}</div>
            <div className="setting-desc">
              {licensedActive
                ? `Unlimited smart entry until ${licenseExpiryLabel ?? '…'}.`
                : `${remaining} of ${freeDaily} free smart entries left today.`}
            </div>
          </div>
          {licensedActive ? (
            <span className="license-pill">Active</span>
          ) : (
            <button type="button" className="btn" onClick={unlock} disabled={!checkoutReady || busy}>
              {busy ? 'Working…' : account ? 'Unlock · $5/year' : 'Sign in to unlock'}
            </button>
          )}
        </div>

        {pendingOrder && !licensedActive && (
          <div className="setting-row">
            <div>
              <div className="setting-name">Purchase waiting</div>
              <div className="setting-desc">Your payment reference is parked on this device.</div>
            </div>
            <button type="button" className="btn" onClick={unlock} disabled={busy}>
              {account ? 'Complete purchase' : 'Sign in to complete'}
            </button>
          </div>
        )}

        <div className="setting-row">
          <div>
            <div className="setting-name">Account</div>
            <div className="setting-desc">
              {account
                ? `${account.email ?? 'Signed in'} — your license is saved to your account.`
                : 'Sign in with Google to keep your license across devices and reinstalls.'}
            </div>
          </div>
          {account ? (
            <button type="button" className="btn" onClick={() => void signOut()}>
              Sign out
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => void doSignIn()} disabled={!authConfigured}>
              Sign in with Google
            </button>
          )}
        </div>

        {account && !licensedActive && (
          <div className="setting-row">
            <div>
              <div className="setting-name">Restore license</div>
              <div className="setting-desc">Fetch the license bound to this account on a new device.</div>
            </div>
            <button type="button" className="btn" onClick={() => void doRestore()} disabled={busy}>
              Restore
            </button>
          </div>
        )}

        {!licensedActive && (
          <form onSubmit={activateKey} className="key-form">
            <div className="setting-name">Have a license key?</div>
            <div className="setting-desc">
              Only needed if the automatic setup didn't complete — normally you'll never touch this.
            </div>
            <div className="key-row">
              <input
                type="text"
                className="input"
                placeholder="Paste license key"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                aria-label="License key"
              />
              <button type="submit" className="btn" disabled={busy || keyInput.trim() === ''}>
                Activate
              </button>
            </div>
          </form>
        )}

        {note && <p className={note.kind === 'success' ? 'note-success' : 'error-text'}>{note.text}</p>}
      </div>
    </>
  );
}
