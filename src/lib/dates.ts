/** Local-date helpers. All dates are treated as local (no timezone conversion). */

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True when s is a real calendar date in YYYY-MM-DD form (no timezone math). */
export function isValidISODate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatDateShort(s: string): string {
  return parseISODate(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatDateFull(s: string): string {
  return parseISODate(s).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Whole days from today (local midnight) until the given date. Negative = past. */
export function daysUntil(s: string): number {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = parseISODate(s).getTime();
  return Math.round((target - today) / 86_400_000);
}
