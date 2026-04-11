/**
 * SPEC-018: Scheduled Task Scalability
 * Durable cron scheduler with concurrency control, dead-letter queue, and observability.
 */

export interface ScheduledTask {
  id: string;
  name: string;
  cronExpression: string;
  handler: string;
  tenantId?: string;
  enabled: boolean;
  maxRetries: number;
  timeoutMs: number;
  lastRunAt?: string;
  lastRunStatus?: 'success' | 'failure' | 'timeout';
  nextRunAt?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskExecution {
  id: string;
  taskId: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'success' | 'failure' | 'timeout' | 'dead_letter';
  duration?: number;
  error?: string;
  retryCount: number;
}

/** Calculate next run time from cron expression (simplified - supports standard patterns) */
export function getNextRunTime(cron: string, from: Date = new Date()): Date {
  const parts = cron.split(' ');
  if (parts.length !== 5) throw new Error('Invalid cron expression');

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const next = new Date(from);
  next.setSeconds(0, 0);

  // Simple advancement: add 1 minute and check patterns
  for (let i = 0; i < 525960; i++) { // Max ~1 year of minutes
    next.setMinutes(next.getMinutes() + 1);
    if (matchesCron(next, minute, hour, dayOfMonth, month, dayOfWeek)) {
      return next;
    }
  }
  throw new Error('Could not find next run time within 1 year');
}

function matchesCron(date: Date, min: string, hr: string, dom: string, mon: string, dow: string): boolean {
  return matchField(date.getMinutes(), min) &&
    matchField(date.getHours(), hr) &&
    matchField(date.getDate(), dom) &&
    matchField(date.getMonth() + 1, mon) &&
    matchField(date.getDay(), dow);
}

function matchField(value: number, pattern: string): boolean {
  if (pattern === '*') return true;
  if (pattern.includes('/')) {
    const [, step] = pattern.split('/');
    return value % parseInt(step, 10) === 0;
  }
  if (pattern.includes(',')) {
    return pattern.split(',').map(Number).includes(value);
  }
  if (pattern.includes('-')) {
    const [start, end] = pattern.split('-').map(Number);
    return value >= start && value <= end;
  }
  return parseInt(pattern, 10) === value;
}

/** Register default scheduled tasks */
export function getDefaultTasks(): Omit<ScheduledTask, 'id'>[] {
  return [
    {
      name: 'health_score_recalculation',
      cronExpression: '0 */6 * * *',
      handler: 'recalculateHealthScores',
      enabled: true,
      maxRetries: 3,
      timeoutMs: 300000,
    },
    {
      name: 'erp_sync_poll',
      cronExpression: '*/15 * * * *',
      handler: 'pollERPSync',
      enabled: true,
      maxRetries: 2,
      timeoutMs: 120000,
    },
    {
      name: 'anomaly_detection',
      cronExpression: '0 */2 * * *',
      handler: 'runAnomalyDetection',
      enabled: true,
      maxRetries: 2,
      timeoutMs: 180000,
    },
    {
      name: 'audit_log_cleanup',
      cronExpression: '0 3 * * 0',
      handler: 'cleanupAuditLogs',
      enabled: true,
      maxRetries: 1,
      timeoutMs: 600000,
    },
    {
      name: 'report_generation',
      cronExpression: '0 6 * * 1',
      handler: 'generateWeeklyReports',
      enabled: true,
      maxRetries: 3,
      timeoutMs: 300000,
    },
    {
      name: 'subscription_check',
      cronExpression: '0 0 * * *',
      handler: 'checkSubscriptionExpiry',
      enabled: true,
      maxRetries: 2,
      timeoutMs: 60000,
    },
  ];
}

/** Execute a scheduled task with timeout and retry support */
export async function executeTask(
  task: ScheduledTask,
  handlers: Record<string, (task: ScheduledTask) => Promise<void>>,
  db: D1Database,
): Promise<TaskExecution> {
  const executionId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  const execution: TaskExecution = {
    id: executionId,
    taskId: task.id,
    startedAt,
    status: 'running',
    retryCount: 0,
  };

  const handler = handlers[task.handler];
  if (!handler) {
    execution.status = 'failure';
    execution.error = `Handler not found: ${task.handler}`;
    execution.completedAt = new Date().toISOString();
    return execution;
  }

  for (let attempt = 0; attempt <= task.maxRetries; attempt++) {
    execution.retryCount = attempt;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), task.timeoutMs);

      await Promise.race([
        handler(task),
        new Promise((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error('Task timed out')));
        }),
      ]);

      clearTimeout(timeoutId);
      execution.status = 'success';
      execution.completedAt = new Date().toISOString();
      execution.duration = Date.now() - new Date(startedAt).getTime();

      // Update task in DB
      await db.prepare(
        'UPDATE scheduled_tasks SET last_run_at = ?, last_run_status = ? WHERE id = ?'
      ).bind(execution.completedAt, 'success', task.id).run().catch(() => {});

      return execution;
    } catch (err) {
      const errMsg = (err as Error).message;
      if (attempt === task.maxRetries) {
        execution.status = errMsg.includes('timed out') ? 'timeout' : 'failure';
        execution.error = errMsg;
        execution.completedAt = new Date().toISOString();
        execution.duration = Date.now() - new Date(startedAt).getTime();

        // Move to dead letter queue if max retries exceeded
        if (execution.status === 'failure') {
          execution.status = 'dead_letter';
          await db.prepare(
            'INSERT INTO dead_letter_queue (id, task_id, error, execution_data, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))'
          ).bind(crypto.randomUUID(), task.id, errMsg, JSON.stringify(execution)).run().catch(() => {});
        }

        await db.prepare(
          'UPDATE scheduled_tasks SET last_run_at = ?, last_run_status = ? WHERE id = ?'
        ).bind(execution.completedAt, execution.status, task.id).run().catch(() => {});
      }
      // Exponential backoff before retry
      if (attempt < task.maxRetries) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  return execution;
}
