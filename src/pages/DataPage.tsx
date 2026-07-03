/**
 * DataPage (/data) — canonical CONNECT stage. One question: is my data
 * flowing? Sources + freshness + the door to ingest. Read-only for
 * analysts; admin doors (Integrations) shown by role.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Database, ArrowRight } from 'lucide-react';
import { api, type ERPConnection, type Assessment } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { StatusPill, type StatusKind } from '@/components/ui/status-pill';
import { JourneyStageBar } from '@/components/journey/JourneyStageBar';

function syncKind(status: string): StatusKind {
  if (status === 'active' || status === 'connected') return status;
  if (status === 'error' || status === 'failed') return 'failed';
  return 'pending';
}

function syncLabel(lastSync: string | null): string {
  if (!lastSync) return 'never synced';
  const d = new Date(lastSync);
  if (Number.isNaN(d.getTime())) return 'sync time unknown';
  return `synced ${formatDistanceToNow(d, { addSuffix: true })}`;
}

export default function DataPage() {
  const role = useAppStore((s) => s.user?.role);
  const [connections, setConnections] = useState<ERPConnection[] | null | 'error'>(null);
  const [latestAssessment, setLatestAssessment] = useState<Assessment | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [conns, assess] = await Promise.allSettled([api.erp.connections(), api.assessments.list()]);
      if (cancelled) return;
      setConnections(conns.status === 'fulfilled' ? conns.value.connections : 'error');
      if (assess.status === 'fulfilled') {
        const latest = [...assess.value.assessments]
          .filter((a) => a.status === 'complete')
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
        setLatestAssessment(latest ?? null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const isAdmin = role === 'superadmin' || role === 'support_admin' || role === 'admin';

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
      <JourneyStageBar current="connect" />

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
              <Card className="p-4 flex flex-wrap items-center gap-x-4 gap-y-1">
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
              </Card>
            </li>
          ))}
        </ul>
      )}

      {latestAssessment && (
        <p className="mt-6 text-caption t-muted">
          Latest analysis: {latestAssessment.completedAt ? new Date(latestAssessment.completedAt).toLocaleDateString() : new Date(latestAssessment.createdAt).toLocaleDateString()} ·{' '}
          <Link to="/findings" className="text-accent hover:underline">see what it found</Link>
        </p>
      )}
    </div>
  );
}
