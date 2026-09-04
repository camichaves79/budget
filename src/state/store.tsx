import { createContext, useContext, useEffect, useReducer } from 'react';
import type { Dispatch, ReactNode } from 'react';
import type { AppData, Budget, Category, Transaction } from '../lib/types';
import { localStorageAdapter } from '../lib/storage';
import { defaultCategories, PALETTE } from '../lib/seed';
import { newId } from '../lib/id';

export type Action =
  | { type: 'addTransaction'; tx: Omit<Transaction, 'id'> }
  | { type: 'updateTransaction'; id: string; patch: Partial<Omit<Transaction, 'id'>> }
  | { type: 'deleteTransaction'; id: string }
  | { type: 'addCategory'; cat: Omit<Category, 'id' | 'color'> }
  | { type: 'updateCategory'; id: string; patch: Partial<Omit<Category, 'id'>> }
  | { type: 'deleteCategory'; id: string }
  | { type: 'setBudget'; categoryId: string; amountCents: number | null }
  | { type: 'importData'; data: AppData }
  | { type: 'resetAll' };

export function initialData(): AppData {
  return {
    transactions: [],
    categories: defaultCategories(),
    budgets: [] as Budget[],
  };
}

function reducer(state: AppData, action: Action): AppData {
  switch (action.type) {
    case 'addTransaction':
      return { ...state, transactions: [{ ...action.tx, id: newId() }, ...state.transactions] };

    case 'updateTransaction':
      return {
        ...state,
        transactions: state.transactions.map((t) => (t.id === action.id ? { ...t, ...action.patch } : t)),
      };

    case 'deleteTransaction':
      return { ...state, transactions: state.transactions.filter((t) => t.id !== action.id) };

    case 'addCategory':
      return {
        ...state,
        categories: [
          ...state.categories,
          {
            ...action.cat,
            id: newId(),
            color: PALETTE[state.categories.length % PALETTE.length],
          },
        ],
      };

    case 'updateCategory':
      return {
        ...state,
        categories: state.categories.map((c) => (c.id === action.id ? { ...c, ...action.patch } : c)),
      };

    case 'deleteCategory': {
      const cat = state.categories.find((c) => c.id === action.id);
      if (!cat) return state;
      const fallback = state.categories.find((c) => c.kind === cat.kind && c.id !== cat.id && !c.archived);
      const transactions = fallback
        ? state.transactions.map((t) => (t.categoryId === cat.id ? { ...t, categoryId: fallback.id } : t))
        : state.transactions;
      return {
        ...state,
        transactions,
        categories: state.categories.filter((c) => c.id !== cat.id),
        budgets: state.budgets.filter((b) => b.categoryId !== cat.id),
      };
    }

    case 'setBudget': {
      if (action.amountCents === null) {
        return { ...state, budgets: state.budgets.filter((b) => b.categoryId !== action.categoryId) };
      }
      const existing = state.budgets.find((b) => b.categoryId === action.categoryId);
      if (existing) {
        return {
          ...state,
          budgets: state.budgets.map((b) =>
            b.categoryId === action.categoryId ? { ...b, amountCents: action.amountCents as number } : b,
          ),
        };
      }
      return { ...state, budgets: [...state.budgets, { categoryId: action.categoryId, amountCents: action.amountCents as number }] };
    }

    case 'importData':
      return action.data;

    case 'resetAll':
      return initialData();

    default:
      return state;
  }
}

interface StoreValue {
  data: AppData;
  dispatch: Dispatch<Action>;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, dispatch] = useReducer(reducer, undefined, () => localStorageAdapter.load() ?? initialData());

  // Auto-save on every change (persists across reloads and browser restarts).
  useEffect(() => {
    localStorageAdapter.save(data);
  }, [data]);

  return <StoreContext.Provider value={{ data, dispatch }}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}
