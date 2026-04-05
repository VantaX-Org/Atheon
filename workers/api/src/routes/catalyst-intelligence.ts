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

// ── snake_case → camelCase mappers ──

function mapPattern(p: { id: string; tenant_id: string; pattern_type: string; title: string; description: string; frequency: number; first_seen: string; last_seen: string; affected_clusters: string[]; affected_sub_catalysts: string[]; severity: string; status: string; recommended_actions: string[]; created_at: string }) {
  return {
    id: p.id,
    patternType: p.pattern_type,
    title: p.title,
    description: p.description,
    frequency: p.frequency,
    firstSeen: p.first_seen,
    lastSeen: p.last_seen,
    affectedClusters: p.affected_clusters,
    affectedSubCatalysts: p.affected_sub_catalysts,
    severity: p.severity,
    status: p.status,
    recommendedActions: p.recommended_actions,
    createdAt: p.created_at,
  };
}

function mapEffectiveness(e: { id: string; tenant_id: string; cluster_id: string; sub_catalyst_name: string; period_start: string; period_end: string; runs_count: number; success_rate: number; avg_match_rate: number; avg_duration_ms: number; total_value_processed: number; total_exceptions: number; improvement_trend: number; roi_estimate: number; created_at: string }) {
  return {
    id: e.id,
    clusterId: e.cluster_id,
    subCatalystName: e.sub_catalyst_name,
    periodStart: e.period_start,
    periodEnd: e.period_end,
    runsCount: e.runs_count,
    successRate: e.success_rate,
    avgMatchRate: e.avg_match_rate,
    avgDurationMs: e.avg_duration_ms,
    totalValueProcessed: e.total_value_processed,
    totalExceptions: e.total_exceptions,
    improvementTrend: e.improvement_trend,
    roiEstimate: e.roi_estimate,
    createdAt: e.created_at,
  };
}

function mapDependency(d: { id: string; tenant_id: string; source_cluster_id: string; source_sub_catalyst: string; target_cluster_id: string; target_sub_catalyst: string; dependency_type: string; strength: number; description?: string; discovered_at: string }) {
  return {
    id: d.id,
    sourceClusterId: d.source_cluster_id,
    sourceSubCatalyst: d.source_sub_catalyst,
    targetClusterId: d.target_cluster_id,
    targetSubCatalyst: d.target_sub_catalyst,
    dependencyType: d.dependency_type,
    strength: d.strength,
    description: d.description,
    discoveredAt: d.discovered_at,
  };
}

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
    const raw = await discoverPatterns(c.env.DB, c.env.AI, tenantId);
    const patterns = raw.map(mapPattern);
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
    const raw = await getPatterns(c.env.DB, tenantId, {
      status: status || undefined,
      type: type || undefined,
      limit,
    });
    const patterns = raw.map(mapPattern);
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
    const raw = await getEffectiveness(c.env.DB, tenantId, clusterId || undefined);
    const effectiveness = raw.map(mapEffectiveness);
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
    const rawEff = await calculateEffectiveness(c.env.DB, tenantId, periodDays);
    const effectiveness = rawEff.map(mapEffectiveness);
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
    const rawDeps = await getDependencies(c.env.DB, tenantId, clusterId || undefined);
    const dependencies = rawDeps.map(mapDependency);
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
    const rawDeps = await discoverDependencies(c.env.DB, c.env.AI, tenantId);
    const dependencies = rawDeps.map(mapDependency);
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
    const [rawPatterns, rawEffectiveness, rawDependencies] = await Promise.all([
      getPatterns(c.env.DB, tenantId, { limit: 10 }),
      getEffectiveness(c.env.DB, tenantId),
      getDependencies(c.env.DB, tenantId),
    ]);

    // Compute summary stats (use raw snake_case fields for calculations)
    const activePatterns = rawPatterns.filter(p => p.status === 'active').length;
    const criticalPatterns = rawPatterns.filter(p => p.severity === 'critical').length;
    const avgSuccessRate = rawEffectiveness.length > 0
      ? rawEffectiveness.reduce((sum, e) => sum + e.success_rate, 0) / rawEffectiveness.length
      : 0;
    const totalValueProcessed = rawEffectiveness.reduce((sum, e) => sum + e.total_value_processed, 0);
    const avgRoi = rawEffectiveness.length > 0
      ? rawEffectiveness.reduce((sum, e) => sum + e.roi_estimate, 0) / rawEffectiveness.length
      : 0;

    return c.json({
      summary: {
        activePatterns,
        criticalPatterns,
        totalSubCatalysts: rawEffectiveness.length,
        avgSuccessRate: Math.round(avgSuccessRate * 100) / 100,
        totalValueProcessed,
        avgRoi: Math.round(avgRoi * 100) / 100,
        totalDependencies: rawDependencies.length,
      },
      patterns: rawPatterns.map(mapPattern),
      effectiveness: rawEffectiveness.map(mapEffectiveness),
      dependencies: rawDependencies.map(mapDependency),
    });
  } catch (err) {
    return c.json({ error: 'Failed to fetch overview', detail: (err as Error).message }, 500);
  }
});

export default catalystIntelligence;
