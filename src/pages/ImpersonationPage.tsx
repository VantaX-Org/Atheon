/**
 * ADMIN-004: User Impersonation
 * Support/superadmin can "View as [user]" with a 15-min time-limited session.
 * Route: /impersonate | Role: superadmin, support_admin
 *
 * Backend (verified):
 *   - GET  /api/v1/admin-tooling/impersonate/users?q=…        — cross-tenant user search
 *   - POST /api/v1/admin-tooling/impersonate/start            — starts a time-limited session
 *   - POST /api/v1/admin-tooling/impersonate/end              — ends the session
 *
 * Privilege guards: the backend blocks impersonating equal/higher-role users;
 * we reflect that with a clear error toast and disable the "View As" button
 * for users who would be rejected server-side.
 */
import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { useAppStore } from '@/stores/appStore';
import { useToast } from '@/components/ui/toast';
import { api, ApiError, setTenantOverride, getToken, setToken } from '@/lib/api';
import { AsyncPageContent, statusFrom } from '@/components/ui/async';
import {
  Eye, Search, Clock, Loader2, AlertTriangle,
  User, LogOut, ShieldCheck,
} from 'lucide-react';

interface ImpersonatableUser {
  id: string;
  name: string;
  email: string;
  role: string;
  tenant_id: string;
}

interface ImpersonationSession {
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  tenantId: string;
  expiresAt: string;
  startedAt: string;
}

// Must mirror backend ROLE_LEVELS in workers/api/src/lib/roles.ts. If a target
// user's role is >= caller's role, the server will reject the impersonation —
// we disable the button preemptively for UX clarity.
const ROLE_LEVELS: Record<string, number> = {
  superadmin: 100,
  support_admin: 90,
  admin: 80,
  executive: 70,
  manager: 60,
  analyst: 50,
  operator: 40,
  viewer: 30,
};

const SESSION_STORAGE_KEY = 'atheon_impersonation_session';
const ADMIN_TOKEN_STASH_KEY = 'atheon_admin_token_stash';

/**
 * Drop all impersonation client state: restore the stashed admin access token
 * (if stale, the normal 401→refresh flow renews it on the next request) and
 * clear any legacy tenant override left by pre-token impersonation sessions.
 */
function restoreAdminIdentity() {
  const stash = localStorage.getItem(ADMIN_TOKEN_STASH_KEY);
  if (stash) {
    setToken(stash);
    localStorage.removeItem(ADMIN_TOKEN_STASH_KEY);
  }
  setTenantOverride(null);
}

function loadSessionFromStorage(): ImpersonationSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ImpersonationSession;
    // Discard if expired — and restore the admin token, otherwise the admin
    // is left holding a dead impersonation token with no banner explaining why.
    if (new Date(parsed.expiresAt).getTime() < Date.now()) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      restoreAdminIdentity();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function ImpersonationPage() {
  const currentUser = useAppStore((s) => s.user);
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState<ImpersonatableUser[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<ImpersonatableUser[]>([]);
  const [activeSession, setActiveSession] = useState<ImpersonationSession | null>(loadSessionFromStorage());
  const [confirmUser, setConfirmUser] = useState<ImpersonatableUser | null>(null);
  const [impersonating, setImpersonating] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const callerLevel = ROLE_LEVELS[currentUser?.role || ''] ?? 0;

  const loadUsers = useCallback(async (q?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.adminTooling.impersonateSearch(q);
      const list = (res.users || []) as unknown as ImpersonatableUser[];
      setUsers(list);
      setFilteredUsers(list);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load users';
      setError(message);
      toast.error('Failed to load users', {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  // Auto-expire: the impersonation token's exp enforces the 15-min window
  // server-side (requests 401 past expiry); this timer restores the admin
  // token and banner at the same moment so the UI never claims a live session.
  useEffect(() => {
    if (!activeSession) return;
    const ms = new Date(activeSession.expiresAt).getTime() - Date.now();
    const timer = setTimeout(() => {
      setActiveSession(null);
      localStorage.removeItem(SESSION_STORAGE_KEY);
      restoreAdminIdentity();
      toast.warning('Impersonation session expired', {
        message: 'The 15-minute window ended. You are back to your own view.',
      });
    }, Math.max(0, ms));
    return () => clearTimeout(timer);
  }, [activeSession, toast]);

  // Client-side filter on already-loaded list (avoids a round-trip per keystroke)
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredUsers(users);
    } else {
      const q = searchQuery.toLowerCase();
      setFilteredUsers(users.filter(u =>
        (u.name || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.role || '').toLowerCase().includes(q)
      ));
    }
  }, [searchQuery, users]);

  const startImpersonation = async (target: ImpersonatableUser) => {
    setImpersonating(true);
    try {
      const res = await api.adminTooling.impersonateStart(target.id);
      const imp = (res as { impersonation?: Record<string, unknown> }).impersonation;
      if (!imp) {
        throw new Error('Impersonation response missing session data');
      }
      if (typeof imp.token !== 'string' || !imp.token) {
        throw new Error('Impersonation response missing session token');
      }
      const session: ImpersonationSession = {
        userId: String(imp.userId),
        userName: String(imp.name),
        userEmail: String(imp.email),
        userRole: String(imp.role),
        tenantId: String(imp.tenantId),
        expiresAt: String(imp.expiresAt),
        startedAt: new Date().toISOString(),
      };
      setActiveSession(session);
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      // Swap to the server-issued impersonation token: role + tenant scoping
      // and the 15-min expiry are enforced by the API, not client state. Stash
      // the admin token so End Session can restore it. The admin refresh token
      // is kept, so after expiry the next 401 silently renews the admin identity.
      localStorage.setItem(ADMIN_TOKEN_STASH_KEY, getToken() || '');
      setToken(String(imp.token));
      setTenantOverride(null);
      setConfirmUser(null);
      toast.success('Impersonation started', {
        message: `Viewing as ${session.userName} (${session.userRole}). Session expires at ${new Date(session.expiresAt).toLocaleTimeString()}.`,
      });
    } catch (err) {
      toast.error('Impersonation failed', {
        message: err instanceof Error ? err.message : 'Could not start impersonation',
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setImpersonating(false);
    }
  };

  const endImpersonation = async () => {
    setEnding(true);
    // Restore the admin token FIRST — the end endpoint is support/superadmin
    // only, so calling it with the scoped-down impersonation token would 403.
    restoreAdminIdentity();
    try {
      await api.adminTooling.impersonateEnd();
    } catch (err) {
      // Best-effort: even if the end call fails, client state is already
      // restored so the admin isn't stuck. Surface the error as a warning.
      toast.warning('Impersonation end may not have been logged', {
        message: err instanceof Error ? err.message : 'Session cleared locally',
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setActiveSession(null);
      localStorage.removeItem(SESSION_STORAGE_KEY);
      setEnding(false);
    }
  };

  const roleColor = (r: string): 'danger' | 'warning' | 'info' | 'default' => {
    if (r === 'superadmin') return 'danger';
    if (r === 'support_admin') return 'warning';
    if (r === 'admin') return 'info';
    return 'default';
  };

  const canImpersonate = (u: ImpersonatableUser): boolean => {
    const targetLevel = ROLE_LEVELS[u.role] ?? 0;
    return targetLevel < callerLevel && u.id !== currentUser?.id;
  };

  const status = statusFrom({ loading, error: error && users.length === 0 ? error : null, isEmpty: false });
  if (status !== 'success') {
    return (
      <AsyncPageContent
        status={status}
        error={error}
        onRetry={() => loadUsers()}
        errorTitle="Couldn't load users"
        loadingVariant="cards"
        loadingCount={4}
      >
        {null}
      </AsyncPageContent>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Active Impersonation Banner */}
      {activeSession && (
        <div
          className="border rounded-[var(--radius)] p-4 flex items-center justify-between"
          style={{ background: 'rgb(var(--accent-rgb) / 0.06)', borderColor: 'rgb(var(--accent-rgb) / 0.3)' }}
        >
          <div className="flex items-center gap-3">
            <Eye size={18} className="text-accent" />
            <div>
              <p className="text-sm font-medium text-accent">
                Viewing as {activeSession.userName} ({activeSession.userRole})
              </p>
              <p className="text-caption t-muted">
                {activeSession.userEmail} · Expires {new Date(activeSession.expiresAt).toLocaleTimeString()}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={endImpersonation} disabled={ending}>
            {ending ? <Loader2 size={12} className="animate-spin mr-1" /> : <LogOut size={12} className="mr-1" />}
            End Session
          </Button>
        </div>
      )}

      <PageHeader
        eyebrow="Access · Impersonation"
        title="User Impersonation"
        dek="View the platform as any user for debugging & support"
      />

      {/* Caution banner — high-emphasis amber strip (RAG warning) */}
      <div
        className="rounded-[var(--radius)] px-5 py-4 flex items-start gap-3"
        style={{
          background: 'rgb(var(--rag-watch-rgb) / 0.12)',
          border: '1px solid rgb(var(--rag-watch-rgb) / 0.34)',
        }}
      >
        <AlertTriangle size={18} style={{ color: 'var(--warning)' }} className="mt-0.5 shrink-0" />
        <div>
          <p
            className="text-label"
            style={{ color: 'var(--warning)', letterSpacing: '0.08em' }}
          >
            You are about to act as another user. Session start and end are audit-logged as impersonation events under your admin account.
          </p>
          <p className="text-xs t-muted mt-1">
            Sessions expire after 15 minutes. Actions taken while impersonating are recorded in the audit trail with your identity as the actor. You cannot impersonate users with equal or higher privilege than your own. Proceed with care.
          </p>
        </div>
      </div>

      {/* Two-column workspace: selection panel (left) + scope & audit (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
        {/* ── Left: User selection panel ── */}
        <section className="space-y-4">
          <p className="text-label">User Selection Panel</p>
          <h2 className="text-lg font-semibold t-primary -mt-2">Select User to Impersonate</h2>

          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 t-muted" />
            <input
              className="w-full pl-9 pr-3 py-2.5 rounded-[var(--radius)] border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary"
              placeholder="Search by name, email, or ID…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <p className="text-label">Results</p>

          {/* Users List */}
          {filteredUsers.length === 0 ? (
            <Card className="p-6 text-center">
              <p className="text-sm t-muted">No users found.</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {filteredUsers.map((u) => {
                const allowed = canImpersonate(u);
                return (
                  <Card
                    key={u.id}
                    className={`p-4 transition-colors ${allowed && activeSession === null ? 'card-prominent' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                          style={{ background: 'var(--accent-subtle)' }}
                        >
                          <User size={15} className="text-accent" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium t-primary truncate">{u.name}</p>
                          <p className="text-caption t-muted truncate">{u.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <Badge variant={roleColor(u.role)} className="text-caption font-mono">{u.role}</Badge>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setConfirmUser(u)}
                          disabled={!allowed || activeSession !== null}
                          className="text-xs"
                          title={
                            !allowed
                              ? u.id === currentUser?.id
                                ? 'You cannot impersonate yourself'
                                : 'Cannot impersonate a user with equal or higher privilege'
                              : activeSession
                                ? 'End the current session first'
                                : undefined
                          }
                        >
                          <Eye size={12} className="mr-1" /> View As
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Right: Scope, duration & audit panel ── */}
        <aside className="space-y-4 lg:sticky lg:top-4">
          <Card className="p-5 space-y-4">
            <p className="text-label">Scope &amp; Duration</p>

            <div>
              <p className="text-label mb-2" style={{ fontSize: '10px' }}>Impersonation Scope</p>
              <div
                className="rounded-[var(--radius)] px-3 py-2 text-sm font-medium t-primary"
                style={{ background: 'var(--accent-subtle)', border: '1px solid rgb(var(--accent-rgb) / 0.20)' }}
              >
                Full account view (read &amp; write, audited)
              </div>
            </div>

            <div>
              <p className="text-label mb-2" style={{ fontSize: '10px' }}>Session Duration</p>
              <div className="flex items-center gap-2 text-sm t-primary font-mono">
                <Clock size={13} className="text-accent" /> 15 minutes
              </div>
            </div>

            {activeSession && (
              <div className="pt-1">
                <p className="text-label mb-1" style={{ fontSize: '10px' }}>Session Expires</p>
                <p className="text-sm font-mono t-primary">
                  {new Date(activeSession.expiresAt).toLocaleTimeString()}
                </p>
              </div>
            )}
          </Card>

          <Card className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck size={15} className="text-accent shrink-0" />
              <p className="text-label">Audit &amp; Compliance Record</p>
            </div>
            <p className="text-xs t-muted leading-relaxed">
              Session start and end are written to the audit log with your identity as the actor,
              and actions you take during the session are attributed to your admin account.
              A justification note is not captured here yet — record your reason on the related
              support ticket before starting.
            </p>
          </Card>
        </aside>
      </div>

      {/* Confirmation Dialog */}
      {confirmUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setConfirmUser(null)}
        >
          <div
            className="bg-[var(--bg-modal)] backdrop-blur-xl rounded-[var(--radius)] border border-[var(--border-card)] max-w-md w-full mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'var(--accent-subtle)' }}>
                  <Eye size={18} className="text-accent" />
                </div>
                <div>
                  <h3 className="text-base font-semibold t-primary">Confirm Impersonation</h3>
                  <p className="text-xs t-muted">This action will be logged</p>
                </div>
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-label" style={{ fontSize: '10px' }}>User</span>
                  <span className="t-primary font-medium">{confirmUser.name}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-label" style={{ fontSize: '10px' }}>Email</span>
                  <span className="t-primary font-mono text-xs">{confirmUser.email}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-label" style={{ fontSize: '10px' }}>Role</span>
                  <Badge variant={roleColor(confirmUser.role)} className="font-mono">{confirmUser.role}</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-label" style={{ fontSize: '10px' }}>Duration</span>
                  <span className="t-primary flex items-center gap-1 font-mono"><Clock size={12} className="text-accent" /> 15 minutes</span>
                </div>
              </div>
            </div>
            {/* Action bar */}
            <div
              className="flex items-center justify-between gap-3 px-6 py-4"
              style={{ borderTop: '1px solid var(--border-card)', background: 'var(--bg-secondary)' }}
            >
              <p className="text-caption t-muted hidden sm:block max-w-[140px] leading-snug">
                By starting, you acknowledge accountability for all actions taken.
              </p>
              <div className="flex gap-2 ml-auto">
                <Button variant="outline" onClick={() => setConfirmUser(null)}>Cancel</Button>
                <Button onClick={() => startImpersonation(confirmUser)} disabled={impersonating} className="bg-accent hover:bg-[var(--accent-hover)] text-[var(--text-on-accent)]">
                  {impersonating ? <Loader2 size={14} className="animate-spin mr-1" /> : <Eye size={14} className="mr-1" />}
                  Start Session
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
