/**
 * License Enforcement — integration tests.
 *
 * Two surfaces:
 *   1. Cloud-side `GET /api/agent/license-check?key=...` — returns the
 *      validity verdict for a given licence key against managed_deployments.
 *   2. Customer-side `licenseEnforcement()` middleware — phones home,
 *      caches result, gates data-plane traffic. Tested by unit-testing
 *      the helper functions; the full middleware path needs an outbound
 *      HTTP fetch which the worker test pool can't easily mock.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const TENANT_ID = 'license-tenant';

async function migrate(): Promise<void> {
  const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
    method: 'POST',
    headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
  });
  if (res.status !== 200) throw new Error(`Migration failed: ${res.status}`);
}

async function seedDeployment(args: {
  id: string;
  status: string;
  licenceKey: string;
  expiresAt: string | null;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`,
  ).bind(TENANT_ID, 'License Tenant', TENANT_ID).run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO managed_deployments (id, tenant_id, name, deployment_type, status, licence_key, licence_expires_at)
     VALUES (?, ?, 'Test Deployment', 'hybrid', ?, ?, ?)`,
  ).bind(args.id, TENANT_ID, args.status, args.licenceKey, args.expiresAt).run();
}

describe('License Enforcement — cloud-side license-check endpoint', () => {
  beforeAll(async () => { await migrate(); });

  beforeEach(async () => {
    // Clean prior fixtures so each test starts clean.
    await env.DB.prepare(`DELETE FROM managed_deployments WHERE tenant_id = ?`).bind(TENANT_ID).run();
  });

  it('returns valid: true for an active licence with no expiry', async () => {
    await seedDeployment({ id: 'dep-1', status: 'active', licenceKey: 'KEY-ACTIVE-1', expiresAt: null });
    const res = await SELF.fetch('http://localhost/api/agent/license-check?key=KEY-ACTIVE-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { valid: boolean; status: string; expires_at: string | null; reason: string };
    expect(body.valid).toBe(true);
    expect(body.status).toBe('active');
  });

  it('returns valid: false / status revoked for a suspended licence', async () => {
    await seedDeployment({ id: 'dep-2', status: 'suspended', licenceKey: 'KEY-SUSP-1', expiresAt: null });
    const res = await SELF.fetch('http://localhost/api/agent/license-check?key=KEY-SUSP-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { valid: boolean; status: string; reason: string };
    expect(body.valid).toBe(false);
    expect(body.status).toBe('revoked');
    expect(body.reason).toMatch(/suspended/i);
  });

  it('returns valid: false / status expired for a past expiry', async () => {
    await seedDeployment({
      id: 'dep-3', status: 'active', licenceKey: 'KEY-EXP-1',
      expiresAt: '2024-01-01T00:00:00.000Z',
    });
    const res = await SELF.fetch('http://localhost/api/agent/license-check?key=KEY-EXP-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { valid: boolean; status: string; reason: string };
    expect(body.valid).toBe(false);
    expect(body.status).toBe('expired');
    expect(body.reason).toMatch(/expired/i);
  });

  it('returns valid: false / status unknown for an unrecognised licence', async () => {
    const res = await SELF.fetch('http://localhost/api/agent/license-check?key=KEY-DOES-NOT-EXIST');
    expect(res.status).toBe(200);
    const body = await res.json() as { valid: boolean; status: string; reason: string };
    expect(body.valid).toBe(false);
    expect(body.status).toBe('unknown');
    expect(body.reason).toMatch(/no deployment found/i);
  });

  it('returns valid: false on missing key query param', async () => {
    const res = await SELF.fetch('http://localhost/api/agent/license-check');
    expect(res.status).toBe(200);
    const body = await res.json() as { valid: boolean; status: string; reason: string };
    expect(body.valid).toBe(false);
    expect(body.reason).toMatch(/without \?key=/i);
  });
});

describe('License Enforcement — middleware no-ops on cloud deployment', () => {
  beforeAll(async () => { await migrate(); });

  it('license-status endpoint returns "active" for cloud deployments', async () => {
    const res = await SELF.fetch('http://localhost/api/v1/license-status');
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; valid: boolean; reason: string };
    expect(body.status).toBe('active');
    expect(body.valid).toBe(true);
    expect(body.reason).toMatch(/cloud instance/i);
  });

  it('license-status/refresh refuses on cloud (returns error)', async () => {
    const res = await SELF.fetch('http://localhost/api/v1/license-status/refresh', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { error?: string };
    expect(body.error).toMatch(/customer deployments/i);
  });
});
