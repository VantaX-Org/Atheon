/**
 * The Brief's closed primitive set (frontend-v2 spec §3.1 — hard law).
 *
 * The Brief tree is ONE column, max measure 65ch, composed ONLY of these
 * primitives. **No `display:grid` anywhere in this tree** (§3.1) — layout is
 * stacked flow + flex only, so the Brief can never degrade back into a
 * dashboard of metric cards. Every monetary token renders through <Money>
 * (§9); prose never mints a naked number.
 *
 * DecisionCard is the ONLY card-shaped object allowed on the Brief.
 */
import type { ReactNode } from 'react';
import { ArrowRight, AlertTriangle } from 'lucide-react';
import { Money } from '@/components/common/Money';
import type { MoneyProvenance } from '@/components/common/Money';

/** Shared column wrapper — enforces the single 65ch measure for the whole tree. */
export function BriefColumn({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[65ch] flex flex-col gap-8 py-2">{children}</div>
  );
}

/**
 * §3.2-1 — date · company · freshness attestation · "Viewing as".
 * Freshness is a defined check (§3.6): degrades honestly, never claims fresh
 * over a stale connector. `viewingAs` is the persona edition label.
 */
export function Dateline({
  dateLabel,
  company,
  freshness,
  viewingAs,
}: {
  dateLabel: string;
  company: string;
  freshness: ReactNode;
  viewingAs?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-1 pb-4" style={{ borderBottom: '1px solid var(--border-card)' }}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold t-primary">{dateLabel}</p>
        {viewingAs}
      </div>
      {/* Long tenant names truncate the company, never the attestation (§8.3). */}
      <p className="text-sm t-secondary truncate">{company}</p>
      <p className="text-xs t-muted">{freshness}</p>
    </header>
  );
}

/**
 * §3.2-2 — the hero. Max ONE Figure per screenful (caller enforces). A single
 * <Money> with a measurement-basis label beneath. Figures are never combined
 * and never netted silently — the fee and net lines are separate, receipt-linked
 * numbers (forensic F5 / CFO F1).
 */
export function Figure({
  label,
  value,
  provenance,
  basis,
  onOpenReceipt,
}: {
  label: string;
  value: number | null | undefined;
  provenance: MoneyProvenance;
  basis?: ReactNode;
  onOpenReceipt?: (receiptId: string) => void;
}) {
  return (
    <section className="flex flex-col gap-1">
      <p className="text-[11px] uppercase tracking-[0.12em] t-muted font-medium">{label}</p>
      <Money
        value={value}
        provenance={provenance}
        onOpenReceipt={onOpenReceipt}
        className="text-hero leading-none"
      />
      {basis && <p className="text-sm t-secondary leading-relaxed mt-1">{basis}</p>}
    </section>
  );
}

/**
 * §3.2-3/5 — a prose line. Numbers appear only inline via <Money> passed as
 * children, never as bare text. `reversal` gives a reversed finding the same
 * weight as a gain (§3.3) with an honest marker, no muting, no red.
 */
export function Sentence({
  children,
  reversal = false,
}: {
  children: ReactNode;
  reversal?: boolean;
}) {
  return (
    <p className="text-[15px] leading-relaxed t-primary flex gap-2">
      {reversal && (
        <AlertTriangle size={15} className="mt-1 flex-shrink-0 t-muted" aria-label="Reversal" />
      )}
      <span>{children}</span>
    </p>
  );
}

/**
 * §4 — the ONLY card-shaped object on the Brief. Each: amount · counterparty ·
 * what approving does · consequence if ignored · who queued it · action.
 * Consequence is fact-bound only (§4.4) — never a fear ticker. The Brief shows
 * ≤3 and links onward to Decisions for the full queue + inline actions.
 */
export function DecisionCard({
  title,
  amount,
  amountProvenance,
  counterparty,
  whatApproving,
  consequence,
  queuedBy,
  onOpenReceipt,
  actionLabel = 'Review',
  onAction,
  actions,
}: {
  title: string;
  amount?: number | null;
  amountProvenance?: MoneyProvenance;
  counterparty?: string;
  whatApproving: string;
  consequence: string;
  queuedBy?: string;
  onOpenReceipt?: (receiptId: string) => void;
  actionLabel?: string;
  onAction?: () => void;
  /** Custom footer actions (e.g. Approve/Reject on the Decisions queue).
   *  When supplied, replaces the default single Review button. */
  actions?: ReactNode;
}) {
  return (
    <article
      className="flex flex-col gap-2 rounded-lg p-4"
      style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[15px] font-semibold t-primary leading-snug">{title}</p>
        {amount != null && amountProvenance && (
          <Money value={amount} provenance={amountProvenance} onOpenReceipt={onOpenReceipt} className="text-base flex-shrink-0" />
        )}
      </div>
      {counterparty && <p className="text-xs t-muted">{counterparty}</p>}
      <p className="text-sm t-secondary leading-relaxed">{whatApproving}</p>
      {/* Consequence: dated/sourced fact or an explicit "no deadline" — never extrapolated loss. */}
      <p className="text-xs t-muted leading-relaxed">{consequence}</p>
      <div className="flex items-center justify-between gap-3 pt-1">
        {queuedBy ? <span className="text-xs t-muted">Queued by {queuedBy}</span> : <span />}
        {actions ?? (
          <button
            onClick={onAction}
            className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
          >
            {actionLabel} <ArrowRight size={14} />
          </button>
        )}
      </div>
    </article>
  );
}

/**
 * §3.7 — external context, clearly fenced. `value_kind: 'context'` numbers may
 * ONLY render here. Typographic fence: smaller, no colour, hairline rule above,
 * explicit "not counted" label. Never enters a total.
 */
export function ContextStrip({ children }: { children: ReactNode }) {
  return (
    <aside className="pt-4 mt-2" style={{ borderTop: '1px solid var(--border-card)' }}>
      <p className="text-[10px] uppercase tracking-[0.12em] t-muted mb-1.5">Context — not counted in your numbers</p>
      <div className="text-xs t-muted leading-relaxed flex flex-wrap gap-x-4 gap-y-1">{children}</div>
    </aside>
  );
}

/**
 * §3.8 — the loop, demoted. One-line journey strip at the very bottom;
 * orientation, not content.
 */
export function ProgressRule({ children }: { children: ReactNode }) {
  return (
    <footer className="pt-4 mt-2 text-xs t-muted flex items-center gap-2 flex-wrap" style={{ borderTop: '1px solid var(--border-card)' }}>
      {children}
    </footer>
  );
}

/** Section header in the prose voice — used between figure and delta blocks. */
export function BriefHeading({ children }: { children: ReactNode }) {
  return <h2 className="text-[11px] uppercase tracking-[0.12em] t-muted font-semibold">{children}</h2>;
}
