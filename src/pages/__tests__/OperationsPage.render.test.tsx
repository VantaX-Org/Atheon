import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Stub the two consolidated source surfaces — Operations is a shell; its only
// logic is the section switcher, so we don't drag in the children's API paths.
vi.mock('@/pages/ConnectivityPage', () => ({ ConnectivityPage: () => <div>CONNECTIONS_PANEL</div> }));
vi.mock('@/pages/IntegrationHealthPage', () => ({ IntegrationHealthPage: () => <div>HEALTH_PANEL</div> }));

import { OperationsPage } from '@/pages/OperationsPage';

describe('OperationsPage', () => {
  it('lands on connections, and switches to integration health on demand', () => {
    render(<OperationsPage />);
    expect(screen.getByText('CONNECTIONS_PANEL')).toBeTruthy();
    expect(screen.queryByText('HEALTH_PANEL')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /Integration health/i }));
    expect(screen.getByText('HEALTH_PANEL')).toBeTruthy();
    expect(screen.queryByText('CONNECTIONS_PANEL')).toBeNull();
  });
});
