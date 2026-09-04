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

export interface AppData {
  transactions: Transaction[];
  categories: Category[];
  budgets: Budget[];
}
