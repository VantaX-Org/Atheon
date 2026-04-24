/**
 * System Alert Rules Test Suite (v45)
 * Covers GET/POST/PUT/DELETE /api/v1/system-alerts/rules
 * plus /silence and /test synthetic trigger endpoints.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';

const TENANT_ID = 'alerts-test-tenant';
const TENANT_SLUG = 'alerts-test-tenant';
const ADMIN_USER_ID = 'alerts-test-admin';
const ADMIN_EMAIL = 'admin@alerts-test.co.za';
const TEST_PASSWORD = 'AlertsTest1!';

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
  ).bind(TENANT_ID, 'Alerts Test Tenant', TENANT_SLUG).run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenant_entitlements (tenant_id, layers, catalyst_clusters, max_agents, max_users)
     VALUES (?, '["apex","pulse","mind"]', '["finance"]', 50, 100)`,
  ).bind(TENANT_ID).run();
  const hash = await hashPassword(TEST_PASSWORD);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status)
     VALUES (?, ?, ?, 'Alerts Admin', 'admin', ?, ?, 'active')`,
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

async function cleanupRules(): Promise<void> {
  await env.DB.prepare('DELETE FROM system_alert_rules WHERE tenant_id = ?').bind(TENANT_ID).run();
}

async function createRule(token: string, overrides: Partial<Record<string, unknown>> = {}): Promise<Record<string, unknown>> {
  const body = {
    name: 'Test Rule',
    description: 'Triggers on ERP sync failures',
    event_type: 'erp.sync.failed',
    condition: { field: 'severity', op: '>=', value: 'high' },
    severity: 'high',
    channels: ['email', 'webhook'],
    recipients: ['ops@example.com'],
    enabled: true,
    ...overrides,
  };
  const res = await SELF.fetch('http://localhost/api/v1/system-alerts/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (res.status !== 201) throw new Error(`Create rule failed: ${res.status} ${await res.text()}`);
  const parsed = await res.json() as { rule: Record<string, unknown> };
  return parsed.rule;
}

describe('System Alert Rules', () => {
  let token: string;

  beforeAll(async () => {
    await migrateViaEndpoint();
    await seedAdmin();
    token = await login();
  });

  beforeEach(async () => {
    await cleanupRules();
  });

  describe('CRUD lifecycle', () => {
    it('creates, lists, updates, and deletes a rule', async () => {
      // CREATE
      const rule = await createRule(token, { name: 'ERP Sync Failure Alert' });
      expect(rule.id).toBeTruthy();
      expect(rule.name).toBe('ERP Sync Failure Alert');
      expect(rule.enabled).toBe(true);
      expect((rule.channels as string[]).sort()).toEqual(['email', 'webhook']);
      expect((rule.condition as Record<string, unknown>).field).toBe('severity');

      // LIST
      const listRes = await SELF.fetch('http://localhost/api/v1/system-alerts/rules', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(listRes.status).toBe(200);
      const listBody = await listRes.json() as { rules: Array<Record<string, unknown>> };
      expect(listBody.rules).toHaveLength(1);
      expect(listBody.rules[0].id).toBe(rule.id);

      // UPDATE: flip enabled + change severity
      const updRes = await SELF.fetch(`http://localhost/api/v1/system-alerts/rules/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled: false, severity: 'critical' }),
      });
      expect(updRes.status).toBe(200);
      const updBody = await updRes.json() as { rule: { enabled: boolean; severity: string } };
      expect(updBody.rule.enabled).toBe(false);
      expect(updBody.rule.severity).toBe('critical');

      // DELETE
      const delRes = await SELF.fetch(`http://localhost/api/v1/system-alerts/rules/${rule.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(delRes.status).toBe(200);
      const delBody = await delRes.json() as { success: boolean };
      expect(delBody.success).toBe(true);

      // Confirm gone
      const listAgain = await SELF.fetch('http://localhost/api/v1/system-alerts/rules', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const b = await listAgain.json() as { rules: unknown[] };
      expect(b.rules).toHaveLength(0);
    });

    it('rejects create with invalid body', async () => {
      const res = await SELF.fetch('http://localhost/api/v1/system-alerts/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'no-condition', event_type: 'erp.sync.failed' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 updating/deleting missing rule', async () => {
      const missing = '00000000-0000-0000-0000-000000000000';
      const up = await SELF.fetch(`http://localhost/api/v1/system-alerts/rules/${missing}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled: false }),
      });
      expect(up.status).toBe(404);
      const del = await SELF.fetch(`http://localhost/api/v1/system-alerts/rules/${missing}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(del.status).toBe(404);
    });
  });

  describe('Silence', () => {
    it('sets silenced_until and can clear it', async () => {
      const rule = await createRule(token);
      const until = new Date(Date.now() + 3600_000).toISOString();

      const silRes = await SELF.fetch(`http://localhost/api/v1/system-alerts/rules/${rule.id}/silence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ until }),
      });
      expect(silRes.status).toBe(200);
      const silBody = await silRes.json() as { silenced_until: string };
      expect(silBody.silenced_until).toBe(until);

      // Rule should reflect silenced=true when queried
      const listRes = await SELF.fetch('http://localhost/api/v1/system-alerts/rules', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const listBody = await listRes.json() as { rules: Array<{ id: string; silenced: boolean; silenced_until: string | null }> };
      const found = listBody.rules.find(r => r.id === rule.id);
      expect(found?.silenced).toBe(true);
      expect(found?.silenced_until).toBe(until);

      // Clear silence
      const clearRes = await SELF.fetch(`http://localhost/api/v1/system-alerts/rules/${rule.id}/silence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ until: null }),
      });
      expect(clearRes.status).toBe(200);
      const clearBody = await clearRes.json() as { silenced_until: string | null };
      expect(clearBody.silenced_until).toBeNull();
    });

    it('rejects non-ISO timestamps', async () => {
      const rule = await createRule(token);
      const res = await SELF.fetch(`http://localhost/api/v1/system-alerts/rules/${rule.id}/silence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ until: 'not-a-date' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('Test (synthetic trigger)', () => {
    it('fires when the payload matches the condition', async () => {
      const rule = await createRule(token, {
        condition: { field: 'severity', op: '>=', value: 'high' },
      });
      const res = await SELF.fetch(`http://localhost/api/v1/system-alerts/rules/${rule.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ payload: { severity: 'critical', source: 'erp' } }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { would_fire: boolean; matched: boolean; enabled: boolean };
      expect(body.matched).toBe(true);
      expect(body.would_fire).toBe(true);
      expect(body.enabled).toBe(true);
    });

    it('does not fire when payload does not match', async () => {
      const rule = await createRule(token, {
        condition: { field: 'severity', op: '>=', value: 'high' },
      });
      const res = await SELF.fetch(`http://localhost/api/v1/system-alerts/rules/${rule.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ payload: { severity: 'low' } }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { matched: boolean; would_fire: boolean };
      expect(body.matched).toBe(false);
      expect(body.would_fire).toBe(false);
    });

    it('would_fire is false when the rule is silenced even if condition matches', async () => {
      const rule = await createRule(token, {
        condition: { field: 'count', op: '>', value: 0 },
      });
      const until = new Date(Date.now() + 3600_000).toISOString();
      await SELF.fetch(`http://localhost/api/v1/system-alerts/rules/${rule.id}/silence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ until }),
      });
      const res = await SELF.fetch(`http://localhost/api/v1/system-alerts/rules/${rule.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ payload: { count: 5 } }),
      });
      const body = await res.json() as { matched: boolean; would_fire: boolean; silenced: boolean };
      expect(body.matched).toBe(true);
      expect(body.silenced).toBe(true);
      expect(body.would_fire).toBe(false);
    });
  });
});
