/**
 * Catalyst Run Narrative Tests
 *
 * Covers the deterministic error paths and the KV cache hit of the narrative
 * service. The LLM call itself is exercised in integration / production — we
 * do not stub `llmChatWithFallback` here because the service already uses the
 * shared budget + redaction machinery that is covered by llm-budget.test.ts
 * and pii-redaction.test.ts respectively.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  generateRunNarrative,
  narrativeCacheKey,
  NarrativeError,
} from '../services/catalyst-narrative';

const TENANT_ID = 'narr-tenant';
const CLUSTER_ID = 'narr-cluster-1';
const FINISHED_RUN_ID = 'narr-run-finished';
const RUNNING_RUN_ID = 'narr-run-running';

async function migrateViaEndpoint(): Promise<void> {
  const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
    method: 'POST',
    headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
  });
  if (res.status !== 200) throw new Error(`Migration endpoint returned ${res.status}`);
}

async function seedCluster(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`,
  ).bind(TENANT_ID, 'Narrative Tenant', TENANT_ID).run();

  // catalyst_clusters schema varies — only id + tenant_id + name + domain are
  // referenced by the narrative prompt, so bind just those with conservative
  // defaults on everything else via IGNORE.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO catalyst_clusters (id, tenant_id, name, domain) VALUES (?, ?, ?, ?)`,
  ).bind(CLUSTER_ID, TENANT_ID, 'Finance Reconciliation', 'finance').run();
}

async function seedRun(id: string, status: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO sub_catalyst_runs
       (id, tenant_id, cluster_id, sub_catalyst_name, run_number, status,
        matched, unmatched_source, unmatched_target, discrepancies, exceptions_raised,
        avg_confidence, total_source_value, total_discrepancy_value, total_exception_value,
        currency, started_at, completed_at, duration_ms, reasoning, recommendations, result_data)
     VALUES (?, ?, ?, 'GL-Bank Reconciliation', 1, ?,
             120, 3, 2, 4, 1,
             0.97, 1250000, 34500, 7800,
             'ZAR', datetime('now'), datetime('now'), 1532,
             'Four GL entries did not match the bank feed within tolerance.',
             '[{"action":"escalate","target":"finance-lead"}]',
             '{"top_discrepancy":{"gl_ref":"JE-4821","amount":34500}}')`,
  ).bind(id, TENANT_ID, CLUSTER_ID, status).run();
}

describe('Catalyst Run Narrative', () => {
  beforeAll(async () => {
    await migrateViaEndpoint();
    await seedCluster();
    await seedRun(FINISHED_RUN_ID, 'completed');
    await seedRun(RUNNING_RUN_ID, 'running');
  });

  beforeEach(async () => {
    // Purge cache between tests so each run decides its own cache hit/miss.
    await env.CACHE.delete(narrativeCacheKey(FINISHED_RUN_ID));
    await env.CACHE.delete(narrativeCacheKey(RUNNING_RUN_ID));
  });

  it('throws not_found when the run does not exist for this tenant', async () => {
    await expect(
      generateRunNarrative(env.DB, env as unknown as { AI: Ai; CACHE: KVNamespace }, 'missing-run', TENANT_ID),
    ).rejects.toMatchObject({ name: 'NarrativeError', code: 'not_found' });
  });

  it('throws not_found when the run belongs to a different tenant', async () => {
    await expect(
      generateRunNarrative(env.DB, env as unknown as { AI: Ai; CACHE: KVNamespace }, FINISHED_RUN_ID, 'some-other-tenant'),
    ).rejects.toMatchObject({ name: 'NarrativeError', code: 'not_found' });
  });

  it('throws not_finished when the run is still running', async () => {
    try {
      await generateRunNarrative(env.DB, env as unknown as { AI: Ai; CACHE: KVNamespace }, RUNNING_RUN_ID, TENANT_ID);
      expect.fail('expected NarrativeError');
    } catch (err) {
      expect(err).toBeInstanceOf(NarrativeError);
      expect((err as NarrativeError).code).toBe('not_finished');
      expect((err as NarrativeError).details?.status).toBe('running');
    }
  });

  it('returns the cached narrative without calling the LLM when KV already has an entry', async () => {
    const cached = {
      narrative: 'Four GL entries missed bank reconciliation; escalate to the finance lead.',
      tokens_in: 400,
      tokens_out: 35,
      cost_usd: 0.0002175,
    };
    await env.CACHE.put(narrativeCacheKey(FINISHED_RUN_ID), JSON.stringify(cached), { expirationTtl: 3600 });

    const result = await generateRunNarrative(
      env.DB,
      env as unknown as { AI: Ai; CACHE: KVNamespace },
      FINISHED_RUN_ID,
      TENANT_ID,
    );

    expect(result.cached).toBe(true);
    expect(result.narrative).toBe(cached.narrative);
    expect(result.tokens_in).toBe(400);
    expect(result.tokens_out).toBe(35);
    expect(result.cost_usd).toBeCloseTo(0.0002175);
  });

  it('tolerates a corrupt cache entry and does not throw before attempting regeneration', async () => {
    // A bad cache value must not poison the response path — the code falls
    // through to the LLM call (which will fail in the test env, surfacing as
    // llm_failed). Asserting llm_failed — not a JSON parse crash — proves the
    // fallthrough path works.
    await env.CACHE.put(narrativeCacheKey(FINISHED_RUN_ID), 'not valid json {{', { expirationTtl: 60 });

    await expect(
      generateRunNarrative(env.DB, env as unknown as { AI: Ai; CACHE: KVNamespace }, FINISHED_RUN_ID, TENANT_ID),
    ).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof NarrativeError)) return false;
      return err.code === 'llm_failed' || err.code === 'budget_exhausted';
    });
  });
});
