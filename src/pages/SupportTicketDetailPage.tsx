/**
 * v48: Support Ticket Detail — thread view + reply composer.
 * Admins see all replies; regular users only see their own tickets (server
 * enforces this — 403 on other users' tickets, 404 across tenants).
 * Route: /support-tickets/:id | Role: any authenticated user
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { SupportTicket, SupportTicketReply } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { ArrowLeft, Loader2, Send } from 'lucide-react';

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  open: 'info',
  in_progress: 'warning',
  waiting_customer: 'warning',
  resolved: 'success',
  closed: 'default',
};

const PRIORITY_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  low: 'default',
  normal: 'info',
  high: 'warning',
  urgent: 'danger',
};

export function SupportTicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const currentUser = useAppStore((s) => s.user);

  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [replies, setReplies] = useState<SupportTicketReply[]>([]);
  const [loading, setLoading] = useState(true);
  // 'not_found' = server said 403/404 (wrong user/tenant or deleted);
  // 'failed'    = network/5xx — the ticket may exist, offer a retry.
  const [loadError, setLoadError] = useState<'not_found' | 'failed' | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [sending, setSending] = useState(false);

  const showError = useCallback((title: string, err: unknown, fallback: string) => {
    const message = err instanceof Error ? err.message : fallback;
    toast.error(title, {
      message,
      requestId: err instanceof ApiError ? err.requestId : null,
    });
  }, [toast]);

  const load = useCallback(async (initial = false) => {
    if (!id) return;
    if (initial) setLoading(true);
    try {
      const res = await api.support.get(id);
      setTicket(res.ticket);
      setReplies(res.replies);
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
        setLoadError('not_found');
      } else {
        setLoadError('failed');
        showError('Failed to load ticket', err, 'Network error');
      }
    } finally {
      if (initial) setLoading(false);
    }
  }, [id, showError]);

  useEffect(() => { void load(true); }, [load]);

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !replyBody.trim() || sending) return;
    setSending(true);
    try {
      await api.support.addReply(id, replyBody);
      setReplyBody('');
      await load();
    } catch (err) {
      showError('Could not send reply', err, 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="p-5 max-w-6xl mx-auto">
        <Card>
          <div className="flex items-center justify-center py-10 t-muted text-sm gap-2">
            <Loader2 size={16} className="animate-spin" />
            Loading ticket…
          </div>
        </Card>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="p-5 max-w-6xl mx-auto space-y-4">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-xs t-muted hover:t-primary"
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <Card>
          {loadError === 'failed' ? (
            <div className="text-center py-8" data-testid="support-detail-error">
              <p className="text-sm t-secondary">We couldn't load this ticket.</p>
              <p className="text-xs t-muted mt-1">The ticket may still exist — this is a loading problem.</p>
              <Button className="mt-4" variant="secondary" size="sm" onClick={() => void load(true)}>
                Retry
              </Button>
            </div>
          ) : (
            <div className="text-center py-8" data-testid="support-detail-not-found">
              <p className="text-sm t-secondary">Ticket not found.</p>
              <p className="text-xs t-muted mt-1">
                It may have been filed by another user, or the link is out of date.
              </p>
              <Link to="/support-tickets" className="text-xs text-accent hover:underline mt-3 inline-block">
                Back to your tickets
              </Link>
            </div>
          )}
        </Card>
      </div>
    );
  }

  const isClosed = ticket.status === 'closed';
  const canReply = !isClosed;
  const ticketRef = `#${ticket.id}`;

  return (
    <div className="p-5 lg:p-6 max-w-6xl mx-auto">
      <Link
        to="/support-tickets"
        className="inline-flex items-center gap-1 text-caption font-mono uppercase tracking-wide t-muted hover:t-primary mb-5"
      >
        <ArrowLeft size={14} />
        All tickets
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 items-start">
        {/* ── Main column: threaded conversation ─────────────────── */}
        <div className="min-w-0 space-y-5">
          <header>
            <p className="text-caption font-mono uppercase tracking-[0.18em] t-muted">
              Threaded conversation
            </p>
            <h1 className="text-headline-xl font-bold t-primary tracking-tight leading-tight mt-2">
              <span className="font-mono t-secondary">{ticketRef}: </span>
              {ticket.subject}
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <span className="text-caption font-mono uppercase tracking-wide t-muted">Status</span>
              <Badge variant={STATUS_VARIANT[ticket.status] ?? 'default'}>{ticket.status.replace('_', ' ')}</Badge>
            </div>
          </header>

          <div className="space-y-3" data-testid="support-reply-thread">
            {/* Original ticket message */}
            <Card>
              <div className="flex items-start justify-between gap-3">
                <Badge variant={currentUser && ticket.user_id === currentUser.id ? 'info' : 'default'}>
                  {currentUser && ticket.user_id === currentUser.id ? 'You' : 'Requester'}
                </Badge>
                <span className="text-caption font-mono t-muted whitespace-nowrap">
                  {new Date(ticket.created_at).toLocaleString()}
                </span>
              </div>
              <p className="text-sm t-primary mt-3 whitespace-pre-wrap leading-relaxed">{ticket.body}</p>
            </Card>

            {replies.map((r) => {
              const isMine = currentUser && r.user_id === currentUser.id;
              // Honest labels from real user_ids: the ticket requester is
              // "Requester"; anyone else on the thread is staff ("Support" —
              // the server only lets the requester and admins in).
              const label = isMine ? 'You' : r.user_id === ticket.user_id ? 'Requester' : 'Support';
              return (
                <Card key={r.id}>
                  <div className="flex items-start justify-between gap-3">
                    <Badge variant={isMine ? 'info' : 'default'}>{label}</Badge>
                    <span className="text-caption font-mono t-muted whitespace-nowrap">
                      {new Date(r.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm t-primary mt-3 whitespace-pre-wrap leading-relaxed">{r.body}</p>
                </Card>
              );
            })}
          </div>

          {/* Composer */}
          {canReply ? (
            <Card>
              {/* Status is real API data — 'waiting_customer' means the ball is
                  in the requester's court, so say so. */}
              {ticket.status === 'waiting_customer' && (
                <p className="text-xs t-secondary mb-3" data-testid="support-waiting-hint">
                  Support is waiting on a reply to move this ticket forward.
                </p>
              )}
              <form onSubmit={handleReply} className="space-y-3" data-testid="support-reply-form">
                <label className="block">
                  <span className="sr-only">Reply</span>
                  <textarea
                    value={replyBody}
                    maxLength={10000}
                    rows={4}
                    placeholder="Write a reply…"
                    onChange={(e) => setReplyBody(e.target.value)}
                    className="w-full rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring-focus)] resize-y"
                    style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-card)' }}
                    data-testid="support-reply-textarea"
                  />
                </label>
                <div className="flex items-center justify-between gap-3 pt-1">
                  <span className="text-caption font-mono t-muted">{replyBody.length} / 10000</span>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={!replyBody.trim() || sending}
                    data-testid="support-send-reply-btn"
                  >
                    {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    Reply
                  </Button>
                </div>
              </form>
            </Card>
          ) : (
            <Card>
              <p className="text-xs t-muted text-center py-2">
                This ticket is closed. Open a new ticket if you need further assistance.
              </p>
            </Card>
          )}
        </div>

        {/* ── Sidebar: ticket metadata ───────────────────────────── */}
        <aside className="space-y-4 lg:sticky lg:top-5">
          <p className="text-caption font-mono uppercase tracking-[0.18em] t-muted">
            Ticket metadata
          </p>

          <Card>
            <p className="text-caption font-mono uppercase tracking-wide t-muted mb-3">Ticket details</p>
            <dl className="space-y-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-caption font-mono uppercase tracking-wide t-muted">Reference</dt>
                <dd className="text-sm font-mono t-primary">{ticketRef}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-caption font-mono uppercase tracking-wide t-muted">Category</dt>
                <dd className="text-sm t-primary capitalize">{ticket.category.replace('_', ' ')}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-caption font-mono uppercase tracking-wide t-muted">Opened</dt>
                <dd className="text-sm font-mono t-primary text-right">{new Date(ticket.created_at).toLocaleString()}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-3">
              <p className="text-caption font-mono uppercase tracking-wide t-muted">Priority</p>
              <Badge variant={PRIORITY_VARIANT[ticket.priority] ?? 'default'}>{ticket.priority}</Badge>
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="text-caption font-mono uppercase tracking-wide t-muted">Status</p>
              <Badge variant={STATUS_VARIANT[ticket.status] ?? 'default'}>{ticket.status.replace('_', ' ')}</Badge>
            </div>
            <Link
              to="/support-tickets"
              className="inline-flex items-center gap-1 text-caption font-mono uppercase tracking-wide text-accent hover:underline"
            >
              View all tickets
            </Link>
          </Card>
        </aside>
      </div>
    </div>
  );
}
