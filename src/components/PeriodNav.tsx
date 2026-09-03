import type { Period } from '../lib/periods';
import { isCurrentPeriod } from '../lib/periods';

export function PeriodNav({
  period,
  onShift,
  onToday,
}: {
  period: Period;
  onShift: (delta: number) => void;
  onToday?: () => void;
}) {
  return (
    <div className="period-nav">
      <button type="button" className="icon-btn" onClick={() => onShift(-1)} aria-label="Previous period">
        ‹
      </button>
      <div className="period-label">
        <strong>{period.label}</strong>
        <span>{period.shortLabel}</span>
        {onToday && !isCurrentPeriod(period) && (
          <button type="button" className="today-link" onClick={onToday}>
            Jump to today
          </button>
        )}
      </div>
      <button type="button" className="icon-btn" onClick={() => onShift(1)} aria-label="Next period">
        ›
      </button>
    </div>
  );
}
