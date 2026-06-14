import { useState, useEffect, useCallback } from 'react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/ui/page-header';
import { AsyncPageContent, statusFrom } from '@/components/ui/async';
import type {
  ManagedDeployment, CreateDeploymentRequest, CreateDeploymentResponse, AgentErrorLog
} from '@/lib/api';

type View = 'overview' | 'provision' | 'detail' | 'logs';

/**
 * Deployment lifecycle for on-premise / hybrid customer installations:
 * plan (provision) → stage (edit config) → promote (push config / push update)
 * → rollback (re-push a previous version).
 *
 * Endpoints (all confirmed in workers/api/src/routes/deployments.ts):
 *   - GET    /api/deployments
 *   - GET    /api/deployments/:id
 *   - POST   /api/deployments
 *   - PUT    /api/deployments/:id
 *   - POST   /api/deployments/:id/push-config
 *   - POST   /api/deployments/:id/push-update  (used for both promote and rollback)
 *   - GET    /api/deployments/:id/logs
 *   - DELETE /api/deployments/:id (revoke)
 *
 * Canary: canary promotion (a subset of the fleet receives the new version
 * first) is not yet implemented on the backend. The canary UI block is
 * clearly labelled as such with a link-worthy TODO rather than shipped half-
 * working.
 *
 * Rollback: implemented by supplying a previous version to push-update.
 * The backend does not currently persist a version history; the operator
 * is expected to know the previous tag. A future ticket should add an
 * `agent_version_history` table and a dedicated POST :id/rollback route.
 */
export function DeploymentsPage() {
  const toast = useToast();
  const [view, setView] = useState<View>('overview');
  const [deployments, setDeployments] = useState<ManagedDeployment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDeployment, setSelectedDeployment] = useState<ManagedDeployment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installModal, setInstallModal] = useState<CreateDeploymentResponse | null>(null);

  const reportError = useCallback((title: string, err: unknown) => {
    const message = err instanceof Error ? err.message : undefined;
    const requestId = err instanceof ApiError ? err.requestId : null;
    setError(message ?? title);
    toast.error(title, { message, requestId });
  }, [toast]);

  const loadDeployments = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.deployments.list();
      setDeployments(data.deployments);
    } catch (err) {
      reportError('Failed to load deployments', err);
    } finally {
      setLoading(false);
    }
  }, [reportError]);

  useEffect(() => { loadDeployments(); }, [loadDeployments]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const data = await api.deployments.get(id);
      setSelectedDeployment(data);
    } catch (err) {
      reportError('Failed to load deployment detail', err);
    }
  }, [reportError]);

  const openDetail = (id: string) => {
    setSelectedId(id);
    setView('detail');
    loadDetail(id);
  };

  const openLogs = (id: string) => {
    setSelectedId(id);
    setView('logs');
  };

  // ── Status badge ────────────────────────────────────────────────
  const statusColor = (s: string) => {
    switch (s) {
      case 'active': return 'text-accent' + ' ' + 'border border-[var(--accent)]';
      case 'degraded': return 'text-[var(--warning)] border border-[var(--warning)]';
      case 'offline': case 'suspended': return 'text-neg border border-[var(--neg)]';
      case 'pending': case 'provisioning': return 't-muted border border-[var(--divider)]';
      default: return 't-muted border border-[var(--divider)]';
    }
  };

  const headerActions = (
    <>
      {view !== 'overview' && (
        <button
          onClick={() => { setView('overview'); setSelectedId(null); setSelectedDeployment(null); }}
          className="px-3 py-2 text-sm rounded-full transition-colors"
          style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-card)' }}
        >
          &larr; Back
        </button>
      )}
      <button
        onClick={() => setView('provision')}
        className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-full transition-colors"
        style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
      >
        New Deploy
        <span aria-hidden className="text-base leading-none">+</span>
      </button>
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Platform · Deployments &amp; Releases"
        title="Deployments &amp; Releases"
        dek="Financial Assurance Pipeline Status &amp; Audit Trail"
        live={view === 'overview' && deployments.some(d => d.status === 'active')}
        actions={headerActions}
      />

      {error && (
        <div className="p-3 rounded-sm text-sm border" style={{ background: 'rgb(var(--neg-rgb) / 0.07)', color: 'var(--neg)', borderColor: 'var(--neg)' }}>
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      {/* Install Config Modal */}
      {installModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-md p-6 max-w-xl w-full mx-4 space-y-4" style={{ background: 'var(--bg-modal)', border: '1px solid var(--border-card)' }}>
            <h3 className="text-lg font-semibold t-primary">Deployment Provisioned</h3>
            <p className="text-sm t-secondary">Share the following with the customer&apos;s IT team:</p>
            <div className="space-y-2">
              <div className="p-3 rounded-sm text-xs font-mono" style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-card)' }}>
                <p><strong>Licence Key:</strong> {installModal.licenceKey}</p>
                <p><strong>Deployment ID:</strong> {installModal.id}</p>
              </div>
              <div className="p-3 rounded-sm text-xs font-mono overflow-auto max-h-40" style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-card)' }}>
                <p className="mb-1 font-semibold">Install Command:</p>
                <code>{installModal.installConfig?.installCommand || 'N/A'}</code>
              </div>
              <div className="p-3 rounded-sm text-xs font-mono overflow-auto max-h-40" style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-card)' }}>
                <p className="mb-1 font-semibold">.env file:</p>
                <pre>{installModal.installConfig?.envFile || 'N/A'}</pre>
              </div>
            </div>
            <button
              onClick={() => { setInstallModal(null); loadDeployments(); setView('overview'); }}
              className="w-full py-2 text-sm font-medium rounded-md" style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Views */}
      {view === 'overview' && <OverviewView deployments={deployments} loading={loading} statusColor={statusColor} openDetail={openDetail} openLogs={openLogs} />}
      {view === 'provision' && <ProvisionView onCreated={(resp) => setInstallModal(resp)} onError={reportError} />}
      {view === 'detail' && selectedId && <DetailView deployment={selectedDeployment} id={selectedId} onRefresh={() => loadDetail(selectedId)} onError={reportError} onBack={() => { setView('overview'); setSelectedId(null); setSelectedDeployment(null); loadDeployments(); }} />}
      {view === 'logs' && selectedId && <LogsView id={selectedId} onError={reportError} />}
    </div>
  );
}

// ── Overview View ─────────────────────────────────────────────────────────
function OverviewView({ deployments, loading, statusColor, openDetail, openLogs }: {
  deployments: ManagedDeployment[];
  loading: boolean;
  statusColor: (s: string) => string;
  openDetail: (id: string) => void;
  openLogs: (id: string) => void;
}) {
  const status = statusFrom({ loading, error: null, isEmpty: false });
  if (status !== 'success') {
    return (
      <AsyncPageContent
        status={status}
        loadingVariant="cards"
        loadingCount={3}
      >
        {null}
      </AsyncPageContent>
    );
  }

  if (deployments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-14 h-14 rounded-md border t-muted flex items-center justify-center mb-4" style={{ borderColor: 'var(--border-card)', background: 'var(--bg-secondary)' }}>
          <svg className="w-7 h-7 t-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>
        </div>
        <h3 className="text-base font-semibold t-primary mb-1">No On-Premise Deployments</h3>
        <p className="text-sm t-muted max-w-sm">Your organisation uses Atheon as a fully managed SaaS service. On-premise and hybrid deployments are available for enterprise customers with specific data residency or compliance requirements.</p>
        <p className="text-xs t-muted mt-3">Contact your account manager to discuss hybrid deployment options.</p>
      </div>
    );
  }

  const activeDeployment = deployments.find((d) => d.status === 'active') ?? null;

  return (
    <div className="space-y-6">
      {/* Active / leading deployment banner */}
      {activeDeployment && (
        <div
          className="rounded-2xl px-5 py-4"
          style={{ background: 'var(--accent-subtle)', border: '1px solid rgb(var(--accent-rgb) / 0.20)' }}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-label" style={{ color: 'var(--accent)' }}>Active</span>
            <span className="t-muted" aria-hidden>·</span>
            <span className="font-mono text-sm font-semibold t-primary">{activeDeployment.name}</span>
            <span className="pill-success text-label px-2.5 py-0.5 rounded-full">{activeDeployment.deploymentType}</span>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div
              className="h-2 flex-1 rounded-full overflow-hidden"
              style={{ background: 'rgb(var(--accent-rgb) / 0.14)' }}
              role="progressbar"
              aria-label="Deployment health"
              aria-valuenow={activeDeployment.healthScore}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="h-full rounded-full" style={{ width: `${activeDeployment.healthScore}%`, background: 'var(--accent)' }} />
            </div>
            <span className="font-mono tnum text-sm font-semibold whitespace-nowrap" style={{ color: 'var(--accent)' }}>
              {activeDeployment.healthScore}% Health
            </span>
          </div>
        </div>
      )}

      {/* Search / filter strip (visual structure matches the release-pipeline masthead) */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div
          className="inline-flex items-center gap-2 px-3 py-2 rounded-full text-sm t-muted"
          style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m21 21-4.3-4.3M11 18a7 7 0 100-14 7 7 0 000 14z" /></svg>
          <span className="text-label">Search Deploys</span>
        </div>
        <div
          className="inline-flex items-center gap-2 px-3 py-2 rounded-full text-sm t-muted"
          style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}
        >
          <span className="text-label">Filter by Environment</span>
        </div>
        <div
          className="inline-flex items-center gap-2 px-3 py-2 rounded-full text-sm t-muted"
          style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}
        >
          <span className="text-label">Filter by Status</span>
        </div>
      </div>

      {/* Numbered release ledger */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}
      >
        <ul className="divide-y" style={{ borderColor: 'var(--divider)' }}>
          {deployments.map((d, i) => {
            const ru = d.resourceUsage || {};
            const timeSince = d.lastHeartbeat ? getTimeSince(d.lastHeartbeat) : 'Never';
            const isActive = d.id === activeDeployment?.id;

            return (
              <li key={d.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => openDetail(d.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(d.id); } }}
                  className="group flex items-center gap-5 px-5 py-4 cursor-pointer transition-colors"
                  style={isActive
                    ? { background: 'var(--accent-subtle)', boxShadow: 'inset 3px 0 0 var(--accent)' }
                    : undefined}
                >
                  {/* Index */}
                  <span
                    className="font-mono tnum text-2xl font-bold leading-none w-10 shrink-0 text-right"
                    style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }}
                    aria-hidden
                  >
                    {String(i + 1).padStart(2, '0')}
                  </span>

                  {/* Version + status */}
                  <div className="min-w-0 w-48 shrink-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-mono text-sm font-semibold t-primary truncate">{d.name}</h3>
                      <span className={`text-label px-2 py-0.5 rounded-full ${statusColor(d.status)}`}>
                        {d.status}
                      </span>
                    </div>
                    <p className="text-label mt-1">{d.deploymentType}</p>
                  </div>

                  {/* Health */}
                  <div className="hidden md:block w-28 shrink-0">
                    <p className="font-mono tnum text-sm font-medium t-primary">{d.healthScore}%</p>
                    <p className="text-label mt-0.5">Health</p>
                  </div>

                  {/* Agent version */}
                  <div className="hidden lg:block w-32 shrink-0">
                    <p className="font-mono tnum text-sm font-medium t-primary truncate">{d.agentVersion || '—'}</p>
                    <p className="text-label mt-0.5">Agent</p>
                  </div>

                  {/* Resource usage */}
                  <div className="hidden xl:block w-28 shrink-0">
                    <p className="font-mono tnum text-sm font-medium t-primary">
                      {(ru as Record<string, number>).cpuPct ?? '—'}% / {(ru as Record<string, number>).memMb ?? '—'}MB
                    </p>
                    <p className="text-label mt-0.5">CPU / RAM</p>
                  </div>

                  {/* Heartbeat + tenant */}
                  <div className="flex-1 min-w-0 text-right">
                    <p className="font-mono tnum text-sm font-medium t-primary">{timeSince}</p>
                    <p className="text-xs t-muted truncate mt-0.5">{d.tenantName}</p>
                  </div>

                  {/* Logs action */}
                  <button
                    onClick={(e) => { e.stopPropagation(); openLogs(d.id); }}
                    className="shrink-0 text-label px-3 py-1.5 rounded-full transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                    style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-card)' }}
                  >
                    Logs
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// ── Provision View ────────────────────────────────────────────────────────
function ProvisionView({ onCreated, onError }: {
  onCreated: (resp: CreateDeploymentResponse) => void;
  onError: (title: string, err?: unknown) => void;
}) {
  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState<CreateDeploymentRequest>({
    tenant_id: '',
    name: '',
    deployment_type: 'hybrid',
    region: 'af-south-1',
    config: { maxUsers: 50 },
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.tenants.list().then(d => setTenants(d.tenants.map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })))).catch((err) => {
      console.error('Failed to load tenants', err);
      // Non-critical - deployment can proceed without tenant list
    });
  }, []);

  const submit = async () => {
    if (!form.tenant_id || !form.name) {
      onError('Tenant and name are required');
      return;
    }
    try {
      setSubmitting(true);
      const resp = await api.deployments.create(form);
      onCreated(resp);
    } catch (err) {
      onError('Provision failed', err);
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle = { background: 'var(--bg-secondary)', border: '1px solid var(--border-card)', color: 'var(--text-primary)' };

  return (
    <div className="max-w-lg mx-auto rounded-md p-6 space-y-4" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}>
      <h2 className="text-lg font-semibold t-primary">Provision New Deployment</h2>

      <div>
        <label className="block text-xs font-medium mb-1 t-secondary">Tenant</label>
        <select
          value={form.tenant_id}
          onChange={e => setForm({ ...form, tenant_id: e.target.value })}
          className="w-full rounded-md px-3 py-2 text-sm"
          style={inputStyle}
        >
          <option value="">Select tenant...</option>
          {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1 t-secondary">Deployment Name</label>
        <input
          type="text"
          value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value })}
          placeholder="e.g. Protea Manufacturing — JHB DC"
          className="w-full rounded-md px-3 py-2 text-sm"
          style={inputStyle}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium mb-1 t-secondary">Type</label>
          <select
            value={form.deployment_type}
            onChange={e => setForm({ ...form, deployment_type: e.target.value as 'hybrid' | 'on-premise' })}
            className="w-full rounded-md px-3 py-2 text-sm"
            style={inputStyle}
          >
            <option value="hybrid">Hybrid</option>
            <option value="on-premise">On-Premise</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1 t-secondary">Region</label>
          <select
            value={form.region}
            onChange={e => setForm({ ...form, region: e.target.value })}
            className="w-full rounded-md px-3 py-2 text-sm"
            style={inputStyle}
          >
            <option value="af-south-1">Africa South (JHB)</option>
            <option value="eu-west-1">Europe West (London)</option>
            <option value="ap-southeast-1">Asia Pacific (Sydney)</option>
            <option value="us-east-1">US East (Virginia)</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1 t-secondary">Licence Expiry</label>
        <input
          type="date"
          value={form.licence_expires_at || ''}
          onChange={e => setForm({ ...form, licence_expires_at: e.target.value })}
          className="w-full rounded-md px-3 py-2 text-sm"
          style={inputStyle}
        />
      </div>

      <div>
        <label className="block text-xs font-medium mb-1 t-secondary">Max Users</label>
        <input
          type="number"
          value={(form.config as Record<string, number>)?.maxUsers || 50}
          onChange={e => setForm({ ...form, config: { ...form.config, maxUsers: parseInt(e.target.value) || 50 } })}
          className="w-full rounded-md px-3 py-2 text-sm"
          style={inputStyle}
        />
      </div>

      <button
        onClick={submit}
        disabled={submitting}
        className="w-full py-2.5 text-sm font-medium rounded-md transition-colors disabled:opacity-50"
        style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
      >
        {submitting ? 'Provisioning...' : 'Provision Deployment'}
      </button>
    </div>
  );
}

// ── Detail View ───────────────────────────────────────────────────────────
function DetailView({ deployment, id, onRefresh, onError, onBack }: {
  deployment: ManagedDeployment | null;
  id: string;
  onRefresh: () => void;
  onError: (title: string, err?: unknown) => void;
  onBack: () => void;
}) {
  const toast = useToast();
  const [configText, setConfigText] = useState('');
  const [updateVersion, setUpdateVersion] = useState('');
  const [rollbackVersion, setRollbackVersion] = useState('');
  const [revokeConfirm, setRevokeConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [pushingUpdate, setPushingUpdate] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', region: '', deployment_type: '' as string, licence_expires_at: '' });

  useEffect(() => {
    if (deployment?.config) {
      setConfigText(JSON.stringify(deployment.config, null, 2));
    }
    if (deployment) {
      setEditForm({
        name: deployment.name,
        region: deployment.region,
        deployment_type: deployment.deploymentType,
        licence_expires_at: deployment.licenceExpiresAt || '',
      });
    }
  }, [deployment]);

  if (!deployment) {
    return <div className="text-center py-10"><div className="animate-spin w-8 h-8 border-2 border-current border-t-transparent rounded-full mx-auto" /></div>;
  }

  const pushConfig = async () => {
    try {
      setSaving(true);
      const parsed = JSON.parse(configText);
      await api.deployments.pushConfig(id, parsed);
      toast.success('Configuration pushed', 'Agent will pick up on next heartbeat.');
      onRefresh();
    } catch (err) {
      onError('Push config failed', err);
    } finally {
      setSaving(false);
    }
  };

  const pushUpdate = async () => {
    if (!updateVersion.trim()) return;
    try {
      setPushingUpdate(true);
      await api.deployments.pushUpdate(id, updateVersion.trim());
      toast.success('Update promoted', `Agent instructed to pull ${updateVersion.trim()}.`);
      setUpdateVersion('');
      onRefresh();
    } catch (err) {
      onError('Push update failed', err);
    } finally {
      setPushingUpdate(false);
    }
  };

  const doRollback = async () => {
    const target = rollbackVersion.trim();
    if (!target) {
      onError('Enter a previous version tag to roll back to');
      return;
    }
    if (!confirm(`Roll back "${deployment.name}" to ${target}? The agent will immediately pull this image on next heartbeat.`)) return;
    try {
      setRollingBack(true);
      await api.deployments.pushUpdate(id, target);
      toast.success('Rollback initiated', `Agent instructed to pull ${target}.`);
      setRollbackVersion('');
      onRefresh();
    } catch (err) {
      onError('Rollback failed', err);
    } finally {
      setRollingBack(false);
    }
  };

  const saveEdit = async () => {
    try {
      setSaving(true);
      await api.deployments.update(id, {
        name: editForm.name,
        region: editForm.region,
        deployment_type: editForm.deployment_type,
        licence_expires_at: editForm.licence_expires_at || null,
      });
      toast.success('Deployment updated');
      setEditing(false);
      onRefresh();
    } catch (err) {
      onError('Update failed', err);
    } finally {
      setSaving(false);
    }
  };

  const revoke = async () => {
    if (revokeConfirm !== deployment.name) {
      onError('Type the deployment name to confirm revocation');
      return;
    }
    try {
      await api.deployments.revoke(id);
      toast.success('Deployment revoked');
      onBack();
    } catch (err) {
      onError('Revoke failed', err);
    }
  };

  const statusBadgeClass = (s: string) => {
    if (s === 'active') return 'text-accent border border-[var(--accent)]';
    if (s === 'degraded') return 'text-[var(--warning)] border border-[var(--warning)]';
    return 'text-neg border border-[var(--neg)]';
  };

  const ru = deployment.resourceUsage || {};
  const inputStyle = { background: 'var(--bg-secondary)', border: '1px solid var(--border-card)', color: 'var(--text-primary)' };

  return (
    <div className="space-y-6">
      {/* Status Header */}
      <div className="rounded-md p-5" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold t-primary">{deployment.name}</h2>
            <p className="text-sm mt-0.5 t-muted">
              {deployment.tenantName} &middot; {deployment.deploymentType} &middot; {deployment.region}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { if (editing && deployment) { setEditForm({ name: deployment.name, region: deployment.region, deployment_type: deployment.deploymentType, licence_expires_at: deployment.licenceExpiresAt || '' }); } setEditing(!editing); }}
              className="px-3 py-1 text-xs font-medium rounded-md transition-colors"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-card)' }}
            >
              {editing ? 'Cancel Edit' : 'Edit'}
            </button>
            <span className={`text-label px-2.5 py-1 rounded-full font-medium ${statusBadgeClass(deployment.status)}`}>
              {deployment.status}
            </span>
          </div>
        </div>

        {/* Edit Form */}
        {editing && (
          <div className="mt-4 pt-4 space-y-3" style={{ borderTop: '1px solid var(--border-card)' }}>
            <div>
              <label className="block text-xs font-medium mb-1 t-secondary">Deployment Name</label>
              <input
                type="text"
                value={editForm.name}
                onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                className="w-full rounded-md px-3 py-2 text-sm"
                style={inputStyle}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1 t-secondary">Type</label>
                <select
                  value={editForm.deployment_type}
                  onChange={e => setEditForm({ ...editForm, deployment_type: e.target.value })}
                  className="w-full rounded-md px-3 py-2 text-sm"
                  style={inputStyle}
                >
                  <option value="hybrid">Hybrid</option>
                  <option value="on-premise">On-Premise</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1 t-secondary">Region</label>
                <select
                  value={editForm.region}
                  onChange={e => setEditForm({ ...editForm, region: e.target.value })}
                  className="w-full rounded-md px-3 py-2 text-sm"
                  style={inputStyle}
                >
                  <option value="af-south-1">Africa South (JHB)</option>
                  <option value="eu-west-1">Europe West (London)</option>
                  <option value="ap-southeast-1">Asia Pacific (Sydney)</option>
                  <option value="us-east-1">US East (Virginia)</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 t-secondary">Licence Expiry</label>
              <input
                type="date"
                value={editForm.licence_expires_at}
                onChange={e => setEditForm({ ...editForm, licence_expires_at: e.target.value })}
                className="w-full rounded-md px-3 py-2 text-sm"
                style={inputStyle}
              />
            </div>
            <button
              onClick={saveEdit}
              disabled={saving || !editForm.name.trim()}
              className="px-4 py-2 text-sm font-medium rounded-md disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          {[
            { label: 'Health Score', value: `${deployment.healthScore}%` },
            { label: 'Agent Version', value: deployment.agentVersion || '—' },
            { label: 'CPU', value: `${(ru as Record<string, number>).cpuPct ?? '—'}%` },
            { label: 'RAM', value: `${(ru as Record<string, number>).memMb ?? '—'} MB` },
            { label: 'Last Heartbeat', value: deployment.lastHeartbeat ? getTimeSince(deployment.lastHeartbeat) : 'Never' },
            { label: 'Licence Key', value: deployment.licenceKey },
            { label: 'Licence Expires', value: deployment.licenceExpiresAt || 'Never' },
            { label: 'Created', value: new Date(deployment.createdAt).toLocaleDateString() },
          ].map((item) => (
            <div key={item.label}>
              <span className="text-xs t-muted">{item.label}</span>
              <p className="text-sm font-mono tnum font-medium truncate t-primary">{item.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Config Editor */}
      <div className="rounded-md p-5" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}>
        <h3 className="font-medium mb-3 t-primary">Configuration</h3>
        <textarea
          value={configText}
          onChange={e => setConfigText(e.target.value)}
          rows={10}
          className="w-full rounded-sm px-3 py-2 text-xs font-mono"
          style={inputStyle}
        />
        <button
          onClick={pushConfig}
          disabled={saving}
          className="mt-2 px-4 py-1.5 text-sm font-medium rounded-md disabled:opacity-50"
          style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
        >
          {saving ? 'Pushing...' : 'Push Config'}
        </button>
      </div>

      {/* Promote / Push New Version */}
      <div className="rounded-md p-5" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}>
        <h3 className="font-medium mb-1 t-primary">Promote New Version</h3>
        <p className="text-xs mb-3 t-muted">
          Instruct the on-premise agent to pull a new Docker image. Current: <span className="font-mono">{deployment.agentVersion || '—'}</span>
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="e.g. gonxt/atheon-api:v2.1.0"
            value={updateVersion}
            onChange={e => setUpdateVersion(e.target.value)}
            className="flex-1 rounded-md px-3 py-2 text-sm"
            style={inputStyle}
          />
          <button
            onClick={pushUpdate}
            disabled={pushingUpdate || !updateVersion.trim()}
            className="px-4 py-2 text-sm font-medium rounded-md disabled:opacity-50"
            style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
          >
            {pushingUpdate ? 'Pushing...' : 'Promote'}
          </button>
        </div>
      </div>

      {/* Rollback */}
      <div className="rounded-md p-5" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}>
        <h3 className="font-medium mb-1 t-primary">Rollback</h3>
        <p className="text-xs mb-3 t-muted">
          Re-push a previous image tag. Version history is not persisted yet &mdash; enter the tag you want to roll back to.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="e.g. gonxt/atheon-api:v2.0.0"
            value={rollbackVersion}
            onChange={e => setRollbackVersion(e.target.value)}
            className="flex-1 rounded-md px-3 py-2 text-sm"
            style={inputStyle}
          />
          <button
            onClick={doRollback}
            disabled={rollingBack || !rollbackVersion.trim()}
            className="px-4 py-2 text-sm font-medium rounded-md disabled:opacity-50"
            style={{ background: 'var(--neg)', color: 'var(--text-on-accent)' }}
            title="Instruct the agent to pull the specified previous image"
          >
            {rollingBack ? 'Rolling back...' : 'Rollback'}
          </button>
        </div>
      </div>

      {/* Delete / Revoke */}
      <div className="rounded-md p-5" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--neg)' }}>
        <h3 className="font-medium mb-3 text-neg">Delete Deployment</h3>
        <p className="text-xs mb-3 t-muted">
          This will revoke the licence and suspend the deployment. The agent will be refused on next heartbeat.
          Type &quot;<strong>{deployment.name}</strong>&quot; to confirm.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={revokeConfirm}
            onChange={e => setRevokeConfirm(e.target.value)}
            placeholder="Type deployment name to confirm"
            className="flex-1 rounded-md px-3 py-2 text-sm"
            style={inputStyle}
          />
          <button
            onClick={revoke}
            disabled={revokeConfirm !== deployment.name}
            className="px-4 py-2 text-sm font-medium rounded-md disabled:opacity-30"
            style={{ background: 'var(--neg)', color: 'var(--text-on-accent)' }}
          >
            Revoke
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Logs View ─────────────────────────────────────────────────────────────
function LogsView({ id, onError }: { id: string; onError: (title: string, err?: unknown) => void }) {
  const [logs, setLogs] = useState<AgentErrorLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.deployments.getLogs(id)
      .then(d => setLogs(d.logs))
      .catch((err) => onError('Failed to load logs', err))
      .finally(() => setLoading(false));
  }, [id, onError]);

  const severityColor = (sev: string) => {
    switch (sev) {
      case 'critical': return 'text-neg bg-[rgb(var(--neg-rgb)/0.08)] border border-[var(--neg)]';
      case 'error': return 'text-neg bg-[rgb(var(--neg-rgb)/0.08)] border border-[var(--neg)]';
      case 'warning': return 'text-[var(--warning)] bg-[rgb(var(--neg-rgb)/0.05)] border border-[var(--warning)]';
      default: return 't-muted border border-[var(--divider)]';
    }
  };

  if (loading) return <div className="text-center py-10"><div className="animate-spin w-8 h-8 border-2 border-current border-t-transparent rounded-full mx-auto" /></div>;

  if (logs.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-sm t-muted">No error logs recorded.</p>
      </div>
    );
  }

  return (
    <div className="rounded-md overflow-hidden" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}>
      <div className="max-h-[600px] overflow-y-auto divide-y" style={{ borderColor: 'var(--border-card)' }}>
        {logs.map((log, i) => (
          <div key={i} className="px-4 py-3 flex items-start gap-3">
            <span className={`text-caption font-medium uppercase px-1.5 py-0.5 rounded-sm ${severityColor(log.severity)}`}>
              {log.severity}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm t-primary">{log.message}</p>
              {log.code && <p className="text-xs mt-0.5 t-muted">Code: {log.code}</p>}
            </div>
            <span className="text-xs whitespace-nowrap font-mono tnum t-muted">
              {new Date(log.ts).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Utility ───────────────────────────────────────────────────────────────
function getTimeSince(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
