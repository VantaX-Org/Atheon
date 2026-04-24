/**
 * E2E: MFA enrollment golden path (/settings/mfa).
 *
 * Covers the critical security-related UI:
 *  - QR code renders from the provisioning URI
 *  - Secret text is visible and copyable
 *  - 6-digit code input accepts numeric-only and surfaces a server error
 *  - Backup-code "saved" checkbox gates the Done button (required-acknowledge)
 *
 * Uses page.route() to mock /api/auth/mfa/* — no live backend needed.
 */
import { test, expect } from '@playwright/test';
import { seedAuth } from '../fixtures/auth';
import { installBaselineMocks, mockMfaEnrollment } from '../fixtures/mocks';

test.describe('MFA enrollment (/settings/mfa)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await installBaselineMocks(page);
    await mockMfaEnrollment(page);
    await seedAuth(page);
  });

  test('renders the enrollment wizard with QR + secret + code input', async ({ page }) => {
    await page.goto('/settings/mfa');

    // Wait for the page heading — it's role=heading (h1) "Two-Factor Authentication"
    await expect(page.getByRole('heading', { name: /two-factor authentication/i })).toBeVisible();

    // Kick off the wizard
    await page.getByRole('button', { name: /enable mfa/i }).click();

    // Step 1 of wizard — advance past install step
    await page.getByRole('button', { name: /i already have one/i }).click();

    // Step 2 — QR and secret should be rendered
    await expect(page.getByRole('heading', { name: /scan this qr code/i })).toBeVisible();

    // The secret is shown in <code> (pretty-printed in groups of 4)
    const secretFragment = page.locator('code').filter({ hasText: /JBSW/i });
    await expect(secretFragment.first()).toBeVisible();

    // QR is rendered as inline SVG from the provisioning URI. The QR
    // wrapper <div> is the only one with a white background on this page
    // and contains the SVG.
    const qrSvg = page.locator('.bg-white svg').first();
    await expect(qrSvg).toBeVisible({ timeout: 10_000 });

    // Copy secret button is labelled
    await expect(page.getByRole('button', { name: /copy secret/i })).toBeVisible();
  });

  test('invalid 6-digit code shows a server-side error', async ({ page }) => {
    await page.goto('/settings/mfa');
    await page.getByRole('button', { name: /enable mfa/i }).click();
    await page.getByRole('button', { name: /i already have one/i }).click();
    await page.getByRole('button', { name: /i've added it/i }).click();

    // Enter a non-matching code (mock returns 400 unless code === 000000)
    const codeInput = page.getByRole('textbox', { name: /six-digit verification code/i });
    await expect(codeInput).toBeVisible();
    await codeInput.fill('123456');
    await page.getByRole('button', { name: /verify.*enable/i }).click();

    // Error surfaces in the UI
    await expect(page.getByText(/invalid code/i)).toBeVisible();
  });

  test('successful verify reveals backup codes with required acknowledgement', async ({ page }) => {
    await page.goto('/settings/mfa');
    await page.getByRole('button', { name: /enable mfa/i }).click();
    await page.getByRole('button', { name: /i already have one/i }).click();
    await page.getByRole('button', { name: /i've added it/i }).click();

    // Magic code "000000" → mock returns success + 8 backup codes
    await page.getByRole('textbox', { name: /six-digit verification code/i }).fill('000000');
    await page.getByRole('button', { name: /verify.*enable/i }).click();

    // Backup codes panel
    await expect(page.getByText(/save these 8 recovery codes now/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /copy all/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /download/i })).toBeVisible();

    // "I'm done" must be disabled until the checkbox is ticked
    const doneBtn = page.getByRole('button', { name: /i'?m done/i });
    await expect(doneBtn).toBeDisabled();

    // Tick the acknowledgement checkbox
    await page.getByRole('checkbox', { name: /confirm recovery codes saved/i }).check();
    await expect(doneBtn).toBeEnabled();
  });

  test('code input strips non-digits and caps at 6', async ({ page }) => {
    await page.goto('/settings/mfa');
    await page.getByRole('button', { name: /enable mfa/i }).click();
    await page.getByRole('button', { name: /i already have one/i }).click();
    await page.getByRole('button', { name: /i've added it/i }).click();

    const codeInput = page.getByRole('textbox', { name: /six-digit verification code/i });

    // Typing letters yields an empty value (they all get stripped)
    await codeInput.pressSequentially('abc');
    await expect(codeInput).toHaveValue('');

    // Mixed input: letters stripped, digits kept
    await codeInput.fill('');
    await codeInput.pressSequentially('1a2b3c');
    await expect(codeInput).toHaveValue('123');

    // Cap at 6 digits
    await codeInput.fill('');
    await codeInput.pressSequentially('12345678');
    await expect(codeInput).toHaveValue('123456');
  });
});
