/**
 * Tenant Management API
 * Superadmin-only endpoints for tenant administration
 * Features: List, View, Soft-Delete, Export, Reactivate
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AuthContext } from '../middleware/auth';

const tenants = new Hono();
tenants.use('/*', cors());

/**
 * Middleware: Verify superadmin role
 */
function requireSuperadmin(c: any): boolean {
  const auth = c.get('auth') as AuthContext | undefined;
  return auth?.role === 'superadmin';
}

/**
 * GET /api/v1/admin/tenants
 * List all tenants (superadmin only)
 */
tenants.get('/', async (c) => {
  if (!requireSuperadmin(c)) {
    return c.json({ error: 'Forbidden: Superadmin only' }, 403);
  }

  try {
    const { data } = await c.env.DB.prepare(`
      SELECT 
        t.id, t.name, t.slug, t.industry, t.plan, t.status, t.deployment_model,
        t.region, t.created_at, t.updated_at,
        COUNT(DISTINCT u.id) as user_count,
        COUNT(DISTINCT scr.id) as run_count,
        COUNT(DISTINCT pm.id) as metric_count,
        COUNT(DISTINCT ra.id) as risk_count
      FROM tenants t
      LEFT JOIN users u ON u.tenant_id = t.id
      LEFT JOIN sub_catalyst_runs scr ON scr.tenant_id = t.id
      LEFT JOIN process_metrics pm ON pm.tenant_id = t.id
      LEFT JOIN risk_alerts ra ON ra.tenant_id = t.id
      GROUP BY t.id
      ORDER BY t.created_at DESC
    `).all();

    return c.json({
      success: true,
      count: (data as any[])?.length || 0,
      tenants: data || [],
    });
  } catch (err) {
    console.error('Failed to list tenants:', err);
    return c.json({ error: 'Failed to list tenants', details: (err as Error).message }, 500);
  }
});

/**
 * GET /api/v1/admin/tenants/:id
 * Get detailed tenant information (superadmin only)
 */
tenants.get('/:id', async (c) => {
  if (!requireSuperadmin(c)) {
    return c.json({ error: 'Forbidden: Superadmin only' }, 403);
  }

  const tenantId = c.req.param('id');

  try {
    const tenant = await c.env.DB.prepare(`
      SELECT * FROM tenants WHERE id = ?
    `).bind(tenantId).first();

    if (!tenant) {
      return c.json({ error: 'Tenant not found' }, 404);
    }

    // Get detailed statistics
    const stats = await Promise.all([
      c.env.DB.prepare('SELECT COUNT(*) as count FROM users WHERE tenant_id = ?').bind(tenantId).first(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM catalyst_clusters WHERE tenant_id = ?').bind(tenantId).first(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM sub_catalyst_runs WHERE tenant_id = ?').bind(tenantId).first(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM process_metrics WHERE tenant_id = ?').bind(tenantId).first(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM risk_alerts WHERE tenant_id = ?').bind(tenantId).first(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM health_scores WHERE tenant_id = ?').bind(tenantId).first(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM executive_briefings WHERE tenant_id = ?').bind(tenantId).first(),
      c.env.DB.prepare('SELECT SUM(total_source_value) as total FROM sub_catalyst_runs WHERE tenant_id = ?').bind(tenantId).first(),
    ]);

    return c.json({
      success: true,
      tenant: {
        ...tenant,
        stats: {
          users: (stats[0] as any)?.count || 0,
          clusters: (stats[1] as any)?.count || 0,
          runs: (stats[2] as any)?.count || 0,
          metrics: (stats[3] as any)?.count || 0,
          risks: (stats[4] as any)?.count || 0,
          healthScores: (stats[5] as any)?.count || 0,
          briefings: (stats[6] as any)?.count || 0,
          totalValueProcessed: (stats[7] as any)?.total || 0,
        },
      },
    });
  } catch (err) {
    console.error('Failed to get tenant:', err);
    return c.json({ error: 'Failed to get tenant', details: (err as Error).message }, 500);
  }
});

/**
 * POST /api/v1/admin/tenants/:id/soft-delete
 * Soft-delete a tenant (mark as inactive) - superadmin only
 */
tenants.post('/:id/soft-delete', async (c) => {
  if (!requireSuperadmin(c)) {
    return c.json({ error: 'Forbidden: Superadmin only' }, 403);
  }

  const tenantId = c.req.param('id');
  const { reason, notes } = await c.req.json<{ reason?: string; notes?: string }>();

  try {
    // Verify tenant exists
    const tenant = await c.env.DB.prepare(
      'SELECT id, name, slug, status FROM tenants WHERE id = ?'
    ).bind(tenantId).first();

    if (!tenant) {
      return c.json({ error: 'Tenant not found' }, 404);
    }

    if (tenant.status === 'deleted') {
      return c.json({ error: 'Tenant already deleted' }, 400);
    }

    // Soft-delete: Update status to 'deleted'
    await c.env.DB.prepare(`
      UPDATE tenants 
      SET status = 'deleted', 
          updated_at = ?,
          deleted_at = ?,
          deletion_reason = ?,
          deletion_notes = ?
      WHERE id = ?
    `).bind(
      new Date().toISOString(),
      new Date().toISOString(),
      reason || 'Admin action',
      notes || '',
      tenantId
    ).run();

    // Optionally deactivate all users
    await c.env.DB.prepare(
      'UPDATE users SET status = ? WHERE tenant_id = ?'
    ).bind('inactive', tenantId).run();

    return c.json({
      success: true,
      message: `Tenant "${tenant.name}" soft-deleted successfully`,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: 'deleted',
        deletedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('Failed to soft-delete tenant:', err);
    return c.json({ error: 'Failed to delete tenant', details: (err as Error).message }, 500);
  }
});

/**
 * POST /api/v1/admin/tenants/:id/reactivate
 * Reactivate a soft-deleted tenant - superadmin only
 */
tenants.post('/:id/reactivate', async (c) => {
  if (!requireSuperadmin(c)) {
    return c.json({ error: 'Forbidden: Superadmin only' }, 403);
  }

  const tenantId = c.req.param('id');

  try {
    const tenant = await c.env.DB.prepare(
      'SELECT id, name, slug, status FROM tenants WHERE id = ?'
    ).bind(tenantId).first();

    if (!tenant) {
      return c.json({ error: 'Tenant not found' }, 404);
    }

    if (tenant.status !== 'deleted') {
      return c.json({ error: 'Tenant is not deleted' }, 400);
    }

    // Reactivate: Update status back to 'active'
    await c.env.DB.prepare(`
      UPDATE tenants 
      SET status = 'active', 
          updated_at = ?,
          deleted_at = NULL,
          deletion_reason = NULL,
          deletion_notes = NULL
      WHERE id = ?
    `).bind(new Date().toISOString(), tenantId).run();

    return c.json({
      success: true,
      message: `Tenant "${tenant.name}" reactivated successfully`,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: 'active',
      },
    });
  } catch (err) {
    console.error('Failed to reactivate tenant:', err);
    return c.json({ error: 'Failed to reactivate tenant', details: (err as Error).message }, 500);
  }
});

/**
 * POST /api/v1/admin/tenants/:id/export
 * Export all tenant data as JSON backup - superadmin only
 */
tenants.post('/:id/export', async (c) => {
  if (!requireSuperadmin(c)) {
    return c.json({ error: 'Forbidden: Superadmin only' }, 403);
  }

  const tenantId = c.req.param('id');

  try {
    const tenant = await c.env.DB.prepare(
      'SELECT * FROM tenants WHERE id = ?'
    ).bind(tenantId).first();

    if (!tenant) {
      return c.json({ error: 'Tenant not found' }, 404);
    }

    // Export all tenant data
    const [users, clusters, subCatalysts, runs, runItems, metrics, risks, healthScores, briefings, actions] = await Promise.all([
      c.env.DB.prepare('SELECT * FROM users WHERE tenant_id = ?').bind(tenantId).all(),
      c.env.DB.prepare('SELECT * FROM catalyst_clusters WHERE tenant_id = ?').bind(tenantId).all(),
      c.env.DB.prepare('SELECT * FROM sub_catalyst_kpis WHERE tenant_id = ?').bind(tenantId).all(),
      c.env.DB.prepare('SELECT * FROM sub_catalyst_runs WHERE tenant_id = ?').bind(tenantId).all(),
      c.env.DB.prepare('SELECT * FROM sub_catalyst_run_items WHERE tenant_id = ?').bind(tenantId).all(),
      c.env.DB.prepare('SELECT * FROM process_metrics WHERE tenant_id = ?').bind(tenantId).all(),
      c.env.DB.prepare('SELECT * FROM risk_alerts WHERE tenant_id = ?').bind(tenantId).all(),
      c.env.DB.prepare('SELECT * FROM health_scores WHERE tenant_id = ?').bind(tenantId).all(),
      c.env.DB.prepare('SELECT * FROM executive_briefings WHERE tenant_id = ?').bind(tenantId).all(),
      c.env.DB.prepare('SELECT * FROM catalyst_actions WHERE tenant_id = ?').bind(tenantId).all(),
    ]);

    const exportData = {
      exportDate: new Date().toISOString(),
      tenant,
      data: {
        users: (users as any[]) || [],
        clusters: (clusters as any[]) || [],
        subCatalysts: (subCatalysts as any[]) || [],
        runs: (runs as any[]) || [],
        runItems: (runItems as any[]) || [],
        metrics: (metrics as any[]) || [],
        risks: (risks as any[]) || [],
        healthScores: (healthScores as any[]) || [],
        briefings: (briefings as any[]) || [],
        actions: (actions as any[]) || [],
      },
      summary: {
        users: (users as any[])?.length || 0,
        clusters: (clusters as any[])?.length || 0,
        subCatalysts: (subCatalysts as any[])?.length || 0,
        runs: (runs as any[])?.length || 0,
        runItems: (runItems as any[])?.length || 0,
        metrics: (metrics as any[])?.length || 0,
        risks: (risks as any[])?.length || 0,
        healthScores: (healthScores as any[])?.length || 0,
        briefings: (briefings as any[])?.length || 0,
        actions: (actions as any[])?.length || 0,
      },
    };

    return c.json({
      success: true,
      message: `Exported ${tenant.name} data successfully`,
      export: exportData,
      downloadUrl: `/api/v1/admin/tenants/${tenantId}/export/download`,
    });
  } catch (err) {
    console.error('Failed to export tenant:', err);
    return c.json({ error: 'Failed to export tenant', details: (err as Error).message }, 500);
  }
});

/**
 * GET /api/v1/admin/tenants/:id/export/download
 * Download tenant export as file - superadmin only
 */
tenants.get('/:id/export/download', async (c) => {
  if (!requireSuperadmin(c)) {
    return c.json({ error: 'Forbidden: Superadmin only' }, 403);
  }

  const tenantId = c.req.param('id');

  try {
    const tenant = await c.env.DB.prepare(
      'SELECT name, slug FROM tenants WHERE id = ?'
    ).bind(tenantId).first();

    if (!tenant) {
      return c.json({ error: 'Tenant not found' }, 404);
    }

    // Create export filename
    const filename = `tenant-${tenant.slug}-${new Date().toISOString().split('T')[0]}.json`;

    // Re-fetch all data for download
    const [users, clusters, subCatalysts, runs, runItems, metrics, risks, healthScores, briefings, actions] = await Promise.all([
      c.env.DB.prepare('SELECT * FROM users WHERE tenant_id = ?').bind(tenantId).all(),
      c.env.DB.prepare('SELECT * FROM catalyst_clusters WHERE tenant_id = ?').bind(tenantId).all(),
      c.env.DB.prepare('SELECT * FROM sub_catalyst_kpis WHERE tenant_id = ?').bind(tenantId).all(),
      c.env.DB.prepare('SELECT * FROM sub_catalyst_runs WHERE tenant_id = ?').bind(tenantId).all(),
      c.env.DB.prepare('SELECT * FROM sub_catalyst_run_items WHERE tenant_id = ?').bind(tenantId).all(),
      c.env.DB.prepare('SELECT * FROM process_metrics WHERE tenant_id = ?').bind(tenantId).all(),
      c.env.DB.prepare('SELECT * FROM risk_alerts WHERE tenant_id = ?').bind(tenantId).all(),
      c.env.DB.prepare('SELECT * FROM health_scores WHERE tenant_id = ?').bind(tenantId).all(),
      c.env.DB.prepare('SELECT * FROM executive_briefings WHERE tenant_id = ?').bind(tenantId).all(),
      c.env.DB.prepare('SELECT * FROM catalyst_actions WHERE tenant_id = ?').bind(tenantId).all(),
    ]);

    const exportData = {
      exportDate: new Date().toISOString(),
      tenant: { name: tenant.name, slug: tenant.slug, id: tenantId },
      data: {
        users: (users as any[]) || [],
        clusters: (clusters as any[]) || [],
        subCatalysts: (subCatalysts as any[]) || [],
        runs: (runs as any[]) || [],
        runItems: (runItems as any[]) || [],
        metrics: (metrics as any[]) || [],
        risks: (risks as any[]) || [],
        healthScores: (healthScores as any[]) || [],
        briefings: (briefings as any[]) || [],
        actions: (actions as any[]) || [],
      },
    };

    return c.json(exportData, 200, {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
  } catch (err) {
    console.error('Failed to download export:', err);
    return c.json({ error: 'Failed to download export', details: (err as Error).message }, 500);
  }
});

/**
 * DELETE /api/v1/admin/tenants/:id/permanent-delete
 * Permanently delete a tenant and ALL data - superadmin only, DANGEROUS
 * Requires confirmation header: X-Confirm-Delete: true
 */
tenants.delete('/:id/permanent-delete', async (c) => {
  if (!requireSuperadmin(c)) {
    return c.json({ error: 'Forbidden: Superadmin only' }, 403);
  }

  const confirmHeader = c.req.header('X-Confirm-Delete');
  if (confirmHeader !== 'true') {
    return c.json({ 
      error: 'Confirmation required',
      message: 'Add header X-Confirm-Delete: true to confirm permanent deletion',
      warning: 'This action is IRREVERSIBLE. All tenant data will be permanently deleted.'
    }, 400);
  }

  const tenantId = c.req.param('id');
  const { reason } = await c.req.json<{ reason: string }>();

  try {
    const tenant = await c.env.DB.prepare(
      'SELECT id, name, slug FROM tenants WHERE id = ?'
    ).bind(tenantId).first();

    if (!tenant) {
      return c.json({ error: 'Tenant not found' }, 404);
    }

    // Delete in order (respecting foreign keys)
    const tables = [
      'sub_catalyst_run_items',
      'run_comments',
      'sub_catalyst_kpi_values',
      'sub_catalyst_runs',
      'catalyst_run_analytics',
      'health_score_history',
      'health_scores',
      'risk_alerts',
      'anomalies',
      'process_metrics',
      'process_flows',
      'correlation_events',
      'catalyst_actions',
      'executive_briefings',
      'scenarios',
      'run_insights',
      'sub_catalyst_kpi_definitions',
      'sub_catalyst_kpis',
      'catalyst_clusters',
      'users',
      'tenants',
    ];

    let deletedCount = 0;
    for (const table of tables) {
      const result = await c.env.DB.prepare(
        `DELETE FROM ${table} WHERE tenant_id = ? OR id = ?`
      ).bind(tenantId, tenantId).run();
      deletedCount += result.changes || 0;
    }

    // Log deletion for audit
    await c.env.DB.prepare(`
      INSERT INTO audit_logs (id, tenant_id, action, actor_id, actor_role, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      tenantId,
      'tenant_permanent_delete',
      (c.get('auth') as AuthContext)?.userId || 'system',
      'superadmin',
      JSON.stringify({ tenantName: tenant.name, reason: reason || 'Admin action' }),
      new Date().toISOString()
    ).run();

    return c.json({
      success: true,
      message: `Tenant "${tenant.name}" permanently deleted`,
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      recordsDeleted: deletedCount,
      warning: 'This action cannot be undone',
    });
  } catch (err) {
    console.error('Failed to permanent-delete tenant:', err);
    return c.json({ error: 'Failed to delete tenant', details: (err as Error).message }, 500);
  }
});

export default tenants;
