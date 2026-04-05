/**
 * Catalyst Intelligence Routes
 * 
 * Pattern analysis, effectiveness tracking, and dependency mapping API.
 * All routes are tenant-isolated via getTenantId().
 */

import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import {
  discoverPatterns,
  calculateEffectiveness,
  discoverDependencies,
  getPatterns,
  getEffectiveness,
  getDependencies,
} from '../services/pattern-engine';

const catalystIntelligence = new Hono<AppBindings>();

const CROSS_TENANT_ROLES = new Set(['superadmin', 'support_admin']);
function getTenantId(c: { get: (key: string) => unknown; req: { query: (key: string) => string | undefined } }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  const defaultTenantId = auth?.tenantId || c.req.query('tenant_id') || '';
  if (CROSS_TENANT_ROLES.has(auth?.role || '')) {
    return c.req.query('tenant_id') || defaultTenantId;
  }
  return defaultTenantId;
}

// POST /api/catalyst-intelligence/analyse — Discover patterns from run data
catalystIntelligence.post('/analyse', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);

  try {
    const patterns = await discoverPatterns(c.env.DB, c.env.AI, tenantId);
    return c.json({ patterns, discovered: patterns.length }, 201);
  } catch (err) {
    return c.json({ error: 'Pattern analysis failed', detail: (err as Error).message }, 500);
  }
});

// GET /api/catalyst-intelligence/patterns — List discovered patterns
catalystIntelligence.get('/patterns', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);

  const status = c.req.query('status');
  const type = c.req.query('type');
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10) || 20, 100);

  try {
    const patterns = await getPatterns(c.env.DB, tenantId, {
      status: status || undefined,
      type: type || undefined,
      limit,
    });
    return c.json({ patterns, total: patterns.length });
  } catch (err) {
    return c.json({ error: 'Failed to fetch patterns', detail: (err as Error).message }, 500);
  }
});

// PUT /api/catalyst-intelligence/patterns/:patternId — Update pattern status
catalystIntelligence.put('/patterns/:patternId', async (c) => {
  const tenantId = getTenantId(c);
  const patternId = c.req.param('patternId');
  const body = await c.req.json<{ status?: string; severity?: string }>();

  const updates: string[] = [];
  const binds: unknown[] = [];

  if (body.status) {
    const validStatuses = ['active', 'resolved', 'monitoring'];
    if (validStatuses.includes(body.status)) {
      updates.push('status = ?');
      binds.push(body.status);
    }
  }
  if (body.severity) {
    const validSeverities = ['critical', 'high', 'medium', 'low'];
    if (validSeverities.includes(body.severity)) {
      updates.push('severity = ?');
      binds.push(body.severity);
    }
  }

  if (updates.length === 0) return c.json({ error: 'No valid fields to update' }, 400);

  await c.env.DB.prepare(
    `UPDATE catalyst_patterns SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...binds, patternId, tenantId).run();

  return c.json({ success: true });
});

// GET /api/catalyst-intelligence/effectiveness — Get effectiveness metrics
catalystIntelligence.get('/effectiveness', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);

  const clusterId = c.req.query('cluster_id');

  try {
    const effectiveness = await getEffectiveness(c.env.DB, tenantId, clusterId || undefined);
    return c.json({ effectiveness, total: effectiveness.length });
  } catch (err) {
    return c.json({ error: 'Failed to fetch effectiveness data', detail: (err as Error).message }, 500);
  }
});

// POST /api/catalyst-intelligence/effectiveness/calculate — Recalculate effectiveness
catalystIntelligence.post('/effectiveness/calculate', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);

  const body = await c.req.json<{ period_days?: number }>().catch(() => ({ period_days: 30 }));
  const periodDays = Math.min(Math.max(body.period_days || 30, 7), 365);

  try {
    const effectiveness = await calculateEffectiveness(c.env.DB, tenantId, periodDays);
    return c.json({ effectiveness, total: effectiveness.length, periodDays }, 201);
  } catch (err) {
    return c.json({ error: 'Effectiveness calculation failed', detail: (err as Error).message }, 500);
  }
});

// GET /api/catalyst-intelligence/dependencies — Get dependency map
catalystIntelligence.get('/dependencies', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);

  const clusterId = c.req.query('cluster_id');

  try {
    const dependencies = await getDependencies(c.env.DB, tenantId, clusterId || undefined);
    return c.json({ dependencies, total: dependencies.length });
  } catch (err) {
    return c.json({ error: 'Failed to fetch dependencies', detail: (err as Error).message }, 500);
  }
});

// POST /api/catalyst-intelligence/dependencies/discover — Discover dependencies via LLM
catalystIntelligence.post('/dependencies/discover', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);

  try {
    const dependencies = await discoverDependencies(c.env.DB, c.env.AI, tenantId);
    return c.json({ dependencies, discovered: dependencies.length }, 201);
  } catch (err) {
    return c.json({ error: 'Dependency discovery failed', detail: (err as Error).message }, 500);
  }
});

// GET /api/catalyst-intelligence/overview — Combined overview of patterns, effectiveness, dependencies
catalystIntelligence.get('/overview', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);

  try {
    const [patterns, effectiveness, dependencies] = await Promise.all([
      getPatterns(c.env.DB, tenantId, { limit: 10 }),
      getEffectiveness(c.env.DB, tenantId),
      getDependencies(c.env.DB, tenantId),
    ]);

    // Compute summary stats
    const activePatterns = patterns.filter(p => p.status === 'active').length;
    const criticalPatterns = patterns.filter(p => p.severity === 'critical').length;
    const avgSuccessRate = effectiveness.length > 0
      ? effectiveness.reduce((sum, e) => sum + e.success_rate, 0) / effectiveness.length
      : 0;
    const totalValueProcessed = effectiveness.reduce((sum, e) => sum + e.total_value_processed, 0);
    const avgRoi = effectiveness.length > 0
      ? effectiveness.reduce((sum, e) => sum + e.roi_estimate, 0) / effectiveness.length
      : 0;

    return c.json({
      summary: {
        activePatterns,
        criticalPatterns,
        totalSubCatalysts: effectiveness.length,
        avgSuccessRate: Math.round(avgSuccessRate * 100) / 100,
        totalValueProcessed,
        avgRoi: Math.round(avgRoi * 100) / 100,
        totalDependencies: dependencies.length,
      },
      patterns,
      effectiveness,
      dependencies,
    });
  } catch (err) {
    return c.json({ error: 'Failed to fetch overview', detail: (err as Error).message }, 500);
  }
});

export default catalystIntelligence;
