/**
 * /status — public platform status + incident timeline (Phase AZ).
 *
 * Procurement teams probe this URL during vendor risk assessments at
 * 3000+-headcount enterprises. The page polls /api/status every 30s and
 * renders:
 *   - One-line overall status banner (operational / degraded / outage)
 *   - 4 component tiles (API / database / cache / storage)
 *   - DR / RTO / RPO / data residency disclosure block
 *   - 90-day incident timeline with per-incident update chronology
 *
 * Public — no auth, no role checks, no tenant scope. Same data is
 * returned regardless of who's looking.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AsyncPageContent, statusFrom } from '@/components/ui/async';
import { api, ApiError } from '@/lib/api';
import type { StatusIncident } from '@/lib/api';
import {
  CheckCircle2, AlertTriangle, XCircle, RefreshCw, Activity, Database,
  Globe, Shield, ArrowLeft,
} from 'lucide-react';

const POLL_INTERVAL_MS = 30000;

type ComponentStatus = string;

interface StatusResponse {
  status: string;
  components: Record<string, ComponentStatus>;
  probes: { database_ms: number };
  activeIncident: StatusIncident | null;
  incidents: StatusIncident[];
  checkedAt: string;
}

const SEVERITY_LABEL: Record<string, string> = {
  operational: 'All systems operational',
  degraded: 'Degraded performance',
  partial_outage: 'Partial outage',
  major_outage: 'Major outage',
};

const SEVERITY_TONE: Record<string, { bg: string; border: string; color: string; icon: typeof CheckCircle2 }> = {
  operational: { bg: 'rgb(var(--rag-healthy-rgb) / 0.07)', border: 'rgb(var(--rag-healthy-rgb) / 0.30)', color: 'var(--rag-healthy)', icon: CheckCircle2 },
  degraded: { bg: 'rgb(var(--warning-rgb) / 0.07)', border: 'rgb(var(--warning-rgb) / 0.30)', color: 'var(--warning)', icon: AlertTriangle },
  partial_outage: { bg: 'rgb(var(--warning-rgb) / 0.07)', border: 'rgb(var(--warning-rgb) / 0.30)', color: 'var(--warning)', icon: AlertTriangle },
  major_outage: { bg: 'rgb(var(--neg-rgb) / 0.07)', border: 'rgb(var(--neg-rgb) / 0.30)', color: 'var(--neg)', icon: XCircle },
};

function componentPillVariant(s: ComponentStatus): { label: string; variant: 'success' | 'warning' | 'danger' } {
  if (s === 'operational') return { label: 'Healthy', variant: 'success' };
  if (s === 'degraded') return { label: 'Watch', variant: 'warning' };
  if (s === 'partial_outage') return { label: 'Watch', variant: 'warning' };
  if (s === 'major_outage') return { label: 'At Risk', variant: 'danger' };
  return { label: s, variant: 'warning' };
}

function ComponentRow({ label, icon: Icon, status, hint }: { label: string; icon: typeof CheckCircle2; status: ComponentStatus; hint?: string }) {
  const pill = componentPillVariant(status);
  return (
    <div className="flex items-center gap-4 px-5 py-4 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Icon size={16} className="t-muted shrink-0" aria-hidden="true" />
        <span className="font-mono text-body-sm font-bold uppercase tracking-wide t-primary truncate">{label}</span>
      </div>
      <Badge variant={pill.variant} size="sm">{pill.label}</Badge>
      {hint && <span className="hidden text-caption t-muted sm:block sm:w-56 sm:text-right truncate">{hint}</span>}
    </div>
  );
}

export default function StatusPage(): JSX.Element {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    setError(null);
    try {
      const res = await api.status.get();
      setData(res as StatusResponse);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load status');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => { void load(true); }, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [load]);

  const status = statusFrom({ loading: loading && !data, error: error && !data ? error : null, isEmpty: false });
  if (status !== 'success') {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <AsyncPageContent
          status={status}
          error={error}
          onRetry={() => void load()}
          errorTitle="Couldn't load status"
          loadingVariant="cards"
          loadingCount={4}
        >
          {null}
        </AsyncPageContent>
      </div>
    );
  }

  const overall = data?.status ?? 'operational';
  const tone = SEVERITY_TONE[overall] ?? SEVERITY_TONE.operational;

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <div className="mx-auto max-w-5xl px-6 py-8 sm:py-10">
        {/* Masthead */}
        <header className="flex items-center justify-between gap-3">
          <Link to="/" className="inline-flex items-center gap-2 t-primary" aria-label="Atheon home">
            <ArrowLeft size={14} className="t-muted" aria-hidden="true" />
            <span className="text-headline-sm font-bold tracking-tight">Atheon</span>
          </Link>
          <button
            onClick={() => void load()}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 font-mono text-caption uppercase tracking-wide t-muted hover:t-primary"
            title="Refresh now"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
            <span>Updated {data ? new Date(data.checkedAt).toLocaleTimeString() : '—'}</span>
          </button>
        </header>

        {/* Hero — overall status */}
        <section className="mt-10 sm:mt-12">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <h1
                className="text-[clamp(2.25rem,6vw,4rem)] font-extrabold uppercase leading-[0.95] tracking-tight"
                style={{ color: 'var(--text-primary)' }}
              >
                {SEVERITY_LABEL[overall] ?? overall}
              </h1>
              <p className="mt-4 max-w-2xl text-body t-secondary">
                Real-time public status for the Atheon Financial Assurance Platform.
              </p>
            </div>
            <div className="relative mt-2 hidden shrink-0 sm:block" aria-hidden="true">
              <div
                className="h-16 w-16 rounded-full"
                style={{ background: tone.color, boxShadow: `0 0 48px 8px ${tone.bg}` }}
              />
              <div
                className="absolute inset-0 rounded-full"
                style={{ boxShadow: `0 0 0 10px ${tone.bg}` }}
              />
            </div>
          </div>
        </section>

        {/* Active incident banner */}
        {data?.activeIncident && (
          <Card className="mt-8 p-5" style={{ background: SEVERITY_TONE[data.activeIncident.severity]?.bg, borderColor: SEVERITY_TONE[data.activeIncident.severity]?.border }}>
            <div className="flex items-center justify-between gap-3 mb-2">
              <h3 className="text-body font-semibold t-primary">{data.activeIncident.title}</h3>
              <Badge variant="warning" size="sm">{data.activeIncident.status}</Badge>
            </div>
            {data.activeIncident.impact && <p className="text-body-sm t-secondary mb-3">{data.activeIncident.impact}</p>}
            {data.activeIncident.updates.length > 0 && (
              <div className="space-y-2 pt-3 border-t" style={{ borderColor: 'var(--border-card)' }}>
                {data.activeIncident.updates.slice().reverse().map((u, i) => (
                  <div key={i} className="text-caption">
                    <span className="t-muted">{new Date(u.at).toLocaleString()}</span>
                    <span className="t-muted"> · </span>
                    <span className="font-mono font-bold uppercase tracking-wide t-primary">{u.status}</span>
                    <p className="t-secondary mt-0.5">{u.message}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Platform components */}
        <section className="mt-10">
          <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--border-card)' }}>
            <h2 className="text-label">Platform Components</h2>
          </div>
          <Card className="mt-3 overflow-hidden p-0">
            <div className="divide-y" style={{ borderColor: 'var(--border-card)' }}>
              <ComponentRow label="API" icon={Globe} status={data?.components.api ?? 'operational'} hint="Cloudflare Workers" />
              <ComponentRow
                label="Database"
                icon={Database}
                status={data?.components.database ?? 'operational'}
                hint={data ? `D1 · ${data.probes.database_ms}ms probe` : 'D1'}
              />
              <ComponentRow label="Cache" icon={Activity} status={data?.components.cache ?? 'operational'} hint="Cloudflare KV" />
              <ComponentRow label="Object Storage" icon={Shield} status={data?.components.storage ?? 'operational'} hint="Cloudflare R2" />
            </div>
          </Card>
          <p className="mt-3 font-mono text-caption uppercase tracking-wide t-muted">
            Auto-refreshes every {POLL_INTERVAL_MS / 1000}s · subscribe against{' '}
            <code className="font-mono normal-case">https://atheon-api.vantax.co.za/api/status</code>
          </p>
        </section>

        {/* Continuity & data residency */}
        <section className="mt-10">
          <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--border-card)' }}>
            <h2 className="text-label">Continuity &amp; Data Residency</h2>
          </div>
          <Card className="mt-3 p-6">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <div className="text-label">Recovery Time Objective (RTO)</div>
                <div className="mt-1 text-headline-sm font-bold t-primary">≤ 4 hours</div>
                <p className="mt-1 text-caption t-muted">Time to restore service after a regional incident.</p>
              </div>
              <div>
                <div className="text-label">Recovery Point Objective (RPO)</div>
                <div className="mt-1 text-headline-sm font-bold t-primary">≤ 1 hour</div>
                <p className="mt-1 text-caption t-muted">Max data loss in a disaster scenario (hourly D1 backups).</p>
              </div>
              <div>
                <div className="text-label">Primary Region</div>
                <div className="mt-1 text-body font-medium t-primary">Cloudflare Global Network · D1 pinned to af-south-1 (Johannesburg)</div>
                <p className="mt-1 text-caption t-muted">Workers run at the closest edge; durable state (D1, R2) is region-pinned.</p>
              </div>
              <div>
                <div className="text-label">Backup Cadence</div>
                <div className="mt-1 text-body font-medium t-primary">Hourly D1 snapshots · 30-day retention</div>
                <p className="mt-1 text-caption t-muted">Backed up via GitHub Actions workflow <code className="font-mono">backup-d1.yml</code>.</p>
              </div>
            </div>
            <div className="mt-6 border-t pt-4 text-caption t-muted" style={{ borderColor: 'var(--border-card)' }}>
              Compliance: SOC 2 Type II controls implemented (CC6.1, CC6.2, CC7.3, CC8.1).
              POPIA + GDPR DSAR support is live on the Compliance tab. For full SOC 2 evidence + sub-processor list,
              ask your administrator to issue an Auditor-role login.
            </div>
          </Card>
        </section>

        {/* Incident history */}
        <section className="mt-10">
          <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--border-card)' }}>
            <h2 className="text-label">Incident History</h2>
            <span className="font-mono text-caption uppercase tracking-wide t-muted">
              Last 90 days · {data?.incidents.length ?? 0} incident{(data?.incidents.length ?? 0) === 1 ? '' : 's'}
            </span>
          </div>
          <Card className="mt-3 overflow-hidden p-0">
            {!data || data.incidents.length === 0 ? (
              <div className="p-10 text-center">
                <CheckCircle2 size={28} className="mx-auto mb-2" style={{ color: 'rgb(var(--rag-healthy-rgb) / 0.45)' }} aria-hidden="true" />
                <p className="text-body-sm font-medium t-primary">No incidents in the last 90 days</p>
                <p className="mt-1 text-caption t-muted">All systems have been operational.</p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--border-card)' }}>
                {data.incidents.map((i) => (
                  <details key={i.id} className="group">
                    <summary className="flex cursor-pointer items-start gap-4 px-5 py-4 sm:px-6">
                      <span className="hidden w-24 shrink-0 pt-0.5 font-mono text-caption uppercase tracking-wide t-muted sm:block">
                        {new Date(i.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                      <Badge variant={i.resolvedAt ? 'success' : 'warning'} size="sm">{i.resolvedAt ? 'Resolved' : i.status}</Badge>
                      <div className="min-w-0 flex-1">
                        <span className="text-body-sm font-medium t-primary">{i.title}</span>
                        <div className="mt-1 text-caption t-muted">
                          Started {new Date(i.startedAt).toLocaleString()}
                          {i.resolvedAt && <> · Resolved {new Date(i.resolvedAt).toLocaleString()}</>}
                        </div>
                      </div>
                    </summary>
                    {i.updates.length > 0 && (
                      <div className="space-y-2 px-5 pb-4 sm:px-6 sm:pl-[8.5rem]">
                        {i.updates.slice().reverse().map((u, idx) => (
                          <div key={idx} className="text-caption">
                            <span className="t-muted">{new Date(u.at).toLocaleString()}</span>
                            <span className="t-muted"> · </span>
                            <span className="font-mono font-bold uppercase tracking-wide t-primary">{u.status}</span>
                            <p className="mt-0.5 t-secondary">{u.message}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </details>
                ))}
              </div>
            )}
          </Card>
        </section>

        {/* Footer */}
        <footer className="mt-12 flex flex-col items-center justify-between gap-3 border-t pt-6 sm:flex-row" style={{ borderColor: 'var(--border-card)' }}>
          <span className="font-mono text-caption uppercase tracking-wide t-muted">© {new Date().getFullYear()} Atheon · Financial Assurance Platform</span>
          <span className="text-caption t-muted">
            For partner contracts, security questionnaires, or DPA templates, contact your Atheon CS team.
          </span>
        </footer>
      </div>
    </div>
  );
}
