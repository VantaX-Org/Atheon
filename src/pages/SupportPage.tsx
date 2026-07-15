/**
 * v48: Support Tickets — end-user page.
 * Lists the caller's tickets and lets them file a new one. Admins see every
 * ticket in the tenant; for triage they should use /support-triage instead.
 * Route: /support-tickets | Role: any authenticated user
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { SupportTicket, SupportTicketCategory, SupportTicketPriority } from '@/lib/api';
import { LifeBuoy, Plus, Loader2, X as XIcon } from 'lucide-react';

const CATEGORIES: Array<{ value: SupportTicketCategory; label: string }> = [
  { value: 'general', label: 'General' },
  { value: 'bug', label: 'Bug' },
  { value: 'billing', label: 'Billing' },
  { value: 'feature_request', label: 'Feature request' },
  { value: 'access', label: 'Access / login' },
  { value: 'other', label: 'Other' },
];

const PRIORITIES: SupportTicketPriority[] = ['low', 'normal', 'high', 'urgent'];

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

type FormState = {
  subject: string;
  body: string;
  category: SupportTicketCategory;
  priority: SupportTicketPriority;
};

const EMPTY_FORM: FormState = {
  subject: '',
  body: '',
  category: 'general',
  priority: 'normal',
};

export function SupportPage() {
  const toast = useToast();
  // Deep-link prefill (e.g. the 403 page links here with ?new=1&category=access
  // &subject=…&body=…) so error surfaces can hand off a ready-to-send ticket.
  const [searchParams] = useSearchParams();

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [showForm, setShowForm] = useState(searchParams.get('new') === '1');
  const [form, setForm] = useState<FormState>(() => {
    const cat = searchParams.get('category');
    return {
      ...EMPTY_FORM,
      subject: searchParams.get('subject') ?? '',
      body: searchParams.get('body') ?? '',
      category: CATEGORIES.some((c) => c.value === cat) ? (cat as SupportTicketCategory) : EMPTY_FORM.category,
    };
  });
  const [saving, setSaving] = useState(false);

  const showError = useCallback((title: string, err: unknown, fallback: string) => {
    const message = err instanceof Error ? err.message : fallback;
    toast.error(title, {
      message,
      requestId: err instanceof ApiError ? err.requestId : null,
    });
  }, [toast]);

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    try {
      const res = await api.support.list({ limit: 50 });
      setTickets(res.tickets);
      setHasMore(res.next_cursor !== null);
      setLoadFailed(false);
    } catch (err) {
      setLoadFailed(true);
      showError('Failed to load tickets', err, 'Network error');
    } finally {
      if (initial) setLoading(false);
    }
  }, [showError]);

  useEffect(() => { void load(true); }, [load]);

  const canSubmit = form.subject.trim().length > 0 && form.body.trim().length > 0 && !saving;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    try {
      const res = await api.support.create({
        subject: form.subject.trim(),
        body: form.body,
        category: form.category,
        priority: form.priority,
      });
      toast.success(`Ticket #${res.ticket.id} created`, { message: 'Track our response on this page.' });
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (err) {
      showError('Could not create ticket', err, 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const openCount = tickets.filter((t) => t.status !== 'resolved' && t.status !== 'closed').length;

  return (
    <div className="p-5 lg:p-8 max-w-7xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-8 lg:gap-12">
        {/* ── Main column ───────────────────────────────────────────── */}
        <div className="min-w-0">
          {/* 01. Masthead */}
          <header className="mb-8">
            <p className="text-label flex items-center gap-2">
              <span className="t-accent">01.</span>
              <span>How can we help?</span>
            </p>
            <h1 className="text-display t-primary mt-3">Support</h1>
            <p className="text-body-sm t-muted mt-2 max-w-2xl">
              File a ticket and track our response. For urgent outages, escalate via your CSM.
            </p>

            {/* Search-bar-styled action rail (mockup hero band) */}
            <Card
              variant="prominent"
              className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <LifeBuoy size={20} className="t-accent shrink-0" aria-hidden />
                <p className="text-sm t-secondary truncate">
                  Describe an issue and track our response here.
                </p>
              </div>
              <Button
                variant="primary"
                size="md"
                onClick={() => setShowForm(true) /* keeps any draft/prefill instead of wiping it */}
                data-testid="support-new-ticket-btn"
              >
                <Plus size={14} />
                New ticket
              </Button>
            </Card>
          </header>

          {/* 02. Your tickets */}
          <p className="text-label flex items-center gap-2 mb-4">
            <span className="t-accent">02.</span>
            <span>Your tickets</span>
          </p>

          {loading ? (
            <Card>
              <div className="flex items-center justify-center py-10 t-muted text-sm gap-2">
                <Loader2 size={16} className="animate-spin" />
                Loading tickets…
              </div>
            </Card>
          ) : loadFailed ? (
            <Card>
              <div className="text-center py-12" data-testid="support-load-error">
                <p className="text-sm t-secondary">We couldn't load your tickets.</p>
                <p className="text-xs t-muted mt-1">Your tickets are safe — this is a loading problem, not a data problem.</p>
                <Button className="mt-4" variant="secondary" size="sm" onClick={() => void load(true)}>
                  Retry
                </Button>
              </div>
            </Card>
          ) : tickets.length === 0 ? (
            <Card>
              <div className="text-center py-12">
                <LifeBuoy size={28} className="mx-auto t-muted mb-3" />
                <p className="text-sm t-secondary">You have no support tickets yet.</p>
                <p className="text-xs t-muted mt-1">Open one whenever something blocks you.</p>
                <Button className="mt-4" variant="secondary" size="sm" onClick={() => setShowForm(true)}>
                  <Plus size={14} />
                  New ticket
                </Button>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="support-ticket-list">
              {tickets.map((t) => (
                <Link
                  key={t.id}
                  to={`/support-tickets/${t.id}`}
                  className="block group"
                  data-testid="support-ticket-row"
                >
                  <Card hover className="h-full flex flex-col">
                    <div className="flex items-center gap-2 flex-wrap mb-3">
                      <Badge variant={STATUS_VARIANT[t.status] ?? 'default'}>{t.status.replace('_', ' ')}</Badge>
                      <Badge variant={PRIORITY_VARIANT[t.priority] ?? 'default'}>{t.priority}</Badge>
                      <Badge variant="default">{t.category.replace('_', ' ')}</Badge>
                    </div>
                    <h3 className="text-sm font-semibold t-primary group-hover:t-accent transition-colors">
                      {t.subject}
                    </h3>
                    <p className="text-xs t-muted mt-1.5 line-clamp-2 flex-1">{t.body}</p>
                    <div className="text-label mt-4 pt-3 border-t border-theme">
                      {new Date(t.created_at).toLocaleDateString()}
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* ── Side rail ─────────────────────────────────────────────── */}
        <aside className="space-y-6">
          {/* 03. Overview */}
          <div>
            <p className="text-label flex items-center gap-2 mb-3">
              <span className="t-accent">03.</span>
              <span>Overview</span>
            </p>
            <Card variant="prominent" className="space-y-4">
              {/* Honest counts: em-dash on failed fetch; "+" when the API
                  reports more pages beyond the 50 we loaded. */}
              <div className="flex items-baseline justify-between">
                <span className="text-caption t-muted">Total tickets</span>
                <span className="font-mono text-2xl font-bold t-primary tabular-nums">
                  {loadFailed && !loading ? '—' : hasMore ? `${tickets.length}+` : tickets.length}
                </span>
              </div>
              <div className="flex items-baseline justify-between pt-3 border-t border-theme">
                <span className="text-caption t-muted">Open</span>
                <span className="font-mono text-2xl font-bold t-primary tabular-nums">
                  {loadFailed && !loading ? '—' : hasMore ? `${openCount}+` : openCount}
                </span>
              </div>
            </Card>
          </div>
        </aside>
      </div>

      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); /* backdrop only — inside clicks must not destroy the draft */ }}
          data-testid="support-new-ticket-modal"
        >
          <Card
            className="w-full max-w-lg"
            style={{ background: 'var(--bg-modal)', maxHeight: '90vh', overflow: 'auto' }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold t-primary">New support ticket</h2>
              <button
                onClick={() => setShowForm(false)}
                className="p-1.5 rounded-md t-muted hover:t-primary hover:bg-[var(--bg-secondary)]"
                aria-label="Close"
              >
                <XIcon size={16} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-3" data-testid="support-new-ticket-form">
              <Input
                label="Subject"
                value={form.subject}
                maxLength={200}
                placeholder="Short summary of the issue"
                onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                data-testid="support-subject-input"
              />

              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1 block">
                  <span className="text-xs font-medium t-secondary">Category</span>
                  <select
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as SupportTicketCategory }))}
                    className="w-full rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring-focus)]"
                    style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-card)' }}
                    data-testid="support-category-select"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 block">
                  <span className="text-xs font-medium t-secondary">Priority</span>
                  <select
                    value={form.priority}
                    onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as SupportTicketPriority }))}
                    className="w-full rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring-focus)]"
                    style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-card)' }}
                    data-testid="support-priority-select"
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="space-y-1 block">
                <span className="text-xs font-medium t-secondary">Description</span>
                <textarea
                  value={form.body}
                  maxLength={10000}
                  rows={6}
                  placeholder="Steps to reproduce, expected vs actual, error messages..."
                  onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                  className="w-full rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring-focus)] resize-y"
                  style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-card)' }}
                  data-testid="support-body-textarea"
                />
                <span className="text-caption t-muted">{form.body.length} / 10000</span>
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowForm(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={!canSubmit}
                  data-testid="support-submit-btn"
                >
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  Create ticket
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
