/**
 * Shared auth helpers for the new golden-path spec files.
 *
 * The existing tests in auth.spec.ts / pages.spec.ts set up a mock JWT token
 * directly in localStorage so the React app skips the real login flow. We
 * follow the same pattern here and consolidate it so new specs don't duplicate
 * the same stanza.
 *
 * Most specs in this directory *mock* the backend at the network layer using
 * `page.route()` (see ./mocks.ts) — this keeps E2E deterministic and runnable
 * without a live backend. Tests that want to exercise the real backend can
 * supply `E2E_EMAIL` / `E2E_PASSWORD` and skip the mock seed.
 */
import type { Page } from '@playwright/test';

export interface MockUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
  tenantName?: string;
  tenantSlug?: string;
  permissions: string[];
}

export const DEFAULT_SUPERADMIN: MockUser = {
  id: 'e2e-superadmin',
  email: 'admin@vantax.co.za',
  name: 'E2E Superadmin',
  role: 'superadmin',
  tenantId: 'vantax',
  tenantName: 'Vantax',
  tenantSlug: 'vantax',
  permissions: ['*'],
};

export const DEFAULT_ADMIN: MockUser = {
  id: 'e2e-admin',
  email: 'admin@example.com',
  name: 'E2E Admin',
  role: 'admin',
  tenantId: 'acme',
  tenantName: 'Acme',
  tenantSlug: 'acme',
  permissions: ['*'],
};

/**
 * Seed localStorage with a mock token + user so the SPA renders protected
 * pages without needing an actual login round-trip.
 *
 * Must be called AFTER the first navigation so localStorage is available for
 * the correct origin (playwright issues a blank-origin localStorage write if
 * you call this before any goto()).
 */
export async function seedAuth(page: Page, user: MockUser = DEFAULT_SUPERADMIN): Promise<void> {
  // Hit any URL on the app origin first so localStorage is scoped correctly.
  if (!page.url().startsWith('http')) {
    await page.goto('/login');
  }
  await page.evaluate((u) => {
    localStorage.setItem('atheon_token', 'e2e-mock-jwt');
    localStorage.setItem('atheon_user', JSON.stringify(u));
  }, user as unknown as Record<string, unknown>);
}

/**
 * Clear auth before a test (useful for logout / unauthenticated scenarios).
 */
export async function clearAuth(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.removeItem('atheon_token');
    localStorage.removeItem('atheon_user');
    localStorage.removeItem('atheon_selected_company_id');
    localStorage.removeItem('atheon-mfa-warning');
    localStorage.removeItem('atheon-active-tenant-id');
    localStorage.removeItem('atheon-active-tenant-name');
    localStorage.removeItem('atheon-active-tenant-industry');
  });
}
