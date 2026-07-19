// Recovery Console shell: wordmark, four section pills (scroll, don't route),
// persona lens (demo tenant only), Jeff inline, avatar → identity menu.
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, setToken, setTenantOverride } from '@/lib/api';
import type { NotificationItem, Tenant } from '@/lib/api';
import type { IndustryVertical } from '@/types';
import { useAppStore } from '@/stores/appStore';
import { JeffLauncher } from '@/components/common/JeffLauncher';
import { XIcon, type IconName } from './icons';
import { PERSONAS, type Persona, type PersonaKey } from './persona';
import type { SectionKey } from './reactor-graph';

const PLATFORM_ADMIN_ROLES = ['superadmin', 'support_admin', 'admin'];
// Mirrors App.tsx STANDARD_ROLES — section pills navigate to /x, which 403s
// for scoped roles (viewer/auditor/board_member), so hide them there.
const STANDARD_ROLES = ['superadmin', 'support_admin', 'admin', 'executive', 'manager', 'analyst', 'operator'];

function timeAgo(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const SECTIONS: Array<{ id: SectionKey; label: string; icon: IconName }> = [
  { id: 'brief', label: 'Brief', icon: 'brief' },
  { id: 'decisions', label: 'Decisions', icon: 'decisions' },
  { id: 'ledger', label: 'Ledger', icon: 'ledger' },
  { id: 'catalysts', label: 'Catalysts', icon: 'catalysts' },
];

// One frontend: the console is the app; deep surfaces live under /x with this
// same shell (navigate, not scroll). Role gates mirror App.tsx routes — the
// route itself stays the enforcement point.
const BREAKOUTS: Array<{ to: string; label: string; icon: IconName; roles?: string[] }> = [
  { to: '/x/ops', label: 'Operations', icon: 'ops' },
  { to: '/assessments', label: 'Assessments', icon: 'brief', roles: ['superadmin', 'support_admin', 'admin', 'executive', 'board_member'] },
  { to: '/x/assurance', label: 'Assurance', icon: 'seal', roles: ['superadmin', 'support_admin', 'admin', 'auditor'] },
  { to: '/console', label: 'Admin', icon: 'gate', roles: ['superadmin', 'support_admin', 'admin'] },
];

export function Shell({ active, persona, onPersona, onSection, decisionsCount, jeffContext, jeffOpenKey }: {
  active?: SectionKey;
  persona: Persona | null;
  onPersona: (k: PersonaKey) => void;
  onSection: (id: SectionKey) => void;
  decisionsCount: number | null;
  jeffContext?: string;
  jeffOpenKey?: number;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const user = useAppStore((s) => s.user);
  const companies = useAppStore((s) => s.companies);
  const selectedCompanyId = useAppStore((s) => s.selectedCompanyId);
  const setSelectedCompanyId = useAppStore((s) => s.setSelectedCompanyId);
  const setUser = useAppStore((s) => s.setUser);
  const setActiveTenant = useAppStore((s) => s.setActiveTenant);
  const activeTenantId = useAppStore((s) => s.activeTenantId);
  const setIndustry = useAppStore((s) => s.setIndustry);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isPlatformAdmin = !!user?.role && PLATFORM_ADMIN_ROLES.includes(user.role);
  const canSection = !!user?.role && STANDARD_ROLES.includes(user.role);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const notifRef = useRef<HTMLDivElement>(null);

  // Tenant list for platform admins; default to own tenant on fresh login
  // (same semantics the old Header had — Shell is the only chrome now).
  useEffect(() => {
    if (!isPlatformAdmin) return;
    api.tenants.list().then((data) => {
      setTenants(data.tenants || []);
      if (!activeTenantId && user?.tenantId) {
        const mine = (data.tenants || []).find((t: Tenant) => t.id === user.tenantId);
        if (mine) {
          setActiveTenant(mine.id, mine.name, mine.industry as IndustryVertical);
          setTenantOverride(null);
        }
      }
    }).catch(() => { /* non-critical */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlatformAdmin, user?.tenantId]);

  useEffect(() => {
    const tick = () => api.notifications.unreadCount().then((d) => setUnread(d.unreadCount)).catch(() => { /* non-critical */ });
    tick();
    const t = setInterval(tick, 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!notifOpen) return;
    const close = (e: MouseEvent) => {
      if (!notifRef.current?.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [notifOpen]);

  const openNotifs = () => {
    setNotifOpen((v) => !v);
    if (!notifOpen) {
      api.notifications.list({ limit: 20 })
        .then((d) => { setNotifs(d.notifications); setUnread(d.unreadCount); })
        .catch(() => { /* non-critical */ });
    }
  };

  const markAllRead = () => {
    const ids = notifs.filter((n) => !n.read).map((n) => n.id);
    if (!ids.length) return;
    api.notifications.markRead(ids)
      .then(() => { setNotifs((p) => p.map((n) => ({ ...n, read: true }))); setUnread(0); })
      .catch(() => { /* non-critical */ });
  };

  const selectTenant = (id: string) => {
    const t = tenants.find((x) => x.id === id);
    if (!t) return;
    setActiveTenant(t.id, t.name, t.industry as IndustryVertical);
    if (t.industry) setIndustry(t.industry as IndustryVertical);
    setTenantOverride(t.id === user?.tenantId ? null : t.id);
    // Reload so all cached data refreshes with the new tenant context.
    window.location.reload();
  };
  // ponytail: resolved once per render; after first click theme is explicit anyway
  const isDark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const signOut = async () => {
    try { await api.auth.logout(); } catch { /* session cleared locally regardless */ }
    setToken(null);
    setTenantOverride(null);
    setUser(null);
    setActiveTenant(null, null, null);
    navigate('/login', { replace: true });
  };

  const initial = (user?.name || user?.email || '?').charAt(0).toUpperCase();

  return (
    <div className="shell-wrap">
      <div className="shell">
        <span className="logo"><img src="/atheon-icon.svg?v=7" alt="" width={24} height={24} />Atheon</span>
        <nav className="tabs" aria-label="Sections">
          {canSection && SECTIONS.filter((s) => !persona || persona.sections.includes(s.id)).map((s) => (
            <button
              key={s.id}
              aria-current={active === s.id ? 'true' : undefined}
              onClick={() => onSection(s.id)}
            >
              <XIcon name={s.icon} size={14} /> {s.label}
              {s.id === 'decisions' && decisionsCount != null && decisionsCount > 0 && (
                <span className="badge">{decisionsCount}</span>
              )}
            </button>
          ))}
          {canSection && <i className="sep" aria-hidden="true" />}
          {BREAKOUTS.filter((b) => !b.roles || b.roles.includes(user?.role ?? '')).map((b) => (
            <button
              key={b.to}
              className="out"
              aria-current={pathname.startsWith(b.to) ? 'true' : undefined}
              onClick={() => navigate(b.to)}
              title={`Open ${b.label}`}
            >
              <XIcon name={b.icon} size={14} /> {b.label}
            </button>
          ))}
        </nav>
        <div className="who">
          <JeffLauncher variant="shell" openKey={jeffOpenKey} context={jeffContext ?? `surface:/x role:${persona?.key ?? 'user'}`} />
          <div className="idwrap" ref={notifRef}>
            <button
              className="theme-btn bell"
              onClick={openNotifs}
              aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
              aria-expanded={notifOpen}
              title="Notifications"
            >
              <XIcon name="bell" size={15} />
              {unread > 0 && <span className="bell-dot">{unread > 99 ? '99+' : unread}</span>}
            </button>
            {notifOpen && (
              <div className="idmenu notifmenu">
                <div className="id-head notif-head">
                  <b>Notifications</b>
                  {unread > 0 && <button className="notif-mark" onClick={markAllRead}>Mark all read</button>}
                </div>
                {notifs.length === 0 ? (
                  <p className="notif-empty">No notifications yet</p>
                ) : (
                  notifs.map((n) => (
                    <button
                      key={n.id}
                      className={`notif-item${n.read ? '' : ' unread'}`}
                      onClick={() => {
                        if (n.actionUrl) {
                          try {
                            const u = new URL(n.actionUrl, window.location.origin);
                            navigate(u.pathname + u.search + u.hash);
                          } catch { navigate(n.actionUrl); }
                        }
                        setNotifOpen(false);
                      }}
                    >
                      <b>{n.title}</b>
                      <span>{n.message}</span>
                      <small>{timeAgo(n.createdAt)}</small>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <button
            className="theme-btn"
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Light mode' : 'Dark mode'}
          >
            {isDark ? '☀' : '☾'}
          </button>
          {persona && (
            <select
              className="role"
              value={persona.key}
              onChange={(e) => onPersona(e.target.value as PersonaKey)}
              aria-label="Viewing as"
            >
              {Object.values(PERSONAS).map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
          )}
          <div className="idwrap" ref={menuRef}>
            <button className="avatar" onClick={() => setMenuOpen((v) => !v)} aria-label="Account menu" aria-expanded={menuOpen}>
              {initial}
            </button>
            {menuOpen && (
              // plain popover, not role=menu: it mixes buttons with a company
              // select, and we don't implement menu arrow-key semantics
              <div className="idmenu">
                <div className="id-head">
                  <b>{user?.name || user?.email}</b>
                  {persona
                    ? <small>Viewing as {persona.label}</small>
                    : user?.tenantName && <small>{user.brand?.nameOverride || user.tenantName}</small>}
                </div>
                {isPlatformAdmin && tenants.length > 0 && (
                  <label className="id-row">
                    <XIcon name="world" size={16} />
                    <select
                      value={activeTenantId ?? user?.tenantId ?? ''}
                      onChange={(e) => selectTenant(e.target.value)}
                      aria-label="Tenant"
                    >
                      {[...tenants].sort((a, b) => {
                        if (a.id === user?.tenantId) return -1;
                        if (b.id === user?.tenantId) return 1;
                        return a.name.localeCompare(b.name);
                      }).map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </label>
                )}
                {companies.length > 0 && (
                  <label className="id-row">
                    <XIcon name="company" size={16} />
                    <select
                      value={selectedCompanyId ?? ''}
                      onChange={(e) => setSelectedCompanyId(e.target.value || null)}
                      aria-label="Company"
                    >
                      <option value="">All companies</option>
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                )}
                <button className="id-row" onClick={() => navigate('/x/settings')}>
                  <XIcon name="settings" size={16} /> Settings
                </button>
                <button className="id-row" onClick={() => navigate('/x/settings/mfa')}>
                  <XIcon name="mfa" size={16} /> Multi-factor auth
                </button>
                <button className="id-row" onClick={() => navigate('/support')}>
                  <XIcon name="support" size={16} /> Support
                </button>
                <button className="id-row" onClick={signOut}>
                  <XIcon name="signout" size={16} /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
