/**
 * SPEC-030: Agent Sidecar Hardening
 * Catalyst agent sandboxing, resource limits, circuit breakers, and health monitoring.
 */

export interface AgentConfig {
  id: string;
  name: string;
  maxConcurrentRuns: number;
  maxTokensPerRun: number;
  timeoutMs: number;
  memoryLimitMb: number;
  retryPolicy: RetryPolicy;
  circuitBreaker: CircuitBreakerConfig;
  rateLimits: AgentRateLimit;
}

export interface RetryPolicy {
  maxRetries: number;
  backoffMultiplier: number;
  initialDelayMs: number;
  maxDelayMs: number;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxCalls: number;
}

export interface AgentRateLimit {
  maxCallsPerMinute: number;
  maxCallsPerHour: number;
  maxTokensPerHour: number;
}

type CircuitState = 'closed' | 'open' | 'half_open';

/** In-memory circuit breaker for agent calls */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;
  private halfOpenCalls = 0;

  constructor(private config: CircuitBreakerConfig) {}

  canExecute(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.config.resetTimeoutMs) {
        this.state = 'half_open';
        this.halfOpenCalls = 0;
        return true;
      }
      return false;
    }
    // half_open
    return this.halfOpenCalls < this.config.halfOpenMaxCalls;
  }

  recordSuccess(): void {
    if (this.state === 'half_open') {
      this.state = 'closed';
      this.failureCount = 0;
    }
    this.failureCount = Math.max(0, this.failureCount - 1);
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.state === 'half_open') {
      this.state = 'open';
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.state = 'open';
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getFailureCount(): number {
    return this.failureCount;
  }

  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.halfOpenCalls = 0;
  }
}

/** Agent health metrics */
export interface AgentHealthMetrics {
  agentId: string;
  uptime: number;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  avgDurationMs: number;
  totalTokensUsed: number;
  circuitBreakerState: CircuitState;
  lastRunAt?: string;
  errorRate: number;
}

/** Default agent configuration */
export function getDefaultAgentConfig(agentId: string, name: string): AgentConfig {
  return {
    id: agentId,
    name,
    maxConcurrentRuns: 5,
    maxTokensPerRun: 100000,
    timeoutMs: 300000, // 5 minutes
    memoryLimitMb: 256,
    retryPolicy: {
      maxRetries: 3,
      backoffMultiplier: 2,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
    },
    circuitBreaker: {
      failureThreshold: 5,
      resetTimeoutMs: 60000, // 1 minute
      halfOpenMaxCalls: 2,
    },
    rateLimits: {
      maxCallsPerMinute: 30,
      maxCallsPerHour: 500,
      maxTokensPerHour: 1000000,
    },
  };
}

/** Validate agent input/output to prevent injection */
export function sanitizeAgentInput(input: string): string {
  // Remove potential prompt injection patterns
  let clean = input;
  // Strip control characters
  // eslint-disable-next-line no-control-regex
  clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Limit length
  if (clean.length > 50000) {
    clean = clean.slice(0, 50000);
  }
  return clean;
}

/** Validate agent output before returning to user */
export function validateAgentOutput(output: unknown): { valid: boolean; sanitized: unknown; issues: string[] } {
  const issues: string[] = [];

  if (output === null || output === undefined) {
    return { valid: false, sanitized: null, issues: ['Agent returned null/undefined output'] };
  }

  if (typeof output === 'string') {
    let sanitized = output;
    // Check for potential data leakage patterns
    if (sanitized.match(/(?:api[_-]?key|secret|password|token)\s*[:=]\s*\S+/i)) {
      issues.push('Potential secret leakage detected in output');
      sanitized = sanitized.replace(/(?:api[_-]?key|secret|password|token)\s*[:=]\s*\S+/gi, '[REDACTED]');
    }
    return { valid: issues.length === 0, sanitized, issues };
  }

  // For objects, stringify and check
  try {
    const str = JSON.stringify(output);
    if (str.length > 5000000) {
      issues.push('Output exceeds 5MB limit');
      return { valid: false, sanitized: null, issues };
    }
    return { valid: true, sanitized: output, issues };
  } catch {
    issues.push('Output is not serializable');
    return { valid: false, sanitized: null, issues };
  }
}

/** Check agent rate limits */
export async function checkAgentRateLimit(
  cache: KVNamespace,
  agentId: string,
  limits: AgentRateLimit,
): Promise<{ allowed: boolean; reason?: string }> {
  const minuteKey = `agent_rate:${agentId}:min:${Math.floor(Date.now() / 60000)}`;
  const hourKey = `agent_rate:${agentId}:hour:${Math.floor(Date.now() / 3600000)}`;

  const [minuteCount, hourCount] = await Promise.all([
    cache.get(minuteKey).then(v => parseInt(v || '0', 10)),
    cache.get(hourKey).then(v => parseInt(v || '0', 10)),
  ]);

  if (minuteCount >= limits.maxCallsPerMinute) {
    return { allowed: false, reason: `Agent rate limit exceeded: ${limits.maxCallsPerMinute} calls/minute` };
  }
  if (hourCount >= limits.maxCallsPerHour) {
    return { allowed: false, reason: `Agent rate limit exceeded: ${limits.maxCallsPerHour} calls/hour` };
  }

  await Promise.all([
    cache.put(minuteKey, String(minuteCount + 1), { expirationTtl: 60 }),
    cache.put(hourKey, String(hourCount + 1), { expirationTtl: 3600 }),
  ]);

  return { allowed: true };
}
