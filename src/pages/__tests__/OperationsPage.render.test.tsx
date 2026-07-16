import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Stub the three consolidated surfaces — Operations is a shell; its only logic
// is the role-aware section switcher, so we don't drag in the children's API paths.
// ValueChainFlow fetches journey inputs itself; stub it so page tests stay hermetic.
vi.mock('@/components/journey/ValueChainFlow', () => ({ ValueChainFlow: () => null }));
vi.mock('@/pages/DataPage', () => ({ default: () => <div>OVERVIEW_PANEL</div> }));
vi.mock('@/pages/ConnectivityPage', () => ({ ConnectivityPage: () => <div>CONNECTIONS_PANEL</div> }));
vi.mock('@/pages/IntegrationHealthPage', () => ({ IntegrationHealthPage: () => <div>HEALTH_PANEL</div> }));

let role: string | undefined;
vi.mock('@/stores/appStore', () => ({
  useAppStore: (sel: (s: { user?: { role?: string } }) => unknown) => sel({ user: role ? { role } : undefined }),
}));

import { OperationsPage } from '@/pages/OperationsPage';

describe('OperationsPage — role-aware sources shell', () => {
  beforeEach(() => { role = undefined; });

  it('non-privileged role sees only the Overview, no admin/manager tabs', () => {
    role = 'analyst';
    render(<OperationsPage />);
    expect(screen.getByText('OVERVIEW_PANEL')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: /Connections/i })).toBeNull();
    expect(screen.queryByRole('tab', { name: /Integration health/i })).toBeNull();
  });

  it('manager sees Overview + Integration health, but not admin Connections', () => {
    role = 'manager';
    render(<OperationsPage />);
    expect(screen.getByRole('tab', { name: /Integration health/i })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: /Connections/i })).toBeNull();
  });

  it('admin sees all three and can switch to Connections', () => {
    role = 'admin';
    render(<OperationsPage />);
    expect(screen.getByText('OVERVIEW_PANEL')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Connections/i }));
    expect(screen.getByText('CONNECTIONS_PANEL')).toBeTruthy();
    expect(screen.queryByText('OVERVIEW_PANEL')).toBeNull();
  });
});
