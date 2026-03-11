/**
 * Phase 5.6: Structured Logging Service
 * Provides JSON-formatted structured logs with correlation IDs,
 * tenant context, and severity levels for production observability.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestId?: string;
  tenantId?: string;
  userId?: string;
  layer?: string;
  action?: string;
  durationMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

/** Structured logger that outputs JSON for Cloudflare log collection */
export class Logger {
  private requestId?: string;
  private tenantId?: string;
  private userId?: string;

  constructor(opts?: { requestId?: string; tenantId?: string; userId?: string }) {
    this.requestId = opts?.requestId;
    this.tenantId = opts?.tenantId;
    this.userId = opts?.userId;
  }

  private emit(level: LogLevel, message: string, metadata?: Record<string, unknown>) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      requestId: this.requestId,
      tenantId: this.tenantId,
      userId: this.userId,
      ...metadata,
    };
    // Remove undefined fields for cleaner output
    const clean = Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined));
    const line = JSON.stringify(clean);
    switch (level) {
      case 'error': console.error(line); break;
      case 'warn': console.warn(line); break;
      case 'debug': console.debug(line); break;
      default: console.log(line);
    }
  }

  debug(message: string, metadata?: Record<string, unknown>) { this.emit('debug', message, metadata); }
  info(message: string, metadata?: Record<string, unknown>) { this.emit('info', message, metadata); }
  warn(message: string, metadata?: Record<string, unknown>) { this.emit('warn', message, metadata); }
  error(message: string, metadata?: Record<string, unknown>) { this.emit('error', message, metadata); }

  /** Create a child logger with additional context */
  child(opts: { layer?: string; action?: string }): Logger {
    const child = new Logger({ requestId: this.requestId, tenantId: this.tenantId, userId: this.userId });
    return child;
  }
}

/** Create a logger from Hono context */
export function createLogger(c: { get: (key: string) => unknown }): Logger {
  const auth = c.get('auth') as { userId?: string; tenantId?: string } | undefined;
  const requestId = c.get('requestId') as string | undefined;
  return new Logger({
    requestId: requestId || undefined,
    tenantId: auth?.tenantId,
    userId: auth?.userId,
  });
}
