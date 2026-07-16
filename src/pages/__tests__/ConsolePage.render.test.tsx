import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Console is a mount-shell — its only logic is the role-aware grouped switcher.
// Stub every section page so we don't drag in ~20 real API paths; each renders a
// unique sentinel so we can assert which surface is mounted.
vi.mock('@/pages/TenantsPage', () => ({ TenantsPage: () => <div>CLIENTS</div> }));
vi.mock('@/pages/TenantManagementPage', () => ({ TenantManagementPage: () => <div>TENANT_ADMIN</div> }));
vi.mock('@/pages/RevenueUsagePage', () => ({ RevenueUsagePage: () => <div>REVENUE</div> }));
vi.mock('@/pages/IAMPage', () => ({ IAMPage: () => <div>IAM</div> }));
vi.mock('@/pages/CustomRoleBuilderPage', () => ({ CustomRoleBuilderPage: () => <div>CUSTOM_ROLES</div> }));
vi.mock('@/pages/BulkUserManagementPage', () => ({ BulkUserManagementPage: () => <div>BULK_USERS</div> }));
vi.mock('@/pages/ControlPlanePage', () => ({ ControlPlanePage: () => <div>CONTROL_PLANE</div> }));
vi.mock('@/pages/PlatformHealthPage', () => ({ PlatformHealthPage: () => <div>HEALTH</div> }));
vi.mock('@/pages/SystemAlertsPage', () => ({ SystemAlertsPage: () => <div>ALERTS</div> }));
vi.mock('@/pages/DeploymentsPage', () => ({ DeploymentsPage: () => <div>DEPLOYMENTS</div> }));
vi.mock('@/pages/AssessmentsPage', () => ({ AssessmentsPage: () => <div>ASSESSMENTS</div> }));
vi.mock('@/pages/FeatureFlagsPage', () => ({ FeatureFlagsPage: () => <div>FLAGS</div> }));
vi.mock('@/pages/IntegrationsPage', () => ({ IntegrationsPage: () => <div>INTEGRATIONS</div> }));
vi.mock('@/pages/WebhooksPage', () => ({ WebhooksPage: () => <div>WEBHOOKS</div> }));
vi.mock('@/pages/ActionLayerPage', () => ({ ActionLayerPage: () => <div>OPERATOR_QUEUE</div> }));
vi.mock('@/pages/SupportConsolePage', () => ({ SupportConsolePage: () => <div>SUPPORT_CONSOLE</div> }));
vi.mock('@/pages/admin/SupportTriagePage', () => ({ SupportTriagePage: () => <div>SUPPORT_TRIAGE</div> }));
vi.mock('@/pages/ImpersonationPage', () => ({ ImpersonationPage: () => <div>IMPERSONATE</div> }));
vi.mock('@/pages/admin/StatusIncidentsAdminPage', () => ({ default: () => <div>INCIDENTS</div> }));
vi.mock('@/pages/CompliancePage', () => ({ default: () => <div>COMPLIANCE</div> }));

let role: string | undefined;
vi.mock('@/stores/appStore', () => ({
  useAppStore: (sel: (s: { user?: { role?: string } }) => unknown) => sel({ user: role ? { role } : undefined }),
}));

import { ConsolePage } from '@/pages/ConsolePage';

const renderAt = (path = '/console') =>
  render(<MemoryRouter initialEntries={[path]}><ConsolePage /></MemoryRouter>);

describe('ConsolePage — role-aware admin quarantine shell', () => {
  beforeEach(() => { role = undefined; });

  it('admin sees admin-floor sections but not super/support-only ones', () => {
    role = 'admin';
    renderAt();
    // admin-floor sections present
    expect(screen.getByRole('button', { name: /IAM/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Integrations/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Compliance/i })).toBeTruthy();
    // super-floor hidden
    expect(screen.queryByRole('button', { name: /Clients/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Feature flags/i })).toBeNull();
    // support-floor hidden
    expect(screen.queryByRole('button', { name: /Support console/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Impersonate/i })).toBeNull();
  });

  it('support_admin adds support sections on top of admin', () => {
    role = 'support_admin';
    renderAt();
    expect(screen.getByRole('button', { name: /IAM/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Support console/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Impersonate/i })).toBeTruthy();
    // still no super-only
    expect(screen.queryByRole('button', { name: /Clients/i })).toBeNull();
  });

  it('superadmin sees every group including Tenancy', () => {
    role = 'superadmin';
    renderAt();
    expect(screen.getByRole('button', { name: /Clients/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Feature flags/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Support console/i })).toBeTruthy();
  });

  it('deep-links to a section via ?section= and mounts that surface', async () => {
    role = 'admin';
    renderAt('/console?section=webhooks');
    expect(await screen.findByText('WEBHOOKS')).toBeTruthy();
  });

  it('switching sections swaps the mounted panel', async () => {
    role = 'admin';
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: /Integrations/i }));
    expect(await screen.findByText('INTEGRATIONS')).toBeTruthy();
  });
});
