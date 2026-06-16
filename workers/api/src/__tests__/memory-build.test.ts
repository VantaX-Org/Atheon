/**
 * Memory graph auto-build — regression suite.
 *
 * Guards the `POST /api/memory/build` endpoint against the production 500 where
 * case-variant source-system names (e.g. "CRM" vs "crm", "SAP FI" vs "sap fi")
 * slug to the same `auto:sys:*` entity id. The builder emitted two entities with
 * the same PRIMARY KEY, aborting the whole INSERT batch. The fix collapses
 * entities to unique ids before persisting.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';
import { ensureMigrated } from './setup';

const TENANT = 'mem-build-tenant';
const SLUG = 'mem-build';
const EMAIL = 'memadmin@example.com';
const PASSWORD = 'memadmin-pw-123456';

async function login(): Promise<string> {
  const res = await SELF.fetch('http://localhost/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, tenant_slug: SLUG }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token: string };
  return body.token;
}

describe('POST /api/memory/build', () => {
  beforeAll(async () => {
    await ensureMigrated();
    await env.DB.prepare(
      `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, 'Mem Build', ?, 'enterprise', 'active')`
    ).bind(TENANT, SLUG).run();
    await env.DB.prepare(
      `INSERT OR REPLACE INTO tenant_entitlements (tenant_id, layers, catalyst_clusters, max_agents, max_users) VALUES (?, '["memory"]', '["finance"]', 50, 100)`
    ).bind(TENANT).run();
    const hash = await hashPassword(PASSWORD);
    await env.DB.prepare(
      `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status) VALUES (?, ?, ?, 'Mem Admin', 'admin', ?, ?, 'active')`
    ).bind('mem-build-user', TENANT, EMAIL, hash, JSON.stringify(['*'])).run();
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM process_metrics WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare("DELETE FROM graph_relationships WHERE tenant_id = ?").bind(TENANT).run();
    await env.DB.prepare("DELETE FROM graph_entities WHERE tenant_id = ?").bind(TENANT).run();
  });

  it('does not 500 when source-system names differ only by case (PK collision)', async () => {
    // Two metrics whose source_system slugs to the same `auto:sys:crm` id.
    for (const [id, sys] of [['m1', 'CRM'], ['m2', 'crm']] as const) {
      await env.DB.prepare(
        `INSERT INTO process_metrics (id, tenant_id, name, value, unit, source_system) VALUES (?, ?, ?, 1, 'count', ?)`
      ).bind(id, TENANT, `metric ${id}`, sys).run();
    }

    const token = await login();
    const res = await SELF.fetch('http://localhost/api/v1/memory/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: '{}',
    });

    expect(res.status).toBe(200);

    // The colliding system collapses to exactly one entity (first variant wins).
    const sys = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM graph_entities WHERE tenant_id = ? AND id = 'auto:sys:crm'"
    ).bind(TENANT).first<{ c: number }>();
    expect(sys?.c).toBe(1);

    // No duplicate ids persisted at all.
    const dupes = await env.DB.prepare(
      'SELECT id, COUNT(*) as c FROM graph_entities WHERE tenant_id = ? GROUP BY id HAVING c > 1'
    ).bind(TENANT).all();
    expect(dupes.results.length).toBe(0);
  });
});
