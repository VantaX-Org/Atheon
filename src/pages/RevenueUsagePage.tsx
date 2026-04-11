/**
 * ADMIN-007: Revenue & Usage Dashboard
 * Superadmin /revenue route with MRR/ARR, plan distribution, usage heatmap, growth metrics.
 * Route: /revenue | Role: superadmin only
 */
import 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabPanel, useTabState } from '@/components/ui/tabs';
import {
  DollarSign, TrendingUp, TrendingDown,
  PieChart, Activity,
  Building2, CreditCard,
} from 'lucide-react';

interface RevenueMetric {
  label: string;
  value: string;
  change: number;
  period: string;
}

interface PlanDistribution {
  plan: string;
  count: number;
  revenue: number;
  color: string;
}

interface GrowthMetric {
  month: string;
  mrr: number;
  tenants: number;
  users: number;
}

export function RevenueUsagePage() {
  const { activeTab, setActiveTab } = useTabState('overview');

  const metrics: RevenueMetric[] = [
    { label: 'Monthly Recurring Revenue', value: '$24,500', change: 12.4, period: 'vs last month' },
    { label: 'Annual Run Rate', value: '$294,000', change: 18.2, period: 'vs last year' },
    { label: 'Avg Revenue Per Tenant', value: '$3,500', change: 5.1, period: 'vs last month' },
    { label: 'Churn Rate', value: '2.1%', change: -0.8, period: 'vs last month' },
  ];

  const plans: PlanDistribution[] = [
    { plan: 'Enterprise', count: 3, revenue: 15000, color: '#818cf8' },
    { plan: 'Professional', count: 5, revenue: 7500, color: '#3b82f6' },
    { plan: 'Starter', count: 4, revenue: 2000, color: '#10b981' },
    { plan: 'Trial', count: 2, revenue: 0, color: '#6b7280' },
  ];

  const growth: GrowthMetric[] = [
    { month: 'Oct', mrr: 18200, tenants: 8, users: 45 },
    { month: 'Nov', mrr: 19800, tenants: 9, users: 52 },
    { month: 'Dec', mrr: 20500, tenants: 10, users: 58 },
    { month: 'Jan', mrr: 21800, tenants: 11, users: 64 },
    { month: 'Feb', mrr: 23100, tenants: 12, users: 72 },
    { month: 'Mar', mrr: 24500, tenants: 14, users: 80 },
  ];

  const totalRevenue = plans.reduce((s, p) => s + p.revenue, 0);

  const tabs = [
    { id: 'overview', label: 'Overview', icon: <DollarSign size={14} /> },
    { id: 'plans', label: 'Plan Distribution', icon: <PieChart size={14} /> },
    { id: 'growth', label: 'Growth Trends', icon: <TrendingUp size={14} /> },
    { id: 'usage', label: 'Usage Heatmap', icon: <Activity size={14} /> },
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
          <DollarSign className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h1 className="text-lg font-semibold t-primary">Revenue & Usage</h1>
          <p className="text-xs t-muted">Platform revenue metrics, plan distribution, and growth analytics</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {metrics.map((m) => (
          <Card key={m.label} className="p-3">
            <p className="text-[10px] t-muted uppercase tracking-wider">{m.label}</p>
            <p className="text-xl font-bold t-primary mt-1">{m.value}</p>
            <p className={`text-[10px] flex items-center gap-0.5 mt-0.5 ${m.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {m.change >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
              {m.change >= 0 ? '+' : ''}{m.change}% {m.period}
            </p>
          </Card>
        ))}
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <TabPanel id="overview" activeTab={activeTab}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="text-sm font-medium t-primary mb-3 flex items-center gap-2"><CreditCard size={14} className="text-accent" /> Revenue Breakdown</h3>
            <div className="space-y-3">
              {plans.map((p) => (
                <div key={p.plan} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                    <span className="text-xs t-primary">{p.plan}</span>
                    <Badge variant="default" className="text-[10px]">{p.count} tenants</Badge>
                  </div>
                  <span className="text-xs font-medium t-primary">${p.revenue.toLocaleString()}/mo</span>
                </div>
              ))}
              <div className="border-t border-[var(--border-card)] pt-2 flex justify-between">
                <span className="text-xs font-medium t-primary">Total MRR</span>
                <span className="text-sm font-bold text-accent">${totalRevenue.toLocaleString()}/mo</span>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <h3 className="text-sm font-medium t-primary mb-3 flex items-center gap-2"><Building2 size={14} className="text-accent" /> Top Tenants by Revenue</h3>
            <div className="space-y-2">
              {[
                { name: 'Acme Corp', plan: 'Enterprise', mrr: 5000 },
                { name: 'TechStart Inc', plan: 'Enterprise', mrr: 5000 },
                { name: 'Global Logistics', plan: 'Enterprise', mrr: 5000 },
                { name: 'HealthCo', plan: 'Professional', mrr: 1500 },
                { name: 'VantaX Demo', plan: 'Professional', mrr: 1500 },
              ].map((t, i) => (
                <div key={t.name} className="flex items-center justify-between p-2 rounded-lg hover:bg-[var(--bg-secondary)]">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] t-muted w-4">{i + 1}.</span>
                    <span className="text-xs t-primary">{t.name}</span>
                    <Badge variant="default" className="text-[10px]">{t.plan}</Badge>
                  </div>
                  <span className="text-xs font-medium text-accent">${t.mrr.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </TabPanel>

      <TabPanel id="plans" activeTab={activeTab}>
        <Card className="p-4">
          <h3 className="text-sm font-medium t-primary mb-4">Plan Distribution</h3>
          <div className="flex items-center gap-6">
            {/* Simple bar chart */}
            <div className="flex-1 space-y-3">
              {plans.map((p) => {
                const totalTenants = plans.reduce((s, pl) => s + pl.count, 0);
                const pct = (p.count / totalTenants) * 100;
                return (
                  <div key={p.plan}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="t-primary font-medium">{p.plan}</span>
                      <span className="t-muted">{p.count} tenants ({pct.toFixed(0)}%)</span>
                    </div>
                    <div className="h-3 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: p.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      </TabPanel>

      <TabPanel id="growth" activeTab={activeTab}>
        <Card className="p-4">
          <h3 className="text-sm font-medium t-primary mb-4">MRR Growth (Last 6 Months)</h3>
          <div className="flex items-end gap-2 h-40">
            {growth.map((g) => {
              const maxMrr = Math.max(...growth.map(x => x.mrr));
              const heightPct = (g.mrr / maxMrr) * 100;
              return (
                <div key={g.month} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] font-medium t-primary">${(g.mrr / 1000).toFixed(1)}k</span>
                  <div className="w-full rounded-t-md bg-accent/80 transition-all" style={{ height: `${heightPct}%` }} />
                  <span className="text-[10px] t-muted">{g.month}</span>
                </div>
              );
            })}
          </div>
        </Card>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <Card className="p-4">
            <h4 className="text-xs font-medium t-primary mb-3">Tenant Growth</h4>
            <div className="space-y-2">
              {growth.map(g => (
                <div key={g.month} className="flex justify-between text-xs">
                  <span className="t-muted">{g.month}</span>
                  <span className="t-primary font-medium">{g.tenants} tenants</span>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-4">
            <h4 className="text-xs font-medium t-primary mb-3">User Growth</h4>
            <div className="space-y-2">
              {growth.map(g => (
                <div key={g.month} className="flex justify-between text-xs">
                  <span className="t-muted">{g.month}</span>
                  <span className="t-primary font-medium">{g.users} users</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </TabPanel>

      <TabPanel id="usage" activeTab={activeTab}>
        <Card className="p-4">
          <h3 className="text-sm font-medium t-primary mb-4">Usage Heatmap (API Calls by Hour)</h3>
          <div className="grid grid-cols-12 gap-1">
            {Array.from({ length: 168 }, (_, i) => {
              const hour = i % 24;
              const day = Math.floor(i / 24);
              const intensity = Math.random();
              const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
              return (
                <div key={i} className="relative group">
                  {hour === 0 && <span className="absolute -left-8 text-[8px] t-muted">{dayLabels[day]}</span>}
                  <div
                    className="w-full aspect-square rounded-sm transition-colors"
                    style={{
                      background: intensity > 0.8 ? 'var(--accent)' :
                                 intensity > 0.5 ? 'rgba(var(--accent-rgb), 0.6)' :
                                 intensity > 0.2 ? 'rgba(var(--accent-rgb), 0.3)' :
                                 'var(--bg-secondary)',
                    }}
                    title={`${dayLabels[day]} ${hour}:00 - ${Math.round(intensity * 1000)} calls`}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2 mt-3 justify-end">
            <span className="text-[10px] t-muted">Less</span>
            {[0.1, 0.3, 0.5, 0.8, 1].map(v => (
              <div key={v} className="w-3 h-3 rounded-sm" style={{
                background: v > 0.8 ? 'var(--accent)' :
                           v > 0.5 ? 'rgba(var(--accent-rgb), 0.6)' :
                           v > 0.2 ? 'rgba(var(--accent-rgb), 0.3)' :
                           'var(--bg-secondary)',
              }} />
            ))}
            <span className="text-[10px] t-muted">More</span>
          </div>
        </Card>
      </TabPanel>
    </div>
  );
}
