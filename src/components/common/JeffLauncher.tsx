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
import { Send, X, Mic, Volume2, VolumeX } from 'lucide-react';
import { Portal } from '@/components/ui/portal';
import { JeffLogo } from '@/components/common/JeffLogo';
import { api, ApiError } from '@/lib/api';
import type { MindQueryResult } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';

const BUDGET_EXCEEDED_MESSAGE =
  "Your tenant's LLM budget has been reached for this month. Contact your admin to increase it.";

// Jeff answers arrive as markdown; the slide-over is plain text (whitespace-pre-line),
// so raw '####' and '**' leak as literal characters. Strip the emphasis/heading
// markers but keep newlines (paragraphs) and underscores (identifiers like bank_fee).
// ponytail: not a full markdown renderer — just unwrap the tokens that show up raw.
function cleanJeffMarkdown(t: string): string {
  return t
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

type Turn =
  | { role: 'user'; text: string }
  | { role: 'jeff'; result: MindQueryResult }
  | { role: 'error'; text: string };

// Web Speech API isn't in the TS DOM lib — just the surface we touch.
type SpeechRecognitionResultsLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};
type SpeechRecognitionLike = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: SpeechRecognitionResultsLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void;
};

export function JeffLauncher({ context, variant = 'floating', openKey }: { context?: string; variant?: 'floating' | 'shell'; openKey?: number } = {}) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [listening, setListening] = useState(false);
  const [speakBack, setSpeakBack] = useState(false);
  const activeTenantId = useAppStore((s) => s.activeTenantId);
  const industry = useAppStore((s) => s.industry);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recogRef = useRef<SpeechRecognitionLike | null>(null);

  // Voice is native — no dependency. Dictation via Web Speech (webkit-prefixed on
  // Safari/Chrome), and Jeff can read his answer back via speechSynthesis. Both
  // feature-detected: the buttons only render where the browser supports them.
  const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null;
  const SR = (w?.SpeechRecognition ?? w?.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null;
  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

  // Keep the newest turn in view as the thread grows.
  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, busy, open]);

  const ask = async (override?: string) => {
    const q = (override ?? prompt).trim();
    if (!q || busy) return;
    if (!override) setPrompt('');
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

  // Dictation: fill the box live, and when the user stops talking, send it — a
  // hands-free ask. onend fires once recognition settles; auto-send only if we
  // captured final speech (not an aborted/empty session).
  const toggleMic = () => {
    if (!SR) return;
    if (listening) { recogRef.current?.stop(); return; }
    const r = new SR();
    r.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-GB' : 'en-GB';
    r.interimResults = true;
    r.continuous = false;
    let finalText = '';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const seg = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += seg; else interim += seg;
      }
      setPrompt(finalText || interim);
    };
    r.onerror = () => setListening(false);
    r.onend = () => {
      setListening(false);
      const q = finalText.trim();
      if (q) { setPrompt(''); ask(q); }
    };
    recogRef.current = r;
    setListening(true);
    r.start();
  };

  // Read Jeff's newest answer aloud while speak-back is on. Cancel any in-flight
  // utterance first so answers don't queue up; cancel on close/unmount too.
  useEffect(() => {
    if (!speakBack || !canSpeak) return;
    const last = turns[turns.length - 1];
    if (last?.role === 'jeff') {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(cleanJeffMarkdown(last.result.response)));
    }
  }, [turns, speakBack, canSpeak]);
  useEffect(() => {
    if (!open && canSpeak) window.speechSynthesis.cancel();
  }, [open, canSpeak]);

  // A surface's "ask Jeff" / "explain" bumps openKey. That should KICK OFF the
  // conversation, not drop the user into an empty box. Fire once per bump, via
  // a ref so it uses the latest ask closure (current context prop). Manual opens
  // (the pill / floating button) never touch openKey, so they stay empty.
  const askRef = useRef(ask);
  askRef.current = ask;
  const lastAsked = useRef(0);
  useEffect(() => {
    if (!openKey || openKey === lastAsked.current) return;
    lastAsked.current = openKey;
    setOpen(true);
    askRef.current('Explain this in plain language.');
  }, [openKey]);

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
              <div className="flex items-center gap-1">
                {canSpeak && (
                  <button
                    onClick={() => { setSpeakBack((s) => { if (s) window.speechSynthesis.cancel(); return !s; }); }}
                    className={`transition-colors ${speakBack ? 'text-accent' : 't-muted hover:t-primary'}`}
                    aria-label={speakBack ? 'Mute Jeff’s voice' : 'Let Jeff speak answers aloud'}
                    aria-pressed={speakBack}
                    title={speakBack ? 'Jeff is reading answers aloud' : 'Read answers aloud'}
                  >
                    {speakBack ? <Volume2 size={17} /> : <VolumeX size={17} />}
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="t-muted hover:t-primary transition-colors" aria-label="Close Jeff">
                  <X size={18} />
                </button>
              </div>
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
                      {cleanJeffMarkdown(r.response)}
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
                {SR && (
                  <button
                    onClick={toggleMic}
                    className={`w-10 h-10 flex-shrink-0 rounded-md flex items-center justify-center transition-colors ${listening ? 'bg-accent text-[var(--text-on-accent)] animate-pulse' : 't-muted hover:t-primary'}`}
                    style={listening ? undefined : { border: '1px solid var(--border-card)', background: 'var(--bg-secondary)' }}
                    aria-label={listening ? 'Stop listening' : 'Speak to Jeff'}
                    aria-pressed={listening}
                    title={listening ? 'Listening — tap to stop' : 'Speak to Jeff'}
                  >
                    <Mic size={16} />
                  </button>
                )}
                <button
                  onClick={() => ask()}
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
