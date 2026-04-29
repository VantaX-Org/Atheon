/**
 * Custom Role Builder test suite (v46-platform)
 * Covers CRUD, permission taxonomy endpoint, RBAC, inheritance, duplicate-name
 * rejection, and the delete-blocked-while-assigned path.
 *
 * Note: @cloudflare/vitest-pool-workers isolates D1 state per `it` block, so
 * every test seeds its own tenants/users.
 */
import { describe, it, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';

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

const PASSWORD = 'SecurePass1!';

async function setup(suffix: string): Promise<{ adminToken: string; analystToken: string; tenantId: string }> {
  const mig = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
    method: 'POST',
    headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
  });
  if (mig.status !== 200) throw new Error(`Migration failed: ${mig.status}`);

  const tenantId = `cr-tenant-${suffix}`;
  await seedTenant(tenantId, `cr-tenant-${suffix}`, 'CR Tenant');
  await seedUser(`cr-admin-${suffix}`, tenantId, `cr-admin-${suffix}@test.com`, PASSWORD, 'admin');
  await seedUser(`cr-analyst-${suffix}`, tenantId, `cr-analyst-${suffix}@test.com`, PASSWORD, 'analyst');

  const adminToken = await login(`cr-admin-${suffix}@test.com`, PASSWORD, `cr-tenant-${suffix}`);
  const analystToken = await login(`cr-analyst-${suffix}@test.com`, PASSWORD, `cr-tenant-${suffix}`);
  return { adminToken, analystToken, tenantId };
}

describe('Custom Roles - Permission taxonomy', () => {
  it('returns the permission list + base roles for admins', async () => {
    const { adminToken } = await setup('perm1');
    const res = await authed('/api/v1/iam/permissions', adminToken);
    expect(res.status).toBe(200);
    const body = await res.json() as { permissions: string[]; baseRoles: { id: string }[] };
    expect(body.permissions).toContain('apex.read');
    expect(body.permissions).toContain('admin.*');
    expect(body.baseRoles.map(b => b.id).sort()).toEqual(['admin', 'analyst', 'manager', 'operator']);
  });

  it('denies analysts from the taxonomy endpoint', async () => {
    const { analystToken } = await setup('perm2');
    const res = await authed('/api/v1/iam/permissions', analystToken);
    expect(res.status).toBe(403);
  });
});

describe('Custom Roles - CRUD', () => {
  it('denies analyst from listing custom roles', async () => {
    const { analystToken } = await setup('crud1');
    const res = await authed('/api/v1/iam/custom-roles', analystToken);
    expect(res.status).toBe(403);
  });

  it('returns an empty list initially', async () => {
    const { adminToken } = await setup('crud2');
    const res = await authed('/api/v1/iam/custom-roles', adminToken);
    expect(res.status).toBe(200);
    const body = await res.json() as { roles: unknown[]; total: number };
    expect(body.total).toBe(0);
  });

  it('creates a custom role with inheritance', async () => {
    const { adminToken } = await setup('crud3');
    const res = await authed('/api/v1/iam/custom-roles', adminToken, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Department Lead',
        description: 'Lead for a department',
        inherits_from: 'analyst',
        permissions: ['memory.write', 'iam.users.read'],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { role: { id: string; name: string; inheritsFrom: string; permissions: string[]; inheritedPermissions: string[] } };
    expect(body.role.name).toBe('Department Lead');
    expect(body.role.inheritsFrom).toBe('analyst');
    expect(body.role.permissions).toEqual(expect.arrayContaining(['memory.write', 'iam.users.read']));
    // analyst's BASE_ROLE_PERMISSIONS were trimmed to match the frontend
    // (STANDARD_ROLES exposes /pulse + /chat to analyst). The remaining
    // analyst permissions are pulse.read + mind.query.
    expect(body.role.inheritedPermissions).toContain('pulse.read');
    expect(body.role.inheritedPermissions).toContain('mind.query');
  });

  it('rejects duplicate names for the same tenant', async () => {
    const { adminToken } = await setup('crud4');
    const first = await authed('/api/v1/iam/custom-roles', adminToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'Department Lead', permissions: ['apex.read'] }),
    });
    expect(first.status).toBe(201);
    const second = await authed('/api/v1/iam/custom-roles', adminToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'Department Lead', permissions: ['apex.read'] }),
    });
    expect(second.status).toBe(409);
  });

  it('rejects unknown permissions', async () => {
    const { adminToken } = await setup('crud5');
    const res = await authed('/api/v1/iam/custom-roles', adminToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'Bogus', permissions: ['not.a.real.permission'] }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid inherits_from values', async () => {
    const { adminToken } = await setup('crud6');
    const res = await authed('/api/v1/iam/custom-roles', adminToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'Bogus2', inherits_from: 'superadmin', permissions: ['apex.read'] }),
    });
    expect(res.status).toBe(400);
  });

  it('updates permissions on an existing role', async () => {
    const { adminToken } = await setup('crud7');
    const createRes = await authed('/api/v1/iam/custom-roles', adminToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'To Update', permissions: ['apex.read'] }),
    });
    const id = (await createRes.json() as { role: { id: string } }).role.id;

    const res = await authed(`/api/v1/iam/custom-roles/${id}`, adminToken, {
      method: 'PUT',
      body: JSON.stringify({ permissions: ['apex.write', 'pulse.write'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { role: { permissions: string[] } };
    expect(body.role.permissions.sort()).toEqual(['apex.write', 'pulse.write']);
  });

  it('deletes a role with no assigned users', async () => {
    const { adminToken } = await setup('crud8');
    const createRes = await authed('/api/v1/iam/custom-roles', adminToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'To Delete', permissions: ['apex.read'] }),
    });
    const id = (await createRes.json() as { role: { id: string } }).role.id;

    const res = await authed(`/api/v1/iam/custom-roles/${id}`, adminToken, { method: 'DELETE' });
    expect(res.status).toBe(200);

    const again = await authed(`/api/v1/iam/custom-roles/${id}`, adminToken, { method: 'DELETE' });
    expect(again.status).toBe(404);
  });
});

describe('Custom Roles - Assignment integration', () => {
  it('rejects assigning a non-existent custom role', async () => {
    const { adminToken, tenantId } = await setup('asn1');
    const memberId = `cr-member-${Date.now()}`;
    await seedUser(memberId, tenantId, `member-${memberId}@test.com`, PASSWORD, 'analyst');

    const res = await authed(`/api/v1/iam/users/${memberId}`, adminToken, {
      method: 'PUT',
      body: JSON.stringify({ role: 'custom:does-not-exist' }),
    });
    expect(res.status).toBe(400);
  });

  it('assigns a valid custom role and updates user_count', async () => {
    const { adminToken, tenantId } = await setup('asn2');
    const memberId = `cr-member-${Date.now()}`;
    await seedUser(memberId, tenantId, `member-${memberId}@test.com`, PASSWORD, 'analyst');

    const createRes = await authed('/api/v1/iam/custom-roles', adminToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'Reviewer', permissions: ['apex.read'] }),
    });
    const roleId = (await createRes.json() as { role: { id: string } }).role.id;

    const assignRes = await authed(`/api/v1/iam/users/${memberId}`, adminToken, {
      method: 'PUT',
      body: JSON.stringify({ role: `custom:${roleId}` }),
    });
    expect(assignRes.status).toBe(200);

    const list = await authed('/api/v1/iam/custom-roles', adminToken);
    const listBody = await list.json() as { roles: { id: string; userCount: number }[] };
    const target = listBody.roles.find(r => r.id === roleId);
    expect(target?.userCount).toBe(1);
  });

  it('refuses to delete a role with assigned users (409)', async () => {
    const { adminToken, tenantId } = await setup('asn3');
    const memberId = `cr-member-${Date.now()}`;
    await seedUser(memberId, tenantId, `member-${memberId}@test.com`, PASSWORD, 'analyst');

    const createRes = await authed('/api/v1/iam/custom-roles', adminToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'Reviewer', permissions: ['apex.read'] }),
    });
    const roleId = (await createRes.json() as { role: { id: string } }).role.id;
    await authed(`/api/v1/iam/users/${memberId}`, adminToken, {
      method: 'PUT',
      body: JSON.stringify({ role: `custom:${roleId}` }),
    });

    const res = await authed(`/api/v1/iam/custom-roles/${roleId}`, adminToken, { method: 'DELETE' });
    expect(res.status).toBe(409);
  });

  it('allows delete after clearing assignments', async () => {
    const { adminToken, tenantId } = await setup('asn4');
    const memberId = `cr-member-${Date.now()}`;
    await seedUser(memberId, tenantId, `member-${memberId}@test.com`, PASSWORD, 'analyst');

    const createRes = await authed('/api/v1/iam/custom-roles', adminToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'Reviewer', permissions: ['apex.read'] }),
    });
    const roleId = (await createRes.json() as { role: { id: string } }).role.id;
    await authed(`/api/v1/iam/users/${memberId}`, adminToken, {
      method: 'PUT',
      body: JSON.stringify({ role: `custom:${roleId}` }),
    });

    // Reassign back to a built-in role
    await authed(`/api/v1/iam/users/${memberId}`, adminToken, {
      method: 'PUT',
      body: JSON.stringify({ role: 'analyst' }),
    });

    const res = await authed(`/api/v1/iam/custom-roles/${roleId}`, adminToken, { method: 'DELETE' });
    expect(res.status).toBe(200);
  });
});
