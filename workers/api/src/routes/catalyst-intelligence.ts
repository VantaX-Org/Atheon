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

// POST /api/catalyst-intelligence/analyse
catalystIntelligence.post('/analyse', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const body = await c.req.json<{ cluster_id: string; sub_catalyst_name: string }>().catch(() => null);
  if (!body?.cluster_id || !body?.sub_catalyst_name) return c.json({ error: 'cluster_id and sub_catalyst_name required' }, 400);
  try {
    await analysePatterns(c.env.DB, tenantId, body.cluster_id, body.sub_catalyst_name, c.env);
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

export default catalystIntelligence;
