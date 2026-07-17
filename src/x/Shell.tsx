// Recovery Console shell: wordmark, four section pills (scroll, don't route),
// persona lens (demo tenant only), Jeff inline, avatar → identity menu.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken, setTenantOverride } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { JeffLauncher } from '@/components/common/JeffLauncher';
import { XIcon, type IconName } from './icons';
import { PERSONAS, type Persona, type PersonaKey } from './persona';
import type { SectionKey } from './reactor-graph';

const SECTIONS: Array<{ id: SectionKey; label: string; icon: IconName }> = [
  { id: 'brief', label: 'Brief', icon: 'brief' },
  { id: 'decisions', label: 'Decisions', icon: 'decisions' },
  { id: 'ledger', label: 'Ledger', icon: 'ledger' },
  { id: 'catalysts', label: 'Catalysts', icon: 'catalysts' },
];

// One frontend: the console is the app; everything deeper on the platform
// breaks out from here (navigate, not scroll). Role gates mirror App.tsx
// routes — the route itself stays the enforcement point.
const BREAKOUTS: Array<{ to: string; label: string; icon: IconName; admin?: boolean }> = [
  { to: '/operations', label: 'Operations', icon: 'ops' },
  { to: '/assurance', label: 'Assurance', icon: 'seal', admin: true },
  { to: '/console', label: 'Console', icon: 'gate', admin: true },
];
const ADMIN_ROLES = ['superadmin', 'support_admin', 'admin'];

export function Shell({ active, persona, onPersona, onSection, decisionsCount, jeffContext, jeffOpenKey }: {
  active: SectionKey;
  persona: Persona | null;
  onPersona: (k: PersonaKey) => void;
  onSection: (id: SectionKey) => void;
  decisionsCount: number | null;
  jeffContext?: string;
  jeffOpenKey?: number;
}) {
  const navigate = useNavigate();
  const user = useAppStore((s) => s.user);
  const companies = useAppStore((s) => s.companies);
  const selectedCompanyId = useAppStore((s) => s.selectedCompanyId);
  const setSelectedCompanyId = useAppStore((s) => s.setSelectedCompanyId);
  const setUser = useAppStore((s) => s.setUser);
  const setActiveTenant = useAppStore((s) => s.setActiveTenant);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
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
        <span className="logo"><i>A</i>Atheon</span>
        <nav className="tabs" aria-label="Sections">
          {SECTIONS.filter((s) => !persona || persona.sections.includes(s.id)).map((s) => (
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
          <i className="sep" aria-hidden="true" />
          {BREAKOUTS.filter((b) => !b.admin || ADMIN_ROLES.includes(user?.role ?? '')).map((b) => (
            <button key={b.to} className="out" onClick={() => navigate(b.to)} title={`Open ${b.label}`}>
              <XIcon name={b.icon} size={14} /> {b.label}<span className="out-a" aria-hidden="true">↗</span>
            </button>
          ))}
        </nav>
        <div className="who">
          <JeffLauncher variant="shell" openKey={jeffOpenKey} context={jeffContext ?? `surface:/x role:${persona?.key ?? 'user'}`} />
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
                  {persona && <small>Viewing as {persona.label}</small>}
                </div>
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
                <button className="id-row" onClick={() => navigate('/settings')}>
                  <XIcon name="settings" size={16} /> Settings
                </button>
                <button className="id-row" onClick={() => navigate('/settings/mfa')}>
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
