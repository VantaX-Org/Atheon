/**
 * admin-ops verify-ops route suite.
 * SETUP_SECRET-gated deploy-tooling that drives the synthesis→billing chain.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT_ID = 'ao-tenant-1';
const SLUG = 'ao-verify';

async function ops(path: string, body: Record<string, unknown>, secret = SETUP_SECRET): Promise<Response> {
  return SELF.fetch(`http://localhost/api/v1/admin/verify-ops${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Setup-Secret': secret },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const mig = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
    method: 'POST',
    headers: { 'X-Setup-Secret': SETUP_SECRET },
  });
  if (mig.status !== 200) throw new Error(`Migration failed: ${mig.status}`);

  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, 'AO Verify', ?, 'enterprise', 'active')`
  ).bind(TENANT_ID, SLUG).run();
});

describe('admin-ops gate', () => {
  it('rejects a missing/wrong setup secret with 401', async () => {
    const resp = await ops('/run-phase10-chain', { tenant_slug: SLUG }, 'wrong');
    expect(resp.status).toBe(401);
  });

  it('rejects an unknown tenant_slug with 404', async () => {
    const resp = await ops('/run-phase10-chain', { tenant_slug: 'no-such-tenant' });
    expect(resp.status).toBe(404);
  });

  it('runs the phase-10 chain for a known tenant and returns a result', async () => {
    const resp = await ops('/run-phase10-chain', { tenant_slug: SLUG });
    expect(resp.status).toBe(200);
    const json = await resp.json() as { ok: boolean; chain_result: unknown };
    expect(json.ok).toBe(true);
    expect(json.chain_result).toBeTruthy();
  });
});
