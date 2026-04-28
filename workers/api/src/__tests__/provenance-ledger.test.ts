/**
 * Cryptographic Provenance Ledger — integration tests.
 *
 * Three properties to prove:
 *   1. Append: each entry chains off the previous, seq is monotonic per tenant
 *   2. Verify: a valid chain reports valid; tampering with payload OR root
 *      OR signature is detected at the first mismatch
 *   3. Multi-tenant isolation: tenant A's chain doesn't affect tenant B's
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  appendEvent,
  verifyChain,
  listChain,
  getCurrentRoot,
  _testExports,
} from '../services/provenance-ledger';

const TENANT_A = 'prov-tenant-a';
const TENANT_B = 'prov-tenant-b';

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
}

async function seedUser(userId: string, tenantId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, permissions, status)
     VALUES (?, ?, ?, ?, 'admin', '["*"]', 'active')`,
  ).bind(userId, tenantId, `${userId}@example.com`, userId).run();
}

describe('Provenance Ledger — primitives', () => {
  it('canonicalJson sorts keys deterministically', () => {
    const a = _testExports.canonicalJson({ b: 2, a: 1, c: { d: 4, e: 5 } });
    const b = _testExports.canonicalJson({ c: { e: 5, d: 4 }, a: 1, b: 2 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":1,"b":2,"c":{"d":4,"e":5}}');
  });

  it('sha256Hex is deterministic and produces 64-char hex', async () => {
    const h1 = await _testExports.sha256Hex('hello');
    const h2 = await _testExports.sha256Hex('hello');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('computeMerkleRoot composes parent || leaf', async () => {
    // Empty chain → leaf is the root
    const leaf = await _testExports.sha256Hex('first');
    expect(await _testExports.computeMerkleRoot(null, leaf)).toBe(leaf);
    // Non-empty → SHA-256(parent || leaf)
    const parent = await _testExports.sha256Hex('first');
    const next = await _testExports.sha256Hex('second');
    const expected = await _testExports.sha256Hex(parent + next);
    expect(await _testExports.computeMerkleRoot(parent, next)).toBe(expected);
  });
});

describe('Provenance Ledger — append + chain', () => {
  beforeAll(async () => { await migrate(); });
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM provenance_chain WHERE tenant_id IN (?, ?)`).bind(TENANT_A, TENANT_B).run();
    await seedTenant(TENANT_A);
    await seedTenant(TENANT_B);
  });

  it('first append: parent_id null, seq 1, root = leaf hash', async () => {
    const e = await appendEvent(env, TENANT_A, 'catalyst_run.completed', { run_id: 'r-1', value: 100 });
    expect(e.seq).toBe(1);
    expect(e.parent_id).toBeNull();
    expect(e.payload_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(e.merkle_root_after).toBe(e.payload_hash);
    expect(e.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('subsequent appends chain off the previous and increment seq', async () => {
    await seedUser('user-1', TENANT_A);
    const e1 = await appendEvent(env, TENANT_A, 'catalyst_run.completed', { run_id: 'r-1' });
    const e2 = await appendEvent(env, TENANT_A, 'hitl.approval', { item_id: 'i-1' }, { signedByUserId: 'user-1' });
    const e3 = await appendEvent(env, TENANT_A, 'simulation.created', { sim_id: 's-1' });
    expect(e2.seq).toBe(2);
    expect(e2.parent_id).toBe(e1.id);
    expect(e2.signed_by_user_id).toBe('user-1');
    expect(e3.seq).toBe(3);
    expect(e3.parent_id).toBe(e2.id);
    // Each subsequent root differs from its parent
    expect(e2.merkle_root_after).not.toBe(e1.merkle_root_after);
    expect(e3.merkle_root_after).not.toBe(e2.merkle_root_after);
  });

  it('multi-tenant isolation: tenant B sequences from 1 independently of A', async () => {
    await appendEvent(env, TENANT_A, 'catalyst_run.completed', { run_id: 'A1' });
    await appendEvent(env, TENANT_A, 'catalyst_run.completed', { run_id: 'A2' });
    const b1 = await appendEvent(env, TENANT_B, 'catalyst_run.completed', { run_id: 'B1' });
    expect(b1.seq).toBe(1);
    expect(b1.parent_id).toBeNull();
  });

  it('rejects payload over 64KB', async () => {
    const huge = { blob: 'x'.repeat(65 * 1024) };
    await expect(
      appendEvent(env, TENANT_A, 'catalyst_run.completed', huge),
    ).rejects.toThrow(/64 KB/);
  });
});

describe('Provenance Ledger — verifyChain', () => {
  beforeAll(async () => { await migrate(); });
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM provenance_chain WHERE tenant_id = ?`).bind(TENANT_A).run();
    await seedTenant(TENANT_A);
  });

  it('reports empty chain as valid', async () => {
    const res = await verifyChain(env, TENANT_A);
    expect(res.valid).toBe(true);
    expect(res.total_entries).toBe(0);
    expect(res.current_root).toBeNull();
  });

  it('reports a freshly-appended chain as valid', async () => {
    for (let i = 0; i < 5; i++) {
      await appendEvent(env, TENANT_A, 'catalyst_run.completed', { run_id: `r-${i}`, n: i });
    }
    const res = await verifyChain(env, TENANT_A);
    expect(res.valid).toBe(true);
    expect(res.total_entries).toBe(5);
    expect(res.first_invalid_seq).toBeNull();
    expect(res.current_root).not.toBeNull();
  });

  it('detects payload tampering (rewriting payload_json)', async () => {
    await appendEvent(env, TENANT_A, 'catalyst_run.completed', { run_id: 'r-1', value: 100 });
    await appendEvent(env, TENANT_A, 'catalyst_run.completed', { run_id: 'r-2', value: 200 });
    // Tamper with seq 1: rewrite the JSON
    await env.DB.prepare(
      `UPDATE provenance_chain SET payload_json = ? WHERE tenant_id = ? AND seq = 1`,
    ).bind('{"run_id":"r-1","value":99999}', TENANT_A).run();
    const res = await verifyChain(env, TENANT_A);
    expect(res.valid).toBe(false);
    expect(res.first_invalid_seq).toBe(1);
    expect(res.reason).toMatch(/tampered/);
  });

  it('detects merkle_root_after rewrite (without re-deriving the hash)', async () => {
    await appendEvent(env, TENANT_A, 'catalyst_run.completed', { run_id: 'r-1' });
    await appendEvent(env, TENANT_A, 'catalyst_run.completed', { run_id: 'r-2' });
    // Tamper with seq 2: rewrite the merkle root
    await env.DB.prepare(
      `UPDATE provenance_chain SET merkle_root_after = ? WHERE tenant_id = ? AND seq = 2`,
    ).bind('a'.repeat(64), TENANT_A).run();
    const res = await verifyChain(env, TENANT_A);
    expect(res.valid).toBe(false);
    expect(res.first_invalid_seq).toBe(2);
  });

  it('detects forged signature (tamper with signature column)', async () => {
    await appendEvent(env, TENANT_A, 'catalyst_run.completed', { run_id: 'r-1' });
    await env.DB.prepare(
      `UPDATE provenance_chain SET signature = ? WHERE tenant_id = ? AND seq = 1`,
    ).bind('b'.repeat(64), TENANT_A).run();
    const res = await verifyChain(env, TENANT_A);
    expect(res.valid).toBe(false);
    expect(res.first_invalid_seq).toBe(1);
    expect(res.reason).toMatch(/signature/);
  });
});

describe('Provenance Ledger — read helpers', () => {
  beforeAll(async () => { await migrate(); });
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM provenance_chain WHERE tenant_id = ?`).bind(TENANT_A).run();
    await seedTenant(TENANT_A);
  });

  it('listChain returns most-recent-first by default', async () => {
    for (let i = 0; i < 3; i++) {
      await appendEvent(env, TENANT_A, 'catalyst_run.completed', { run_id: `r-${i}` });
    }
    const result = await listChain(env, TENANT_A, {});
    expect(result.total).toBe(3);
    expect(result.entries[0].seq).toBe(3);
    expect(result.entries[2].seq).toBe(1);
  });

  it('listChain respects type filter', async () => {
    await appendEvent(env, TENANT_A, 'catalyst_run.completed', { run_id: 'r-1' });
    await appendEvent(env, TENANT_A, 'hitl.approval', { item_id: 'i-1' });
    await appendEvent(env, TENANT_A, 'catalyst_run.completed', { run_id: 'r-2' });
    const result = await listChain(env, TENANT_A, { payloadType: 'hitl.approval' });
    expect(result.total).toBe(1);
    expect(result.entries[0].payload_type).toBe('hitl.approval');
  });

  it('getCurrentRoot returns the latest merkle root + seq', async () => {
    await appendEvent(env, TENANT_A, 'catalyst_run.completed', { run_id: 'r-1' });
    const e2 = await appendEvent(env, TENANT_A, 'catalyst_run.completed', { run_id: 'r-2' });
    const root = await getCurrentRoot(env, TENANT_A);
    expect(root.seq).toBe(2);
    expect(root.root).toBe(e2.merkle_root_after);
  });

  it('getCurrentRoot returns null root for empty chain', async () => {
    const root = await getCurrentRoot(env, TENANT_A);
    expect(root.root).toBeNull();
    expect(root.seq).toBe(0);
  });
});
