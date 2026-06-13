import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';

const audit = new Hono<AppBindings>();

/** Superadmin/support_admin can override tenant via ?tenant_id= query param */
const CROSS_TENANT_ROLES = new Set(['superadmin', 'support_admin']);

/** Admin-tier roles implicitly hold every permission. */
const ADMIN_ROLES = new Set(['superadmin', 'support_admin', 'admin', 'system_admin']);

/**
 * Does this auth context satisfy `required` (e.g. "audit.read")? A permission
 * grants access when it is "*", the exact string, or the namespace wildcard
 * ("audit.*"). Admin-tier roles bypass the permission list entirely. This is
 * what lets the `auditor` persona (seeded with "audit.read") read the log while
 * roles without it (viewer, operator) are denied — the role NAME is irrelevant,
 * the granted permission is what gates.
 */
function hasPermission(c: { get: (key: string) => unknown }, required: string): boolean {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth) return false;
  if (ADMIN_ROLES.has(auth.role)) return true;
  const ns = required.split('.')[0];
  return (auth.permissions || []).some((p) => p === '*' || p === required || p === `${ns}.*`);
}
function getTenantId(c: { get: (key: string) => unknown; req: { query: (key: string) => string | undefined } }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  const defaultTenantId = auth?.tenantId || c.req.query('tenant_id') || '';
  if (CROSS_TENANT_ROLES.has(auth?.role || '')) {
    return c.req.query('tenant_id') || defaultTenantId;
  }
  return defaultTenantId;
}

// GET /api/audit/log
audit.get('/log', async (c) => {
  if (!hasPermission(c, 'audit.read')) {
    return c.json({ error: 'Forbidden', detail: 'audit.read permission required' }, 403);
  }
  const tenantId = getTenantId(c);
  const layer = c.req.query('layer');
  const action = c.req.query('action');
  const limit = parseInt(c.req.query('limit') || '100');
  const offset = parseInt(c.req.query('offset') || '0');

  let query = 'SELECT * FROM audit_log WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];

  if (layer) { query += ' AND layer = ?'; binds.push(layer); }
  if (action) { query += ' AND action LIKE ?'; binds.push(`%${action}%`); }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  binds.push(limit, offset);

  const results = await c.env.DB.prepare(query).bind(...binds).all();

  const formatted = results.results.map((entry: Record<string, unknown>) => ({
    id: entry.id,
    tenantId: entry.tenant_id,
    userId: entry.user_id,
    action: entry.action,
    layer: entry.layer,
    resource: entry.resource,
    details: entry.details ? JSON.parse(entry.details as string) : null,
    outcome: entry.outcome,
    ipAddress: entry.ip_address,
    createdAt: entry.created_at,
  }));

  return c.json({ entries: formatted, total: formatted.length, offset, limit });
});

// POST /api/audit/log
audit.post('/log', async (c) => {
  // Only admin-tier callers may append audit entries. The read-only `auditor`
  // persona reaches this namespace (see index.ts) but must never be able to
  // forge an audit record — that would defeat the log's purpose as evidence.
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || !ADMIN_ROLES.has(auth.role)) {
    return c.json({ error: 'Forbidden', detail: 'admin role required to write audit entries' }, 403);
  }
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{
    user_id?: string; action: string; layer: string;
    resource?: string; details?: unknown; outcome?: string;
  }>(c, [
    { field: 'action', type: 'string', required: true, minLength: 1, maxLength: 200 },
    { field: 'layer', type: 'string', required: true, minLength: 1, maxLength: 64 },
    { field: 'resource', type: 'string', required: false, maxLength: 200 },
    { field: 'outcome', type: 'string', required: false, maxLength: 32 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, tenantId, body.user_id || null, body.action, body.layer, body.resource || null, body.details ? JSON.stringify(body.details) : null, body.outcome || 'success').run();

  return c.json({ id }, 201);
});

// GET /api/audit/stats
audit.get('/stats', async (c) => {
  const tenantId = getTenantId(c);

  const totalEntries = await c.env.DB.prepare('SELECT COUNT(*) as count FROM audit_log WHERE tenant_id = ?').bind(tenantId).first<{ count: number }>();

  const layerBreakdown = await c.env.DB.prepare(
    'SELECT layer, COUNT(*) as count FROM audit_log WHERE tenant_id = ? GROUP BY layer ORDER BY count DESC'
  ).bind(tenantId).all();

  const outcomeBreakdown = await c.env.DB.prepare(
    'SELECT outcome, COUNT(*) as count FROM audit_log WHERE tenant_id = ? GROUP BY outcome'
  ).bind(tenantId).all();

  const recentActivity = await c.env.DB.prepare(
    'SELECT action, layer, outcome, created_at FROM audit_log WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 10'
  ).bind(tenantId).all();

  return c.json({
    totalEntries: totalEntries?.count || 0,
    layerBreakdown: layerBreakdown.results,
    outcomeBreakdown: outcomeBreakdown.results,
    recentActivity: recentActivity.results,
  });
});

// GET /api/audit/export
audit.get('/export', async (c) => {
  const tenantId = getTenantId(c);

  const results = await c.env.DB.prepare(
    'SELECT * FROM audit_log WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1000'
  ).bind(tenantId).all();

  // Return as JSON (could be CSV in production)
  return c.json({ entries: results.results, total: results.results.length, exportedAt: new Date().toISOString() });
});

// ── Provenance chain (v53-provenance) ─────────────────────────────────
//
// Cryptographically-verifiable audit log. Every catalyst execution,
// HITL approval, assessment run, simulation, and license action
// appends a hash-linked entry. `verifyChain` re-derives every Merkle
// root + HMAC signature in seq order; the first mismatch is the
// tampering point.

// GET /api/audit/provenance — paginated chain view
audit.get('/provenance', async (c) => {
  const { listChain } = await import('../services/provenance-ledger');
  const tenantId = getTenantId(c);
  const url = new URL(c.req.url);
  const limit = parseInt(url.searchParams.get('limit') || '100', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const order = url.searchParams.get('order') === 'asc' ? 'asc' : 'desc';
  const payloadType = url.searchParams.get('type') || undefined;
  const result = await listChain(c.env, tenantId, {
    limit, offset, order,
    payloadType: payloadType as undefined | ReturnType<typeof String> as undefined,
  });
  return c.json(result);
});

// POST /api/audit/provenance/verify — full-chain verification
audit.post('/provenance/verify', async (c) => {
  const { verifyChain } = await import('../services/provenance-ledger');
  const tenantId = getTenantId(c);
  const result = await verifyChain(c.env, tenantId);
  return c.json(result);
});

// GET /api/audit/provenance/root — current merkle root + seq
audit.get('/provenance/root', async (c) => {
  const { getCurrentRoot } = await import('../services/provenance-ledger');
  const tenantId = getTenantId(c);
  const result = await getCurrentRoot(c.env, tenantId);
  return c.json(result);
});

export default audit;
