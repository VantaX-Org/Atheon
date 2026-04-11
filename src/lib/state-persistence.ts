/**
 * SPEC-026: Frontend State Persistence
 * Persist UI state (sidebar, filters, view preferences) across sessions via localStorage.
 * Falls back gracefully if storage is unavailable.
 */

const STORAGE_PREFIX = 'atheon:';

/** Safely read from localStorage */
export function getPersistedState<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Safely write to localStorage */
export function setPersistedState<T>(key: string, value: T): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value));
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

/** Remove a persisted key */
export function removePersistedState(key: string): void {
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
  } catch {
    // Ignore
  }
}

/** Clear all Atheon-prefixed persisted state */
export function clearAllPersistedState(): void {
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(STORAGE_PREFIX));
    keys.forEach(k => localStorage.removeItem(k));
  } catch {
    // Ignore
  }
}

/** Known persistence keys */
export const PERSIST_KEYS = {
  SIDEBAR_COLLAPSED: 'sidebar_collapsed',
  SIDEBAR_WIDTH: 'sidebar_width',
  THEME: 'theme',
  ACCENT_COLOR: 'accent_color',
  DASHBOARD_LAYOUT: 'dashboard_layout',
  TABLE_PAGE_SIZE: 'table_page_size',
  FILTER_PRESETS: 'filter_presets',
  LAST_VIEWED_TENANT: 'last_viewed_tenant',
  CHART_PREFERENCES: 'chart_preferences',
  NOTIFICATION_PREFS: 'notification_prefs',
  ONBOARDING_DISMISSED: 'onboarding_dismissed',
  LOCALE: 'locale',
  DATE_FORMAT: 'date_format',
  TIMEZONE: 'timezone',
} as const;

/** Create a typed accessor for a specific persisted key */
export function createPersistedAccessor<T>(key: string, fallback: T) {
  return {
    get: () => getPersistedState<T>(key, fallback),
    set: (value: T) => setPersistedState(key, value),
    remove: () => removePersistedState(key),
  };
}
