import { describe, it, expect } from 'vitest';
import { reportHeadlineTotal } from '@/lib/report-generators';
import type { AssessmentResults } from '@/lib/api';

const scores = [
  { estimated_annual_saving_zar: 1_000_000 },
  { estimated_annual_saving_zar: 2_000_000 },
]; // catalyst-projection sum = 3,000,000

describe('reportHeadlineTotal — report headline is the gated confirmed total', () => {
  it('uses the gated findings total when present, ignoring the catalyst sum', () => {
    const results = { findings_summary: { total_value_at_risk_zar: 750_000 } } as unknown as AssessmentResults;
    expect(reportHeadlineTotal(results, scores)).toBe(750_000);
  });

  it('uses the gated total even when it exceeds the catalyst sum (no max())', () => {
    const results = { findings_summary: { total_value_at_risk_zar: 9_000_000 } } as unknown as AssessmentResults;
    expect(reportHeadlineTotal(results, scores)).toBe(9_000_000);
  });

  it('falls back to the catalyst sum for legacy assessments with no findings_summary', () => {
    expect(reportHeadlineTotal({} as AssessmentResults, scores)).toBe(3_000_000);
    expect(reportHeadlineTotal(null, scores)).toBe(3_000_000);
  });
});
