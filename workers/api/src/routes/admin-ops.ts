/**
 * Verify-ops routes — SETUP_SECRET deploy-tooling for the verify harness.
 *
 * These drive the live synthesis→billing chain for a NAMED tenant so the
 * verification matrices can assert runtime synthesis traceability (A1) and
 * the billing ERP-anchor boundary (A2). They call the SAME runtime functions
 * the cron/app call — they do not fabricate billable state.
 *
 * Auth: X-Setup-Secret shared secret only (same gate as /admin/migrate and
 * demo-seed). Intentionally NOT behind tenant auth — deploy-time tooling.
 * Never weakens the user-facing MFA control.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, AppBindings } from '../types';
import { runPhase10ChainForTenant } from '../services/phase-10-analytics-runner';
import { verifyCompletedActions } from '../services/erp-action-verification';
import { sealCompletedActions } from '../services/seal-completions';
import { timingSafeEqual } from '../utils/timing-safe';

const adminOps = new Hono<AppBindings>();

/**
 * Shared-secret gate + tenant-slug resolution. Returns the resolved tenant id
 * and parsed body, or a Response to short-circuit (401 unauthorized / 404
 * tenant_not_found).
 */
async function gate(
  c: Context<AppBindings>,
): Promise<{ tenantId: string; body: Record<string, unknown> } | Response> {
  const env = c.env as Env;
  const secret = c.req.header('X-Setup-Secret');
  if (!env.SETUP_SECRET || !secret || !timingSafeEqual(secret, env.SETUP_SECRET)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: Record<string, unknown> = {};
  try { body = await c.req.json<Record<string, unknown>>(); } catch { /* empty body OK */ }
  const slug = typeof body.tenant_slug === 'string' ? body.tenant_slug : '';
  const row = await env.DB.prepare('SELECT id FROM tenants WHERE slug = ?').bind(slug).first<{ id: string }>();
  if (!row?.id) {
    return c.json({ error: 'tenant_not_found' }, 404);
  }
  return { tenantId: row.id, body };
}

// POST /run-phase10-chain { tenant_slug } — live synthesis trigger.
adminOps.post('/run-phase10-chain', async (c) => {
  const g = await gate(c);
  if (g instanceof Response) return g;
  const chainResult = await runPhase10ChainForTenant((c.env as Env).DB, g.tenantId);
  return c.json({ ok: true, chain_result: chainResult });
});

// POST /resolve-rca { tenant_slug, rca_id } — mirror markResolved's UPDATE so
// a synthesized (status='active') RCA clears billing's status gate, isolating
// the verified-action gate for the A2 boundary test.
adminOps.post('/resolve-rca', async (c) => {
  const g = await gate(c);
  if (g instanceof Response) return g;
  const rcaId = typeof g.body.rca_id === 'string' ? g.body.rca_id : '';
  if (!rcaId) return c.json({ error: 'rca_id required' }, 400);
  const res = await (c.env as Env).DB.prepare(
    `UPDATE root_cause_analyses
        SET status = 'resolved', resolved_at = datetime('now')
      WHERE id = ? AND tenant_id = ? AND status != 'resolved'`
  ).bind(rcaId, g.tenantId).run();
  return c.json({ ok: true, resolved: (res.meta.changes ?? 0) > 0 });
});

// POST /create-completed-action { tenant_slug, rca_id } — real prescription-
// linked completed action. Does NOT set verification_status (the verifier does).
adminOps.post('/create-completed-action', async (c) => {
  const g = await gate(c);
  if (g instanceof Response) return g;
  const db = (c.env as Env).DB;
  const rcaId = typeof g.body.rca_id === 'string' ? g.body.rca_id : '';
  if (!rcaId) return c.json({ error: 'rca_id required' }, 400);

  const rca = await db.prepare('SELECT id, metric_name FROM root_cause_analyses WHERE id = ? AND tenant_id = ?')
    .bind(rcaId, g.tenantId).first<{ id: string; metric_name: string }>();
  if (!rca) return c.json({ error: 'rca_not_found' }, 404);

  // catalyst_actions.cluster_id is NOT NULL + FK — find or create a harness cluster.
  let cluster = await db.prepare(`SELECT id FROM catalyst_clusters WHERE tenant_id = ? LIMIT 1`)
    .bind(g.tenantId).first<{ id: string }>();
  if (!cluster) {
    const clusterId = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO catalyst_clusters (id, tenant_id, name, domain, description, status)
       VALUES (?, ?, 'Verify Harness', 'finance', 'Synthetic cluster for verify-ops actions.', 'active')`
    ).bind(clusterId, g.tenantId).run();
    cluster = { id: clusterId };
  }

  const prescriptionId = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO diagnostic_prescriptions
       (id, rca_id, tenant_id, priority, title, description, expected_impact, effort_level, status, created_at)
     VALUES (?, ?, ?, 'immediate', ?, ?, 'verify-harness', 'low', 'completed', datetime('now'))`
  ).bind(
    prescriptionId, rcaId, g.tenantId,
    `Verify-harness remediation for ${rca.metric_name}`,
    'Synthetic prescription created by the verify harness to exercise the billing ERP-anchor gate.',
  ).run();

  // A real connection for the tenant so verifyAction proceeds to the vendor
  // verifier (SAP → deferred). Null connection also yields deferred — fine.
  const conn = await db.prepare('SELECT id FROM erp_connections WHERE tenant_id = ? LIMIT 1')
    .bind(g.tenantId).first<{ id: string }>();

  const actionId = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO catalyst_actions (
       id, tenant_id, cluster_id, catalyst_name, action, status, confidence, reasoning,
       connection_id, action_type, value_zar, source_finding_id, idempotency_key, vendor, output_data,
       created_at, completed_at
     ) VALUES (?, ?, ?, 'Verify Harness', 'remediate', 'completed', 90, ?, ?, 'update', 0, ?, ?, 'sap', ?, datetime('now'), datetime('now'))`
  ).bind(
    actionId, g.tenantId, cluster.id,
    'Synthetic completed action for billing ERP-anchor verification.',
    conn?.id ?? null, prescriptionId, crypto.randomUUID(),
    JSON.stringify({ mode: 'live', result: 'applied', records: 1 }),
  ).run();

  return c.json({ ok: true, action_id: actionId, prescription_id: prescriptionId });
});

// POST /run-action-verification { tenant_slug } — same fn the cron calls.
adminOps.post('/run-action-verification', async (c) => {
  const g = await gate(c);
  if (g instanceof Response) return g;
  const counts = await verifyCompletedActions((c.env as Env).DB, g.tenantId);
  return c.json({ ok: true, counts });
});

// POST /run-seal-completions { tenant_slug } — same fn the cron calls.
// Back-seals genuine completed recoveries into the provenance chain so the
// "sealed / verify the chain" ledger promise reflects real entries.
adminOps.post('/run-seal-completions', async (c) => {
  const g = await gate(c);
  if (g instanceof Response) return g;
  const result = await sealCompletedActions(c.env as Env, g.tenantId);
  return c.json({ ok: true, result });
});

export default adminOps;
