/**
 * v48: Support Triage — admin-only ticket list.
 * Filter by status, peek into a ticket, bulk-assign to yourself, close tickets
 * in bulk. For deep replies use the regular ticket detail page which also
 * exposes admin PATCH fields via the API.
 * Route: /support-triage | Role: admin, support_admin, superadmin
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { SupportTicket } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { PageHeader } from '@/components/ui/page-header';
import { Filter, Loader2, CheckCircle, UserPlus } from 'lucide-react';

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  open: 'warning',
  in_progress: 'warning',
  waiting_customer: 'warning',
  resolved: 'success',
  closed: 'default',
};

const PRIORITY_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  low: 'default',
  normal: 'default',
  high: 'warning',
  urgent: 'danger',
};

/** Urgency colour — drives the mono RAG label at the top of each card. */
const URGENCY_TONE: Record<string, { label: string; color: string }> = {
  low: { label: 'GREEN', color: 'var(--rag-healthy)' },
  normal: { label: 'GREEN', color: 'var(--rag-healthy)' },
  high: { label: 'AMBER', color: 'var(--rag-watch)' },
  urgent: { label: 'RED', color: 'var(--rag-risk)' },
};

const STATUS_FILTERS = ['all', 'open', 'in_progress', 'waiting_customer', 'resolved', 'closed'] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

const ASSIGNABLE_STATUSES = ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'] as const;

/**
 * Kanban swim-lanes. Each lane reads from the same loaded `tickets` set —
 * `match` is a pure predicate over real ticket fields, no data is invented.
 * Escalated lifts high / urgent priority tickets ahead of their status lane.
 */
const LANES: { key: string; label: string; match: (t: SupportTicket) => boolean }[] = [
  {
    key: 'new',
    label: 'New',
    match: (t) => t.status === 'open' && t.priority !== 'high' && t.priority !== 'urgent',
  },
  {
    key: 'triaged',
    label: 'Triaged',
    match: (t) =>
      t.status === 'in_progress' && t.priority !== 'high' && t.priority !== 'urgent',
  },
  {
    key: 'escalated',
    label: 'Escalated',
    match: (t) =>
      (t.status === 'open' || t.status === 'in_progress') &&
      (t.priority === 'high' || t.priority === 'urgent'),
  },
  {
    key: 'waiting',
    label: 'Waiting',
    match: (t) => t.status === 'waiting_customer' || t.status === 'resolved' || t.status === 'closed',
  },
];

export function SupportTriagePage() {
  const toast = useToast();
  const currentUser = useAppStore((s) => s.user);

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  const showError = useCallback((title: string, err: unknown, fallback: string) => {
    const message = err instanceof Error ? err.message : fallback;
    toast.error(title, {
      message,
      requestId: err instanceof ApiError ? err.requestId : null,
    });
  }, [toast]);

  const reload = useCallback(async () => {
    try {
      const res = await api.support.list({
        limit: 100,
        status: statusFilter === 'all' ? undefined : statusFilter,
      });
      setTickets(res.tickets);
    } catch (err) {
      showError('Failed to load tickets', err, 'Network error');
    }
  }, [statusFilter, showError]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await api.support.list({
          limit: 100,
          status: statusFilter === 'all' ? undefined : statusFilter,
        });
        if (!cancelled) setTickets(res.tickets);
      } catch (err) {
        if (!cancelled) showError('Failed to load tickets', err, 'Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [statusFilter, showError]);

  const handleAssignSelf = async (t: SupportTicket) => {
    if (!currentUser) return;
    setBusyId(t.id);
    try {
      await api.support.update(t.id, {
        assignee_user_id: currentUser.id,
        status: t.status === 'open' ? 'in_progress' : t.status,
      });
      toast.success('Assigned to you');
      await reload();
    } catch (err) {
      showError('Could not assign', err, 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const handleStatus = async (t: SupportTicket, status: string) => {
    setBusyId(t.id);
    try {
      await api.support.update(t.id, { status });
      toast.success(`Status set to ${status.replace('_', ' ')}`);
      await reload();
    } catch (err) {
      showError('Could not update status', err, 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: tickets.length };
    for (const t of tickets) {
      c[t.status] = (c[t.status] ?? 0) + 1;
    }
    return c;
  }, [tickets]);

  /** Tickets with no assignee — surfaced as the headline metric in the masthead. */
  const unassignedCount = useMemo(
    () => tickets.filter((t) => !t.assignee_user_id).length,
    [tickets],
  );

  /** Distribute the loaded tickets across the kanban swim-lanes. */
  const lanes = useMemo(
    () => LANES.map((lane) => ({ ...lane, items: tickets.filter(lane.match) })),
    [tickets],
  );

  return (
    <div className="p-5 max-w-7xl mx-auto space-y-5">
      <PageHeader
        eyebrow="Incoming Ticket Kanban · AI-Assisted Workflow"
        title="Support Triage"
        dek="All tickets for this tenant. Assign, change status, and reply via detail view."
        actions={
          <div className="flex items-center gap-3">
            <div className="flex items-baseline gap-2 px-3 py-1.5 rounded-md" style={{ background: 'var(--bg-secondary)' }}>
              <span className="text-label" style={{ color: 'var(--text-muted)' }}>Unassigned</span>
              <span
                className="font-mono tnum text-lg font-bold leading-none"
                style={{ color: 'var(--text-primary)' }}
                data-testid="support-triage-unassigned"
              >
                {unassignedCount}
              </span>
            </div>
          </div>
        }
      />

      <Card>
        <div className="flex items-center gap-2 flex-wrap">
          <Filter size={14} className="t-muted" />
          <span className="text-label">Status</span>
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1 rounded-md text-xs font-mono uppercase tracking-wide transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] ${
                statusFilter === s
                  ? 'font-bold'
                  : 't-secondary hover:bg-[var(--bg-secondary)]'
              } active:scale-[0.97]`}
              style={statusFilter === s ? { background: 'var(--accent-subtle)', color: 'var(--accent)' } : undefined}
              data-testid={`support-triage-filter-${s}`}
            >
              {s.replace('_', ' ')}
              {s === statusFilter && counts[s] !== undefined && (
                <span className="ml-1 opacity-70">({counts[s]})</span>
              )}
            </button>
          ))}
        </div>
      </Card>

      {loading ? (
        <Card>
          <div className="flex items-center justify-center py-10 t-muted text-sm gap-2">
            <Loader2 size={16} className="animate-spin" />
            Loading tickets…
          </div>
        </Card>
      ) : tickets.length === 0 ? (
        <Card>
          <div className="text-center py-10">
            <CheckCircle size={28} className="mx-auto t-muted mb-3" />
            <p className="text-sm t-secondary">No tickets match this filter.</p>
          </div>
        </Card>
      ) : (
        <div
          className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start"
          data-testid="support-triage-list"
        >
          {lanes.map((lane) => (
            <section key={lane.key} className="min-w-0" data-testid={`support-triage-lane-${lane.key}`}>
              <div
                className="flex items-center justify-between pb-2 mb-3 border-b"
                style={{ borderColor: 'var(--border-card)' }}
              >
                <h2 className="text-label" style={{ color: 'var(--text-primary)' }}>
                  {lane.label}
                </h2>
                <span className="font-mono tnum text-caption t-muted">
                  {lane.items.length} {lane.items.length === 1 ? 'ticket' : 'tickets'}
                </span>
              </div>

              {lane.items.length === 0 ? (
                <p className="text-caption t-muted px-1 py-6 text-center">No tickets.</p>
              ) : (
                <div className="space-y-3">
                  {lane.items.map((t) => {
                    const isAssignedToMe = !!currentUser && t.assignee_user_id === currentUser.id;
                    const urgency = URGENCY_TONE[t.priority] ?? URGENCY_TONE.normal;
                    return (
                      <Card key={t.id} data-testid="support-triage-row" className="!p-3.5">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span className="text-label inline-flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                            Urgency
                            <span style={{ color: urgency.color }}>{urgency.label}</span>
                          </span>
                          <Badge variant="info">RAG</Badge>
                        </div>

                        <Link
                          to={`/support-tickets/${t.id}`}
                          className="block text-sm font-semibold t-primary hover:underline leading-snug"
                        >
                          {t.subject}
                        </Link>

                        <p className="text-caption t-muted mt-1 line-clamp-2">{t.body}</p>

                        <div className="mt-2.5 space-y-1">
                          <div className="text-caption font-mono uppercase tracking-wide t-muted">
                            Category{' '}
                            <span className="t-secondary">{t.category.replace('_', ' ')}</span>
                          </div>
                          <div className="text-caption font-mono uppercase tracking-wide t-muted">
                            Priority{' '}
                            <span style={{ color: urgency.color }}>{t.priority}</span>
                          </div>
                          <div className="text-caption t-muted font-mono tnum">
                            Opened {new Date(t.created_at).toLocaleString()}
                          </div>
                        </div>

                        <div className="flex items-center flex-wrap gap-1.5 mt-2.5">
                          <Badge variant={STATUS_VARIANT[t.status] ?? 'default'}>{t.status.replace('_', ' ')}</Badge>
                          <Badge variant={PRIORITY_VARIANT[t.priority] ?? 'default'}>{t.priority}</Badge>
                          {isAssignedToMe && <Badge variant="success">assigned to you</Badge>}
                        </div>

                        <div
                          className="flex items-center gap-2 mt-3 pt-3 border-t"
                          style={{ borderColor: 'var(--border-card)' }}
                        >
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={!currentUser || busyId === t.id || isAssignedToMe}
                            onClick={() => handleAssignSelf(t)}
                            data-testid={`support-triage-assign-${t.id}`}
                          >
                            {busyId === t.id ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
                            {isAssignedToMe ? 'Mine' : 'Assign me'}
                          </Button>
                          <select
                            value={t.status}
                            disabled={busyId === t.id}
                            onChange={(e) => handleStatus(t, e.target.value)}
                            className="text-xs rounded-md px-2 py-1 font-mono flex-1 min-w-0 focus:outline-none focus:ring-2 focus:ring-[var(--ring-focus)]"
                            style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-card)' }}
                            data-testid={`support-triage-status-${t.id}`}
                          >
                            {ASSIGNABLE_STATUSES.map((s) => (
                              <option key={s} value={s}>{s.replace('_', ' ')}</option>
                            ))}
                          </select>
                          {t.status === 'resolved' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busyId === t.id}
                              onClick={() => handleStatus(t, 'closed')}
                            >
                              <CheckCircle size={12} />
                              Close
                            </Button>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
