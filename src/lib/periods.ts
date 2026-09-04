import { toISODate } from './dates';

/**
 * Budget periods run from the 25th of one month to the 24th of the next.
 * A period is labeled by the month it ENDS in, e.g. "September" = Aug 25 – Sep 24.
 * Key format: "YYYY-MM" of the end month.
 */
export const PERIOD_START_DAY = 25;

export interface Period {
  key: string;
  /** e.g. "September 2026" */
  label: string;
  /** e.g. "Aug 25 – Sep 24" */
  shortLabel: string;
  /** Inclusive bounds, YYYY-MM-DD. */
  startISO: string;
  endISO: string;
}

export function periodForDate(date: Date): Period {
  let endYear = date.getFullYear();
  let endMonth0 = date.getMonth();
  if (date.getDate() >= PERIOD_START_DAY) {
    // Period ends on the 24th of the NEXT month.
    endMonth0 += 1;
    if (endMonth0 > 11) {
      endMonth0 = 0;
      endYear += 1;
    }
  }
  return periodForYearMonth(endYear, endMonth0);
}

export function currentPeriod(): Period {
  return periodForDate(new Date());
}

export function shiftPeriod(period: Period, delta: number): Period {
  const [y, m] = period.key.split('-').map(Number);
  return periodForYearMonth(y, m - 1 + delta);
}

export function isCurrentPeriod(period: Period): boolean {
  return period.key === currentPeriod().key;
}

function periodForYearMonth(endYear: number, endMonth0: number): Period {
  const start = new Date(endYear, endMonth0 - 1, PERIOD_START_DAY);
  const end = new Date(endYear, endMonth0, PERIOD_START_DAY - 1);
  // Derive identity from the constructed end date (handles year rollover).
  const key = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`;
  const label = end.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const shortLabel = `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  return { key, label, shortLabel, startISO: toISODate(start), endISO: toISODate(end) };
}
