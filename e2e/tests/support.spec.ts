/**
 * E2E: Support ticket flow (/support-tickets).
 *
 * Walks the minimum feature happy path:
 *  1. Seed an authenticated user + baseline mocks.
 *  2. Intercept GET /api/v1/support/tickets to return an empty list, then a
 *     list with the newly-created ticket after POST succeeds.
 *  3. Click "New ticket", fill subject + body, submit.
 *  4. Assert the created ticket surfaces in the list.
 */
import { test, expect, type Page } from '@playwright/test';
import { seedAuth } from '../fixtures/auth';
import { installBaselineMocks } from '../fixtures/mocks';

function jsonFulfill(status: number, body: unknown) {
  return {
    status,
    contentType: 'application/json',
    headers: {
      'X-Request-ID': `e2e-support-${Math.random().toString(36).slice(2, 10)}`,
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}

async function mockSupport(page: Page) {
  const state: { tickets: Record<string, unknown>[] } = { tickets: [] };
  const createdSubject = 'E2E: cannot export catalyst run';

  await page.route('**/api/v1/support/tickets', async (route) => {
    const method = route.request().method();
    if (method === 'POST') {
      const body = route.request().postDataJSON() as {
        subject?: string;
        body?: string;
        category?: string;
        priority?: string;
      } | null;
      const ticket = {
        id: 'ticket-e2e-1',
        tenant_id: 'vantax',
        user_id: 'e2e-superadmin',
        assignee_user_id: null,
        subject: body?.subject ?? 'E2E ticket',
        body: body?.body ?? '',
        category: body?.category ?? 'general',
        priority: body?.priority ?? 'normal',
        status: 'open',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      state.tickets.unshift(ticket);
      return route.fulfill(jsonFulfill(201, { ticket }));
    }
    if (method === 'GET') {
      return route.fulfill(jsonFulfill(200, {
        tickets: state.tickets,
        next_cursor: null,
      }));
    }
    return route.fallback();
  });

  return { createdSubject };
}

test.describe('Support ticket flow (/support-tickets)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await installBaselineMocks(page);
    await seedAuth(page);
  });

  test('user can create a ticket and see it in the list', async ({ page }) => {
    const { createdSubject } = await mockSupport(page);

    await page.goto('/support-tickets');

    // Empty state visible up-front
    await expect(page.getByRole('heading', { name: /^support$/i })).toBeVisible();

    // Click "New ticket" — there may be two buttons (header + empty state)
    await page.getByTestId('support-new-ticket-btn').click();

    // Modal opens
    await expect(page.getByTestId('support-new-ticket-modal')).toBeVisible();

    // Fill in subject + body
    await page.getByTestId('support-subject-input').fill(createdSubject);
    await page.getByTestId('support-body-textarea').fill(
      'Repro: open catalyst run detail, click Export, nothing happens. Browser console logs a CORS error.'
    );

    // Optional: change priority to high so we also cover the select.
    await page.getByTestId('support-priority-select').selectOption('high');

    // Submit the form
    await page.getByTestId('support-submit-btn').click();

    // Modal closes and the new ticket appears in the list
    await expect(page.getByTestId('support-new-ticket-modal')).toHaveCount(0);
    const list = page.getByTestId('support-ticket-list');
    await expect(list).toBeVisible();
    await expect(list.getByText(createdSubject)).toBeVisible();
    // Status badge defaults to "open"
    await expect(list.getByText(/^open$/i).first()).toBeVisible();
    // Priority badge reflects the selection
    await expect(list.getByText(/^high$/i).first()).toBeVisible();
  });
});
