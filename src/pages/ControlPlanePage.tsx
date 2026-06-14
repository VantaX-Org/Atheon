/**
 * Agent Control Plane
 * Infrastructure control for Catalyst agent deployments: health, scaling,
 * lifecycle (start/stop/restart), config editing, deletion.
 *
 * Endpoints (all confirmed in workers/api/src/routes/controlplane.ts):
 *   - GET    /api/controlplane/deployments
 *   - POST   /api/controlplane/deployments
 *   - PUT    /api/controlplane/deployments/:id
 *   - DELETE /api/controlplane/deployments/:id
 *   - GET    /api/controlplane/health
 *   - GET    /api/catalysts/clusters  (for the "assign to cluster" dropdown)
 *
 * Scaling: replicas live inside `config.replicas` and are updated via the
 * existing PUT endpoint (config is merged server-side).
 */
import { useEffect, useMemo, useState, useCallback } from "react";
import { Portal } from "@/components/ui/portal";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { AsyncPageContent, statusFrom } from "@/components/ui/async";
import { api, ApiError } from "@/lib/api";
import type { ControlPlaneHealth, DeploymentItem } from "@/lib/api";
import {
  Bot, Play, Square, RefreshCw, Plus, Server, Cloud, GitBranch,
  CheckCircle, XCircle, Activity, ChevronDown, ChevronUp,
  Settings, Shield, Loader2, X, Trash2, TrendingUp,
} from "lucide-react";

const statusConfig: Record<string, { icon: typeof CheckCircle; color: string; label: string }> = {
  running: { icon: CheckCircle, color: 'text-accent', label: 'Running' },
  deploying: { icon: RefreshCw, color: 'text-accent', label: 'Deploying' },
  stopped: { icon: Square, color: 't-muted', label: 'Stopped' },
  error: { icon: XCircle, color: 'text-neg', label: 'Error' },
  pending: { icon: Activity, color: 'text-accent', label: 'Pending' },
};

interface DeploymentConfig {
  replicas?: number;
  maxConcurrentTasks?: number;
  confidenceThreshold?: number;
  escalationPolicy?: string;
  resourceLimits?: { cpuMillicores?: number; memoryMb?: number };
  allowedActions?: string[];
  blockedActions?: string[];
}

function healthVariant(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 80) return 'success';
  if (score >= 60) return 'warning';
  return 'danger';
}

export function ControlPlanePage() {
  const toast = useToast();
  const [expandedDep, setExpandedDep] = useState<string | null>(null);
  const [deployments, setDeployments] = useState<DeploymentItem[]>([]);
  const [health, setHealth] = useState<ControlPlaneHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showDeploy, setShowDeploy] = useState(false);
  const [deployForm, setDeployForm] = useState({ name: '', agent_type: 'catalyst', deployment_model: 'saas', version: '1.0.0', cluster_id: '' });
  const [clusters, setClusters] = useState<{ id: string; name: string }[]>([]);
  const [deploying, setDeploying] = useState(false);
  const [updatingDeployment, setUpdatingDeployment] = useState<string | null>(null);
  const [showEditConfig, setShowEditConfig] = useState(false);
  const [editingDeployment, setEditingDeployment] = useState<DeploymentItem | null>(null);
  const [editVersion, setEditVersion] = useState('');
  const [editConfig, setEditConfig] = useState<DeploymentConfig>({});
  const [showScale, setShowScale] = useState(false);
  const [scalingDeployment, setScalingDeployment] = useState<DeploymentItem | null>(null);
  const [scaleReplicas, setScaleReplicas] = useState(1);

  const reportError = useCallback((title: string, err: unknown) => {
    const message = err instanceof Error ? err.message : undefined;
    const requestId = err instanceof ApiError ? err.requestId : null;
    toast.error(title, { message, requestId });
  }, [toast]);

  const refresh = useCallback(async () => {
    const [d, h] = await Promise.allSettled([
      api.controlplane.deployments(),
      api.controlplane.health(),
    ]);
    if (d.status === 'fulfilled') {
      setDeployments(d.value.deployments);
    } else {
      reportError('Failed to load deployments', d.reason);
    }
    if (h.status === 'fulfilled') {
      setHealth(h.value);
    } else if (h.reason instanceof ApiError && h.reason.status !== 403) {
      reportError('Failed to load platform health', h.reason);
    }
  }, [reportError]);

  const handleDeploy = async () => {
    if (!deployForm.name.trim()) return;
    setDeploying(true);
    try {
      const payload: Record<string, unknown> = {
        name: deployForm.name,
        agent_type: deployForm.agent_type,
        deployment_model: deployForm.deployment_model,
        version: deployForm.version,
      };
      if (deployForm.cluster_id) payload.cluster_id = deployForm.cluster_id;
      await api.controlplane.createDeployment(payload);
      toast.success('Deployment created', `${deployForm.name} is provisioning.`);
      await refresh();
      setShowDeploy(false);
      setDeployForm({ name: '', agent_type: 'catalyst', deployment_model: 'saas', version: '1.0.0', cluster_id: '' });
    } catch (err) {
      reportError('Deploy failed', err);
    }
    setDeploying(false);
  };

  const updateStatus = async (deploymentId: string, status: string) => {
    if (updatingDeployment) return;
    setUpdatingDeployment(deploymentId);
    try {
      await api.controlplane.updateDeployment(deploymentId, { status });
      toast.success(`Deployment ${status === 'running' ? 'started' : status === 'stopped' ? 'stopped' : 'updated'}`);
      await refresh();
    } catch (err) {
      reportError(`Failed to set status to ${status}`, err);
    }
    setUpdatingDeployment(null);
  };

  const restartDeployment = async (deploymentId: string) => {
    if (updatingDeployment) return;
    setUpdatingDeployment(deploymentId);
    try {
      await api.controlplane.updateDeployment(deploymentId, { status: 'deploying' });
      // Brief delay to reflect restart state in the UI before flipping back to running.
      await new Promise(r => setTimeout(r, 800));
      await api.controlplane.updateDeployment(deploymentId, { status: 'running' });
      toast.success('Deployment restarted');
      await refresh();
    } catch (err) {
      reportError('Restart failed', err);
    }
    setUpdatingDeployment(null);
  };

  const openEditDeploymentConfig = (dep: DeploymentItem) => {
    setEditingDeployment(dep);
    setEditVersion(dep.version || '1.0.0');
    setEditConfig((dep.config as DeploymentConfig) || {});
    setShowEditConfig(true);
  };

  const saveDeploymentConfig = async () => {
    if (!editingDeployment || updatingDeployment) return;
    setUpdatingDeployment(editingDeployment.id);
    try {
      await api.controlplane.updateDeployment(editingDeployment.id, {
        version: editVersion,
        config: editConfig,
      });
      toast.success('Configuration saved', 'Applies on next heartbeat/restart.');
      await refresh();
      setShowEditConfig(false);
      setEditingDeployment(null);
    } catch (err) {
      reportError('Failed to save config', err);
    }
    setUpdatingDeployment(null);
  };

  const openScale = (dep: DeploymentItem) => {
    const cfg = dep.config as DeploymentConfig;
    setScalingDeployment(dep);
    setScaleReplicas(typeof cfg.replicas === 'number' ? cfg.replicas : 1);
    setShowScale(true);
  };

  const saveScale = async () => {
    if (!scalingDeployment || updatingDeployment) return;
    setUpdatingDeployment(scalingDeployment.id);
    try {
      await api.controlplane.updateDeployment(scalingDeployment.id, {
        config: { replicas: Math.max(1, scaleReplicas) },
      });
      toast.success(`Scaled to ${scaleReplicas} replica${scaleReplicas === 1 ? '' : 's'}`);
      await refresh();
      setShowScale(false);
      setScalingDeployment(null);
    } catch (err) {
      reportError('Scale failed', err);
    }
    setUpdatingDeployment(null);
  };

  const deleteDeployment = async (deploymentId: string, name: string) => {
    if (updatingDeployment) return;
    if (!confirm(`Delete deployment "${name}"? This action cannot be undone.`)) return;
    setUpdatingDeployment(deploymentId);
    try {
      await api.controlplane.deleteDeployment(deploymentId);
      toast.success('Deployment deleted');
      await refresh();
      setExpandedDep(null);
    } catch (err) {
      reportError('Delete failed', err);
    }
    setUpdatingDeployment(null);
  };

  const manualRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  useEffect(() => {
    async function load() {
      setLoading(true);
      await refresh();
      // Load clusters for the deploy modal — non-critical, may 403 for non-admins.
      try {
        const cl = await api.catalysts.clusters();
        setClusters(cl.clusters.map(c => ({ id: c.id, name: c.name })));
      } catch (err) {
        console.error('Failed to load clusters', err);
      }
      setLoading(false);
    }
    load();
  }, [refresh]);

  // Poll health/deployments every 30s while page is mounted.
  useEffect(() => {
    const t = setInterval(() => { refresh(); }, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  const computed = useMemo(() => {
    const running = deployments.filter(d => d.status === 'running').length;
    const totalReplicas = deployments.reduce((s, d) => {
      const cfg = d.config as DeploymentConfig;
      return s + (typeof cfg.replicas === 'number' ? cfg.replicas : 1);
    }, 0);
    const avgUptime = deployments.length
      ? deployments.reduce((s, d) => s + (d.uptime || 0), 0) / deployments.length
      : 0;
    const avgHealth = deployments.length
      ? deployments.reduce((s, d) => s + (d.healthScore || 0), 0) / deployments.length
      : 0;
    return { running, totalReplicas, avgUptime, avgHealth };
  }, [deployments]);

  const status = statusFrom({ loading, error: null, isEmpty: false });
  if (status !== 'success') {
    return (
      <AsyncPageContent
        status={status}
        onRetry={() => void refresh()}
        loadingVariant="cards"
        loadingCount={4}
      >
        {null}
      </AsyncPageContent>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        eyebrow="Platform · Control Plane"
        title="Control Plane Overview"
        dek="Board-grade service assurance — real-time health & metrics"
        live
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={manualRefresh}
              disabled={refreshing}
              title="Refresh deployments and health"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
            </Button>
            <Button variant="primary" size="sm" onClick={() => setShowDeploy(true)} title="Deploy a new Catalyst agent">
              <Plus size={14} /> Deploy Agent
            </Button>
          </div>
        }
      />

      {/* Deploy Modal */}
      {showDeploy && (
        <Portal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} className="rounded-md p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold t-primary">Deploy New Agent</h3>
              <button onClick={() => setShowDeploy(false)} className="t-muted hover:t-primary"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs t-muted">Agent Name</label>
                <input
                  className="w-full px-3 py-2 rounded-sm border border-[var(--border-card)] text-sm"
                  value={deployForm.name}
                  onChange={e => setDeployForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="finance-catalyst-01"
                />
              </div>
              <div>
                <label className="text-xs t-muted">Agent Type</label>
                <select
                  className="w-full px-3 py-2 rounded-sm border border-[var(--border-card)] text-sm"
                  value={deployForm.agent_type}
                  onChange={e => setDeployForm(p => ({ ...p, agent_type: e.target.value }))}
                >
                  <option value="catalyst">Catalyst</option>
                  <option value="monitor">Monitor</option>
                  <option value="orchestrator">Orchestrator</option>
                </select>
              </div>
              <div>
                <label className="text-xs t-muted">Deployment Model</label>
                <select
                  className="w-full px-3 py-2 rounded-sm border border-[var(--border-card)] text-sm"
                  value={deployForm.deployment_model}
                  onChange={e => setDeployForm(p => ({ ...p, deployment_model: e.target.value }))}
                >
                  <option value="saas">SaaS</option>
                  <option value="on-premise">On-Premise</option>
                  <option value="hybrid">Hybrid</option>
                </select>
              </div>
              {clusters.length > 0 && (
                <div>
                  <label className="text-xs t-muted">Cluster (optional)</label>
                  <select
                    className="w-full px-3 py-2 rounded-sm border border-[var(--border-card)] text-sm"
                    value={deployForm.cluster_id}
                    onChange={e => setDeployForm(p => ({ ...p, cluster_id: e.target.value }))}
                  >
                    <option value="">No cluster</option>
                    {clusters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="text-xs t-muted">Version</label>
                <input
                  className="w-full px-3 py-2 rounded-sm border border-[var(--border-card)] text-sm font-mono"
                  value={deployForm.version}
                  onChange={e => setDeployForm(p => ({ ...p, version: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="secondary" size="sm" onClick={() => setShowDeploy(false)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleDeploy} disabled={deploying || !deployForm.name.trim()}>
                {deploying ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Deploy
              </Button>
            </div>
          </div>
        </div></Portal>
      )}

      {/* Edit Config Modal */}
      {showEditConfig && editingDeployment && (
        <Portal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} className="rounded-md p-6 w-full max-w-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold t-primary">Edit Deployment Config</h3>
              <button
                onClick={() => { setShowEditConfig(false); setEditingDeployment(null); }}
                className="t-muted hover:t-primary"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs t-muted">Version</label>
                <input
                  className="w-full px-3 py-2 rounded-sm border border-[var(--border-card)] text-sm font-mono"
                  value={editVersion}
                  onChange={(e) => setEditVersion(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs t-muted">Replicas</label>
                <input
                  type="number"
                  min={1}
                  className="w-full px-3 py-2 rounded-sm border border-[var(--border-card)] text-sm"
                  value={String(editConfig.replicas ?? 1)}
                  onChange={(e) => setEditConfig((p) => ({ ...p, replicas: Math.max(1, parseInt(e.target.value || '1', 10) || 1) }))}
                />
              </div>
              <div>
                <label className="text-xs t-muted">Max Concurrent Tasks</label>
                <input
                  type="number"
                  min={1}
                  className="w-full px-3 py-2 rounded-sm border border-[var(--border-card)] text-sm"
                  value={String(editConfig.maxConcurrentTasks ?? 10)}
                  onChange={(e) => setEditConfig((p) => ({ ...p, maxConcurrentTasks: Math.max(1, parseInt(e.target.value || '10', 10) || 10) }))}
                />
              </div>
              <div>
                <label className="text-xs t-muted">Confidence Threshold (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="w-full px-3 py-2 rounded-sm border border-[var(--border-card)] text-sm"
                  value={String(Math.round(((editConfig.confidenceThreshold ?? 0.85) as number) * 100))}
                  onChange={(e) => {
                    const pct = Math.min(100, Math.max(0, parseInt(e.target.value || '85', 10) || 0));
                    setEditConfig((p) => ({ ...p, confidenceThreshold: pct / 100 }));
                  }}
                />
              </div>
            </div>

            <p className="text-caption t-muted">Configuration updates apply on next heartbeat/restart.</p>

            <div className="flex gap-3 pt-2">
              <Button variant="secondary" size="sm" onClick={() => { setShowEditConfig(false); setEditingDeployment(null); }}>Cancel</Button>
              <Button
                variant="primary"
                size="sm"
                onClick={saveDeploymentConfig}
                disabled={updatingDeployment === editingDeployment.id}
              >
                {updatingDeployment === editingDeployment.id ? <Loader2 size={14} className="animate-spin" /> : <Settings size={14} />} Save
              </Button>
            </div>
          </div>
        </div></Portal>
      )}

      {/* Scale Modal */}
      {showScale && scalingDeployment && (
        <Portal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} className="rounded-md p-6 w-full max-w-md space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold t-primary">Scale Deployment</h3>
              <button
                onClick={() => { setShowScale(false); setScalingDeployment(null); }}
                className="t-muted hover:t-primary"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-xs t-muted">
              Adjust replica count for <span className="font-medium t-primary">{scalingDeployment.name || scalingDeployment.id}</span>.
              Takes effect on next heartbeat.
            </p>
            <div>
              <label className="text-xs t-muted">Replicas</label>
              <input
                type="number"
                min={1}
                max={50}
                className="w-full px-3 py-2 rounded-sm border border-[var(--border-card)] text-sm"
                value={String(scaleReplicas)}
                onChange={(e) => setScaleReplicas(Math.max(1, Math.min(50, parseInt(e.target.value || '1', 10) || 1)))}
              />
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="secondary" size="sm" onClick={() => { setShowScale(false); setScalingDeployment(null); }}>Cancel</Button>
              <Button
                variant="primary"
                size="sm"
                onClick={saveScale}
                disabled={updatingDeployment === scalingDeployment.id}
              >
                {updatingDeployment === scalingDeployment.id ? <Loader2 size={14} className="animate-spin" /> : <TrendingUp size={14} />} Apply
              </Button>
            </div>
          </div>
        </div></Portal>
      )}

      {/* System Metrics Overview — hero metric + health breakdown + platform stats */}
      <Card variant="prominent" size="relaxed">
        <div className="flex items-center gap-2 mb-5">
          <Activity size={14} className="text-accent" />
          <span className="text-label">System Metrics Overview</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
          {/* Hero: active services */}
          <div className="flex items-baseline gap-3">
            <span className="text-display font-bold t-primary tabular-nums font-mono leading-none">{computed.running}</span>
            <span className="text-label leading-tight max-w-[7rem]">Active<br />Services</span>
          </div>

          {/* RAG health breakdown */}
          <div className="space-y-2.5 lg:border-l lg:pl-6" style={{ borderColor: 'var(--border-card)' }}>
            <div className="flex items-center justify-between gap-4">
              <span className="text-label" style={{ color: 'var(--rag-healthy)' }}>Healthy</span>
              <span className="text-headline-md font-bold tabular-nums font-mono" style={{ color: 'var(--rag-healthy)' }}>
                {Math.round(computed.avgHealth)}%
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-label" style={{ color: 'var(--warning)' }}>Watch</span>
              <span className="text-headline-md font-bold tabular-nums font-mono" style={{ color: 'var(--warning)' }}>
                {deployments.filter(d => d.healthScore >= 60 && d.healthScore < 80).length}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-label" style={{ color: 'var(--neg)' }}>At-Risk</span>
              <span className="text-headline-md font-bold tabular-nums font-mono" style={{ color: 'var(--neg)' }}>
                {deployments.filter(d => d.healthScore < 60).length}
              </span>
            </div>
          </div>

          {/* Platform supporting stats */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 lg:border-l lg:pl-6" style={{ borderColor: 'var(--border-card)' }}>
            <div>
              <span className="text-label block">Total Replicas</span>
              <p className="text-headline-md font-bold t-primary tabular-nums font-mono mt-0.5">{computed.totalReplicas}</p>
            </div>
            <div>
              <span className="text-label block">Avg Uptime</span>
              <p className="text-headline-md font-bold text-accent tabular-nums font-mono mt-0.5">{computed.avgUptime.toFixed(2)}%</p>
            </div>
            {health && (
              <>
                <div>
                  <span className="text-label block">Overall Health</span>
                  <p className="text-headline-md font-bold text-accent tabular-nums font-mono mt-0.5">{health.overallHealth}%</p>
                </div>
                <div>
                  <span className="text-label block">Last Checked</span>
                  <p className="text-headline-sm font-semibold t-primary tabular-nums font-mono mt-0.5">{new Date(health.lastChecked).toLocaleTimeString()}</p>
                </div>
              </>
            )}
            {!health && (
              <div>
                <span className="text-label block">Deployments</span>
                <p className="text-headline-md font-bold t-primary tabular-nums font-mono mt-0.5">{deployments.length}</p>
              </div>
            )}
          </div>
        </div>

        {health && Object.keys(health.deploymentStatus || {}).length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mt-5 pt-4 border-t" style={{ borderColor: 'var(--border-card)' }}>
            <span className="text-label mr-1">Status</span>
            {Object.entries(health.deploymentStatus || {}).map(([s, c]) => (
              <Badge key={s} variant={s === 'running' ? 'success' : s === 'stopped' ? 'danger' : 'default'} size="sm">{s}: {c}</Badge>
            ))}
          </div>
        )}
      </Card>

      {/* Deployments List */}
      {deployments.length === 0 ? (
        <Card size="relaxed" className="text-center">
          <Bot size={24} className="mx-auto t-muted mb-3" />
          <p className="text-label mb-1">No Service Instances</p>
          <p className="text-headline-sm font-semibold t-primary">No deployments yet</p>
          <p className="text-body-sm t-muted mt-1">Click &quot;Deploy Agent&quot; to provision your first Catalyst agent.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {deployments.map((dep) => {
            const sConfig = statusConfig[dep.status] || statusConfig.pending;
            const StatusIcon = sConfig.icon;
            const cfg = dep.config as DeploymentConfig;
            const replicas = typeof cfg.replicas === 'number' ? cfg.replicas : 1;
            const isExpanded = expandedDep === dep.id;
            const hVariant = healthVariant(dep.healthScore);
            const ragColor = hVariant === 'success' ? 'var(--rag-healthy)' : hVariant === 'warning' ? 'var(--warning)' : 'var(--neg)';
            const ragLabel = hVariant === 'success' ? 'Healthy' : hVariant === 'warning' ? 'Watch' : 'At-Risk';
            return (
              <Card
                key={dep.id}
                hover
                className={isExpanded ? 'md:col-span-2 xl:col-span-3' : ''}
                onClick={() => setExpandedDep(isExpanded ? null : dep.id)}
              >
                {/* Eyebrow row: region/tenant + RAG status pill */}
                <div className="flex items-start justify-between gap-3">
                  <span className="text-label truncate" title={dep.tenantName || dep.tenantId}>
                    {dep.tenantName || dep.tenantId}
                  </span>
                  <span
                    className="inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono shrink-0"
                    style={{
                      color: ragColor,
                      borderColor: ragColor,
                      background: `color-mix(in srgb, ${ragColor} 10%, transparent)`,
                    }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: ragColor }} aria-hidden />
                    <span className="text-caption font-bold uppercase tracking-wide">{ragLabel}</span>
                  </span>
                </div>

                {/* Hero metric: uptime + mono data label */}
                <div className="flex items-baseline gap-3 mt-3">
                  <span className="text-display font-bold t-primary tabular-nums font-mono leading-none">
                    {dep.uptime.toFixed(dep.uptime % 1 === 0 ? 0 : 1)}<span className="text-headline-md">%</span>
                  </span>
                  <div className="min-w-0">
                    <p className="text-label leading-tight">Uptime</p>
                    <p className="text-headline-sm font-semibold t-primary truncate mt-0.5" title={dep.name || dep.clusterName || dep.id}>
                      {dep.name || dep.clusterName || dep.id}
                    </p>
                  </div>
                  <span className="ml-auto self-start">
                    {isExpanded ? <ChevronUp size={16} className="t-muted" /> : <ChevronDown size={16} className="t-muted" />}
                  </span>
                </div>

                {/* Sub-stat row */}
                <div className="grid grid-cols-3 gap-3 mt-4">
                  <div>
                    <span className="text-label block">Health</span>
                    <p className="text-headline-sm font-bold tabular-nums font-mono mt-0.5" style={{ color: ragColor }}>{dep.healthScore}%</p>
                  </div>
                  <div>
                    <span className="text-label block">Replicas</span>
                    <p className="text-headline-sm font-bold t-primary tabular-nums font-mono mt-0.5">{replicas}</p>
                  </div>
                  <div>
                    <span className="text-label block">Tasks</span>
                    <p className="text-headline-sm font-bold t-primary tabular-nums font-mono mt-0.5">{dep.tasksExecuted.toLocaleString()}</p>
                  </div>
                </div>

                {/* Footer: active state + model + agent type */}
                <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t" style={{ borderColor: 'var(--border-card)' }}>
                  <div className="flex items-center gap-1.5">
                    <StatusIcon size={13} className={sConfig.color} />
                    <span className={`text-caption font-mono font-bold uppercase tracking-wide ${sConfig.color}`}>{sConfig.label}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={dep.deploymentModel === 'saas' ? 'info' : dep.deploymentModel === 'on-premise' ? 'warning' : 'default'} size="sm">
                      {dep.deploymentModel === 'saas' && <Cloud size={10} className="mr-1" />}
                      {dep.deploymentModel === 'on-premise' && <Server size={10} className="mr-1" />}
                      {dep.deploymentModel === 'hybrid' && <GitBranch size={10} className="mr-1" />}
                      {dep.deploymentModel}
                    </Badge>
                    <Badge variant="outline" size="sm">{dep.agentType}</Badge>
                  </div>
                </div>

                {/* Secondary stats — version + heartbeat, mono data voice */}
                <div className="flex items-center justify-between gap-3 mt-3 text-caption font-mono t-muted">
                  <span>v{dep.version}</span>
                  <span>{dep.lastHeartbeat ? new Date(dep.lastHeartbeat).toLocaleTimeString() : 'N/A'}</span>
                </div>

                {isExpanded && (
                  <div className="mt-4 space-y-4 animate-fadeIn">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Config */}
                      <div className="p-4 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                        <h4 className="text-sm font-semibold t-primary mb-3 flex items-center gap-2">
                          <Settings size={14} className="text-accent" /> Configuration
                        </h4>
                        <div className="space-y-2 text-xs">
                          <div className="flex justify-between"><span className="t-muted">Replicas</span><span className="t-primary font-mono tnum">{replicas}</span></div>
                          <div className="flex justify-between"><span className="t-muted">Max Concurrent Tasks</span><span className="t-primary font-mono tnum">{cfg.maxConcurrentTasks ?? 'N/A'}</span></div>
                          <div className="flex justify-between"><span className="t-muted">Confidence Threshold</span><span className="t-primary font-mono tnum">{typeof cfg.confidenceThreshold === 'number' ? `${Math.round(cfg.confidenceThreshold * 100)}%` : 'N/A'}</span></div>
                          <div className="flex justify-between"><span className="t-muted">Escalation Policy</span><Badge variant="outline" size="sm">{cfg.escalationPolicy ?? 'N/A'}</Badge></div>
                          <div className="flex justify-between"><span className="t-muted">CPU / Memory</span><span className="t-primary font-mono tnum">{cfg.resourceLimits?.cpuMillicores ?? '?'}m / {cfg.resourceLimits?.memoryMb ?? '?'}MB</span></div>
                        </div>
                      </div>

                      {/* Permissions */}
                      <div className="p-4 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                        <h4 className="text-sm font-semibold t-primary mb-3 flex items-center gap-2">
                          <Shield size={14} className="text-accent" /> Action Permissions
                        </h4>
                        <div className="space-y-2">
                          <div>
                            <span className="text-caption t-muted">Allowed Actions</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {(Array.isArray(cfg.allowedActions) ? cfg.allowedActions : []).map((a: string) => (
                                <Badge key={a} variant="success" size="sm">{a}</Badge>
                              ))}
                              {(!cfg.allowedActions || (Array.isArray(cfg.allowedActions) && cfg.allowedActions.length === 0)) && (
                                <span className="text-xs t-secondary">None</span>
                              )}
                            </div>
                          </div>
                          <div>
                            <span className="text-caption t-muted">Blocked Actions</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {(Array.isArray(cfg.blockedActions) ? cfg.blockedActions : []).map((a: string) => (
                                <Badge key={a} variant="danger" size="sm">{a}</Badge>
                              ))}
                              {(!cfg.blockedActions || (Array.isArray(cfg.blockedActions) && cfg.blockedActions.length === 0)) && (
                                <span className="text-xs t-secondary">None</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {dep.status === 'running' && (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); updateStatus(dep.id, 'stopped'); }}
                          disabled={updatingDeployment === dep.id}
                          title="Stop this deployment"
                        >
                          <Square size={12} /> Stop
                        </Button>
                      )}
                      {dep.status === 'stopped' && (
                        <Button
                          variant="success"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); updateStatus(dep.id, 'running'); }}
                          disabled={updatingDeployment === dep.id}
                          title="Start this deployment"
                        >
                          <Play size={12} /> Start
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); restartDeployment(dep.id); }}
                        disabled={updatingDeployment === dep.id}
                        title="Restart this deployment"
                      >
                        <RefreshCw size={12} /> Restart
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); openScale(dep); }}
                        disabled={updatingDeployment === dep.id}
                        title="Adjust replica count"
                      >
                        <TrendingUp size={12} /> Scale
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); openEditDeploymentConfig(dep); }}
                        disabled={updatingDeployment === dep.id}
                        title="Edit deployment configuration"
                      >
                        <Settings size={12} /> Edit Config
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); deleteDeployment(dep.id, dep.name || dep.id); }}
                        disabled={updatingDeployment === dep.id}
                        title="Permanently delete this deployment"
                      >
                        <Trash2 size={12} /> Delete
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
