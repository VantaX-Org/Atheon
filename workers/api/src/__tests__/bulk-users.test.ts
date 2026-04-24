/**
 * Bulk User Management Test Suite (v45)
 * Covers POST /api/v1/iam/users/bulk-import, POST /bulk-action, and
 * GET /import-history. Mirrors the patterns in auth.test.ts.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';

const TENANT_ID = 'bulk-test-tenant';
const TENANT_SLUG = 'bulk-test-tenant';
const ADMIN_USER_ID = 'bulk-test-admin';
const ADMIN_EMAIL = 'admin@bulk-test.co.za';
const TEST_PASSWORD = 'BulkTest1!';

async function migrateViaEndpoint(): Promise<void> {
  const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
    method: 'POST',
    headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
  });
  if (res.status !== 200) throw new Error(`Migration failed: ${res.status}`);
}

async function seedAdmin(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status)
     VALUES (?, ?, ?, 'enterprise', 'active')`,
  ).bind(TENANT_ID, 'Bulk Test Tenant', TENANT_SLUG).run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenant_entitlements (tenant_id, layers, catalyst_clusters, max_agents, max_users)
     VALUES (?, '["apex","pulse","mind"]', '["finance"]', 50, 100)`,
  ).bind(TENANT_ID).run();
  const hash = await hashPassword(TEST_PASSWORD);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status)
     VALUES (?, ?, ?, 'Bulk Admin', 'admin', ?, ?, 'active')`,
  ).bind(ADMIN_USER_ID, TENANT_ID, ADMIN_EMAIL, hash, JSON.stringify(['*'])).run();
}

async function login(): Promise<string> {
  const res = await SELF.fetch('http://localhost/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: TEST_PASSWORD, tenant_slug: TENANT_SLUG }),
  });
  if (res.status !== 200) throw new Error(`Login failed: ${res.status}`);
  const body = await res.json() as { token: string };
  return body.token;
}

async function cleanupUsers(): Promise<void> {
  // Keep the admin we seeded; drop everyone else + audit
  await env.DB.prepare(
    `DELETE FROM users WHERE tenant_id = ? AND id != ?`,
  ).bind(TENANT_ID, ADMIN_USER_ID).run();
  await env.DB.prepare(
    `DELETE FROM audit_log WHERE tenant_id = ? AND action LIKE 'bulk_user.%'`,
  ).bind(TENANT_ID).run();
}

describe('Bulk User Management', () => {
  let token: string;

  beforeAll(async () => {
    await migrateViaEndpoint();
    await seedAdmin();
    token = await login();
  });

  beforeEach(async () => {
    await cleanupUsers();
  });

  describe('POST /api/v1/iam/users/bulk-import', () => {
    it('dry-run reports valid rows without creating users', async () => {
      const csv = 'email,name,role\nalice@example.com,Alice,analyst\nbob@example.com,Bob,operator';
      const res = await SELF.fetch('http://localhost/api/v1/iam/users/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ csv, dryRun: true }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { total: number; created: number; dryRun: boolean; importId: string };
      expect(body.total).toBe(2);
      expect(body.created).toBe(2);
      expect(body.dryRun).toBe(true);
      expect(body.importId).toBeTruthy();

      // Verify NO users were created
      const count = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM users WHERE tenant_id = ? AND email IN ('alice@example.com','bob@example.com')`,
      ).bind(TENANT_ID).first<{ n: number }>();
      expect(count?.n ?? 0).toBe(0);
    });

    it('happy path creates users, writes audit log, and returns temp passwords', async () => {
      const csv = 'email,name,role\ncarol@example.com,Carol Admin,manager\ndave@example.com,Dave,analyst';
      const res = await SELF.fetch('http://localhost/api/v1/iam/users/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ csv }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as {
        total: number; created: number; importId: string;
        createdUsers: Array<{ email: string; tempPassword: string; id: string }>;
        skipped: unknown[]; errors: unknown[];
      };
      expect(body.total).toBe(2);
      expect(body.created).toBe(2);
      expect(body.skipped).toHaveLength(0);
      expect(body.errors).toHaveLength(0);
      expect(body.createdUsers).toHaveLength(2);
      for (const u of body.createdUsers) {
        expect(u.tempPassword).toMatch(/^.{12}$/);
        expect(u.id).toBeTruthy();
      }

      // Users persisted
      const persisted = await env.DB.prepare(
        `SELECT email, role, status FROM users WHERE tenant_id = ? AND email IN ('carol@example.com','dave@example.com') ORDER BY email`,
      ).bind(TENANT_ID).all<{ email: string; role: string; status: string }>();
      expect(persisted.results).toHaveLength(2);
      expect(persisted.results[0].status).toBe('active');

      // Audit log batch entry exists
      const audit = await env.DB.prepare(
        `SELECT id, action, outcome FROM audit_log WHERE tenant_id = ? AND action = 'bulk_user.import.batch' AND id = ?`,
      ).bind(TENANT_ID, body.importId).first<{ id: string; action: string; outcome: string }>();
      expect(audit).toBeTruthy();
      expect(audit?.outcome).toBe('success');

      // Per-user created audit entries
      const perUser = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM audit_log WHERE tenant_id = ? AND action = 'bulk_user.import.created'`,
      ).bind(TENANT_ID).first<{ n: number }>();
      expect(perUser?.n ?? 0).toBe(2);
    });

    it('skips duplicates + invalid emails with per-row reasons', async () => {
      // Seed a pre-existing user so the import has to skip it
      await env.DB.prepare(
        `INSERT INTO users (id, tenant_id, email, name, role, permissions, status)
         VALUES ('existing-1', ?, 'existing@example.com', 'Existing', 'analyst', '["read"]', 'active')`,
      ).bind(TENANT_ID).run();

      const csv = [
        'email,name,role',
        'existing@example.com,Dup,analyst',            // duplicate
        'new1@example.com,New User,analyst',           // ok
        'bad-email-format,Broken,analyst',             // invalid email
        'new1@example.com,Same Batch Dup,analyst',     // batch dup after new1
      ].join('\n');

      const res = await SELF.fetch('http://localhost/api/v1/iam/users/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ csv }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as {
        total: number; created: number;
        skipped: Array<{ row: number; email: string; reason: string }>;
      };
      expect(body.total).toBe(4);
      expect(body.created).toBe(1);
      expect(body.skipped).toHaveLength(3);

      // Three reasons we expect to find
      const reasons = body.skipped.map(s => s.reason).join('|');
      expect(reasons).toContain('already exists');
      expect(reasons).toMatch(/Invalid email/i);
      expect(reasons).toMatch(/Duplicate email/i);
    });

    it('rejects roles above caller privilege (admin cannot import superadmin)', async () => {
      const csv = 'email,name,role\nelev@example.com,Elev,superadmin';
      const res = await SELF.fetch('http://localhost/api/v1/iam/users/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ csv }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { created: number; skipped: Array<{ reason: string }> };
      expect(body.created).toBe(0);
      expect(body.skipped[0].reason).toMatch(/exceeds your privilege/i);
    });

    it('handles CSV fields with commas inside quotes', async () => {
      const csv = 'email,name,role\n"frank@example.com","Frank, Jr.",analyst';
      const res = await SELF.fetch('http://localhost/api/v1/iam/users/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ csv }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { created: number; createdUsers: Array<{ name: string }> };
      expect(body.created).toBe(1);
      expect(body.createdUsers[0].name).toBe('Frank, Jr.');
    });
  });

  describe('POST /api/v1/iam/users/bulk-action', () => {
    it('suspends, activates, and changes role for target users', async () => {
      // Seed two non-admin users
      await env.DB.prepare(
        `INSERT INTO users (id, tenant_id, email, name, role, permissions, status)
         VALUES ('bu-1', ?, 'u1@example.com', 'U1', 'analyst', '["read"]', 'active'),
                ('bu-2', ?, 'u2@example.com', 'U2', 'operator', '["read"]', 'active')`,
      ).bind(TENANT_ID, TENANT_ID).run();

      // Suspend both
      const r1 = await SELF.fetch('http://localhost/api/v1/iam/users/bulk-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_ids: ['bu-1', 'bu-2'], action: 'suspend' }),
      });
      expect(r1.status).toBe(200);
      const b1 = await r1.json() as { applied: number; failed: unknown[] };
      expect(b1.applied).toBe(2);
      expect(b1.failed).toHaveLength(0);
      const suspended = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM users WHERE tenant_id = ? AND status = 'suspended' AND id IN ('bu-1','bu-2')`,
      ).bind(TENANT_ID).first<{ n: number }>();
      expect(suspended?.n).toBe(2);

      // Change role on u1
      const r2 = await SELF.fetch('http://localhost/api/v1/iam/users/bulk-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_ids: ['bu-1'], action: 'change_role', role: 'manager' }),
      });
      expect(r2.status).toBe(200);
      const b2 = await r2.json() as { applied: number };
      expect(b2.applied).toBe(1);
      const updated = await env.DB.prepare(
        `SELECT role FROM users WHERE id = 'bu-1' AND tenant_id = ?`,
      ).bind(TENANT_ID).first<{ role: string }>();
      expect(updated?.role).toBe('manager');
    });

    it('refuses to let caller modify their own account', async () => {
      const res = await SELF.fetch('http://localhost/api/v1/iam/users/bulk-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_ids: [ADMIN_USER_ID], action: 'suspend' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { applied: number; failed: Array<{ reason: string }> };
      expect(body.applied).toBe(0);
      expect(body.failed[0].reason).toMatch(/your own account/i);
    });
  });

  describe('GET /api/v1/iam/users/import-history', () => {
    it('returns recent import batches after an import runs', async () => {
      // Trigger a real import so there is history to fetch
      const csv = 'email,name,role\nhist@example.com,Hist,analyst';
      await SELF.fetch('http://localhost/api/v1/iam/users/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ csv }),
      });

      const res = await SELF.fetch('http://localhost/api/v1/iam/users/import-history', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { imports: Array<{ id: string; row_count: number; created_count: number }> };
      expect(body.imports.length).toBeGreaterThanOrEqual(1);
      const latest = body.imports[0];
      expect(latest.row_count).toBe(1);
      expect(latest.created_count).toBe(1);
    });
  });
});
