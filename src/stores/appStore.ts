import { create } from 'zustand';
import type { User, AtheonLayer, IndustryVertical } from '@/types';
import { api } from '@/lib/api';
import type { ERPCompany } from '@/lib/api';

const SELECTED_COMPANY_LS_KEY = 'atheon_selected_company_id';
const CURRENCY_LS_KEY = 'atheon_tenant_currency';

export type Theme = 'light' | 'dark' | 'auto';
export type AccentColor = 'indigo' | 'blue' | 'violet' | 'emerald' | 'rose';

// Swiss Calm Authority is single-accent (ledger green) + light-only. The
// runtime accent picker and theme toggle are retired: the accent lives in
// :root (src/index.css) and is never overridden at runtime. AccentColor is
// kept only so the settings UI keeps compiling until the shell is restyled.
const VALID_ACCENTS: readonly AccentColor[] = ['indigo', 'blue', 'violet', 'emerald', 'rose'];

export interface MfaEnforcementWarning {
  daysRemaining: number;
  reason?: string;
  mfaSetupUrl?: string;
}

interface AppState {
  user: User | null;
  currentLayer: AtheonLayer;
  sidebarOpen: boolean;
  mobileSidebarOpen: boolean;
  industry: IndustryVertical;
  theme: Theme;
  accentColor: AccentColor;
  onboardingDismissed: boolean;
  // Tenant switching for platform admins
  activeTenantId: string | null;
  activeTenantName: string | null;
  activeTenantIndustry: IndustryVertical | null;
  // MFA grace-period warning — captured from the last login response (PR #221).
  mfaEnforcementWarning: MfaEnforcementWarning | null;
  // Multi-company scoping (PR #219/#220/#232) — null = consolidated across all companies
  companies: ERPCompany[];
  companiesLoaded: boolean;
  selectedCompanyId: string | null;
  // Tenant display currency (ISO 4217). Currency is a tenant-level setting,
  // so figures must never hardcode 'R' — read this and format via
  // format-currency helpers. Hydrated once from the billing summary; ZAR
  // until that resolves (and for fresh tenants with no billing yet).
  currency: string;
  setUser: (user: User | null) => void;
  setCurrentLayer: (layer: AtheonLayer) => void;
  toggleSidebar: () => void;
  setMobileSidebarOpen: (open: boolean) => void;
  setIndustry: (industry: IndustryVertical) => void;
  /** Set the theme (light | dark | auto) — persists and applies immediately. */
  setTheme: (theme: Theme) => void;
  /** Cycle light → dark → auto (single-button callers). */
  toggleTheme: () => void;
  setAccentColor: (color: AccentColor) => void;
  dismissOnboarding: () => void;
  setActiveTenant: (tenantId: string | null, tenantName: string | null, tenantIndustry: IndustryVertical | null) => void;
  setMfaEnforcementWarning: (w: MfaEnforcementWarning | null) => void;
  // Multi-company actions
  loadCompanies: () => Promise<void>;
  setSelectedCompanyId: (id: string | null) => void;
  /** Hydrate the tenant display currency from the billing summary. */
  loadCurrency: () => Promise<void>;
}

// Theme: light | dark | auto. 'auto' follows the OS via prefers-color-scheme.
// Components read only CSS vars, so flipping data-theme on <html> re-themes the
// whole app (dark token set lives in index.css under :root[data-theme="dark"]).
const THEME_LS_KEY = 'atheon-theme';
const VALID_THEMES: readonly Theme[] = ['light', 'dark', 'auto'];
const prefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;

/** Resolve 'auto' to the concrete theme and stamp it on <html>. */
function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  const resolved = theme === 'auto' ? (prefersDark() ? 'dark' : 'light') : theme;
  document.documentElement.setAttribute('data-theme', resolved);
}

const savedThemeRaw = typeof window !== 'undefined' ? localStorage.getItem(THEME_LS_KEY) : null;
// Legacy value 'light' (from the retired light-lock) is honoured; anything else
// invalid falls back to 'auto' so new users track their OS.
const initialTheme: Theme = VALID_THEMES.includes(savedThemeRaw as Theme) ? (savedThemeRaw as Theme) : 'auto';
// Migrate legacy accent values
const rawAccent = typeof window !== 'undefined' ? localStorage.getItem('atheon-accent') : null;
const legacyMap: Record<string, AccentColor> = { amber: 'indigo', teal: 'indigo', sky: 'blue', cyan: 'blue' };
const migratedAccent = rawAccent && legacyMap[rawAccent] ? legacyMap[rawAccent] : rawAccent;
if (rawAccent && legacyMap[rawAccent] && typeof window !== 'undefined') { localStorage.setItem('atheon-accent', legacyMap[rawAccent]); }
const savedAccent = (migratedAccent && VALID_ACCENTS.includes(migratedAccent as AccentColor) ? migratedAccent : null) as AccentColor | null;
const savedOnboarding = typeof window !== 'undefined' ? localStorage.getItem('atheon-onboarding-dismissed') === 'true' : false;
const savedSelectedCompanyId = typeof window !== 'undefined' ? localStorage.getItem(SELECTED_COMPANY_LS_KEY) : null;
const savedCurrency = (typeof window !== 'undefined' ? localStorage.getItem(CURRENCY_LS_KEY) : null) || 'ZAR';

// Apply the saved theme immediately (before first paint of store consumers).
applyTheme(initialTheme);
// Keep 'auto' live: re-apply when the OS scheme flips, but only while in auto.
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (useAppStore.getState().theme === 'auto') applyTheme('auto');
  });
}

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  currentLayer: 'apex',
  sidebarOpen: true,
  industry: ((typeof window !== 'undefined' ? localStorage.getItem('atheon-active-tenant-industry') : null) || 'general') as IndustryVertical,
  theme: initialTheme,
  accentColor: savedAccent || 'indigo',
  onboardingDismissed: savedOnboarding,
  activeTenantId: typeof window !== 'undefined' ? localStorage.getItem('atheon-active-tenant-id') : null,
  activeTenantName: typeof window !== 'undefined' ? localStorage.getItem('atheon-active-tenant-name') : null,
  activeTenantIndustry: (typeof window !== 'undefined' ? localStorage.getItem('atheon-active-tenant-industry') : null) as IndustryVertical | null,
  mfaEnforcementWarning: (() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem('atheon-mfa-warning');
      return raw ? (JSON.parse(raw) as MfaEnforcementWarning) : null;
    } catch { return null; }
  })(),
  companies: [],
  companiesLoaded: false,
  selectedCompanyId: savedSelectedCompanyId,
  currency: savedCurrency,
  setUser: (user) => set({ user }),
  setCurrentLayer: (layer) => set({ currentLayer: layer }),
  mobileSidebarOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
  setIndustry: (industry) => set({ industry }),
  setTheme: (theme) => {
    localStorage.setItem(THEME_LS_KEY, theme);
    applyTheme(theme);
    set({ theme });
  },
  // Cycle light → dark → auto for the single-button legacy callers.
  toggleTheme: () => {
    const next: Theme = get().theme === 'light' ? 'dark' : get().theme === 'dark' ? 'auto' : 'light';
    get().setTheme(next);
  },
  setAccentColor: (color) => {
    // Single-accent (ledger green): selection is persisted for the settings
    // UI but no longer overrides the CSS accent token.
    localStorage.setItem('atheon-accent', color);
    set({ accentColor: color });
  },
  dismissOnboarding: () => {
    localStorage.setItem('atheon-onboarding-dismissed', 'true');
    set({ onboardingDismissed: true });
  },
  setActiveTenant: (tenantId, tenantName, tenantIndustry) => {
    set({ activeTenantId: tenantId, activeTenantName: tenantName, activeTenantIndustry: tenantIndustry });
    // Persist to localStorage for page reload survival
    if (tenantId) {
      localStorage.setItem('atheon-active-tenant-id', tenantId);
      localStorage.setItem('atheon-active-tenant-name', tenantName || '');
      localStorage.setItem('atheon-active-tenant-industry', tenantIndustry || '');
    } else {
      localStorage.removeItem('atheon-active-tenant-id');
      localStorage.removeItem('atheon-active-tenant-name');
      localStorage.removeItem('atheon-active-tenant-industry');
    }
    // Also update industry filter to match the selected tenant's industry
    if (tenantIndustry) {
      set({ industry: tenantIndustry });
    }
    // Clear company selection when switching tenants — companies are tenant-scoped.
    // Companies will be reloaded for the new tenant by loadCompanies().
    if (typeof window !== 'undefined') {
      localStorage.removeItem(SELECTED_COMPANY_LS_KEY);
      // Currency is tenant-scoped — drop the prior tenant's symbol so the new
      // tenant's loadCurrency() re-hydrates instead of flashing a stale code.
      localStorage.removeItem(CURRENCY_LS_KEY);
    }
    set({ companies: [], companiesLoaded: false, selectedCompanyId: null, currency: 'ZAR' });
  },
  loadCompanies: async () => {
    try {
      const data = await api.companies.list();
      const companies = data.companies || [];
      set({ companies, companiesLoaded: true });
      // If the persisted selection is no longer present in the list (stale or
      // different tenant), clear it silently.
      const current = get().selectedCompanyId;
      if (current && !companies.some((c) => c.id === current)) {
        if (typeof window !== 'undefined') localStorage.removeItem(SELECTED_COMPANY_LS_KEY);
        set({ selectedCompanyId: null });
      }
    } catch {
      // Non-critical — tenants without any erp_companies rows will get [] via 200 here,
      // and any other failure (404, network) falls through to consolidated view.
      set({ companies: [], companiesLoaded: true });
    }
  },
  setSelectedCompanyId: (id) => {
    if (typeof window !== 'undefined') {
      if (id) localStorage.setItem(SELECTED_COMPANY_LS_KEY, id);
      else localStorage.removeItem(SELECTED_COMPANY_LS_KEY);
    }
    set({ selectedCompanyId: id });
  },
  loadCurrency: async () => {
    try {
      const b = await api.insightsStats.billingSummary();
      const cur = b?.currency || 'ZAR';
      if (typeof window !== 'undefined') localStorage.setItem(CURRENCY_LS_KEY, cur);
      set({ currency: cur });
    } catch {
      // Fresh tenant or billing not yet available — keep the ZAR default.
    }
  },
  setMfaEnforcementWarning: (w) => {
    if (typeof window !== 'undefined') {
      if (w) localStorage.setItem('atheon-mfa-warning', JSON.stringify(w));
      else localStorage.removeItem('atheon-mfa-warning');
    }
    set({ mfaEnforcementWarning: w });
  },
}));

/**
 * Hook: the currently selected company id (null = consolidated across all
 * companies). Catalyst/Apex/Pulse fetches should call this and pass the
 * result into api.* calls as the `companyId` argument.
 */
export function useSelectedCompanyId(): string | null {
  return useAppStore((s) => s.selectedCompanyId);
}

/**
 * Hook: the tenant's display currency (ISO 4217, e.g. 'ZAR', 'USD').
 * Pass into formatCompactCurrency / formatCurrency rather than hardcoding 'R'.
 */
export function useTenantCurrency(): string {
  return useAppStore((s) => s.currency);
}
