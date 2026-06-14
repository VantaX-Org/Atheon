/**
 * ADMIN-009: Data Governance Dashboard
 * Retention, DSAR history, erasure log, audit volume, encryption status.
 * Route: /data-governance | Role: admin, support_admin, superadmin
 *
 * Data: GET /api/v1/governance/:tenantId — aggregates over audit_log,
 * tenant_entitlements, and erp_connections. No mocks. All tabs surface real,
 * read-only roll-up data. POPIA DSAR/erasure actions for a tenant already live
 * under /settings; this dashboard is summary-only.
 */
import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabPanel, useTabState } from '@/components/ui/tabs';
import { AsyncPageContent, statusFrom } from '@/components/ui/async';
import { api, ApiError } from '@/lib/api';
import type { GovernanceResponse } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useAppStore } from '@/stores/appStore';
import {
  Shield, Lock, FileText, Database,
  AlertCircle, RefreshCw, Activity, CheckCircle, XCircle,
} from 'lucide-react';

export function DataGovernancePage() {
  const { activeTab, setActiveTab } = useTabState('overview');
  const user = useAppStore((s) => s.user);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<GovernanceResponse | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    if (!user?.tenantId) {
      setError('No tenant context');
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const res = await api.governance.get(user.tenantId);
      setData(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error('Failed to load data governance', {
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
    { id: 'overview', label: 'Overview', icon: <Shield size={14} /> },
    { id: 'dsar', label: 'DSAR & Erasure', icon: <FileText size={14} /> },
    { id: 'retention', label: 'Retention', icon: <Database size={14} /> },
    { id: 'encryption', label: 'Encryption', icon: <Lock size={14} /> },
  ];

  const status = statusFrom({ loading: loading && !data, error: error && !data ? error : null, isEmpty: false });
  if (status !== 'success') {
    return (
      <AsyncPageContent
        status={status}
        error={error}
        onRetry={handleRefresh}
        errorTitle="Failed to load data governance"
        loadingVariant="cards"
        loadingCount={4}
      >
        {null}
      </AsyncPageContent>
    );
  }

  if (!data) return null;

  const totalErpConns = data.encryption.erpEncrypted + data.encryption.erpPlaintext;
  const encryptionPct = totalErpConns > 0 ? Math.round((data.encryption.erpEncrypted / totalErpConns) * 100) : 100;
  const encryptionHealthy = data.encryption.erpPlaintext === 0;

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Editorial masthead: oversized title flanked by two hero metric tiles */}
      <header
        className="pb-5 mb-6 border-b"
        style={{ borderColor: 'var(--line-strong)', borderBottomWidth: '1.5px' }}
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-eyebrow t-accent flex items-center gap-1.5 uppercase">
              Governance · Data Lineage
            </p>
            <h1 className="t-primary mt-2 truncate font-semibold tracking-[-0.02em] text-4xl md:text-5xl lg:text-6xl">
              Data Governance
            </h1>
            <p className="text-body-sm t-muted mt-3 max-w-2xl">
              Retention, DSAR history, erasure log &amp; encryption status
            </p>
          </div>
          <div className="flex items-stretch gap-3 shrink-0">
            <Card variant="prominent" className="px-5 py-3 min-w-[8.5rem]">
              <p className="text-label">Encrypted</p>
              <p className="mt-1 text-3xl font-bold t-primary [font-family:'Space_Mono',ui-monospace,monospace]">
                {encryptionPct}%
              </p>
            </Card>
            <Card variant="prominent" className="px-5 py-3 min-w-[8.5rem]">
              <p className="text-label">Audit Vol (30d)</p>
              <p className="mt-1 text-3xl font-bold t-primary [font-family:'Space_Mono',ui-monospace,monospace]">
                {data.auditVolume30d.toLocaleString()}
              </p>
            </Card>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              aria-label="Refresh data governance"
              className="flex items-center gap-1.5 self-stretch px-3 text-xs rounded-md border border-[var(--border-card)] t-secondary hover:t-primary hover:bg-[var(--bg-secondary)] transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] active:scale-[0.97]"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </header>

      {/* Summary tiles — mono data labels over big figures */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card size="compact">
          <p className="text-label">DSAR Exports (30d)</p>
          <p className="mt-1.5 text-2xl font-bold t-primary [font-family:'Space_Mono',ui-monospace,monospace]">{data.dsar.exports30d}</p>
        </Card>
        <Card size="compact">
          <p className="text-label">Erasures (30d)</p>
          <p className="mt-1.5 text-2xl font-bold t-primary [font-family:'Space_Mono',ui-monospace,monospace]">{data.dsar.erasures30d}</p>
        </Card>
        <Card size="compact">
          <p className="text-label">Audit Volume (30d)</p>
          <p className="mt-1.5 text-2xl font-bold t-primary [font-family:'Space_Mono',ui-monospace,monospace]">{data.auditVolume30d.toLocaleString()}</p>
        </Card>
        <Card size="compact">
          <p className="text-label">Retention</p>
          <p className="mt-1.5 text-2xl font-bold t-primary [font-family:'Space_Mono',ui-monospace,monospace]">
            {data.retention.retentionDays ? `${data.retention.retentionDays}d` : '—'}
          </p>
        </Card>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <TabPanel id="overview" activeTab={activeTab}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Activity size={14} className="text-accent" />
              <span className="text-label !text-[var(--text-primary)]">Compliance Posture · 30-Day Rollup</span>
            </div>
            <dl className="divide-y divide-[var(--border-card)]">
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-label">DSAR Exports</dt>
                <dd className="t-primary font-bold [font-family:'Space_Mono',ui-monospace,monospace]">{data.dsar.exports30d}</dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-label">Erasure Events</dt>
                <dd className="t-primary font-bold [font-family:'Space_Mono',ui-monospace,monospace]">{data.dsar.erasures30d}</dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-label">Last Export</dt>
                <dd className="t-primary font-bold [font-family:'Space_Mono',ui-monospace,monospace]">{data.dsar.lastExportAt ? new Date(data.dsar.lastExportAt).toLocaleDateString() : 'Never'}</dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-label">Audit Log Volume</dt>
                <dd className="t-primary font-bold [font-family:'Space_Mono',ui-monospace,monospace]">{data.auditVolume30d.toLocaleString()}</dd>
              </div>
            </dl>
          </Card>
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Lock size={14} className="text-accent" />
              <span className="text-label !text-[var(--text-primary)]">ERP Credential Encryption</span>
            </div>
            {totalErpConns === 0 ? (
              <p className="text-body-sm t-muted">No ERP connections configured.</p>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <p className="text-4xl font-bold [font-family:'Space_Mono',ui-monospace,monospace]" style={{ color: encryptionHealthy ? 'var(--accent)' : 'var(--warning)' }}>
                    {encryptionPct}%
                  </p>
                  <Badge variant={encryptionHealthy ? 'success' : 'warning'}>
                    {encryptionHealthy ? 'HEALTHY' : 'WATCH'}
                  </Badge>
                </div>
                <dl className="divide-y divide-[var(--border-card)]">
                  <div className="flex items-center justify-between py-2.5">
                    <dt className="text-label flex items-center gap-1.5">
                      <CheckCircle size={12} style={{ color: 'var(--accent)' }} /> Encrypted
                    </dt>
                    <dd className="t-primary font-bold [font-family:'Space_Mono',ui-monospace,monospace]">{data.encryption.erpEncrypted}</dd>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <dt className="text-label flex items-center gap-1.5">
                      <XCircle size={12} style={{ color: 'var(--neg)' }} /> Plaintext
                    </dt>
                    <dd className="t-primary font-bold [font-family:'Space_Mono',ui-monospace,monospace]">{data.encryption.erpPlaintext}</dd>
                  </div>
                </dl>
              </>
            )}
          </Card>
        </div>
      </TabPanel>

      <TabPanel id="dsar" activeTab={activeTab}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card>
            <div className="flex items-center gap-2 mb-2">
              <FileText size={14} className="text-accent" />
              <span className="text-label">DSAR Exports</span>
            </div>
            <p className="text-3xl font-bold t-primary [font-family:'Space_Mono',ui-monospace,monospace]">{data.dsar.exports30d}</p>
            <p className="text-caption t-muted mt-1.5">Completed in the last 30 days</p>
          </Card>
          <Card>
            <div className="flex items-center gap-2 mb-2">
              <Shield size={14} className="text-accent" />
              <span className="text-label">Erasure Events</span>
            </div>
            <p className="text-3xl font-bold t-primary [font-family:'Space_Mono',ui-monospace,monospace]">{data.dsar.erasures30d}</p>
            <p className="text-caption t-muted mt-1.5">POPIA right-to-be-forgotten fulfillments</p>
          </Card>
          <Card>
            <div className="flex items-center gap-2 mb-2">
              <Activity size={14} className="text-accent" />
              <span className="text-label">Last Export</span>
            </div>
            <p className="text-xl font-bold t-primary [font-family:'Space_Mono',ui-monospace,monospace]">
              {data.dsar.lastExportAt ? new Date(data.dsar.lastExportAt).toLocaleDateString() : 'Never'}
            </p>
            <p className="text-caption t-muted mt-1.5">
              {data.dsar.lastExportAt ? new Date(data.dsar.lastExportAt).toLocaleTimeString() : 'No historical record'}
            </p>
          </Card>
        </div>
        <Card variant="panel" className="mt-3">
          <p className="text-body-sm t-muted">
            Counts sourced from <code className="text-caption font-mono t-secondary">audit_log</code> rows with action <code className="text-caption font-mono t-secondary">popia.data_export.completed</code> / <code className="text-caption font-mono t-secondary">popia.erasure.completed</code>. To raise a new DSAR or erasure, use the POPIA controls under Settings.
          </p>
        </Card>
      </TabPanel>

      <TabPanel id="retention" activeTab={activeTab}>
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Database size={14} className="text-accent" />
            <span className="text-label !text-[var(--text-primary)]">Tenant Retention Policy</span>
          </div>
          <dl className="divide-y divide-[var(--border-card)]">
            <div className="flex items-center justify-between py-2.5">
              <dt className="text-label">Data Retention</dt>
              <dd className="t-primary font-bold [font-family:'Space_Mono',ui-monospace,monospace]">
                {data.retention.retentionDays ? `${data.retention.retentionDays} days` : 'Default'}
              </dd>
            </div>
          </dl>
          <p className="text-caption t-muted mt-3">{data.retention.policy}</p>
        </Card>
        <Card className="mt-3">
          <div className="flex items-center gap-2 mb-3">
            <Activity size={14} className="text-accent" />
            <span className="text-label !text-[var(--text-primary)]">Audit Log Volume</span>
          </div>
          <p className="text-4xl font-bold t-primary [font-family:'Space_Mono',ui-monospace,monospace]">{data.auditVolume30d.toLocaleString()}</p>
          <p className="text-caption t-muted mt-1.5">Audit entries recorded for this tenant in the last 30 days.</p>
        </Card>
      </TabPanel>

      <TabPanel id="encryption" activeTab={activeTab}>
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Lock size={14} className="text-accent" />
            <span className="text-label !text-[var(--text-primary)]">ERP Credential Storage</span>
          </div>
          {totalErpConns === 0 ? (
            <p className="text-body-sm t-muted">No ERP connections configured yet.</p>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-label">Encrypted (encrypted_config)</span>
                  <span className="t-primary font-bold [font-family:'Space_Mono',ui-monospace,monospace]">{data.encryption.erpEncrypted} of {totalErpConns}</span>
                </div>
                <div className="h-2 rounded-md bg-[var(--bg-secondary)] overflow-hidden">
                  <div
                    className="h-full rounded-md transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)]"
                    style={{ width: `${encryptionPct}%`, background: 'var(--accent)' }}
                  />
                </div>
              </div>
              {data.encryption.erpPlaintext > 0 && (
                <div className="flex items-start gap-2 p-3 rounded-md border"
                     style={{ background: 'rgb(var(--neg-rgb) / 0.08)', borderColor: 'rgb(var(--neg-rgb) / 0.20)' }}>
                  <AlertCircle size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--warning)' }} />
                  <div>
                    <p className="text-body-sm font-semibold t-primary">{data.encryption.erpPlaintext} connection{data.encryption.erpPlaintext === 1 ? '' : 's'} storing credentials as plaintext</p>
                    <p className="text-caption t-muted mt-1">
                      Set the platform ENCRYPTION_KEY secret and rotate connections via <code className="font-mono text-caption">POST /api/v1/admin/rotate-encryption</code> to encrypt at rest.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
          <p className="text-caption t-muted mt-3">
            Transport encryption (TLS) and D1 encryption at rest are platform-wide defaults handled by Cloudflare and are not tenant-configurable.
          </p>
        </Card>
      </TabPanel>
    </div>
  );
}
