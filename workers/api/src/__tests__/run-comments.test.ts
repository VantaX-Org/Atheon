/**
 * Run Comments — DELETE endpoint test suite.
 *
 * Covers tenant scoping, ownership, admin override, 404, and 401.
 * The POST/GET endpoints are unchanged and exercised in spec7-integration.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';

const TENANT_A = 'rc-tenant-a';
const TENANT_B = 'rc-tenant-b';
const PASSWORD = 'SecurePass1!';

const AUTHOR = { id: 'rc-user-author', email: 'rc-author@a.com', tenantId: TENANT_A, role: 'analyst' };
const OTHER  = { id: 'rc-user-other',  email: 'rc-other@a.com',  tenantId: TENANT_A, role: 'analyst' };
const ADMIN  = { id: 'rc-user-admin',  email: 'rc-admin@a.com',  tenantId: TENANT_A, role: 'admin' };
const TENANT_B_USER = { id: 'rc-user-b', email: 'rc-user@b.com', tenantId: TENANT_B, role: 'admin' };

const CLUSTER_ID = 'rc-cluster';
const RUN_ID = 'rc-run-1';

async function migrate(): Promise<void> {
  const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
    method: 'POST',
    headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
  });
  if (res.status !== 200) throw new Error(`Migration failed: ${res.status}`);
}

async function seedTenant(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`,
  ).bind(id, id, id).run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenant_entitlements (tenant_id, layers, catalyst_clusters, max_agents, max_users) VALUES (?, '["apex"]', '["finance"]', 10, 20)`,
  ).bind(id).run();
}

async function seedUser(u: { id: string; email: string; tenantId: string; role: string }): Promise<void> {
  const hash = await hashPassword(PASSWORD);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
  ).bind(u.id, u.tenantId, u.email, u.email, u.role, hash, JSON.stringify(['*'])).run();
}

async function login(email: string, slug: string): Promise<string> {
  const res = await SELF.fetch('http://localhost/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, tenant_slug: slug }),
  });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  const body = await res.json() as { token: string };
  return body.token;
}

async function authed(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json');
  return SELF.fetch(`http://localhost${path}`, { ...init, headers });
}

async function seedComment(id: string, runId: string, tenantId: string, userId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO run_comments (id, tenant_id, run_id, user_id, user_name, comment, comment_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'note', datetime('now'))`,
  ).bind(id, tenantId, runId, userId, userId, `comment-${id}`).run();
}

describe('Run Comments — DELETE', () => {
  beforeAll(async () => {
    await migrate();
    await seedTenant(TENANT_A);
    await seedTenant(TENANT_B);
    await seedUser(AUTHOR);
    await seedUser(OTHER);
    await seedUser(ADMIN);
    await seedUser(TENANT_B_USER);
    // run_comments has a FOREIGN KEY on sub_catalyst_runs(id), so we need a
    // real run row to satisfy the constraint when seeding test comments.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO catalyst_clusters (id, tenant_id, name, domain) VALUES (?, ?, 'RC', 'finance')`,
    ).bind(CLUSTER_ID, TENANT_A).run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO sub_catalyst_runs (id, tenant_id, cluster_id, sub_catalyst_name, run_number, status)
       VALUES (?, ?, ?, 'rc-sub', 1, 'completed')`,
    ).bind(RUN_ID, TENANT_A, CLUSTER_ID).run();
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM run_comments WHERE run_id = ?').bind(RUN_ID).run();
  });

  it('rejects unauthenticated callers with 401', async () => {
    await seedComment('cmt-401', RUN_ID, TENANT_A, AUTHOR.id);
    const res = await SELF.fetch(`http://localhost/api/v1/catalysts/runs/${RUN_ID}/comments/cmt-401`, {
      method: 'DELETE',
    });
    expect([401, 403]).toContain(res.status);
  });

  it('returns 404 when the comment does not exist', async () => {
    const token = await login(AUTHOR.email, TENANT_A);
    const res = await authed(`/api/v1/catalysts/runs/${RUN_ID}/comments/cmt-missing`, token, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('lets the author delete their own comment', async () => {
    await seedComment('cmt-own', RUN_ID, TENANT_A, AUTHOR.id);
    const token = await login(AUTHOR.email, TENANT_A);
    const res = await authed(`/api/v1/catalysts/runs/${RUN_ID}/comments/cmt-own`, token, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare('SELECT id FROM run_comments WHERE id = ?').bind('cmt-own').first();
    expect(row).toBeNull();
  });

  it('forbids a non-author non-admin from deleting', async () => {
    await seedComment('cmt-notmine', RUN_ID, TENANT_A, AUTHOR.id);
    const token = await login(OTHER.email, TENANT_A);
    const res = await authed(`/api/v1/catalysts/runs/${RUN_ID}/comments/cmt-notmine`, token, { method: 'DELETE' });
    expect(res.status).toBe(403);
    const row = await env.DB.prepare('SELECT id FROM run_comments WHERE id = ?').bind('cmt-notmine').first();
    expect(row).not.toBeNull();
  });

  it('lets an admin in the same tenant delete any comment', async () => {
    await seedComment('cmt-admin', RUN_ID, TENANT_A, AUTHOR.id);
    const token = await login(ADMIN.email, TENANT_A);
    const res = await authed(`/api/v1/catalysts/runs/${RUN_ID}/comments/cmt-admin`, token, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare('SELECT id FROM run_comments WHERE id = ?').bind('cmt-admin').first();
    expect(row).toBeNull();
  });

  it('does not let a tenant B admin delete a tenant A comment (tenant isolation)', async () => {
    await seedComment('cmt-iso', RUN_ID, TENANT_A, AUTHOR.id);
    const token = await login(TENANT_B_USER.email, TENANT_B);
    const res = await authed(`/api/v1/catalysts/runs/${RUN_ID}/comments/cmt-iso`, token, { method: 'DELETE' });
    // The lookup is tenant-scoped, so the comment is invisible to tenant B —
    // the handler returns 404 (not 403) because it never sees the row.
    expect(res.status).toBe(404);
    const row = await env.DB.prepare('SELECT id FROM run_comments WHERE id = ?').bind('cmt-iso').first();
    expect(row).not.toBeNull();
  });
});
