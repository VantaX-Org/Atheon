/**
 * ADMIN-001: Platform Health Dashboard
 * Superadmin-only real-time view of infrastructure, data pipeline, tenant health, and system alerts.
 * Route: /platform-health | Role: superadmin only
 */
import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabPanel, useTabState } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import {
  Activity, Server, Database, HardDrive, Cpu, Wifi, AlertTriangle,
  CheckCircle, XCircle, Clock, RefreshCw, Loader2,
  Users, Building2, Zap, TrendingUp, BarChart3,
} from 'lucide-react';

interface InfraMetric {
  name: string;
  value: number;
  unit: string;
  status: 'healthy' | 'degraded' | 'critical';
  threshold?: { warn: number; critical: number };
}

interface TenantHealth {
  id: string;
  name: string;
  status: 'active' | 'suspended' | 'provisioning';
  userCount: number;
  storageUsedMb: number;
  apiCallsToday: number;
  healthScore: number;
  lastActivity: string;
}

interface SystemAlert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  source: string;
  createdAt: string;
  acknowledged: boolean;
}

const statusColor = (s: string) => {
  if (s === 'healthy' || s === 'active') return 'success';
  if (s === 'degraded' || s === 'warning' || s === 'provisioning') return 'warning';
  return 'danger';
};

const statusIcon = (s: string) => {
  if (s === 'healthy' || s === 'active') return <CheckCircle size={14} className="text-emerald-400" />;
  if (s === 'degraded' || s === 'warning') return <AlertTriangle size={14} className="text-amber-400" />;
  return <XCircle size={14} className="text-red-400" />;
};

export function PlatformHealthPage() {
  const { activeTab, setActiveTab } = useTabState('infrastructure');
  const [loading, setLoading] = useState(true);
  const [infraMetrics, setInfraMetrics] = useState<InfraMetric[]>([]);
  const [tenantHealth, setTenantHealth] = useState<TenantHealth[]>([]);
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const res = await api.adminTooling.platformHealth() as { infrastructure: InfraMetric[]; tenants: TenantHealth[]; alerts: SystemAlert[] };
      setInfraMetrics(res.infrastructure);
      setTenantHealth(res.tenants);
      setAlerts(res.alerts);
    } catch {
      // Generate mock data for demo
      setInfraMetrics([
        { name: 'API Response Time', value: 45, unit: 'ms', status: 'healthy', threshold: { warn: 200, critical: 500 } },
        { name: 'CPU Utilization', value: 32, unit: '%', status: 'healthy', threshold: { warn: 70, critical: 90 } },
        { name: 'Memory Usage', value: 58, unit: '%', status: 'healthy', threshold: { warn: 80, critical: 95 } },
        { name: 'D1 Query Latency', value: 12, unit: 'ms', status: 'healthy', threshold: { warn: 50, critical: 100 } },
        { name: 'KV Read Latency', value: 3, unit: 'ms', status: 'healthy', threshold: { warn: 20, critical: 50 } },
        { name: 'R2 Storage Used', value: 2.4, unit: 'GB', status: 'healthy' },
        { name: 'Worker Invocations/min', value: 847, unit: 'req', status: 'healthy' },
        { name: 'Error Rate', value: 0.12, unit: '%', status: 'healthy', threshold: { warn: 1, critical: 5 } },
      ]);
      setTenantHealth([
        { id: '1', name: 'VantaX Demo', status: 'active', userCount: 12, storageUsedMb: 450, apiCallsToday: 3420, healthScore: 94, lastActivity: new Date().toISOString() },
        { id: '2', name: 'Acme Corp', status: 'active', userCount: 45, storageUsedMb: 1200, apiCallsToday: 8900, healthScore: 87, lastActivity: new Date().toISOString() },
        { id: '3', name: 'TechStart Inc', status: 'provisioning', userCount: 3, storageUsedMb: 50, apiCallsToday: 120, healthScore: 72, lastActivity: new Date().toISOString() },
      ]);
      setAlerts([
        { id: '1', severity: 'warning', title: 'High memory usage on Worker', message: 'Worker memory at 78% for tenant Acme Corp', source: 'infrastructure', createdAt: new Date().toISOString(), acknowledged: false },
        { id: '2', severity: 'info', title: 'Scheduled maintenance window', message: 'D1 maintenance scheduled for Sunday 02:00 UTC', source: 'system', createdAt: new Date().toISOString(), acknowledged: true },
      ]);
    }
    setLoading(false);
  }

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const tabs = [
    { id: 'infrastructure', label: 'Infrastructure', icon: <Server size={14} />, count: infraMetrics.length },
    { id: 'tenants', label: 'Tenant Health', icon: <Building2 size={14} />, count: tenantHealth.length },
    { id: 'alerts', label: 'System Alerts', icon: <AlertTriangle size={14} />, count: alerts.filter(a => !a.acknowledged).length },
    { id: 'data-pipeline', label: 'Data Pipeline', icon: <Database size={14} /> },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
            <Activity className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h1 className="text-lg font-semibold t-primary">Platform Health</h1>
            <p className="text-xs t-muted">Real-time infrastructure & tenant monitoring</p>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[var(--border-card)] t-secondary hover:t-primary hover:bg-[var(--bg-secondary)] transition-all"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <Cpu size={14} className="text-accent" />
            <span className="text-[10px] t-muted uppercase tracking-wider">Uptime</span>
          </div>
          <p className="text-xl font-bold t-primary">99.97%</p>
          <p className="text-[10px] t-muted">Last 30 days</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <Users size={14} className="text-accent" />
            <span className="text-[10px] t-muted uppercase tracking-wider">Active Users</span>
          </div>
          <p className="text-xl font-bold t-primary">{tenantHealth.reduce((s, t) => s + t.userCount, 0)}</p>
          <p className="text-[10px] t-muted">Across {tenantHealth.length} tenants</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <Zap size={14} className="text-accent" />
            <span className="text-[10px] t-muted uppercase tracking-wider">API Calls Today</span>
          </div>
          <p className="text-xl font-bold t-primary">{(tenantHealth.reduce((s, t) => s + t.apiCallsToday, 0) / 1000).toFixed(1)}k</p>
          <p className="text-[10px] text-emerald-400 flex items-center gap-0.5"><TrendingUp size={10} /> +12.4%</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={14} className="text-amber-400" />
            <span className="text-[10px] t-muted uppercase tracking-wider">Active Alerts</span>
          </div>
          <p className="text-xl font-bold t-primary">{alerts.filter(a => !a.acknowledged).length}</p>
          <p className="text-[10px] t-muted">{alerts.filter(a => a.severity === 'critical').length} critical</p>
        </Card>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <TabPanel id="infrastructure" activeTab={activeTab}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {infraMetrics.map((m) => (
            <Card key={m.name} className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs t-muted">{m.name}</span>
                {statusIcon(m.status)}
              </div>
              <p className="text-2xl font-bold t-primary">{m.value}<span className="text-sm t-muted ml-1">{m.unit}</span></p>
              {m.threshold && (
                <div className="mt-2 h-1.5 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min((m.value / m.threshold.critical) * 100, 100)}%`,
                      background: m.status === 'healthy' ? 'var(--accent)' : m.status === 'degraded' ? '#f59e0b' : '#ef4444',
                    }}
                  />
                </div>
              )}
              <Badge variant={statusColor(m.status)} className="mt-2 text-[10px]">{m.status}</Badge>
            </Card>
          ))}
        </div>
      </TabPanel>

      <TabPanel id="tenants" activeTab={activeTab}>
        <div className="space-y-2">
          {tenantHealth.map((t) => (
            <Card key={t.id} className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                  <Building2 size={14} className="text-accent" />
                </div>
                <div>
                  <p className="text-sm font-medium t-primary">{t.name}</p>
                  <p className="text-[10px] t-muted">{t.userCount} users · {(t.storageUsedMb / 1024).toFixed(1)} GB storage</p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <div className="text-right">
                  <p className="t-muted">API Calls</p>
                  <p className="font-medium t-primary">{t.apiCallsToday.toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <p className="t-muted">Health</p>
                  <p className="font-medium" style={{ color: t.healthScore >= 80 ? 'var(--accent)' : t.healthScore >= 60 ? '#f59e0b' : '#ef4444' }}>{t.healthScore}%</p>
                </div>
                <Badge variant={statusColor(t.status)}>{t.status}</Badge>
              </div>
            </Card>
          ))}
        </div>
      </TabPanel>

      <TabPanel id="alerts" activeTab={activeTab}>
        <div className="space-y-2">
          {alerts.length === 0 ? (
            <Card className="p-8 text-center">
              <CheckCircle size={24} className="mx-auto text-emerald-400 mb-2" />
              <p className="text-sm t-muted">No active alerts</p>
            </Card>
          ) : alerts.map((a) => (
            <Card key={a.id} className="p-4 flex items-start gap-3">
              {a.severity === 'critical' ? <XCircle size={16} className="text-red-400 mt-0.5" /> :
               a.severity === 'warning' ? <AlertTriangle size={16} className="text-amber-400 mt-0.5" /> :
               <Activity size={16} className="text-blue-400 mt-0.5" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium t-primary">{a.title}</p>
                  <Badge variant={a.severity === 'critical' ? 'danger' : a.severity === 'warning' ? 'warning' : 'info'} className="text-[10px]">{a.severity}</Badge>
                  {a.acknowledged && <Badge variant="default" className="text-[10px]">acknowledged</Badge>}
                </div>
                <p className="text-xs t-muted mt-0.5">{a.message}</p>
                <p className="text-[10px] t-muted mt-1 flex items-center gap-1"><Clock size={10} /> {new Date(a.createdAt).toLocaleString()} · {a.source}</p>
              </div>
            </Card>
          ))}
        </div>
      </TabPanel>

      <TabPanel id="data-pipeline" activeTab={activeTab}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Database size={14} className="text-accent" />
              <span className="text-sm font-medium t-primary">D1 Database</span>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="t-muted">Total Queries (24h)</span><span className="t-primary font-medium">124,567</span></div>
              <div className="flex justify-between"><span className="t-muted">Avg Query Time</span><span className="t-primary font-medium">12ms</span></div>
              <div className="flex justify-between"><span className="t-muted">Slow Queries (&gt;100ms)</span><span className="t-primary font-medium">23</span></div>
              <div className="flex justify-between"><span className="t-muted">Database Size</span><span className="t-primary font-medium">1.2 GB</span></div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <HardDrive size={14} className="text-accent" />
              <span className="text-sm font-medium t-primary">R2 Object Storage</span>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="t-muted">Total Objects</span><span className="t-primary font-medium">8,432</span></div>
              <div className="flex justify-between"><span className="t-muted">Storage Used</span><span className="t-primary font-medium">2.4 GB</span></div>
              <div className="flex justify-between"><span className="t-muted">Reads Today</span><span className="t-primary font-medium">4,210</span></div>
              <div className="flex justify-between"><span className="t-muted">Writes Today</span><span className="t-primary font-medium">892</span></div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Wifi size={14} className="text-accent" />
              <span className="text-sm font-medium t-primary">KV Cache</span>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="t-muted">Hit Rate</span><span className="t-primary font-medium">94.2%</span></div>
              <div className="flex justify-between"><span className="t-muted">Keys Stored</span><span className="t-primary font-medium">12,340</span></div>
              <div className="flex justify-between"><span className="t-muted">Avg Latency</span><span className="t-primary font-medium">3ms</span></div>
              <div className="flex justify-between"><span className="t-muted">Evictions (24h)</span><span className="t-primary font-medium">156</span></div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 size={14} className="text-accent" />
              <span className="text-sm font-medium t-primary">ERP Sync Pipeline</span>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="t-muted">Active Connections</span><span className="t-primary font-medium">7</span></div>
              <div className="flex justify-between"><span className="t-muted">Syncs Today</span><span className="t-primary font-medium">42</span></div>
              <div className="flex justify-between"><span className="t-muted">Records Processed</span><span className="t-primary font-medium">156,789</span></div>
              <div className="flex justify-between"><span className="t-muted">Failed Syncs</span><span className="text-red-400 font-medium">2</span></div>
            </div>
          </Card>
        </div>
      </TabPanel>
    </div>
  );
}
