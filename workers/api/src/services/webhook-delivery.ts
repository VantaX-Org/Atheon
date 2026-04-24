/**
 * Webhook Delivery Queue (Audit §3.6 + Audit Top-20 #18)
 *
 * Durable, retrying, signed webhook delivery pipeline.
 *
 * Flow:
 *   1. `enqueueWebhook()` inserts a row in `webhook_delivery_queue` with
 *      `status='pending'` and `next_attempt_at=now`.
 *   2. A scheduled cron (every 15 min — see `services/scheduled.ts`) calls
 *      `processDueWebhooks()` which picks up pending rows whose `next_attempt_at`
 *      is <= now, signs the payload, and fires the HTTP request.
 *   3. On 2xx the row is marked `delivered`. On any other outcome the attempt
 *      count is incremented; if it is still under the cap the row is re-scheduled
 *      using exponential backoff (30s, 60s, 120s, 240s, 480s); otherwise the row
 *      is moved to `status='dead_letter'` and a prominent `audit_log` entry is
 *      emitted so operators can see it.
 *
 * Design choice — secret storage: we store the webhook secret as-is (hex string)
 * in the `webhooks.secret` column. Rationale:
 *   - We need the plaintext to sign each outbound request (can't use a one-way
 *     hash). Using envelope encryption via ENCRYPTION_KEY would also require the
 *     decryption on every send; for the webhook path we keep it simple and
 *     return the secret only ONCE on creation (never on GET). This matches
 *     GitHub/Stripe/Shopify's "show once" pattern.
 *   - Secrets are high-entropy (256 bits), per-webhook, and revocable by
 *     deleting/recreating the subscription.
 */

import { signWebhookPayload, generateWebhookSecret } from './webhook-signer';

/** Exponential-backoff schedule (seconds) applied per attempt (0-indexed). */
export const WEBHOOK_RETRY_BACKOFF_SECONDS = [30, 60, 120, 240, 480] as const;

/** Max delivery attempts before the row is dead-lettered. */
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_BACKOFF_SECONDS.length;

/** How many rows the scheduler picks up per run. */
const PROCESS_BATCH_SIZE = 50;

/** Row shape for `webhook_delivery_queue` — used by the picker. */
interface QueueRow {
  id: string;
  tenant_id: string;
  webhook_id: string;
  event_type: string;
  payload: string;
  attempts: number;
}

/** Row shape for `webhooks` — used when signing. */
interface WebhookRow {
  id: string;
  url: string;
  secret: string | null;
  active?: number;
}

/** Summary of a `processDueWebhooks` run — useful for logs/tests. */
export interface ProcessResult {
  /** Rows that returned 2xx. */
  delivered: number;
  /** Rows that failed but will be retried again later. */
  retried: number;
  /** Rows that hit the cap and moved to `dead_letter`. */
  deadLettered: number;
}

/**
 * Re-export of the signer's secret generator so the route can `import` only
 * this module when registering a webhook (keeps the route surface tight).
 */
export { generateWebhookSecret };

/**
 * Enqueue a webhook delivery. The row is immediately due (`next_attempt_at=now`)
 * so the next cron tick — or a direct call to `processDueWebhooks` — will send it.
 *
 * @returns the generated queue row id
 */
export async function enqueueWebhook(
  db: D1Database,
  tenantId: string,
  webhookId: string,
  event: string,
  payload: unknown,
): Promise<string> {
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  await db.prepare(
    `INSERT INTO webhook_delivery_queue
       (id, tenant_id, webhook_id, event_type, payload, status, attempts, next_attempt_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
  ).bind(
    id,
    tenantId,
    webhookId,
    event,
    JSON.stringify(payload ?? {}),
    nowIso,
    nowIso,
  ).run();
  return id;
}

/**
 * Look up the webhook subscription (id, url, secret) for a queue row.
 * Returns null when the webhook has been deleted — the caller treats that as
 * a terminal failure and dead-letters the row (no point retrying).
 */
async function loadWebhook(db: D1Database, webhookId: string): Promise<WebhookRow | null> {
  const row = await db.prepare(
    'SELECT id, url, secret, active FROM webhooks WHERE id = ?'
  ).bind(webhookId).first<WebhookRow>().catch(() => null);
  return row ?? null;
}

/**
 * Attempt the HTTP delivery of a signed payload.
 * Returns `{ ok, statusCode, error }`.
 */
async function attemptDelivery(
  webhook: WebhookRow,
  event: string,
  payload: unknown,
): Promise<{ ok: boolean; statusCode: number; error: string | null }> {
  // Guarantee we always have a signing secret. If the row was seeded before
  // we started generating secrets, we fall back to a placeholder but mark the
  // failure so operators can regenerate the webhook.
  const secret = webhook.secret || '';
  if (!secret) {
    return { ok: false, statusCode: 0, error: 'webhook secret missing — regenerate subscription' };
  }

  const { headers, body } = await signWebhookPayload(secret, event, payload, webhook.id);

  try {
    const resp = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Atheon-Signature': headers['X-Atheon-Signature'],
        'X-Atheon-Timestamp': headers['X-Atheon-Timestamp'],
        'X-Atheon-Event': headers['X-Atheon-Event'],
        'X-Atheon-Webhook-Id': headers['X-Atheon-Webhook-Id'],
        'X-Atheon-Delivery': crypto.randomUUID(),
      },
      body,
    });
    return {
      ok: resp.ok,
      statusCode: resp.status,
      error: resp.ok ? null : `HTTP ${resp.status} ${resp.statusText || ''}`.trim(),
    };
  } catch (err) {
    return { ok: false, statusCode: 0, error: (err as Error).message || 'network error' };
  }
}

/**
 * Core picker loop. Selects up to `PROCESS_BATCH_SIZE` pending rows whose
 * `next_attempt_at` is in the past, and processes them sequentially. Returns
 * a summary for observability.
 *
 * @param now — injectable for tests (defaults to `new Date()`)
 */
export async function processDueWebhooks(
  db: D1Database,
  now: Date = new Date(),
): Promise<ProcessResult> {
  const nowIso = now.toISOString();
  const result: ProcessResult = { delivered: 0, retried: 0, deadLettered: 0 };

  const due = await db.prepare(
    `SELECT id, tenant_id, webhook_id, event_type, payload, attempts
     FROM webhook_delivery_queue
     WHERE status = 'pending' AND next_attempt_at <= ?
     ORDER BY next_attempt_at ASC
     LIMIT ?`
  ).bind(nowIso, PROCESS_BATCH_SIZE).all<QueueRow>().catch(() => ({ results: [] as QueueRow[] }));

  for (const row of (due.results || [])) {
    await processSingle(db, row, now, result);
  }

  return result;
}

/**
 * Process a single queue row — extracted for readability. Mutates `result` with
 * the outcome so the caller gets an accurate summary.
 */
async function processSingle(
  db: D1Database,
  row: QueueRow,
  now: Date,
  result: ProcessResult,
): Promise<void> {
  const webhook = await loadWebhook(db, row.webhook_id);
  if (!webhook) {
    // Subscription was deleted — dead-letter immediately; there's nothing to retry to.
    await markDeadLetter(db, row, 'webhook subscription missing', 0);
    result.deadLettered++;
    return;
  }

  let payload: unknown;
  try { payload = JSON.parse(row.payload); } catch { payload = { raw: row.payload }; }

  const outcome = await attemptDelivery(webhook, row.event_type, payload);
  const newAttempts = row.attempts + 1;

  if (outcome.ok) {
    await db.prepare(
      `UPDATE webhook_delivery_queue
       SET status = 'delivered', attempts = ?, last_response_code = ?, last_error = NULL,
           delivered_at = ?
       WHERE id = ?`
    ).bind(newAttempts, outcome.statusCode, now.toISOString(), row.id).run();
    result.delivered++;
    return;
  }

  if (newAttempts >= WEBHOOK_MAX_ATTEMPTS) {
    await markDeadLetter(db, row, outcome.error ?? 'delivery failed', outcome.statusCode, newAttempts);
    result.deadLettered++;
    return;
  }

  // Re-schedule using the backoff indexed by the attempt we JUST completed.
  const delaySec = WEBHOOK_RETRY_BACKOFF_SECONDS[newAttempts - 1] ?? WEBHOOK_RETRY_BACKOFF_SECONDS[WEBHOOK_RETRY_BACKOFF_SECONDS.length - 1];
  const nextAttempt = new Date(now.getTime() + delaySec * 1000).toISOString();
  await db.prepare(
    `UPDATE webhook_delivery_queue
     SET attempts = ?, next_attempt_at = ?, last_response_code = ?, last_error = ?
     WHERE id = ?`
  ).bind(newAttempts, nextAttempt, outcome.statusCode, outcome.error, row.id).run();
  result.retried++;
}

/**
 * Mark a row as dead-lettered and emit a loud `audit_log` entry so operators
 * notice. Errors inside the audit write are swallowed — we never want audit
 * writes to mask the underlying failure.
 */
async function markDeadLetter(
  db: D1Database,
  row: QueueRow,
  error: string,
  statusCode: number,
  attempts: number = row.attempts,
): Promise<void> {
  await db.prepare(
    `UPDATE webhook_delivery_queue
     SET status = 'dead_letter', attempts = ?, last_response_code = ?, last_error = ?
     WHERE id = ?`
  ).bind(attempts, statusCode, error, row.id).run().catch(() => {});

  await db.prepare(
    `INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome)
     VALUES (?, ?, NULL, 'webhook.delivery.dead_letter', 'system', 'webhook', ?, 'failure')`
  ).bind(
    crypto.randomUUID(),
    row.tenant_id,
    JSON.stringify({
      queue_id: row.id,
      webhook_id: row.webhook_id,
      event: row.event_type,
      attempts,
      last_status: statusCode,
      last_error: error,
    }),
  ).run().catch(() => {});
}
