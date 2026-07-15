/**
 * `<ModuleSwitcher>` — top-bar Executive / Live Monitor / Fixes tabs.
 *
 * Mirrors the Stitch Athens Executive Interface top bar (the three
 * intelligence modules pinned to the header). Hidden below `lg` (mobile
 * uses the sidebar). Role-gated to match the sidebar; labels must stay
 * in sync with Sidebar.tsx. Active tab gets an accent underline.
 */
import { Link, useLocation } from 'react-router-dom';
import { useAppStore } from '@/stores/appStore';
import type { UserRole } from '@/types';

interface Module {
  label: string;
  to: string;
  roles?: UserRole[];
}

const EXECUTIVE_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive'];
const OPERATOR_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive', 'manager', 'operator'];
const STANDARD_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive', 'manager', 'analyst', 'operator'];

const MODULES: Module[] = [
  { label: 'Executive',    to: '/apex',      roles: EXECUTIVE_ROLES },
  { label: 'Live Monitor', to: '/pulse',     roles: STANDARD_ROLES },
  { label: 'Fixes',        to: '/catalysts', roles: OPERATOR_ROLES },
];

export function ModuleSwitcher(): JSX.Element | null {
  const { user } = useAppStore();
  const location = useLocation();

  if (!user) return null;
  const role = user.role as UserRole;

  const visible = MODULES.filter((m) => !m.roles || m.roles.includes(role));
  if (visible.length === 0) return null;

  return (
    <nav
      className="hidden lg:flex h-full items-center gap-4 ml-3"
      aria-label="Intelligence modules"
    >
      {visible.map((m) => {
        const active = location.pathname.startsWith(m.to);
        return (
          <Link
            key={m.to}
            to={m.to}
            className={`h-full flex items-center pt-0.5 text-body-sm font-medium transition-colors ${
              active
                ? 't-primary border-b-2'
                : 't-muted hover:t-primary border-b-2 border-transparent'
            }`}
            style={active ? { borderBottomColor: 'var(--accent)' } : undefined}
            aria-current={active ? 'page' : undefined}
          >
            {m.label}
          </Link>
        );
      })}
    </nav>
  );
}
