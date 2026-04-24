/**
 * Webhook Signing Helper (Audit §3.6 + Audit Top-20 #18)
 *
 * Signs outbound webhook payloads with HMAC-SHA256 so receivers can verify
 * that the request genuinely originated from Atheon and has not been tampered
 * with in transit.
 *
 * Signature format: `sha256=hex(hmac_sha256(secret, timestamp + '.' + body))`
 *
 * Receiver-side verification (documented contract — NOT enforced by Atheon):
 *   1. Parse `X-Atheon-Timestamp` (unix seconds) and reject if `abs(now - ts) > 300s`
 *      (replay protection — the tolerance window is 5 minutes).
 *   2. Recompute HMAC-SHA256 over `timestamp + '.' + raw_body` with the shared secret.
 *   3. Compare (constant-time) against the value in `X-Atheon-Signature` (strip the
 *      `sha256=` prefix first).
 *
 * We emit: X-Atheon-Signature, X-Atheon-Timestamp, X-Atheon-Event, X-Atheon-Webhook-Id.
 */

/** Headers emitted on every signed webhook delivery. */
export interface WebhookSignatureHeaders {
  /** `sha256=<hex>` — HMAC-SHA256 of `timestamp + '.' + body` using the shared secret. */
  'X-Atheon-Signature': string;
  /** Unix seconds (string) — the receiver should reject if |now - ts| > 300s. */
  'X-Atheon-Timestamp': string;
  /** The event name, e.g. `catalyst.action.completed`. */
  'X-Atheon-Event': string;
  /** The webhook subscription id this delivery is for. */
  'X-Atheon-Webhook-Id': string;
}

/** Default replay-protection tolerance — receivers should reject older requests. */
export const DEFAULT_TIMESTAMP_TOLERANCE_SECONDS = 300;

/**
 * Generate a random 32-byte hex secret for a new webhook subscription.
 * 64 hex chars = 256 bits of entropy. Returned plaintext to the caller ONCE;
 * stored verbatim in the `webhooks.secret` column (see route `POST /webhooks`).
 */
export function generateWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Convert an ArrayBuffer to lowercase hex. */
function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/**
 * Compute `hex(hmac_sha256(secret, timestamp + '.' + body))`.
 * Kept private — callers use `signWebhookPayload` or `verifyWebhookSignature`.
 */
async function computeHmacHex(secret: string, timestamp: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
  const signed = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${body}`));
  return bufferToHex(signed);
}

/**
 * Sign an outbound webhook payload and produce the full set of Atheon headers.
 *
 * The payload is JSON-serialised here (we don't accept a pre-serialised body
 * because the signature must match the bytes that will actually be sent, and
 * we want a single source of truth for that serialisation).
 *
 * Returns both the headers to attach to the outbound request AND the raw
 * JSON body string so callers can `fetch(url, { headers, body })` without
 * double-serialising.
 */
export async function signWebhookPayload(
  secret: string,
  event: string,
  payload: unknown,
  webhookId: string,
): Promise<{ headers: WebhookSignatureHeaders; body: string }> {
  const body = JSON.stringify(payload ?? {});
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const hex = await computeHmacHex(secret, timestamp, body);
  return {
    headers: {
      'X-Atheon-Signature': `sha256=${hex}`,
      'X-Atheon-Timestamp': timestamp,
      'X-Atheon-Event': event,
      'X-Atheon-Webhook-Id': webhookId,
    },
    body,
  };
}

/** Constant-time comparison for two equal-length hex strings. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify a received signature against the shared secret, timestamp, and raw body.
 *
 * Returns `true` only when:
 *  - the timestamp is within `toleranceSeconds` of the current time (replay protection)
 *  - the recomputed HMAC matches the provided signature (tamper detection)
 *
 * Accepts signatures with or without the `sha256=` prefix.
 *
 * This is exported primarily so tests and receiver-side tooling can use the same
 * verification logic we document for external integrators.
 */
export async function verifyWebhookSignature(
  secret: string,
  receivedSignature: string,
  receivedTimestamp: string,
  body: string,
  toleranceSeconds: number = DEFAULT_TIMESTAMP_TOLERANCE_SECONDS,
): Promise<boolean> {
  // Reject malformed inputs outright.
  if (!secret || !receivedSignature || !receivedTimestamp) return false;

  // Replay protection — reject stale or future-dated timestamps.
  const ts = parseInt(receivedTimestamp, 10);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > toleranceSeconds) return false;

  // Normalise: accept both `sha256=<hex>` and a bare hex string.
  const provided = receivedSignature.startsWith('sha256=')
    ? receivedSignature.slice(7)
    : receivedSignature;

  const expected = await computeHmacHex(secret, receivedTimestamp, body);
  return constantTimeEqual(expected.toLowerCase(), provided.toLowerCase());
}
