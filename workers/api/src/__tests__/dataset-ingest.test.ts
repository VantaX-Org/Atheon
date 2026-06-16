import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';
import { ensureMigrated } from './setup';

const TENANT = 'ds-tenant';
const SLUG = 'ds-tenant';
const EMAIL = 'dsadmin@example.com';
const PASSWORD = 'dsadmin-pw-123456';
const ASSESSMENT = 'ds-assessment-1';

async function superadminLogin(): Promise<string> {
  const res = await SELF.fetch('http://localhost/api/v1/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, tenant_slug: SLUG }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

describe('POST /api/assessments/:id/dataset', () => {
  beforeAll(async () => {
    await ensureMigrated();
    await env.DB.prepare(`INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, 'DS', ?, 'enterprise', 'active')`).bind(TENANT, SLUG).run();
    await env.DB.prepare(`INSERT OR REPLACE INTO tenant_entitlements (tenant_id, layers, catalyst_clusters, max_agents, max_users) VALUES (?, '["mind"]', '["finance"]', 50, 100)`).bind(TENANT).run();
    const hash = await hashPassword(PASSWORD);
    await env.DB.prepare(`INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status) VALUES (?, ?, ?, 'DS Admin', 'superadmin', ?, ?, 'active')`).bind('ds-user', TENANT, EMAIL, hash, JSON.stringify(['*'])).run();
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM erp_invoices WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM assessment_datasets WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM assessments WHERE id = ?').bind(ASSESSMENT).run();
    await env.DB.prepare(`INSERT INTO assessments (id, tenant_id, prospect_name, prospect_industry, status, created_by) VALUES (?, ?, 'Acme', 'manufacturing', 'pending', 'ds-user')`).bind(ASSESSMENT, TENANT).run();
  });

  it('ingests valid rows tagged with a dataset_id and marks ready', async () => {
    const token = await superadminLogin();
    const res = await SELF.fetch(`http://localhost/api/v1/assessments/${ASSESSMENT}/dataset?tenant_id=${TENANT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        domains: {
          invoices: {
            header: ['invoice_number', 'invoice_date', 'total'],
            rows: [
              { invoice_number: 'INV-1', invoice_date: '2026-01-10', total: '500' },
              { invoice_number: 'INV-2', invoice_date: '2026-01-11', total: '750' },
            ],
          },
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dataset_id: string; status: string; row_counts: Record<string, number> };
    expect(body.status).toBe('ready');
    expect(body.row_counts.invoices).toBe(2);

    const cnt = await env.DB.prepare('SELECT COUNT(*) c FROM erp_invoices WHERE tenant_id = ? AND dataset_id = ?').bind(TENANT, body.dataset_id).first<{ c: number }>();
    expect(cnt?.c).toBe(2);
  });

  it('rejects an unknown-column payload wholesale (nothing ingested, status failed)', async () => {
    const token = await superadminLogin();
    const res = await SELF.fetch(`http://localhost/api/v1/assessments/${ASSESSMENT}/dataset?tenant_id=${TENANT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        domains: { invoices: { header: ['invoice_number', 'invoice_date', 'total', 'evil'], rows: [{ invoice_number: 'X', invoice_date: '2026-01-10', total: '1', evil: 'y' }] } },
      }),
    });
    expect(res.status).toBe(422);
    const cnt = await env.DB.prepare('SELECT COUNT(*) c FROM erp_invoices WHERE tenant_id = ?').bind(TENANT).first<{ c: number }>();
    expect(cnt?.c).toBe(0);
  });
});
