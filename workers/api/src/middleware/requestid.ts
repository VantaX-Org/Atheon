/**
 * Request-ID middleware.
 *
 * Reads `X-Request-ID` from the incoming request (if present and
 * well-formed) or generates a fresh UUID. Stores it on `c.set('requestId')`
 * for downstream handlers and logger context, then appends `X-Request-ID`
 * to the response so clients (and support tickets) can echo the ID back.
 *
 * Accepted format: alphanumeric plus `_-`, 8-64 chars. Malformed inbound
 * IDs (spaces, control chars, excess length, injection attempts) are
 * dropped and a fresh UUID is issued.
 *
 * Should be registered globally BEFORE other middleware so auth, rate-limit,
 * and route handlers all have access to c.get('requestId').
 */

import type { Context, Next } from 'hono';
import type { AppBindings } from '../types';

/** Inbound IDs must match this shape to be trusted (prevents header-injection / log-forging). */
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;

export async function requestIdMiddleware(c: Context<AppBindings>, next: Next): Promise<void> {
  const incoming = c.req.header('X-Request-ID');
  const isValid = typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming);
  const requestId = isValid ? incoming : crypto.randomUUID();
  c.set('requestId', requestId);
  await next();
  // Propagate on response so clients can quote the ID to support.
  c.header('X-Request-ID', requestId);
}
