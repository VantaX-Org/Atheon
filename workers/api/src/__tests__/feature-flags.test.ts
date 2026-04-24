/**
 * Feature Flags test suite (v46-platform)
 * Covers CRUD, RBAC (superadmin only), toggle, and tenant-scoped evaluation
 * including boolean / percent / tenant_allowlist resolution.
 *
 * Note: @cloudflare/vitest-pool-workers isolates D1 state per `it` block, so
 * every test seeds its own tenants/users and creates the flags it needs.
 */
import { describe, it, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';
import { hashTenantFlag, evaluateFlagRow } from '../routes/feature-flags';
import type { FeatureFlagRow } from '../routes/feature-flags';

async function postJSON(path: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function authed(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json');
  return SELF.fetch(`http://localhost${path}`, { ...init, headers });
}

async function seedTenant(id: string, slug: string, name: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(id, name, slug).run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenant_entitlements (tenant_id, layers, catalyst_clusters, max_agents, max_users) VALUES (?, '["apex"]', '["finance"]', 10, 20)`
  ).bind(id).run();
}

async function seedUser(id: string, tenantId: string, email: string, password: string, role: string): Promise<void> {
  const hash = await hashPassword(password);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`
  ).bind(id, tenantId, email, `Test ${role}`, role, hash, JSON.stringify(['*'])).run();
}

async function login(email: string, password: string, slug: string): Promise<string> {
  const res = await postJSON('/api/v1/auth/login', { email, password, tenant_slug: slug });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  const body = await res.json() as { token: string };
  return body.token;
}

/** Set up a fresh tenant + superadmin + admin, return their tokens. */
async function setupPlatform(suffix: string): Promise<{ superToken: string; adminToken: string; tenantId: string; altTenantId: string }> {
  // Each test needs to run the migration first since isolated storage starts empty
  const mig = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
    method: 'POST',
    headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
  });
  if (mig.status !== 200) throw new Error(`Migration failed: ${mig.status}`);

  const tenantId = `ff-tenant-${suffix}`;
  const altTenantId = `ff-alt-${suffix}`;
  const slug = `ff-tenant-${suffix}`;
  await seedTenant(tenantId, slug, 'FF Tenant');
  await seedTenant(altTenantId, `ff-alt-${suffix}`, 'FF Alt');
  await seedUser(`ff-super-${suffix}`, tenantId, `ff-super-${suffix}@test.com`, PASSWORD, 'superadmin');
  await seedUser(`ff-admin-${suffix}`, tenantId, `ff-admin-${suffix}@test.com`, PASSWORD, 'admin');

  const superToken = await login(`ff-super-${suffix}@test.com`, PASSWORD, slug);
  const adminToken = await login(`ff-admin-${suffix}@test.com`, PASSWORD, slug);
  return { superToken, adminToken, tenantId, altTenantId };
}

const PASSWORD = 'SecurePass1!';

describe('Feature Flags - RBAC', () => {
  it('denies non-superadmin from listing', async () => {
    const { adminToken } = await setupPlatform('rbac1');
    const res = await authed('/api/v1/admin/feature-flags', adminToken);
    expect(res.status).toBe(403);
  });

  it('denies unauthenticated callers', async () => {
    await setupPlatform('rbac2');
    const res = await SELF.fetch('http://localhost/api/v1/admin/feature-flags');
    expect(res.status).toBe(401);
  });

  it('allows superadmin to list', async () => {
    const { superToken } = await setupPlatform('rbac3');
    const res = await authed('/api/v1/admin/feature-flags', superToken);
    expect(res.status).toBe(200);
    const body = await res.json() as { flags: unknown[]; total: number };
    expect(Array.isArray(body.flags)).toBe(true);
  });
});

describe('Feature Flags - CRUD', () => {
  it('creates a boolean flag', async () => {
    const { superToken } = await setupPlatform('crud1');
    const res = await authed('/api/v1/admin/feature-flags', superToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'new_dashboard_ui', description: 'test', type: 'boolean', default_enabled: true }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { flag: { name: string; type: string; defaultEnabled: boolean } };
    expect(body.flag.name).toBe('new_dashboard_ui');
    expect(body.flag.type).toBe('boolean');
    expect(body.flag.defaultEnabled).toBe(true);
  });

  it('rejects duplicate flag names', async () => {
    const { superToken } = await setupPlatform('crud2');
    const first = await authed('/api/v1/admin/feature-flags', superToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'dup_flag', type: 'boolean' }),
    });
    expect(first.status).toBe(201);
    const second = await authed('/api/v1/admin/feature-flags', superToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'dup_flag', type: 'boolean' }),
    });
    expect(second.status).toBe(409);
  });

  it('rejects invalid flag types', async () => {
    const { superToken } = await setupPlatform('crud3');
    const res = await authed('/api/v1/admin/feature-flags', superToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'bogus_flag', type: 'whatever' }),
    });
    expect(res.status).toBe(400);
  });

  it('updates a flag (rollout_percent + type)', async () => {
    const { superToken } = await setupPlatform('crud4');
    const createRes = await authed('/api/v1/admin/feature-flags', superToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'to_update', type: 'boolean', default_enabled: false }),
    });
    const createBody = await createRes.json() as { flag: { id: string } };
    const id = createBody.flag.id;

    const res = await authed(`/api/v1/admin/feature-flags/${id}`, superToken, {
      method: 'PUT',
      body: JSON.stringify({ type: 'percent', rollout_percent: 42 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { flag: { type: string; rolloutPercent: number } };
    expect(body.flag.type).toBe('percent');
    expect(body.flag.rolloutPercent).toBe(42);
  });

  it('toggles default_enabled', async () => {
    const { superToken } = await setupPlatform('crud5');
    const createRes = await authed('/api/v1/admin/feature-flags', superToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'to_toggle', type: 'boolean', default_enabled: false }),
    });
    const createBody = await createRes.json() as { flag: { id: string; defaultEnabled: boolean } };
    expect(createBody.flag.defaultEnabled).toBe(false);
    const id = createBody.flag.id;

    const res = await authed(`/api/v1/admin/feature-flags/${id}/toggle`, superToken, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { flag: { defaultEnabled: boolean } };
    expect(body.flag.defaultEnabled).toBe(true);
  });

  it('deletes a flag', async () => {
    const { superToken } = await setupPlatform('crud6');
    const createRes = await authed('/api/v1/admin/feature-flags', superToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'to_delete', type: 'boolean' }),
    });
    const id = (await createRes.json() as { flag: { id: string } }).flag.id;

    const res = await authed(`/api/v1/admin/feature-flags/${id}`, superToken, { method: 'DELETE' });
    expect(res.status).toBe(200);

    const again = await authed(`/api/v1/admin/feature-flags/${id}`, superToken, { method: 'DELETE' });
    expect(again.status).toBe(404);
  });
});

describe('Feature Flags - Evaluation (unit)', () => {
  it('hashes deterministically for the same (tenant, flag) pair', () => {
    const a = hashTenantFlag('tenant-x', 'flag-y');
    const b = hashTenantFlag('tenant-x', 'flag-y');
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(100);
  });

  it('produces different hashes for different tenants', () => {
    const a = hashTenantFlag('tenant-x', 'flag-y');
    const b = hashTenantFlag('tenant-z', 'flag-y');
    expect(a).not.toBe(b);
  });

  it('evaluates boolean flag', () => {
    const row: FeatureFlagRow = {
      id: 'r1', name: 'flag1', description: null, type: 'boolean',
      default_enabled: 1, rollout_percent: 0, tenant_allowlist: '[]',
      created_by: null, created_at: '', updated_at: '',
    };
    expect(evaluateFlagRow(row, 'anytenant')).toBe(true);
    expect(evaluateFlagRow({ ...row, default_enabled: 0 }, 'anytenant')).toBe(false);
  });

  it('evaluates tenant_allowlist', () => {
    const row: FeatureFlagRow = {
      id: 'r2', name: 'flag2', description: null, type: 'tenant_allowlist',
      default_enabled: 0, rollout_percent: 0, tenant_allowlist: JSON.stringify(['tenant-x', 'tenant-y']),
      created_by: null, created_at: '', updated_at: '',
    };
    expect(evaluateFlagRow(row, 'tenant-x')).toBe(true);
    expect(evaluateFlagRow(row, 'tenant-y')).toBe(true);
    expect(evaluateFlagRow(row, 'tenant-z')).toBe(false);
  });

  it('evaluates percent at boundaries', () => {
    const row: FeatureFlagRow = {
      id: 'r3', name: 'flag3', description: null, type: 'percent',
      default_enabled: 0, rollout_percent: 0, tenant_allowlist: '[]',
      created_by: null, created_at: '', updated_at: '',
    };
    expect(evaluateFlagRow({ ...row, rollout_percent: 0 }, 'tenant-x')).toBe(false);
    expect(evaluateFlagRow({ ...row, rollout_percent: 100 }, 'tenant-x')).toBe(true);
  });
});

describe('Feature Flags - GET /evaluate', () => {
  it('returns flag map for admin user', async () => {
    const { superToken, adminToken, tenantId } = await setupPlatform('eval1');
    await authed('/api/v1/admin/feature-flags', superToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'eval_bool_on', type: 'boolean', default_enabled: true }),
    });
    await authed('/api/v1/admin/feature-flags', superToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'eval_bool_off', type: 'boolean', default_enabled: false }),
    });

    const res = await authed('/api/v1/feature-flags/evaluate', adminToken);
    expect(res.status).toBe(200);
    const body = await res.json() as { flags: Record<string, boolean>; tenantId: string };
    expect(body.tenantId).toBe(tenantId);
    expect(body.flags.eval_bool_on).toBe(true);
    expect(body.flags.eval_bool_off).toBe(false);
  });

  it('allowlist resolves true for listed tenant, false for others', async () => {
    const { superToken, tenantId, altTenantId } = await setupPlatform('eval2');
    await authed('/api/v1/admin/feature-flags', superToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'eval_allowlist', type: 'tenant_allowlist', tenant_allowlist: [tenantId] }),
    });

    const hit = await authed(`/api/v1/feature-flags/evaluate?tenant_id=${tenantId}`, superToken);
    const hitBody = await hit.json() as { flags: Record<string, boolean> };
    expect(hitBody.flags.eval_allowlist).toBe(true);

    const miss = await authed(`/api/v1/feature-flags/evaluate?tenant_id=${altTenantId}`, superToken);
    const missBody = await miss.json() as { flags: Record<string, boolean>; tenantId: string };
    expect(missBody.tenantId).toBe(altTenantId);
    expect(missBody.flags.eval_allowlist).toBe(false);
  });

  it('requires authentication', async () => {
    await setupPlatform('eval3');
    const res = await SELF.fetch('http://localhost/api/v1/feature-flags/evaluate');
    expect(res.status).toBe(401);
  });
});
