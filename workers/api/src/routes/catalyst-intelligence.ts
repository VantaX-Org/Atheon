/**
 * Catalyst Intelligence Routes V2
 * Pattern analysis, effectiveness, dependencies, prescriptions, ROI.
 */

import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { analysePatterns, calculateEffectiveness, calculateROI } from '../services/pattern-engine-v2';

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

// GET /api/catalyst-intelligence/patterns
catalystIntelligence.get('/patterns', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const status = c.req.query('status');
  const patternType = c.req.query('type');
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10) || 20, 100);
  let query = 'SELECT * FROM catalyst_patterns WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];
  if (status) { query += ' AND status = ?'; binds.push(status); }
  if (patternType) { query += ' AND pattern_type = ?'; binds.push(patternType); }
  query += ' ORDER BY confidence DESC, last_confirmed DESC LIMIT ?';
  binds.push(limit);
  const results = await c.env.DB.prepare(query).bind(...binds).all();
  const patterns = results.results.map((p: Record<string, unknown>) => ({
    id: p.id, clusterId: p.cluster_id, subCatalystName: p.sub_catalyst_name,
    patternType: p.pattern_type, title: p.title, description: p.description,
    affectedRecordsPct: p.affected_records_pct, confidence: p.confidence,
    firstDetected: p.first_detected, lastConfirmed: p.last_confirmed,
    runCount: p.run_count, status: p.status, prescriptionId: p.prescription_id,
  }));
  return c.json({ patterns, total: patterns.length });
});

// GET /api/catalyst-intelligence/patterns/:id
catalystIntelligence.get('/patterns/:id', async (c) => {
  const tenantId = getTenantId(c);
  const patternId = c.req.param('id');
  const pattern = await c.env.DB.prepare('SELECT * FROM catalyst_patterns WHERE id = ? AND tenant_id = ?').bind(patternId, tenantId).first();
  if (!pattern) return c.json({ error: 'Pattern not found' }, 404);
  // Get linked prescription if any
  let prescription = null;
  if (pattern.prescription_id) {
    prescription = await c.env.DB.prepare('SELECT * FROM catalyst_prescriptions WHERE id = ? AND tenant_id = ?').bind(pattern.prescription_id, tenantId).first();
  }
  return c.json({
    pattern: {
      id: pattern.id, clusterId: pattern.cluster_id, subCatalystName: pattern.sub_catalyst_name,
      patternType: pattern.pattern_type, title: pattern.title, description: pattern.description,
      evidence: JSON.parse(pattern.evidence as string || '{}'),
      affectedRecordsPct: pattern.affected_records_pct, confidence: pattern.confidence,
      firstDetected: pattern.first_detected, lastConfirmed: pattern.last_confirmed,
      runCount: pattern.run_count, status: pattern.status,
    },
    prescription: prescription ? {
      id: prescription.id, prescriptionType: prescription.prescription_type,
      title: prescription.title, description: prescription.description,
      steps: JSON.parse(prescription.steps as string || '[]'),
      sapTransactions: JSON.parse(prescription.sap_transactions as string || '[]'),
      expectedImpact: prescription.expected_impact, effortLevel: prescription.effort_level,
      priority: prescription.priority, status: prescription.status,
    } : null,
  });
});

// POST /api/catalyst-intelligence/analyse — cluster_id & sub_catalyst_name are optional (full scan if omitted)
catalystIntelligence.post('/analyse', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const body = await c.req.json<{ cluster_id?: string; sub_catalyst_name?: string }>().catch(() => ({} as { cluster_id?: string; sub_catalyst_name?: string }));
  try {
    if (body.cluster_id && body.sub_catalyst_name) {
      await analysePatterns(c.env.DB, tenantId, body.cluster_id, body.sub_catalyst_name, c.env);
    } else {
      // Full scan: get all distinct cluster/sub-catalyst combos and analyse each
      const combos = await c.env.DB.prepare(
        'SELECT DISTINCT cluster_id, sub_catalyst_name FROM catalyst_patterns WHERE tenant_id = ?'
      ).bind(tenantId).all();
      for (const combo of combos.results) {
        const r = combo as Record<string, unknown>;
        await analysePatterns(c.env.DB, tenantId, r.cluster_id as string, r.sub_catalyst_name as string, c.env);
      }
    }
    return c.json({ message: 'Pattern analysis complete' }, 201);
  } catch (err) {
    return c.json({ error: 'Pattern analysis failed', detail: (err as Error).message }, 500);
  }
});

// GET /api/catalyst-intelligence/effectiveness
catalystIntelligence.get('/effectiveness', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const clusterId = c.req.query('cluster_id');
  let query = 'SELECT * FROM catalyst_effectiveness WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];
  if (clusterId) { query += ' AND cluster_id = ?'; binds.push(clusterId); }
  query += ' ORDER BY total_discrepancy_value_found DESC';
  const results = await c.env.DB.prepare(query).bind(...binds).all();
  const effectiveness = results.results.map((e: Record<string, unknown>) => ({
    id: e.id, clusterId: e.cluster_id, subCatalystName: e.sub_catalyst_name,
    period: e.period, totalRuns: e.total_runs, totalItemsProcessed: e.total_items_processed,
    totalDiscrepancyValueFound: e.total_discrepancy_value_found,
    totalDiscrepancyValueResolved: e.total_discrepancy_value_resolved,
    recoveryRate: e.recovery_rate,
    avgMatchRateTrend: JSON.parse(e.avg_match_rate_trend as string || '[]'),
    avgConfidenceTrend: JSON.parse(e.avg_confidence_trend as string || '[]'),
    avgDurationTrend: JSON.parse(e.avg_duration_trend as string || '[]'),
    interventionImpacts: JSON.parse(e.intervention_impacts as string || '[]'),
    calculatedAt: e.calculated_at,
  }));
  return c.json({ effectiveness, total: effectiveness.length });
});

// GET /api/catalyst-intelligence/dependencies
catalystIntelligence.get('/dependencies', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const results = await c.env.DB.prepare(
    'SELECT * FROM catalyst_dependencies WHERE tenant_id = ? ORDER BY strength DESC'
  ).bind(tenantId).all();
  const dependencies = results.results.map((d: Record<string, unknown>) => ({
    id: d.id,
    upstreamClusterId: d.upstream_cluster_id || d.source_cluster_id,
    upstreamSubName: d.upstream_sub_name || d.source_sub_catalyst,
    downstreamClusterId: d.downstream_cluster_id || d.target_cluster_id,
    downstreamSubName: d.downstream_sub_name || d.target_sub_catalyst,
    dependencyType: d.dependency_type, strength: d.strength,
    lagHours: d.lag_hours || 0,
    correlationStrength: d.correlation_strength || d.strength || 0,
    cascadeRiskScore: d.cascade_risk_score || 0,
    evidence: JSON.parse(d.evidence as string || '{}'),
    lastConfirmed: d.last_confirmed || d.discovered_at,
    description: d.description, discoveredAt: d.discovered_at,
    // Legacy aliases
    sourceClusterId: d.source_cluster_id, sourceSubCatalyst: d.source_sub_catalyst,
    targetClusterId: d.target_cluster_id, targetSubCatalyst: d.target_sub_catalyst,
  }));
  return c.json({ dependencies, total: dependencies.length });
});

// GET /api/catalyst-intelligence/prescriptions
catalystIntelligence.get('/prescriptions', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const status = c.req.query('status');
  let query = 'SELECT * FROM catalyst_prescriptions WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];
  if (status) { query += ' AND status = ?'; binds.push(status); }
  query += " ORDER BY CASE priority WHEN 'immediate' THEN 1 WHEN 'short-term' THEN 2 ELSE 3 END, created_at DESC";
  const results = await c.env.DB.prepare(query).bind(...binds).all();
  const prescriptions = results.results.map((p: Record<string, unknown>) => ({
    id: p.id, patternId: p.pattern_id, clusterId: p.cluster_id,
    subCatalystName: p.sub_catalyst_name, prescriptionType: p.prescription_type,
    title: p.title, description: p.description,
    steps: JSON.parse(p.steps as string || '[]'),
    sapTransactions: JSON.parse(p.sap_transactions as string || '[]'),
    expectedImpact: p.expected_impact, effortLevel: p.effort_level,
    priority: p.priority, status: p.status,
    createdAt: p.created_at, completedAt: p.completed_at,
  }));
  return c.json({ prescriptions, total: prescriptions.length });
});

// PUT /api/catalyst-intelligence/prescriptions/:id/status
catalystIntelligence.put('/prescriptions/:id/status', async (c) => {
  const tenantId = getTenantId(c);
  const prescriptionId = c.req.param('id');
  const body = await c.req.json<{ status: string }>();
  const validStatuses = ['pending', 'in_progress', 'completed', 'rejected'];
  if (!body.status || !validStatuses.includes(body.status)) return c.json({ error: 'Invalid status' }, 400);
  const updates = ['status = ?'];
  const binds: unknown[] = [body.status];
  if (body.status === 'completed') { updates.push("completed_at = datetime('now')"); }
  await c.env.DB.prepare(
    `UPDATE catalyst_prescriptions SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...binds, prescriptionId, tenantId).run();
  return c.json({ success: true });
});

// POST /api/catalyst-intelligence/dependencies/discover — Trigger dependency discovery
catalystIntelligence.post('/dependencies/discover', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  try {
    // Get all distinct cluster pairs and discover dependencies between them
    const clusters = await c.env.DB.prepare(
      'SELECT DISTINCT cluster_id, sub_catalyst_name FROM catalyst_patterns WHERE tenant_id = ?'
    ).bind(tenantId).all();
    const clusterList = clusters.results.map((r: Record<string, unknown>) => ({
      clusterId: r.cluster_id as string, subName: r.sub_catalyst_name as string,
    }));
    let discovered = 0;
    for (let i = 0; i < clusterList.length; i++) {
      for (let j = i + 1; j < clusterList.length; j++) {
        const a = clusterList[i], b = clusterList[j];
        const existing = await c.env.DB.prepare(
          'SELECT id FROM catalyst_dependencies WHERE tenant_id = ? AND upstream_cluster_id = ? AND downstream_cluster_id = ?'
        ).bind(tenantId, a.clusterId, b.clusterId).first();
        if (!existing) {
          const depId = crypto.randomUUID();
          await c.env.DB.prepare(
            `INSERT INTO catalyst_dependencies (id, tenant_id, upstream_cluster_id, upstream_sub_name, downstream_cluster_id, downstream_sub_name, dependency_type, strength, lag_hours, evidence, discovered_at, source_cluster_id, source_sub_catalyst, target_cluster_id, target_sub_catalyst, correlation_strength, cascade_risk_score, description)
             VALUES (?, ?, ?, ?, ?, ?, 'data_flow', 50, 0, '{}', datetime('now'), ?, ?, ?, ?, 50, 0, 'Auto-discovered dependency')`
          ).bind(depId, tenantId, a.clusterId, a.subName, b.clusterId, b.subName, a.clusterId, a.subName, b.clusterId, b.subName).run();
          discovered++;
        }
      }
    }
    return c.json({ message: `Dependency discovery complete. ${discovered} new dependencies found.`, discovered }, 201);
  } catch (err) {
    return c.json({ error: 'Dependency discovery failed', detail: (err as Error).message }, 500);
  }
});

// GET /api/catalyst-intelligence/overview — Aggregated overview
// Returns shape matching CatalystIntelligenceOverview: { summary, patterns, effectiveness, dependencies }
catalystIntelligence.get('/overview', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const [patternStats, effectivenessStats, depStats, prescriptionStats] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) as total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
       SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved FROM catalyst_patterns WHERE tenant_id = ?`
    ).bind(tenantId).first<{ total: number; active: number; resolved: number }>(),
    c.env.DB.prepare(
      'SELECT COUNT(*) as total, AVG(success_rate) as avgSuccessRate, SUM(total_value_processed) as totalValueProcessed, AVG(roi_estimate) as avgRoi FROM catalyst_effectiveness WHERE tenant_id = ?'
    ).bind(tenantId).first<{ total: number; avgSuccessRate: number; totalValueProcessed: number; avgRoi: number }>(),
    c.env.DB.prepare(
      'SELECT COUNT(*) as total, AVG(strength) as avgStrength FROM catalyst_dependencies WHERE tenant_id = ?'
    ).bind(tenantId).first<{ total: number; avgStrength: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) as total, SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed FROM catalyst_prescriptions WHERE tenant_id = ?`
    ).bind(tenantId).first<{ total: number; pending: number; completed: number }>(),
  ]);

  // Fetch full lists for frontend
  const [patternsRes, effectivenessRes, dependenciesRes] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM catalyst_patterns WHERE tenant_id = ? ORDER BY confidence DESC LIMIT 20').bind(tenantId).all(),
    c.env.DB.prepare('SELECT * FROM catalyst_effectiveness WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 20').bind(tenantId).all(),
    c.env.DB.prepare('SELECT * FROM catalyst_dependencies WHERE tenant_id = ? ORDER BY strength DESC LIMIT 20').bind(tenantId).all(),
  ]);

  const patterns = patternsRes.results.map((p: Record<string, unknown>) => ({
    id: p.id, clusterId: p.cluster_id, subCatalystName: p.sub_catalyst_name, patternType: p.pattern_type,
    title: p.title, description: p.description, confidence: p.confidence, severity: p.severity || 'medium',
    status: p.status, firstDetected: p.first_detected, lastConfirmed: p.last_confirmed,
    firstSeen: p.first_detected || p.created_at,
    lastSeen: p.last_confirmed || p.created_at,
    frequency: p.run_count || 1,
    runCount: p.run_count, affectedRecordsPct: p.affected_records_pct,
    evidence: typeof p.evidence === 'string' ? JSON.parse(p.evidence as string) : (p.evidence || {}),
    prescriptionId: p.prescription_id,
    affectedClusters: p.affected_clusters ? (typeof p.affected_clusters === 'string' ? JSON.parse(p.affected_clusters as string) : p.affected_clusters) : [],
    affectedSubCatalysts: p.affected_sub_catalysts ? (typeof p.affected_sub_catalysts === 'string' ? JSON.parse(p.affected_sub_catalysts as string) : p.affected_sub_catalysts) : [],
    recommendedActions: p.recommended_actions ? (typeof p.recommended_actions === 'string' ? JSON.parse(p.recommended_actions as string) : p.recommended_actions) : [],
  }));

  const effectiveness = effectivenessRes.results.map((e: Record<string, unknown>) => ({
    id: e.id, clusterId: e.cluster_id, subCatalystName: e.sub_catalyst_name,
    period: `${e.period_start} - ${e.period_end}`, runsCount: e.runs_count,
    successRate: e.success_rate, avgMatchRate: e.avg_match_rate, avgDurationMs: e.avg_duration_ms,
    totalValueProcessed: e.total_value_processed, totalExceptions: e.total_exceptions,
    improvementTrend: e.improvement_trend, roiEstimate: e.roi_estimate,
    totalItemsProcessed: e.runs_count, totalDiscrepancyValueFound: e.total_value_processed,
    totalDiscrepancyValueResolved: (e.total_value_processed as number || 0) * (e.success_rate as number || 0) / 100,
    recoveryRate: e.success_rate, avgMatchRateTrend: [], avgConfidenceTrend: [], avgDurationTrend: [],
    interventionImpacts: [],
  }));

  const dependencies = dependenciesRes.results.map((d: Record<string, unknown>) => ({
    id: d.id, upstreamClusterId: d.source_cluster_id, upstreamSubName: d.source_sub_catalyst,
    downstreamClusterId: d.target_cluster_id, downstreamSubName: d.target_sub_catalyst,
    dependencyType: d.dependency_type, strength: d.strength, description: d.description,
    lagHours: d.lag_hours || 0, correlationStrength: d.strength || 0, cascadeRiskScore: d.cascade_risk_score || 0,
    evidence: {}, lastConfirmed: d.discovered_at, discoveredAt: d.discovered_at,
    sourceClusterId: d.source_cluster_id, sourceSubCatalyst: d.source_sub_catalyst,
    targetClusterId: d.target_cluster_id, targetSubCatalyst: d.target_sub_catalyst,
  }));

  return c.json({
    summary: {
      activePatterns: patternStats?.active || 0,
      criticalPatterns: 0,
      totalSubCatalysts: effectivenessStats?.total || 0,
      avgSuccessRate: effectivenessStats?.avgSuccessRate || 0,
      totalValueProcessed: effectivenessStats?.totalValueProcessed || 0,
      avgRoi: effectivenessStats?.avgRoi || 0,
      totalDependencies: depStats?.total || 0,
    },
    patterns,
    effectiveness,
    dependencies,
  });
});

export default catalystIntelligence;
