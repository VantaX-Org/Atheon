// TASK-022: Webhook dispatcher with retry logic and signature verification
// Webhook dispatcher - types are inlined to avoid unused import warnings

interface WebhookEvent {
  id: string;
  type: string;
  tenant_id: string;
  data: Record<string, unknown>;
  created_at: string;
}

interface WebhookSubscription {
  id: string;
  tenant_id: string;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [5000, 30000, 120000]; // 5s, 30s, 2min

/**
 * Generate HMAC-SHA256 signature for webhook payload
 */
async function signPayload(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Dispatch a webhook event to all matching subscriptions
 */
export async function dispatchWebhook(
  db: D1Database,
  event: WebhookEvent,
  ctx?: ExecutionContext,
): Promise<{ delivered: number; failed: number }> {
  let delivered = 0;
  let failed = 0;

  // Get active subscriptions for this tenant and event type
  const subs = await db.prepare(
    'SELECT * FROM webhook_subscriptions WHERE tenant_id = ? AND active = 1'
  ).bind(event.tenant_id).all<WebhookSubscription>();

  for (const sub of subs.results || []) {
    // Check if subscription matches event type
    if (!sub.events.includes('*') && !sub.events.includes(event.type)) continue;

    const payload = JSON.stringify(event);
    const signature = await signPayload(payload, sub.secret);

    const deliverFn = async () => {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = await fetch(sub.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Atheon-Signature': `sha256=${signature}`,
              'X-Atheon-Event': event.type,
              'X-Atheon-Delivery': event.id,
              'X-Atheon-Attempt': String(attempt + 1),
            },
            body: payload,
          });

          // Log delivery attempt
          await db.prepare(
            'INSERT INTO webhook_deliveries (id, subscription_id, event_id, event_type, status_code, attempt, delivered_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).bind(crypto.randomUUID(), sub.id, event.id, event.type, response.status, attempt + 1, new Date().toISOString()).run().catch(() => {});

          if (response.ok) {
            delivered++;
            return;
          }

          // Don't retry 4xx errors (except 429)
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            failed++;
            return;
          }
        } catch (err) {
          console.error(`[WEBHOOK] Delivery attempt ${attempt + 1} failed for ${sub.url}:`, err);
        }

        // Wait before retry
        if (attempt < MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
        }
      }
      failed++;
    };

    // Use waitUntil for non-blocking delivery
    if (ctx) {
      ctx.waitUntil(deliverFn());
    } else {
      await deliverFn();
    }
  }

  return { delivered, failed };
}

/**
 * Create a webhook event and dispatch it
 */
export async function emitWebhookEvent(
  db: D1Database,
  tenantId: string,
  eventType: string,
  data: Record<string, unknown>,
  ctx?: ExecutionContext,
): Promise<void> {
  const event: WebhookEvent = {
    id: crypto.randomUUID(),
    type: eventType,
    tenant_id: tenantId,
    data,
    created_at: new Date().toISOString(),
  };

  // Store event
  await db.prepare(
    'INSERT INTO webhook_events (id, tenant_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(event.id, event.tenant_id, event.type, JSON.stringify(event.data), event.created_at).run().catch(() => {});

  // Dispatch to subscribers
  await dispatchWebhook(db, event, ctx);
}
