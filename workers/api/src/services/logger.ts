/**
 * Structured JSON logger for Cloudflare Workers.
 *
 * Writes each record as a single-line JSON envelope to the appropriate
 * console method (log/warn/error/debug). Cloudflare's log stream captures
 * stdout, so the JSON envelopes flow through to tail/logpush without any
 * extra dependency.
 *
 * Two usage styles are supported:
 *   1. Functional: log / logInfo / logWarn / logError / logDebug — pass a
 *      LogContext each call. Best for one-off sites (route handlers,
 *      scheduled tasks).
 *   2. Class: Logger.child({...}) — create a pre-bound logger with
 *      requestId / tenantId / userId / layer already attached. Best for
 *      long-running flows inside a single handler.
 *
 * Request-ID correlation:
 *   The middleware in ../middleware/requestid.ts stores an X-Request-ID
 *   on `c.get('requestId')`; contextFromHono(c) extracts it plus the
 *   auth context so handlers can log with one line.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Fields pinned to every record emitted with this context. */
export interface LogContext {
  /** Correlation ID — matches X-Request-ID response header so support can trace user reports. */
  requestId?: string;
  tenantId?: string;
  userId?: string;
  /** Architectural layer: auth | catalysts | erp | mind | apex | pulse | scheduled | migration. */
  layer?: string;
  /** Semantic action: e.g. 'login.failed', 'catalyst.action.executed'. */
  action?: string;
}

/** One log record. Always JSON-serialised to stdout. */
interface LogRecord {
  ts: string;
  level: LogLevel;
  msg: string;
  ctx: LogContext;
  data?: Record<string, unknown>;
  err?: { name: string; message: string; stack?: string };
}

/** Normalise an unknown thrown value into an err envelope. */
function normaliseError(err: unknown): { name: string; message: string; stack?: string } | undefined {
  if (err === undefined || err === null) return undefined;
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  if (typeof err === 'object') {
    try {
      return { name: 'NonError', message: JSON.stringify(err) };
    } catch {
      return { name: 'NonError', message: String(err) };
    }
  }
  return { name: 'NonError', message: String(err) };
}

/** Strip undefined fields so the wire output is compact. */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

/** Emit a single JSON record. Exposed as `log` for generic level dispatch. */
export function log(
  level: LogLevel,
  msg: string,
  ctx?: LogContext,
  data?: Record<string, unknown>,
  err?: unknown,
): void {
  const record: LogRecord = {
    ts: new Date().toISOString(),
    level,
    msg,
    ctx: ctx ? (compact(ctx as Record<string, unknown>) as LogContext) : {},
  };
  if (data !== undefined) record.data = data;
  const normalisedErr = normaliseError(err);
  if (normalisedErr) record.err = normalisedErr;

  let line: string;
  try {
    line = JSON.stringify(record);
  } catch {
    // Last-resort fallback — e.g. circular references in `data`.
    line = JSON.stringify({ ts: record.ts, level, msg, ctx: record.ctx, note: 'payload-unserialisable' });
  }

  switch (level) {
    case 'error':
      console.error(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    case 'debug':
      console.debug(line);
      break;
    default:
      console.log(line);
  }
}

export function logDebug(msg: string, ctx?: LogContext, data?: Record<string, unknown>): void {
  log('debug', msg, ctx, data);
}

export function logInfo(msg: string, ctx?: LogContext, data?: Record<string, unknown>): void {
  log('info', msg, ctx, data);
}

export function logWarn(msg: string, ctx?: LogContext, data?: Record<string, unknown>): void {
  log('warn', msg, ctx, data);
}

/**
 * Error-level log. `err` is stringified into a dedicated `err` envelope with
 * name/message/stack so downstream log processors can alert on specific
 * error classes.
 */
export function logError(
  msg: string,
  err: unknown,
  ctx?: LogContext,
  data?: Record<string, unknown>,
): void {
  log('error', msg, ctx, data, err);
}

/**
 * Build a LogContext from a Hono context.
 * Reads `c.get('requestId')` (set by requestIdMiddleware) and `c.get('auth')`
 * (set by tenantIsolation middleware). Any missing fields are simply omitted.
 */
export function contextFromHono(c: {
  get: (key: string) => unknown;
}): LogContext {
  const auth = c.get('auth') as { userId?: string; tenantId?: string } | undefined;
  const requestId = c.get('requestId') as string | undefined;
  return compact({
    requestId: requestId || undefined,
    tenantId: auth?.tenantId,
    userId: auth?.userId,
  }) as LogContext;
}

/**
 * Class-style logger for flows that want a pre-bound context.
 * Maintained for backward compatibility with earlier code that relied on
 * `new Logger({...}).info(...)` and `logger.child({...})`.
 */
export class Logger {
  private readonly ctx: LogContext;

  constructor(opts?: LogContext) {
    this.ctx = opts ?? {};
  }

  private emit(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
    log(level, message, this.ctx, metadata);
  }

  debug(message: string, metadata?: Record<string, unknown>): void {
    this.emit('debug', message, metadata);
  }
  info(message: string, metadata?: Record<string, unknown>): void {
    this.emit('info', message, metadata);
  }
  warn(message: string, metadata?: Record<string, unknown>): void {
    this.emit('warn', message, metadata);
  }
  error(message: string, metadata?: Record<string, unknown>): void {
    this.emit('error', message, metadata);
  }

  /** Create a child logger with additional context fields (merged over this logger's). */
  child(opts: LogContext): Logger {
    return new Logger({ ...this.ctx, ...opts });
  }
}

/** Convenience: construct a Logger pre-bound to a Hono request context. */
export function createLogger(c: { get: (key: string) => unknown }): Logger {
  return new Logger(contextFromHono(c));
}
