import { describe, it, expect } from 'vitest';
import { renderValueReportPDF, DEFAULT_VALUE_ASSESSMENT_CONFIG } from '../services/value-assessment-engine';

// Smoke test for the per-finding native mini-charts (one-off/recurring +
// source/target bars) drawn into the worker Value PDF. We exercise the
// renderer directly (no DB/R2 needed) with a seeded finding that carries
// evidence.sample_records, and assert it produces a real PDF.
describe('renderValueReportPDF - per-finding native charts', () => {
  it('renders a non-empty PDF with %PDF magic bytes', async () => {
    const summary: Record<string, unknown> = {
      total_immediate_value: 1_250_000,
      total_ongoing_monthly_value: 85_000,
      total_ongoing_annual_value: 1_020_000,
      total_findings: 1,
      payback_days: 42,
      outcome_based_monthly_fee: 17_000,
      outcome_based_fee_pct: 20,
      executive_narrative: 'Material recoverable value identified across procurement and AP.',
      value_by_domain: JSON.stringify({
        finance: { immediate: 1_250_000, ongoing: 85_000, findings: 1 },
      }),
    };

    const findings: Array<Record<string, unknown>> = [
      {
        title: 'Duplicate supplier payments in accounts payable',
        severity: 'high',
        domain: 'finance',
        category: 'duplicate_payment',
        description: 'Multiple invoices paid twice against the same PO across the assessment window.',
        root_cause: 'No three-way match enforced before payment release.',
        prescription: 'Enforce PO/GRN/invoice three-way match and block duplicate vendor refs.',
        financial_impact: 1_250_000,
        affected_records: 312,
        immediate_value: 1_250_000,
        ongoing_monthly_value: 85_000,
        confidence: 0.86,
        confidence_explanation: 'Sample of 312 matched records; mode share 91% above duplicate threshold.',
        erp_record_id: 'AP-DOC-00482193',
        evidence: JSON.stringify({
          first_occurrence: '2025-01-14',
          frequency: 'monthly',
          sample_records: [
            { ref: 'INV-1001', source_value: 120000, target_value: 60000, difference: 60000 },
            { ref: 'INV-1002', source_value: 98000, target_value: 49000, difference: 49000 },
            { ref: 'INV-1003', source_value: 75000, target_value: 75000, difference: 0 },
            { ref: 'INV-1004', source_value: 64000, target_value: 32000, difference: 32000 },
            { ref: 'INV-1005', source_value: 53000, target_value: 26500, difference: 26500 },
            { ref: 'INV-1006', source_value: 41000, target_value: 20500, difference: 20500 },
            { ref: 'INV-1007', source_value: 30000, target_value: 15000, difference: 15000 },
            { ref: 'INV-1008', source_value: 22000, target_value: 11000, difference: 11000 },
          ],
        }),
      },
    ];

    const bytes = await renderValueReportPDF({
      prospectName: 'Acme Holdings (Pty) Ltd',
      assessmentId: 'asmt-test-0001',
      config: DEFAULT_VALUE_ASSESSMENT_CONFIG,
      summary,
      findings,
      dqRecords: [],
      timingRecords: [],
    });

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(1000);
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    expect(magic).toBe('%PDF');
  });
});
