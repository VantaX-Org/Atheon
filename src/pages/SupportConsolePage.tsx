/**
 * ADMIN-002: Support Console
 * Support admin console with tenant search, dashboard, quick actions, and activity timeline.
 * Route: /support | Role: superadmin, support_admin
 */
import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabPanel, useTabState } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import type { Tenant } from '@/lib/api';
import {
  Search, Building2, Users, Activity, Shield, Eye,
  AlertTriangle, Loader2, RefreshCw, MessageSquare,
  FileText, Settings, ArrowRight, ExternalLink, User,
} from 'lucide-react';

interface SupportTicket {
  id: string;
  tenantName: string;
  subject: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: 'critical' | 'high' | 'medium' | 'low';
  createdAt: string;
  assignee?: string;
}

interface ActivityEvent {
  id: string;
  type: 'login' | 'config_change' | 'error' | 'support_action' | 'user_created';
  description: string;
  tenantName?: string;
  userName?: string;
  timestamp: string;
}

export function SupportConsolePage() {
  const { activeTab, setActiveTab } = useTabState('search');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [filteredTenants, setFilteredTenants] = useState<Tenant[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredTenants(tenants);
    } else {
      const q = searchQuery.toLowerCase();
      setFilteredTenants(tenants.filter(t =>
        t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q) || t.id.includes(q)
      ));
    }
  }, [searchQuery, tenants]);

  async function loadData() {
    setLoading(true);
    try {
      const res = await api.tenants.list();
      setTenants(res.tenants);
      setFilteredTenants(res.tenants);
    } catch { /* empty */ }

    // Mock support data
    setTickets([
      { id: 'T-001', tenantName: 'Acme Corp', subject: 'SSO integration failing', status: 'open', priority: 'high', createdAt: new Date(Date.now() - 3600000).toISOString() },
      { id: 'T-002', tenantName: 'VantaX Demo', subject: 'Data export timeout', status: 'in_progress', priority: 'medium', createdAt: new Date(Date.now() - 86400000).toISOString(), assignee: 'Support Team' },
      { id: 'T-003', tenantName: 'TechStart Inc', subject: 'User cannot login', status: 'resolved', priority: 'low', createdAt: new Date(Date.now() - 172800000).toISOString() },
    ]);
    setActivities([
      { id: '1', type: 'login', description: 'User logged in', tenantName: 'VantaX Demo', userName: 'admin@vantax.co.za', timestamp: new Date().toISOString() },
      { id: '2', type: 'config_change', description: 'Updated entitlements', tenantName: 'Acme Corp', timestamp: new Date(Date.now() - 1800000).toISOString() },
      { id: '3', type: 'error', description: 'ERP sync failed — connection timeout', tenantName: 'TechStart Inc', timestamp: new Date(Date.now() - 7200000).toISOString() },
      { id: '4', type: 'user_created', description: 'New user provisioned', tenantName: 'VantaX Demo', userName: 'analyst@vantax.co.za', timestamp: new Date(Date.now() - 14400000).toISOString() },
      { id: '5', type: 'support_action', description: 'Password reset for user', tenantName: 'Acme Corp', userName: 'john@acme.com', timestamp: new Date(Date.now() - 28800000).toISOString() },
    ]);
    setLoading(false);
  }

  const tabs = [
    { id: 'search', label: 'Tenant Search', icon: <Search size={14} /> },
    { id: 'tickets', label: 'Tickets', icon: <MessageSquare size={14} />, count: tickets.filter(t => t.status === 'open').length },
    { id: 'activity', label: 'Activity', icon: <Activity size={14} /> },
    { id: 'quick-actions', label: 'Quick Actions', icon: <Settings size={14} /> },
  ];

  const priorityColor = (p: string) => p === 'critical' ? 'danger' : p === 'high' ? 'warning' : p === 'medium' ? 'info' : 'default';
  const ticketStatusColor = (s: string) => s === 'open' ? 'warning' : s === 'in_progress' ? 'info' : s === 'resolved' ? 'success' : 'default';

  const activityIcon = (type: string) => {
    switch (type) {
      case 'login': return <User size={12} className="text-accent" />;
      case 'config_change': return <Settings size={12} className="text-amber-400" />;
      case 'error': return <AlertTriangle size={12} className="text-red-400" />;
      case 'support_action': return <Shield size={12} className="text-blue-400" />;
      case 'user_created': return <Users size={12} className="text-emerald-400" />;
      default: return <Activity size={12} className="t-muted" />;
    }
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
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
          <Shield className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h1 className="text-lg font-semibold t-primary">Support Console</h1>
          <p className="text-xs t-muted">Cross-tenant support tools & activity monitoring</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3">
          <p className="text-[10px] t-muted uppercase">Total Tenants</p>
          <p className="text-xl font-bold t-primary">{tenants.length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] t-muted uppercase">Open Tickets</p>
          <p className="text-xl font-bold text-amber-400">{tickets.filter(t => t.status === 'open').length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] t-muted uppercase">Active Today</p>
          <p className="text-xl font-bold t-primary">{tenants.filter(t => t.status === 'active').length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] t-muted uppercase">Recent Events</p>
          <p className="text-xl font-bold t-primary">{activities.length}</p>
        </Card>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <TabPanel id="search" activeTab={activeTab}>
        <div className="space-y-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 t-muted" />
            <input
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary"
              placeholder="Search by tenant name, slug, or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            {filteredTenants.map((t) => (
              <Card key={t.id} className="p-4 hover:bg-[var(--bg-secondary)] transition-colors cursor-pointer" onClick={() => setSelectedTenant(t)}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Building2 size={16} className="text-accent" />
                    <div>
                      <p className="text-sm font-medium t-primary">{t.name}</p>
                      <p className="text-[10px] t-muted">{t.slug} · {t.industry} · {t.plan}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={t.status === 'active' ? 'success' : t.status === 'suspended' ? 'danger' : 'warning'}>{t.status}</Badge>
                    <ArrowRight size={14} className="t-muted" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </TabPanel>

      <TabPanel id="tickets" activeTab={activeTab}>
        <div className="space-y-2">
          {tickets.map((t) => (
            <Card key={t.id} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono t-muted">{t.id}</span>
                    <Badge variant={priorityColor(t.priority)} className="text-[10px]">{t.priority}</Badge>
                    <Badge variant={ticketStatusColor(t.status)} className="text-[10px]">{t.status.replace('_', ' ')}</Badge>
                  </div>
                  <p className="text-sm font-medium t-primary mt-1">{t.subject}</p>
                  <p className="text-[10px] t-muted mt-0.5">{t.tenantName} · {new Date(t.createdAt).toLocaleString()}</p>
                </div>
                {t.assignee && <span className="text-[10px] t-muted">{t.assignee}</span>}
              </div>
            </Card>
          ))}
        </div>
      </TabPanel>

      <TabPanel id="activity" activeTab={activeTab}>
        <div className="space-y-1">
          {activities.map((a) => (
            <div key={a.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-[var(--bg-secondary)] transition-colors">
              <div className="w-6 h-6 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center mt-0.5">
                {activityIcon(a.type)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs t-primary">{a.description}</p>
                <p className="text-[10px] t-muted">
                  {a.tenantName && <span>{a.tenantName}</span>}
                  {a.userName && <span> · {a.userName}</span>}
                  <span> · {new Date(a.timestamp).toLocaleString()}</span>
                </p>
              </div>
            </div>
          ))}
        </div>
      </TabPanel>

      <TabPanel id="quick-actions" activeTab={activeTab}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { icon: <Eye size={16} />, title: 'View as User', desc: 'Impersonate a user to see their view (ADMIN-004)', action: 'impersonate' },
            { icon: <RefreshCw size={16} />, title: 'Force Password Reset', desc: 'Reset a user password and send notification', action: 'reset' },
            { icon: <Users size={16} />, title: 'Bulk User Import', desc: 'Import users via CSV for a tenant (ADMIN-005)', action: 'bulk' },
            { icon: <FileText size={16} />, title: 'Export Tenant Data', desc: 'Export all tenant data as CSV/JSON', action: 'export' },
            { icon: <Shield size={16} />, title: 'Suspend Tenant', desc: 'Temporarily suspend a tenant account', action: 'suspend' },
            { icon: <ExternalLink size={16} />, title: 'View Audit Log', desc: 'View detailed audit trail for a tenant', action: 'audit' },
          ].map((qa) => (
            <Card key={qa.action} className="p-4 hover:bg-[var(--bg-secondary)] transition-colors cursor-pointer">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center text-accent">
                  {qa.icon}
                </div>
                <div>
                  <p className="text-sm font-medium t-primary">{qa.title}</p>
                  <p className="text-[10px] t-muted">{qa.desc}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </TabPanel>

      {/* Tenant Detail Modal */}
      {selectedTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setSelectedTenant(null)}>
          <div className="bg-[var(--bg-modal)] rounded-xl border border-[var(--border-card)] p-6 max-w-lg w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold t-primary">{selectedTenant.name}</h3>
              <button onClick={() => setSelectedTenant(null)} className="t-muted hover:t-primary">×</button>
            </div>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="t-muted text-xs">ID:</span><p className="font-mono text-[11px] t-primary">{selectedTenant.id}</p></div>
                <div><span className="t-muted text-xs">Slug:</span><p className="t-primary">{selectedTenant.slug}</p></div>
                <div><span className="t-muted text-xs">Industry:</span><p className="t-primary">{selectedTenant.industry}</p></div>
                <div><span className="t-muted text-xs">Plan:</span><Badge variant="info">{selectedTenant.plan}</Badge></div>
                <div><span className="t-muted text-xs">Status:</span><Badge variant={selectedTenant.status === 'active' ? 'success' : 'warning'}>{selectedTenant.status}</Badge></div>
                <div><span className="t-muted text-xs">Region:</span><p className="t-primary">{selectedTenant.region}</p></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
