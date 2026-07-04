import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Bypass real CSV parsing (papaparse/FileReader) — we drive the funnel, not the parser.
vi.mock('@/lib/ingest-client', () => ({
  parseCsv: vi.fn().mockResolvedValue({ header: ['invoice_number', 'total'], rows: [{ invoice_number: 'INV-1', total: '100' }] }),
  downloadTemplate: vi.fn(),
  INGEST_DOMAINS: [{ domain: 'invoices', label: 'Sales Invoices (AR)' }],
}));
vi.mock('@/stores/appStore', () => ({ useTenantCurrency: () => 'ZAR' }));

const results = vi.hoisted(() => ({
  start: vi.fn().mockResolvedValue({ id: 't1' }),
  upload: vi.fn().mockResolvedValue({ row_counts: { invoices: 1 } }),
  run: vi.fn().mockResolvedValue({ status: 'complete' }),
  status: vi.fn().mockResolvedValue({ status: 'complete' }),
  results: vi.fn(),
}));
vi.mock('@/lib/api', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/api')>();
  return { ...orig, api: { ...orig.api, trial: results } };
});

import { TrialPage } from '@/pages/TrialPage';

async function driveToResults() {
  render(<TrialPage />);
  fireEvent.change(screen.getByPlaceholderText('Acme Corporation'), { target: { value: 'Acme' } });
  fireEvent.change(screen.getByPlaceholderText('John Smith'), { target: { value: 'Jo' } });
  fireEvent.change(screen.getByPlaceholderText('john@acme.co.za'), { target: { value: 'jo@acme.co.za' } });
  fireEvent.click(screen.getByText('Start Free Assessment'));
  await screen.findByText('Upload Your Data');
  const fileInput = document.querySelector('input[type=file]') as HTMLInputElement;
  fireEvent.change(fileInput, { target: { files: [new File(['x'], 'd.csv', { type: 'text/csv' })] } });
  fireEvent.click(screen.getByText('Run Assessment'));
}

describe('TrialPage — honest funnel states', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the real detected exposure (no fabricated number)', async () => {
    results.results.mockResolvedValue({
      id: 't1', companyName: 'Acme', industry: 'manufacturing', status: 'complete',
      estimatedExposure: 4_820_000, issuesFound: 11, insufficientData: false,
      topRisks: [{ title: 'Finance', description: '3 findings', impact: 1_200_000 }],
      findings: [{ title: 'AR aged >120d', value_at_risk_zar: 900_000, confidence: 0.91, confidence_gate_passed: true, severity: 'high', affected_count: 42 }],
      findingsSummary: { total_count: 11, total_value_at_risk_zar: 4_820_000 }, completedAt: null,
    });
    await driveToResults();
    const hero = await screen.findByTestId('exposure-hero', {}, { timeout: 4000 });
    expect(hero.textContent).toMatch(/4[.,\s]?820/);
    expect(screen.queryByTestId('insufficient-data')).not.toBeInTheDocument();
    expect(screen.getByText('AR aged >120d')).toBeInTheDocument();
  });

  it('renders the honest insufficient_data state with no number', async () => {
    results.results.mockResolvedValue({
      id: 't1', companyName: 'Acme', industry: 'manufacturing', status: 'complete',
      estimatedExposure: null, issuesFound: 0, insufficientData: true,
      topRisks: [], findings: [], findingsSummary: {}, completedAt: null,
    });
    await driveToResults();
    expect(await screen.findByTestId('insufficient-data', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByTestId('exposure-hero')).not.toBeInTheDocument();
    expect(screen.getByText(/couldn't confirm exposure/i)).toBeInTheDocument();
  });
});
