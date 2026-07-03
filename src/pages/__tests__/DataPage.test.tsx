import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/lib/api', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...orig,
    api: {
      ...orig.api,
      erp: {
        ...orig.api.erp,
        connections: vi.fn().mockResolvedValue({
          total: 2,
          connections: [
            { id: 'c1', adapterId: 'sap', adapterName: 'SAP S/4HANA', adapterSystem: 'sap', adapterProtocol: 'odata', name: 'Production SAP', status: 'active', config: {}, lastSync: '2026-07-02T10:00:00Z', syncFrequency: 'daily', recordsSynced: 120000, connectedAt: '2026-01-01' },
            { id: 'c2', adapterId: 'wd', adapterName: 'Workday', adapterSystem: 'workday', adapterProtocol: 'rest', name: 'HR Workday', status: 'error', config: {}, lastSync: null, syncFrequency: 'daily', recordsSynced: 0, connectedAt: '2026-02-01' },
          ],
        }),
      },
      assessments: { ...orig.api.assessments, list: vi.fn().mockResolvedValue({ assessments: [] }) },
    },
  };
});

import DataPage from '@/pages/DataPage';

describe('DataPage', () => {
  it('lists connected sources with sync freshness', async () => {
    render(<MemoryRouter><DataPage /></MemoryRouter>);
    expect(await screen.findByText('Production SAP')).toBeInTheDocument();
    expect(screen.getByText('HR Workday')).toBeInTheDocument();
    expect(screen.getByText(/SAP S\/4HANA/)).toBeInTheDocument();
  });

  it('shows an empty-state CTA when nothing is connected', async () => {
    const { api } = await import('@/lib/api');
    vi.mocked(api.erp.connections).mockResolvedValueOnce({ total: 0, connections: [] });
    render(<MemoryRouter><DataPage /></MemoryRouter>);
    expect(await screen.findByText(/connect your data/i)).toBeInTheDocument();
  });

  it('renders sync time unknown for malformed lastSync dates and does not crash', async () => {
    const { api } = await import('@/lib/api');
    vi.mocked(api.erp.connections).mockResolvedValueOnce({
      total: 1,
      connections: [
        { id: 'c1', adapterId: 'sap', adapterName: 'SAP S/4HANA', adapterSystem: 'sap', adapterProtocol: 'odata', name: 'Bad Date Source', status: 'active', config: {}, lastSync: 'not-a-date', syncFrequency: 'daily', recordsSynced: 100, connectedAt: '2026-01-01' },
      ],
    });
    render(<MemoryRouter><DataPage /></MemoryRouter>);
    expect(await screen.findByText('Bad Date Source')).toBeInTheDocument();
    expect(screen.getByText('sync time unknown')).toBeInTheDocument();
  });
});
