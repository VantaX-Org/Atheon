/**
 * Tenant Management API
 * Superadmin-only endpoints for tenant administration
 * Features: List, View, Soft-Delete, Export, Reactivate
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AuthContext, AppBindings } from '../types';

const tenants = new Hono<AppBindings>();
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
tenants.get('/tenants', async (c) => {
  if (!requireSuperadmin(c)) {
    return c.json({ error: 'Forbidden: Superadmin only' }, 403);
  }

  try {
    const queryResult = await c.env.DB.prepare(`
      SELECT 
        id, name, slug, industry, plan, status, deployment_model, region,
        created_at, updated_at,
        CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END as is_deleted,
        deleted_at
      FROM tenants
      ORDER BY created_at DESC
    `).all();
    const data = queryResult.results || [];

    // Get data counts for each tenant
    const tenantsWithCounts = [];
    for (const tenant of data as any[]) {
      const counts = await Promise.all([
        c.env.DB.prepare('SELECT COUNT(*) as count FROM sub_catalyst_runs WHERE tenant_id = ?').bind(tenant.id).first(),
        c.env.DB.prepare('SELECT COUNT(*) as count FROM process_metrics WHERE tenant_id = ?').bind(tenant.id).first(),
        c.env.DB.prepare('SELECT COUNT(*) as count FROM risk_alerts WHERE tenant_id = ?').bind(tenant.id).first(),
        c.env.DB.prepare('SELECT COUNT(*) as count FROM users WHERE tenant_id = ?').bind(tenant.id).first(),
      ]);

      tenantsWithCounts.push({
        ...tenant,
        data: {
          runs: (counts[0] as any)?.count || 0,
          metrics: (counts[1] as any)?.count || 0,
          risks: (counts[2] as any)?.count || 0,
          users: (counts[3] as any)?.count || 0,
        },
      });
    }

    return c.json({
      success: true,
      tenants: tenantsWithCounts,
      total: tenantsWithCounts.length,
      active: tenantsWithCounts.filter((t: any) => !t.is_deleted).length,
      deleted: tenantsWithCounts.filter((t: any) => t.is_deleted).length,
    });
  } catch (err) {
    console.error('List tenants failed:', err);
    return c.json({ error: 'Failed to list tenants', details: (err as Error).message }, 500);
  }
});

/**
 * GET /api/v1/admin/tenants/:id
 * Get detailed tenant information (superadmin only)
 */
tenants.get('/tenants/:id', async (c) => {
  if (!requireSuperadmin(c)) {
    return c.json({ error: 'Forbidden: Superadmin only' }, 403);
  }

  const tenantId = c.req.param('id');

  try {
    const tenant = await c.env.DB.prepare(`
      SELECT 
        id, name, slug, industry, plan, status, deployment_model, region,
        config, created_at, updated_at,
        CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END as is_deleted,
        deleted_at, deleted_by
      FROM tenants
      WHERE id = ?
    `).bind(tenantId).first();

    if (!tenant) {
      return c.json({ error: 'Tenant not found' }, 404);
    }

    // Get comprehensive data counts
    const counts = await Promise.all([
      c.env.DB.prepare('SELECT COUNT(*) as count FROM sub_catalyst_runs WHERE tenant_id = ?').bind(tenantId).first(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM process_metrics WHERE tenant_id = ?').bind(tenantId).first(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM risk_alerts WHERE tenant_id = ?').bind(tenantId).first(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM health_scores WHERE tenant_id = ?').bind(tenantId).first(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM executive_briefings WHERE tenant_id = ?').bind(tenantId).first(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM users WHERE tenant_id = ?').bind(tenantId).first(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM catalyst_clusters WHERE tenant_id = ?').bind(tenantId).first(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM sub_catalyst_run_items WHERE tenant_id = ?').bind(tenantId).first(),
    ]);

    return c.json({
      success: true,
      tenant: {
        ...tenant,
        data: {
          runs: (counts[0] as any)?.count || 0,
          metrics: (counts[1] as any)?.count || 0,
          risks: (counts[2] as any)?.count || 0,
          healthScores: (counts[3] as any)?.count || 0,
          briefings: (counts[4] as any)?.count || 0,
          users: (counts[5] as any)?.count || 0,
          clusters: (counts[6] as any)?.count || 0,
          runItems: (counts[7] as any)?.count || 0,
        },
      },
    });
  } catch (err) {
    console.error('Get tenant failed:', err);
    return c.json({ error: 'Failed to get tenant', details: (err as Error).message }, 500);
  }
});

/**
 * POST /api/v1/admin/tenants/:id/soft-delete
 * Soft-delete a tenant (superadmin only)
 */
tenants.post('/tenants/:id/soft-delete', async (c) => {
  if (!requireSuperadmin(c)) {
    return c.json({ error: 'Forbidden: Superadmin only' }, 403);
  }

  const tenantId = c.req.param('id');
  const auth = c.get('auth') as AuthContext;
  const now = new Date().toISOString();

  try {
    // Check if tenant exists and is not already deleted
    const tenant = await c.env.DB.prepare(
      'SELECT id, name, slug, deleted_at FROM tenants WHERE id = ?'
    ).bind(tenantId).first<{ id: string; name: string; slug: string; deleted_at: string | null }>();

    if (!tenant) {
      return c.json({ error: 'Tenant not found' }, 404);
    }

    if (tenant.deleted_at) {
      return c.json({ error: 'Tenant is already deleted', deletedAt: tenant.deleted_at }, 400);
    }

    // Prevent deleting VantaX demo tenant accidentally
    if (tenant.slug === 'vantax') {
      return c.json({ 
        error: 'Cannot delete VantaX demo tenant',
        message: 'This is the demo tenant. Use the seeder to reset instead.'
      }, 400);
    }

    // Soft-delete: Set deleted_at and deleted_by
    await c.env.DB.prepare(`
      UPDATE tenants 
      SET deleted_at = ?, deleted_by = ?, status = 'suspended', updated_at = ?
      WHERE id = ?
    `).bind(now, auth.userId, now, tenantId).run();

    // Also suspend all users for this tenant
    await c.env.DB.prepare(`
      UPDATE users SET status = 'suspended', updated_at = ? WHERE tenant_id = ?
    `).bind(now, tenantId).run();

    return c.json({
      success: true,
      message: `Tenant "${tenant.name}" has been soft-deleted`,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        deletedAt: now,
        deletedBy: auth.userId,
      },
    });
  } catch (err) {
    console.error('Soft-delete tenant failed:', err);
    return c.json({ error: 'Failed to soft-delete tenant', details: (err as Error).message }, 500);
  }
});

/**
 * POST /api/v1/admin/tenants/:id/reactivate
 * Reactivate a soft-deleted tenant (superadmin only)
 */
tenants.post('/tenants/:id/reactivate', async (c) => {
  if (!requireSuperadmin(c)) {
    return c.json({ error: 'Forbidden: Superadmin only' }, 403);
  }

  const tenantId = c.req.param('id');
  const now = new Date().toISOString();

  try {
    const tenant = await c.env.DB.prepare(
      'SELECT id, name, slug, deleted_at FROM tenants WHERE id = ?'
    ).bind(tenantId).first<{ id: string; name: string; slug: string; deleted_at: string | null }>();

    if (!tenant) {
      return c.json({ error: 'Tenant not found' }, 404);
    }

    if (!tenant.deleted_at) {
      return c.json({ error: 'Tenant is not deleted', status: 'active' }, 400);
    }

    // Reactivate: Clear deleted_at, set status back to active
    await c.env.DB.prepare(`
      UPDATE tenants 
      SET deleted_at = NULL, deleted_by = NULL, status = 'active', updated_at = ?
      WHERE id = ?
    `).bind(now, tenantId).run();

    // Reactivate all users for this tenant
    await c.env.DB.prepare(`
      UPDATE users SET status = 'active', updated_at = ? WHERE tenant_id = ?
    `).bind(now, tenantId).run();

    return c.json({
      success: true,
      message: `Tenant "${tenant.name}" has been reactivated`,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        reactivatedAt: now,
      },
    });
  } catch (err) {
    console.error('Reactivate tenant failed:', err);
    return c.json({ error: 'Failed to reactivate tenant', details: (err as Error).message }, 500);
  }
});

/**
 * GET /api/v1/admin/tenants/:id/export
 * Export all tenant data as JSON (superadmin only)
 */
tenants.get('/tenants/:id/export', async (c) => {
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
    const [users, clusters, subKpis, runs, runItems, metrics, risks, healthScores, briefings] = await Promise.all([
      c.env.DB.prepare('SELECT * FROM users WHERE tenant_id = ?').bind(tenantId).all(),
      c.env.DB.prepare('SELECT * FROM catalyst_clusters WHERE tenant_id = ?').bind(tenantId).all(),
      c.env.DB.prepare('SELECT * FROM sub_catalyst_kpis WHERE tenant_id = ?').bind(tenantId).all(),
      c.env.DB.prepare('SELECT * FROM sub_catalyst_runs WHERE tenant_id = ?').bind(tenantId).all(),
      c.env.DB.prepare('SELECT * FROM sub_catalyst_run_items WHERE tenant_id = ?').bind(tenantId).all(),
      c.env.DB.prepare('SELECT * FROM process_metrics WHERE tenant_id = ?').bind(tenantId).all(),
      c.env.DB.prepare('SELECT * FROM risk_alerts WHERE tenant_id = ?').bind(tenantId).all(),
      c.env.DB.prepare('SELECT * FROM health_scores WHERE tenant_id = ?').bind(tenantId).all(),
      c.env.DB.prepare('SELECT * FROM executive_briefings WHERE tenant_id = ?').bind(tenantId).all(),
    ]);

    const exportData = {
      exportDate: new Date().toISOString(),
      tenant: {
        ...tenant,
        // Remove sensitive fields
        config: undefined,
      },
      data: {
        users: users.results || [],
        clusters: clusters.results || [],
        subCatalystKpis: subKpis.results || [],
        runs: runs.results || [],
        runItems: runItems.results || [],
        metrics: metrics.results || [],
        risks: risks.results || [],
        healthScores: healthScores.results || [],
        briefings: briefings.results || [],
      },
      summary: {
        users: (users.results || []).length,
        clusters: (clusters.results || []).length,
        subCatalystKpis: (subKpis.results || []).length,
        runs: (runs.results || []).length,
        runItems: (runItems.results || []).length,
        metrics: (metrics.results || []).length,
        risks: (risks.results || []).length,
        healthScores: (healthScores.results || []).length,
        briefings: (briefings.results || []).length,
        totalRecords: 
          (users.results || []).length +
          (clusters.results || []).length +
          (subKpis.results || []).length +
          (runs.results || []).length +
          (runItems.results || []).length +
          (metrics.results || []).length +
          (risks.results || []).length +
          (healthScores.results || []).length +
          (briefings.results || []).length,
      },
    };

    // Return as JSON file download
    c.header('Content-Type', 'application/json');
    c.header('Content-Disposition', `attachment; filename="tenant-export-${(tenant as any).slug}-${new Date().toISOString().split('T')[0]}.json"`);
    
    return c.json(exportData);
  } catch (err) {
    console.error('Export tenant failed:', err);
    return c.json({ error: 'Failed to export tenant', details: (err as Error).message }, 500);
  }
});

/**
 * DELETE /api/v1/admin/tenants/:id/hard-delete
 * Permanently delete a soft-deleted tenant and all data (superadmin only)
 * DANGEROUS - Tenant must be soft-deleted first
 */
tenants.delete('/tenants/:id/hard-delete', async (c) => {
  if (!requireSuperadmin(c)) {
    return c.json({ error: 'Forbidden: Superadmin only' }, 403);
  }

  const tenantId = c.req.param('id');
  const auth = c.get('auth') as AuthContext;

  try {
    // Verify tenant exists and is already soft-deleted
    const tenant = await c.env.DB.prepare(
      'SELECT id, name, slug, deleted_at FROM tenants WHERE id = ?'
    ).bind(tenantId).first<{ id: string; name: string; slug: string; deleted_at: string | null }>();

    if (!tenant) {
      return c.json({ error: 'Tenant not found' }, 404);
    }

    if (!tenant.deleted_at) {
      return c.json({ 
        error: 'Cannot hard-delete active tenant',
        message: 'Tenant must be soft-deleted first, then hard-delete after 24 hours'
      }, 400);
    }

    // Check if 24 hours have passed since soft-delete
    const deletedAt = new Date(tenant.deleted_at);
    const now = new Date();
    const hoursSinceDelete = (now.getTime() - deletedAt.getTime()) / (1000 * 60 * 60);

    if (hoursSinceDelete < 24) {
      return c.json({ 
        error: 'Hard-delete not allowed yet',
        message: `Please wait ${Math.ceil(24 - hoursSinceDelete)} more hours before permanent deletion`,
        deletedAt: tenant.deleted_at,
        allowedAfter: new Date(deletedAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      }, 400);
    }

    // Delete all tenant data in order (respecting foreign keys)
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
      'sub_catalyst_kpis',
      'sub_catalyst_kpi_definitions',
      'catalyst_clusters',
      'users',
      'tenants', // Finally delete the tenant itself
    ];

    let deletedCount = 0;
    for (const table of tables) {
      const result = await c.env.DB.prepare(
        `DELETE FROM ${table} WHERE tenant_id = ?`
      ).bind(tenantId).run();
      deletedCount += (result.meta as any)?.changes || 0;
    }

    // Log the deletion
    console.log(`[AUDIT] Tenant "${tenant.name}" (${tenant.slug}) permanently deleted by ${auth.userId}`);
    console.log(`[AUDIT] Total records deleted: ${deletedCount}`);

    return c.json({
      success: true,
      message: `Tenant "${tenant.name}" and all associated data permanently deleted`,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
      },
      audit: {
        deletedBy: auth.userId,
        deletedAt: now.toISOString(),
        totalRecordsDeleted: deletedCount,
        tablesAffected: tables.length,
      },
    });
  } catch (err) {
    console.error('Hard-delete tenant failed:', err);
    return c.json({ error: 'Failed to hard-delete tenant', details: (err as Error).message }, 500);
  }
});

export default tenants;
