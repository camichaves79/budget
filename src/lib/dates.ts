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
