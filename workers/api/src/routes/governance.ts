/**
 * Data Governance aggregation API
 * ═══
 * Read-only aggregation over existing audit_log + tenant_entitlements +
 * erp_connections. No new tables, no schema changes.
 *
 * GET /api/v1/governance/:tenantId
 * - Admin+ may read their own tenant.
 * - Superadmin / support_admin may read any tenant.
 *
 * Response shape:
 *   {
 *     dsar: { exports30d, erasures30d, lastExportAt },
 *     retention: { retentionDays, policy },
 *     auditVolume30d,
 *     encryption: { erpEncrypted, erpPlaintext }
 *   }
 */

import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';

const governance = new Hono<AppBindings>();

function getAuth(c: { get: (key: string) => unknown }): AuthContext | undefined {
  return c.get('auth') as AuthContext | undefined;
}
function isSupportOrAbove(role: string | undefined): boolean {
  return role === 'superadmin' || role === 'support_admin';
}
function isPlatformAdmin(role: string | undefined): boolean {
  return role === 'superadmin' || role === 'support_admin' || role === 'admin';
}

governance.get('/:tenantId', async (c) => {
  const auth = getAuth(c);
  if (!auth) return c.json({ error: 'Unauthorized' }, 401);
  if (!isPlatformAdmin(auth.role)) return c.json({ error: 'Forbidden: admin role required' }, 403);

  const requestedTenantId = c.req.param('tenantId');
  if (!requestedTenantId) return c.json({ error: 'tenantId required' }, 400);

  // Admin: may only read own tenant. Support/superadmin: any tenant.
  if (!isSupportOrAbove(auth.role) && requestedTenantId !== auth.tenantId) {
    return c.json({ error: 'Forbidden: cannot view other tenants' }, 403);
  }
  const tenantId = requestedTenantId;

  try {
    const [exportsRow, erasuresRow, lastExportRow, retentionRow, auditVolumeRow, encryptionRow] = await Promise.all([
      c.env.DB.prepare(
        "SELECT COUNT(*) as count FROM audit_log WHERE tenant_id = ? AND action = 'popia.data_export.completed' AND created_at > datetime('now', '-30 days')",
      ).bind(tenantId).first().catch(() => ({ count: 0 })),
      c.env.DB.prepare(
        "SELECT COUNT(*) as count FROM audit_log WHERE tenant_id = ? AND action = 'popia.erasure.completed' AND created_at > datetime('now', '-30 days')",
      ).bind(tenantId).first().catch(() => ({ count: 0 })),
      c.env.DB.prepare(
        "SELECT MAX(created_at) as last_at FROM audit_log WHERE tenant_id = ? AND action = 'popia.data_export.completed'",
      ).bind(tenantId).first().catch(() => ({ last_at: null })),
      c.env.DB.prepare(
        'SELECT data_retention_days FROM tenant_entitlements WHERE tenant_id = ?',
      ).bind(tenantId).first().catch(() => ({ data_retention_days: null })),
      c.env.DB.prepare(
        "SELECT COUNT(*) as count FROM audit_log WHERE tenant_id = ? AND created_at > datetime('now', '-30 days')",
      ).bind(tenantId).first().catch(() => ({ count: 0 })),
      c.env.DB.prepare(
        // Count ERP connections with credentials stored encrypted vs plaintext.
        "SELECT SUM(CASE WHEN encrypted_config IS NOT NULL AND encrypted_config != '' THEN 1 ELSE 0 END) as encrypted, SUM(CASE WHEN (encrypted_config IS NULL OR encrypted_config = '') AND config != '{}' THEN 1 ELSE 0 END) as plaintext FROM erp_connections WHERE tenant_id = ?",
      ).bind(tenantId).first().catch(() => ({ encrypted: 0, plaintext: 0 })),
    ]);

    const retentionDays = Number((retentionRow as Record<string, unknown>)?.data_retention_days || 0) || null;
    const auditVolume30d = Number((auditVolumeRow as Record<string, unknown>)?.count || 0);

    return c.json({
      success: true,
      tenantId,
      dsar: {
        exports30d: Number((exportsRow as Record<string, unknown>)?.count || 0),
        erasures30d: Number((erasuresRow as Record<string, unknown>)?.count || 0),
        lastExportAt: (lastExportRow as Record<string, unknown>)?.last_at || null,
      },
      retention: {
        retentionDays,
        policy: retentionDays
          ? `All tenant data retained for ${retentionDays} days. After that, tombstoned records may be pruned by automated jobs.`
          : 'No retention policy configured for this tenant. Default platform retention applies.',
      },
      auditVolume30d,
      encryption: {
        erpEncrypted: Number((encryptionRow as Record<string, unknown>)?.encrypted || 0),
        erpPlaintext: Number((encryptionRow as Record<string, unknown>)?.plaintext || 0),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Data governance aggregation failed:', err);
    return c.json({ error: 'Failed to aggregate governance data', details: (err as Error).message }, 500);
  }
});

export default governance;
