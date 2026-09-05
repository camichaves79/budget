import type { AppData } from './types';
import { clampStartDay, PERIOD_START_DAY } from './periods';

/**
 * Storage adapter interface.
 * localStorage is the v1 implementation; the rest of the app only talks to
 * this interface, so the backend can be swapped (e.g. SQLite via WASM) later
 * without touching UI code.
 */
export interface StorageAdapter {
  load(): AppData | null;
  save(data: AppData): void;
  clear(): void;
}

const STORAGE_KEY = 'budget-app.data';
const SCHEMA_VERSION = 1;

interface Persisted {
  version: number;
  data: AppData;
}

export const localStorageAdapter: StorageAdapter = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Persisted;
      if (!parsed || parsed.version !== SCHEMA_VERSION || !parsed.data) return null;
      // Old saves predate the configurable period start day — default it.
      if (!Number.isInteger(parsed.data.periodStartDay)) {
        parsed.data.periodStartDay = PERIOD_START_DAY;
      } else {
        parsed.data.periodStartDay = clampStartDay(parsed.data.periodStartDay);
      }
      return parsed.data;
    } catch {
      return null;
    }
  },
  save(data) {
    const persisted: Persisted = { version: SCHEMA_VERSION, data };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  },
  clear() {
    localStorage.removeItem(STORAGE_KEY);
  },
};
