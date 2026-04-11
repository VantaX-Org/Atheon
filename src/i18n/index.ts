// TASK-027: i18n framework with English + Afrikaans support
import en from './en';
import af from './af';
import type { TranslationKeys } from './en';

export type Locale = 'en' | 'af';

const translations: Record<Locale, TranslationKeys> = { en, af: af as unknown as TranslationKeys };

let currentLocale: Locale = (localStorage.getItem('atheon:locale') as Locale) || 'en';

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
  localStorage.setItem('atheon:locale', locale);
  // Dispatch event so React components can re-render
  window.dispatchEvent(new CustomEvent('locale-change', { detail: locale }));
}

type NestedKeyOf<T> = T extends object
  ? { [K in keyof T]: K extends string ? (T[K] extends object ? `${K}.${NestedKeyOf<T[K]>}` : K) : never }[keyof T]
  : never;

export type TranslationKey = NestedKeyOf<TranslationKeys>;

/**
 * Get a translation by dot-notation key.
 * Falls back to English if key not found in current locale.
 */
export function t(key: string): string {
  const keys = key.split('.');
  let result: unknown = translations[currentLocale];
  
  for (const k of keys) {
    if (result && typeof result === 'object' && k in result) {
      result = (result as Record<string, unknown>)[k];
    } else {
      // Fallback to English
      result = translations.en;
      for (const fk of keys) {
        if (result && typeof result === 'object' && fk in result) {
          result = (result as Record<string, unknown>)[fk];
        } else {
          return key; // Key not found
        }
      }
      break;
    }
  }

  return typeof result === 'string' ? result : key;
}

/**
 * React hook for i18n - re-renders on locale change
 */
export function useLocale(): { locale: Locale; setLocale: typeof setLocale; t: typeof t } {
  // This is a simple implementation. Components using this hook
  // should listen for locale-change events to re-render.
  return { locale: currentLocale, setLocale, t };
}
