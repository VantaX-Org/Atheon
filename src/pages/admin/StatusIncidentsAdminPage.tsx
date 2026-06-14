/**
 * /admin/incidents — admin UI for the public /status page (Phase BC).
 *
 * Closes the Phase AZ gap: the backend ships incident CRUD endpoints
 * but no UI used them, so ops would have had to curl-POST every
 * incident. This panel lets superadmin / support_admin:
 *   - Declare a new incident (with an initial public message)
 *   - Append updates as the situation evolves (status + message)
 *   - Mark resolved (one-click; resolved_at stamps once)
 *   - See the audit-history-friendly incident timeline
 *
 * Public surface is /status; this is the operator side.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoadingState, ErrorState } from '@/components/ui/state';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import {
  Plus, CheckCircle2, Clock, MessageSquare, ExternalLink, Loader2,
} from 'lucide-react';

type AdminIncident = Awaited<ReturnType<typeof api.iam.statusIncidents>>['incidents'][number];

interface ParsedUpdate { at: string; status: string; message: string }
function parseUpdates(s: string): ParsedUpdate[] {
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? (v as ParsedUpdate[]) : []; } catch { return []; }
}

const SEVERITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'degraded', label: 'Degraded performance' },
  { value: 'partial_outage', label: 'Partial outage' },
  { value: 'major_outage', label: 'Major outage' },
  { value: 'operational', label: 'Informational / resolved' },
];
const STATUS_OPTIONS = [
  { value: 'investigating', label: 'Investigating' },
  { value: 'identified', label: 'Identified' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'resolved', label: 'Resolved' },
];

/**
 * Editorial status-pill treatment for incident severity (mockup v4-53).
 * Maps each severity to the RAG palette ONLY — pills are health indicators,
 * never decoration. Returns the prominent banner label + token-driven styles.
 */
function severityPill(severity: string): { label: string; bg: string; fg: string } {
  switch (severity) {
    case 'major_outage':
      return { label: 'Critical outage', bg: 'rgb(var(--neg-rgb) / 0.12)', fg: 'var(--neg)' };
    case 'partial_outage':
      return { label: 'Partial outage', bg: 'rgb(var(--warning-rgb) / 0.14)', fg: 'var(--warning)' };
    case 'degraded':
      return { label: 'Degraded service', bg: 'rgb(var(--warning-rgb) / 0.14)', fg: 'var(--warning)' };
    default:
      return { label: severity.replace(/_/g, ' '), bg: 'var(--accent-subtle)', fg: 'var(--accent)' };
  }
}

/** Shared mono "data voice" eyebrow used for STARTED / UPDATED / labels. */
const DATA_LABEL =
  "block text-[10px] font-bold uppercase tracking-[0.12em] t-muted [font-family:'Space_Mono',ui-monospace,monospace]";

export default function StatusIncidentsAdminPage(): JSX.Element {
  const toast = useToast();
  const [incidents, setIncidents] = useState<AdminIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState('degraded');
  const [status, setStatus] = useState('investigating');
  const [impact, setImpact] = useState('');
  const [message, setMessage] = useState('');
  const [components, setComponents] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Per-incident update form state
  const [updateDraft, setUpdateDraft] = useState<Record<string, { status: string; message: string; busy: boolean }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.iam.statusIncidents();
      setIncidents(res.incidents);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load incidents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await api.iam.createStatusIncident({
        title: title.trim(),
        severity,
        status,
        impact: impact.trim() || undefined,
        message: message.trim() || undefined,
        components: components.split(',').map((s) => s.trim()).filter(Boolean),
      });
      toast.success(`Incident "${title.trim()}" declared`);
      setTitle(''); setImpact(''); setMessage(''); setComponents('');
      setSeverity('degraded'); setStatus('investigating');
      setShowCreate(false);
      await load();
    } catch (err) {
      toast.error('Create failed', { message: err instanceof ApiError ? err.message : undefined, requestId: err instanceof ApiError ? err.requestId : null });
    } finally {
      setSubmitting(false);
    }
  };

  const appendUpdate = async (incidentId: string) => {
    const draft = updateDraft[incidentId];
    if (!draft || !draft.message.trim()) return;
    setUpdateDraft((d) => ({ ...d, [incidentId]: { ...draft, busy: true } }));
    try {
      await api.iam.updateStatusIncident(incidentId, {
        status: draft.status,
        message: draft.message.trim(),
      });
      toast.success('Update posted');
      setUpdateDraft((d) => ({ ...d, [incidentId]: { status: 'investigating', message: '', busy: false } }));
      await load();
    } catch (err) {
      toast.error('Update failed', { message: err instanceof ApiError ? err.message : undefined, requestId: err instanceof ApiError ? err.requestId : null });
      setUpdateDraft((d) => ({ ...d, [incidentId]: { ...draft, busy: false } }));
    }
  };

  const resolve = async (incident: AdminIncident) => {
    if (!window.confirm(`Mark "${incident.title}" as resolved? This stamps resolved_at and surfaces a "Resolved" badge on the public status page.`)) return;
    try {
      await api.iam.updateStatusIncident(incident.id, {
        status: 'resolved',
        message: 'Incident resolved. Service has returned to normal operation.',
      });
      toast.success(`Resolved ${incident.title}`);
      await load();
    } catch (err) {
      toast.error('Resolve failed', { message: err instanceof ApiError ? err.message : undefined, requestId: err instanceof ApiError ? err.requestId : null });
    }
  };

  if (loading) return <div className="p-6"><LoadingState variant="cards" count={3} /></div>;
  if (error) return <div className="p-6"><ErrorState title="Couldn't load incidents" error={error} onRetry={() => void load()} /></div>;

  const open = incidents.filter((i) => !i.resolved_at);
  const closed = incidents.filter((i) => i.resolved_at);

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        eyebrow="Platform · Status & Incidents"
        title="Incident Manager"
        dek="Declare and resolve incidents shown on the public /status page"
        live
        actions={
          <>
            <Link to="/status" target="_blank" rel="noopener noreferrer" className="text-caption text-accent hover:underline inline-flex items-center gap-1">
              Public status page <ExternalLink size={11} />
            </Link>
            {!showCreate && (
              <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
                <Plus size={12} /> Declare incident
              </Button>
            )}
          </>
        }
      />

      {/* Create form */}
      {showCreate && (
        <Card className="p-5">
          <h3 className="text-body font-semibold t-primary mb-3">Declare a new incident</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block md:col-span-2">
              <span className="text-caption uppercase tracking-wider t-muted block mb-1">Title</span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Elevated D1 query latency in af-south-1"
                className="w-full px-3 py-2 rounded-md text-body-sm bg-[var(--bg-input)] border border-[var(--border-card)] t-primary focus:border-accent focus:outline-none"
                maxLength={200}
                autoFocus
              />
            </label>
            <label className="block">
              <span className="text-caption uppercase tracking-wider t-muted block mb-1">Severity</span>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                className="w-full px-3 py-2 rounded-md text-body-sm bg-[var(--bg-input)] border border-[var(--border-card)] t-primary focus:border-accent focus:outline-none"
              >
                {SEVERITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-caption uppercase tracking-wider t-muted block mb-1">Investigation status</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full px-3 py-2 rounded-md text-body-sm bg-[var(--bg-input)] border border-[var(--border-card)] t-primary focus:border-accent focus:outline-none"
              >
                {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="block md:col-span-2">
              <span className="text-caption uppercase tracking-wider t-muted block mb-1">Customer impact (optional)</span>
              <input
                type="text"
                value={impact}
                onChange={(e) => setImpact(e.target.value)}
                placeholder="e.g. Read requests may take 2-5s longer. No data at risk."
                className="w-full px-3 py-2 rounded-md text-body-sm bg-[var(--bg-input)] border border-[var(--border-card)] t-primary focus:border-accent focus:outline-none"
                maxLength={1000}
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-caption uppercase tracking-wider t-muted block mb-1">Affected components (comma-separated)</span>
              <input
                type="text"
                value={components}
                onChange={(e) => setComponents(e.target.value)}
                placeholder="database, api"
                className="w-full px-3 py-2 rounded-md text-body-sm bg-[var(--bg-input)] border border-[var(--border-card)] t-primary focus:border-accent focus:outline-none"
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-caption uppercase tracking-wider t-muted block mb-1">Initial public message</span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="What customers will see on /status as the first update."
                rows={3}
                className="w-full px-3 py-2 rounded-md text-body-sm bg-[var(--bg-input)] border border-[var(--border-card)] t-primary focus:border-accent focus:outline-none"
                maxLength={4000}
              />
            </label>
          </div>
          <div className="flex items-center justify-end gap-2 mt-4">
            <Button variant="ghost" size="sm" onClick={() => { setShowCreate(false); }} disabled={submitting}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={() => void create()} disabled={submitting || !title.trim()}>
              {submitting ? <><Loader2 size={12} className="animate-spin" /> Declaring…</> : <><Plus size={12} /> Declare incident</>}
            </Button>
          </div>
        </Card>
      )}

      {/* Active incidents — editorial hero + prominent status pills */}
      <section>
        <div className="flex items-baseline gap-3 mb-1">
          <h2 className="text-[2rem] leading-none font-extrabold t-primary tracking-tight">
            Active incidents <span className="t-muted tnum [font-family:'Space_Mono',ui-monospace,monospace]">({open.length})</span>
          </h2>
        </div>
        <p className={`${DATA_LABEL} mb-5`}>Real-time operational status overview</p>

        {open.length === 0 ? (
          <Card className="p-10 text-center">
            <CheckCircle2 size={32} className="mx-auto mb-3" style={{ color: 'var(--rag-healthy)', opacity: 0.6 }} />
            <p className="text-body font-semibold t-primary">No active incidents</p>
            <p className="text-caption t-muted mt-1">Public status page shows all systems operational.</p>
          </Card>
        ) : (
          <div className="space-y-4">
            {open.map((i) => {
              const updates = parseUpdates(i.updates);
              const draft = updateDraft[i.id] ?? { status: 'investigating', message: '', busy: false };
              const pill = severityPill(i.severity);
              const lastUpdate = updates.length > 0 ? updates[updates.length - 1] : null;
              return (
                <Card key={i.id} className="p-0 overflow-hidden">
                  {/* Header: title + prominent severity banner pill */}
                  <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-xl font-bold t-primary leading-snug">{i.title}</h3>
                      {i.impact && <p className="text-body-sm t-secondary mt-2 max-w-2xl">{i.impact}</p>}
                    </div>
                    <span
                      className="shrink-0 inline-flex items-center rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] [font-family:'Space_Mono',ui-monospace,monospace]"
                      style={{ background: pill.bg, color: pill.fg }}
                    >
                      {pill.label}
                    </span>
                  </div>

                  {/* Meta row: STARTED / UPDATED / investigation status / view details */}
                  <div className="flex flex-wrap items-end gap-x-10 gap-y-3 px-6 pb-5 border-b" style={{ borderColor: 'var(--border-card)' }}>
                    <div>
                      <span className={DATA_LABEL}>Started</span>
                      <span className="text-body-sm t-primary tnum [font-family:'Space_Mono',ui-monospace,monospace] mt-0.5 inline-flex items-center gap-1.5">
                        <Clock size={12} className="t-muted" />{new Date(i.started_at).toLocaleString()}
                      </span>
                    </div>
                    {lastUpdate && (
                      <div>
                        <span className={DATA_LABEL}>Updated</span>
                        <span className="text-body-sm t-primary tnum [font-family:'Space_Mono',ui-monospace,monospace] mt-0.5 block">
                          {new Date(lastUpdate.at).toLocaleString()}
                        </span>
                      </div>
                    )}
                    <div>
                      <span className={DATA_LABEL}>Investigation</span>
                      <span className="text-body-sm font-medium mt-0.5 block uppercase tracking-wide" style={{ color: 'var(--accent)' }}>
                        {i.status}
                      </span>
                    </div>
                    <Link
                      to="/status"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto self-center text-caption font-medium inline-flex items-center gap-1 uppercase tracking-wider [font-family:'Space_Mono',ui-monospace,monospace]"
                      style={{ color: 'var(--accent)' }}
                    >
                      View details <ExternalLink size={11} />
                    </Link>
                  </div>

                  {/* Status timeline */}
                  {updates.length > 0 && (
                    <div className="px-6 pt-5 pb-2">
                      <div className={`${DATA_LABEL} mb-4`}>Status timeline</div>
                      <ol className="relative space-y-4">
                        <span className="absolute left-[5px] top-2 bottom-2 w-px" style={{ background: 'var(--border-card)' }} aria-hidden />
                        {updates.slice().reverse().map((u, idx) => (
                          <li key={idx} className="relative pl-6">
                            <span
                              className="absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full border-2"
                              style={{ background: 'var(--bg-card-solid)', borderColor: idx === 0 ? 'var(--accent)' : 'var(--border-strong, var(--border-card))' }}
                              aria-hidden
                            />
                            <div className="flex flex-wrap items-baseline gap-x-3">
                              <span className="text-caption t-muted tnum [font-family:'Space_Mono',ui-monospace,monospace]">{new Date(u.at).toLocaleString()}</span>
                              <span className="text-caption font-bold uppercase tracking-[0.1em] t-primary [font-family:'Space_Mono',ui-monospace,monospace]">{u.status}</span>
                            </div>
                            <p className="text-body-sm t-secondary mt-1">{u.message}</p>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {/* Status update + actions footer */}
                  <div className="px-6 pt-4 pb-6 mt-2 border-t" style={{ borderColor: 'var(--border-card)' }}>
                    <span className={`${DATA_LABEL} mb-2`}>Status update notes</span>
                    <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                      <label className="block shrink-0">
                        <span className="sr-only">Status</span>
                        <select
                          value={draft.status}
                          onChange={(e) => setUpdateDraft((d) => ({ ...d, [i.id]: { ...draft, status: e.target.value } }))}
                          className="px-3 py-2 rounded-md text-body-sm bg-[var(--bg-input)] border border-[var(--border-card)] t-primary focus:border-accent focus:outline-none"
                        >
                          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </label>
                      <label className="block flex-1">
                        <span className="sr-only">Public update message</span>
                        <input
                          type="text"
                          value={draft.message}
                          onChange={(e) => setUpdateDraft((d) => ({ ...d, [i.id]: { ...draft, message: e.target.value } }))}
                          placeholder="What customers will see on /status — e.g. Root cause identified, applying fix"
                          className="w-full px-3 py-2 rounded-md text-body-sm bg-[var(--bg-input)] border border-[var(--border-card)] t-primary focus:border-accent focus:outline-none"
                          maxLength={4000}
                        />
                      </label>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button variant="primary" size="sm" onClick={() => void appendUpdate(i.id)} disabled={draft.busy || !draft.message.trim()}>
                          {draft.busy ? <><Loader2 size={12} className="animate-spin" /></> : <><MessageSquare size={12} /></>} Post update
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => void resolve(i)}><CheckCircle2 size={12} /> Resolve</Button>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent resolutions */}
      <section>
        <p className={`${DATA_LABEL} mb-3`}>Recent resolutions ({closed.length})</p>
        {closed.length === 0 ? (
          <Card className="p-6 text-center">
            <p className="text-caption t-muted">No resolved incidents yet.</p>
          </Card>
        ) : (
          <Card className="p-0 overflow-hidden">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--border-card)' }}>
                  {['Title', 'Severity', 'Started', 'Resolved', 'Duration'].map((h) => (
                    <th key={h} className="text-left px-5 py-3 text-[10px] font-bold uppercase tracking-[0.12em] t-muted [font-family:'Space_Mono',ui-monospace,monospace]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {closed.map((i) => {
                  const startedMs = new Date(i.started_at).getTime();
                  const resolvedMs = i.resolved_at ? new Date(i.resolved_at).getTime() : Date.now();
                  const durMin = Math.max(0, Math.round((resolvedMs - startedMs) / 60000));
                  const durStr = durMin >= 60 ? `${Math.floor(durMin / 60)}h ${durMin % 60}m` : `${durMin}m`;
                  return (
                    <tr key={i.id} className="border-b last:border-0" style={{ borderColor: 'var(--border-card)' }}>
                      <td className="px-5 py-3.5 t-primary font-medium">{i.title}</td>
                      <td className="px-5 py-3.5">
                        <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] [font-family:'Space_Mono',ui-monospace,monospace]" style={{ background: 'rgb(var(--rag-healthy-rgb) / 0.10)', color: 'var(--rag-healthy)' }}>Resolved</span>
                      </td>
                      <td className="px-5 py-3.5 t-muted tnum [font-family:'Space_Mono',ui-monospace,monospace]">{new Date(i.started_at).toLocaleString()}</td>
                      <td className="px-5 py-3.5 t-muted tnum [font-family:'Space_Mono',ui-monospace,monospace]">{i.resolved_at ? new Date(i.resolved_at).toLocaleString() : '—'}</td>
                      <td className="px-5 py-3.5 t-secondary tnum [font-family:'Space_Mono',ui-monospace,monospace]">{durStr}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  );
}
