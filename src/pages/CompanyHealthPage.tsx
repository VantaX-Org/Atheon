/**
 * ADMIN-003: Company Health Dashboard
 * Admin+ view of per-tenant adoption, catalyst usage, LLM usage, entitlements.
 * Route: /company-health | Role: admin, support_admin, superadmin
 *
 * All metrics are read from real data via
 *   GET /api/v1/admin-tooling/company-health/:tenantId
 * No client-side mock data.
 */
import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabPanel, useTabState } from '@/components/ui/tabs';
import { PageHeader } from '@/components/ui/page-header';
import { AsyncPageContent, statusFrom } from '@/components/ui/async';
import { api, ApiError } from '@/lib/api';
import type { CompanyHealthDetail } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useAppStore } from '@/stores/appStore';
import {
  Users, Brain, Shield,
  Activity, Zap, Clock, AlertCircle, Building2, Wifi, RefreshCw,
} from 'lucide-react';

export function CompanyHealthPage() {
  const { activeTab, setActiveTab } = useTabState('adoption');
  const user = useAppStore((s) => s.user);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CompanyHealthDetail | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    if (!user?.tenantId) {
      setError('No tenant context');
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const res = await api.adminTooling.companyHealthDetail(user.tenantId);
      setData(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error('Failed to load company health', {
        message: msg,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.tenantId, toast]);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = () => {
    setRefreshing(true);
    load();
  };

  const tabs = [
    { id: 'adoption', label: 'User Adoption', icon: <Users size={14} /> },
    { id: 'catalysts', label: 'Catalyst Usage', icon: <Zap size={14} /> },
    { id: 'ai-usage', label: 'LLM Usage', icon: <Brain size={14} /> },
    { id: 'entitlements', label: 'Entitlements', icon: <Shield size={14} /> },
  ];

  const status = statusFrom({ loading: loading && !data, error: error && !data ? error : null, isEmpty: false });
  if (status !== 'success') {
    return (
      <AsyncPageContent
        status={status}
        error={error}
        onRetry={handleRefresh}
        errorTitle="Couldn't load company health"
        loadingVariant="cards"
        loadingCount={4}
      >
        {null}
      </AsyncPageContent>
    );
  }
  if (!data) return null;

  const activePct = data.users.total > 0 ? Math.round((data.users.active / data.users.total) * 100) : 0;
  const userPct = data.entitlements?.maxUsers
    ? Math.min(100, Math.round((data.users.total / data.entitlements.maxUsers) * 100))
    : 0;

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        eyebrow="Platform · Tenant Health"
        title="Company Health"
        dek={`${data.tenant.name} · plan: ${data.tenant.plan}`}
        actions={
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-[var(--border-card)] t-secondary hover:t-primary hover:bg-[var(--bg-secondary)] transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] active:scale-[0.97]"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        }
      />

      {/* Health hero — dominant adoption metric paired with supporting stats */}
      <Card className="card-prominent p-6 sm:p-8">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_2fr] gap-8 lg:gap-12 items-center">
          {/* Hero number */}
          <div>
            <p className="hero-eyebrow flex items-center gap-2">
              <Users size={13} />
              Active Adoption
            </p>
            <p className="text-hero t-primary mt-3 font-mono">
              {activePct}<span className="text-display t-muted align-top">%</span>
            </p>
            <p className="text-body-sm t-secondary mt-2">
              <span className="font-mono t-primary">{data.users.active}</span>
              <span className="t-muted"> / {data.users.total}</span> tenant users active
            </p>
          </div>

          {/* Supporting metric trio */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-px rounded-[var(--radius)] overflow-hidden border border-[var(--border-card)] bg-[var(--border-card)]">
            <div className="bg-[var(--bg-card-solid)] p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-2">
                <Zap size={13} className="text-accent" />
                <span className="text-label">Catalyst Actions</span>
              </div>
              <p className="text-headline-lg font-mono font-bold t-primary tabular-nums">{data.catalysts.actionsLast30d.toLocaleString()}</p>
              <p className="text-caption t-muted mt-1">Last 30 days</p>
            </div>
            <div className="bg-[var(--bg-card-solid)] p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-2">
                <Brain size={13} className="text-accent" />
                <span className="text-label">LLM Tokens</span>
              </div>
              <p className="text-headline-lg font-mono font-bold t-primary tabular-nums">
                {data.llm.tokens30d >= 1_000_000
                  ? `${(data.llm.tokens30d / 1_000_000).toFixed(2)}M`
                  : data.llm.tokens30d >= 1_000
                    ? `${(data.llm.tokens30d / 1_000).toFixed(1)}k`
                    : data.llm.tokens30d.toLocaleString()}
              </p>
              <p className="text-caption t-muted mt-1">Last 30 days</p>
            </div>
            <div className="bg-[var(--bg-card-solid)] p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-2">
                <Wifi size={13} className="text-accent" />
                <span className="text-label">ERP Connections</span>
              </div>
              <p className="text-headline-lg font-mono font-bold t-primary tabular-nums">
                {data.erp.connectedCount}<span className="text-sm t-muted">/{data.erp.connections}</span>
              </p>
              <p className="text-caption t-muted mt-1">Connected / total</p>
            </div>
          </div>
        </div>
      </Card>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <TabPanel id="adoption" activeTab={activeTab}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <Users size={14} className="text-accent" />
              <span className="text-label !text-[var(--text-primary)]">User Status</span>
            </div>
            <dl className="divide-y divide-[var(--border-card)]">
              <div className="flex items-baseline justify-between py-2.5">
                <dt className="text-body-sm t-secondary">Total Users</dt>
                <dd className="font-mono text-sm font-bold t-primary tabular-nums">{data.users.total}</dd>
              </div>
              <div className="flex items-baseline justify-between py-2.5">
                <dt className="text-body-sm t-secondary">Active</dt>
                <dd className="font-mono text-sm font-bold t-primary tabular-nums">{data.users.active}</dd>
              </div>
              <div className="flex items-baseline justify-between py-2.5">
                <dt className="text-body-sm t-secondary">Last Login</dt>
                <dd className="font-mono text-xs t-primary tabular-nums text-right">
                  {data.users.lastLoginAt ? new Date(data.users.lastLoginAt).toLocaleString() : 'Never'}
                </dd>
              </div>
            </dl>
            {data.entitlements && (
              <div className="mt-4 pt-4 border-t border-[var(--border-card)]">
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-label">Seat Utilisation</span>
                  <span className="font-mono text-sm font-bold t-primary tabular-nums">{userPct}%</span>
                </div>
                <div className="h-2 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)]"
                    style={{
                      width: `${userPct}%`,
                      background: userPct >= 90 ? 'var(--neg)' : userPct >= 70 ? 'var(--warning)' : 'var(--accent)',
                    }}
                  />
                </div>
                <p className="text-caption t-muted mt-1.5">of {data.entitlements.maxUsers} seats</p>
              </div>
            )}
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <Shield size={14} className="text-accent" />
              <span className="text-label !text-[var(--text-primary)]">Users by Role</span>
            </div>
            {Object.keys(data.users.byRole).length === 0 ? (
              <p className="text-body-sm t-muted">No users.</p>
            ) : (
              <div>
                <div className="grid grid-cols-[1fr_auto] gap-4 pb-2 mb-1 border-b border-[var(--border-card)]">
                  <span className="text-label">Role</span>
                  <span className="text-label">Users</span>
                </div>
                <div className="divide-y divide-[var(--border-card)]">
                  {Object.entries(data.users.byRole).map(([role, count]) => (
                    <div key={role} className="grid grid-cols-[1fr_auto] gap-4 items-center py-2.5">
                      <span className="text-body-sm t-primary capitalize">{role.replace('_', ' ')}</span>
                      <span className="font-mono text-sm font-bold t-primary tabular-nums">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>
      </TabPanel>

      <TabPanel id="catalysts" activeTab={activeTab}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <Zap size={14} className="text-accent" />
              <span className="text-label">Catalyst Clusters</span>
            </div>
            <p className="text-hero font-mono font-bold t-primary tabular-nums">{data.catalysts.clusters}</p>
            <p className="text-caption t-muted mt-2">Configured clusters</p>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <Activity size={14} className="text-accent" />
              <span className="text-label">Recent Activity</span>
            </div>
            <p className="text-hero font-mono font-bold t-primary tabular-nums">{data.catalysts.actionsLast30d.toLocaleString()}</p>
            <p className="text-caption t-muted mt-2 flex items-center gap-1.5">
              <Clock size={11} /> Actions in last 30 days
            </p>
          </Card>
        </div>
      </TabPanel>

      <TabPanel id="ai-usage" activeTab={activeTab}>
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-5">
            <Brain size={14} className="text-accent" />
            <span className="text-label">LLM Usage · Last 30 Days</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-px rounded-[var(--radius)] overflow-hidden border border-[var(--border-card)] bg-[var(--border-card)]">
            <div className="bg-[var(--bg-card-solid)] p-5">
              <p className="text-label">Total Tokens</p>
              <p className="text-hero font-bold t-primary tabular-nums font-mono mt-2">{data.llm.tokens30d.toLocaleString()}</p>
            </div>
            <div className="bg-[var(--bg-card-solid)] p-5">
              <p className="text-label flex items-center gap-2">
                Estimated Cost
                {data.llm.costIsEstimate && <Badge variant="warning" className="text-caption">ESTIMATE</Badge>}
              </p>
              <p className="text-hero font-bold t-primary tabular-nums font-mono mt-2">${data.llm.estCostUsd.toFixed(2)}</p>
            </div>
          </div>
          {data.llm.costIsEstimate && (
            <p className="text-caption t-muted mt-3 flex items-start gap-1.5">
              <AlertCircle size={11} className="mt-0.5 flex-shrink-0" />
              <span>{data.llm.costNote}</span>
            </p>
          )}
        </Card>
      </TabPanel>

      <TabPanel id="entitlements" activeTab={activeTab}>
        {!data.entitlements ? (
          <Card className="p-6 text-center">
            <p className="text-body-sm t-muted">No entitlements configured for this tenant.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Users size={14} className="text-accent" />
                <span className="text-label">Capacity</span>
              </div>
              <dl className="divide-y divide-[var(--border-card)]">
                <div className="flex items-baseline justify-between py-2.5"><dt className="text-body-sm t-secondary">Max Users</dt><dd className="font-mono text-sm font-bold t-primary tabular-nums">{data.entitlements.maxUsers}</dd></div>
                <div className="flex items-baseline justify-between py-2.5"><dt className="text-body-sm t-secondary">Max Agents</dt><dd className="font-mono text-sm font-bold t-primary tabular-nums">{data.entitlements.maxAgents}</dd></div>
                <div className="flex items-baseline justify-between py-2.5"><dt className="text-body-sm t-secondary">Data Retention</dt><dd className="font-mono text-sm font-bold t-primary tabular-nums">{data.entitlements.dataRetentionDays} days</dd></div>
              </dl>
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Building2 size={14} className="text-accent" />
                <span className="text-label">Access</span>
              </div>
              <div className="divide-y divide-[var(--border-card)]">
                <div className="flex items-center justify-between py-2.5"><span className="text-body-sm t-secondary">SSO</span><Badge variant={data.entitlements.ssoEnabled ? 'success' : 'default'} className="text-caption">{data.entitlements.ssoEnabled ? 'Enabled' : 'Disabled'}</Badge></div>
                <div className="flex items-center justify-between py-2.5"><span className="text-body-sm t-secondary">API Access</span><Badge variant={data.entitlements.apiAccess ? 'success' : 'default'} className="text-caption">{data.entitlements.apiAccess ? 'Enabled' : 'Disabled'}</Badge></div>
                <div className="flex items-center justify-between py-2.5"><span className="text-body-sm t-secondary">Custom Branding</span><Badge variant={data.entitlements.customBranding ? 'success' : 'default'} className="text-caption">{data.entitlements.customBranding ? 'Enabled' : 'Disabled'}</Badge></div>
              </div>
            </Card>
            <Card className="p-5 sm:col-span-2">
              <div className="flex items-center gap-2 mb-4">
                <Shield size={14} className="text-accent" />
                <span className="text-label">Layers & Clusters</span>
              </div>
              <div className="space-y-4 text-xs">
                <div>
                  <p className="text-label mb-2">Layers</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.entitlements.layers.length === 0 && <span className="t-muted">(none)</span>}
                    {data.entitlements.layers.map((l) => (
                      <Badge key={l} variant="info" className="text-caption">{l}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-label mb-2">Catalyst Clusters</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.entitlements.catalystClusters.length === 0 && <span className="t-muted">(none)</span>}
                    {data.entitlements.catalystClusters.map((l) => (
                      <Badge key={l} variant="info" className="text-caption">{l}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-label mb-2">LLM Tiers</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.entitlements.llmTiers.length === 0 && <span className="t-muted">(none)</span>}
                    {data.entitlements.llmTiers.map((l) => (
                      <Badge key={l} variant="default" className="text-caption">{l}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-label mb-2">Autonomy Tiers</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.entitlements.autonomyTiers.length === 0 && <span className="t-muted">(none)</span>}
                    {data.entitlements.autonomyTiers.map((l) => (
                      <Badge key={l} variant="default" className="text-caption">{l}</Badge>
                    ))}
                  </div>
                </div>
                {data.entitlements.features.length > 0 && (
                  <div>
                    <p className="text-label mb-2">Features</p>
                    <div className="flex flex-wrap gap-1.5">
                      {data.entitlements.features.map((l) => (
                        <Badge key={l} variant="success" className="text-caption">{l}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}
      </TabPanel>
    </div>
  );
}
