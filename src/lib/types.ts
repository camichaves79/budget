export type TxType = 'expense' | 'income';

export interface Transaction {
  id: string;
  type: TxType;
  /** Positive integer, stored in centavos (COP has 100 centavos per peso). */
  amountCents: number;
  categoryId: string;
  /** Local date as YYYY-MM-DD. */
  date: string;
  note?: string;
  /** When set (expenses only), this transaction's amount also counts toward the goal. */
  goalId?: string | null;
}

export interface Category {
  id: string;
  name: string;
  kind: TxType;
  emoji: string;
  color: string;
  archived: boolean;
}

/** Monthly limit for a category. Applies to every budget period (25th–24th). */
export interface Budget {
  categoryId: string;
  amountCents: number;
}

export interface Allocation {
  id: string;
  /** Positive = add money, negative = withdraw money. */
  amountCents: number;
  date: string; // YYYY-MM-DD
  note?: string;
}

export interface Goal {
  id: string;
  name: string;
  targetCents: number;
  deadline?: string | null; // YYYY-MM-DD
  note?: string;
  allocations: Allocation[];
}

export interface AppData {
  transactions: Transaction[];
  categories: Category[];
  budgets: Budget[];
  goals: Goal[];
}
