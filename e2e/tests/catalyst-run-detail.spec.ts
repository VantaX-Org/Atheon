/**
 * E2E: Catalyst run detail (/catalysts/runs/:runId).
 *
 * Historically this page had an infinite-render issue when the `useToast`
 * context returned a new object each render (its helper methods were
 * re-bound every call, so any `useCallback` that listed `toast` as a
 * dependency was invalidated on every render). The page's boot-time
 * `useEffect` depended on those callbacks, so it re-fired every render
 * and triggered a storm of run/items/comments fetches.
 *
 * That regression is fixed by stabilising the toast ref in
 * CatalystRunDetailPage (see src/pages/CatalystRunDetailPage.tsx). The
 * "bounded network calls" test below would flag any future regression by
 * counting requests to /api/catalysts/runs/:id/detail and asserting the
 * count stays under a small bound during a steady state.
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

    // The breadcrumb is rendered by AppLayout on every protected route.
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

/**
 * Regression coverage for the re-render loop. Deterministic: we mount the
 * page with a long-lived run mock that fulfils every call successfully, and
 * assert that the count of /detail + /items + /comments requests stays tiny
 * across a 2 second settle window. If the effect ever re-latches onto a
 * changing dep (toast, a new object literal, a fresh callback, etc.), the
 * render loop re-appears and the request counts explode well past the bound.
 */
test.describe('Catalyst run detail — re-render loop regression', () => {
  test('GET /detail, /items and /comments are called a bounded number of times', async ({ page }) => {
    const counts = { detail: 0, items: 0, comments: 0 };

    await page.goto('/login');
    await installBaselineMocks(page);
    await seedAuth(page);

    // Count-and-fulfill handlers — unlike the default `mockCatalystRun`, we
    // do NOT abort subsequent requests. A re-render loop would therefore
    // show up as unbounded growth in these counters instead of silent
    // network aborts that keep the UI "stuck" but undetectable.
    const detailPayload = {
      id: RUN_ID,
      subCatalystName: 'Invoice Matching',
      clusterName: 'Finance',
      clusterDomain: 'finance',
      status: 'success',
      matched: 1240,
      discrepancies: 42,
      exceptions: 7,
      totalValue: 4_800_000,
      startedAt: new Date(Date.now() - 3_600_000).toISOString(),
      completedAt: new Date().toISOString(),
      kpis: [],
      metrics: [],
      sourceData: [],
    };
    const itemsPayload = {
      items: [],
      total: 0,
      review_progress: { approved: 0, rejected: 0, deferred: 0, pending: 0 },
    };

    await page.route(`**/api/catalysts/runs/${RUN_ID}/detail`, (route) => {
      counts.detail += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detailPayload),
      });
    });
    await page.route(`**/api/catalysts/runs/${RUN_ID}/items**`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      counts.items += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(itemsPayload),
      });
    });
    await page.route(`**/api/catalysts/runs/${RUN_ID}/comments`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      counts.comments += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ comments: [] }),
      });
    });

    await page.goto(`/catalysts/runs/${RUN_ID}`, { waitUntil: 'domcontentloaded' });

    // Settle window: idle the page for a bit and assert we haven't blown
    // past a small bound. The page does NOT poll this endpoint on a timer,
    // so the expected steady-state count is exactly 1 for each endpoint;
    // we allow a small epsilon (e.g. StrictMode double-mount, retry hooks)
    // but anything above this is a certain regression.
    //
    // Bound: (polling interval × expected duration) + small epsilon. With
    // no polling (interval = ∞), the bound reduces to "a handful".
    await page.waitForTimeout(2000);

    const BOUND = 5;
    expect(
      counts.detail,
      `GET /detail was hit ${counts.detail} times in 2s — expected ≤ ${BOUND}. A render loop is the most likely cause (see CatalystRunDetailPage useToast ref-stability fix).`,
    ).toBeLessThanOrEqual(BOUND);
    expect(
      counts.items,
      `GET /items was hit ${counts.items} times in 2s — expected ≤ ${BOUND}. A render loop is the most likely cause.`,
    ).toBeLessThanOrEqual(BOUND);
    expect(
      counts.comments,
      `GET /comments was hit ${counts.comments} times in 2s — expected ≤ ${BOUND}. A render loop is the most likely cause.`,
    ).toBeLessThanOrEqual(BOUND);

    // And sanity: we DID actually hit each endpoint at least once.
    expect(counts.detail).toBeGreaterThanOrEqual(1);
    expect(counts.items).toBeGreaterThanOrEqual(1);
    expect(counts.comments).toBeGreaterThanOrEqual(1);

    // After the settle window, the page should have landed on a stable
    // render (the page header is visible and no longer flipping). If a
    // render loop is in progress, the "Loading run details..." spinner
    // keeps re-mounting and the heading never settles.
    await expect(page.getByRole('heading', { name: /catalyst run/i })).toBeVisible({ timeout: 5_000 });
  });
});
