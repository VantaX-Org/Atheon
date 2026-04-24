/**
 * Webhook Subscriptions (SPEC-015 + Audit §3.6 / Audit Top-20 #18)
 *
 * Register, update, and test webhook endpoints. Outbound delivery is signed
 * with HMAC-SHA256 (see `services/webhook-signer.ts`) and retried with
 * exponential backoff through the `webhook_delivery_queue` (see
 * `services/webhook-delivery.ts`).
 *
 * Secret-handling policy (documented, "show once"):
 *   - On `POST /webhooks` we generate a 256-bit random secret and return it
 *     plaintext in the response body.
 *   - The same secret is stored verbatim in the `webhooks.secret` column so
 *     we can re-sign every outbound request.
 *   - `GET /webhooks` and `GET /webhooks/:id` NEVER return the plaintext
 *     secret — they return `'***'` as a presence indicator only. Losing the
 *     secret means deleting and re-creating the subscription.
 */
import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';
import { generateWebhookSecret, enqueueWebhook, processDueWebhooks } from '../services/webhook-delivery';

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

/**
 * GET /api/webhooks — List webhooks for the caller's tenant.
 * Secrets are redacted to `'***'` (presence indicator only).
 */
webhooks.get('/', async (c) => {
  const auth = c.get('auth') as AuthContext;
  const results = await c.env.DB.prepare(
    'SELECT id, url, events, active, retry_count, last_triggered, created_at, secret FROM webhooks WHERE tenant_id = ? ORDER BY created_at DESC'
  ).bind(auth.tenantId).all().catch(() => ({ results: [] }));

  return c.json({
    webhooks: (results.results || []).map((w: Record<string, unknown>) => ({
      id: w.id,
      url: w.url,
      events: JSON.parse((w.events as string) || '[]'),
      active: w.active === 1,
      retryCount: w.retry_count,
      lastTriggered: w.last_triggered,
      createdAt: w.created_at,
      secret: w.secret ? '***' : null,
    })),
  });
});

/**
 * POST /api/webhooks — Register a new webhook subscription.
 *
 * A 256-bit secret is generated server-side and returned ONCE in the response.
 * Clients must store it securely — subsequent GETs return `'***'` only.
 */
webhooks.post('/', async (c) => {
  const auth = c.get('auth') as AuthContext;
  const { data: body, errors } = await getValidatedJsonBody<{
    url: string;
    events?: unknown;
  }>(c, [
    // `events` is an array — we validate shape separately below.
    { field: 'url', type: 'string', required: true, minLength: 10 },
  ]);

  if (!body || errors.length > 0) {
    return c.json({ error: 'Invalid input', details: errors }, 400);
  }

  if (body.events !== undefined && !Array.isArray(body.events)) {
    return c.json({ error: 'events must be an array of event names' }, 400);
  }
  const rawEvents = (body.events as string[] | undefined) || undefined;
  if (rawEvents && rawEvents.some(e => typeof e !== 'string')) {
    return c.json({ error: 'events must be an array of strings' }, 400);
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

  // Validate events — subscribe to everything by default
  const events = rawEvents && rawEvents.length > 0 ? rawEvents : [...WEBHOOK_EVENTS];
  const invalidEvents = events.filter(e => e !== '*' && !WEBHOOK_EVENTS.includes(e as typeof WEBHOOK_EVENTS[number]));
  if (invalidEvents.length > 0) {
    return c.json({ error: `Invalid events: ${invalidEvents.join(', ')}` }, 400);
  }

  const id = crypto.randomUUID();
  const secret = generateWebhookSecret();

  await c.env.DB.prepare(
    'INSERT INTO webhooks (id, tenant_id, url, secret, events, active, retry_count, created_at) VALUES (?, ?, ?, ?, ?, 1, 0, datetime(\'now\'))'
  ).bind(id, auth.tenantId, body.url, secret, JSON.stringify(events)).run();

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), auth.tenantId, auth.userId, 'webhook_created', 'system', 'webhook', JSON.stringify({ url: body.url, events }), 'success').run().catch(() => {});

  // Plaintext secret is returned ONCE — never again via GET.
  return c.json({
    id,
    url: body.url,
    events,
    active: true,
    secret,
    message: 'Webhook created. Store the secret — it will not be shown again. Receivers should verify X-Atheon-Signature and reject requests where |now - X-Atheon-Timestamp| > 300s.',
  }, 201);
});

/**
 * GET /api/webhooks/:id — Read a single webhook.
 * Secret is redacted.
 */
webhooks.get('/:id', async (c) => {
  const auth = c.get('auth') as AuthContext;
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    'SELECT id, url, events, active, retry_count, last_triggered, created_at, secret FROM webhooks WHERE id = ? AND tenant_id = ?'
  ).bind(id, auth.tenantId).first();
  if (!row) return c.json({ error: 'Webhook not found' }, 404);
  return c.json({
    id: row.id,
    url: row.url,
    events: JSON.parse((row.events as string) || '[]'),
    active: row.active === 1,
    retryCount: row.retry_count,
    lastTriggered: row.last_triggered,
    createdAt: row.created_at,
    secret: row.secret ? '***' : null,
  });
});

// PUT /api/webhooks/:id - Update a webhook
webhooks.put('/:id', async (c) => {
  const auth = c.get('auth') as AuthContext;
  const id = c.req.param('id');
  const body = await c.req.json<{ url?: string; events?: string[]; active?: boolean }>().catch(() => ({} as Record<string, unknown>));

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.url) { updates.push('url = ?'); values.push(body.url); }
  if (body.events) { updates.push('events = ?'); values.push(JSON.stringify(body.events)); }
  if (body.active !== undefined) { updates.push('active = ?'); values.push(body.active ? 1 : 0); }

  if (updates.length > 0) {
    values.push(id, auth.tenantId);
    await c.env.DB.prepare(
      `UPDATE webhooks SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`
    ).bind(...values).run();
  }

  return c.json({ success: true });
});

// DELETE /api/webhooks/:id - Delete a webhook
webhooks.delete('/:id', async (c) => {
  const auth = c.get('auth') as AuthContext;
  const id = c.req.param('id');
  await c.env.DB.prepare(
    'DELETE FROM webhooks WHERE id = ? AND tenant_id = ?'
  ).bind(id, auth.tenantId).run();

  return c.json({ success: true });
});

/**
 * POST /api/webhooks/:id/test — Enqueue a signed test delivery.
 *
 * The test payload is routed through the same queue as production events so
 * tenants verify the full path (signing + retry) works end-to-end. We then
 * trigger `processDueWebhooks` synchronously so the caller gets an immediate
 * result — in production the cron would pick it up within 15 minutes.
 */
webhooks.post('/:id/test', async (c) => {
  const auth = c.get('auth') as AuthContext;
  const id = c.req.param('id');

  const webhook = await c.env.DB.prepare(
    'SELECT id FROM webhooks WHERE id = ? AND tenant_id = ?'
  ).bind(id, auth.tenantId).first();

  if (!webhook) return c.json({ error: 'Webhook not found' }, 404);

  const testPayload = {
    timestamp: new Date().toISOString(),
    tenantId: auth.tenantId,
    data: { message: 'This is a test webhook delivery from Atheon.' },
  };

  const queueId = await enqueueWebhook(c.env.DB, auth.tenantId, id, 'webhook.test', testPayload);
  // Process immediately so the UI can show the real outcome.
  const result = await processDueWebhooks(c.env.DB).catch((err) => {
    console.error('Test webhook processing failed:', err);
    return { delivered: 0, retried: 0, deadLettered: 0 };
  });

  // Re-read the queue row for status / response code.
  const queued = await c.env.DB.prepare(
    'SELECT status, attempts, last_response_code, last_error FROM webhook_delivery_queue WHERE id = ?'
  ).bind(queueId).first<{ status: string; attempts: number; last_response_code: number | null; last_error: string | null }>();

  return c.json({
    queueId,
    status: queued?.status ?? 'pending',
    attempts: queued?.attempts ?? 0,
    statusCode: queued?.last_response_code ?? null,
    error: queued?.last_error ?? null,
    summary: result,
  });
});

/**
 * GET /api/webhooks/:id/deliveries — Recent delivery queue entries (delivered,
 * pending, or dead-lettered) for a single webhook.
 */
webhooks.get('/:id/deliveries', async (c) => {
  const auth = c.get('auth') as AuthContext;
  const id = c.req.param('id');

  const deliveries = await c.env.DB.prepare(
    `SELECT id, event_type, status, attempts, next_attempt_at, last_response_code, last_error, created_at, delivered_at
     FROM webhook_delivery_queue
     WHERE webhook_id = ? AND tenant_id = ?
     ORDER BY created_at DESC LIMIT 50`
  ).bind(id, auth.tenantId).all().catch(() => ({ results: [] }));

  return c.json({
    deliveries: (deliveries.results || []).map((d: Record<string, unknown>) => ({
      id: d.id,
      event: d.event_type,
      status: d.status,
      attempts: d.attempts,
      nextAttemptAt: d.next_attempt_at,
      lastStatusCode: d.last_response_code,
      lastError: d.last_error,
      createdAt: d.created_at,
      deliveredAt: d.delivered_at,
    })),
  });
});

export default webhooks;
