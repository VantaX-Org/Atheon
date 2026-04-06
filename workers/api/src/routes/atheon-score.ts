/**
 * §11.7 Atheon Score™ — The One Number
 * GET /api/atheon-score — Returns composite score with 5 component breakdown
 */

import { Hono } from 'hono';
import type { AppBindings } from '../types';

const app = new Hono<AppBindings>();

// GET / — Return current Atheon Score with components, trend, and industry average
app.get('/', async (c) => {
  const auth = c.get('auth');
  const tenantId = auth.tenantId;
  const db = c.env.DB;

  // Component 1: Health Score (weight: 0.30)
  const health = await db.prepare(
    'SELECT overall_score, dimensions FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(tenantId).first();
  const healthScore = (health?.overall_score as number) || 0;

  // Component 2: ROI Multiple (weight: 0.20)
  const roi = await db.prepare(
    'SELECT roi_multiple FROM roi_tracking WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(tenantId).first();
  const roiMultiple = (roi?.roi_multiple as number) || 0;
  const roiScore = Math.min(roiMultiple * 10, 100);

  // Component 3: Diagnostic Resolution Rate (weight: 0.20)
  const totalRcas = await db.prepare(
    'SELECT COUNT(*) as total FROM root_cause_analyses WHERE tenant_id = ?'
  ).bind(tenantId).first<{ total: number }>();
  const resolvedRcas = await db.prepare(
    "SELECT COUNT(*) as total FROM root_cause_analyses WHERE tenant_id = ? AND status = 'resolved'"
  ).bind(tenantId).first<{ total: number }>();
  const diagScore = (totalRcas?.total || 0) === 0 ? 100 : Math.round(((resolvedRcas?.total || 0) / (totalRcas?.total || 1)) * 100);

  // Component 4: Strategic Awareness (weight: 0.15)
  const signalCount = await db.prepare('SELECT COUNT(*) as c FROM external_signals WHERE tenant_id = ?').bind(tenantId).first<{ c: number }>();
  const compCount = await db.prepare('SELECT COUNT(*) as c FROM competitors WHERE tenant_id = ?').bind(tenantId).first<{ c: number }>();
  const regCount = await db.prepare('SELECT COUNT(*) as c FROM regulatory_events WHERE tenant_id = ?').bind(tenantId).first<{ c: number }>();
  const configuredItems = (signalCount?.c || 0) + (compCount?.c || 0) + (regCount?.c || 0);
  const awarenessScore = Math.min(Math.round((configuredItems / 10) * 100), 100);

  // Component 5: Catalyst Effectiveness (weight: 0.15)
  const effectiveness = await db.prepare(
    'SELECT AVG(recovery_rate) as avg_rate FROM catalyst_effectiveness WHERE tenant_id = ?'
  ).bind(tenantId).first<{ avg_rate: number | null }>();
  const effectivenessScore = Math.round((effectiveness?.avg_rate || 0) * 100);

  // Calculate composite
  const components = [
    { name: 'Health Score', score: healthScore, weight: 0.30, weighted: Math.round(healthScore * 0.30) },
    { name: 'ROI Multiple', score: Math.round(roiScore), weight: 0.20, weighted: Math.round(roiScore * 0.20) },
    { name: 'Diagnostic Resolution', score: diagScore, weight: 0.20, weighted: Math.round(diagScore * 0.20) },
    { name: 'Strategic Awareness', score: awarenessScore, weight: 0.15, weighted: Math.round(awarenessScore * 0.15) },
    { name: 'Catalyst Effectiveness', score: Math.min(effectivenessScore, 100), weight: 0.15, weighted: Math.round(Math.min(effectivenessScore, 100) * 0.15) },
  ];
  const score = Math.round(components.reduce((sum, c) => sum + c.weighted, 0));

  // Get trend (last 12 history records)
  const history = await db.prepare(
    'SELECT score, recorded_at FROM atheon_score_history WHERE tenant_id = ? ORDER BY recorded_at DESC LIMIT 12'
  ).bind(tenantId).all();
  const trend = (history.results || []).map((r: Record<string, unknown>) => ({ score: r.score as number, date: r.recorded_at as string })).reverse();

  // Get industry average (from anonymised benchmarks if available)
  const tenant = await db.prepare('SELECT industry FROM tenants WHERE id = ?').bind(tenantId).first();
  const industry = (tenant?.industry as string) || 'general';
  let industryAvg: number | null = null;
  try {
    const bench = await db.prepare(
      "SELECT avg_score FROM anonymised_benchmarks WHERE industry = ? AND dimension = 'overall' ORDER BY calculated_at DESC LIMIT 1"
    ).bind(industry).first();
    if (bench?.avg_score) industryAvg = Math.round(bench.avg_score as number);
  } catch { /* table may not have overall dimension yet */ }

  // Store in history
  try {
    await db.prepare(
      'INSERT INTO atheon_score_history (id, tenant_id, score, components, recorded_at) VALUES (?, ?, ?, ?, datetime(\'now\'))'
    ).bind(crypto.randomUUID(), tenantId, score, JSON.stringify(components)).run();
  } catch { /* non-fatal */ }

  return c.json({ score, components, trend, industryAvg, industry });
});

export default app;
