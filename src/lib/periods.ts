import { toISODate } from './dates';

/**
 * Budget periods run from a configurable day of one month to the day before it
 * in the next month. The period is labeled by the month that contains the
 * MAJORITY of its days (ties go to the starting month). With the default
 * start day 25 that reproduces the classic behavior: Aug 25 – Sep 24 =
 * "September".
 *
 * Start days are clamped to 1–28 so every month contains the start date
 * (Feburary-safe). Key format: the period's start date "YYYY-MM-DD".
 */
export const PERIOD_START_DAY = 25;
export const MIN_START_DAY = 1;
export const MAX_START_DAY = 28;

export function clampStartDay(day: number): number {
  const n = Number.isFinite(day) ? Math.floor(day) : PERIOD_START_DAY;
  return Math.min(Math.max(n, MIN_START_DAY), MAX_START_DAY);
}

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

/** The period containing `date`, given the period start day (1–28). */
export function periodForDate(date: Date, startDay: number = PERIOD_START_DAY): Period {
  const safe = clampStartDay(startDay);
  let startYear = date.getFullYear();
  let startMonth0 = date.getMonth();
  if (date.getDate() < safe) {
    startMonth0 -= 1;
    if (startMonth0 < 0) {
      startMonth0 = 11;
      startYear -= 1;
    }
  }
  return periodForStart(startYear, startMonth0, safe);
}

export function currentPeriod(startDay: number = PERIOD_START_DAY): Period {
  return periodForDate(new Date(), startDay);
}

export function shiftPeriod(period: Period, delta: number): Period {
  const [y, m, d] = period.key.split('-').map(Number);
  const startDay = clampStartDay(d);
  const shifted = new Date(y, m - 1 + delta, startDay);
  return periodForStart(shifted.getFullYear(), shifted.getMonth(), startDay);
}

export function isCurrentPeriod(period: Period, startDay: number = PERIOD_START_DAY): boolean {
  return period.key === currentPeriod(startDay).key;
}

function periodForStart(startYear: number, startMonth0: number, startDay: number): Period {
  const start = new Date(startYear, startMonth0, startDay);
  const end = new Date(startYear, startMonth0 + 1, startDay - 1);
  // Majority month: the month holding more days of the period; tie → start.
  const startMonthDays = daysInMonth(start.getFullYear(), start.getMonth()) - start.getDate() + 1;
  const labelDate = startMonthDays >= end.getDate() ? start : end;
  return {
    key: toISODate(start),
    label: labelDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    shortLabel: `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
    startISO: toISODate(start),
    endISO: toISODate(end),
  };
}

/** Days in the given (year, month0) — 28/29/30/31. */
function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}
