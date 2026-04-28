// workers/api/src/routes/agent-routes.ts
// Agent routes — authenticated by X-Licence-Key header, NOT JWT
// Mounted at /api/agent (outside tenantIsolation middleware)
import { Hono } from 'hono';
import type { AppBindings } from '../types';

const agentRoutes = new Hono<AppBindings>();

async function getDeploymentByLicenceKey(db: D1Database, licenceKey: string) {
  return db.prepare(
    'SELECT * FROM managed_deployments WHERE licence_key = ? AND status != ? AND (licence_expires_at IS NULL OR licence_expires_at > datetime("now"))'
  ).bind(licenceKey, 'suspended').first<Record<string, unknown>>();
}

// ── AGENT: POST /api/agent/heartbeat ──────────────────────────────────
agentRoutes.post('/heartbeat', async (c) => {
  const licenceKey = c.req.header('X-Licence-Key');
  if (!licenceKey) return c.json({ error: 'Missing X-Licence-Key' }, 401);

  const dep = await getDeploymentByLicenceKey(c.env.DB, licenceKey);
  if (!dep) return c.json({ error: 'Invalid or suspended licence' }, 403);

  const body = await c.req.json<{
    agentVersion?: string;
    apiVersion?: string;
    healthScore?: number;
    resourceUsage?: Record<string, unknown>;
    status?: string;
  }>();

  const updates: string[] = ["last_heartbeat = datetime('now')", "updated_at = datetime('now')"];
  const values: unknown[] = [];

  if (body.agentVersion) { updates.push('agent_version = ?'); values.push(body.agentVersion); }
  if (body.apiVersion) { updates.push('api_version = ?'); values.push(body.apiVersion); }
  if (typeof body.healthScore === 'number') { updates.push('health_score = ?'); values.push(body.healthScore); }
  if (body.resourceUsage) { updates.push('resource_usage = ?'); values.push(JSON.stringify(body.resourceUsage)); }

  // If heartbeat arrives, deployment is active. Allow agent to report 'active' or 'degraded' only.
  const newStatus = dep.status === 'pending' || dep.status === 'offline' ? (body.status === 'degraded' ? 'degraded' : 'active') : (body.status === 'active' || body.status === 'degraded' ? body.status : dep.status as string);
  updates.push('status = ?');
  values.push(newStatus);

  values.push(dep.id);
  await c.env.DB.prepare(
    `UPDATE managed_deployments SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  // Return any pending config for the agent
  const currentConfig = JSON.parse(dep.config as string || '{}');
  return c.json({
    ok: true,
    config: currentConfig,
    targetVersion: currentConfig.targetVersion || null,
  });
});

// ── AGENT: POST /api/agent/provision (on-premise auto-registration) ──
// Creates a managed_deployments record so the agent can heartbeat locally.
// Only works when ENVIRONMENT !== 'production' (i.e., on-premise/dev mode).
agentRoutes.post('/provision', async (c) => {
  // c.env.ENVIRONMENT comes from wrangler.toml [vars] in cloud, or --var override in Docker.
  // Dockerfile passes --var ENVIRONMENT:${ENVIRONMENT:-on-premise} to override the wrangler.toml default.
  const env = (c as unknown as { env: { ENVIRONMENT?: string } }).env;
  if (env?.ENVIRONMENT === 'production') {
    return c.json({ error: 'Provisioning disabled in production' }, 403);
  }

  const licenceKey = c.req.header('X-Licence-Key');
  if (!licenceKey) return c.json({ error: 'Missing X-Licence-Key' }, 401);

  // Check if already exists
  const existing = await c.env.DB.prepare(
    'SELECT id FROM managed_deployments WHERE licence_key = ?'
  ).bind(licenceKey).first();
  if (existing) return c.json({ ok: true, message: 'Already provisioned' });

  const body = await c.req.json<{
    deploymentId?: string;
    agentVersion?: string;
    hostname?: string;
  }>();

  const id = body.deploymentId || crypto.randomUUID();

  // Get or create a default tenant for on-premise
  let tenantId: string;
  const tenant = await c.env.DB.prepare('SELECT id FROM tenants LIMIT 1').first<{ id: string }>();
  if (tenant) {
    tenantId = tenant.id;
  } else {
    tenantId = crypto.randomUUID();
    await c.env.DB.prepare(
      "INSERT INTO tenants (id, name, slug, status, created_at) VALUES (?, 'On-Premise', 'on-premise', 'active', datetime('now'))"
    ).bind(tenantId).run();
  }

  const config = JSON.stringify({
    ollamaModel: 'Reshigan/atheon',
    maxUsers: 50,
    features: ['apex', 'pulse', 'catalysts', 'mind', 'memory'],
    updateChannel: 'stable',
  });

  await c.env.DB.prepare(`
    INSERT INTO managed_deployments
    (id, tenant_id, name, deployment_type, status, licence_key, region, config, agent_version, last_heartbeat)
    VALUES (?, ?, 'On-Premise Deployment', 'on-premise', 'active', ?, 'local', ?, ?, datetime('now'))
  `).bind(id, tenantId, licenceKey, config, body.agentVersion || '1.0.0').run();

  return c.json({ ok: true, id, message: 'Deployment auto-provisioned for on-premise mode' }, 201);
});

// ── AGENT: GET /api/agent/config ──────────────────────────────────────
agentRoutes.get('/config', async (c) => {
  const licenceKey = c.req.header('X-Licence-Key');
  if (!licenceKey) return c.json({ error: 'Missing X-Licence-Key' }, 401);

  const dep = await getDeploymentByLicenceKey(c.env.DB, licenceKey);
  if (!dep) return c.json({ error: 'Invalid or suspended licence' }, 403);

  return c.json({ config: JSON.parse(dep.config as string || '{}') });
});

// ── AGENT: POST /api/agent/error ──────────────────────────────────────
agentRoutes.post('/error', async (c) => {
  const licenceKey = c.req.header('X-Licence-Key');
  if (!licenceKey) return c.json({ error: 'Missing X-Licence-Key' }, 401);

  const dep = await getDeploymentByLicenceKey(c.env.DB, licenceKey);
  if (!dep) return c.json({ error: 'Invalid or suspended licence' }, 403);

  const body = await c.req.json<{ message: string; code?: string; severity?: string }>();
  const existing = JSON.parse(dep.error_log as string || '[]') as unknown[];
  const newLog = [
    { ts: new Date().toISOString(), message: body.message, code: body.code, severity: body.severity || 'error' },
    ...existing
  ].slice(0, 20); // keep last 20

  await c.env.DB.prepare(
    "UPDATE managed_deployments SET error_log = ?, status = CASE WHEN status = 'active' THEN 'degraded' ELSE status END, updated_at = datetime('now') WHERE id = ?"
  ).bind(JSON.stringify(newLog), dep.id).run();

  return c.json({ ok: true });
});

// ── CLOUD: GET /api/agent/license-check?key=... ────────────────────────
//
// Phone-home endpoint for hybrid + on-premise customer instances. The
// customer-side license-enforcement middleware calls this every hour;
// it caches the result in KV and gates data-plane traffic on the answer.
//
// Returns 200 + a status payload regardless of validity — the customer
// instance distinguishes "valid: true" vs "valid: false" from the body
// rather than HTTP status, so a temporarily-revoked license can still
// recover via re-validation without the customer's network treating it
// as a hard failure.
agentRoutes.get('/license-check', async (c) => {
  const key = c.req.query('key');
  if (!key) {
    return c.json({
      valid: false,
      status: 'unknown',
      expires_at: null,
      reason: 'license-check called without ?key= query parameter',
    });
  }
  // Re-use the same suspended/expired guards as getDeploymentByLicenceKey,
  // but expose the reason in the response so the customer admin gets a
  // clear remediation message.
  const dep = await c.env.DB.prepare(
    'SELECT id, status, licence_expires_at FROM managed_deployments WHERE licence_key = ?',
  ).bind(key).first<{ id: string; status: string; licence_expires_at: string | null }>();
  if (!dep) {
    return c.json({
      valid: false,
      status: 'unknown',
      expires_at: null,
      reason: 'No deployment found for this licence key. Contact your account manager.',
    });
  }
  if (dep.status === 'suspended') {
    return c.json({
      valid: false,
      status: 'revoked',
      expires_at: dep.licence_expires_at,
      reason: 'Licence is suspended. Contact your account manager to reactivate.',
    });
  }
  if (dep.licence_expires_at && new Date(dep.licence_expires_at) < new Date()) {
    return c.json({
      valid: false,
      status: 'expired',
      expires_at: dep.licence_expires_at,
      reason: `Licence expired on ${dep.licence_expires_at}. Contact your account manager to renew.`,
    });
  }
  return c.json({
    valid: true,
    status: 'active',
    expires_at: dep.licence_expires_at,
    reason: '',
  });
});

export default agentRoutes;
