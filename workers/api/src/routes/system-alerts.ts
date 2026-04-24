/**
 * System Alert Rules — admin-facing CRUD for alert rules backed by
 * the `system_alert_rules` table.
 * Route: /api/v1/system-alerts | Role: admin+
 */
import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';

const systemAlerts = new Hono<AppBindings>();

const ROLE_LEVELS: Record<string, number> = {
  superadmin: 120, support_admin: 110, admin: 100, executive: 90,
  manager: 70, analyst: 50, operator: 40, viewer: 10,
};
const CROSS_TENANT_ROLES = new Set(['superadmin', 'support_admin']);

function getAuth(c: { get: (k: string) => unknown }): AuthContext | undefined {
  return c.get('auth') as AuthContext | undefined;
}

function getTenantId(c: { get: (k: string) => unknown; req: { query: (k: string) => string | undefined } }): string {
  const auth = getAuth(c);
  if (!auth?.tenantId) throw new Error('No tenant context');
  if (CROSS_TENANT_ROLES.has(auth.role || '')) {
    return c.req.query('tenant_id') || auth.tenantId;
  }
  return auth.tenantId;
}

function isAdminPlus(c: { get: (k: string) => unknown }): boolean {
  const auth = getAuth(c);
  return (ROLE_LEVELS[auth?.role || ''] ?? 0) >= ROLE_LEVELS['admin'];
}

const ALLOWED_SEVERITIES = new Set(['info', 'low', 'medium', 'high', 'critical']);
const ALLOWED_CHANNELS = new Set(['email', 'webhook', 'slack', 'in_app']);

interface AlertRuleRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  event_type: string;
  condition: string;
  severity: string;
  channels: string;
  recipients: string;
  enabled: number;
  silenced_until: string | null;
  triggered_count: number;
  last_triggered_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function formatRule(row: AlertRuleRow): Record<string, unknown> {
  let condition: unknown = {};
  try { condition = row.condition ? JSON.parse(row.condition) : {}; } catch { condition = {}; }
  let channels: unknown[] = [];
  try { channels = row.channels ? JSON.parse(row.channels) : []; } catch { channels = []; }
  let recipients: unknown[] = [];
  try { recipients = row.recipients ? JSON.parse(row.recipients) : []; } catch { recipients = []; }
  const now = Date.now();
  const silenced = row.silenced_until && new Date(row.silenced_until).getTime() > now;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    event_type: row.event_type,
    condition,
    severity: row.severity,
    channels,
    recipients,
    enabled: !!row.enabled,
    silenced: !!silenced,
    silenced_until: row.silenced_until,
    triggered_count: row.triggered_count,
    last_triggered_at: row.last_triggered_at,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Evaluate a rule condition against a payload.
 * Condition shape: { field: string, op: string, value: unknown }
 * Supported ops: '==', '!=', '>', '>=', '<', '<=', 'contains', 'in'
 * Dotted field paths resolve through nested objects.
 */
function evaluateCondition(condition: Record<string, unknown>, payload: Record<string, unknown>): { fired: boolean; reason: string } {
  const field = String(condition.field || '');
  const op = String(condition.op || condition.operator || '==');
  const expected = condition.value;
  if (!field) return { fired: false, reason: 'Condition missing field' };

  const parts = field.split('.');
  let actual: unknown = payload;
  for (const p of parts) {
    if (actual && typeof actual === 'object' && p in (actual as Record<string, unknown>)) {
      actual = (actual as Record<string, unknown>)[p];
    } else {
      actual = undefined;
      break;
    }
  }

  // Severity-aware comparison: high ≥ medium if comparing severities
  const severityOrder: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
  const bothSeverity = typeof actual === 'string' && typeof expected === 'string'
    && actual in severityOrder && (expected as string) in severityOrder;
  const a: number | string | undefined = bothSeverity ? severityOrder[actual as string] : (actual as number | string | undefined);
  const b: number | string | undefined = bothSeverity ? severityOrder[expected as string] : (expected as number | string | undefined);

  let fired = false;
  switch (op) {
    case '==': fired = actual === expected; break;
    case '!=': fired = actual !== expected; break;
    case '>': fired = a !== undefined && b !== undefined && a > b; break;
    case '>=': fired = a !== undefined && b !== undefined && a >= b; break;
    case '<': fired = a !== undefined && b !== undefined && a < b; break;
    case '<=': fired = a !== undefined && b !== undefined && a <= b; break;
    case 'contains': fired = typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected); break;
    case 'in': fired = Array.isArray(expected) && (expected as unknown[]).includes(actual); break;
    default: return { fired: false, reason: `Unsupported operator "${op}"` };
  }
  return { fired, reason: fired ? `Matched ${field} ${op} ${JSON.stringify(expected)}` : `Did not match ${field} ${op} ${JSON.stringify(expected)}` };
}

// GET /system-alerts/rules
systemAlerts.get('/rules', async (c) => {
  if (!isAdminPlus(c)) return c.json({ error: 'Forbidden', message: 'Admin role required' }, 403);
  const tenantId = getTenantId(c);
  const res = await c.env.DB.prepare(
    'SELECT * FROM system_alert_rules WHERE tenant_id = ? ORDER BY created_at DESC',
  ).bind(tenantId).all<AlertRuleRow>();
  return c.json({ rules: (res.results || []).map(formatRule) });
});

// POST /system-alerts/rules
systemAlerts.post('/rules', async (c) => {
  if (!isAdminPlus(c)) return c.json({ error: 'Forbidden', message: 'Admin role required' }, 403);
  const tenantId = getTenantId(c);
  const auth = getAuth(c);

  let body: {
    name?: string;
    description?: string;
    event_type?: string;
    condition?: Record<string, unknown>;
    severity?: string;
    channels?: string[];
    recipients?: string[];
    enabled?: boolean;
  };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  if (!body.name || body.name.length < 1) return c.json({ error: 'Invalid input', message: 'name is required' }, 400);
  if (!body.event_type) return c.json({ error: 'Invalid input', message: 'event_type is required' }, 400);
  if (!body.condition || typeof body.condition !== 'object') return c.json({ error: 'Invalid input', message: 'condition object is required' }, 400);

  const severity = body.severity && ALLOWED_SEVERITIES.has(body.severity) ? body.severity : 'medium';
  const channels = Array.isArray(body.channels) ? body.channels.filter(ch => ALLOWED_CHANNELS.has(ch)) : [];
  const recipients = Array.isArray(body.recipients) ? body.recipients.map(String) : [];

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO system_alert_rules
     (id, tenant_id, name, description, event_type, condition, severity, channels, recipients, enabled, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, tenantId, body.name, body.description || null, body.event_type,
    JSON.stringify(body.condition), severity,
    JSON.stringify(channels), JSON.stringify(recipients),
    body.enabled === false ? 0 : 1,
    auth?.userId || null,
  ).run();

  const row = await c.env.DB.prepare('SELECT * FROM system_alert_rules WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId).first<AlertRuleRow>();
  return c.json({ rule: row ? formatRule(row) : { id } }, 201);
});

// PUT /system-alerts/rules/:id
systemAlerts.put('/rules/:id', async (c) => {
  if (!isAdminPlus(c)) return c.json({ error: 'Forbidden', message: 'Admin role required' }, 403);
  const tenantId = getTenantId(c);
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare('SELECT * FROM system_alert_rules WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId).first<AlertRuleRow>();
  if (!existing) return c.json({ error: 'Rule not found' }, 404);

  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (typeof body.name === 'string') { updates.push('name = ?'); values.push(body.name); }
  if (typeof body.description === 'string') { updates.push('description = ?'); values.push(body.description); }
  if (typeof body.event_type === 'string') { updates.push('event_type = ?'); values.push(body.event_type); }
  if (body.condition && typeof body.condition === 'object') {
    updates.push('condition = ?'); values.push(JSON.stringify(body.condition));
  }
  if (typeof body.severity === 'string' && ALLOWED_SEVERITIES.has(body.severity)) {
    updates.push('severity = ?'); values.push(body.severity);
  }
  if (Array.isArray(body.channels)) {
    const filtered = (body.channels as unknown[]).map(String).filter(ch => ALLOWED_CHANNELS.has(ch));
    updates.push('channels = ?'); values.push(JSON.stringify(filtered));
  }
  if (Array.isArray(body.recipients)) {
    updates.push('recipients = ?'); values.push(JSON.stringify((body.recipients as unknown[]).map(String)));
  }
  if (typeof body.enabled === 'boolean') { updates.push('enabled = ?'); values.push(body.enabled ? 1 : 0); }

  if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400);
  updates.push("updated_at = datetime('now')");
  values.push(id, tenantId);

  await c.env.DB.prepare(
    `UPDATE system_alert_rules SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`,
  ).bind(...values).run();

  const updated = await c.env.DB.prepare('SELECT * FROM system_alert_rules WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId).first<AlertRuleRow>();
  return c.json({ rule: updated ? formatRule(updated) : null });
});

// DELETE /system-alerts/rules/:id
systemAlerts.delete('/rules/:id', async (c) => {
  if (!isAdminPlus(c)) return c.json({ error: 'Forbidden', message: 'Admin role required' }, 403);
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT id FROM system_alert_rules WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId).first();
  if (!existing) return c.json({ error: 'Rule not found' }, 404);
  await c.env.DB.prepare('DELETE FROM system_alert_rules WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId).run();
  return c.json({ success: true });
});

// POST /system-alerts/rules/:id/silence
systemAlerts.post('/rules/:id/silence', async (c) => {
  if (!isAdminPlus(c)) return c.json({ error: 'Forbidden', message: 'Admin role required' }, 403);
  const tenantId = getTenantId(c);
  const id = c.req.param('id');

  let body: { until?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }
  const until = body.until;
  if (until !== null && until !== undefined) {
    if (typeof until !== 'string' || Number.isNaN(Date.parse(until))) {
      return c.json({ error: 'Invalid input', message: 'until must be an ISO-8601 timestamp or null' }, 400);
    }
  }

  const existing = await c.env.DB.prepare('SELECT id FROM system_alert_rules WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId).first();
  if (!existing) return c.json({ error: 'Rule not found' }, 404);

  await c.env.DB.prepare(
    "UPDATE system_alert_rules SET silenced_until = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?",
  ).bind(until || null, id, tenantId).run();

  return c.json({ success: true, silenced_until: until || null });
});

// POST /system-alerts/rules/:id/test — synthetic trigger
systemAlerts.post('/rules/:id/test', async (c) => {
  if (!isAdminPlus(c)) return c.json({ error: 'Forbidden', message: 'Admin role required' }, 403);
  const tenantId = getTenantId(c);
  const id = c.req.param('id');

  const rule = await c.env.DB.prepare('SELECT * FROM system_alert_rules WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId).first<AlertRuleRow>();
  if (!rule) return c.json({ error: 'Rule not found' }, 404);

  let body: { payload?: Record<string, unknown> } = {};
  try { body = await c.req.json(); } catch { /* empty body is fine */ }
  const payload = body.payload || {};

  let condition: Record<string, unknown> = {};
  try { condition = JSON.parse(rule.condition) as Record<string, unknown>; } catch { /* default empty */ }

  const result = evaluateCondition(condition, payload);
  const now = Date.now();
  const silenced = rule.silenced_until && new Date(rule.silenced_until).getTime() > now;

  return c.json({
    rule_id: rule.id,
    event_type: rule.event_type,
    would_fire: result.fired && !!rule.enabled && !silenced,
    matched: result.fired,
    enabled: !!rule.enabled,
    silenced: !!silenced,
    reason: result.reason,
    channels: (() => { try { return JSON.parse(rule.channels); } catch { return []; } })(),
    recipients: (() => { try { return JSON.parse(rule.recipients); } catch { return []; } })(),
    severity: rule.severity,
  });
});

export default systemAlerts;
