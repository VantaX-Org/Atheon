import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ValueChainFlow fetches journey inputs itself; stub it so page tests stay hermetic.
vi.mock('@/components/journey/ValueChainFlow', () => ({ ValueChainFlow: () => null }));
vi.mock('@/lib/use-latest-findings', () => ({ useLatestFindings: () => [] }));
vi.mock('@/lib/api', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...orig,
    api: {
      ...orig.api,
      assessments: {
        ...orig.api.assessments,
        list: vi.fn().mockResolvedValue({ assessments: [{ id: 'a1', status: 'complete', createdAt: '2026-07-01' }] }),
        get: vi.fn().mockResolvedValue({
          id: 'a1', status: 'complete',
          results: { findings_summary: {
            total_count: 12, total_value_at_risk_zar: 4200000,
            potential_unverified_zar: 999000, unverified_count: 3,
            by_severity: {}, by_category: {}, recommended_catalysts: [],
          } },
        }),
      },
    },
  };
});

import FindingsPage from '@/pages/FindingsPage';

describe('FindingsPage', () => {
  it('headline shows confidence-gated exposure only', async () => {
    render(<MemoryRouter><FindingsPage /></MemoryRouter>);
    const headline = await screen.findByTestId('exposure-headline');
    expect(headline.textContent).toMatch(/4[.,]2/); // R4.2M confirmed
    expect(headline.textContent).not.toMatch(/999/); // unverified never in headline
  });

  it('names the unverified remainder separately', async () => {
    render(<MemoryRouter><FindingsPage /></MemoryRouter>);
    expect(await screen.findByText(/need review before we count them/i)).toBeInTheDocument();
  });

  it('shows an honest error state when the assessments list rejects', async () => {
    const { api } = await import('@/lib/api');
    vi.mocked(api.assessments.list).mockRejectedValueOnce(new Error('outage'));
    render(<MemoryRouter><FindingsPage /></MemoryRouter>);
    expect(await screen.findByText(/couldn't load findings/i)).toBeInTheDocument();
    expect(screen.queryByText(/no completed analysis yet/i)).not.toBeInTheDocument();
  });
});
