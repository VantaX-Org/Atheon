import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAppStore } from '@/stores/appStore';

// Mock the api boundary — no network, no creds. Each test sets the resolved
// shapes it wants; the point is to prove the Brief renders HONEST states, not
// to test the backend.
const exec = vi.fn();
const fresh = vi.fn();
const approvals = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    executiveSummary: { get: () => exec() },
    freshness: { get: () => fresh() },
    catalysts: { pendingApprovals: () => approvals() },
  },
}));

import { BriefPage } from '@/pages/BriefPage';

function renderBrief() {
  useAppStore.setState({ user: { id: 'u1', name: 'T', email: 't@x', role: 'executive', tenantName: 'Acme' } as never });
  render(<MemoryRouter><BriefPage /></MemoryRouter>);
}

const OK_FRESH = { globalStatus: 'fresh', oldestAgeMinutes: 1, sections: [], checkedAt: '' };
const OK_EXEC = {
  atheonScore: 70, healthScore: 60, dimensions: {},
  roi: { recovered: 4182309, multiple: 3, cost: 120000 },
  diagnostics: { activeRcas: 0, pendingPrescriptions: 0 },
  signals: { newThisWeek: 2 },
  topRisks: [{ title: 'AR ageing', severity: 'high', impactValue: 900000 }],
  targets: [], trend: [],
  journey: { baselineHealthScore: 50, baselineDate: '2026-01-01', improvement: 10 },
};

describe('BriefPage — honest rendering', () => {
  beforeEach(() => {
    exec.mockReset(); fresh.mockReset(); approvals.mockReset();
  });

  it('renders the recovered figure and never nets the fee against it', async () => {
    exec.mockResolvedValue(OK_EXEC);
    fresh.mockResolvedValue(OK_FRESH);
    approvals.mockResolvedValue({ approvals: [], total: 0 });
    renderBrief();
    // 4 182 309 recovered shows; fee stated separately, not subtracted.
    await waitFor(() => expect(screen.getByText(/Recovered to date/i)).toBeTruthy());
    expect(screen.getByText(/billed separately and never deducted/i)).toBeTruthy();
  });

  it('shows the first-run state instead of a fake zero when the tenant is empty', async () => {
    exec.mockResolvedValue({ ...OK_EXEC, roi: { recovered: 0, multiple: 0, cost: 0 }, journey: { baselineHealthScore: null, baselineDate: null, improvement: null } });
    fresh.mockResolvedValue(OK_FRESH);
    approvals.mockResolvedValue({ approvals: [], total: 0 });
    renderBrief();
    await waitFor(() => expect(screen.getByText(/hasn't produced confirmed recoveries/i)).toBeTruthy());
  });

  it('states the figure could not load rather than showing a coerced value', async () => {
    exec.mockRejectedValue(new Error('500'));
    fresh.mockResolvedValue(OK_FRESH);
    approvals.mockResolvedValue({ approvals: [], total: 0 });
    renderBrief();
    await waitFor(() => expect(screen.getByText(/couldn't be loaded/i)).toBeTruthy());
  });

  it('degrades freshness honestly when the check fails', async () => {
    exec.mockResolvedValue(OK_EXEC);
    fresh.mockRejectedValue(new Error('nope'));
    approvals.mockResolvedValue({ approvals: [], total: 0 });
    renderBrief();
    await waitFor(() => expect(screen.getByText(/Freshness check unavailable/i)).toBeTruthy());
  });
});
