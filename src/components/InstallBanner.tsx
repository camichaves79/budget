import { t } from '../lib/i18n';
import type { InstallSignal } from '../lib/installPrompt';

/** iOS share-sheet glyph (arrow up out of a box). */
const SHARE_GLYPH = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 3v12" />
    <path d="m8 7 4-4 4 4" />
    <path d="M4 11v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9" />
  </svg>
);

/**
 * One-time PWA install nudge (2026-09, `install-app-signal`): a fixed banner
 * under the status area, above the tab bar. iOS (no install API) shows the
 * Share → "Add to Home Screen" instructions; Chromium shows an Install
 * button wired to the captured `beforeinstallprompt`. Persists until the ✕
 * is tapped (or the native dialog is used) and never renders inside the
 * installed app.
 */
export function InstallBanner({
  signal,
  onDismiss,
  onInstall,
}: {
  signal: InstallSignal | null;
  onDismiss: () => void;
  onInstall: () => void;
}) {
  if (!signal) return null;
  return (
    <div className="install-banner" role="region" aria-label={t('install.title')}>
      <span className="install-banner-icon" aria-hidden="true">
        {SHARE_GLYPH}
      </span>
      <p className="install-banner-text">
        {signal.kind === 'ios-tip' ? t('install.iosTip') : t('install.androidTip')}
      </p>
      {signal.kind === 'install-button' && (
        <button type="button" className="install-banner-action" onClick={onInstall}>
          {t('install.button')}
        </button>
      )}
      <button type="button" className="install-banner-close" onClick={onDismiss} aria-label={t('close')}>
        ✕
      </button>
    </div>
  );
}
