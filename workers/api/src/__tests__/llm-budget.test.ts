/**
 * Per-tenant LLM Token Budget Tests
 *
 * Covers:
 *   - Null budget = unlimited (default, existing tenants untouched).
 *   - Over-limit requests are denied with reason + remaining.
 *   - Monthly rollover resets the counter.
 *   - `tenant_llm_usage` audit rows are written on recordLlmUsage.
 *   - Admin endpoint requires superadmin (403 otherwise), updates on success.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  checkAndReserveBudget,
  recordLlmUsage,
  setTenantTokenBudget,
  isRedactionEnabled,
  setTenantRedactionEnabled,
} from '../services/llm-provider';
import { hashPassword } from '../middleware/auth';

const BUDGET_SUPERADMIN = {
  id: 'user-budget-super',
  email: 'budget-super@vantax.co.za',
  password: 'BudgetSuper123!',
  tenantId: 'vantax',
};

const BUDGET_ANALYST = {
  id: 'user-budget-analyst',
  email: 'budget-analyst@budget-tenant.co.za',
  password: 'BudgetAnalyst123!',
  tenantId: 'budget-tenant',
};

async function migrateViaEndpoint(): Promise<void> {
  const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
    method: 'POST',
    headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
  });
  if (res.status !== 200) throw new Error(`Migration endpoint returned ${res.status}`);
}

async function seedTestUser(
  id: string, tenantId: string, email: string, password: string, role: string,
): Promise<void> {
  const hash = await hashPassword(password);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
  ).bind(id, tenantId, email, email, role, hash, JSON.stringify(['*'])).run();
}

async function login(email: string, password: string): Promise<string | null> {
  const res = await SELF.fetch('http://localhost/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) return null;
  const data = await res.json() as { token?: string };
  return data.token ?? null;
}

describe('Per-tenant LLM Token Budget', () => {
  beforeAll(async () => {
    await migrateViaEndpoint();

    // Seed both the 'vantax' superadmin tenant and a separate analyst tenant.
    // 'vantax' is referenced by the migrate.ts seed but may not exist in the
    // isolated test DB — insert OR IGNORE is a no-op if it's already there.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`,
    ).bind('vantax', 'VantaX', 'vantax').run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO tenant_entitlements (tenant_id, layers, catalyst_clusters, max_agents, max_users) VALUES (?, '["apex","pulse","mind","memory"]', '["finance"]', 50, 100)`,
    ).bind('vantax').run();

    await env.DB.prepare(
      `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`,
    ).bind('budget-tenant', 'Budget Test Tenant', 'budget-tenant').run();
    await env.DB.prepare(
      `INSERT OR REPLACE INTO tenant_entitlements (tenant_id, layers, catalyst_clusters, max_agents, max_users) VALUES (?, '["mind"]', '["finance"]', 5, 10)`,
    ).bind('budget-tenant').run();

    await seedTestUser(BUDGET_SUPERADMIN.id, BUDGET_SUPERADMIN.tenantId, BUDGET_SUPERADMIN.email, BUDGET_SUPERADMIN.password, 'superadmin');
    await seedTestUser(BUDGET_ANALYST.id, BUDGET_ANALYST.tenantId, BUDGET_ANALYST.email, BUDGET_ANALYST.password, 'analyst');
  });

  beforeEach(async () => {
    // Fresh budget row each test so reservations don't leak
    await env.DB.prepare('DELETE FROM tenant_llm_budget WHERE tenant_id = ?').bind('budget-tenant').run();
    await env.DB.prepare('DELETE FROM tenant_llm_usage WHERE tenant_id = ?').bind('budget-tenant').run();
  });

  describe('checkAndReserveBudget', () => {
    it('allows the call when no budget is set (null = unlimited)', async () => {
      const result = await checkAndReserveBudget(env.DB, 'budget-tenant', 1000);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(Number.POSITIVE_INFINITY);
    });

    it('denies the call when reservation would exceed the monthly budget', async () => {
      await setTenantTokenBudget(env.DB, 'budget-tenant', 500);

      // First call under budget — allowed
      const ok = await checkAndReserveBudget(env.DB, 'budget-tenant', 300);
      expect(ok.allowed).toBe(true);
      expect(ok.remaining).toBe(200);

      // Second call would push over — denied, no extra reservation made
      const denied = await checkAndReserveBudget(env.DB, 'budget-tenant', 300);
      expect(denied.allowed).toBe(false);
      expect(denied.reason).toMatch(/budget exceeded/i);
      expect(denied.remaining).toBe(200); // still 200 left, the denied call didn't burn any

      // Counter should reflect only the allowed reservation
      const row = await env.DB.prepare(
        'SELECT tokens_used_this_month FROM tenant_llm_budget WHERE tenant_id = ?',
      ).bind('budget-tenant').first<{ tokens_used_this_month: number }>();
      expect(row?.tokens_used_this_month).toBe(300);
    });

    it('resets the counter when tokens_reset_at is in a past month', async () => {
      await setTenantTokenBudget(env.DB, 'budget-tenant', 1000);
      // Simulate usage from last month
      await env.DB.prepare(
        `UPDATE tenant_llm_budget SET tokens_used_this_month = 950, tokens_reset_at = '2024-01-01T00:00:00.000Z' WHERE tenant_id = ?`,
      ).bind('budget-tenant').run();

      // This call would have been denied without rollover (950+200>1000);
      // after rollover, counter is 0 so 200 is fine.
      const result = await checkAndReserveBudget(env.DB, 'budget-tenant', 200);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(800);

      const row = await env.DB.prepare(
        'SELECT tokens_used_this_month, tokens_reset_at FROM tenant_llm_budget WHERE tenant_id = ?',
      ).bind('budget-tenant').first<{ tokens_used_this_month: number; tokens_reset_at: string }>();
      expect(row?.tokens_used_this_month).toBe(200);
      // Reset must be in the current month
      const d = new Date(row!.tokens_reset_at);
      const now = new Date();
      expect(d.getUTCFullYear()).toBe(now.getUTCFullYear());
      expect(d.getUTCMonth()).toBe(now.getUTCMonth());
    });
  });

  describe('recordLlmUsage', () => {
    it('inserts a row into tenant_llm_usage', async () => {
      await checkAndReserveBudget(env.DB, 'budget-tenant', 500);
      await recordLlmUsage(
        env.DB, 'budget-tenant', 'claude', 'claude-sonnet-4',
        'mind.query', 200, 150, 'req-abc-123', 500,
      );

      const rows = await env.DB.prepare(
        'SELECT provider, model, prompt_tokens, completion_tokens, total_tokens, endpoint, request_id FROM tenant_llm_usage WHERE tenant_id = ?',
      ).bind('budget-tenant').all();
      expect(rows.results.length).toBe(1);
      const row = rows.results[0] as Record<string, unknown>;
      expect(row.provider).toBe('claude');
      expect(row.model).toBe('claude-sonnet-4');
      expect(row.prompt_tokens).toBe(200);
      expect(row.completion_tokens).toBe(150);
      expect(row.total_tokens).toBe(350);
      expect(row.endpoint).toBe('mind.query');
      expect(row.request_id).toBe('req-abc-123');
    });

    it('reconciles the reservation - refunds when actual < estimated', async () => {
      await setTenantTokenBudget(env.DB, 'budget-tenant', 10_000);
      await checkAndReserveBudget(env.DB, 'budget-tenant', 1000);

      let row = await env.DB.prepare(
        'SELECT tokens_used_this_month FROM tenant_llm_budget WHERE tenant_id = ?',
      ).bind('budget-tenant').first<{ tokens_used_this_month: number }>();
      expect(row?.tokens_used_this_month).toBe(1000);

      // Actual was only 400 (250 in + 150 out) — 600 should be refunded
      await recordLlmUsage(env.DB, 'budget-tenant', 'claude', 'm', 'mind.query', 250, 150, undefined, 1000);

      row = await env.DB.prepare(
        'SELECT tokens_used_this_month FROM tenant_llm_budget WHERE tenant_id = ?',
      ).bind('budget-tenant').first<{ tokens_used_this_month: number }>();
      expect(row?.tokens_used_this_month).toBe(400);
    });
  });

  describe('Redaction opt-out flag', () => {
    it('defaults to redaction enabled when no row exists', async () => {
      const enabled = await isRedactionEnabled(env.DB, 'budget-tenant');
      expect(enabled).toBe(true);
    });

    it('reflects opt-out when tenant disables redaction', async () => {
      await setTenantRedactionEnabled(env.DB, 'budget-tenant', false);
      expect(await isRedactionEnabled(env.DB, 'budget-tenant')).toBe(false);

      await setTenantRedactionEnabled(env.DB, 'budget-tenant', true);
      expect(await isRedactionEnabled(env.DB, 'budget-tenant')).toBe(true);
    });
  });

  describe('Admin endpoint', () => {
    it('PUT /api/v1/admin/tenants/:id/llm-budget without superadmin returns 403', async () => {
      const token = await login(BUDGET_ANALYST.email, BUDGET_ANALYST.password);
      expect(token).not.toBeNull();

      const res = await SELF.fetch(`http://localhost/api/v1/admin/tenants/budget-tenant/llm-budget`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ monthlyTokenBudget: 5000 }),
      });
      expect(res.status).toBe(403);
    });

    it('PUT /api/v1/admin/tenants/:id/llm-budget as superadmin updates the budget', async () => {
      const token = await login(BUDGET_SUPERADMIN.email, BUDGET_SUPERADMIN.password);
      expect(token).not.toBeNull();

      const res = await SELF.fetch(`http://localhost/api/v1/admin/tenants/budget-tenant/llm-budget`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ monthlyTokenBudget: 5000, llmRedactionEnabled: false }),
      });
      expect(res.status).toBe(200);
      const data = await res.json() as Record<string, unknown>;
      expect(data.success).toBe(true);
      expect(data.monthlyTokenBudget).toBe(5000);
      expect(data.llmRedactionEnabled).toBe(false);

      // DB state reflects the update
      const row = await env.DB.prepare(
        'SELECT monthly_token_budget, llm_redaction_enabled FROM tenant_llm_budget WHERE tenant_id = ?',
      ).bind('budget-tenant').first<{ monthly_token_budget: number | null; llm_redaction_enabled: number }>();
      expect(row?.monthly_token_budget).toBe(5000);
      expect(row?.llm_redaction_enabled).toBe(0);
    });
  });
});
