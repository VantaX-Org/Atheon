/**
 * SPEC-015: Webhook System
 * Register webhook endpoints, manage subscriptions, deliver events with retry.
 */
import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';

const webhooks = new Hono<AppBindings>();

const WEBHOOK_EVENTS = [
  'catalyst.run.completed',
  'catalyst.run.failed',
  'catalyst.action.approved',
  'catalyst.action.rejected',
  'health_score.updated',
  'risk.created',
  'risk.resolved',
  'erp.sync.completed',
  'erp.sync.failed',
  'user.created',
  'user.updated',
  'tenant.updated',
  'subscription.changed',
  'anomaly.detected',
] as const;

// GET /api/webhooks/events - List available webhook events
webhooks.get('/events', (c) => {
  return c.json({ events: WEBHOOK_EVENTS });
});

// GET /api/webhooks - List registered webhooks
webhooks.get('/', async (c) => {
  const auth = c.get('auth') as AuthContext;
  const results = await c.env.DB.prepare(
    'SELECT * FROM webhook_subscriptions WHERE tenant_id = ? ORDER BY created_at DESC'
  ).bind(auth.tenantId).all().catch(() => ({ results: [] }));

  return c.json({
    webhooks: (results.results || []).map((w: Record<string, unknown>) => ({
      id: w.id,
      url: w.url,
      events: JSON.parse(w.events as string || '[]'),
      status: w.status,
      secret: w.secret ? '***' : null,
      createdAt: w.created_at,
      lastDeliveryAt: w.last_delivery_at,
      failureCount: w.failure_count,
    })),
  });
});

// POST /api/webhooks - Register a webhook
webhooks.post('/', async (c) => {
  const auth = c.get('auth') as AuthContext;
  const { data: body, errors } = await getValidatedJsonBody<{
    url: string;
    events: string[];
    secret?: string;
  }>(c, [
    { field: 'url', type: 'string', required: true, minLength: 10 },
    { field: 'events', type: 'string', required: false },
  ]);

  if (!body || errors.length > 0) {
    return c.json({ error: 'Invalid input', details: errors }, 400);
  }

  // Validate URL
  try {
    const url = new URL(body.url);
    if (!['https:', 'http:'].includes(url.protocol)) {
      return c.json({ error: 'URL must use HTTPS or HTTP protocol' }, 400);
    }
  } catch {
    return c.json({ error: 'Invalid URL format' }, 400);
  }

  // Validate events
  const events = body.events || [...WEBHOOK_EVENTS];
  const invalidEvents = events.filter(e => !WEBHOOK_EVENTS.includes(e as typeof WEBHOOK_EVENTS[number]));
  if (invalidEvents.length > 0) {
    return c.json({ error: `Invalid events: ${invalidEvents.join(', ')}` }, 400);
  }

  const id = crypto.randomUUID();
  const secret = body.secret || crypto.randomUUID();

  await c.env.DB.prepare(
    'INSERT INTO webhook_subscriptions (id, tenant_id, url, events, secret, status, failure_count, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, datetime(\'now\'))'
  ).bind(id, auth.tenantId, body.url, JSON.stringify(events), secret, 'active').run();

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), auth.tenantId, auth.userId, 'webhook_created', 'system', 'webhook', JSON.stringify({ url: body.url, events }), 'success').run();

  return c.json({ id, url: body.url, events, secret, status: 'active' }, 201);
});

// PUT /api/webhooks/:id - Update a webhook
webhooks.put('/:id', async (c) => {
  const auth = c.get('auth') as AuthContext;
  const id = c.req.param('id');
  const body = await c.req.json<{ url?: string; events?: string[]; status?: string }>();

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.url) { updates.push('url = ?'); values.push(body.url); }
  if (body.events) { updates.push('events = ?'); values.push(JSON.stringify(body.events)); }
  if (body.status) { updates.push('status = ?'); values.push(body.status); }

  if (updates.length > 0) {
    values.push(id, auth.tenantId);
    await c.env.DB.prepare(
      `UPDATE webhook_subscriptions SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`
    ).bind(...values).run();
  }

  return c.json({ success: true });
});

// DELETE /api/webhooks/:id - Delete a webhook
webhooks.delete('/:id', async (c) => {
  const auth = c.get('auth') as AuthContext;
  const id = c.req.param('id');
  await c.env.DB.prepare(
    'DELETE FROM webhook_subscriptions WHERE id = ? AND tenant_id = ?'
  ).bind(id, auth.tenantId).run();

  return c.json({ success: true });
});

// POST /api/webhooks/:id/test - Test a webhook
webhooks.post('/:id/test', async (c) => {
  const auth = c.get('auth') as AuthContext;
  const id = c.req.param('id');

  const webhook = await c.env.DB.prepare(
    'SELECT * FROM webhook_subscriptions WHERE id = ? AND tenant_id = ?'
  ).bind(id, auth.tenantId).first();

  if (!webhook) return c.json({ error: 'Webhook not found' }, 404);

  const testPayload = {
    event: 'webhook.test',
    timestamp: new Date().toISOString(),
    tenantId: auth.tenantId,
    data: { message: 'This is a test webhook delivery from Atheon.' },
  };

  try {
    const response = await fetch(webhook.url as string, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Atheon-Event': 'webhook.test',
        'X-Atheon-Signature': 'test',
        'X-Atheon-Delivery': crypto.randomUUID(),
      },
      body: JSON.stringify(testPayload),
    });

    return c.json({
      success: response.ok,
      statusCode: response.status,
      message: response.ok ? 'Test delivery successful' : `Delivery failed with status ${response.status}`,
    });
  } catch (err) {
    return c.json({
      success: false,
      statusCode: 0,
      message: `Delivery failed: ${(err as Error).message}`,
    });
  }
});

// GET /api/webhooks/:id/deliveries - List recent deliveries
webhooks.get('/:id/deliveries', async (c) => {
  const auth = c.get('auth') as AuthContext;
  const id = c.req.param('id');

  const deliveries = await c.env.DB.prepare(
    'SELECT * FROM webhook_deliveries WHERE webhook_id = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT 50'
  ).bind(id, auth.tenantId).all().catch(() => ({ results: [] }));

  return c.json({
    deliveries: (deliveries.results || []).map((d: Record<string, unknown>) => ({
      id: d.id,
      event: d.event,
      statusCode: d.status_code,
      success: d.success === 1,
      responseTime: d.response_time_ms,
      createdAt: d.created_at,
      error: d.error_message,
    })),
  });
});

export default webhooks;
