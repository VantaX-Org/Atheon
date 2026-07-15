/**
 * <Money> — the honesty law as a type system (frontend-v2 spec §9).
 *
 * One component renders every monetary value in the product. Named Money, not
 * Rand: the platform is multi-tenant (useTenantCurrency), so a component named
 * after one currency is a bug at the type level.
 *
 * Honesty guarantees this component enforces:
 *  - `provenance` is REQUIRED. A number with no provenance is a compile error.
 *  - confirmed = ink; unverified = 40% grey + dotted underline + "needs review"
 *    label — identical treatment on every surface (Brief, Ledger, Board).
 *  - the exact full-precision value is ALWAYS in the a11y tree (aria-label) and
 *    on hover (title), so a compacted figure is never the only thing on offer.
 *  - null / non-finite renders an em-dash (no claim), never a coerced 0.
 *
 * The receipt DRAWER (§5.2 sealed snapshot) is a separate subsystem. This
 * component only exposes the seam: pass `onOpenReceipt` and, when the value is
 * receipt-backed, it renders as a button that calls it. No handler → plain
 * text. So the drawer wires in later with zero changes here.
 */
import { formatMoneyCompact, formatMoneyFull } from '@/lib/money';
import { useTenantCurrency } from '@/stores/appStore';

/** Where a displayed number came from and whether it may be counted as a claim. */
export type MoneyProvenance =
  /** Verified against a confirmed finding/recovery — rendered in ink. */
  | { kind: 'confirmed'; receiptId?: string; basis?: string }
  /** Detected but not yet confirmed — greyed, dotted, "needs review", never counted. */
  | { kind: 'unverified'; receiptId?: string; basis?: string }
  /** Ambient context (ranges, targets, illustrative) — only valid inside a ContextStrip. */
  | { kind: 'context'; basis?: string };

export interface MoneyProps {
  value: number | null | undefined;
  provenance: MoneyProvenance;
  /** Compact (R4.19m) by default; full precision (R4 182 309) when false. */
  compact?: boolean;
  /** Opens the receipt drawer for `provenance.receiptId`. Seam for §5.2. */
  onOpenReceipt?: (receiptId: string) => void;
  className?: string;
}

export function Money({ value, provenance, compact = true, onOpenReceipt, className }: MoneyProps) {
  const currency = useTenantCurrency();
  const display = compact ? formatMoneyCompact(value, currency) : formatMoneyFull(value, currency);
  const exact = formatMoneyFull(value, currency); // always the precise value for a11y / hover

  const unverified = provenance.kind === 'unverified';
  // Exact value + status is always in the a11y tree, even when the visual is compacted.
  const label =
    exact === '—'
      ? 'No value'
      : unverified
        ? `${exact} — needs review, not counted`
        : exact;

  const tone = unverified
    ? 't-muted underline decoration-dotted underline-offset-2 opacity-60'
    : 't-primary';
  const base = `tnum ${tone}${className ? ` ${className}` : ''}`;

  const receiptId = provenance.kind !== 'context' ? provenance.receiptId : undefined;
  // Receipt-backed + a handler wired → interactive. Otherwise plain text.
  if (receiptId && onOpenReceipt) {
    return (
      <button
        type="button"
        onClick={() => onOpenReceipt(receiptId)}
        className={`${base} cursor-pointer hover:decoration-solid transition-[color] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)]`}
        title={`${label} · open receipt`}
        aria-label={`${label}. Open receipt.`}
      >
        {display}
      </button>
    );
  }

  return (
    <span className={base} title={label} aria-label={label}>
      {display}
    </span>
  );
}
