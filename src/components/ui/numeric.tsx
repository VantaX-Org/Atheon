/**
 * `<Numeric>` — canonical primitive for rendering a number in the UI.
 *
 * Replaces the ~150+ ad-hoc `value.toFixed(N)` / `value?.toLocaleString()` /
 * `value ? '...' : '—'` sites scattered across the platform. Born out of
 * the WORLD_CLASS_FRONTEND_PROPOSAL Phase 1 to make every number on screen:
 *
 *   - Monospaced            — vertical alignment when stacked in tables/strips
 *   - Null-safe              — renders `—` for null / undefined / NaN / Infinity
 *   - Currency-aware         — knows ZAR vs USD vs EUR symbols, no hard-coded "R"
 *   - Trend-aware (optional) — leading ▲ / ▼ / · glyph + tone colour
 *   - Compact-aware          — 1.2M / 850k for narrow strips; full for tables
 *
 * Numbers are the body language of an enterprise platform. They should look
 * like Bloomberg, not Excel. This component is that contract.
 *
 * Example usage:
 *
 *   <Numeric value={overall} precision={0} />                    // 55
 *   <Numeric value={revenue} unit="currency" compact />          // tenant symbol, e.g. R 2.5M / $ 2.5M
 *   <Numeric value={delta}   precision={1} trend />              // ▲ 3.2
 *   <Numeric value={null} />                                     // —
 */
import type { CSSProperties } from 'react';
import { formatCompactCurrency, formatFullCurrency } from '@/lib/format-currency';
import { useTenantCurrency } from '@/stores/appStore';

export type NumericTrend = 'up' | 'down' | 'flat' | 'auto';

export interface NumericProps {
  /** The number to render. `null` / `undefined` / NaN / non-finite → `—`. */
  value: number | null | undefined;
  /** Decimal places. `0` (default) for counts; `1` or `2` for percentages. */
  precision?: number;
  /** `currency` → tenant display currency (preferred; never hardcode 'R').
   *  An explicit ISO code (`ZAR`, `USD`, `EUR`, `GBP`) overrides the tenant
   *  currency and drives the symbol + locale (`Intl.NumberFormat`).
   *  `%` renders a percent; plain strings (`days`, `runs`) render as a small
   *  trailing label. */
  unit?: string;
  /** Compact form: 1,234,567 → "1.2M". Default false. */
  compact?: boolean;
  /** Render a leading trend glyph (▲ / ▼ / ·). `auto` derives from sign. */
  trend?: NumericTrend | boolean;
  /** Override trend tone colour. Otherwise: positive=RAG healthy, negative=RAG
   *  risk, flat=muted. Trend direction is a HEALTH signal, not brand — it never
   *  uses brand blue. Pass `mute` to render the glyph but stay foreground-neutral. */
  tone?: 'positive' | 'negative' | 'neutral' | 'mute';
  /** Visual weight. `lg` is hero numbers (the one big number per screen). */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** When true, value renders as deletion (struck-through, muted). For
   *  "was 80 → now 55" diffs in trend strips. */
  strike?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Hover tooltip — default is the full uncompacted value when `compact`. */
  title?: string;
}

const PLACEHOLDER = '—';

const sizeClass: Record<NonNullable<NumericProps['size']>, string> = {
  sm: 'text-body-sm',
  md: 'text-body',
  lg: 'text-headline-xl',
  xl: 'text-display',
};

const CURRENCY_LOCALES: Record<string, string> = {
  ZAR: 'en-ZA',
  USD: 'en-US',
  EUR: 'de-DE',
  GBP: 'en-GB',
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function formatCompact(n: number, currency?: string): string {
  // Currency delegates to the shared helper so JSX and string-context renders
  // (tooltips, PDF, table cells) match digit-for-digit across any tenant ISO.
  if (currency) return formatCompactCurrency(n, currency);
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return `${Math.round(n)}`;
}

function formatFull(n: number, precision: number, currency?: string): string {
  if (currency) return formatFullCurrency(n, currency);
  return n.toLocaleString(undefined, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

function resolveTrend(trend: NumericProps['trend'], value: number): NumericTrend {
  if (trend === true || trend === 'auto') {
    if (value > 0) return 'up';
    if (value < 0) return 'down';
    return 'flat';
  }
  return trend as NumericTrend;
}

const GLYPH: Record<NumericTrend, string> = {
  up: '▲',
  down: '▼',
  flat: '·',
  auto: '·',
};

function toneClass(t: NumericProps['tone'], trend: NumericTrend | null): string {
  // Trend tone is HEALTH semantics → RAG tokens, never brand blue.
  if (t === 'mute') return 't-muted';
  if (t === 'positive') return 'text-[var(--rag-healthy)]';
  if (t === 'negative') return 'text-[var(--rag-risk)]';
  if (t === 'neutral') return 't-primary';
  if (!trend || trend === 'flat') return 't-primary';
  return trend === 'up' ? 'text-[var(--rag-healthy)]' : 'text-[var(--rag-risk)]';
}

export function Numeric({
  value,
  precision = 0,
  unit,
  compact = false,
  trend = false,
  tone,
  size = 'md',
  strike = false,
  className = '',
  style,
  title,
}: NumericProps): JSX.Element {
  // Tenant display currency — resolved unconditionally (hook) so `unit="currency"`
  // renders the tenant's symbol. Must precede any early return.
  const tenantCurrency = useTenantCurrency();

  // Null / undefined / NaN / Infinity → the placeholder. Never let Bloomberg
  // see "Infinity days".
  if (!isFiniteNumber(value)) {
    return (
      <span
        className={`font-mono t-muted ${sizeClass[size]} ${className}`}
        style={style}
        title={title}
        aria-label="No data"
      >
        {PLACEHOLDER}
      </span>
    );
  }

  // `unit="currency"` → tenant currency; an explicit known ISO code overrides it.
  const currencyCode = unit === 'currency'
    ? tenantCurrency
    : (unit && CURRENCY_LOCALES[unit] !== undefined ? unit : undefined);
  const isCurrency = currencyCode !== undefined;
  const isPercent = unit === '%';
  const formatted = compact
    ? formatCompact(value, currencyCode)
    : formatFull(value, precision, currencyCode);

  const resolvedTrend = trend ? resolveTrend(trend, value) : null;
  const tc = toneClass(tone, resolvedTrend);

  const showUnitSuffix = !isCurrency && !isPercent && !!unit;

  return (
    <span
      className={`tabular-nums font-mono ${sizeClass[size]} ${tc} ${strike ? 'line-through opacity-60' : ''} ${className}`}
      style={style}
      title={title ?? (compact ? formatFull(value, precision, currencyCode) : undefined)}
    >
      {resolvedTrend && (
        <span aria-hidden="true" className="mr-1 inline-block">
          {GLYPH[resolvedTrend]}
        </span>
      )}
      {formatted}
      {isPercent && <span className="ml-0.5">%</span>}
      {showUnitSuffix && (
        <span className="ml-1 text-caption t-muted font-medium">{unit}</span>
      )}
    </span>
  );
}
