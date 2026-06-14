/**
 * Canonical currency / number formatters.
 *
 * Use these in string contexts (template literals, `title` attrs, table
 * cells passed as strings, PDF generators). For JSX, prefer `<Numeric>`
 * which uses these same helpers under the hood — that guarantees a
 * standalone "R1.5M" tile and an inline "R 1,500,000" tooltip render
 * the same digits.
 *
 * Replaces ~7 hand-rolled `fmtZAR` / `formatZAR` / `formatCurrency`
 * duplicates that had subtly different rounding, locale, and spacing.
 */

/** Compact ZAR for hero tiles and badges: 1_500_000 → "R 1.5M". */
export function formatZarCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `R ${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `R ${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `R ${(n / 1_000).toFixed(0)}k`;
  return `R ${Math.round(n)}`;
}

/** Board-precision ZAR (2 decimals at M/B): 1_500_000 → "R 1.50M". */
export function formatZarPrecise(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (n === 0) return 'R 0';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `R ${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `R ${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `R ${(n / 1e3).toFixed(1)}k`;
  return `R ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/** Full ZAR for tables, tooltips, PDF output: 1_500_000 → "R 1,500,000". */
export function formatZarFull(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `R ${Math.round(n).toLocaleString('en-ZA')}`;
}

/** Compact ZAR with explicit sign: +1_500 → "+R 2k", -2_000 → "-R 2k". */
export function formatZarDelta(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (n === 0) return 'R 0';
  const sign = n > 0 ? '+' : '';
  return `${sign}${formatZarCompact(n)}`;
}

/** Full currency via Intl with graceful fallback for unknown ISO codes. */
export function formatCurrency(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency', currency, maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${Math.round(value).toLocaleString()}`;
  }
}

/**
 * Localised currency symbol for an ISO code: 'ZAR' → 'R', 'USD' → '$',
 * 'EUR' → '€'. Falls back to the ISO code itself for unknown codes.
 * Currency is a tenant-level setting — never hardcode 'R'; pass the
 * currency that travels with the figure (billing summary, platform totals).
 */
export function currencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat('en-ZA', {
      style: 'currency', currency, maximumFractionDigits: 0,
    }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

/**
 * Compact, currency-aware figure for hero tiles and badges:
 * (1_500_000, 'ZAR') → "R 1.5M", (4_280_000, 'USD') → "$ 4.3M".
 * The tenant-agnostic sibling of formatZarCompact.
 */
export function formatCompactCurrency(n: number | null | undefined, currency: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const sym = currencySymbol(currency);
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${sym} ${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sym} ${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sym} ${(n / 1_000).toFixed(0)}k`;
  return `${sym} ${Math.round(n).toLocaleString('en-ZA')}`;
}

/**
 * Board-precision, currency-aware: (1_500_000, 'USD') → "$ 1.50M".
 * Tenant-agnostic sibling of formatZarPrecise.
 */
export function formatPreciseCurrency(n: number | null | undefined, currency: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const sym = currencySymbol(currency);
  if (n === 0) return `${sym} 0`;
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${sym} ${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sym} ${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sym} ${(n / 1e3).toFixed(1)}k`;
  return `${sym} ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/**
 * Full, currency-aware figure for tables/tooltips: (1_500_000, 'USD') →
 * "$ 1,500,000". Tenant-agnostic sibling of formatZarFull.
 */
export function formatFullCurrency(n: number | null | undefined, currency: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${currencySymbol(currency)} ${Math.round(n).toLocaleString('en-ZA')}`;
}

/**
 * Compact, currency-aware with explicit sign: (+1_500, 'USD') → "+$ 2k".
 * Tenant-agnostic sibling of formatZarDelta.
 */
export function formatDeltaCurrency(n: number | null | undefined, currency: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (n === 0) return `${currencySymbol(currency)} 0`;
  const sign = n > 0 ? '+' : '';
  return `${sign}${formatCompactCurrency(n, currency)}`;
}
