/**
 * Phase 6.1: Data Retention Enforcement
 * Enforces per-tenant data retention policies by purging expired records.
 * Called from the scheduled handler (cron trigger).
 */

export interface RetentionResult {
  tenantsProcessed: number;
  recordsPurged: number;
  errors: string[];
  durationMs: number;
}

/** Tables with created_at columns eligible for retention purge */
const RETENTION_TABLES = [
  { table: 'audit_log', dateColumn: 'created_at' },
  { table: 'mind_queries', dateColumn: 'created_at' },
  { table: 'notifications', dateColumn: 'created_at' },
  { table: 'email_queue', dateColumn: 'created_at' },
  { table: 'execution_logs', dateColumn: 'created_at' },
  { table: 'catalyst_actions', dateColumn: 'created_at' },
  // Spec 7: Additional date-stamped tables for retention purge
  { table: 'sub_catalyst_runs', dateColumn: 'started_at' },
  { table: 'sub_catalyst_run_items', dateColumn: 'created_at' },
  { table: 'sub_catalyst_kpi_values', dateColumn: 'recorded_at' },
  { table: 'run_comments', dateColumn: 'created_at' },
  { table: 'health_score_history', dateColumn: 'recorded_at' },
  { table: 'catalyst_run_analytics', dateColumn: 'created_at' },
] as const;

/**
 * Enforce data retention for all tenants.
 * Reads each tenant's data_retention_days from tenant_entitlements,
 * then deletes records older than that threshold.
 */
export async function enforceRetention(db: D1Database): Promise<RetentionResult> {
  const t0 = Date.now();
  const result: RetentionResult = { tenantsProcessed: 0, recordsPurged: 0, errors: [], durationMs: 0 };

  try {
    const tenants = await db.prepare(
      `SELECT t.id, COALESCE(te.data_retention_days, 90) as retention_days
       FROM tenants t LEFT JOIN tenant_entitlements te ON t.id = te.tenant_id
       WHERE t.status = 'active'`
    ).all<{ id: string; retention_days: number }>();

    for (const tenant of tenants.results) {
      result.tenantsProcessed++;
      const cutoffDate = new Date(Date.now() - tenant.retention_days * 86400000).toISOString();

      for (const { table, dateColumn } of RETENTION_TABLES) {
        try {
          const del = await db.prepare(
            `DELETE FROM ${table} WHERE tenant_id = ? AND ${dateColumn} < ?`
          ).bind(tenant.id, cutoffDate).run();
          result.recordsPurged += del.meta?.changes || 0;
        } catch (err) {
          result.errors.push(`${table}@${tenant.id}: ${(err as Error).message}`);
        }
      }
    }
  } catch (err) {
    result.errors.push(`Retention: ${(err as Error).message}`);
  }

  result.durationMs = Date.now() - t0;
  return result;
}
