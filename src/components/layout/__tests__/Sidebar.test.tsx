import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar';
import { useAppStore } from '@/stores/appStore';

function renderAs(role: string) {
  useAppStore.setState({ user: { id: 'u1', name: 'T', email: 't@x.com', role } as never });
  render(<MemoryRouter><Sidebar /></MemoryRouter>);
}

// Single frontend (2026-07): journey pages live in /x; the rail is Console +
// Workspace + Admin + Settings. Labels render twice (desktop + mobile drawer).
describe('Sidebar single-frontend rail', () => {
  beforeEach(() => useAppStore.setState({ user: null as never }));

  it('analyst sees Console + Settings only — no journey rail, no admin', () => {
    renderAs('analyst');
    expect(screen.getAllByText('Console').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Settings').length).toBeGreaterThan(0);
    for (const gone of ['Data', 'Findings', 'Fixes', 'Brief', 'Outlook', 'Admin', 'Workspace']) {
      expect(screen.queryByText(gone)).toBeNull();
    }
  });

  it('executive sees Console + Workspace (Board Digest, Memory) but not Mind/Admin', () => {
    renderAs('executive');
    expect(screen.getAllByText('Console').length).toBeGreaterThan(0);
    // Workspace disclosure is collapsed by default — open it to see children.
    screen.getAllByText('Workspace').forEach((el) => fireEvent.click(el));
    expect(screen.getAllByText('Board Digest').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Memory').length).toBeGreaterThan(0);
    expect(screen.queryByText('Mind')).toBeNull();
    expect(screen.queryByText('Admin')).toBeNull();
  });

  it('admin sees the Admin row and Mind', () => {
    renderAs('admin');
    expect(screen.getAllByText('Admin').length).toBeGreaterThan(0);
    screen.getAllByText('Workspace').forEach((el) => fireEvent.click(el));
    expect(screen.getAllByText('Mind').length).toBeGreaterThan(0);
  });

  it('auditor gets the scoped rail: Assurance + Support, no Console/Admin', () => {
    renderAs('auditor');
    expect(screen.getAllByText('Assurance').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Support').length).toBeGreaterThan(0);
    expect(screen.queryByText('Console')).toBeNull();
    expect(screen.queryByText('Admin')).toBeNull();
  });

  it('board_member gets the scoped rail: Reports + Support, no Console', () => {
    renderAs('board_member');
    expect(screen.getAllByText('Reports').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Support').length).toBeGreaterThan(0);
    expect(screen.queryByText('Console')).toBeNull();
  });
});
