/**
 * v83 per-finding confidence + sample-size gating (the binding shared-savings
 * rule: every claimed dollar carries a confidence and an auditor-facing basis).
 *
 * Pure-function tests for the three exported helpers in the value-assessment
 * engine. These lock in the key judgment behind the traceability sweep:
 *
 *   - DIRECT OBSERVATIONS (overdue, stale-po, dead-stock) are FACTS: 0.95
 *     confidence, NEVER suppressed by the sample-size gate. Three genuinely
 *     overdue invoices is still a fact.
 *   - INFERRED / HEURISTIC findings (dup-payments, timing-o2c, timing-p2p)
 *     gate below MIN_SAMPLE_SIZE and their confidence scales with n.
 *   - confidence_explanation states the STATISTICAL BASIS only — it must never
 *     leak a model or provider name (trade secret).
 */
import { describe, it, expect } from 'vitest';
import {
  MIN_SAMPLE_SIZE,
  guardSampleSize,
  directObservationConfidence,
  inferredConfidence,
} from '../services/value-assessment-engine';

// Tokens that would betray the model/provider trade secret if they ever leaked
// into an auditor-facing explanation. confidence_explanation states the
// statistical basis ONLY.
const PROVIDER_TOKENS =
  /\b(gpt|openai|claude|anthropic|gemini|llama|mistral|workers[- ]?ai|llm|model|provider)\b/i;

describe('MIN_SAMPLE_SIZE', () => {
  it('matches the inference rule (sample >= 25)', () => {
    expect(MIN_SAMPLE_SIZE).toBe(25);
  });
});

describe('guardSampleSize', () => {
  it('suppresses below the threshold with a descriptive reason', () => {
    const g = guardSampleSize(24, 'dq-dup-payments');
    expect(g.allow).toBe(false);
    expect(g.reason).toContain('dq-dup-payments');
    expect(g.reason).toContain('24');
    expect(g.reason).toContain('25');
  });

  it('allows at exactly the threshold with an empty reason', () => {
    const g = guardSampleSize(25, 'timing-o2c');
    expect(g.allow).toBe(true);
    expect(g.reason).toBe('');
  });

  it('allows above the threshold', () => {
    expect(guardSampleSize(1000, 'timing-p2p').allow).toBe(true);
  });

  it('honours a custom minimum', () => {
    expect(guardSampleSize(9, 'x', 10).allow).toBe(false);
    expect(guardSampleSize(10, 'x', 10).allow).toBe(true);
  });
});

describe('directObservationConfidence', () => {
  it('is always 0.95 and never gated, even for a tiny sample', () => {
    for (const n of [1, 3, 25, 5000]) {
      const v = directObservationConfidence(n, 'invoices past due and unpaid');
      expect(v.confidence).toBe(0.95);
      expect(v.gate.allow).toBe(true);
      expect(v.gate.reason).toBe('');
    }
  });

  it('explanation cites the record count and disclaims inference', () => {
    const v = directObservationConfidence(40, 'invoices past due and unpaid');
    expect(v.explanation).toContain('40');
    expect(v.explanation).toMatch(/no statistical inference/i);
  });

  it('explanation never names a model or provider', () => {
    const v = directObservationConfidence(40, 'products with no movement in 12+ months');
    expect(v.explanation).not.toMatch(PROVIDER_TOKENS);
  });
});

describe('inferredConfidence', () => {
  const BASIS = 'Identical amount paid on the same day is a duplicate-payment signal.';

  it('suppresses below the minimum with a sub-0.6 audit-trail score', () => {
    const v = inferredConfidence(10, 'dq-dup-payments', BASIS);
    expect(v.gate.allow).toBe(false);
    // (10 / 25) * 0.6 = 0.24
    expect(v.confidence).toBe(0.24);
    expect(v.confidence).toBeLessThan(0.6);
    expect(v.explanation).toMatch(/below the inference threshold|suppressed/i);
  });

  it('starts at ~0.7 right at the threshold', () => {
    const v = inferredConfidence(MIN_SAMPLE_SIZE, 'timing-o2c', BASIS);
    expect(v.gate.allow).toBe(true);
    expect(v.confidence).toBe(0.7);
  });

  it('scales up with sample size and caps at 0.95', () => {
    const mid = inferredConfidence(65, 'timing-o2c', BASIS); // 0.7 + 40/400 = 0.8
    expect(mid.confidence).toBe(0.8);
    // 0.7 + (125-25)/400 = 0.95 — exactly the cap
    expect(inferredConfidence(125, 'timing-o2c', BASIS).confidence).toBe(0.95);
    // far above never exceeds the cap
    expect(inferredConfidence(100_000, 'timing-o2c', BASIS).confidence).toBe(0.95);
  });

  it('is monotonically non-decreasing in sample size', () => {
    let prev = -1;
    for (const n of [5, 24, 25, 50, 125, 500]) {
      const c = inferredConfidence(n, 'timing-p2p', BASIS).confidence;
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });

  it('honours a custom minimum threshold', () => {
    const below = inferredConfidence(9, 'x', BASIS, 10);
    expect(below.gate.allow).toBe(false);
    const at = inferredConfidence(10, 'x', BASIS, 10);
    expect(at.gate.allow).toBe(true);
    expect(at.confidence).toBe(0.7);
  });

  it('explanation carries the basis but never names a model or provider', () => {
    const above = inferredConfidence(200, 'timing-o2c', BASIS);
    expect(above.explanation).toContain(BASIS);
    expect(above.explanation).not.toMatch(PROVIDER_TOKENS);
    const below = inferredConfidence(3, 'timing-o2c', BASIS);
    expect(below.explanation).not.toMatch(PROVIDER_TOKENS);
  });
});
