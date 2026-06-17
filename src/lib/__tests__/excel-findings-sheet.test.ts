import { describe, it, expect } from 'vitest';
import { buildFindingsSheetRows } from '../report-generators';

describe('buildFindingsSheetRows', () => {
  it('builds a header row plus one row per finding, sorted by financial impact desc', () => {
    const findings = [
      { id: 'f1', title: 'Duplicate payments', category: 'AP', severity: 'high', financial_impact: 120000, immediate_value: 80000, ongoing_monthly_value: 3000, confidence: 0.82, evidence: { sample_records: [{ ref: 'INV-1' }, { ref: 'INV-2' }] } },
      { id: 'f2', title: 'AR aging breach', category: 'AR', severity: 'medium', financial_impact: 450000, immediate_value: 0, ongoing_monthly_value: 12000, confidence: 0.71, evidence: { sample_records: [{ ref: 'CUST-9' }] } },
    ];
    const rows = buildFindingsSheetRows(findings);
    expect(rows.length).toBe(3); // header + 2
    expect(rows[0]).toEqual(expect.arrayContaining(['Title', 'Severity', 'Confidence']));
    // highest financial_impact first
    expect(rows[1]).toEqual(expect.arrayContaining(['AR aging breach']));
  });
});
