/**
 * DataPage (/data) — canonical CONNECT stage. One question: is my data
 * flowing? KPIs (sources, broken, freshness, volume) + one-click re-sync +
 * the door to ingest. Broken connections are loud; healthy data points
 * forward to Findings. Admin doors (Integrations) shown by role.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Database, ArrowRight, RefreshCw } from 'lucide-react';
import { api, type ERPConnection, type Assessment } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { StatusPill, type StatusKind } from '@/components/ui/status-pill';
import { useToast } from '@/components/ui/toast';
import { latestCompleteAssessment } from '@/lib/latest-assessment';

function syncKind(status: string): StatusKind {
  if (status === 'active' || status === 'connected') return status;
  if (status === 'error' || status === 'failed') return 'failed';
  return 'pending';
}

function isBroken(c: ERPConnection): boolean {
  return c.status === 'error' || c.status === 'failed';
}

function syncLabel(lastSync: string | null): string {
  if (!lastSync) return 'never synced';
  const d = new Date(lastSync);
  if (Number.isNaN(d.getTime())) return 'sync time unknown';
  return `synced ${formatDistanceToNow(d, { addSuffix: true })}`;
}

/** Most recent valid lastSync across all connections; null if none ever synced. */
function newestSync(conns: ERPConnection[]): Date | null {
  let latest: Date | null = null;
  for (const c of conns) {
    if (!c.lastSync) continue;
    const d = new Date(c.lastSync);
    if (Number.isNaN(d.getTime())) continue;
    if (!latest || d > latest) latest = d;
  }
  return latest;
}

export default function DataPage() {
  const role = useAppStore((s) => s.user?.role);
  const toast = useToast();
  const [connections, setConnections] = useState<ERPConnection[] | null | 'error'>(null);
  const [latestAssessment, setLatestAssessment] = useState<Assessment | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [conns, assess] = await Promise.allSettled([api.erp.connections(), api.assessments.list()]);
      if (cancelled) return;
      setConnections(conns.status === 'fulfilled' ? conns.value.connections : 'error');
      if (assess.status === 'fulfilled') {
        setLatestAssessment(latestCompleteAssessment(assess.value.assessments));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSync = async (id: string) => {
    setSyncing(id);
    try {
      const r = await api.erp.sync(id);
      toast.success('Sync complete', `${r.recordsSynced.toLocaleString()} records synced`);
      const refreshed = await api.erp.connections();
      setConnections(refreshed.connections);
    } catch (err) {
      toast.error('Sync failed', { message: err instanceof Error ? err.message : undefined });
    }
    setSyncing(null);
  };

  const isAdmin = role === 'superadmin' || role === 'support_admin' || role === 'admin';

  const conns = Array.isArray(connections) ? connections : null;
  const brokenCount = conns ? conns.filter(isBroken).length : 0;
  const totalRecords = conns ? conns.reduce((s, c) => s + (c.recordsSynced || 0), 0) : 0;
  const lastSync = conns ? newestSync(conns) : null;
  const healthy = conns !== null && conns.length > 0 && brokenCount === 0;

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        eyebrow="Journey · 01 Connect"
        title="Data"
        dek="Where your numbers come from — every finding traces back to a record synced here."
        actions={isAdmin ? (
          <Link to="/integrations" className="text-caption font-medium text-accent hover:underline inline-flex items-center gap-1">
            Manage integrations <ArrowRight size={11} aria-hidden="true" />
          </Link>
        ) : undefined}
      />

      {conns && conns.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <Card className="p-4">
            <p className="text-figure font-mono tnum t-primary leading-none">{conns.length}</p>
            <p className="text-label mt-1.5">Sources connected</p>
          </Card>
          <Card className="p-4">
            <p
              className="text-figure font-mono tnum leading-none"
              style={{ color: brokenCount > 0 ? 'var(--neg)' : 'var(--rag-healthy)' }}
            >
              {brokenCount}
            </p>
            <p className="text-label mt-1.5">Broken connections</p>
          </Card>
          <Card className="p-4">
            <p className="text-figure font-mono tnum t-primary leading-none">
              {lastSync ? formatDistanceToNow(lastSync, { addSuffix: true }) : '—'}
            </p>
            <p className="text-label mt-1.5">Last successful sync</p>
          </Card>
          <Card className="p-4">
            <p className="text-figure font-mono tnum t-primary leading-none">{totalRecords.toLocaleString()}</p>
            <p className="text-label mt-1.5">Records ingested</p>
          </Card>
        </div>
      )}

      {brokenCount > 0 && conns && (
        <Card className="p-4 mb-6 border-l-2 flex flex-wrap items-center gap-3" style={{ borderLeftColor: 'var(--neg)' }}>
          <div className="flex-1 min-w-0">
            <p className="t-primary font-medium">
              {brokenCount} source{brokenCount === 1 ? ' is' : 's are'} not syncing.
            </p>
            <p className="text-caption t-muted">
              Findings go stale without fresh records — re-sync below{isAdmin ? ' or check credentials in Integrations' : ', or ask your administrator to check credentials'}.
            </p>
          </div>
          {isAdmin && (
            <Link to="/integrations" className="text-caption font-medium text-accent hover:underline inline-flex items-center gap-1">
              Fix in Integrations <ArrowRight size={11} aria-hidden="true" />
            </Link>
          )}
        </Card>
      )}

      {connections === null ? (
        <div className="space-y-2" aria-hidden="true">
          {[0, 1, 2].map((i) => <div key={i} className="h-14 rounded animate-pulse" style={{ background: 'var(--border-card)' }} />)}
        </div>
      ) : connections === 'error' ? (
        <Card className="p-8 text-center">
          <Database size={22} className="mx-auto t-muted" aria-hidden="true" />
          <p className="mt-3 t-primary font-medium">Couldn't load your sources.</p>
          <p className="mt-1 text-caption t-muted">
            Refresh to try again — this is a loading problem, not your data.
          </p>
        </Card>
      ) : connections.length === 0 ? (
        <Card className="p-8 text-center">
          <Database size={22} className="mx-auto t-muted" aria-hidden="true" />
          <p className="mt-3 t-primary font-medium">Connect your data</p>
          <p className="mt-1 text-caption t-muted">
            Atheon finds exposure in your ERP records. {isAdmin
              ? <Link to="/integrations" className="text-accent hover:underline">Connect an ERP or upload data</Link>
              : 'Ask your administrator to connect an ERP source.'}
          </p>
        </Card>
      ) : (
        <ul className="space-y-2" aria-label="Connected sources">
          {connections.map((c) => (
            <li key={c.id}>
              <Card
                className={`p-4 flex flex-wrap items-center gap-x-4 gap-y-1${isBroken(c) ? ' border-l-2' : ''}`}
                style={isBroken(c) ? { borderLeftColor: 'var(--neg)' } : undefined}
              >
                <div className="min-w-0 flex-1">
                  <p className="t-primary font-medium truncate">{c.name}</p>
                  <p className="text-caption t-muted truncate">{c.adapterName}</p>
                </div>
                <p className="text-caption t-muted tabular-nums">
                  {c.recordsSynced.toLocaleString()} records
                </p>
                <p className="text-caption t-muted">
                  {syncLabel(c.lastSync)}
                </p>
                <StatusPill status={syncKind(c.status)} />
                <button
                  type="button"
                  onClick={() => handleSync(c.id)}
                  disabled={syncing !== null}
                  className="text-caption font-medium text-accent hover:underline inline-flex items-center gap-1 disabled:opacity-50"
                >
                  <RefreshCw size={11} className={syncing === c.id ? 'animate-spin' : ''} aria-hidden="true" />
                  Re-sync
                </button>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {healthy ? (
        <Card className="mt-6 p-4 border-l-2 flex flex-wrap items-center gap-3" style={{ borderLeftColor: 'var(--rag-healthy)' }}>
          <div className="flex-1 min-w-0">
            <p className="t-primary font-medium">Your data is flowing.</p>
            <p className="text-caption t-muted">
              {latestAssessment
                ? `Latest analysis ${(latestAssessment.completedAt ? new Date(latestAssessment.completedAt) : new Date(latestAssessment.createdAt)).toLocaleDateString()} — see what it found in these records.`
                : 'Next step: review what Atheon found in these records.'}
            </p>
          </div>
          <Link to="/findings" className="text-caption font-medium text-accent hover:underline inline-flex items-center gap-1">
            Review findings <ArrowRight size={11} aria-hidden="true" />
          </Link>
        </Card>
      ) : latestAssessment && (
        <p className="mt-6 text-caption t-muted">
          Latest analysis: {latestAssessment.completedAt ? new Date(latestAssessment.completedAt).toLocaleDateString() : new Date(latestAssessment.createdAt).toLocaleDateString()} ·{' '}
          <Link to="/findings" className="text-accent hover:underline">see what it found</Link>
        </p>
      )}
    </div>
  );
}
