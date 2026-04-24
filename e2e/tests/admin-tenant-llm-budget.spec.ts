/**
 * E2E: Admin tenant LLM budget page (/admin/tenants/:id/llm).
 *
 * Superadmin flow:
 *  1. Open the tenant list
 *  2. Navigate to a tenant's LLM budget page (deep-link — the list row has a
 *     Zap icon button we don't need to hunt for)
 *  3. Verify the current-usage card renders with a bar + Unlimited checkbox
 *  4. Flip the Unlimited checkbox and save — success toast fires
 */
import { test, expect } from '@playwright/test';
import { seedAuth, DEFAULT_SUPERADMIN } from '../fixtures/auth';
import { installBaselineMocks, mockLlmBudget } from '../fixtures/mocks';

const TENANT_ID = 'tenant_e2e_acme';

test.describe('Tenant LLM Budget', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await installBaselineMocks(page);
    await mockLlmBudget(page, TENANT_ID);
    await seedAuth(page, DEFAULT_SUPERADMIN);
  });

  test('renders usage bar, Unlimited checkbox, and persists save', async ({ page }) => {
    await page.goto(`/admin/tenants/${TENANT_ID}/llm`);

    await expect(page.getByRole('heading', { name: /llm budget/i })).toBeVisible();

    // Current-usage card
    await expect(page.getByText(/current month usage/i)).toBeVisible();
    await expect(page.getByText(/tokens used this month/i)).toBeVisible();

    // The Unlimited checkbox exists and is unchecked when a budget is set
    const unlimited = page.getByRole('checkbox', { name: /unlimited/i });
    await expect(unlimited).toBeVisible();
    await expect(unlimited).not.toBeChecked();

    // Save is disabled when nothing has changed
    const save = page.getByRole('button', { name: /save changes/i });
    await expect(save).toBeDisabled();

    // Flip to Unlimited — save enables
    await unlimited.check();
    await expect(save).toBeEnabled();

    // Submit — the mock responds with the updated budget (monthlyTokenBudget=null)
    await save.click();

    // Toast: "LLM budget updated"
    await expect(page.getByText(/llm budget updated/i)).toBeVisible({ timeout: 5_000 });

    // After save, the Unlimited badge / "unlimited" copy is shown in the summary
    await expect(page.getByText(/unlimited/i).first()).toBeVisible();
  });

  test('invalid budget (negative) does not enable Save', async ({ page }) => {
    await page.goto(`/admin/tenants/${TENANT_ID}/llm`);

    await expect(page.getByRole('heading', { name: /llm budget/i })).toBeVisible();

    const input = page.getByLabel(/monthly token budget/i);
    await input.fill('-5');

    const save = page.getByRole('button', { name: /save changes/i });
    // A negative number is rejected by the parse step → canSave=false
    await expect(save).toBeDisabled();
  });
});
