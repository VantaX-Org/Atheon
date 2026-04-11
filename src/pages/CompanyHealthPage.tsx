/**
 * ADMIN-003: Company Health Dashboard
 * Admin-only dashboard showing user adoption, catalyst utilization, AI usage, storage, entitlements.
 * Route: /company-health | Role: admin, support_admin, superadmin
 */
import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabPanel, useTabState } from '@/components/ui/tabs';
import {
  Users, BarChart3, Brain, HardDrive, Shield, Loader2,
  TrendingUp, TrendingDown, Activity, Zap, Clock,
} from 'lucide-react';

interface AdoptionMetric {
  label: string;
  value: number;
  total: number;
  trend: number;
}

interface CatalystUsage {
  name: string;
  runs: number;
  successRate: number;
  avgDuration: string;
  lastRun: string;
}

interface Entitlement {
  feature: string;
  allocated: number;
  used: number;
  unit: string;
}

export function CompanyHealthPage() {
  const { activeTab, setActiveTab } = useTabState('adoption');
  const [loading, setLoading] = useState(true);
  const [adoption, setAdoption] = useState<AdoptionMetric[]>([]);
  const [catalysts, setCatalysts] = useState<CatalystUsage[]>([]);
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    // Mock data — real API would call /api/admin/company-health
    setAdoption([
      { label: 'Daily Active Users', value: 28, total: 45, trend: 8.2 },
      { label: 'Weekly Active Users', value: 38, total: 45, trend: 4.1 },
      { label: 'Features Adopted', value: 12, total: 18, trend: 15.0 },
      { label: 'Avg Session Duration', value: 24, total: 60, trend: -3.2 },
    ]);
    setCatalysts([
      { name: 'Financial Reconciliation', runs: 142, successRate: 96.5, avgDuration: '4m 32s', lastRun: new Date(Date.now() - 3600000).toISOString() },
      { name: 'Procurement Analysis', runs: 87, successRate: 94.2, avgDuration: '6m 15s', lastRun: new Date(Date.now() - 7200000).toISOString() },
      { name: 'HR Compliance Check', runs: 56, successRate: 98.1, avgDuration: '2m 48s', lastRun: new Date(Date.now() - 14400000).toISOString() },
      { name: 'Supply Chain Monitor', runs: 234, successRate: 91.8, avgDuration: '8m 02s', lastRun: new Date(Date.now() - 1800000).toISOString() },
    ]);
    setEntitlements([
      { feature: 'Users', allocated: 50, used: 45, unit: 'seats' },
      { feature: 'Storage', allocated: 10, used: 3.2, unit: 'GB' },
      { feature: 'API Calls', allocated: 100000, used: 42500, unit: 'calls/mo' },
      { feature: 'Catalyst Runs', allocated: 500, used: 312, unit: 'runs/mo' },
      { feature: 'AI Queries', allocated: 10000, used: 4200, unit: 'queries/mo' },
      { feature: 'Integrations', allocated: 10, used: 4, unit: 'connections' },
    ]);
    setLoading(false);
  }

  const tabs = [
    { id: 'adoption', label: 'User Adoption', icon: <Users size={14} /> },
    { id: 'catalysts', label: 'Catalyst Usage', icon: <Zap size={14} /> },
    { id: 'ai-usage', label: 'AI Usage', icon: <Brain size={14} /> },
    { id: 'entitlements', label: 'Entitlements', icon: <Shield size={14} /> },
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
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
          <BarChart3 className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h1 className="text-lg font-semibold t-primary">Company Health</h1>
          <p className="text-xs t-muted">Your organization&apos;s platform utilization & health</p>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <Users size={14} className="text-accent" />
            <span className="text-[10px] t-muted uppercase">Active Users</span>
          </div>
          <p className="text-xl font-bold t-primary">28/45</p>
          <p className="text-[10px] text-emerald-400 flex items-center gap-0.5"><TrendingUp size={10} /> 62% adoption</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <Zap size={14} className="text-accent" />
            <span className="text-[10px] t-muted uppercase">Catalyst Runs</span>
          </div>
          <p className="text-xl font-bold t-primary">519</p>
          <p className="text-[10px] text-emerald-400 flex items-center gap-0.5"><TrendingUp size={10} /> This month</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <Brain size={14} className="text-accent" />
            <span className="text-[10px] t-muted uppercase">AI Queries</span>
          </div>
          <p className="text-xl font-bold t-primary">4.2k</p>
          <p className="text-[10px] t-muted">of 10k allocation</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <HardDrive size={14} className="text-accent" />
            <span className="text-[10px] t-muted uppercase">Storage</span>
          </div>
          <p className="text-xl font-bold t-primary">3.2 GB</p>
          <p className="text-[10px] t-muted">of 10 GB allocated</p>
        </Card>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <TabPanel id="adoption" activeTab={activeTab}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {adoption.map((m) => (
            <Card key={m.label} className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs t-muted">{m.label}</span>
                <span className={`text-[10px] flex items-center gap-0.5 ${m.trend >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {m.trend >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                  {Math.abs(m.trend)}%
                </span>
              </div>
              <p className="text-2xl font-bold t-primary">{m.value}<span className="text-sm t-muted">/{m.total}</span></p>
              <div className="mt-2 h-1.5 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(m.value / m.total) * 100}%` }} />
              </div>
            </Card>
          ))}
        </div>
      </TabPanel>

      <TabPanel id="catalysts" activeTab={activeTab}>
        <div className="space-y-2">
          {catalysts.map((c) => (
            <Card key={c.name} className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium t-primary">{c.name}</p>
                  <p className="text-[10px] t-muted flex items-center gap-1">
                    <Clock size={10} /> Last run: {new Date(c.lastRun).toLocaleString()} · Avg: {c.avgDuration}
                  </p>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <div className="text-right">
                    <p className="t-muted">Runs</p>
                    <p className="font-medium t-primary">{c.runs}</p>
                  </div>
                  <div className="text-right">
                    <p className="t-muted">Success</p>
                    <p className="font-medium" style={{ color: c.successRate >= 95 ? 'var(--accent)' : c.successRate >= 90 ? '#f59e0b' : '#ef4444' }}>{c.successRate}%</p>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </TabPanel>

      <TabPanel id="ai-usage" activeTab={activeTab}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Brain size={14} className="text-accent" />
              <span className="text-sm font-medium t-primary">Mind Queries</span>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="t-muted">Queries This Month</span><span className="t-primary font-medium">4,200</span></div>
              <div className="flex justify-between"><span className="t-muted">Avg Response Time</span><span className="t-primary font-medium">1.8s</span></div>
              <div className="flex justify-between"><span className="t-muted">Satisfaction Rate</span><span className="t-primary font-medium">87%</span></div>
              <div className="flex justify-between"><span className="t-muted">Token Usage</span><span className="t-primary font-medium">2.1M tokens</span></div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Activity size={14} className="text-accent" />
              <span className="text-sm font-medium t-primary">Chat Sessions</span>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="t-muted">Total Sessions</span><span className="t-primary font-medium">892</span></div>
              <div className="flex justify-between"><span className="t-muted">Avg Messages/Session</span><span className="t-primary font-medium">6.4</span></div>
              <div className="flex justify-between"><span className="t-muted">Unique Users</span><span className="t-primary font-medium">34</span></div>
              <div className="flex justify-between"><span className="t-muted">Top Intent</span><span className="t-primary font-medium">Data Analysis</span></div>
            </div>
          </Card>
        </div>
      </TabPanel>

      <TabPanel id="entitlements" activeTab={activeTab}>
        <div className="space-y-2">
          {entitlements.map((e) => {
            const pct = (e.used / e.allocated) * 100;
            const barColor = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : 'var(--accent)';
            return (
              <Card key={e.feature} className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium t-primary">{e.feature}</span>
                  <span className="text-xs t-muted">{e.used.toLocaleString()} / {e.allocated.toLocaleString()} {e.unit}</span>
                </div>
                <div className="h-2 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] t-muted">{pct.toFixed(0)}% used</span>
                  {pct >= 90 && <Badge variant="danger" className="text-[10px]">Near limit</Badge>}
                  {pct >= 70 && pct < 90 && <Badge variant="warning" className="text-[10px]">Moderate</Badge>}
                </div>
              </Card>
            );
          })}
        </div>
      </TabPanel>
    </div>
  );
}
