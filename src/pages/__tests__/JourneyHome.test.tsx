import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAppStore } from '@/stores/appStore';

vi.mock('@/lib/api', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...orig,
    api: {
      ...orig.api,
      erp: {
        ...orig.api.erp,
        connections: vi.fn().mockResolvedValue({ connections: [{ id: 'c1', status: 'active' }], total: 1 }),
        actionsSummary: vi.fn().mockResolvedValue({ tenantId: 't1', summary: { pending_approval_count: 2, pending_approval_value_zar: 500000, completed_count: 0, completed_value_zar: 0, rejected_count: 0, rejected_value_zar: 0, failed_count: 0, failed_value_zar: 0, previewed_count: 0, previewed_value_zar: 0, total_count: 2, total_value_zar: 500000 } }),
        listAllActions: vi.fn().mockResolvedValue({ tenantId: 't1', total: 0, actions: [] }),
      },
      assessments: {
        ...orig.api.assessments,
        list: vi.fn().mockResolvedValue({ assessments: [{ id: 'a1', status: 'complete', createdAt: '2026-07-01' }] }),
        get: vi.fn().mockResolvedValue({ id: 'a1', status: 'complete', results: { findings_summary: { total_count: 12, total_value_at_risk_zar: 4200000, by_severity: {}, by_category: {}, recommended_catalysts: [] } } }),
      },
      roi: {
        ...orig.api.roi,
        get: vi.fn().mockResolvedValue({ totalDiscrepancyValueRecovered: 160000000, roiMultiple: 12.4, breakdown: { byCluster: [] } }),
      },
    },
  };
});

import { JourneyHome } from '@/pages/JourneyHome';
import { api } from '@/lib/api';

describe('JourneyHome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ user: { id: 'u1', name: 'Test User', email: 't@x.com', role: 'admin' } as never });
  });

  it('renders the five-stage spine', async () => {
    render(<MemoryRouter><JourneyHome /></MemoryRouter>);
    expect(await screen.findByText('Data')).toBeInTheDocument();
    expect(screen.getByText('Findings')).toBeInTheDocument();
    expect(screen.getByText('Fixes')).toBeInTheDocument();
    expect(screen.getByText('Savings')).toBeInTheDocument();
    expect(screen.getByText('Reports')).toBeInTheDocument();
  });

  it('shows the needs-you-now hero when approvals are pending', async () => {
    render(<MemoryRouter><JourneyHome /></MemoryRouter>);
    expect(await screen.findByText(/awaiting your approval/i)).toBeInTheDocument();
  });

  it('renders em-dash for exposure when assessments are running', async () => {
    vi.mocked(api.assessments.list).mockResolvedValueOnce({ assessments: [{ id: 'a2', status: 'running', createdAt: '2026-07-02' }] });
    render(<MemoryRouter><JourneyHome /></MemoryRouter>);
    // Scope to the Detect stage card: its headline must be an em-dash while the
    // assessment is still running (the Reports card always renders '—', so an
    // unscoped query would pass vacuously).
    const detectCard = (await screen.findByText('Findings')).closest('li');
    expect(detectCard).not.toBeNull();
    expect(within(detectCard as HTMLElement).getByText('—')).toBeInTheDocument();
  });
});
