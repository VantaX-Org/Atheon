/**
 * Trial funnel — real ingest + detectors, NO fabrication.
 *
 * Regression lock on the deleted Math.random() fallback: thin/no data must
 * surface an honest insufficient_data state (exposure NULL), and real uploaded
 * data must produce a confidence-gated exposure that traces to the findings.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { ensureMigrated } from './setup';

// Unique IP per test keeps each under the 3/IP/day /start rate limit.
async function startTrial(ip: string): Promise<string> {
  const res = await SELF.fetch('http://localhost/api/trial/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify({ company_name: 'Acme', industry: 'manufacturing', contact_name: 'Jo', contact_email: 'jo@acme.co.za' }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { id: string }).id;
}

function overdueInvoiceRows(n: number): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  for (let i = 0; i < n; i++) {
    const inv = new Date(Date.now() - 160 * 86400_000).toISOString().slice(0, 10);
    const due = new Date(Date.now() - 120 * 86400_000).toISOString().slice(0, 10);
    rows.push({
      invoice_number: `INV-${i}`,
      customer_name: `Customer ${i}`,
      invoice_date: inv,
      due_date: due,
      total: '50000',
      amount_due: '50000',
      currency: 'ZAR',
      payment_status: 'unpaid',
      status: 'sent',
    });
  }
  return rows;
}

const INVOICE_HEADER = ['invoice_number', 'customer_name', 'invoice_date', 'due_date', 'total', 'amount_due', 'currency', 'payment_status', 'status'];

describe('Trial funnel - real detectors, no fabrication', () => {
  beforeAll(async () => { await ensureMigrated(); });

  it('upload-run-results reports a real confidence-gated exposure that traces to the findings', async () => {
    const id = await startTrial('10.0.0.1');

    const up = await SELF.fetch(`http://localhost/api/trial/${id}/upload`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '10.0.0.1' },
      body: JSON.stringify({ domains: { invoices: { header: INVOICE_HEADER, rows: overdueInvoiceRows(30) } } }),
    });
    expect(up.status).toBe(200);
    expect(((await up.json()) as { row_counts: Record<string, number> }).row_counts.invoices).toBe(30);

    // Rows really landed in erp_invoices tagged with the trial dataset.
    const cnt = await env.DB.prepare(`SELECT COUNT(*) c FROM erp_invoices WHERE dataset_id = ?`).bind(`ds_trial_${id}`).first<{ c: number }>();
    expect(cnt?.c).toBe(30);

    const run = await SELF.fetch(`http://localhost/api/trial/${id}/run`, { method: 'POST', headers: { 'cf-connecting-ip': '10.0.0.1' } });
    expect(run.status).toBe(200);
    expect(((await run.json()) as { insufficient_data: boolean }).insufficient_data).toBe(false);

    const res = await SELF.fetch(`http://localhost/api/trial/${id}/results`, { headers: { 'cf-connecting-ip': '10.0.0.1' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      estimatedExposure: number | null; insufficientData: boolean; issuesFound: number;
      findings: unknown[]; findingsSummary: { total_value_at_risk_zar: number };
    };
    expect(body.insufficientData).toBe(false);
    expect(body.estimatedExposure).toBeGreaterThan(0);
    expect(body.findings.length).toBeGreaterThan(0);
    expect(body.issuesFound).toBeGreaterThan(0);
    // Traceability: the headline Rand IS the gated total from the detectors.
    expect(body.estimatedExposure).toBe(body.findingsSummary.total_value_at_risk_zar);
  });

  it('thin/no data yields an honest insufficient_data state, NEVER a fabricated number', async () => {
    const id = await startTrial('10.0.0.2');
    // No upload at all — the old code fabricated R100k–R1M here.
    const run = await SELF.fetch(`http://localhost/api/trial/${id}/run`, { method: 'POST', headers: { 'cf-connecting-ip': '10.0.0.2' } });
    expect(run.status).toBe(200);
    expect(((await run.json()) as { insufficient_data: boolean }).insufficient_data).toBe(true);

    const res = await SELF.fetch(`http://localhost/api/trial/${id}/results`, { headers: { 'cf-connecting-ip': '10.0.0.2' } });
    const body = (await res.json()) as { estimatedExposure: number | null; insufficientData: boolean };
    expect(body.insufficientData).toBe(true);
    expect(body.estimatedExposure).toBeNull(); // no random Rand, no zero-dressed-as-real
  });

  it('rejects an unknown-column upload wholesale (422, nothing ingested)', async () => {
    const id = await startTrial('10.0.0.3');
    const up = await SELF.fetch(`http://localhost/api/trial/${id}/upload`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '10.0.0.3' },
      body: JSON.stringify({ domains: { invoices: { header: [...INVOICE_HEADER, 'evil'], rows: [{ ...overdueInvoiceRows(1)[0], evil: 'x' }] } } }),
    });
    expect(up.status).toBe(422);
    const cnt = await env.DB.prepare(`SELECT COUNT(*) c FROM erp_invoices WHERE dataset_id = ?`).bind(`ds_trial_${id}`).first<{ c: number }>();
    expect(cnt?.c).toBe(0);
  });
});
