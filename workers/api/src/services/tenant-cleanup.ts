/**
 * Phase 6.5: Tenant Data Cleanup on Reset
 * Provides comprehensive data purge for tenant reset operations.
 * Deletes all tenant-specific data across all tables while preserving
 * the tenant record itself and its entitlements.
 */

export interface CleanupResult {
  tenantId: string;
  tablesCleared: string[];
  totalRowsDeleted: number;
  errors: string[];
  durationMs: number;
}

/** All tables that contain tenant_id column, in dependency-safe deletion order */
const TENANT_TABLES = [
  // Dependent tables first (foreign keys)
  'execution_logs',
  'catalyst_actions',
  'agent_deployments',
  'graph_relationships',
  'graph_entities',
  'mind_queries',
  'chat_conversations',
  'notifications',
  'email_queue',
  'documents',
  'webhooks',
  'scenarios',
  'anomalies',
  'process_flows',
  'process_metrics',
  'correlation_events',
  'risk_alerts',
  'health_scores',
  'executive_briefings',
  'audit_log',
  'password_reset_tokens',
  'api_keys',
  'user_sessions',
  'assessments',
  'managed_deployments',
  // ERP tables
  'erp_bank_transactions',
  'erp_tax_entries',
  'erp_journal_entries',
  'erp_gl_accounts',
  'erp_employees',
  'erp_purchase_orders',
  'erp_invoices',
  'erp_products',
  'erp_suppliers',
  'erp_customers',
  'erp_connections',
  // Sub-catalyst operations tables
  'run_comments',
  'sub_catalyst_run_items',
  'sub_catalyst_kpi_values',
  'sub_catalyst_runs',
  'sub_catalyst_kpi_definitions',
  'sub_catalyst_kpis',
  // Analytics & history tables
  'health_score_history',
  'catalyst_run_analytics',
  'catalyst_hitl_config',
  // Parent tables last
  'catalyst_clusters',
  'iam_policies',
  'sso_configs',
] as const;

/**
 * Purge all data for a specific tenant.
 * Preserves: tenants row, tenant_entitlements row, users (optionally).
 * @param db - D1Database
 * @param tenantId - Tenant ID to purge
 * @param preserveUsers - If true, keep user accounts (default: true)
 */
export async function cleanupTenantData(
  db: D1Database,
  tenantId: string,
  preserveUsers: boolean = true,
): Promise<CleanupResult> {
  const t0 = Date.now();
  const result: CleanupResult = {
    tenantId,
    tablesCleared: [],
    totalRowsDeleted: 0,
    errors: [],
    durationMs: 0,
  };

  for (const table of TENANT_TABLES) {
    try {
      const del = await db.prepare(
        `DELETE FROM ${table} WHERE tenant_id = ?`
      ).bind(tenantId).run();
      const deleted = del.meta?.changes || 0;
      if (deleted > 0) {
        result.tablesCleared.push(table);
        result.totalRowsDeleted += deleted;
      }
    } catch (err) {
      // Table might not exist yet — non-fatal
      result.errors.push(`${table}: ${(err as Error).message}`);
    }
  }

  // Optionally clear users (except the admin)
  if (!preserveUsers) {
    try {
      const del = await db.prepare(
        `DELETE FROM users WHERE tenant_id = ? AND role NOT IN ('superadmin', 'support_admin')`
      ).bind(tenantId).run();
      const deleted = del.meta?.changes || 0;
      if (deleted > 0) {
        result.tablesCleared.push('users (non-admin)');
        result.totalRowsDeleted += deleted;
      }
    } catch (err) {
      result.errors.push(`users: ${(err as Error).message}`);
    }
  }

  // Reset tenant entitlements counters
  try {
    await db.prepare(
      `UPDATE tenant_entitlements SET api_calls_used = 0, storage_used_gb = 0 WHERE tenant_id = ?`
    ).bind(tenantId).run();
  } catch {
    // Column might not exist — non-fatal
  }

  result.durationMs = Date.now() - t0;
  return result;
}
