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
  if (!env.SETUP_SECRET || !secret || secret !== env.SETUP_SECRET) {
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

export default adminOps;
