import type { AppData } from './types';
import { todayISO } from './dates';

/** Light validation of a parsed backup file. Returns the data or null. */
export function validateAppData(raw: unknown): AppData | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Partial<AppData>;
  if (!Array.isArray(d.transactions) || !Array.isArray(d.categories) || !Array.isArray(d.budgets) || !Array.isArray(d.goals)) {
    return null;
  }
  for (const t of d.transactions) {
    if (
      !t || typeof t !== 'object' ||
      typeof t.id !== 'string' ||
      (t.type !== 'expense' && t.type !== 'income') ||
      typeof t.amountCents !== 'number' ||
      typeof t.categoryId !== 'string' ||
      typeof t.date !== 'string'
    ) {
      return null;
    }
  }
  for (const c of d.categories) {
    if (
      !c || typeof c !== 'object' ||
      typeof c.id !== 'string' ||
      typeof c.name !== 'string' ||
      (c.kind !== 'expense' && c.kind !== 'income')
    ) {
      return null;
    }
  }
  for (const b of d.budgets) {
    if (!b || typeof b !== 'object' || typeof b.categoryId !== 'string' || typeof b.amountCents !== 'number') {
      return null;
    }
  }
  for (const g of d.goals) {
    if (
      !g || typeof g !== 'object' ||
      typeof g.id !== 'string' ||
      typeof g.name !== 'string' ||
      typeof g.targetCents !== 'number' ||
      !Array.isArray(g.allocations)
    ) {
      return null;
    }
  }
  return d as AppData;
}

/** Download the current data as a JSON backup file. */
export function exportData(data: AppData): void {
  const payload = JSON.stringify(
    { app: 'budget-app', schemaVersion: 1, exportedAt: new Date().toISOString(), data },
    null,
    2,
  );
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `budget-backup-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
