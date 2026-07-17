/**
 * Sidebar — the AppLayout rail for what's left outside the /x console.
 *
 * Single frontend (2026-07): the journey pages (Brief/Data/Findings/Fixes/
 * Savings/Reports) live inside the /x control tower now. This rail only
 * serves surfaces still under AppLayout:
 *
 *   CONSOLE   → /x (the app itself, for STANDARD_ROLES)
 *   WORKSPACE → Board Digest · Memory · Mind (collapsed, role-gated)
 *   ADMIN     → /console platform-admin quarantine (PLATFORM_ADMIN+)
 *   SETTINGS  → /x/settings
 *
 * Scoped read-only roles keep their narrow landing:
 *   auditor       → ASSURANCE (/x/assurance) + SUPPORT + SETTINGS
 *   board_member  → REPORTS (/board) + SUPPORT + SETTINGS
 *
 * Two layouts: desktop 240px sticky column, mobile drawer (Header burger).
 */
import { useMemo, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import { Link, useLocation } from "react-router-dom";
import {
  X, ChevronDown,
  LayoutDashboard, ShieldCheck, FileText, Settings,
  LayoutGrid, MemoryStick, Brain,
  LifeBuoy, Wrench,
  type LucideIcon,
} from "lucide-react";
import type { UserRole } from "@/types";

const MONO = "'Space Mono', ui-monospace, monospace";

// ──────────────────────────────────────────────────────────────
// Role groups
// ──────────────────────────────────────────────────────────────
const PLATFORM_ADMIN_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin'];
const MANAGER_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive', 'manager'];
const STANDARD_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive', 'manager', 'analyst', 'operator'];
const BOARD_DIGEST_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive', 'board_member'];

// ──────────────────────────────────────────────────────────────
// Nav model
// ──────────────────────────────────────────────────────────────
interface NavItem {
  path: string;
  /** UPPERCASE display label (rendered in Space Mono). */
  label: string;
  /** Bundled lucide-react icon (SVG — no remote font dependency, PWA-safe). */
  icon: LucideIcon;
  roles?: UserRole[];
}

interface NavGroup {
  key: string;
  label: string;
  roles?: UserRole[];
  children: NavItem[];
}

// The journey rail — the five-stage value loop in plain language, in loop
// order: CONNECT → DETECT → FIX → RECOVER → REPORT (spec 2026-07-03).
// Single frontend (2026-07): the journey pages live in the /x console now.
// This rail only serves the surfaces still under AppLayout: the admin world
// (/console + drill-downs), scoped read-only roles, and the viewer home.
const PRIMARY: NavItem[] = [
  { path: '/x',                 label: 'Console',  icon: LayoutDashboard, roles: STANDARD_ROLES },
];

// Product pages beyond the core six — collapsed by default so the rail stays
// clean. Each is still role-gated; an empty group hides itself.
const WORKSPACE: NavGroup = {
  key: 'workspace',
  label: 'Workspace',
  children: [
    { path: '/board',  label: 'Board Digest', icon: LayoutGrid,  roles: BOARD_DIGEST_ROLES },
    { path: '/memory', label: 'Memory',       icon: MemoryStick, roles: MANAGER_ROLES },
    { path: '/mind',   label: 'Mind',         icon: Brain,       roles: PLATFORM_ADMIN_ROLES },
  ],
};

// The admin world — every platform-operator surface — is quarantined behind
// the Console (v2 §10 step 5). One entry on the journey rail; its own grouped
// left-nav lives inside ConsolePage. Gated to platform admins; sections narrow
// further by role inside the Console. (`/support-tickets` is the everyone-can-
// file ticket queue — it is NOT admin tooling and stays out of the Console.)
const CONSOLE_ITEM: NavItem = { path: '/console', label: 'Admin', icon: Wrench, roles: PLATFORM_ADMIN_ROLES };

const SETTINGS_ITEM: NavItem = { path: '/x/settings', label: 'Settings', icon: Settings };

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
function visibleFor(items: NavItem[], role: UserRole | undefined): NavItem[] {
  return items.filter((i) => !i.roles || (role && i.roles.includes(role)));
}

function isActivePath(pathname: string, path: string): boolean {
  return pathname === path || (path !== '/dashboard' && pathname.startsWith(path));
}

function roleLabel(role: UserRole | undefined): string {
  if (!role) return 'USER';
  return role.replace(/_/g, ' ').toUpperCase();
}

// ──────────────────────────────────────────────────────────────
// Components
// ──────────────────────────────────────────────────────────────
/** Flat primary/footer row — small icon + Space-Mono uppercase label. */
function NavRow({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate?: () => void }) {
  const active = isActivePath(pathname, item.path);
  return (
    <li>
      <Link
        to={item.path}
        onClick={onNavigate}
        className={cn(
          'group relative flex items-center gap-3 pl-4 pr-3 py-2.5 rounded-full',
          'transition-[background-color,color,transform] duration-[var(--dur-press)]',
          '[transition-timing-function:var(--ease-out)] active:scale-[0.98]',
          active ? '' : 't-secondary hover:t-primary hover:bg-[var(--bg-card-hover)]',
        )}
        style={active ? { background: 'var(--accent-subtle)', color: 'var(--text-primary)' } : undefined}
        aria-current={active ? 'page' : undefined}
      >
        <item.icon
          size={18}
          strokeWidth={active ? 2.25 : 1.75}
          className={cn('shrink-0', active ? 'text-accent' : 't-muted group-hover:t-secondary')}
          aria-hidden="true"
        />
        <span
          className={cn('text-[11px] tracking-[0.14em] uppercase', active ? 'font-bold text-accent' : 'font-medium')}
          style={{ fontFamily: MONO }}
        >
          {item.label}
        </span>
      </Link>
    </li>
  );
}

/** Collapsible disclosure (WORKSPACE / ADMIN) holding flat NavRows. */
function Disclosure({ label, items, pathname, onNavigate }: { label: string; items: NavItem[]; pathname: string; onNavigate?: () => void }) {
  const hasActive = items.some((i) => isActivePath(pathname, i.path));
  const [open, setOpen] = useState(hasActive);
  // Auto-open when navigating into a child route.
  useEffect(() => {
    if (hasActive) setOpen(true);
  }, [hasActive]);

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between pl-4 pr-3 py-2 rounded-md t-muted hover:t-secondary hover:bg-[var(--bg-card-hover)] transition-colors"
        aria-expanded={open}
      >
        <span className="text-[10px] tracking-[0.18em] uppercase font-bold" style={{ fontFamily: MONO }}>{label}</span>
        <ChevronDown size={13} className={cn('transition-transform duration-200', open ? 'rotate-0' : '-rotate-90')} aria-hidden="true" />
      </button>
      {open && (
        <ul className="mt-0.5 mb-1 space-y-0.5">
          {items.map((item) => (
            <NavRow key={item.path} item={item} pathname={pathname} onNavigate={onNavigate} />
          ))}
        </ul>
      )}
    </li>
  );
}

function AtheonSidebarLogo() {
  return (
    <svg width="26" height="26" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="sbStroke" x1="0" y1="0" x2="36" y2="36">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="var(--bronze)" />
        </linearGradient>
      </defs>
      <rect width="36" height="36" rx="9" fill="var(--text-primary)" />
      <rect x="0.5" y="0.5" width="35" height="35" rx="8.5" fill="none" stroke="rgb(var(--accent-rgb) / 0.18)" />
      <path d="M18 6L28 29H8L18 6Z" fill="none" stroke="url(#sbStroke)" strokeWidth="1.6" strokeLinejoin="round" />
      <line x1="11" y1="22" x2="25" y2="22" stroke="var(--accent)" strokeWidth=".8" opacity=".7" />
      <line x1="13" y1="16.5" x2="23" y2="16.5" stroke="var(--info)" strokeWidth=".8" opacity=".55" />
      <circle cx="18" cy="9.5" r="1.9" fill="var(--bronze)" />
    </svg>
  );
}

export function Sidebar() {
  const { mobileSidebarOpen, setMobileSidebarOpen, user } = useAppStore();
  const location = useLocation();
  const closeMobile = () => setMobileSidebarOpen(false);
  const userRole = user?.role as UserRole | undefined;
  const pathname = location.pathname;

  // Scoped read-only roles get a narrow two-item rail and no disclosures.
  const isScoped = userRole === 'auditor' || userRole === 'board_member';

  const primaryItems = useMemo<NavItem[]>(() => {
    if (userRole === 'auditor') {
      return [
        { path: '/x/assurance', label: 'Assurance', icon: ShieldCheck },
        { path: '/support-tickets', label: 'Support', icon: LifeBuoy },
      ];
    }
    if (userRole === 'board_member') {
      return [
        { path: '/board', label: 'Reports', icon: FileText },
        { path: '/support-tickets', label: 'Support', icon: LifeBuoy },
      ];
    }
    return visibleFor(PRIMARY, userRole);
  }, [userRole]);

  const workspaceItems = useMemo(() => (isScoped ? [] : visibleFor(WORKSPACE.children, userRole)), [userRole, isScoped]);
  const consoleVisible = !isScoped && !!userRole && !!CONSOLE_ITEM.roles && CONSOLE_ITEM.roles.includes(userRole);

  // Logo target is role-aware — scoped roles land on their own home.
  const homeTarget =
    userRole === 'auditor' ? '/x/assurance'
    : userRole === 'board_member' ? '/board'
    : '/dashboard';

  const sidebarBody = (
    <>
      <div className="flex items-center gap-2.5 px-4 pt-5 pb-4">
        <Link to={homeTarget} className="flex items-center gap-2.5" onClick={closeMobile}>
          <AtheonSidebarLogo />
          <span
            className="text-[15px] font-bold tracking-[0.22em] uppercase t-primary leading-none"
            style={{ fontFamily: MONO }}
          >
            Atheon
          </span>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 pb-3" aria-label="Primary navigation">
        <ul className="space-y-0.5">
          {primaryItems.map((item) => (
            <NavRow key={item.path} item={item} pathname={pathname} onNavigate={closeMobile} />
          ))}

          {workspaceItems.length > 0 && (
            <>
              <li aria-hidden="true" className="h-px mx-4 my-2 bg-[var(--border-card)]" />
              <Disclosure label={WORKSPACE.label} items={workspaceItems} pathname={pathname} onNavigate={closeMobile} />
            </>
          )}

          {consoleVisible && (
            <NavRow item={CONSOLE_ITEM} pathname={pathname} onNavigate={closeMobile} />
          )}

          <NavRow item={SETTINGS_ITEM} pathname={pathname} onNavigate={closeMobile} />
        </ul>
      </nav>

      {/* Footer — signed-in identity (mockup: "EXECUTIVE USER") */}
      <div className="border-t border-[var(--border-card)] px-4 py-3 flex items-center gap-3">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-full shrink-0 text-[11px] font-bold text-accent"
          style={{ background: 'var(--accent-subtle)', fontFamily: MONO }}
          aria-hidden="true"
        >
          {(user?.name?.[0] ?? roleLabel(userRole)[0] ?? 'U').toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="block text-[11px] tracking-[0.12em] uppercase font-bold t-primary truncate" style={{ fontFamily: MONO }}>
            {roleLabel(userRole)}
          </span>
          <span className="block text-caption t-muted truncate">{user?.name ?? user?.email ?? 'Signed in'}</span>
        </span>
      </div>
    </>
  );

  return (
    <>
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden bg-black/20"
          onClick={closeMobile}
        />
      )}

      {/* Desktop — 240px sticky column */}
      <aside
        className="fixed left-0 top-0 h-full z-40 w-sidebar-expanded hidden md:flex flex-col transition-colors duration-200"
        style={{
          background: 'var(--bg-sidebar)',
          backdropFilter: 'blur(var(--glass-blur))',
          WebkitBackdropFilter: 'blur(var(--glass-blur))',
          borderRight: '1px solid var(--glass-border)',
        }}
        role="navigation"
        aria-label="Main navigation"
      >
        {sidebarBody}
      </aside>

      {/* Mobile drawer — same body, slides in from the left */}
      <aside
        className={cn(
          'fixed left-0 top-0 h-full z-50 flex flex-col transition-transform duration-300 w-72 md:hidden',
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        style={{ background: 'var(--bg-modal)', backdropFilter: 'blur(var(--overlay-blur))', WebkitBackdropFilter: 'blur(var(--overlay-blur))', borderRight: '1px solid var(--glass-border)', boxShadow: 'var(--shadow-dropdown)' }}
        role="navigation"
        aria-label="Mobile navigation"
        aria-hidden={!mobileSidebarOpen}
      >
        <div className="flex items-center justify-end px-4 pt-3">
          <button
            onClick={closeMobile}
            className="p-1.5 rounded-md t-muted hover:t-primary hover:bg-[var(--bg-secondary)] transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] active:scale-[0.97]"
            title="Close navigation menu"
            aria-label="Close navigation menu"
          >
            <X size={18} />
          </button>
        </div>
        {sidebarBody}
      </aside>
    </>
  );
}
