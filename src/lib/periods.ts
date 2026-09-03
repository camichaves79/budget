import { toISODate } from './dates';

/**
 * Budget periods run from the 25th of one month to the 24th of the next.
 * A period is labeled by its start month, e.g. "October" = Oct 25 – Nov 24.
 * Key format: "YYYY-MM" of the start month.
 */
export const PERIOD_START_DAY = 25;

export interface Period {
  key: string;
  /** e.g. "October 2025" */
  label: string;
  /** e.g. "Oct 25 – Nov 24" */
  shortLabel: string;
  /** Inclusive bounds, YYYY-MM-DD. */
  startISO: string;
  endISO: string;
}

export function periodForDate(date: Date): Period {
  let year = date.getFullYear();
  let month0 = date.getMonth();
  if (date.getDate() < PERIOD_START_DAY) {
    month0 -= 1;
    if (month0 < 0) {
      month0 = 11;
      year -= 1;
    }
  }
  return periodForYearMonth(year, month0);
}

export function currentPeriod(): Period {
  return periodForDate(new Date());
}

export function shiftPeriod(period: Period, delta: number): Period {
  const [y, m] = period.key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, PERIOD_START_DAY);
  return periodForDate(d);
}

export function isCurrentPeriod(period: Period): boolean {
  return period.key === currentPeriod().key;
}

function periodForYearMonth(year: number, month0: number): Period {
  const start = new Date(year, month0, PERIOD_START_DAY);
  const end = new Date(year, month0 + 1, PERIOD_START_DAY - 1);
  const key = `${year}-${String(month0 + 1).padStart(2, '0')}`;
  const label = start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const shortLabel = `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  return { key, label, shortLabel, startISO: toISODate(start), endISO: toISODate(end) };
}
