import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAppStore } from '@/stores/appStore';

// Mock the api boundary — no network, no creds. Prove the DoA queue acts on
// the REAL api result: a row leaves only after the call confirms; a failed
// call surfaces and leaves the row.
const pending = vi.fn();
const approve = vi.fn();
const reject = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { catalysts: { pendingApprovals: () => pending(), approveAction: (id: string) => approve(id), rejectAction: (id: string, by?: string, reason?: string) => reject(id, by, reason) } },
  ApiError: class ApiError extends Error {},
}));

import { DecisionsPage } from '@/pages/DecisionsPage';

function renderPage() {
  useAppStore.setState({ user: { id: 'u1', name: 'T', email: 't@x', role: 'operator', tenantName: 'Acme' } as never });
  render(<MemoryRouter><DecisionsPage /></MemoryRouter>);
}

const ROW = { id: 'a1', clusterName: 'AR', domain: 'finance', catalystName: 'Chase invoice', action: 'chase', confidence: 0.9, reasoning: 'Invoice 30d overdue', inputData: { amountZar: 50000 }, createdAt: '' };

describe('DecisionsPage — honest DoA queue', () => {
  beforeEach(() => { pending.mockReset(); approve.mockReset(); reject.mockReset(); });

  it('renders a waiting decision from the real queue', async () => {
    pending.mockResolvedValue({ approvals: [ROW], total: 1 });
    renderPage();
    await waitFor(() => expect(screen.getByText(/Invoice 30d overdue/)).toBeTruthy());
    expect(screen.getByText(/Invoice 30d overdue/)).toBeTruthy();
  });

  it('removes the row only after approve confirms', async () => {
    pending.mockResolvedValue({ approvals: [ROW], total: 1 });
    approve.mockResolvedValue({});
    renderPage();
    await waitFor(() => expect(screen.getByText(/Invoice 30d overdue/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Approve/i }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith('a1'));
    await waitFor(() => expect(screen.queryByText(/Invoice 30d overdue/)).toBeNull());
  });

  it('keeps the row and shows the error when approve fails', async () => {
    pending.mockResolvedValue({ approvals: [ROW], total: 1 });
    approve.mockRejectedValue(new Error('boom'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Invoice 30d overdue/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Approve/i }));
    await waitFor(() => expect(screen.getByText(/Could not approve/i)).toBeTruthy());
    expect(screen.getByText(/Invoice 30d overdue/)).toBeTruthy(); // row stays
  });

  it('will not reject without a stated reason', async () => {
    pending.mockResolvedValue({ approvals: [ROW], total: 1 });
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(''); // user gives no reason
    renderPage();
    await waitFor(() => expect(screen.getByText(/Invoice 30d overdue/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Reject/i }));
    expect(reject).not.toHaveBeenCalled();
    expect(screen.getByText(/Invoice 30d overdue/)).toBeTruthy();
    promptSpy.mockRestore();
  });

  it('states the queue could not load rather than faking an empty one', async () => {
    pending.mockRejectedValue(new Error('500'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/couldn't be loaded/i)).toBeTruthy());
  });
});
