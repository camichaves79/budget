import { useEffect, useState } from 'react';
import { t } from '../lib/i18n';
import type { MsgKey } from '../lib/i18n';
import { WELCOME_DELAY_MS, markWelcomeSeen, shouldShowWelcome, welcomeSeen } from '../lib/welcome';

const STEPS: { step: MsgKey; hint: MsgKey }[] = [
  { step: 'welcome.step1', hint: 'welcome.hint1' },
  { step: 'welcome.step2', hint: 'welcome.hint2' },
  { step: 'welcome.step3', hint: 'welcome.hint3' },
];

/**
 * One-time first-open welcome (`first-open-welcome`): what the app is for +
 * the three essential first moves, in a deep-mint card with white text (the
 * brand greeting — green = growth/calm/"go", and the one white block on the
 * card is the CTA). Appears shortly after boot; every dismissal path (Get
 * started, backdrop, Escape) marks it seen.
 */
export function WelcomeModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!shouldShowWelcome(welcomeSeen())) return;
    const timer = setTimeout(() => setOpen(true), WELCOME_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        markWelcomeSeen();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const dismiss = () => {
    markWelcomeSeen();
    setOpen(false);
  };

  return (
    <div className="welcome-backdrop" onClick={dismiss}>
      <div
        className="welcome-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        aria-describedby="welcome-intro"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="welcome-badge" aria-hidden="true">
          $5
        </span>
        <h2 id="welcome-title" className="welcome-title">
          {t('welcome.title')}
        </h2>
        <p id="welcome-intro" className="welcome-intro">
          {t('welcome.intro')}
        </p>
        <ol className="welcome-steps">
          {STEPS.map((s, i) => (
            <li key={s.step} className="welcome-step">
              <span className="welcome-step-num" aria-hidden="true">
                {i + 1}
              </span>
              <div className="welcome-step-text">
                <strong>{t(s.step)}</strong>
                <span>{t(s.hint)}</span>
              </div>
            </li>
          ))}
        </ol>
        <button type="button" className="btn btn-primary btn-block welcome-cta" onClick={dismiss}>
          {t('welcome.getStarted')}
        </button>
      </div>
    </div>
  );
}
