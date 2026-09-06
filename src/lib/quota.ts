/**
 * Free smart-entry allowance: 10 parses per day, counted locally.
 *
 * This counter is UX, not security — it lives in localStorage and a
 * determined user could reset it. The server's per-IP rate limiter is the
 * real backstop today; identity-gated quota is the planned scale-up path
 * (ARCHITECTURE.md A12/§5).
 */

export const FREE_DAILY_PARSES = 10;

export interface FreeQuota {
  /** Local ISO date (YYYY-MM-DD) the counter belongs to. */
  date: string;
  /** Parses already used on that date. */
  used: number;
}

const QUOTA_STORAGE_KEY = 'budget.freeQuota.v1';

/** Free entries left today. A stale (previous-day) counter resets to full. */
export function remainingFreeToday(date: string, used: number, today: string): number {
  return date === today ? Math.max(0, FREE_DAILY_PARSES - used) : FREE_DAILY_PARSES;
}

/** The quota after recording one more parse (day rollover included). */
export function nextQuota(date: string, used: number, today: string): FreeQuota {
  if (date !== today) return { date: today, used: 1 };
  return { date, used: Math.min(used + 1, 999999) };
}

export function loadQuota(today: string): FreeQuota {
  try {
    const raw = localStorage.getItem(QUOTA_STORAGE_KEY);
    if (raw) {
      const q = JSON.parse(raw) as Partial<FreeQuota>;
      if (typeof q.date === 'string' && typeof q.used === 'number' && Number.isFinite(q.used) && q.used >= 0) {
        return { date: q.date, used: Math.floor(q.used) };
      }
    }
  } catch {
    // Corrupt or unavailable storage: behave like a fresh day.
  }
  return { date: today, used: 0 };
}

export function saveQuota(quota: FreeQuota): void {
  try {
    localStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify(quota));
  } catch {
    // Quota persistence is best-effort; a failed save only helps the user.
  }
}
