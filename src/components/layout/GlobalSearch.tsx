/**
 * `<GlobalSearch>` — top-bar route palette.
 *
 * Lifted from the Stitch "Athens Executive Interface" top bar: a rounded
 * input with a leading lucide search glyph. On focus / typing it
 * surfaces a dropdown of route matches across the 5 sidebar sections.
 *
 * Keyboard:
 *   - Cmd+K / Ctrl+K : focus the search input from anywhere
 *   - ↑ / ↓          : move highlight within the results
 *   - Enter          : navigate to the highlighted route
 *   - Escape         : close the dropdown + blur
 *
 * Role-gated: shows only the routes the current user can reach, using the
 * same `roles: UserRole[]` whitelist the sidebar honours.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/stores/appStore';
import type { UserRole } from '@/types';
import {
  Search, ArrowRight,
  LayoutDashboard, Gem, Activity, Zap, Brain, MemoryStick, ShieldCheck, FileText, TrendingUp,
  Network, Webhook, Inbox, Cable, BadgeCheck,
  KeyRound, UserCog, UserPlus, Building2, LifeBuoy, Settings,
  Cpu, Rocket, ClipboardList, HeartPulse, Bell, Flag,
  CreditCard, Headset, ListFilter, UserSearch,
  type LucideIcon,
} from 'lucide-react';

const SUPERADMIN_ROLES: UserRole[] = ['superadmin'];
const SUPPORT_ROLES: UserRole[] = ['superadmin', 'support_admin'];
const PLATFORM_ADMIN_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin'];
const EXECUTIVE_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive'];
const MANAGER_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive', 'manager'];
const OPERATOR_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive', 'manager', 'operator'];
const STANDARD_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive', 'manager', 'analyst', 'operator'];

interface RouteHit {
  path: string;
  label: string;
  /** Section label so the user understands where they're jumping to. */
  section: string;
  /** Lower-cased haystack for the fuzzy match. */
  haystack: string;
  /** Bundled lucide icon for the dropdown row (SVG — no remote font). */
  Icon?: LucideIcon;
  roles?: UserRole[];
}

const ROUTES: RouteHit[] = [
  // Intelligence — the journey rail (Home · Data · Findings · Fixes · Savings · Reports)
  { section: 'Intelligence', label: 'Home',          path: '/dashboard',         haystack: 'home dashboard overview journey', Icon: LayoutDashboard },
  { section: 'Intelligence', label: 'Data',          path: '/data',              haystack: 'data connect sources erp sync connections freshness', Icon: Cable, roles: STANDARD_ROLES },
  { section: 'Intelligence', label: 'Findings',      path: '/findings',          haystack: 'findings detect exposure value at risk discrepancies', Icon: ClipboardList, roles: STANDARD_ROLES },
  { section: 'Intelligence', label: 'Executive',     path: '/apex',              haystack: 'apex executive intelligence briefing risks scenarios', Icon: Gem, roles: EXECUTIVE_ROLES },
  { section: 'Intelligence', label: 'Live Monitor',  path: '/pulse',             haystack: 'pulse live monitor process intelligence anomalies metrics', Icon: Activity, roles: STANDARD_ROLES },
  { section: 'Intelligence', label: 'Fixes',         path: '/catalysts',         haystack: 'fixes catalysts autonomous execution clusters', Icon: Zap, roles: OPERATOR_ROLES },
  { section: 'Intelligence', label: 'Mind',          path: '/mind',              haystack: 'mind ai model governance configuration', Icon: Brain, roles: PLATFORM_ADMIN_ROLES },
  { section: 'Intelligence', label: 'Memory',        path: '/memory',            haystack: 'memory knowledge graph entities relationships', Icon: MemoryStick, roles: MANAGER_ROLES },
  { section: 'Intelligence', label: 'Trust',         path: '/trust',             haystack: 'trust calibration provenance peers', Icon: ShieldCheck, roles: STANDARD_ROLES },
  { section: 'Intelligence', label: 'Exec Briefing', path: '/brief', haystack: 'executive summary one page briefing brief', Icon: FileText, roles: EXECUTIVE_ROLES },
  { section: 'Intelligence', label: 'ROI Dashboard', path: '/roi-dashboard',     haystack: 'roi financial proof savings shared', Icon: TrendingUp, roles: EXECUTIVE_ROLES },
  // Data
  { section: 'Data',         label: 'Integrations',       path: '/integrations',        haystack: 'integrations connections erp adapters', Icon: Network, roles: PLATFORM_ADMIN_ROLES },
  { section: 'Data',         label: 'Webhooks',           path: '/webhooks',            haystack: 'webhooks event subscriptions hmac', Icon: Webhook, roles: PLATFORM_ADMIN_ROLES },
  { section: 'Data',         label: 'Operator Queue',     path: '/action-layer',        haystack: 'operator queue action layer dispatch erp approve reject', Icon: Inbox, roles: PLATFORM_ADMIN_ROLES },
  { section: 'Data',         label: 'Operations · Sources', path: '/operations',        haystack: 'operations sources connectivity live protocols sync integration health monitoring circuit breakers', Icon: Cable, roles: PLATFORM_ADMIN_ROLES },
  { section: 'Data',         label: 'Compliance',         path: '/compliance',          haystack: 'compliance soc2 evidence audit governance dsar', Icon: BadgeCheck, roles: PLATFORM_ADMIN_ROLES },
  // Administration
  { section: 'Administration', label: 'IAM',          path: '/iam',             haystack: 'iam users roles policies access', Icon: KeyRound, roles: PLATFORM_ADMIN_ROLES },
  { section: 'Administration', label: 'Custom Roles', path: '/custom-roles',    haystack: 'custom roles permissions builder', Icon: UserCog, roles: PLATFORM_ADMIN_ROLES },
  { section: 'Administration', label: 'Bulk Users',   path: '/bulk-users',      haystack: 'bulk users csv import', Icon: UserPlus, roles: PLATFORM_ADMIN_ROLES },
  { section: 'Administration', label: 'Clients',      path: '/tenants',         haystack: 'clients tenants management', Icon: Building2, roles: SUPERADMIN_ROLES },
  { section: 'Administration', label: 'Support',      path: '/support-tickets', haystack: 'support tickets file track', Icon: LifeBuoy },
  { section: 'Administration', label: 'Settings',     path: '/settings',        haystack: 'settings preferences account profile', Icon: Settings },
  // Platform Ops
  { section: 'Platform Ops',   label: 'Control Plane',     path: '/control-plane',    haystack: 'control plane agent deployments', Icon: Cpu, roles: PLATFORM_ADMIN_ROLES },
  { section: 'Platform Ops',   label: 'Deployments',       path: '/deployments',      haystack: 'deployments hybrid on-premise', Icon: Rocket, roles: SUPERADMIN_ROLES },
  { section: 'Platform Ops',   label: 'Assessments',       path: '/assessments',      haystack: 'assessments pre-sale discovery', Icon: ClipboardList, roles: SUPERADMIN_ROLES },
  { section: 'Platform Ops',   label: 'Operations Health', path: '/platform-health',  haystack: 'operations platform health infrastructure', Icon: HeartPulse, roles: PLATFORM_ADMIN_ROLES },
  { section: 'Platform Ops',   label: 'System Alerts',     path: '/system-alerts',    haystack: 'system alerts rules silence', Icon: Bell, roles: PLATFORM_ADMIN_ROLES },
  { section: 'Platform Ops',   label: 'Feature Flags',     path: '/feature-flags',    haystack: 'feature flags rollout tenants', Icon: Flag, roles: SUPERADMIN_ROLES },
  // Admin Tooling
  { section: 'Admin Tooling',  label: 'Revenue',         path: '/revenue',         haystack: 'revenue usage mrr plan llm', Icon: CreditCard, roles: SUPERADMIN_ROLES },
  { section: 'Admin Tooling',  label: 'Support Console', path: '/support',         haystack: 'support console tenant cross', Icon: Headset, roles: SUPPORT_ROLES },
  { section: 'Admin Tooling',  label: 'Support Triage',  path: '/support-triage',  haystack: 'support triage queue', Icon: ListFilter, roles: PLATFORM_ADMIN_ROLES },
  { section: 'Admin Tooling',  label: 'Impersonate',     path: '/impersonate',     haystack: 'impersonate view-as user debug', Icon: UserSearch, roles: SUPPORT_ROLES },
];

function scoreHit(query: string, h: RouteHit): number {
  // Tiny fuzzy score: exact-label match wins; section prefix is next; then
  // substring in the haystack. Returns -1 to indicate no match.
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const label = h.label.toLowerCase();
  if (label === q) return 1000;
  if (label.startsWith(q)) return 800 - (label.length - q.length);
  if (label.includes(q)) return 500;
  if (h.haystack.includes(q)) return 200;
  // Subsequence ("dsh" → "dashboard"): each query char must appear in order
  let i = 0;
  for (const c of label) {
    if (c === q[i]) i++;
    if (i === q.length) return 100;
  }
  return -1;
}

interface GlobalSearchProps {
  /** Optional: closes any open dropdown (e.g. when route changes). */
  onNavigate?: () => void;
}

export function GlobalSearch({ onNavigate }: GlobalSearchProps): JSX.Element | null {
  const { user } = useAppStore();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  // Cmd+K / Ctrl+K — focus the input from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const userRole = user?.role as UserRole | undefined;
  const visibleRoutes = useMemo(
    () => ROUTES.filter((r) => !r.roles || (userRole && r.roles.includes(userRole))),
    [userRole],
  );

  const hits = useMemo(() => {
    const q = query.trim();
    if (!q) return visibleRoutes.slice(0, 8); // first batch when input is empty
    return visibleRoutes
      .map((r) => ({ r, s: scoreHit(q, r) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8)
      .map((x) => x.r);
  }, [query, visibleRoutes]);

  // Reset highlight when results change so arrow keys feel right.
  useEffect(() => { setHighlight(0); }, [query]);

  const choose = useCallback((r: RouteHit) => {
    navigate(r.path);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
    onNavigate?.();
  }, [navigate, onNavigate]);

  if (!user) return null;

  return (
    <div ref={containerRef} className="hidden lg:flex relative items-center">
      <div
        className="flex items-center rounded-md pl-3 pr-2 py-1.5"
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-card)',
          minWidth: 280,
        }}
      >
        <Search className="t-muted mr-2 shrink-0" size={18} strokeWidth={1.75} aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlight((h) => Math.min(h + 1, Math.max(0, hits.length - 1)));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlight((h) => Math.max(0, h - 1));
            } else if (e.key === 'Enter') {
              if (hits[highlight]) choose(hits[highlight]);
            } else if (e.key === 'Escape') {
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
          className="bg-transparent border-none text-body-sm focus:outline-none focus:ring-0 flex-1 t-primary placeholder:t-muted"
          aria-label="Search routes"
          aria-expanded={open}
          aria-controls="global-search-results"
        />
        <kbd
          className="ml-2 text-caption font-mono t-muted px-1.5 py-0.5 rounded"
          style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}
          aria-hidden="true"
        >
          ⌘K
        </kbd>
      </div>

      {open && (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute top-full left-0 right-0 mt-2 rounded-md overflow-hidden z-50"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-card)',
            boxShadow: 'var(--shadow-dropdown)',
            minWidth: 320,
          }}
        >
          {hits.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-body-sm t-muted">No matches for &ldquo;{query}&rdquo;</p>
              <p className="text-caption t-muted mt-1">Try a section name like &ldquo;catalysts&rdquo; or &ldquo;iam&rdquo;.</p>
            </div>
          ) : (
            <ul>
              {hits.map((r, i) => {
                const active = i === highlight;
                return (
                  <li key={r.path}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => choose(r)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left"
                      style={{
                        background: active ? 'var(--accent-subtle)' : 'transparent',
                        borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
                      }}
                    >
                      {(() => {
                        const RowIcon = r.Icon ?? ArrowRight;
                        return (
                          <RowIcon
                            className="shrink-0"
                            size={18}
                            strokeWidth={active ? 2.25 : 1.75}
                            style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }}
                            aria-hidden="true"
                          />
                        );
                      })()}
                      <span className="flex-1 min-w-0">
                        <span className={`text-body-sm ${active ? 'font-semibold t-primary' : 't-secondary'} truncate`}>
                          {r.label}
                        </span>
                        <span className="block text-caption t-muted truncate">{r.section}</span>
                      </span>
                      <span className="text-caption font-mono t-muted">{r.path}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div
            className="px-3 py-2 flex items-center justify-between text-caption t-muted"
            style={{ borderTop: '1px solid var(--border-card)', background: 'var(--bg-secondary)' }}
          >
            <span>
              <kbd className="font-mono">↑↓</kbd> move ·{' '}
              <kbd className="font-mono">↵</kbd> open ·{' '}
              <kbd className="font-mono">esc</kbd> close
            </span>
            <span>{hits.length} of {visibleRoutes.length}</span>
          </div>
        </div>
      )}
    </div>
  );
}
