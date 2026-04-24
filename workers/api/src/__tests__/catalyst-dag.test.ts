/**
 * Catalyst DAG tests: downstream triggering, cycle detection, depth cap,
 * and manual CRUD endpoints. Unit-tests the pure logic via triggerDownstream/
 * wouldCreateCycle directly, with D1 as the only I/O dependency.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';
import { triggerDownstream, wouldCreateCycle, MAX_CHAIN_DEPTH } from '../services/catalyst-dag';
import type { CatalystQueueMessage } from '../services/scheduled';

const TENANT = 'dag-test-tenant';
const ADMIN_ID = 'dag-admin';
const ADMIN_EMAIL = 'dag-admin@test.com';
const PASSWORD = 'SecurePass1!';

async function run(sql: string, ...binds: unknown[]): Promise<void> {
  await env.DB.prepare(sql).bind(...binds).run();
}

async function login(): Promise<string> {
  const res = await SELF.fetch('http://localhost/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: PASSWORD, tenant_slug: 'dag-test' }),
  });
  const body = await res.json() as { token?: string };
  if (!body.token) throw new Error(`Login failed: ${res.status}`);
  return body.token;
}

/** Minimal fake queue that records sent messages. */
function fakeQueue(): { sent: CatalystQueueMessage[]; queue: Queue<CatalystQueueMessage> } {
  const sent: CatalystQueueMessage[] = [];
  const queue = {
    send: async (msg: CatalystQueueMessage): Promise<void> => { sent.push(msg); },
    sendBatch: async (): Promise<void> => { /* unused */ },
  } as unknown as Queue<CatalystQueueMessage>;
  return { sent, queue };
}

async function clearDependencies(): Promise<void> {
  await run('DELETE FROM catalyst_dependencies WHERE tenant_id = ?', TENANT);
}

async function addDep(
  upstreamCluster: string, upstreamSub: string,
  downstreamCluster: string, downstreamSub: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await run(
    `INSERT INTO catalyst_dependencies (
       id, tenant_id,
       upstream_cluster_id, upstream_sub_name,
       downstream_cluster_id, downstream_sub_name,
       source_cluster_id, source_sub_catalyst,
       target_cluster_id, target_sub_catalyst,
       dependency_type, strength, lag_hours, description
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'data_flow', 50, 0, NULL)`,
    id, TENANT,
    upstreamCluster, upstreamSub,
    downstreamCluster, downstreamSub,
    upstreamCluster, upstreamSub,
    downstreamCluster, downstreamSub,
  );
  return id;
}

async function addCluster(id: string, name: string): Promise<void> {
  await run(
    `INSERT OR REPLACE INTO catalyst_clusters (id, tenant_id, name, domain, description, autonomy_tier, status, sub_catalysts)
     VALUES (?, ?, ?, 'test', 'Test cluster', 'read-only', 'active', '[]')`,
    id, TENANT, name,
  );
}

describe('Catalyst DAG', () => {
  beforeAll(async () => {
    const migRes = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST',
      headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
    });
    if (migRes.status !== 200) throw new Error(`Migration failed: ${migRes.status}`);

    await run(
      `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`,
      TENANT, 'DAG Test Corp', 'dag-test',
    );
    await run(
      `INSERT OR REPLACE INTO tenant_entitlements (tenant_id, layers, catalyst_clusters, max_agents, max_users)
       VALUES (?, '["apex","pulse"]', '["finance"]', 50, 100)`,
      TENANT,
    );
    const hash = await hashPassword(PASSWORD);
    await run(
      `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status)
       VALUES (?, ?, ?, 'Admin', 'admin', ?, '["*"]', 'active')`,
      ADMIN_ID, TENANT, ADMIN_EMAIL, hash,
    );

    // Three clusters we will chain: A -> B -> C
    await addCluster('dag-cluster-a', 'Cluster A');
    await addCluster('dag-cluster-b', 'Cluster B');
    await addCluster('dag-cluster-c', 'Cluster C');
  });

  beforeEach(async () => {
    await clearDependencies();
  });

  // ── triggerDownstream ──────────────────────────────

  it('enqueues downstream when a dependency exists', async () => {
    await addDep('dag-cluster-a', 'sub-a1', 'dag-cluster-b', 'sub-b1');
    const { sent, queue } = fakeQueue();
    const result = await triggerDownstream({
      tenantId: TENANT,
      upstreamClusterId: 'dag-cluster-a',
      upstreamSubCatalystName: 'sub-a1',
      chainDepth: 0,
    }, env.DB, queue);
    expect(result.enqueued).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('catalyst_execution');
    expect(sent[0].tenantId).toBe(TENANT);
    const payload = sent[0].payload as Record<string, unknown>;
    expect(payload.clusterId).toBe('dag-cluster-b');
    expect(payload.catalystName).toBe('sub-b1');
    const inputData = payload.inputData as Record<string, unknown>;
    expect(inputData.triggeredBy).toBe('dag');
    expect(inputData.chainDepth).toBe(1);
    expect(inputData.upstreamClusterId).toBe('dag-cluster-a');
  });

  it('enqueues multiple downstream deps in one call', async () => {
    await addDep('dag-cluster-a', 'sub-a1', 'dag-cluster-b', 'sub-b1');
    await addDep('dag-cluster-a', 'sub-a1', 'dag-cluster-c', 'sub-c1');
    const { sent, queue } = fakeQueue();
    const result = await triggerDownstream({
      tenantId: TENANT,
      upstreamClusterId: 'dag-cluster-a',
      upstreamSubCatalystName: 'sub-a1',
      chainDepth: 0,
    }, env.DB, queue);
    expect(result.enqueued).toBe(2);
    expect(sent).toHaveLength(2);
  });

  it('refuses to enqueue once chainDepth hits MAX_CHAIN_DEPTH', async () => {
    await addDep('dag-cluster-a', 'sub-a1', 'dag-cluster-b', 'sub-b1');
    const { sent, queue } = fakeQueue();
    const result = await triggerDownstream({
      tenantId: TENANT,
      upstreamClusterId: 'dag-cluster-a',
      upstreamSubCatalystName: 'sub-a1',
      chainDepth: MAX_CHAIN_DEPTH,
    }, env.DB, queue);
    expect(result.enqueued).toBe(0);
    expect(result.reason).toBe('max_chain_depth_reached');
    expect(sent).toHaveLength(0);

    const audit = await env.DB.prepare(
      `SELECT action FROM audit_log WHERE tenant_id = ? AND action = 'catalyst.dag.trigger_blocked' ORDER BY created_at DESC LIMIT 1`,
    ).bind(TENANT).first<{ action: string }>();
    expect(audit?.action).toBe('catalyst.dag.trigger_blocked');
  });

  it('skips self-referencing edges even if configured', async () => {
    // Manually insert a self-loop (the CRUD endpoint would reject this at
    // creation time; we force one in here to prove runtime protection).
    await addDep('dag-cluster-a', 'sub-a1', 'dag-cluster-a', 'sub-a1');
    const { sent, queue } = fakeQueue();
    const result = await triggerDownstream({
      tenantId: TENANT,
      upstreamClusterId: 'dag-cluster-a',
      upstreamSubCatalystName: 'sub-a1',
      chainDepth: 0,
    }, env.DB, queue);
    expect(result.enqueued).toBe(0);
    expect(result.skipped).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it('no-op when there are no downstream deps', async () => {
    const { sent, queue } = fakeQueue();
    const result = await triggerDownstream({
      tenantId: TENANT,
      upstreamClusterId: 'dag-cluster-a',
      upstreamSubCatalystName: 'sub-a1',
      chainDepth: 0,
    }, env.DB, queue);
    expect(result.enqueued).toBe(0);
    expect(result.skipped).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('logs intent and returns when no queue binding is provided', async () => {
    await addDep('dag-cluster-a', 'sub-a1', 'dag-cluster-b', 'sub-b1');
    const result = await triggerDownstream({
      tenantId: TENANT,
      upstreamClusterId: 'dag-cluster-a',
      upstreamSubCatalystName: 'sub-a1',
      chainDepth: 0,
    }, env.DB, undefined);
    expect(result.enqueued).toBe(0);
    expect(result.skipped).toBe(1);
    const audit = await env.DB.prepare(
      `SELECT action FROM audit_log WHERE tenant_id = ? AND action = 'catalyst.dag.trigger_no_queue' ORDER BY created_at DESC LIMIT 1`,
    ).bind(TENANT).first<{ action: string }>();
    expect(audit?.action).toBe('catalyst.dag.trigger_no_queue');
  });

  // ── wouldCreateCycle ───────────────────────────────

  describe('wouldCreateCycle', () => {
    it('detects direct self-loop', async () => {
      const cycle = await wouldCreateCycle(TENANT, 'dag-cluster-a', 'sub-a1', 'dag-cluster-a', 'sub-a1', env.DB);
      expect(cycle).toBe(true);
    });

    it('detects a 2-hop cycle (A->B would close existing B->A)', async () => {
      await addDep('dag-cluster-b', 'sub-b1', 'dag-cluster-a', 'sub-a1');
      const cycle = await wouldCreateCycle(TENANT, 'dag-cluster-a', 'sub-a1', 'dag-cluster-b', 'sub-b1', env.DB);
      expect(cycle).toBe(true);
    });

    it('detects a 3-hop cycle (A->B when C->A and B->C exist)', async () => {
      await addDep('dag-cluster-c', 'sub-c1', 'dag-cluster-a', 'sub-a1');
      await addDep('dag-cluster-b', 'sub-b1', 'dag-cluster-c', 'sub-c1');
      const cycle = await wouldCreateCycle(TENANT, 'dag-cluster-a', 'sub-a1', 'dag-cluster-b', 'sub-b1', env.DB);
      expect(cycle).toBe(true);
    });

    it('returns false for a clean new edge', async () => {
      const cycle = await wouldCreateCycle(TENANT, 'dag-cluster-a', 'sub-a1', 'dag-cluster-b', 'sub-b1', env.DB);
      expect(cycle).toBe(false);
    });
  });

  // ── CRUD endpoints ─────────────────────────────────

  describe('Dependency CRUD endpoints', () => {
    let token: string;

    beforeAll(async () => {
      token = await login();
    });

    it('POST /dependencies creates a dependency', async () => {
      await clearDependencies();
      const res = await SELF.fetch('http://localhost/api/v1/catalyst-intelligence/dependencies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          upstream_cluster_id: 'dag-cluster-a', upstream_sub_name: 'sub-a1',
          downstream_cluster_id: 'dag-cluster-b', downstream_sub_name: 'sub-b1',
          dependency_type: 'triggers', strength: 80,
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json() as { id: string; upstreamClusterId: string };
      expect(body.id).toBeTruthy();
      expect(body.upstreamClusterId).toBe('dag-cluster-a');
    });

    it('POST /dependencies rejects 400 when required fields are missing', async () => {
      await clearDependencies();
      const res = await SELF.fetch('http://localhost/api/v1/catalyst-intelligence/dependencies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ upstream_cluster_id: 'dag-cluster-a' }),
      });
      expect(res.status).toBe(400);
    });

    it('POST /dependencies rejects cycle with 409', async () => {
      await clearDependencies();
      // Pre-seed B -> A. New A -> B would close the cycle.
      await addDep('dag-cluster-b', 'sub-b1', 'dag-cluster-a', 'sub-a1');

      const res = await SELF.fetch('http://localhost/api/v1/catalyst-intelligence/dependencies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          upstream_cluster_id: 'dag-cluster-a', upstream_sub_name: 'sub-a1',
          downstream_cluster_id: 'dag-cluster-b', downstream_sub_name: 'sub-b1',
        }),
      });
      expect(res.status).toBe(409);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/cycle/i);
    });

    it('POST /dependencies rejects 404 when cluster is not in tenant', async () => {
      await clearDependencies();
      const res = await SELF.fetch('http://localhost/api/v1/catalyst-intelligence/dependencies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          upstream_cluster_id: 'does-not-exist', upstream_sub_name: 'sub-x',
          downstream_cluster_id: 'dag-cluster-b', downstream_sub_name: 'sub-b1',
        }),
      });
      expect(res.status).toBe(404);
    });

    it('DELETE /dependencies/:id removes the dependency', async () => {
      await clearDependencies();
      const depId = await addDep('dag-cluster-a', 'sub-a1', 'dag-cluster-b', 'sub-b1');

      const res = await SELF.fetch(`http://localhost/api/v1/catalyst-intelligence/dependencies/${depId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);

      const after = await env.DB.prepare(
        'SELECT id FROM catalyst_dependencies WHERE id = ? AND tenant_id = ?',
      ).bind(depId, TENANT).first();
      expect(after).toBeNull();
    });

    it('DELETE /dependencies/:id returns 404 for unknown id', async () => {
      const res = await SELF.fetch('http://localhost/api/v1/catalyst-intelligence/dependencies/does-not-exist', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(404);
    });
  });
});
