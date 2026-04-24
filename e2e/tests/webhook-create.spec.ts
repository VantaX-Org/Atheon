/**
 * E2E: Webhook create flow (/webhooks).
 *
 * The critical security moment is the "secret is shown once" UX:
 *  - POST /webhooks returns the raw secret
 *  - GET /webhooks/:id only returns "***"
 * This spec walks the wizard and asserts both halves.
 */
import { test, expect } from '@playwright/test';
import { seedAuth } from '../fixtures/auth';
import { installBaselineMocks, mockWebhookCreate } from '../fixtures/mocks';

test.describe('Webhook create wizard (/webhooks)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await installBaselineMocks(page);
    await seedAuth(page);
  });

  test('create → reveal secret → checkbox gates Done → detail view redacts secret', async ({ page }) => {
    const { id, secret } = await mockWebhookCreate(page);

    await page.goto('/webhooks');

    // Empty state shows the CTA; click the "New webhook" or first-webhook CTA
    await expect(page.getByRole('heading', { name: /^webhooks$/i })).toBeVisible();
    const newBtn = page.getByRole('button', { name: /new webhook|create your first webhook/i }).first();
    await newBtn.click();

    // Wizard modal
    await expect(page.getByRole('heading', { name: /create webhook/i })).toBeVisible();

    // Fill the URL
    await page.getByPlaceholder(/example\.com\/webhooks/i).fill('https://example.com/hook');

    // Tick the first available event type checkbox
    const firstEvent = page.getByRole('checkbox', { name: /subscribe to /i }).first();
    await firstEvent.check();

    // Submit
    await page.getByRole('button', { name: /^create webhook$/i }).click();

    // Step 2: secret reveal — the real secret appears exactly once
    await expect(page.getByTestId('webhook-secret-value')).toHaveText(secret);
    await expect(page.getByText(/this is the only time you will see this secret/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^copy$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /download/i })).toBeVisible();

    // Done button gated on the acknowledgement checkbox
    const doneBtn = page.getByRole('button', { name: /^done$/i });
    await expect(doneBtn).toBeDisabled();
    await page.getByRole('checkbox', { name: /i have saved this secret/i }).check();
    await expect(doneBtn).toBeEnabled();
    await doneBtn.click();

    // Back in the list — click into the detail view (the list now shows our wh)
    await page.waitForTimeout(300);
    // Navigate directly to the detail route — this also exercises deep-link support
    await page.goto(`/webhooks/${id}`);

    // Detail modal should show the redacted "***" value, NOT the real secret
    await expect(page.getByRole('heading', { name: /webhook detail/i })).toBeVisible();
    await expect(page.getByText(/shown once at creation/i)).toBeVisible();
    await expect(page.getByText('***')).toBeVisible();
    // Sanity: the real secret must NOT appear anywhere on the detail view
    await expect(page.getByText(secret, { exact: false })).toHaveCount(0);
  });

  test('submit disabled until URL + at least one event type selected', async ({ page }) => {
    await mockWebhookCreate(page);
    await page.goto('/webhooks');

    await page.getByRole('button', { name: /new webhook|create your first webhook/i }).first().click();

    const submit = page.getByRole('button', { name: /^create webhook$/i });
    await expect(submit).toBeDisabled();

    // Fill only the URL — still disabled (no events picked)
    await page.getByPlaceholder(/example\.com\/webhooks/i).fill('https://example.com/hook');
    await expect(submit).toBeDisabled();

    // Pick an event — now enabled
    await page.getByRole('checkbox', { name: /subscribe to /i }).first().check();
    await expect(submit).toBeEnabled();
  });
});
