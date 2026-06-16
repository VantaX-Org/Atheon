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

describe('resolve-rca', () => {
  const RCA_ID = 'ao-rca-resolve-1';
  beforeAll(async () => {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO root_cause_analyses
         (id, tenant_id, metric_id, metric_name, trigger_status, causal_chain, confidence, status, generated_at)
       VALUES (?, ?, 'm1', 'Test Metric', 'red', '[]', 88, 'active', datetime('now'))`
    ).bind(RCA_ID, TENANT_ID).run();
  });

  it('marks an active RCA resolved', async () => {
    const resp = await ops('/resolve-rca', { tenant_slug: SLUG, rca_id: RCA_ID });
    expect(resp.status).toBe(200);
    const json = await resp.json() as { ok: boolean; resolved: boolean };
    expect(json.resolved).toBe(true);
    const row = await env.DB.prepare('SELECT status, resolved_at FROM root_cause_analyses WHERE id = ?')
      .bind(RCA_ID).first<{ status: string; resolved_at: string | null }>();
    expect(row?.status).toBe('resolved');
    expect(row?.resolved_at).toBeTruthy();
  });

  it('returns resolved=false for an rca_id that does not belong to the tenant', async () => {
    const resp = await ops('/resolve-rca', { tenant_slug: SLUG, rca_id: 'nonexistent' });
    expect(resp.status).toBe(200);
    const json = await resp.json() as { resolved: boolean };
    expect(json.resolved).toBe(false);
  });
});

describe('create-completed-action', () => {
  const RCA_ID = 'ao-rca-action-1';
  beforeAll(async () => {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO root_cause_analyses
         (id, tenant_id, metric_id, metric_name, trigger_status, causal_chain, confidence, status, generated_at)
       VALUES (?, ?, 'm2', 'Action Metric', 'red', '[]', 82, 'resolved', datetime('now'))`
    ).bind(RCA_ID, TENANT_ID).run();
  });

  it('creates a prescription-linked completed action with no verification status', async () => {
    const resp = await ops('/create-completed-action', { tenant_slug: SLUG, rca_id: RCA_ID });
    expect(resp.status).toBe(200);
    const json = await resp.json() as { ok: boolean; action_id: string; prescription_id: string };
    expect(json.action_id).toBeTruthy();
    expect(json.prescription_id).toBeTruthy();

    const action = await env.DB.prepare(
      'SELECT status, verification_status, source_finding_id, output_data FROM catalyst_actions WHERE id = ?'
    ).bind(json.action_id).first<{ status: string; verification_status: string | null; source_finding_id: string; output_data: string }>();
    expect(action?.status).toBe('completed');
    expect(action?.verification_status).toBeNull();
    expect(action?.source_finding_id).toBe(json.prescription_id);
    const out = JSON.parse(action!.output_data) as { mode?: string };
    expect(out.mode).not.toBe('stub');

    const presc = await env.DB.prepare('SELECT rca_id FROM diagnostic_prescriptions WHERE id = ?')
      .bind(json.prescription_id).first<{ rca_id: string }>();
    expect(presc?.rca_id).toBe(RCA_ID);
  });

  it('returns 404 when the rca_id does not belong to the tenant', async () => {
    const resp = await ops('/create-completed-action', { tenant_slug: SLUG, rca_id: 'nope' });
    expect(resp.status).toBe(404);
  });
});
