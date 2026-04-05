/**
 * Pulse Diagnostics Routes
 * 
 * Root-cause analysis API for degraded metrics.
 * All routes are tenant-isolated via getTenantId().
 */

import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import {
  runDiagnosticAnalysis,
  getDiagnosticSummary,
  getAnalysisWithChain,
  listAnalyses,
} from '../services/diagnostics-engine';

const diagnostics = new Hono<AppBindings>();

// ── snake_case → camelCase mappers ──

function mapAnalysis(a: { id: string; tenant_id: string; metric_id: string; metric_name: string; metric_value: number; metric_status: string; trigger_type: string; status: string; created_at: string; completed_at?: string }) {
  return {
    id: a.id,
    metricId: a.metric_id,
    metricName: a.metric_name,
    metricValue: a.metric_value,
    metricStatus: a.metric_status,
    triggerType: a.trigger_type,
    status: a.status,
    createdAt: a.created_at,
    completedAt: a.completed_at,
  };
}

function mapChainLink(c: { id: string; tenant_id: string; analysis_id: string; level: number; cause_type: string; title: string; description: string; confidence: number; evidence: string[]; related_metrics: string[]; recommended_fix?: string; fix_priority: string; fix_effort: string; created_at: string }) {
  return {
    id: c.id,
    analysisId: c.analysis_id,
    level: c.level,
    causeType: c.cause_type,
    title: c.title,
    description: c.description,
    confidence: c.confidence,
    evidence: c.evidence,
    relatedMetrics: c.related_metrics,
    recommendedFix: c.recommended_fix,
    fixPriority: c.fix_priority,
    fixEffort: c.fix_effort,
    createdAt: c.created_at,
  };
}

function mapFix(f: { id: string; tenant_id: string; chain_id: string; analysis_id: string; status: string; assigned_to?: string; started_at?: string; completed_at?: string; outcome?: string; notes?: string; created_at: string }) {
  return {
    id: f.id,
    chainId: f.chain_id,
    analysisId: f.analysis_id,
    status: f.status,
    assignedTo: f.assigned_to,
    startedAt: f.started_at,
    completedAt: f.completed_at,
    outcome: f.outcome,
    notes: f.notes,
    createdAt: f.created_at,
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

// GET /api/diagnostics/summary — Diagnostic summary counts
diagnostics.get('/summary', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);

  try {
    const summary = await getDiagnosticSummary(c.env.DB, tenantId);
    return c.json(summary);
  } catch (err) {
    return c.json({ error: 'Failed to fetch diagnostic summary', detail: (err as Error).message }, 500);
  }
});

// GET /api/diagnostics/analyses — List all diagnostic analyses
diagnostics.get('/analyses', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);

  const status = c.req.query('status');
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10) || 20, 100);

  try {
    const raw = await listAnalyses(c.env.DB, tenantId, { status: status || undefined, limit });
    const analyses = raw.map(mapAnalysis);
    return c.json({ analyses, total: analyses.length });
  } catch (err) {
    return c.json({ error: 'Failed to list analyses', detail: (err as Error).message }, 500);
  }
});

// GET /api/diagnostics/analyses/:analysisId — Get full analysis with causal chain
diagnostics.get('/analyses/:analysisId', async (c) => {
  const tenantId = getTenantId(c);
  const analysisId = c.req.param('analysisId');

  try {
    const result = await getAnalysisWithChain(c.env.DB, tenantId, analysisId);
    if (!result.analysis) return c.json({ error: 'Analysis not found' }, 404);
    return c.json({
      analysis: mapAnalysis(result.analysis),
      causalChain: result.causalChain.map(mapChainLink),
      fixes: result.fixes.map(mapFix),
    });
  } catch (err) {
    return c.json({ error: 'Failed to fetch analysis', detail: (err as Error).message }, 500);
  }
});

// POST /api/diagnostics/:metricId/analyse — Run diagnostic analysis on a metric
diagnostics.post('/:metricId/analyse', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);

  const metricId = c.req.param('metricId');

  try {
    const result = await runDiagnosticAnalysis(c.env.DB, c.env.AI, tenantId, metricId, 'manual');
    return c.json({
      analysis: mapAnalysis(result.analysis),
      causalChain: result.causalChain.map(mapChainLink),
    }, 201);
  } catch (err) {
    return c.json({ error: 'Diagnostic analysis failed', detail: (err as Error).message }, 500);
  }
});

// POST /api/diagnostics/fixes — Create a fix tracking entry
diagnostics.post('/fixes', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);

  const body = await c.req.json<{
    chain_id: string;
    analysis_id: string;
    assigned_to?: string;
    notes?: string;
  }>();

  if (!body.chain_id || !body.analysis_id) {
    return c.json({ error: 'chain_id and analysis_id are required' }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO diagnostic_fix_tracking (id, tenant_id, chain_id, analysis_id, status, assigned_to, notes, created_at)
     VALUES (?, ?, ?, ?, 'proposed', ?, ?, ?)`
  ).bind(id, tenantId, body.chain_id, body.analysis_id, body.assigned_to || null, body.notes || null, now).run();

  return c.json({ id, status: 'proposed' }, 201);
});

// PUT /api/diagnostics/fixes/:fixId — Update fix status
diagnostics.put('/fixes/:fixId', async (c) => {
  const tenantId = getTenantId(c);
  const fixId = c.req.param('fixId');
  const body = await c.req.json<{
    status?: string;
    assigned_to?: string;
    outcome?: string;
    notes?: string;
  }>();

  const updates: string[] = [];
  const binds: unknown[] = [];

  const validStatuses = ['proposed', 'accepted', 'in_progress', 'completed', 'rejected'];
  if (body.status && validStatuses.includes(body.status)) {
    updates.push('status = ?');
    binds.push(body.status);
    if (body.status === 'in_progress') {
      updates.push("started_at = datetime('now')");
    }
    if (body.status === 'completed' || body.status === 'rejected') {
      updates.push("completed_at = datetime('now')");
    }
  }
  if (body.assigned_to !== undefined) {
    updates.push('assigned_to = ?');
    binds.push(body.assigned_to);
  }
  if (body.outcome !== undefined) {
    updates.push('outcome = ?');
    binds.push(body.outcome);
  }
  if (body.notes !== undefined) {
    updates.push('notes = ?');
    binds.push(body.notes);
  }

  if (updates.length === 0) return c.json({ error: 'No valid fields to update' }, 400);

  await c.env.DB.prepare(
    `UPDATE diagnostic_fix_tracking SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...binds, fixId, tenantId).run();

  return c.json({ success: true });
});

// GET /api/diagnostics/fixes — List fix tracking entries
diagnostics.get('/fixes', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);

  const status = c.req.query('status');
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10) || 20, 100);

  let query = 'SELECT ft.*, dc.title as chain_title, dc.fix_priority, dc.fix_effort, da.metric_name FROM diagnostic_fix_tracking ft JOIN diagnostic_causal_chains dc ON ft.chain_id = dc.id JOIN diagnostic_analyses da ON ft.analysis_id = da.id WHERE ft.tenant_id = ?';
  const binds: unknown[] = [tenantId];

  if (status) {
    query += ' AND ft.status = ?';
    binds.push(status);
  }

  query += ' ORDER BY ft.created_at DESC LIMIT ?';
  binds.push(limit);

  const results = await c.env.DB.prepare(query).bind(...binds).all();

  const fixes = results.results.map((f: Record<string, unknown>) => ({
    id: f.id,
    chainId: f.chain_id,
    analysisId: f.analysis_id,
    chainTitle: f.chain_title,
    fixPriority: f.fix_priority,
    fixEffort: f.fix_effort,
    metricName: f.metric_name,
    status: f.status,
    assignedTo: f.assigned_to,
    startedAt: f.started_at,
    completedAt: f.completed_at,
    outcome: f.outcome,
    notes: f.notes,
    createdAt: f.created_at,
  }));

  return c.json({ fixes, total: fixes.length });
});

export default diagnostics;
