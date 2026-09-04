import type { AppData, Category, Transaction, TxType } from './types';
import type { Period } from './periods';

export function isInPeriod(dateISO: string, period: Period): boolean {
  return dateISO >= period.startISO && dateISO <= period.endISO;
}

/** Transactions within a period, newest date first. */
export function periodTransactions(data: AppData, period: Period): Transaction[] {
  return data.transactions
    .filter((t) => isInPeriod(t.date, period))
    .sort((a, b) => (a.date === b.date ? b.id.localeCompare(a.id) : a.date < b.date ? 1 : -1));
}

export function totalsFor(data: AppData, period: Period): { income: number; expense: number; net: number } {
  let income = 0;
  let expense = 0;
  for (const t of periodTransactions(data, period)) {
    if (t.type === 'income') income += t.amountCents;
    else expense += t.amountCents;
  }
  return { income, expense, net: income - expense };
}

/** Expenses per category id within a period. */
export function spentByCategory(data: AppData, period: Period): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of data.transactions) {
    if (t.type === 'expense' && isInPeriod(t.date, period)) {
      map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + t.amountCents);
    }
  }
  return map;
}

export function categoryById(data: AppData, id: string): Category | undefined {
  return data.categories.find((c) => c.id === id);
}

export function activeCategories(data: AppData, kind?: TxType): Category[] {
  return data.categories.filter((c) => !c.archived && (!kind || c.kind === kind));
}
