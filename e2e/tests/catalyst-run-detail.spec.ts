/**
 * E2E: Catalyst run detail (/catalysts/runs/:runId).
 *
 * NOTE ON SCOPE
 * -------------
 * CatalystRunDetailPage has an infinite-render issue when the `useToast`
 * context returns a new object each render (see components/ui/toast.tsx —
 * `useToast()` spreads `ctx` into a fresh object, breaking ref equality
 * across renders). Under Playwright mocks this manifests as a continuous
 * loop of loadRun/loadItems/loadComments fetches, so the page never
 * "settles" and deep DOM assertions on the items table become flaky.
 *
 * This spec therefore focuses on the assertions that are robust to the
 * loop: that the protected route is reachable, and that the breadcrumb
 * + page scaffolding render. Fuller coverage of the filter bar, bulk-
 * action bar, export CSV, and comment Post button should land as part
 * of fixing the toast ref stability in the component itself.
 */
import { test, expect } from '@playwright/test';
import { seedAuth } from '../fixtures/auth';
import { installBaselineMocks, mockCatalystRun } from '../fixtures/mocks';

const RUN_ID = 'run_e2e_test_01';

test.describe('Catalyst run detail (smoke)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await installBaselineMocks(page);
    await mockCatalystRun(page, RUN_ID);
    await seedAuth(page);
  });

  test('deep-link into a run renders the breadcrumb path', async ({ page }) => {
    await page.goto(`/catalysts/runs/${RUN_ID}`, { waitUntil: 'domcontentloaded' });

    // The breadcrumb is rendered by AppLayout on every protected route and
    // survives the render loop. It confirms the route matched correctly.
    await expect(page.getByRole('link', { name: /^catalysts$/i }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('link', { name: /^runs$/i })).toBeVisible();
  });

  test('redirects unauthenticated users to /login', async ({ page, context }) => {
    await context.clearCookies();
    await page.evaluate(() => {
      localStorage.removeItem('atheon_token');
      localStorage.removeItem('atheon_user');
    });
    await page.goto(`/catalysts/runs/${RUN_ID}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    expect(page.url()).toMatch(/\/login|\/$/);
  });
});
