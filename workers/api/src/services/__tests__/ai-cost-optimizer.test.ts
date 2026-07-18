/**
 * AI cost-optimizer math tests - customer-facing $ projections & savings.
 *
 * These numbers land in the /api/v1/ai-costs dashboard, so a wrong per-token
 * rate or a broken cheap-vs-expensive routing decision either overbills the
 * savings story or misroutes every query. All expected values below are
 * hand-computed from the published rate card, NOT derived from the function
 * under test - the oracle is independent so a symmetric bug can't hide.
 *
 * Pure functions only (estimateCost, classifyComplexity) - no KV/D1 needed.
 */
import { describe, it, expect } from 'vitest';
import { estimateCost, classifyComplexity, DEFAULT_TIERED_CONFIG } from '../ai-cost-optimizer';

const MODEL_8B = '@cf/meta/llama-3.1-8b-instruct-fp8';
const MODEL_70B = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MODEL_EMBED = '@cf/baai/bge-base-en-v1.5';

describe('estimateCost - core token->cost math', () => {
  // Rate card (per 1000 tokens): 8b in 0.0003 / out 0.0006.
  it('computes 8b cost from a hand-worked example', () => {
    // 2000 in -> 2 * 0.0003 = 0.0006 ; 500 out -> 0.5 * 0.0006 = 0.0003 ; sum 0.0009
    expect(estimateCost(MODEL_8B, 2000, 500)).toBeCloseTo(0.0009, 10);
  });

  it('computes 70b cost from a hand-worked example', () => {
    // 70b: in 0.0035 / out 0.0070. 2000 in -> 0.0070 ; 500 out -> 0.0035 ; sum 0.0105
    expect(estimateCost(MODEL_70B, 2000, 500)).toBeCloseTo(0.0105, 10);
  });

  it('honours output-only-free models (embeddings)', () => {
    // bge: in 0.00005 / out 0. 10000 in -> 10 * 0.00005 = 0.0005 ; out ignored
    expect(estimateCost(MODEL_EMBED, 10000, 9999)).toBeCloseTo(0.0005, 10);
  });

  it('falls back to the default rate for an unknown model', () => {
    // default: in 0.001 / out 0.002. 1000 in -> 0.001 ; 1000 out -> 0.002 ; sum 0.003
    expect(estimateCost('some/unlisted-model', 1000, 1000)).toBeCloseTo(0.003, 10);
  });

  it('scales linearly with token volume', () => {
    const single = estimateCost(MODEL_8B, 1000, 1000);
    expect(estimateCost(MODEL_8B, 10000, 10000)).toBeCloseTo(single * 10, 10);
  });
});

describe('routing recommends the cheaper model when it suffices', () => {
  it('classifies a plain data-retrieval query as simple (cheap 8b tier)', () => {
    expect(classifyComplexity('show me the sales total for last month')).toBe('simple');
    // the simple tier is wired to the cheap 8b model
    expect(DEFAULT_TIERED_CONFIG.simple.workersAiModel).toBe(MODEL_8B);
  });

  it('projected saving of routing simple->8b instead of 70b equals the hand-computed delta', () => {
    const tokensIn = 2000, tokensOut = 500;
    const cheap = estimateCost(DEFAULT_TIERED_CONFIG.simple.workersAiModel, tokensIn, tokensOut);   // 0.0009
    const dear = estimateCost(DEFAULT_TIERED_CONFIG.complex.workersAiModel, tokensIn, tokensOut);    // 0.0105
    const savings = dear - cheap;
    expect(savings).toBeCloseTo(0.0096, 10);       // 0.0105 - 0.0009
    // saving is real and can never exceed the expensive-model cost it replaces
    expect(savings).toBeGreaterThan(0);
    expect(savings).toBeLessThan(dear);
  });

  it('escalates genuinely hard queries to the complex tier', () => {
    expect(classifyComplexity('why did revenue drop and what should we do')).toBe('complex');
    expect(classifyComplexity('recommend a strategy to optimize inventory')).toBe('complex');
    // tier-3 always forces complex regardless of wording
    expect(classifyComplexity('hi', { tier: 'tier-3' })).toBe('complex');
  });
});

describe('edge cases - no NaN/Infinity, no impossible values', () => {
  it('zero usage costs exactly zero (never NaN/Infinity)', () => {
    for (const m of [MODEL_8B, MODEL_70B, MODEL_EMBED, 'unknown/x']) {
      const c = estimateCost(m, 0, 0);
      expect(c).toBe(0);
      expect(Number.isFinite(c)).toBe(true);
    }
  });

  it('cost is never negative for non-negative usage', () => {
    expect(estimateCost(MODEL_70B, 1, 0)).toBeGreaterThan(0);
    expect(estimateCost(MODEL_8B, 0, 1)).toBeGreaterThan(0);
  });

  it('empty query does not throw and defaults to simple', () => {
    expect(classifyComplexity('')).toBe('simple');
  });
});
