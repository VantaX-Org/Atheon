/**
 * SPEC-012: Enhanced Audit Log Service
 * Structured audit events with entity tracking, diff capture, and retention policies.
 */

export interface AuditEvent {
  tenantId: string;
  userId: string;
  action: string;
  layer: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  diff?: { before: Record<string, unknown>; after: Record<string, unknown> };
  outcome: 'success' | 'failure' | 'denied';
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

/** Write a structured audit log entry with optional diff tracking */
export async function writeAuditLog(db: D1Database, event: AuditEvent): Promise<void> {
  const id = crypto.randomUUID();
  const detailsJson = JSON.stringify({
    ...event.details,
    ...(event.diff ? { _diff: event.diff } : {}),
    ...(event.ip ? { _ip: event.ip } : {}),
    ...(event.userAgent ? { _userAgent: event.userAgent } : {}),
    ...(event.requestId ? { _requestId: event.requestId } : {}),
  });

  try {
    await db.prepare(
      `INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(id, event.tenantId, event.userId, event.action, event.layer, event.resource, detailsJson, event.outcome).run();
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}

/** Batch write multiple audit events (for bulk operations) */
export async function writeAuditBatch(db: D1Database, events: AuditEvent[]): Promise<void> {
  const batch = events.map(event => {
    const id = crypto.randomUUID();
    const detailsJson = JSON.stringify(event.details || {});
    return db.prepare(
      `INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(id, event.tenantId, event.userId, event.action, event.layer, event.resource, detailsJson, event.outcome);
  });

  try {
    await db.batch(batch);
  } catch (err) {
    console.error('Failed to write audit batch:', err);
  }
}

/** Purge audit logs older than the retention period (default 90 days) */
export async function purgeOldAuditLogs(db: D1Database, retentionDays: number = 90): Promise<number> {
  try {
    const result = await db.prepare(
      `DELETE FROM audit_log WHERE created_at < datetime('now', '-' || ? || ' days')`
    ).bind(retentionDays).run();
    return result.meta.changes || 0;
  } catch (err) {
    console.error('Failed to purge audit logs:', err);
    return 0;
  }
}

/** Query audit logs with filters */
export interface AuditQueryParams {
  tenantId: string;
  userId?: string;
  action?: string;
  layer?: string;
  resource?: string;
  outcome?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export async function queryAuditLogs(db: D1Database, params: AuditQueryParams) {
  const conditions: string[] = ['tenant_id = ?'];
  const binds: unknown[] = [params.tenantId];

  if (params.userId) { conditions.push('user_id = ?'); binds.push(params.userId); }
  if (params.action) { conditions.push('action = ?'); binds.push(params.action); }
  if (params.layer) { conditions.push('layer = ?'); binds.push(params.layer); }
  if (params.resource) { conditions.push('resource = ?'); binds.push(params.resource); }
  if (params.outcome) { conditions.push('outcome = ?'); binds.push(params.outcome); }
  if (params.startDate) { conditions.push('created_at >= ?'); binds.push(params.startDate); }
  if (params.endDate) { conditions.push('created_at <= ?'); binds.push(params.endDate); }

  const where = conditions.join(' AND ');
  const limit = params.limit || 50;
  const offset = params.offset || 0;

  const [countResult, results] = await Promise.all([
    db.prepare(`SELECT COUNT(*) as total FROM audit_log WHERE ${where}`).bind(...binds).first<{ total: number }>(),
    db.prepare(`SELECT * FROM audit_log WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...binds, limit, offset).all(),
  ]);

  return {
    entries: results.results,
    total: countResult?.total || 0,
    limit,
    offset,
  };
}
