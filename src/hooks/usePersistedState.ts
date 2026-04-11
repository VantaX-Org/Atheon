// TASK-025: Frontend state persistence using localStorage
import { useState, useEffect, useCallback } from 'react';

/**
 * Hook that persists state to localStorage with automatic serialization.
 * Falls back to default value if storage is unavailable or data is corrupted.
 */
export function usePersistedState<T>(key: string, defaultValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const storageKey = `atheon:${key}`;

  const [state, setState] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) {
        return JSON.parse(stored) as T;
      }
    } catch {
      // Invalid JSON or storage unavailable
    }
    return defaultValue;
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // Storage full or unavailable
    }
  }, [storageKey, state]);

  return [state, setState];
}

/**
 * Hook that persists tab selection state.
 */
export function usePersistedTab(pageKey: string, defaultTab: string): [string, (tab: string) => void] {
  return usePersistedState(`tab:${pageKey}`, defaultTab);
}

/**
 * Hook that persists filter/sort state for tables.
 */
export function usePersistedFilters<T extends Record<string, unknown>>(
  pageKey: string,
  defaultFilters: T
): [T, (filters: T | ((prev: T) => T)) => void, () => void] {
  const [filters, setFilters] = usePersistedState(`filters:${pageKey}`, defaultFilters);
  
  const resetFilters = useCallback(() => {
    setFilters(defaultFilters);
  }, [defaultFilters, setFilters]);

  return [filters, setFilters, resetFilters];
}

/**
 * Hook that persists sidebar collapsed state.
 */
export function usePersistedSidebar(): [boolean, (collapsed: boolean) => void] {
  return usePersistedState('sidebar:collapsed', false);
}
