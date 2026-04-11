/**
 * SPEC-027: Internationalization (i18n)
 * Lightweight i18n with namespace-based translation files and locale detection.
 */

export type Locale = 'en' | 'af' | 'zu' | 'fr' | 'de' | 'es' | 'pt' | 'ja' | 'zh';

export const SUPPORTED_LOCALES: { code: Locale; label: string; direction: 'ltr' | 'rtl' }[] = [
  { code: 'en', label: 'English', direction: 'ltr' },
  { code: 'af', label: 'Afrikaans', direction: 'ltr' },
  { code: 'zu', label: 'isiZulu', direction: 'ltr' },
  { code: 'fr', label: 'Français', direction: 'ltr' },
  { code: 'de', label: 'Deutsch', direction: 'ltr' },
  { code: 'es', label: 'Español', direction: 'ltr' },
  { code: 'pt', label: 'Português', direction: 'ltr' },
  { code: 'ja', label: '日本語', direction: 'ltr' },
  { code: 'zh', label: '中文', direction: 'ltr' },
];

// Default English translations (used as fallback)
const en: Record<string, Record<string, string>> = {
  common: {
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    create: 'Create',
    search: 'Search',
    filter: 'Filter',
    loading: 'Loading...',
    error: 'An error occurred',
    retry: 'Retry',
    confirm: 'Confirm',
    close: 'Close',
    back: 'Back',
    next: 'Next',
    previous: 'Previous',
    submit: 'Submit',
    reset: 'Reset',
    export: 'Export',
    import: 'Import',
    refresh: 'Refresh',
    settings: 'Settings',
    logout: 'Logout',
    noData: 'No data available',
    yes: 'Yes',
    no: 'No',
  },
  nav: {
    dashboard: 'Dashboard',
    catalysts: 'Catalysts',
    pulse: 'Pulse',
    apex: 'Apex',
    mind: 'Mind',
    memory: 'Memory',
    connectivity: 'Connectivity',
    chat: 'Chat',
    settings: 'Settings',
    audit: 'Audit',
    tenants: 'Tenants',
    erp: 'ERP Adapters',
    assessments: 'Assessments',
    integrations: 'Integrations',
    iam: 'IAM',
    billing: 'Billing',
  },
  dashboard: {
    title: 'Dashboard',
    healthScore: 'Health Score',
    activeRisks: 'Active Risks',
    metrics: 'Metrics',
    anomalies: 'Anomalies',
    catalysts: 'Active Catalysts',
    lastUpdated: 'Last updated',
    aiInsights: 'AI Insights',
    analyzing: 'Analyzing...',
    refreshData: 'Refresh dashboard data',
  },
  auth: {
    login: 'Login',
    register: 'Register',
    email: 'Email',
    password: 'Password',
    forgotPassword: 'Forgot password?',
    signIn: 'Sign in',
    signUp: 'Sign up',
    verifyEmail: 'Verify Email',
    verificationSuccess: 'Email verified successfully!',
    verificationFailed: 'Email verification failed',
  },
  health: {
    healthy: 'Healthy',
    warning: 'Warning',
    critical: 'Critical',
    improving: 'Improving',
    declining: 'Declining',
    stable: 'Stable',
  },
  errors: {
    networkError: 'Network error. Please check your connection.',
    unauthorized: 'Session expired. Please log in again.',
    forbidden: 'You do not have permission to perform this action.',
    notFound: 'The requested resource was not found.',
    serverError: 'Server error. Please try again later.',
    rateLimited: 'Too many requests. Please wait a moment.',
  },
};

let currentLocale: Locale = 'en';
const translations: Record<Locale, Record<string, Record<string, string>>> = { en } as Record<Locale, Record<string, Record<string, string>>>;

/** Detect user's preferred locale from browser or stored preference */
export function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem('atheon:locale');
    if (stored && SUPPORTED_LOCALES.some(l => l.code === stored)) {
      return stored as Locale;
    }
  } catch { /* ignore */ }

  const browserLang = navigator.language.split('-')[0] as Locale;
  if (SUPPORTED_LOCALES.some(l => l.code === browserLang)) {
    return browserLang;
  }

  return 'en';
}

/** Set the active locale */
export function setLocale(locale: Locale): void {
  currentLocale = locale;
  try {
    localStorage.setItem('atheon:locale', locale);
    document.documentElement.lang = locale;
    const localeInfo = SUPPORTED_LOCALES.find(l => l.code === locale);
    if (localeInfo) {
      document.documentElement.dir = localeInfo.direction;
    }
  } catch { /* ignore */ }
}

/** Get current locale */
export function getLocale(): Locale {
  return currentLocale;
}

/** Register translations for a locale */
export function registerTranslations(locale: Locale, ns: string, msgs: Record<string, string>): void {
  if (!translations[locale]) {
    translations[locale] = {};
  }
  translations[locale][ns] = { ...(translations[locale][ns] || {}), ...msgs };
}

/**
 * Translate a key. Format: "namespace.key" or just "key" (defaults to "common" namespace).
 * Supports interpolation: t('greeting', { name: 'World' }) with template "{name}".
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const parts = key.split('.');
  let ns: string;
  let msgKey: string;

  if (parts.length >= 2) {
    ns = parts[0];
    msgKey = parts.slice(1).join('.');
  } else {
    ns = 'common';
    msgKey = key;
  }

  // Try current locale, fall back to English
  let msg = translations[currentLocale]?.[ns]?.[msgKey] || translations.en?.[ns]?.[msgKey] || key;

  // Interpolate params
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    });
  }

  return msg;
}

/** Format a number according to locale */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  try {
    return new Intl.NumberFormat(currentLocale, options).format(value);
  } catch {
    return value.toLocaleString();
  }
}

/** Format a date according to locale */
export function formatDate(date: Date | string, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  try {
    return new Intl.DateTimeFormat(currentLocale, options || { dateStyle: 'medium' }).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}

/** Format currency */
export function formatCurrency(value: number, currency: string = 'USD'): string {
  try {
    return new Intl.NumberFormat(currentLocale, { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

/** Format relative time (e.g., "2 hours ago") */
export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  try {
    const rtf = new Intl.RelativeTimeFormat(currentLocale, { numeric: 'auto' });
    if (days > 0) return rtf.format(-days, 'day');
    if (hours > 0) return rtf.format(-hours, 'hour');
    if (minutes > 0) return rtf.format(-minutes, 'minute');
    return rtf.format(-seconds, 'second');
  } catch {
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  }
}

// Initialize locale on module load
currentLocale = detectLocale();
