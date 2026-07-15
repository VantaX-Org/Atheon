/**
 * money.ts — the honesty-law money formatter (frontend-v2 spec §9).
 *
 * Why this exists next to format-currency.ts: the existing compact helpers use
 * `toFixed`, which ROUNDS HALF-UP and can overstate a claim (R4.197m -> "R4.2m"
 * reads as 3k more than was recovered). Forensic rule F9 is absolute: a
 * displayed claim is NEVER rounded up. So the compact path here TRUNCATES
 * toward zero at <=3 significant figures. Everything the buyer's audit
 * committee sees passes through here.
 *
 * Thresholds (§9): 100k / 1m / 1bn. Below 100k -> full grouped (no compaction
 * loses precision a decision needs). Negatives use a true minus (U+2212), never
 * a hyphen; reversals are never parenthesised away.
 */
import { currencySymbol } from './format-currency';

const MINUS = '−'; // true minus, not hyphen (§9)
const SP = ' ';    // ASCII space, spelled out (editors here emit NBSP for a typed space)
const EMDASH = '—'; // no claim (null / non-finite)

/** Truncate |x| toward zero to `sig` significant figures. Never overstates. */
function truncToSig(abs: number, sig = 3): number {
  if (abs === 0) return 0;
  const mag = Math.floor(Math.log10(abs));
  const factor = Math.pow(10, mag - (sig - 1));
  return Math.floor(abs / factor) * factor;
}

/** Strip trailing zeros from a fixed-decimal string: "4.20" -> "4.2", "1.00" -> "1". */
function trimDecimals(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Group with a plain ASCII space. en-ZA's separator is a NBSP whose exact
 * codepoint drifts across Node ICU builds; normalise it so output is
 * deterministic and testable. */
function grouped(abs: number): string {
  return Math.trunc(abs).toLocaleString('en-ZA').replace(/\s/g, SP);
}

/**
 * Compact, truncated, currency-aware. Never rounds a positive claim up.
 *   412_380       -> "R412k"      (truncated from 412 380)
 *   4_197_310     -> "R4.19m"     (NOT "R4.2m" — that would overstate)
 *   1_243_000_000 -> "R1.24bn"
 *   38_214        -> "R 38 214"   (< 100k: full grouped, no precision lost)
 *   -120_000      -> "−R120k"
 */
export function formatMoneyCompact(n: number | null | undefined, currency: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return EMDASH;
  const sym = currencySymbol(currency);
  const sign = n < 0 ? MINUS : '';
  const abs = Math.abs(n);
  if (abs < 100_000) return sign + sym + SP + grouped(abs);
  let value: number, suffix: string;
  if (abs < 1_000_000) { value = truncToSig(abs) / 1_000; suffix = 'k'; }
  else if (abs < 1_000_000_000) { value = truncToSig(abs) / 1_000_000; suffix = 'm'; }
  else { value = truncToSig(abs) / 1_000_000_000; suffix = 'bn'; }
  return sign + sym + trimDecimals(value.toFixed(2)) + suffix;
}

/**
 * Full precision, SA locale space grouping, truncated toward zero:
 *   4_182_309 -> "R 4 182 309". The exact value a receipt must reconcile to.
 */
export function formatMoneyFull(n: number | null | undefined, currency: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return EMDASH;
  const sym = currencySymbol(currency);
  const sign = n < 0 ? MINUS : '';
  return sign + sym + SP + grouped(Math.abs(n));
}
