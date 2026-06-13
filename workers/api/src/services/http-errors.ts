/**
 * HTTP error helpers.
 *
 * `prodSafeError` builds a JSON error body that never leaks internal exception
 * detail to the client in production. Raw exception messages from D1 frequently
 * contain SQL fragments, internal column/table names, and binding hints — fine
 * for staging/dev debugging, but information disclosure if echoed to a public
 * client in production. This helper always logs the full error server-side
 * (name/message/stack via the structured logger) and only sanitises the
 * client-facing `details` field, and only when ENVIRONMENT === 'production'.
 *
 * Environment convention matches the rest of the codebase: prod is the explicit
 * string 'production' (set in wrangler.toml); anything else — including an
 * unset value — is treated as non-production (more verbose), consistent with
 * the `env.ENVIRONMENT !== 'production'` checks used elsewhere.
 */
import { logError } from './logger';

/** Generic client-facing detail returned in production in place of the raw error. */
const PROD_GENERIC_DETAIL = 'An internal error occurred. Contact support with your request ID.';

export interface ProdSafeErrorOptions {
  /** Client-facing error summary (always returned), e.g. "Failed to delete tenant". */
  error: string;
  /** Architectural layer for the structured server log (e.g. 'admin'). */
  layer?: string;
}

/** Error body shape — preserves the existing `{ error, details }` contract. */
export interface ProdSafeErrorBody {
  error: string;
  details: string;
}

/**
 * Log `err` in full and return a client-safe `{ error, details }` body.
 * In production `details` is a fixed generic string; elsewhere it carries the
 * raw exception message to keep local/staging debugging fast.
 */
export function prodSafeError(
  err: unknown,
  environment: string | undefined,
  opts: ProdSafeErrorOptions,
): ProdSafeErrorBody {
  logError(opts.error, err, opts.layer ? { layer: opts.layer } : undefined);
  const isProd = environment === 'production';
  const raw = err instanceof Error ? err.message : String(err);
  return {
    error: opts.error,
    details: isProd ? PROD_GENERIC_DETAIL : raw,
  };
}
