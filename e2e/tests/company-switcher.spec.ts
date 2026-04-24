/**
 * E2E: Company switcher in the header.
 *
 * The switcher is hidden for single-company tenants and renders a dropdown
 * for multi-company ones. Selections persist in localStorage under
 * `atheon_selected_company_id`.
 */
import { test, expect } from '@playwright/test';
import { seedAuth } from '../fixtures/auth';
import { installBaselineMocks, mockMultiCompany } from '../fixtures/mocks';

// The header switcher is wrapped in `hidden sm:block` (Tailwind) so it
// only renders at >=640px viewport widths. Mobile projects (e.g. Pixel 5
// at 393px) legitimately don't expose the button.
test.describe('Company switcher', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 640, 'switcher is hidden on <sm viewports by design');

  test('is hidden on single-company tenants', async ({ page }) => {
    await page.goto('/login');
    await installBaselineMocks(page);
    await seedAuth(page);
    await page.goto('/settings');
    await page.waitForTimeout(600);

    // No "All Companies" label should be visible — switcher is not rendered
    await expect(page.getByText(/^all companies$/i)).toHaveCount(0);
  });

  test('renders, selects a company, persists to localStorage, and switches back', async ({ page }) => {
    await page.goto('/login');
    await installBaselineMocks(page);
    await mockMultiCompany(page, 2);
    await seedAuth(page);
    await page.goto('/settings');

    // Wait for the header switcher to mount
    const trigger = page.getByRole('button', { name: /all companies|consolidated/i });
    await expect(trigger).toBeVisible({ timeout: 10_000 });

    // Open the dropdown
    await trigger.click();
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();

    // Pick "Company A" — the first non-"All Companies" option
    await page.getByRole('option', { name: /Company A/i }).click();

    // Trigger label should now say "Company A"
    await expect(page.getByRole('button', { name: /Company A/i })).toBeVisible();

    // Persisted to localStorage
    const persisted = await page.evaluate(() => localStorage.getItem('atheon_selected_company_id'));
    expect(persisted).toBe('co-1');

    // Switch back to "All Companies"
    await page.getByRole('button', { name: /Company A/i }).click();
    await page.getByRole('option', { name: /all companies/i }).click();
    await expect(page.getByRole('button', { name: /all companies/i })).toBeVisible();

    const cleared = await page.evaluate(() => localStorage.getItem('atheon_selected_company_id'));
    expect(cleared).toBeNull();
  });

  test('persists across reloads', async ({ page }) => {
    await page.goto('/login');
    await installBaselineMocks(page);
    await mockMultiCompany(page, 2);
    await seedAuth(page);

    // Pre-seed the localStorage value; it should survive a page reload
    await page.evaluate(() => localStorage.setItem('atheon_selected_company_id', 'co-2'));

    await page.goto('/settings');
    await expect(page.getByRole('button', { name: /Company B/i })).toBeVisible({ timeout: 10_000 });
  });
});
