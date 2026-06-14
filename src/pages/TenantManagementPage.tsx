import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import {
  Users, Database, Trash2, RotateCcw, Download, Shield, AlertTriangle,
  CheckCircle, XCircle, Search, Eye, Activity, TrendingUp,
  Building2, Calendar, HardDrive, FileJson, ArrowLeft, Zap
} from "lucide-react";
import { format } from 'date-fns';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  industry?: string;
  plan?: string;
  status: string;
  deployment_model?: string;
  region?: string;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
  deleted_at?: string;
  deleted_by?: string;
  data: {
    runs: number;
    metrics: number;
    risks: number;
    users: number;
  };
}

interface TenantDetails extends Tenant {
  data: {
    runs: number;
    metrics: number;
    risks: number;
    healthScores: number;
    briefings: number;
    users: number;
    clusters: number;
    runItems: number;
  };
}

export function TenantManagementPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<TenantDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'deleted'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Load once on mount. loadTenants is a stable function reference — it
  // only reads/writes setState — so disabling the exhaustive-deps check
  // is safe here and avoids re-fetching on every render.
  useEffect(() => {
    loadTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTenants = async () => {
    try {
      setLoading(true);
      const data = await api.get<{ tenants: Tenant[] }>('/api/v1/admin/tenants');
      setTenants(data.tenants);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load tenants';
      setError(message);
      toast.error('Failed to load tenants', {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
    }
  };

  const loadTenantDetails = async (tenantId: string) => {
    try {
      setActionLoading(tenantId);
      const data = await api.get<{ tenant: TenantDetails }>(`/api/v1/admin/tenants/${tenantId}`);
      setSelectedTenant(data.tenant);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load details';
      setError(message);
      toast.error('Failed to load tenant details', {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleSoftDelete = async (tenantId: string) => {
    if (!confirm(`Are you sure you want to soft-delete "${tenants.find(t => t.id === tenantId)?.name}"?\n\nThis will:\n- Suspend all users\n- Mark tenant as deleted\n- Keep all data intact\n- Allow reactivation within 24 hours`)) {
      return;
    }

    try {
      setActionLoading(tenantId);
      const data = await api.post<{ message: string }>(`/api/v1/admin/tenants/${tenantId}/soft-delete`);
      toast.success('Tenant soft-deleted', { message: data.message });
      loadTenants();
      setSelectedTenant(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to soft-delete tenant';
      toast.error('Soft-delete failed', {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleReactivate = async (tenantId: string) => {
    if (!confirm(`Reactivate "${tenants.find(t => t.id === tenantId)?.name}"?\n\nThis will:\n- Restore tenant access\n- Reactivate all users\n- Clear deletion timestamp`)) {
      return;
    }

    try {
      setActionLoading(tenantId);
      const data = await api.post<{ message: string }>(`/api/v1/admin/tenants/${tenantId}/reactivate`);
      toast.success('Tenant reactivated', { message: data.message });
      loadTenants();
      setSelectedTenant(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reactivate tenant';
      toast.error('Reactivate failed', {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleExport = async (tenantId: string, tenantSlug?: string) => {
    try {
      setActionLoading(tenantId);
      const data = await api.get<Record<string, unknown>>(`/api/v1/admin/tenants/${tenantId}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tenant-export-${tenantSlug}-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success('Export downloaded', { message: `tenant-export-${tenantSlug}.json` });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to export tenant';
      toast.error('Export failed', {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleHardDelete = async (tenantId: string) => {
    if (!confirm(`DANGER: PERMANENT DELETION\n\nThis will IRREVERSIBLY delete:\n- All tenant data\n- All users\n- All runs, metrics, risks\n- All history and audit logs\n\nThis action CANNOT be undone.\n\nType "DELETE" to confirm:`)) {
      return;
    }

    // Additional confirmation
    const confirmation = prompt('Type "DELETE" to confirm permanent deletion:');
    if (confirmation !== 'DELETE') {
      return;
    }

    try {
      setActionLoading(tenantId);
      const data = await api.delete<{ message: string; audit: { totalRecordsDeleted: number } }>(`/api/v1/admin/tenants/${tenantId}/hard-delete`);
      toast.success('Tenant permanently deleted', {
        message: `${data.message} — ${data.audit.totalRecordsDeleted.toLocaleString()} records removed`,
      });
      loadTenants();
      setSelectedTenant(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to hard-delete tenant';
      toast.error('Hard-delete failed', {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setActionLoading(null);
    }
  };

  const filteredTenants = tenants.filter(tenant => {
    const matchesFilter =
      filter === 'all' ||
      (filter === 'active' && !tenant.is_deleted) ||
      (filter === 'deleted' && tenant.is_deleted);

    const matchesSearch =
      tenant.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tenant.slug.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesFilter && matchesSearch;
  });

  const stats = {
    total: tenants.length,
    active: tenants.filter(t => !t.is_deleted).length,
    deleted: tenants.filter(t => t.is_deleted).length,
    totalRuns: tenants.reduce((sum, t) => sum + t.data.runs, 0),
    totalUsers: tenants.reduce((sum, t) => sum + t.data.users, 0),
  };

  if (selectedTenant) {
    return (
      <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-8">
        {/* Editorial masthead — mono eyebrow, display name, plan + status */}
        <header>
          <Button variant="ghost" size="sm" onClick={() => setSelectedTenant(null)} className="mb-5 -ml-2">
            <ArrowLeft size={16} className="mr-2" />
            Back to List
          </Button>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <p className="text-label mb-2">Tenant Management · Detail</p>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-display t-primary leading-tight">{selectedTenant.name}</h1>
                {selectedTenant.plan && (
                  <span className="pill pill-accent capitalize">{selectedTenant.plan} Plan</span>
                )}
              </div>
              <p className="text-label mt-2 normal-case tracking-normal" style={{ letterSpacing: 0 }}>{selectedTenant.slug}</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className={selectedTenant.is_deleted ? 'pill pill-danger' : 'pill pill-success'}>
                <span
                  aria-hidden
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ background: 'currentColor' }}
                />
                {selectedTenant.is_deleted ? 'Deleted' : 'Healthy'}
              </span>
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleExport(selectedTenant.id, selectedTenant.slug)}
                disabled={!!actionLoading}
              >
                <Download size={14} className="mr-2" />
                Export Data
              </Button>
            </div>
          </div>
        </header>

        {actionLoading === selectedTenant.id && (
          <div className="p-3 border border-[var(--border-card)] rounded-lg flex items-center gap-3" style={{ background: 'var(--bg-secondary)' }}>
            <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
            <span className="text-sm t-muted">Loading...</span>
          </div>
        )}

        {/* Hero metrics — big mono numbers, mono data labels */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          {[
            { label: 'Users', value: selectedTenant.data.users.toLocaleString(), icon: Users },
            { label: 'Runs', value: selectedTenant.data.runs.toLocaleString(), icon: Activity },
            { label: 'Metrics', value: selectedTenant.data.metrics.toLocaleString(), icon: TrendingUp },
            { label: 'Risks', value: selectedTenant.data.risks.toLocaleString(), icon: AlertTriangle },
          ].map(({ label, value, icon: Icon }) => (
            <Card key={label}>
              <div className="p-6">
                <p className="text-5xl font-bold t-primary tracking-tight leading-none font-mono tabular-nums">{value}</p>
                <div className="flex items-center gap-1.5 mt-3">
                  <Icon size={13} className="t-muted" />
                  <span className="text-label">{label}</span>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Tenant Info Card */}
        <Card>
          <div className="p-6 space-y-5">
            <p className="text-label">Tenant Profile</p>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-lg border border-[var(--border-card)]" style={{ background: 'var(--bg-secondary)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <Building2 size={13} className="t-muted" />
                  <span className="text-label">Industry</span>
                </div>
                <p className="text-headline-sm t-primary">{selectedTenant.industry || 'N/A'}</p>
              </div>
              <div className="p-4 rounded-lg border border-[var(--border-card)]" style={{ background: 'var(--bg-secondary)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <Shield size={13} className="t-muted" />
                  <span className="text-label">Plan</span>
                </div>
                <p className="text-headline-sm t-primary capitalize">{selectedTenant.plan || 'N/A'}</p>
              </div>
              <div className="p-4 rounded-lg border border-[var(--border-card)]" style={{ background: 'var(--bg-secondary)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <HardDrive size={13} className="t-muted" />
                  <span className="text-label">Deployment</span>
                </div>
                <p className="text-headline-sm t-primary capitalize">{selectedTenant.deployment_model || 'N/A'}</p>
              </div>
              <div className="p-4 rounded-lg border border-[var(--border-card)]" style={{ background: 'var(--bg-secondary)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <Calendar size={13} className="t-muted" />
                  <span className="text-label">Created</span>
                </div>
                <p className="text-headline-sm t-primary">
                  {format(new Date(selectedTenant.created_at), 'MMM d, yyyy')}
                </p>
              </div>
            </div>

            {selectedTenant.is_deleted && (
              <div className="p-4 rounded-lg border" style={{ background: 'rgb(var(--neg-rgb) / 0.08)', borderColor: 'var(--neg)' }}>
                <div className="flex items-start gap-3">
                  <AlertTriangle size={20} style={{ color: 'var(--neg)' }} className="flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium mb-1" style={{ color: 'var(--neg)' }}>Tenant Soft-Deleted</p>
                    <p className="text-xs" style={{ color: 'var(--neg)', opacity: 0.8 }}>
                      Deleted: {format(new Date(selectedTenant.deleted_at!), 'PPP p')}
                      {selectedTenant.deleted_by && ` by ${selectedTenant.deleted_by}`}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Data Statistics */}
        <Card>
          <div className="p-6">
            <div className="flex items-center gap-2 mb-5">
              <Database size={14} className="text-accent" />
              <p className="text-label" style={{ color: 'var(--accent)' }}>Data Statistics</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Users', value: selectedTenant.data.users, icon: Users },
                { label: 'Clusters', value: selectedTenant.data.clusters, icon: Building2 },
                { label: 'Runs', value: selectedTenant.data.runs, icon: Activity },
                { label: 'Run Items', value: selectedTenant.data.runItems, icon: FileJson },
                { label: 'Metrics', value: selectedTenant.data.metrics, icon: TrendingUp },
                { label: 'Risks', value: selectedTenant.data.risks, icon: AlertTriangle },
                { label: 'Health Scores', value: selectedTenant.data.healthScores, icon: CheckCircle },
                { label: 'Briefings', value: selectedTenant.data.briefings, icon: FileJson },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="p-4 rounded-lg border border-[var(--border-card)]" style={{ background: 'var(--bg-secondary)' }}>
                  <p className="text-headline-xl font-bold t-primary tracking-tight leading-tight font-mono tabular-nums">{value.toLocaleString()}</p>
                  <div className="flex items-center gap-1.5 mt-2">
                    <Icon size={13} className="t-muted" />
                    <span className="text-label">{label}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Actions */}
        <Card>
          <div className="p-6">
            <div className="flex items-center gap-2 mb-5">
              <Shield size={14} className="text-accent" />
              <p className="text-label" style={{ color: 'var(--accent)' }}>Administrative Actions</p>
            </div>
            <div className="flex flex-wrap gap-3">
              {!selectedTenant.is_deleted ? (
                <Button
                  variant="secondary"
                  onClick={() => handleSoftDelete(selectedTenant.id)}
                  disabled={!!actionLoading || selectedTenant.slug === 'vantax'}
                  style={{ background: 'rgb(var(--neg-rgb) / 0.08)', color: 'var(--neg)', borderColor: 'rgb(var(--neg-rgb) / 0.2)' }}
                >
                  <Trash2 size={14} className="mr-2" />
                  Soft-Delete Tenant
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={() => handleReactivate(selectedTenant.id)}
                  disabled={!!actionLoading}
                >
                  <RotateCcw size={14} className="mr-2" />
                  Reactivate Tenant
                </Button>
              )}

              {selectedTenant.is_deleted && (
                <Button
                  variant="secondary"
                  onClick={() => handleHardDelete(selectedTenant.id)}
                  disabled={!!actionLoading}
                  style={{ background: 'var(--neg)', color: '#fff', borderColor: 'var(--neg)' }}
                >
                  <Trash2 size={14} className="mr-2" />
                  Permanently Delete (After 24h)
                </Button>
              )}

              <Button
                variant="ghost"
                onClick={() => handleExport(selectedTenant.id, selectedTenant.slug)}
                disabled={!!actionLoading}
              >
                <Download size={14} className="mr-2" />
                Export All Data
              </Button>

              <Link to={`/admin/tenants/${selectedTenant.id}/llm`}>
                <Button variant="ghost" disabled={!!actionLoading}>
                  <Zap size={14} className="mr-2" />
                  LLM Budget & Redaction
                </Button>
              </Link>
            </div>

            {selectedTenant.slug === 'vantax' && (
              <div className="mt-4 p-3 rounded-md border border-[var(--border-card)]" style={{ background: 'var(--bg-secondary)' }}>
                <p className="text-xs t-secondary">
                  ℹ️ This is the VantaX demo tenant. Use the seeder endpoint to reset data instead of deletion.
                </p>
              </div>
            )}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-8">
      <PageHeader
        eyebrow="Tenants · Management"
        title="Tenant Management"
        dek="Superadmin-only tenant administration"
      />

      {/* Hero metrics — big mono numbers anchored by mono data labels */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-5">
        <Card>
          <div className="p-6">
            <p className="text-4xl font-bold t-primary tracking-tight leading-none font-mono tabular-nums">{stats.total}</p>
            <div className="flex items-center gap-1.5 mt-3">
              <Building2 size={13} className="t-muted" />
              <span className="text-label">Total</span>
            </div>
          </div>
        </Card>
        <Card>
          <div className="p-6">
            <p className="text-4xl font-bold text-accent tabular-nums font-mono tracking-tight leading-none">{stats.active}</p>
            <div className="flex items-center gap-1.5 mt-3">
              <CheckCircle size={13} className="text-accent" />
              <span className="text-label">Active</span>
            </div>
          </div>
        </Card>
        <Card>
          <div className="p-6">
            <p className="text-4xl font-bold tabular-nums font-mono tracking-tight leading-none" style={{ color: 'var(--neg)' }}>{stats.deleted}</p>
            <div className="flex items-center gap-1.5 mt-3">
              <XCircle size={13} style={{ color: 'var(--neg)' }} />
              <span className="text-label">Deleted</span>
            </div>
          </div>
        </Card>
        <Card>
          <div className="p-6">
            <p className="text-4xl font-bold t-primary tabular-nums font-mono tracking-tight leading-none">{stats.totalRuns.toLocaleString()}</p>
            <div className="flex items-center gap-1.5 mt-3">
              <Activity size={13} className="t-muted" />
              <span className="text-label">Total Runs</span>
            </div>
          </div>
        </Card>
        <Card>
          <div className="p-6">
            <p className="text-4xl font-bold t-primary tabular-nums font-mono tracking-tight leading-none">{stats.totalUsers.toLocaleString()}</p>
            <div className="flex items-center gap-1.5 mt-3">
              <Users size={13} className="t-muted" />
              <span className="text-label">Total Users</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <div className="p-4 flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 t-muted" />
            <input
              type="text"
              placeholder="Search tenants..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-[var(--border-card)] rounded-lg text-sm t-primary placeholder:t-muted focus:outline-none focus:border-[var(--accent)]"
              style={{ background: 'var(--bg-secondary)' }}
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant={filter === 'all' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setFilter('all')}
            >
              All
            </Button>
            <Button
              variant={filter === 'active' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setFilter('active')}
            >
              Active
            </Button>
            <Button
              variant={filter === 'deleted' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setFilter('deleted')}
            >
              Deleted
            </Button>
          </div>
        </div>
      </Card>

      {/* Error */}
      {error && (
        <div className="p-4 border rounded-md flex items-center gap-3" style={{ background: 'rgb(var(--neg-rgb) / 0.08)', borderColor: 'var(--neg)' }}>
          <AlertTriangle size={18} style={{ color: 'var(--neg)' }} className="flex-shrink-0" />
          <p className="text-sm" style={{ color: 'var(--neg)' }}>{error}</p>
          <button onClick={() => setError(null)} className="ml-auto" style={{ color: 'var(--neg)' }}>
            <XCircle size={16} />
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        </div>
      )}

      {/* Tenant List */}
      {!loading && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border-card)]">
                  <th className="text-left p-4"><span className="text-label">Tenant</span></th>
                  <th className="text-left p-4"><span className="text-label">Plan</span></th>
                  <th className="text-left p-4"><span className="text-label">Status</span></th>
                  <th className="text-center p-4"><span className="text-label">Runs</span></th>
                  <th className="text-center p-4"><span className="text-label">Users</span></th>
                  <th className="text-left p-4"><span className="text-label">Created</span></th>
                  <th className="text-right p-4"><span className="text-label">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredTenants.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center t-muted">
                      No tenants found
                    </td>
                  </tr>
                ) : (
                  filteredTenants.map((tenant) => (
                    <tr key={tenant.id} className="border-b border-[var(--border-card)] hover:bg-[var(--bg-secondary)]">
                      <td className="p-4">
                        <div>
                          <p className="text-sm font-medium t-primary">{tenant.name}</p>
                          <p className="text-xs t-muted">{tenant.slug}</p>
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="pill pill-accent capitalize">{tenant.plan || 'N/A'}</span>
                      </td>
                      <td className="p-4">
                        {tenant.is_deleted ? (
                          <span className="pill pill-danger">
                            <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: 'currentColor' }} />
                            Deleted
                          </span>
                        ) : (
                          <span className="pill pill-success">
                            <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: 'currentColor' }} />
                            Healthy
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-center text-sm t-secondary font-mono tabular-nums">{tenant.data.runs.toLocaleString()}</td>
                      <td className="p-4 text-center text-sm t-secondary font-mono tabular-nums">{tenant.data.users.toLocaleString()}</td>
                      <td className="p-4 text-sm t-muted">
                        {format(new Date(tenant.created_at), 'MMM d, yyyy')}
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => loadTenantDetails(tenant.id)}
                            disabled={!!actionLoading}
                            title="View details"
                          >
                            <Eye size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate(`/admin/tenants/${tenant.id}/llm`)}
                            disabled={!!actionLoading}
                            title="LLM budget & redaction"
                          >
                            <Zap size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleExport(tenant.id)}
                            disabled={!!actionLoading}
                            title="Export data"
                          >
                            <Download size={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
