/**
 * Audit §3.6 / Audit Top-20 #18 -Webhook signing, retry, DLQ tests.
 *
 * Coverage:
 *   1. POST /webhooks returns a plaintext secret on creation; GET redacts it.
 *   2. signWebhookPayload + verifyWebhookSignature round-trip.
 *   3. verifyWebhookSignature rejects tampered body.
 *   4. verifyWebhookSignature rejects stale timestamps (> 5 min old).
 *   5. enqueueWebhook inserts a row with status = 'pending'.
 *   6. processDueWebhooks retries on 5xx and applies exponential backoff.
 *   7. processDueWebhooks dead-letters after 5 failed attempts + emits audit_log entry.
 *   8. The signing timestamp is within a few seconds of "now" (sanity).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';
import {
  signWebhookPayload,
  verifyWebhookSignature,
  generateWebhookSecret,
} from '../services/webhook-signer';
import {
  enqueueWebhook,
  processDueWebhooks,
  WEBHOOK_RETRY_BACKOFF_SECONDS,
  WEBHOOK_MAX_ATTEMPTS,
} from '../services/webhook-delivery';

// ── Test constants ──
const TENANT_ID = 'webhook-test-tenant';
const TENANT_SLUG = 'webhook-test-tenant';
const ADMIN_USER_ID = 'webhook-test-admin';
const ADMIN_EMAIL = 'admin@webhook-test.co.za';
const TEST_PASSWORD = 'WebhookTest1!';

async function migrateViaEndpoint(): Promise<void> {
  const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
    method: 'POST',
    headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
  });
  if (res.status !== 200) throw new Error(`Migration failed: ${res.status}`);
}

async function seedTenantAndAdmin(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status)
     VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(TENANT_ID, 'Webhook Test Tenant', TENANT_SLUG).run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenant_entitlements (tenant_id, layers, catalyst_clusters, max_agents, max_users)
     VALUES (?, '["apex","pulse","mind"]', '["finance"]', 50, 100)`
  ).bind(TENANT_ID).run();
  const hash = await hashPassword(TEST_PASSWORD);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status)
     VALUES (?, ?, ?, 'Webhook Admin', 'admin', ?, ?, 'active')`
  ).bind(ADMIN_USER_ID, TENANT_ID, ADMIN_EMAIL, hash, JSON.stringify(['*'])).run();
}

async function login(): Promise<string> {
  const res = await SELF.fetch('http://localhost/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: TEST_PASSWORD, tenant_slug: TENANT_SLUG }),
  });
  if (res.status !== 200) throw new Error(`Login failed: ${res.status}`);
  const body = await res.json() as { token: string };
  return body.token;
}

async function cleanupWebhookData(): Promise<void> {
  await env.DB.prepare('DELETE FROM webhook_delivery_queue WHERE tenant_id = ?').bind(TENANT_ID).run();
  await env.DB.prepare('DELETE FROM webhooks WHERE tenant_id = ?').bind(TENANT_ID).run();
}

describe('Webhook Signer -signing + verification', () => {
  it('round-trips: signed payload verifies with the same secret', async () => {
    const secret = generateWebhookSecret();
    const { headers, body } = await signWebhookPayload(
      secret,
      'catalyst.action.completed',
      { foo: 'bar', n: 42 },
      'wh-123',
    );

    // Signature header must have the `sha256=` prefix.
    expect(headers['X-Atheon-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(headers['X-Atheon-Event']).toBe('catalyst.action.completed');
    expect(headers['X-Atheon-Webhook-Id']).toBe('wh-123');

    const ok = await verifyWebhookSignature(
      secret,
      headers['X-Atheon-Signature'],
      headers['X-Atheon-Timestamp'],
      body,
    );
    expect(ok).toBe(true);
  });

  it('rejects a tampered payload', async () => {
    const secret = generateWebhookSecret();
    const { headers } = await signWebhookPayload(secret, 'evt', { x: 1 }, 'wh');

    // Tamper by sending a different body.
    const ok = await verifyWebhookSignature(
      secret,
      headers['X-Atheon-Signature'],
      headers['X-Atheon-Timestamp'],
      JSON.stringify({ x: 999 }),
    );
    expect(ok).toBe(false);
  });

  it('rejects stale timestamps (>5 minutes old)', async () => {
    const secret = generateWebhookSecret();
    const { body } = await signWebhookPayload(secret, 'evt', { x: 1 }, 'wh');

    // Construct a signature bound to a 10-minute-old timestamp.
    const stale = (Math.floor(Date.now() / 1000) - 600).toString();
    // Recompute the correct HMAC for that stale timestamp so the ONLY reason
    // verification fails is the staleness check -not a bad signature.
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${stale}.${body}`));
    const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

    const ok = await verifyWebhookSignature(secret, `sha256=${hex}`, stale, body);
    expect(ok).toBe(false);
  });

  it('timestamp is within a few seconds of now (sanity)', async () => {
    const before = Math.floor(Date.now() / 1000);
    const { headers } = await signWebhookPayload(generateWebhookSecret(), 'evt', {}, 'wh');
    const after = Math.floor(Date.now() / 1000);
    const ts = parseInt(headers['X-Atheon-Timestamp'], 10);
    expect(ts).toBeGreaterThanOrEqual(before - 1);
    expect(ts).toBeLessThanOrEqual(after + 10);
  });
});

describe('Webhook route -creation + secret handling', () => {
  beforeAll(async () => {
    await migrateViaEndpoint();
    await seedTenantAndAdmin();
  });

  beforeEach(async () => {
    await cleanupWebhookData();
  });

  it('POST /webhooks returns a freshly generated secret and redacts it on GET', async () => {
    const token = await login();
    const createRes = await SELF.fetch('http://localhost/api/v1/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        url: 'https://example.com/hooks/atheon',
        events: ['catalyst.run.completed'],
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json() as { id: string; secret: string; message: string };

    // Secret must be present + high-entropy (hex).
    expect(created.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(created.message).toContain('not be shown again');

    // GET /webhooks -secret is redacted.
    const listRes = await SELF.fetch('http://localhost/api/v1/webhooks', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listRes.status).toBe(200);
    const list = await listRes.json() as { webhooks: Array<{ id: string; secret: string | null }> };
    const mine = list.webhooks.find(w => w.id === created.id);
    expect(mine).toBeDefined();
    expect(mine!.secret).toBe('***');
    expect(mine!.secret).not.toBe(created.secret);

    // GET /webhooks/:id -also redacted.
    const detailRes = await SELF.fetch(`http://localhost/api/v1/webhooks/${created.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json() as { secret: string };
    expect(detail.secret).toBe('***');
  });
});

describe('Webhook Delivery Queue -enqueue, retry, dead-letter', () => {
  // The queue references `webhooks` and `audit_log` for every outcome, so we
  // need the schema + a seeded subscription for these tests.
  beforeAll(async () => {
    await migrateViaEndpoint();
    await seedTenantAndAdmin();
  });

  beforeEach(async () => {
    await cleanupWebhookData();
    await env.DB.prepare(
      `DELETE FROM audit_log WHERE tenant_id = ? AND action = 'webhook.delivery.dead_letter'`
    ).bind(TENANT_ID).run();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function seedWebhook(url: string): Promise<{ id: string; secret: string }> {
    const id = crypto.randomUUID();
    const secret = generateWebhookSecret();
    await env.DB.prepare(
      `INSERT INTO webhooks (id, tenant_id, url, secret, events, active, retry_count, created_at)
       VALUES (?, ?, ?, ?, ?, 1, 0, datetime('now'))`
    ).bind(id, TENANT_ID, url, secret, JSON.stringify(['*'])).run();
    return { id, secret };
  }

  it('enqueueWebhook inserts a pending row in webhook_delivery_queue', async () => {
    const { id: webhookId } = await seedWebhook('https://example.com/hook');
    const queueId = await enqueueWebhook(env.DB, TENANT_ID, webhookId, 'test.event', { hello: 'world' });

    const row = await env.DB.prepare(
      'SELECT * FROM webhook_delivery_queue WHERE id = ?'
    ).bind(queueId).first<Record<string, unknown>>();

    expect(row).not.toBeNull();
    expect(row!.status).toBe('pending');
    expect(row!.attempts).toBe(0);
    expect(row!.webhook_id).toBe(webhookId);
    expect(row!.event_type).toBe('test.event');
    // Payload round-trips.
    expect(JSON.parse(row!.payload as string)).toEqual({ hello: 'world' });
    // next_attempt_at is set (ISO string).
    expect(typeof row!.next_attempt_at).toBe('string');
  });

  it('retries on 5xx and applies exponential backoff on the first failure', async () => {
    const { id: webhookId } = await seedWebhook('https://recipient.example.com/hook');

    // Mock fetch to always fail with 500. `SELF.fetch` to the worker under test
    // goes through a different binding, so this only affects outbound calls.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('fail', { status: 500 })));

    const queueId = await enqueueWebhook(env.DB, TENANT_ID, webhookId, 'test.event', { n: 1 });

    const t0 = new Date();
    const result = await processDueWebhooks(env.DB, t0);
    expect(result.retried).toBe(1);
    expect(result.delivered).toBe(0);
    expect(result.deadLettered).toBe(0);

    const row = await env.DB.prepare(
      'SELECT status, attempts, next_attempt_at, last_response_code, last_error FROM webhook_delivery_queue WHERE id = ?'
    ).bind(queueId).first<{ status: string; attempts: number; next_attempt_at: string; last_response_code: number; last_error: string }>();
    expect(row!.status).toBe('pending');
    expect(row!.attempts).toBe(1);
    expect(row!.last_response_code).toBe(500);
    expect(row!.last_error).toContain('500');
    // Next attempt is scheduled ~30s later (first backoff).
    const delayMs = new Date(row!.next_attempt_at).getTime() - t0.getTime();
    expect(delayMs).toBe(WEBHOOK_RETRY_BACKOFF_SECONDS[0] * 1000);
  });

  it('dead-letters after 5 failed attempts and emits a webhook.delivery.dead_letter audit entry', async () => {
    const { id: webhookId } = await seedWebhook('https://recipient.example.com/dl');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })));

    const queueId = await enqueueWebhook(env.DB, TENANT_ID, webhookId, 'test.event', { n: 1 });

    // Drive the row through 5 failed attempts by re-processing with an
    // advancing "now" so `next_attempt_at` is always in the past.
    let lastStatus = 'pending';
    let lastAttempts = 0;
    for (let i = 0; i < WEBHOOK_MAX_ATTEMPTS; i++) {
      // Push "now" beyond the row's next_attempt_at each iteration.
      const now = new Date(Date.now() + (i + 1) * 10 * 60_000); // +10 min per iter
      await processDueWebhooks(env.DB, now);
      const row = await env.DB.prepare(
        'SELECT status, attempts FROM webhook_delivery_queue WHERE id = ?'
      ).bind(queueId).first<{ status: string; attempts: number }>();
      lastStatus = row!.status;
      lastAttempts = row!.attempts;
    }
    expect(lastStatus).toBe('dead_letter');
    expect(lastAttempts).toBe(WEBHOOK_MAX_ATTEMPTS);

    // An audit_log entry was emitted so operators can see it.
    const audit = await env.DB.prepare(
      `SELECT COUNT(*) as c FROM audit_log WHERE tenant_id = ? AND action = 'webhook.delivery.dead_letter' AND resource = 'webhook'`
    ).bind(TENANT_ID).first<{ c: number }>();
    expect(audit!.c).toBeGreaterThanOrEqual(1);
  });

  it('marks a row delivered on 2xx', async () => {
    const { id: webhookId } = await seedWebhook('https://recipient.example.com/ok');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));

    const queueId = await enqueueWebhook(env.DB, TENANT_ID, webhookId, 'test.event', { ok: true });
    const result = await processDueWebhooks(env.DB);
    expect(result.delivered).toBe(1);
    expect(result.retried).toBe(0);
    expect(result.deadLettered).toBe(0);

    const row = await env.DB.prepare(
      'SELECT status, attempts, last_response_code, delivered_at FROM webhook_delivery_queue WHERE id = ?'
    ).bind(queueId).first<{ status: string; attempts: number; last_response_code: number; delivered_at: string }>();
    expect(row!.status).toBe('delivered');
    expect(row!.attempts).toBe(1);
    expect(row!.last_response_code).toBe(200);
    expect(row!.delivered_at).toBeTruthy();
  });
});
