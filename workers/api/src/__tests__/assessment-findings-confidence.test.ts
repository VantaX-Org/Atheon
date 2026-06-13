/**
 * v83 per-finding confidence on the PRIMARY go-to-market finding path
 * (`assessment-findings.ts` → `AssessmentFindingsPanel` + the PDF business
 * report). Locks the classification of the 40 finding codes and the central
 * wiring in `makeFinding`:
 *
 *   - DIRECT observations (aging/overdue, mismatch, dead-stock, terminated-in-
 *     payroll, missing-on-file) are FACTS: 0.95, gate always passes, never
 *     suppressed — even a tiny sample.
 *   - INFERRED / heuristic findings (concentration ratios, off-hours / round-
 *     amount journals, maverick spend, fuzzy duplicate matching, margin /
 *     utilisation trends, FX projection) scale with sample size and gate below
 *     the minimum.
 *   - The auditor-facing basis never leaks a model / provider name (trade secret).
 */
import { describe, it, expect } from 'vitest';
import {
  FINDING_INFERENCE_KIND,
  FINDING_BASIS,
  FINDING_CATALYST_MAP,
  makeFinding,
  summariseFindings,
  type FindingCode,
} from '../services/assessment-findings';

// FINDING_CATALYST_MAP is the canonical universe of codes — the build will not
// link a detector without an entry there, so it is the right exhaustiveness set.
const ALL_CODES = Object.keys(FINDING_CATALYST_MAP) as FindingCode[];

const PROVIDER_TOKENS =
  /\b(gpt|openai|claude|anthropic|gemini|llama|mistral|workers[- ]?ai|llm|model|provider)\b/i;

// makeFinding only reads ctx.monthsOfData; cast keeps the test light.
const ctx = { baseCurrency: 'ZAR', exchangeRates: { ZAR: 1 }, monthsOfData: 6 } as never;

function baseArgs(code: FindingCode, affected: number) {
  return {
    code,
    title: 'headline',
    narrative: 'narrative',
    affected_count: affected,
    value_at_risk_zar: 1000,
    value_components: [],
    currency_breakdown: {},
    sample_records: [{ ref: 'REF-1', description: 'first sample' }],
    severity: 'high' as const,
    ctx,
  };
}

describe('finding classification maps', () => {
  it('classifies every finding code as direct or inferred', () => {
    for (const code of ALL_CODES) {
      expect(FINDING_INFERENCE_KIND[code]).toMatch(/^(direct|inferred)$/);
    }
  });

  it('gives every finding code a non-empty auditor-facing basis', () => {
    for (const code of ALL_CODES) {
      expect(typeof FINDING_BASIS[code]).toBe('string');
      expect(FINDING_BASIS[code].length).toBeGreaterThan(0);
    }
  });

  it('never leaks a model or provider name in any basis (trade secret)', () => {
    for (const code of ALL_CODES) {
      expect(FINDING_BASIS[code]).not.toMatch(PROVIDER_TOKENS);
    }
  });

  it('locks the direct / inferred split (26 direct, 14 inferred)', () => {
    const direct = ALL_CODES.filter(c => FINDING_INFERENCE_KIND[c] === 'direct');
    expect(direct.length).toBe(26);
    expect(ALL_CODES.length - direct.length).toBe(14);
  });

  it('treats observed facts as direct', () => {
    for (const c of [
      'ar_aging_overdue_90_plus',
      'ap_three_way_mismatch',
      'inv_dead_stock',
      'hr_terminated_in_payroll',
      'tax_missing_vat_numbers',
      'svc_project_margin_negative',
    ] as FindingCode[]) {
      expect(FINDING_INFERENCE_KIND[c]).toBe('direct');
    }
  });

  it('treats ratios / heuristics / trends as inferred', () => {
    for (const c of [
      'ar_top_debtor_concentration',
      'gl_round_amount_journals',
      'proc_maverick_spend',
      'inv_margin_erosion',
      'fx_currency_exposure',
      'svc_low_billable_utilisation',
    ] as FindingCode[]) {
      expect(FINDING_INFERENCE_KIND[c]).toBe('inferred');
    }
  });
});

describe('makeFinding confidence wiring', () => {
  it('direct observation is 0.95 and never gated, even for a tiny sample', () => {
    const f = makeFinding(baseArgs('ar_aging_overdue_90_plus', 3));
    expect(f.confidence).toBe(0.95);
    expect(f.confidence_gate_passed).toBe(true);
    expect(f.confidence_explanation).toContain('Direct ERP observation');
    expect(f.confidence_explanation).not.toMatch(PROVIDER_TOKENS);
  });

  it('carries the first sample record ref as erp_record_id', () => {
    const f = makeFinding(baseArgs('inv_dead_stock', 5));
    expect(f.erp_record_id).toBe('REF-1');
  });

  it('leaves erp_record_id undefined when the finding has no samples', () => {
    const args = baseArgs('inv_dead_stock', 5);
    args.sample_records = [];
    expect(makeFinding(args).erp_record_id).toBeUndefined();
  });

  it('suppresses an inferred finding below the sample minimum', () => {
    const f = makeFinding(baseArgs('ar_top_debtor_concentration', 10));
    expect(f.confidence_gate_passed).toBe(false);
    expect(f.confidence).toBeLessThan(0.6);
    expect(f.confidence_explanation).toMatch(/below the inference threshold|suppressed/i);
    expect(f.confidence_explanation).not.toMatch(PROVIDER_TOKENS);
  });

  it('passes an inferred finding at the sample minimum with confidence ~0.7', () => {
    const f = makeFinding(baseArgs('proc_supplier_concentration', 25));
    expect(f.confidence_gate_passed).toBe(true);
    expect(f.confidence).toBe(0.7);
  });

  it('scales inferred confidence up with sample size', () => {
    const f = makeFinding(baseArgs('proc_supplier_concentration', 65)); // 0.7 + 40/400 = 0.8
    expect(f.confidence).toBe(0.8);
  });
});

describe('summariseFindings — confirmed vs unverified split', () => {
  // A DIRECT finding always passes the gate (confirmed); an INFERRED finding
  // below the sample minimum (25) fails the gate (unverified/indicative).
  const confirmed = () => {
    const a = baseArgs('ar_aging_overdue_90_plus', 3);
    a.value_at_risk_zar = 4000;
    const f = makeFinding(a);
    expect(f.confidence_gate_passed).toBe(true); // sanity: direct = confirmed
    return f;
  };
  const unverified = () => {
    const a = baseArgs('ar_top_debtor_concentration', 10);
    a.value_at_risk_zar = 9000;
    const f = makeFinding(a);
    expect(f.confidence_gate_passed).toBe(false); // sanity: inferred sub-threshold = gated
    return f;
  };

  it('excludes gate-failed value from total_value_at_risk_zar', () => {
    const s = summariseFindings([confirmed(), unverified()]);
    expect(s.total_value_at_risk_zar).toBe(4000);
  });

  it('quarantines gate-failed value into potential_unverified_zar with a count', () => {
    const s = summariseFindings([confirmed(), unverified()]);
    expect(s.potential_unverified_zar).toBe(9000);
    expect(s.unverified_count).toBe(1);
  });

  it('still counts every finding in total_count', () => {
    const s = summariseFindings([confirmed(), unverified()]);
    expect(s.total_count).toBe(2);
  });

  it('reports no unverified value for a confirmed-only set', () => {
    const s = summariseFindings([confirmed(), confirmed()]);
    expect(s.potential_unverified_zar).toBe(0);
    expect(s.unverified_count).toBe(0);
    expect(s.total_value_at_risk_zar).toBe(8000);
  });
});
