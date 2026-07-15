import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar';
import { useAppStore } from '@/stores/appStore';

function renderAs(role: string) {
  useAppStore.setState({ user: { id: 'u1', name: 'T', email: 't@x.com', role } as never });
  render(<MemoryRouter><Sidebar /></MemoryRouter>);
}

describe('Sidebar journey nav', () => {
  beforeEach(() => useAppStore.setState({ user: null as never }));

  it('analyst sees the plain-language journey rail (no Fixes/Savings/Reports)', () => {
    renderAs('analyst');
    for (const label of ['Home', 'Data', 'Findings', 'Settings']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText('Savings')).toBeNull();
    expect(screen.queryByText('Reports')).toBeNull();
    expect(screen.queryByText('Fixes')).toBeNull();
    expect(screen.queryByText('Catalysts')).toBeNull(); // renamed
  });

  it('executive sees all six journey items labeled plainly', () => {
    renderAs('executive');
    for (const label of ['Home', 'Data', 'Findings', 'Savings', 'Reports']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('executive sees the v2 Brief; analyst does not', () => {
    renderAs('executive');
    expect(screen.getAllByText('Brief').length).toBeGreaterThan(0);
  });

  it('analyst does not see the Brief (exec-scoped)', () => {
    renderAs('analyst');
    expect(screen.queryByText('Brief')).toBeNull();
  });

  it('operator sees Fixes and Decisions (not Catalysts)', () => {
    renderAs('operator');
    expect(screen.getAllByText('Fixes').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Decisions').length).toBeGreaterThan(0);
    expect(screen.queryByText('Catalysts')).toBeNull();
  });

  it('executive sees the C-suite Outlook; analyst does not', () => {
    renderAs('executive');
    expect(screen.getAllByText('Outlook').length).toBeGreaterThan(0);
    useAppStore.setState({ user: null as never });
    renderAs('analyst');
    expect(screen.queryByText('Outlook')).toBeNull();
  });
});
