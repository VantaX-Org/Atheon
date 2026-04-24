/**
 * Client-side request-ID generation and correlation.
 *
 * Backend PR #222 added a request-ID middleware: every API response carries an
 * X-Request-ID header (echoed from the client's X-Request-ID if present, or
 * generated server-side). The CORS config exposes X-Request-ID so the browser
 * can read it.
 *
 * When the frontend supplies a self-generated id on outbound requests, server
 * logs and browser logs share a correlatable identifier. The 'fe-' prefix in
 * the id lets log readers tell a frontend-origin id from a server-generated
 * (UUID-shaped) one at a glance.
 */

/**
 * Generate a short, URL-safe request-id client-side.
 *
 * Format: 'fe-' + 16 lowercase hex chars (19 chars total). This satisfies the
 * backend's `[a-zA-Z0-9_-]{8,64}` validation regex with room to spare.
 *
 * Prefers crypto.getRandomValues; falls back to Math.random in environments
 * where Web Crypto is unavailable (which in practice is rare — IE11-era
 * browsers only — but keeps this utility safe to call without guarding).
 */
export function generateRequestId(): string {
  const bytes = new Uint8Array(8);
  try {
    // 8 bytes -> 16 hex chars
    const c = (typeof crypto !== 'undefined' ? crypto : undefined) as Crypto | undefined;
    if (c && typeof c.getRandomValues === 'function') {
      c.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // Guard against a getRandomValues stub that doesn't actually fill the array
  // (some test harnesses mock it as a no-op). If we see all zeros, fall back.
  let allZero = true;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0) { allZero = false; break; }
  }
  if (allZero) {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return `fe-${hex}`;
}

/** Regex for ids produced by {@link generateRequestId}. */
export const FRONTEND_REQUEST_ID_RE = /^fe-[0-9a-f]{16}$/;
