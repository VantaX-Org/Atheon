import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';
import { ensureMigrated } from './setup';

const TENANT = 'dr-tenant';
const SLUG = 'dr-tenant';
const EMAIL = 'dradmin@example.com';
const PASSWORD = 'dradmin-pw-123456';

async function superadminLogin(): Promise<string> {
  const res = await SELF.fetch('http://localhost/api/v1/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, tenant_slug: SLUG }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

describe('deferred create + scoped run', () => {
  beforeAll(async () => {
    await ensureMigrated();
    await env.DB.prepare(`INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, 'DR', ?, 'enterprise', 'active')`).bind(TENANT, SLUG).run();
    await env.DB.prepare(`INSERT OR REPLACE INTO tenant_entitlements (tenant_id, layers, catalyst_clusters, max_agents, max_users) VALUES (?, '["mind"]', '["finance"]', 50, 100)`).bind(TENANT).run();
    const hash = await hashPassword(PASSWORD);
    await env.DB.prepare(`INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status) VALUES (?, ?, ?, 'DR Admin', 'superadmin', ?, ?, 'active')`).bind('dr-user', TENANT, EMAIL, hash, JSON.stringify(['*'])).run();
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM erp_invoices WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM assessment_datasets WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM assessments WHERE tenant_id = ?').bind(TENANT).run();
  });

  it('create with defer_run=true stays pending (no auto-run); /run advances it', async () => {
    const token = await superadminLogin();
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

    // 1. Create deferred — must NOT auto-run.
    const createRes = await SELF.fetch(`http://localhost/api/v1/assessments?tenant_id=${TENANT}`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        prospect_name: 'Acme',
        prospect_industry: 'manufacturing',
        config: {},
        defer_run: true,
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; status: string };
    expect(created.status).toBe('pending');

    const afterCreate = await env.DB.prepare('SELECT status FROM assessments WHERE id = ?').bind(created.id).first<{ status: string }>();
    expect(afterCreate?.status).toBe('pending');

    // 2. Upload a dataset.
    const dsRes = await SELF.fetch(`http://localhost/api/v1/assessments/${created.id}/dataset?tenant_id=${TENANT}`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        domains: {
          invoices: {
            header: ['invoice_number', 'invoice_date', 'total'],
            rows: [{ invoice_number: 'INV-1', invoice_date: '2026-01-10', total: '500' }],
          },
        },
      }),
    });
    expect(dsRes.status).toBe(200);

    // 3. Trigger the run.
    const runRes = await SELF.fetch(`http://localhost/api/v1/assessments/${created.id}/run?tenant_id=${TENANT}`, {
      method: 'POST',
      headers: auth,
    });
    expect(runRes.status).toBe(200);
    const ran = (await runRes.json()) as { id: string; status: string };
    expect(ran.status).toBe('running');

    // After run dispatch the assessment must no longer be 'pending'.
    const afterRun = await env.DB.prepare('SELECT status FROM assessments WHERE id = ?').bind(created.id).first<{ status: string }>();
    expect(afterRun?.status).not.toBe('pending');
  });
});
