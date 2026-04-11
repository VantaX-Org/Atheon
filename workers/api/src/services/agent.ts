/**
 * Agent Sidecar Service
 * Re-exports agent hardening, circuit breaker, and rate limiting functionality.
 * Includes structured logging and graceful shutdown support.
 */

// Re-export all agent hardening functionality
export {
  type AgentConfig,
  type RetryPolicy,
  type CircuitBreakerConfig,
  type AgentRateLimit,
  CircuitBreaker,
  type AgentHealthMetrics,
  getDefaultAgentConfig,
  sanitizeAgentInput,
  validateAgentOutput,
  checkAgentRateLimit,
} from './agent-hardening';

// ── Structured Logger ──

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
  traceId?: string;
}

const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export class StructuredLogger {
  private minLevel: LogLevel;
  private context: Record<string, unknown>;

  constructor(minLevel: LogLevel = 'info', context: Record<string, unknown> = {}) {
    this.minLevel = minLevel;
    this.context = context;
  }

  private log(level: LogLevel, message: string, extra?: Record<string, unknown>): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.minLevel]) return;
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context: { ...this.context, ...extra },
    };
    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    console[method](JSON.stringify(entry));
  }

  debug(message: string, extra?: Record<string, unknown>): void { this.log('debug', message, extra); }
  info(message: string, extra?: Record<string, unknown>): void { this.log('info', message, extra); }
  warn(message: string, extra?: Record<string, unknown>): void { this.log('warn', message, extra); }
  error(message: string, extra?: Record<string, unknown>): void { this.log('error', message, extra); }

  child(context: Record<string, unknown>): StructuredLogger {
    return new StructuredLogger(this.minLevel, { ...this.context, ...context });
  }
}

// ── Graceful Shutdown ──

export class GracefulShutdown {
  private shutdownCallbacks: Array<() => Promise<void>> = [];
  private isShuttingDown = false;

  register(callback: () => Promise<void>): void {
    this.shutdownCallbacks.push(callback);
  }

  async shutdown(reason: string = 'unknown'): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    console.log(JSON.stringify({ level: 'info', message: 'Graceful shutdown initiated', reason, timestamp: new Date().toISOString() }));
    for (const cb of this.shutdownCallbacks) {
      try { await cb(); } catch (err) { console.error('Shutdown callback failed:', err); }
    }
  }

  get shuttingDown(): boolean { return this.isShuttingDown; }
}
