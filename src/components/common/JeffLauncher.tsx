/**
 * JeffLauncher — app-wide honest assistant. Floating arc-reactor button opens a
 * slide-over chat that calls POST /api/mind/query. Jeff answers ONLY from the
 * tenant's real grounded context (health, risk, catalyst runs, signals — see
 * workers/api/src/routes/mind.ts getTenantContext); the persona is forbidden to
 * invent figures. This surface just renders that response verbatim plus the
 * honest provenance chips (model, latency, citations) and honest error states.
 *
 * Not the /mind page — that's the admin model-governance console. This is Jeff
 * for every authenticated user, mounted app-wide in AppLayout next to Help.
 */
import { useState, useRef, useEffect } from 'react';
import { Send, X } from 'lucide-react';
import { Portal } from '@/components/ui/portal';
import { JeffLogo } from '@/components/common/JeffLogo';
import { api, ApiError } from '@/lib/api';
import type { MindQueryResult } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';

const BUDGET_EXCEEDED_MESSAGE =
  "Your tenant's LLM budget has been reached for this month. Contact your admin to increase it.";

type Turn =
  | { role: 'user'; text: string }
  | { role: 'jeff'; result: MindQueryResult }
  | { role: 'error'; text: string };

export function JeffLauncher({ context, variant = 'floating', openKey }: { context?: string; variant?: 'floating' | 'shell'; openKey?: number } = {}) {
  const [open, setOpen] = useState(false);

  // Lets a host surface (e.g. reactor node "ask Jeff") pop the slide-over:
  // bump openKey and Jeff opens with the current context already set.
  useEffect(() => {
    if (openKey) setOpen(true);
  }, [openKey]);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const activeTenantId = useAppStore((s) => s.activeTenantId);
  const industry = useAppStore((s) => s.industry);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest turn in view as the thread grows.
  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, busy, open]);

  const ask = async () => {
    const q = prompt.trim();
    if (!q || busy) return;
    setPrompt('');
    setTurns((t) => [...t, { role: 'user', text: q }]);
    setBusy(true);
    try {
      const q2 = context ? `Context: ${context}\n\n${q}` : q;
      const result = await api.mind.query(q2, 'tier-1', activeTenantId || undefined, industry);
      setTurns((t) => [...t, { role: 'jeff', result }]);
    } catch (err) {
      const text =
        err instanceof ApiError && err.status === 429
          ? BUDGET_EXCEEDED_MESSAGE
          : err instanceof Error
            ? err.message
            : 'Jeff could not answer. Try again.';
      setTurns((t) => [...t, { role: 'error', text }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {variant === 'shell' ? (
        /* Inline nav pill for the Recovery Console shell (.rx scope styles it). */
        <button onClick={() => setOpen(true)} className="jeff-pill" aria-label="Ask Jeff — your assistant" title="Ask Jeff">
          <JeffLogo size={16} spin={busy} />
          <span>Jeff</span>
        </button>
      ) : (
        /* Floating launcher — stacked above the Help button (bottom-6). */
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-[5.25rem] right-6 z-50 w-12 h-12 rounded-full bg-accent hover:bg-accent/80 text-[var(--text-on-accent)] shadow-lg shadow-accent/20 flex items-center justify-center transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] hover:scale-105 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-app)]"
          aria-label="Ask Jeff — your assistant"
          title="Ask Jeff"
        >
          <JeffLogo size={24} />
        </button>
      )}

      {open && (
        <Portal><div className="fixed inset-0 z-[60] flex justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div
            className="relative w-full max-w-md h-full flex flex-col"
            style={{ background: 'var(--bg-card-solid)', borderLeft: '1px solid var(--border-card)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border-card)' }}>
              <div className="flex items-center gap-2.5">
                <span className="text-accent"><JeffLogo size={22} spin={busy} /></span>
                <div className="leading-tight">
                  <h2 className="text-base font-semibold t-primary">Jeff</h2>
                  <p className="text-[11px] t-muted">Grounded in your organisation's data — no guesses</p>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="t-muted hover:t-primary transition-colors" aria-label="Close Jeff">
                <X size={18} />
              </button>
            </div>

            {/* Thread */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
              {turns.length === 0 && !busy && (
                <div className="t-muted text-sm leading-relaxed">
                  <p className="mb-2">Ask about your health score, risks, catalyst runs, or exposure.</p>
                  <p className="text-xs">Jeff answers only from what your data actually shows. If a figure isn't there, he'll say so — he won't invent one.</p>
                </div>
              )}
              {turns.map((turn, i) => {
                if (turn.role === 'user') {
                  return (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[85%] rounded-lg rounded-br-sm px-3.5 py-2 text-sm bg-accent text-[var(--text-on-accent)]">
                        {turn.text}
                      </div>
                    </div>
                  );
                }
                if (turn.role === 'error') {
                  return (
                    <div key={i} className="text-sm rounded-lg px-3.5 py-2.5" style={{ background: 'var(--danger-subtle, var(--bg-secondary))', color: 'var(--danger, var(--text-primary))', border: '1px solid var(--border-card)' }}>
                      {turn.text}
                    </div>
                  );
                }
                const r = turn.result;
                return (
                  <div key={i} className="space-y-2">
                    <div className="max-w-[92%] rounded-lg rounded-bl-sm px-3.5 py-2.5 text-sm t-primary leading-relaxed whitespace-pre-line" style={{ background: 'var(--bg-secondary)' }}>
                      {r.response}
                    </div>
                    {/* Honest provenance — real model + measured latency + real citations only. */}
                    <div className="flex flex-wrap items-center gap-1.5 pl-1">
                      <Chip title="Model that answered">{r.model}</Chip>
                      <Chip title="Round-trip latency">{r.latencyMs} ms</Chip>
                      {r.citations?.length > 0 &&
                        r.citations.map((c, j) => <Chip key={j} title="Source cited by Jeff">{c}</Chip>)}
                    </div>
                  </div>
                );
              })}
              {busy && <div className="text-xs t-muted pl-1">Jeff is checking your data…</div>}
            </div>

            {/* Composer */}
            <div className="p-4" style={{ borderTop: '1px solid var(--border-card)' }}>
              <div className="flex items-end gap-2">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); }
                  }}
                  rows={1}
                  placeholder="Ask Jeff…"
                  className="flex-1 resize-none rounded-md px-3 py-2 text-sm t-primary bg-[var(--bg-secondary)] focus:outline-none focus:ring-2 focus:ring-accent/40 max-h-32"
                  style={{ border: '1px solid var(--border-card)' }}
                />
                <button
                  onClick={ask}
                  disabled={busy || !prompt.trim()}
                  className="w-10 h-10 flex-shrink-0 rounded-md bg-accent text-[var(--text-on-accent)] flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent/80 transition-colors"
                  aria-label="Send to Jeff"
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
          </div>
        </div></Portal>
      )}
    </>
  );
}

function Chip({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="font-mono text-[10px] tracking-wide px-1.5 py-0.5 rounded t-muted"
      style={{ background: 'var(--bg-elevated, var(--bg-secondary))', border: '1px solid var(--border-card)' }}
    >
      {children}
    </span>
  );
}
