/**
 * Seal completed recoveries into the provenance chain.
 *
 * Covers:
 *  1. Completed actions with value get an `action.sealed` chain entry, in
 *     completed_at order (seq follows chronology, created_at = completed_at).
 *  2. Re-running is idempotent — no duplicate seals.
 *  3. Excluded: failed/skipped/deferred verification, zero/null value, and
 *     non-terminal statuses. The resulting chain still verifies intact.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { sealCompletedActions } from '../services/seal-completions';
import { verifyChain, listChain } from '../services/provenance-ledger';

const TENANT = 'seal-tenant';

async function migrate(): Promise<void> {
  const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
    method: 'POST',
    headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
  });
  if (res.status !== 200) throw new Error(`Migration failed: ${res.status}`);
}

async function seedAction(o: {
  id: string; status: string; valueZar: number | null;
  completedAt?: string | null; verification?: string | null;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO catalyst_actions
       (id, tenant_id, cluster_id, catalyst_name, action, action_type, status,
        value_zar, completed_at, verification_status, created_at)
     VALUES (?, ?, 'seal-cluster', ?, 'erp_post', 'erp_post', ?, ?, ?, ?, datetime('now'))`,
  ).bind(
    o.id, TENANT, `cat-${o.id}`, o.status, o.valueZar,
    o.completedAt ?? null, o.verification ?? null,
  ).run();
}

describe('sealCompletedActions', () => {
  beforeAll(migrate);
  beforeEach(async () => {
    await env.DB.prepare(`INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`)
      .bind(TENANT, TENANT, TENANT).run();
    await env.DB.prepare(`INSERT OR REPLACE INTO catalyst_clusters (id, tenant_id, name, domain) VALUES ('seal-cluster', ?, 'Seal', 'finance')`)
      .bind(TENANT).run();
    await env.DB.prepare(`DELETE FROM provenance_chain WHERE tenant_id = ?`).bind(TENANT).run();
    await env.DB.prepare(`DELETE FROM catalyst_actions WHERE tenant_id = ?`).bind(TENANT).run();
  });

  it('seals genuine completions once, in chronological order, and stays intact', async () => {
    await seedAction({ id: 'a2', status: 'completed', valueZar: 200, completedAt: '2026-07-02T00:00:00Z' });
    await seedAction({ id: 'a1', status: 'completed', valueZar: 100, completedAt: '2026-07-01T00:00:00Z' });
    await seedAction({ id: 'a3', status: 'verified', valueZar: 300, completedAt: '2026-07-03T00:00:00Z', verification: 'verified' });
    // Excluded:
    await seedAction({ id: 'x-failed', status: 'completed', valueZar: 999, completedAt: '2026-07-01T00:00:00Z', verification: 'failed' });
    await seedAction({ id: 'x-zero', status: 'completed', valueZar: 0, completedAt: '2026-07-01T00:00:00Z' });
    await seedAction({ id: 'x-pending', status: 'pending_approval', valueZar: 500, completedAt: null });

    const r1 = await sealCompletedActions(env, TENANT);
    expect(r1.sealed).toBe(3);

    const { entries } = await listChain(env, TENANT, { order: 'asc' });
    expect(entries.length).toBe(3);
    // Chronological: seq 1→a1, 2→a2, 3→a3; created_at back-stamped to completion.
    const ids = entries.map((e) => (JSON.parse(e.payload_json) as { action_id: string }).action_id);
    expect(ids).toEqual(['a1', 'a2', 'a3']);
    expect(entries[0].created_at).toBe('2026-07-01T00:00:00Z');

    // Idempotent second run — nothing new sealed.
    const r2 = await sealCompletedActions(env, TENANT);
    expect(r2.sealed).toBe(0);
    expect(r2.alreadySealed).toBe(3);
    expect((await listChain(env, TENANT, {})).total).toBe(3);

    const v = await verifyChain(env, TENANT);
    expect(v.valid).toBe(true);
    expect(v.total_entries).toBe(3);
  });
});
