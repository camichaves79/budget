import type { Category, TxType } from './types';
import { newId } from './id';
import { t } from './i18n';
import type { MsgKey } from './i18n';

export const PALETTE = [
  '#0d9488', '#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
  '#06b6d4', '#e11d48', '#a3e635',
];

/**
 * Seeded defaults, localized per UI language (2026-09 i18n): the names come
 * from the message catalog, so a new install gets categories in the app's
 * language. Ids stay random — existing data is never touched.
 */
export const DEFAULT_DEFS: Array<[MsgKey, string, TxType]> = [
  ['seed.housing', '🏠', 'expense'],
  ['seed.utilities', '💡', 'expense'],
  ['seed.groceries', '🛒', 'expense'],
  ['seed.transport', '🚌', 'expense'],
  ['seed.health', '🩺', 'expense'],
  ['seed.education', '🎓', 'expense'],
  ['seed.entertainment', '🎬', 'expense'],
  ['seed.restaurants', '🍽️', 'expense'],
  ['seed.clothing', '👕', 'expense'],
  ['seed.other', '📦', 'expense'],
  ['seed.salary', '💼', 'income'],
  ['seed.freelance', '🧑‍💻', 'income'],
  ['seed.otherIncome', '💰', 'income'],
];

export function defaultCategories(): Category[] {
  return DEFAULT_DEFS.map(([key, emoji, kind], i) => ({
    id: newId(),
    name: t(key),
    emoji,
    kind,
    color: PALETTE[i % PALETTE.length],
    archived: false,
  }));
}
