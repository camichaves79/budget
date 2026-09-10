import { useEffect, useRef, useState } from 'react';
import { t } from '../lib/i18n';
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
    redeemError,
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
        ? { text: t('license.activeNote'), kind: 'success' }
        : { text: t('license.lostNote'), kind: 'error' },
    );
  }, [lastEvent]);

  // A specific redeem/check failure (e.g. the email-mismatch guidance) is
  // derived at render time — no state sync needed, so failures that happened
  // at boot surface the moment the section mounts.
  const shownNote =
    note ?? (redeemError ? { text: redeemError, kind: 'error' as const } : null);

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
        setNote({ text: t('paywall.purchaseFailed'), kind: 'error' });
      else if (outcome === 'error')
        setNote({
          text: redeemError ?? t('paywall.unreachable'),
          kind: 'error',
        });
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
      setNote({ text: t('license.noLicense'), kind: 'error' });
    else if (outcome === 'error')
      setNote({ text: t('license.verifyFailed'), kind: 'error' });
  };

  const activateKey = async (e: FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim()) return;
    setNote(null);
    // The pasted LS key can only be redeemed for the signed-in account.
    if (!account) {
      setNote({ text: t('license.signInFirst'), kind: 'error' });
      await signIn();
      return;
    }
    setBusy(true);
    const outcome = await activatePastedKey(keyInput);
    setBusy(false);
    if (outcome === 'ok') setKeyInput('');
    else if (outcome === 'invalid') setNote({ text: t('license.badKey'), kind: 'error' });
    else
      setNote({
        text: redeemError ?? t('paywall.unreachable'),
        kind: 'error',
      });
  };

  return (
    <>
      <h2 className="settings-h">{t('license.smartEntry')}</h2>
      <div className="card">
        <div className="setting-row">
          <div>
            <div className="setting-name">{licensedActive ? t('license.unlimited') : t('license.freePlan')}</div>
            <div className="setting-desc">
              {licensedActive
                ? t('license.until', { date: licenseExpiryLabel ?? '…' })
                : t('license.freeLeft', { n: remaining, m: freeDaily })}
            </div>
          </div>
          {licensedActive ? (
            <span className="license-pill">{t('license.active')}</span>
          ) : (
            <button type="button" className="btn" onClick={unlock} disabled={!checkoutReady || busy}>
              {busy ? t('license.working') : account ? t('license.unlockYear') : t('license.signInUnlock')}
            </button>
          )}
        </div>

        {pendingOrder && !licensedActive && (
          <div className="setting-row">
            <div>
              <div className="setting-name">{t('license.purchaseWaiting')}</div>
              <div className="setting-desc">{t('license.finishPurchase')}</div>
            </div>
            <button type="button" className="btn" onClick={unlock} disabled={busy}>
              {account ? t('license.complete') : t('license.signInComplete')}
            </button>
          </div>
        )}

        <div className="setting-row">
          <div>
            <div className="setting-name">{t('license.account')}</div>
            <div className="setting-desc">
              {account
                ? t('license.accountDesc', { email: account.email ?? t('license.signedIn') })
                : t('license.accountHint')}
            </div>
          </div>
          {account ? (
            <button type="button" className="btn" onClick={() => void signOut()}>
              {t('license.signOut')}
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => void doSignIn()} disabled={!authConfigured}>
              {t('license.signInGoogle')}
            </button>
          )}
        </div>

        {account && !licensedActive && (
          <div className="setting-row">
            <div>
              <div className="setting-name">{t('license.restore')}</div>
              <div className="setting-desc">{t('license.restoreDesc')}</div>
            </div>
            <button type="button" className="btn" onClick={() => void doRestore()} disabled={busy}>
              {t('license.restoreBtn')}
            </button>
          </div>
        )}

        {!licensedActive && (
          <form onSubmit={activateKey} className="key-form">
            <div className="setting-name">{t('license.haveKey')}</div>
            <div className="setting-desc">{t('license.keyFallback')}</div>
            <div className="key-row">
              <input
                type="text"
                className="input"
                placeholder={t('license.pasteKey')}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                aria-label={t('license.keyAria')}
              />
              <button type="submit" className="btn" disabled={busy || keyInput.trim() === ''}>
                {t('license.activate')}
              </button>
            </div>
          </form>
        )}

        {shownNote && <p className={shownNote.kind === 'success' ? 'note-success' : 'error-text'}>{shownNote.text}</p>}
      </div>
    </>
  );
}
