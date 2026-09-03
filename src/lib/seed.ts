import type { Category, TxType } from './types';
import { newId } from './id';

export const PALETTE = [
  '#0d9488', '#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
  '#06b6d4', '#e11d48', '#a3e635',
];

export const DEFAULT_DEFS: Array<[string, string, TxType]> = [
  ['Vivienda', '🏠', 'expense'],
  ['Servicios', '💡', 'expense'],
  ['Mercado', '🛒', 'expense'],
  ['Transporte', '🚌', 'expense'],
  ['Salud', '🩺', 'expense'],
  ['Educación', '🎓', 'expense'],
  ['Entretenimiento', '🎬', 'expense'],
  ['Restaurantes', '🍽️', 'expense'],
  ['Ropa', '👕', 'expense'],
  ['Otros', '📦', 'expense'],
  ['Salario', '💼', 'income'],
  ['Freelance', '🧑‍💻', 'income'],
  ['Otros ingresos', '💰', 'income'],
];

export function defaultCategories(): Category[] {
  return DEFAULT_DEFS.map(([name, emoji, kind], i) => ({
    id: newId(),
    name,
    emoji,
    kind,
    color: PALETTE[i % PALETTE.length],
    archived: false,
  }));
}
