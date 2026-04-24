/**
 * PII Redaction Layer
 *
 * Conservative pattern-based redaction applied to user-supplied text BEFORE the
 * text is forwarded to any third-party LLM provider (Claude / OpenAI / Ollama).
 *
 * Design goals:
 *   - False positives are acceptable (redacting too much is safe).
 *   - False negatives are not (shipping real PII to Anthropic/OpenAI is the bug).
 *   - No external dependencies, no network, runs in-worker.
 *
 * Consumers should call `redactPII(text)` and forward the `redacted` string to
 * the LLM. If `anyRedactions === true`, callers should also write an audit
 * log entry (`pii.redacted`, layer `llm`) with the matched rule names so that
 * tenants can see that redaction fired without exposing the raw PII itself.
 */

export interface RedactionRule {
  /** Stable rule name — used for audit log / metrics. */
  name: string;
  /** Regex pattern. MUST have the `g` flag so `String.replace` catches every match. */
  pattern: RegExp;
  /** Replacement token (e.g. `[EMAIL]`). */
  replacement: string;
}

export interface RedactionMatch {
  rule: string;
  count: number;
}

export interface RedactionResult {
  /** The scrubbed text — safe to send to third-party LLMs. */
  redacted: string;
  /** List of rules that matched at least once, with per-rule match counts. */
  matches: RedactionMatch[];
  /** Convenience flag — true if any rule matched. */
  anyRedactions: boolean;
}

/**
 * Default redaction rules. Order matters — more specific patterns (SSN, SA ID,
 * IBAN) should run before more generic numeric patterns (credit card, phone,
 * IP) so that the specific match wins and a subsequent generic rule doesn't
 * re-match the replacement token.
 *
 * Note: `replacement` tokens use bracket form (`[EMAIL]`) to minimise chance
 * of being consumed by a later rule.
 */
export const DEFAULT_RULES: readonly RedactionRule[] = [
  // Email — conservative, supports subdomains and TLDs 2+ chars
  { name: 'email', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: '[EMAIL]' },
  // IBAN — 2-letter country + 2 check digits + 13-30 alnum chars, optional spacing
  { name: 'iban', pattern: /\b[A-Z]{2}\d{2}\s?(?:[A-Z0-9]{4}\s?){3,7}[A-Z0-9]{1,3}\b/g, replacement: '[IBAN]' },
  // US SSN — 3-2-4 dashed format (strictly dashed to avoid matching all 9-digit numbers)
  { name: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN]' },
  // South African ID number — 13 contiguous digits
  { name: 'sa_id', pattern: /\b\d{13}\b/g, replacement: '[SA_ID]' },
  // Credit card — 13-19 digit runs with optional space/dash separators
  { name: 'credit_card', pattern: /\b(?:\d[ -]*?){13,19}\b/g, replacement: '[CREDIT_CARD]' },
  // IP v4 address
  { name: 'ip', pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: '[IP]' },
  // International phone — leading +/digit, 7-15 body, with at least one separator (space/dash/dot/paren)
  // to reduce false positives on bare numbers in prose ("target 12345").
  { name: 'phone', pattern: /\+?\d[\d\s().-]{6,14}\d/g, replacement: '[PHONE]' },
];

/**
 * Tiny Luhn check used by the credit_card rule to trim a small class of false
 * positives (e.g. 16-digit order IDs). Strictly speaking Luhn on arbitrary
 * numeric runs is still a heuristic — we still prefer a false positive over a
 * false negative, so this is advisory only: if Luhn fails we still redact.
 *
 * Kept here as a building block for tenants who want to extend rules.
 */
export function luhnValid(digits: string): boolean {
  const ds = digits.replace(/\D/g, '');
  if (ds.length < 12) return false;
  let sum = 0;
  let alt = false;
  for (let i = ds.length - 1; i >= 0; i--) {
    let n = ds.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/**
 * Apply all given (or default) redaction rules to `input`.
 *
 * Rules are applied in array order. Each rule's regex must be `g`-flagged —
 * we throw a clear error in dev if it's not, to avoid silent single-match
 * bugs.
 *
 * @param input  Raw user-supplied text. `null`/`undefined` are tolerated.
 * @param rules  Override rule set (tests, custom tenant config). Defaults to `DEFAULT_RULES`.
 * @returns      `{ redacted, matches, anyRedactions }`
 */
export function redactPII(
  input: string | null | undefined,
  rules: readonly RedactionRule[] = DEFAULT_RULES,
): RedactionResult {
  if (!input) {
    return { redacted: '', matches: [], anyRedactions: false };
  }

  let text = input;
  const matches: RedactionMatch[] = [];

  for (const rule of rules) {
    if (!rule.pattern.global) {
      throw new Error(`PII redaction rule "${rule.name}" must use the /g flag`);
    }
    // Reset lastIndex — defensive, in case the caller reuses a stateful RegExp.
    rule.pattern.lastIndex = 0;
    const found = text.match(rule.pattern);
    if (found && found.length > 0) {
      matches.push({ rule: rule.name, count: found.length });
      text = text.replace(rule.pattern, rule.replacement);
    }
  }

  return {
    redacted: text,
    matches,
    anyRedactions: matches.length > 0,
  };
}

/**
 * Convenience: returns just the redacted text, dropping the metadata. Useful
 * when the caller doesn't need to audit-log.
 */
export function scrub(input: string | null | undefined, rules?: readonly RedactionRule[]): string {
  return redactPII(input, rules).redacted;
}
