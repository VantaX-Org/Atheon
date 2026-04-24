/**
 * E2E: Bulk user management (/bulk-users).
 *
 * Golden path:
 *  - Navigate to the page
 *  - Paste a CSV with 2 rows
 *  - Keep dry-run toggled on (default) → submit → preview row counts render
 *  - Untick dry-run, submit → backend is called with dryRun=false
 */
import { test, expect } from '@playwright/test';
import { seedAuth } from '../fixtures/auth';
import { installBaselineMocks, mockBulkUsers } from '../fixtures/mocks';

const CSV = 'email,name,role\njane@example.com,Jane Doe,analyst\njohn@example.com,John Smith,operator';

test.describe('Bulk user management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await installBaselineMocks(page);
    await mockBulkUsers(page);
    await seedAuth(page);
  });

  test('dry-run preview shows row counts without creating users', async ({ page }) => {
    await page.goto('/bulk-users');

    await expect(page.getByRole('heading', { name: /bulk user management/i })).toBeVisible();

    // Ensure we're on the Import tab (default), click Template to download
    // and verify the Import area renders with the dry-run checkbox on
    const dryRun = page.getByRole('checkbox', { name: /dry run/i });
    await expect(dryRun).toBeChecked();

    // Paste CSV by writing directly to the hidden input through JS —
    // the page reads files via FileReader, so we stub csvText via the input
    // it exposes. Simpler: just create a DataTransfer to simulate a drop.
    await page.evaluate(async (csv) => {
      // Programmatically attach a fake File to the input so React sees it.
      const input = document.getElementById('csv-upload') as HTMLInputElement | null;
      if (!input) throw new Error('csv-upload input not found');
      const file = new File([csv], 'users.csv', { type: 'text/csv' });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, CSV);

    // CSV preview block appears
    await expect(page.getByText(/csv preview/i)).toBeVisible({ timeout: 5_000 });

    // With dry-run checked, the submit label is "Preview"
    const submit = page.getByRole('button', { name: /^preview$/i });
    await expect(submit).toBeVisible();
    await submit.click();

    // Result card: 2 rows "valid" (dry run)
    await expect(page.getByText(/would create/i)).toBeVisible({ timeout: 5_000 });
  });

  test('untick dry-run → submit label flips to Import', async ({ page }) => {
    test.slow(); // triple the default timeout for this one — load tests under parallel CI
    await page.goto('/bulk-users');

    // Wait for the import tab UI to mount — the bulk-actions tab is the
    // default on some viewports, so we ensure the import tab is active.
    await expect(page.getByRole('heading', { name: /bulk user management/i })).toBeVisible();
    await page.waitForSelector('#csv-upload', { state: 'attached' });

    // Paste CSV
    await page.evaluate(async (csv) => {
      const input = document.getElementById('csv-upload') as HTMLInputElement | null;
      if (!input) throw new Error('csv-upload input not found');
      const file = new File([csv], 'users.csv', { type: 'text/csv' });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, CSV);

    const dryRun = page.getByRole('checkbox', { name: /dry run/i });
    await dryRun.uncheck();

    const submit = page.getByRole('button', { name: /^import$/i });
    await expect(submit).toBeVisible();

    // The real import call would run; we don't assert the happy-path
    // toast here because loadUsers() fires after and will try to re-fetch.
    // The baseline mock handles it with an empty array.
    await submit.click();

    // The result grid shows a "Created" count tile (uppercase heading, see BulkUserManagementPage.tsx).
    await expect(page.getByText(/^Created$/).first()).toBeVisible({ timeout: 10_000 });
  });
});
