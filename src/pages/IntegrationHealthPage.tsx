/**
 * ADMIN-010: Integration Health Monitoring
 * Per-connection sync status, error count, circuit breaker state, freshness.
 * Route: /integration-health | Role: admin, support_admin, superadmin
 *
 * Data: GET /api/v1/erp/connections/health — aggregates erp_connections,
 * audit_log error counts, and KV-backed circuit breaker state. No mocks.
 * Distinct from ConnectivityPage (adapter CRUD); this view is sync-health-focused.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabPanel, useTabState } from '@/components/ui/tabs';
import { PageHeader } from '@/components/ui/page-header';
import { api, ApiError } from '@/lib/api';
import type { IntegrationHealthConnection } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { AsyncPageContent, statusFrom } from '@/components/ui/async';
import {
  Wifi, CheckCircle, XCircle, AlertTriangle, Clock,
  RefreshCw, Zap, Activity,
} from 'lucide-react';

function statusVariant(status: string): 'success' | 'warning' | 'danger' | 'default' {
  const s = status.toLowerCase();
  if (s === 'connected' || s === 'active' || s === 'healthy') return 'success';
  if (s === 'pending' || s === 'provisioning' || s === 'degraded') return 'warning';
  if (s === 'disconnected' || s === 'error' || s === 'failed') return 'danger';
  return 'default';
}

function statusIcon(status: string) {
  const v = statusVariant(status);
  if (v === 'success') return <CheckCircle size={14} style={{ color: 'var(--rag-healthy)' }} />;
  if (v === 'warning') return <AlertTriangle size={14} style={{ color: 'var(--warning)' }} />;
  if (v === 'danger') return <XCircle size={14} style={{ color: 'var(--neg)' }} />;
  return <Activity size={14} className="t-muted" />;
}

function freshnessColor(freshness: 'fresh' | 'stale' | 'cold'): string {
  if (freshness === 'fresh') return 'var(--rag-healthy)';
  if (freshness === 'stale') return 'var(--warning)';
  return 'var(--neg)';
}

function freshnessLabel(conn: IntegrationHealthConnection): string {
  if (conn.hoursSinceSync == null) return 'Never synced';
  const h = conn.hoursSinceSync;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function circuitVariant(state: string): 'success' | 'warning' | 'danger' {
  if (state === 'CLOSED') return 'success';
  if (state === 'HALF_OPEN') return 'warning';
  return 'danger';
}

export function IntegrationHealthPage() {
  const { activeTab, setActiveTab } = useTabState('connections');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connections, setConnections] = useState<IntegrationHealthConnection[]>([]);
  const toast = useToast();

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.erp.connectionsHealth();
      setConnections(res.connections);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error('Failed to load integration health', {
        message: msg,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = () => {
    setRefreshing(true);
    load();
  };

  const summary = useMemo(() => {
    return {
      total: connections.length,
      healthy: connections.filter((c) => statusVariant(c.status) === 'success' && c.freshness === 'fresh' && c.errorsLast30d === 0).length,
      errored: connections.filter((c) => statusVariant(c.status) === 'danger' || c.circuitState === 'OPEN').length,
      records: connections.reduce((s, c) => s + (c.recordsSynced || 0), 0),
      errors: connections.reduce((s, c) => s + (c.errorsLast30d || 0), 0),
    };
  }, [connections]);

  const tabs = [
    { id: 'connections', label: 'Connections', icon: <Wifi size={14} />, count: connections.length },
    { id: 'errors', label: 'Errors', icon: <AlertTriangle size={14} />, count: summary.errors },
    { id: 'freshness', label: 'Data Freshness', icon: <Clock size={14} /> },
  ];

  const status = statusFrom({
    loading: loading && connections.length === 0,
    error: error && connections.length === 0 ? error : null,
    isEmpty: false,
  });
  if (status !== 'success') {
    return (
      <AsyncPageContent
        status={status}
        error={error}
        onRetry={handleRefresh}
        errorTitle="Couldn't load integration health"
        loadingVariant="list"
        loadingCount={3}
      >
        {null}
      </AsyncPageContent>
    );
  }

  const erroredConnections = connections.filter((c) => c.errorsLast30d > 0 || c.circuitState === 'OPEN' || c.circuitState === 'HALF_OPEN');

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        live
        eyebrow="Integrations · System-Wide Monitoring"
        title="Integration Health"
        dek="Per-connection sync status, circuit breakers &amp; data freshness"
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

      <Card variant="prominent" className="p-0 overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[var(--border-card)]">
          <div className="p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <span className="text-label">Healthy</span>
              <span className="pill-success inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider">
                Healthy
              </span>
            </div>
            <p className="mt-2 text-4xl font-bold font-mono leading-none" style={{ color: 'var(--rag-healthy)' }}>
              {summary.healthy}
            </p>
          </div>
          <div className="p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <span className="text-label">Connections</span>
              <span className="pill-accent inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider">
                Total
              </span>
            </div>
            <p className="mt-2 text-4xl font-bold font-mono leading-none t-primary">
              {summary.total}
            </p>
          </div>
          <div className="p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <span className="text-label">At-Risk</span>
              <span
                className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider"
                style={{
                  background: 'rgb(var(--neg-rgb) / 0.10)',
                  color: 'var(--neg)',
                  borderColor: 'rgb(var(--neg-rgb) / 0.24)',
                }}
              >
                Errored
              </span>
            </div>
            <p className="mt-2 text-4xl font-bold font-mono leading-none" style={{ color: 'var(--neg)' }}>
              {summary.errored}
            </p>
          </div>
        </div>
        <div className="border-t border-[var(--border-card)] px-5 sm:px-6 py-3 text-caption t-muted">
          Total Active Integrations: <span className="font-mono t-secondary">{summary.total}</span>
          {' · '}Records Synced:{' '}
          <span className="font-mono t-secondary">
            {summary.records >= 1000 ? `${(summary.records / 1000).toFixed(1)}k` : summary.records.toLocaleString()}
          </span>
          {' · '}Errors (30d): <span className="font-mono t-secondary">{summary.errors}</span>
        </div>
      </Card>

      {connections.length === 0 ? (
        <Card className="p-8 text-center">
          <Wifi size={24} className="mx-auto t-muted mb-2" />
          <p className="text-sm t-muted">No ERP connections configured for this tenant yet.</p>
        </Card>
      ) : (
        <>
          <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

          <TabPanel id="connections" activeTab={activeTab}>
            <Card className="p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--border-card)]">
                      <th className="text-label px-4 py-3 font-normal">Integration Name</th>
                      <th className="text-label px-4 py-3 font-normal">Status</th>
                      <th className="text-label px-4 py-3 font-normal">Circuit</th>
                      <th className="text-label px-4 py-3 font-normal text-right">Records</th>
                      <th className="text-label px-4 py-3 font-normal text-right">Errors (30d)</th>
                      <th className="text-label px-4 py-3 font-normal">Last Sync</th>
                      <th className="text-label px-4 py-3 font-normal">Freshness</th>
                    </tr>
                  </thead>
                  <tbody>
                    {connections.map((c) => (
                      <tr
                        key={c.id}
                        className="border-b border-[var(--border-card)] last:border-0 hover:bg-[var(--bg-secondary)] transition-colors duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)]"
                      >
                        <td className="px-4 py-3.5 align-middle">
                          <div className="flex items-center gap-2.5 min-w-0">
                            {statusIcon(c.status)}
                            <div className="min-w-0">
                              <p className="text-sm font-medium t-primary truncate">{c.name}</p>
                              {c.adapter_name && (
                                <p className="text-caption font-mono t-muted truncate">{c.adapter_name}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 align-middle">
                          <Badge variant={statusVariant(c.status)} className="text-caption uppercase tracking-wide">{c.status}</Badge>
                        </td>
                        <td className="px-4 py-3.5 align-middle">
                          <Badge variant={circuitVariant(c.circuitState)} className="text-caption">
                            <Zap size={9} className="inline mr-0.5" />
                            {c.circuitState}
                          </Badge>
                        </td>
                        <td className="px-4 py-3.5 align-middle text-right font-mono text-sm t-primary tabular-nums">
                          {c.recordsSynced.toLocaleString()}
                        </td>
                        <td
                          className="px-4 py-3.5 align-middle text-right font-mono text-sm tabular-nums"
                          style={{ color: c.errorsLast30d > 0 ? 'var(--neg)' : undefined }}
                        >
                          <span className={c.errorsLast30d > 0 ? '' : 't-primary'}>{c.errorsLast30d}</span>
                        </td>
                        <td className="px-4 py-3.5 align-middle font-mono text-caption t-secondary whitespace-nowrap">
                          {c.lastSync ? new Date(c.lastSync).toLocaleString() : 'Never'}
                        </td>
                        <td className="px-4 py-3.5 align-middle whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 font-mono text-caption font-medium" style={{ color: freshnessColor(c.freshness) }}>
                            <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: freshnessColor(c.freshness) }} />
                            {freshnessLabel(c)}
                            <span className="t-muted">({c.freshness})</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabPanel>

          <TabPanel id="errors" activeTab={activeTab}>
            {erroredConnections.length === 0 ? (
              <Card className="p-8 text-center">
                <CheckCircle size={24} className="mx-auto mb-2" style={{ color: 'var(--rag-healthy)' }} />
                <p className="text-sm t-muted">No errors in the last 30 days.</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {erroredConnections.map((c) => (
                  <Card key={c.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <XCircle size={14} className="mt-0.5" style={{ color: 'var(--neg)' }} />
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium t-primary">{c.name}</p>
                            {c.adapter_name && <Badge variant="default" className="text-caption">{c.adapter_name}</Badge>}
                          </div>
                          <p className="text-xs t-muted mt-0.5">
                            {c.errorsLast30d} error{c.errorsLast30d === 1 ? '' : 's'} in the last 30 days
                            {c.circuitState !== 'CLOSED' && ` · Circuit breaker: ${c.circuitState} (${c.circuitFailures} failures)`}
                          </p>
                          {c.lastSync && (
                            <p className="text-caption t-muted mt-1 flex items-center gap-1">
                              <Clock size={10} /> Last sync: {new Date(c.lastSync).toLocaleString()}
                            </p>
                          )}
                        </div>
                      </div>
                      <Badge variant="danger" className="text-caption">{c.errorsLast30d} errors</Badge>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </TabPanel>

          <TabPanel id="freshness" activeTab={activeTab}>
            <div className="space-y-2">
              {connections.map((c) => {
                const hours = c.hoursSinceSync ?? 999;
                const pct = Math.min(100, (hours / 24) * 100);
                return (
                  <Card key={c.id} className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium t-primary">{c.name}</span>
                        {c.adapter_name && <Badge variant="default" className="text-caption">{c.adapter_name}</Badge>}
                      </div>
                      <span className="text-xs font-medium" style={{ color: freshnessColor(c.freshness) }}>
                        {freshnessLabel(c)}
                      </span>
                    </div>
                    <div className="h-2 rounded-md bg-[var(--bg-secondary)] overflow-hidden">
                      <div
                        className="h-full rounded-md transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)]"
                        style={{ width: `${pct}%`, background: freshnessColor(c.freshness) }}
                      />
                    </div>
                    <p className="text-caption t-muted mt-1">
                      fresh ≤ 1h · stale ≤ 24h · cold &gt; 24h
                    </p>
                  </Card>
                );
              })}
            </div>
          </TabPanel>
        </>
      )}
    </div>
  );
}
