import { createContext, useContext, useEffect, useReducer } from 'react';
import type { Dispatch, ReactNode } from 'react';
import type { Allocation, AppData, Budget, Category, Goal, Transaction } from '../lib/types';
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
  | { type: 'addGoal'; goal: Omit<Goal, 'id' | 'allocations'> }
  | { type: 'updateGoal'; id: string; patch: Partial<Omit<Goal, 'id' | 'allocations'>> }
  | { type: 'deleteGoal'; id: string }
  | { type: 'addAllocation'; goalId: string; allocation: Omit<Allocation, 'id'> }
  | { type: 'deleteAllocation'; goalId: string; allocationId: string }
  | { type: 'importData'; data: AppData }
  | { type: 'resetAll' };

export function initialData(): AppData {
  return {
    transactions: [],
    categories: defaultCategories(),
    budgets: [] as Budget[],
    goals: [],
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

    case 'addGoal':
      return { ...state, goals: [...state.goals, { ...action.goal, id: newId(), allocations: [] }] };

    case 'updateGoal':
      return { ...state, goals: state.goals.map((g) => (g.id === action.id ? { ...g, ...action.patch } : g)) };

    case 'deleteGoal':
      return {
        ...state,
        goals: state.goals.filter((g) => g.id !== action.id),
        transactions: state.transactions.map((t) => (t.goalId === action.id ? { ...t, goalId: null } : t)),
      };

    case 'addAllocation':
      return {
        ...state,
        goals: state.goals.map((g) =>
          g.id === action.goalId
            ? { ...g, allocations: [...g.allocations, { ...action.allocation, id: newId() }] }
            : g,
        ),
      };

    case 'deleteAllocation':
      return {
        ...state,
        goals: state.goals.map((g) =>
          g.id === action.goalId
            ? { ...g, allocations: g.allocations.filter((a) => a.id !== action.allocationId) }
            : g,
        ),
      };

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
