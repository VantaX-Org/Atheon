/**
 * ADMIN-004: User Impersonation
 * Support/superadmin can "View as [user]" with 15-min time-limited token.
 * Route: /impersonate | Role: superadmin, support_admin
 */
import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/appStore';
import {
  Eye, Search, Clock, AlertTriangle, Loader2,
  User, LogOut,
} from 'lucide-react';

interface ImpersonatableUser {
  id: string;
  name: string;
  email: string;
  role: string;
  tenantName: string;
  tenantId: string;
  lastLogin: string;
  status: 'active' | 'suspended' | 'invited';
}

interface ImpersonationSession {
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  tenantName: string;
  expiresAt: string;
  startedAt: string;
}

export function ImpersonationPage() {
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState<ImpersonatableUser[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<ImpersonatableUser[]>([]);
  const [activeSession, setActiveSession] = useState<ImpersonationSession | null>(null);
  const [confirmUser, setConfirmUser] = useState<ImpersonatableUser | null>(null);
  const [impersonating, setImpersonating] = useState(false);
  useAppStore((s) => s.user);

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredUsers(users);
    } else {
      const q = searchQuery.toLowerCase();
      setFilteredUsers(users.filter(u =>
        u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) ||
        u.tenantName.toLowerCase().includes(q) || u.role.toLowerCase().includes(q)
      ));
    }
  }, [searchQuery, users]);

  async function loadUsers() {
    setLoading(true);
    // Mock data — real API would fetch cross-tenant users
    setUsers([
      { id: '1', name: 'John Smith', email: 'john@acme.com', role: 'admin', tenantName: 'Acme Corp', tenantId: 't1', lastLogin: new Date(Date.now() - 3600000).toISOString(), status: 'active' },
      { id: '2', name: 'Sarah Connor', email: 'sarah@acme.com', role: 'manager', tenantName: 'Acme Corp', tenantId: 't1', lastLogin: new Date(Date.now() - 86400000).toISOString(), status: 'active' },
      { id: '3', name: 'Mike Davis', email: 'mike@techstart.io', role: 'analyst', tenantName: 'TechStart Inc', tenantId: 't2', lastLogin: new Date(Date.now() - 172800000).toISOString(), status: 'active' },
      { id: '4', name: 'Emily Chen', email: 'emily@vantax.co.za', role: 'executive', tenantName: 'VantaX Demo', tenantId: 't3', lastLogin: new Date().toISOString(), status: 'active' },
      { id: '5', name: 'James Wilson', email: 'james@acme.com', role: 'operator', tenantName: 'Acme Corp', tenantId: 't1', lastLogin: new Date(Date.now() - 604800000).toISOString(), status: 'suspended' },
    ]);
    setLoading(false);
  }

  const startImpersonation = async (user: ImpersonatableUser) => {
    setImpersonating(true);
    // Simulate API call to create impersonation token
    await new Promise(r => setTimeout(r, 1000));
    setActiveSession({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      userRole: user.role,
      tenantName: user.tenantName,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      startedAt: new Date().toISOString(),
    });
    setConfirmUser(null);
    setImpersonating(false);
  };

  const endImpersonation = () => {
    setActiveSession(null);
  };

  const roleColor = (r: string) => {
    if (r === 'superadmin') return 'danger';
    if (r === 'support_admin') return 'warning';
    if (r === 'admin') return 'info';
    return 'default';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Impersonation Banner */}
      {activeSession && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Eye size={18} className="text-amber-400" />
            <div>
              <p className="text-sm font-medium text-amber-400">
                Viewing as {activeSession.userName} ({activeSession.userRole})
              </p>
              <p className="text-[10px] t-muted">
                {activeSession.tenantName} · Expires {new Date(activeSession.expiresAt).toLocaleTimeString()}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={endImpersonation} className="text-amber-400 border-amber-500/30">
            <LogOut size={12} className="mr-1" /> End Session
          </Button>
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
          <Eye className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h1 className="text-lg font-semibold t-primary">User Impersonation</h1>
          <p className="text-xs t-muted">View the platform as any user for debugging & support</p>
        </div>
      </div>

      {/* Warning */}
      <Card className="p-4 border-amber-500/20 bg-amber-500/5">
        <div className="flex items-start gap-2">
          <AlertTriangle size={14} className="text-amber-400 mt-0.5" />
          <div className="text-xs">
            <p className="font-medium t-primary">Impersonation sessions are time-limited and fully audited</p>
            <p className="t-muted mt-0.5">Sessions expire after 15 minutes. All actions taken while impersonating are logged in the audit trail with the impersonating admin&apos;s identity.</p>
          </div>
        </div>
      </Card>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 t-muted" />
        <input
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary"
          placeholder="Search users by name, email, role, or tenant..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Users List */}
      <div className="space-y-2">
        {filteredUsers.map((u) => (
          <Card key={u.id} className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center">
                  <User size={14} className="text-accent" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium t-primary">{u.name}</p>
                    <Badge variant={roleColor(u.role)} className="text-[10px]">{u.role}</Badge>
                    {u.status === 'suspended' && <Badge variant="danger" className="text-[10px]">suspended</Badge>}
                  </div>
                  <p className="text-[10px] t-muted">{u.email} · {u.tenantName}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right text-[10px] t-muted">
                  <p>Last login</p>
                  <p>{new Date(u.lastLogin).toLocaleDateString()}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmUser(u)}
                  disabled={u.status === 'suspended' || activeSession !== null}
                  className="text-xs"
                >
                  <Eye size={12} className="mr-1" /> View As
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Confirmation Dialog */}
      {confirmUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmUser(null)}>
          <div className="bg-[var(--bg-modal)] rounded-xl border border-[var(--border-card)] p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                <Eye size={18} className="text-amber-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold t-primary">Confirm Impersonation</h3>
                <p className="text-xs t-muted">This action will be logged</p>
              </div>
            </div>
            <div className="space-y-2 text-sm mb-4">
              <div className="flex justify-between"><span className="t-muted">User:</span><span className="t-primary">{confirmUser.name}</span></div>
              <div className="flex justify-between"><span className="t-muted">Email:</span><span className="t-primary">{confirmUser.email}</span></div>
              <div className="flex justify-between"><span className="t-muted">Role:</span><Badge variant={roleColor(confirmUser.role)}>{confirmUser.role}</Badge></div>
              <div className="flex justify-between"><span className="t-muted">Tenant:</span><span className="t-primary">{confirmUser.tenantName}</span></div>
              <div className="flex justify-between"><span className="t-muted">Duration:</span><span className="t-primary flex items-center gap-1"><Clock size={12} /> 15 minutes</span></div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setConfirmUser(null)} className="flex-1">Cancel</Button>
              <Button onClick={() => startImpersonation(confirmUser)} disabled={impersonating} className="flex-1 bg-amber-500 hover:bg-amber-600 text-black">
                {impersonating ? <Loader2 size={14} className="animate-spin mr-1" /> : <Eye size={14} className="mr-1" />}
                Start Session
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
