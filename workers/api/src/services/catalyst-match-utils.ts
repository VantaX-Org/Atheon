/**
 * Shared match helpers for catalyst domain handlers.
 *
 * Word-boundary matching: substring checks like s.includes('pos') used to
 * false-positive on words like "exposure" (see PR #10 integration test
 * failures). These helpers treat any non-alphanumeric character (including
 * '_', '-', space, punctuation) as a token boundary, so 'hr' matches in
 * "hr_turnover" but not in "chrome", and 'pos' matches in "pos_system" but
 * not in "exposure".
 */

import type { TaskDefinition } from './catalyst-engine';

/**
 * Flatten task identity into a single lowercase string for match predicates.
 * Combines catalystName, action, and inputData.domain so a caller can route
 * via any of them.
 */
export function taskText(task: TaskDefinition): string {
  const domain = typeof task.inputData.domain === 'string' ? task.inputData.domain : '';
  return `${task.catalystName} ${task.action} ${domain}`.toLowerCase();
}

const WORD_CHAR = /[a-z0-9]/;

/** True if `term` appears in `s` at a token boundary (both sides non-word). */
export function hasWord(s: string, term: string): boolean {
  const lower = term.toLowerCase();
  let from = 0;
  while (from <= s.length - lower.length) {
    const idx = s.indexOf(lower, from);
    if (idx === -1) return false;
    const before = idx === 0 ? '' : s[idx - 1];
    const after = idx + lower.length >= s.length ? '' : s[idx + lower.length];
    if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after)) return true;
    from = idx + 1;
  }
  return false;
}

/** True if any of the given terms appears in `s` at a token boundary. */
export function anyWord(s: string, ...terms: string[]): boolean {
  return terms.some(t => hasWord(s, t));
}

/** True if all of the given terms appear in `s` at token boundaries. */
export function allWords(s: string, ...terms: string[]): boolean {
  return terms.every(t => hasWord(s, t));
}
