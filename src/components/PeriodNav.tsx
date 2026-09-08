import type { Period } from '../lib/periods';
import { isCurrentPeriod } from '../lib/periods';
import { t, useI18n } from '../lib/i18n';

export function PeriodNav({
  period,
  onShift,
  onToday,
  isToday,
}: {
  period: Period;
  onShift: (delta: number) => void;
  onToday?: () => void;
  /** Whether `period` is the current one (accounts for the custom start day). */
  isToday?: boolean;
}) {
  const { dir } = useI18n();
  const current = isToday ?? isCurrentPeriod(period);
  return (
    <div className="period-nav">
      <button type="button" className="icon-btn" onClick={() => onShift(-1)} aria-label={t('nav.prevPeriod')}>
        {dir === 'rtl' ? '›' : '‹'}
      </button>
      <div className="period-label">
        <strong>{period.label}</strong>
        <span>{period.shortLabel}</span>
        {onToday && !current && (
          <button type="button" className="today-link" onClick={onToday}>
            {t('nav.jumpToToday')}
          </button>
        )}
      </div>
      <button type="button" className="icon-btn" onClick={() => onShift(1)} aria-label={t('nav.nextPeriod')}>
        {dir === 'rtl' ? '‹' : '›'}
      </button>
    </div>
  );
}
