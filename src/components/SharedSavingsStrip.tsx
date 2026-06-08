/**
 * SharedSavingsStrip — persistent CFO-facing "R0 until you save R1" banner.
 *
 * The shared-savings revenue model IS the entire no-brainer purchase decision.
 * Executives (CFO, COO) land on /dashboard and rarely visit /roi-dashboard
 * voluntarily, so the headline financial proof must be visible on every
 * executive surface (Dashboard, Apex, ROI) — without a dismiss escape hatch,
 * because losing the framing loses the deal.
 *
 * Hidden only when there's nothing to show (no realised savings yet on a
 * fresh tenant — a "you've recovered R0" banner is noise, not signal).
 *
 * Two visual variants:
 *   - `strip` (default) — slim horizontal banner suitable for drilldown
 *     pages (Apex, ROI, Pulse, ExecutiveSummary, Catalysts) where the
 *     page already has its own anchor metric.
 *   - `hero` — full anchor card using the Wave H-1 .card-hero / .text-hero
 *     tokens. Use exactly once per screen, only on the Dashboard, where
 *     this metric IS the anchor.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';
import type { BillingSummary } from '@/lib/api';

function formatCurrency(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency', currency, maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${Math.round(value).toLocaleString()}`;
  }
}

export interface SharedSavingsStripProps {
  /** `strip` = slim banner (default). `hero` = full anchor card. */
  variant?: 'strip' | 'hero';
}

export function SharedSavingsStrip({ variant = 'strip' }: SharedSavingsStripProps = {}): JSX.Element | null {
  const [billing, setBilling] = useState<BillingSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.insightsStats.billingSummary()
      .then((b) => { if (!cancelled) setBilling(b); })
      .catch(() => { /* missing billing is a normal state for fresh tenants */ });
    return () => { cancelled = true; };
  }, []);

  if (!billing) return null;
  if ((billing.total_realised_savings ?? 0) <= 0) return null;

  const recovered = billing.total_realised_savings;
  const billed = billing.total_atheon_revenue ?? 0;
  const multiple = billed > 0 ? recovered / billed : 0;
  const currency = billing.currency || 'ZAR';

  if (variant === 'hero') {
    return (
      <div
        className="card-hero p-7 md:p-8 flex flex-col md:flex-row md:items-end md:justify-between gap-5"
        data-testid="shared-savings-strip"
        data-variant="hero"
      >
        <div className="min-w-0">
          <p className="hero-eyebrow flex items-center gap-2 mb-3">
            <TrendingUp size={11} aria-hidden="true" />
            Shared Savings · Lifetime
          </p>
          <p className="text-hero t-primary mb-1.5">{formatCurrency(recovered, currency)}</p>
          <p className="text-body-sm t-muted">
            Recovered for your business — Atheon billed{' '}
            <strong className="t-secondary font-semibold tabular-nums font-mono">{formatCurrency(billed, currency)}</strong>
            {multiple > 0 && (
              <>
                {' '}at a{' '}
                <strong className="text-accent font-semibold tabular-nums font-mono">{multiple.toFixed(1)}×</strong> return.
              </>
            )}
          </p>
        </div>
        <Link
          to="/roi-dashboard"
          className="text-body-sm text-accent hover:underline inline-flex items-center gap-1.5 font-medium self-start md:self-end whitespace-nowrap"
        >
          See the proof <ArrowRight size={13} />
        </Link>
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-2 rounded-md text-body-sm flex-wrap"
      style={{
        background: 'rgba(163, 177, 138, 0.08)',
        border: '1px solid rgba(163, 177, 138, 0.30)',
      }}
      data-testid="shared-savings-strip"
    >
      <div className="flex items-center gap-3 flex-wrap min-w-0">
        <TrendingUp size={14} style={{ color: 'var(--accent)' }} aria-hidden="true" />
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          <span className="t-secondary">
            <strong className="t-primary font-semibold tabular-nums font-mono">{formatCurrency(recovered, currency)}</strong> recovered
          </span>
          <span className="t-muted">•</span>
          <span className="t-secondary">
            Atheon billed <strong className="t-primary font-semibold tabular-nums font-mono">{formatCurrency(billed, currency)}</strong>
          </span>
          {multiple > 0 && (
            <>
              <span className="t-muted">•</span>
              <span className="t-secondary">
                <strong className="text-accent font-semibold tabular-nums font-mono">{multiple.toFixed(1)}x</strong> return
              </span>
            </>
          )}
        </div>
      </div>
      <Link
        to="/roi-dashboard"
        className="text-caption text-accent hover:underline inline-flex items-center gap-1 font-medium"
      >
        Detail <ArrowRight size={11} />
      </Link>
    </div>
  );
}

export default SharedSavingsStrip;
