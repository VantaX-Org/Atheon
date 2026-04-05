/**
 * Apex Radar Routes
 * 
 * External signal processing and strategic context API.
 * All routes are tenant-isolated via getTenantId().
 */

import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';
import { analyseSignalImpact, buildStrategicContext, getStrategicContext } from '../services/radar-engine';

const radar = new Hono<AppBindings>();

const CROSS_TENANT_ROLES = new Set(['superadmin', 'support_admin']);
function getTenantId(c: { get: (key: string) => unknown; req: { query: (key: string) => string | undefined } }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  const defaultTenantId = auth?.tenantId || c.req.query('tenant_id') || '';
  if (CROSS_TENANT_ROLES.has(auth?.role || '')) {
    return c.req.query('tenant_id') || defaultTenantId;
  }
  return defaultTenantId;
}

// GET /api/radar/context — Full strategic context with signals and impacts
radar.get('/context', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);

  try {
    const result = await getStrategicContext(c.env.DB, tenantId);

    // Transform snake_case → camelCase for frontend consumption
    const context = result.context ? {
      id: result.context.id,
      contextType: result.context.context_type,
      title: result.context.title,
      summary: result.context.summary,
      factors: result.context.factors,
      sentiment: result.context.sentiment,
      confidence: result.context.confidence,
      sourceSignalIds: result.context.source_signal_ids,
      validFrom: result.context.valid_from,
      validTo: result.context.valid_to,
      createdAt: result.context.created_at,
    } : null;

    const signals = result.signals.map(s => ({
      id: s.id,
      source: s.source,
      signalType: s.signal_type,
      title: s.title,
      description: s.description,
      url: s.url,
      rawData: s.raw_data,
      severity: s.severity,
      relevanceScore: s.relevance_score,
      status: s.status,
      detectedAt: s.detected_at,
      expiresAt: s.expires_at,
      createdAt: s.created_at,
    }));

    const impacts = result.impacts.map(i => ({
      id: i.id,
      signalId: i.signal_id,
      dimension: i.dimension,
      impactDirection: i.impact_direction,
      impactMagnitude: i.impact_magnitude,
      affectedMetrics: i.affected_metrics,
      recommendedActions: i.recommended_actions,
      llmReasoning: i.llm_reasoning,
      createdAt: i.created_at,
    }));

    return c.json({ context, signals, impacts, summary: result.summary });
  } catch (err) {
    return c.json({ error: 'Failed to fetch strategic context', detail: (err as Error).message }, 500);
  }
});

// POST /api/radar/context/rebuild — Rebuild strategic context from analysed signals
radar.post('/context/rebuild', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);

  try {
    const raw = await buildStrategicContext(c.env.DB, c.env.AI, tenantId);
    const context = raw ? {
      id: raw.id,
      contextType: raw.context_type,
      title: raw.title,
      summary: raw.summary,
      factors: raw.factors,
      sentiment: raw.sentiment,
      confidence: raw.confidence,
      sourceSignalIds: raw.source_signal_ids,
      validFrom: raw.valid_from,
      validTo: raw.valid_to,
      createdAt: raw.created_at,
    } : null;
    return c.json({ context }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to rebuild strategic context', detail: (err as Error).message }, 500);
  }
});

// GET /api/radar/signals — List all signals
radar.get('/signals', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);

  const status = c.req.query('status');
  const signalType = c.req.query('type');
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10) || 20, 100);

  let query = 'SELECT * FROM radar_signals WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];

  if (status) {
    query += ' AND status = ?';
    binds.push(status);
  }
  if (signalType) {
    query += ' AND signal_type = ?';
    binds.push(signalType);
  }

  query += " ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, detected_at DESC LIMIT ?";
  binds.push(limit);

  const results = await c.env.DB.prepare(query).bind(...binds).all();

  const signals = results.results.map((s: Record<string, unknown>) => ({
    id: s.id,
    source: s.source,
    signalType: s.signal_type,
    title: s.title,
    description: s.description,
    url: s.url,
    severity: s.severity,
    relevanceScore: s.relevance_score,
    status: s.status,
    detectedAt: s.detected_at,
    expiresAt: s.expires_at,
    createdAt: s.created_at,
  }));

  return c.json({ signals, total: signals.length });
});

// POST /api/radar/signals — Create a new signal (and auto-analyse impacts via LLM)
radar.post('/signals', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);

  const { data: body, errors } = await getValidatedJsonBody<{
    source: string;
    signal_type: string;
    title: string;
    description: string;
    url?: string;
    severity?: string;
    raw_data?: Record<string, unknown>;
  }>(c, [
    { field: 'source', type: 'string', required: true, minLength: 1, maxLength: 200 },
    { field: 'signal_type', type: 'string', required: true, minLength: 1, maxLength: 32 },
    { field: 'title', type: 'string', required: true, minLength: 1, maxLength: 500 },
    { field: 'description', type: 'string', required: true, minLength: 1, maxLength: 5000 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const validTypes = ['regulatory', 'market', 'competitor', 'economic', 'technology', 'geopolitical'];
  const validSeverities = ['critical', 'high', 'medium', 'low'];

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO radar_signals (id, tenant_id, source, signal_type, title, description, url, raw_data, severity, relevance_score, status, detected_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`
  ).bind(
    id, tenantId, body.source,
    validTypes.includes(body.signal_type) ? body.signal_type : 'market',
    body.title, body.description, body.url || null,
    JSON.stringify(body.raw_data || {}),
    validSeverities.includes(body.severity || '') ? body.severity : 'medium',
    0, now, now,
  ).run();

  // Auto-analyse impact via LLM
  let impacts: unknown[] = [];
  try {
    impacts = await analyseSignalImpact(c.env.DB, c.env.AI, tenantId, id);
  } catch (err) {
    console.error('Signal impact analysis failed:', err);
  }

  return c.json({ id, impacts, message: 'Signal created and impact analysis complete' }, 201);
});

// GET /api/radar/signals/:signalId — Get a specific signal with its impacts
radar.get('/signals/:signalId', async (c) => {
  const tenantId = getTenantId(c);
  const signalId = c.req.param('signalId');

  const signal = await c.env.DB.prepare(
    'SELECT * FROM radar_signals WHERE id = ? AND tenant_id = ?'
  ).bind(signalId, tenantId).first();

  if (!signal) return c.json({ error: 'Signal not found' }, 404);

  const impacts = await c.env.DB.prepare(
    'SELECT * FROM radar_signal_impacts WHERE signal_id = ? AND tenant_id = ? ORDER BY impact_magnitude DESC'
  ).bind(signalId, tenantId).all();

  return c.json({
    signal: {
      id: signal.id,
      source: signal.source,
      signalType: signal.signal_type,
      title: signal.title,
      description: signal.description,
      url: signal.url,
      rawData: JSON.parse(signal.raw_data as string || '{}'),
      severity: signal.severity,
      relevanceScore: signal.relevance_score,
      status: signal.status,
      detectedAt: signal.detected_at,
      expiresAt: signal.expires_at,
      createdAt: signal.created_at,
    },
    impacts: impacts.results.map((i: Record<string, unknown>) => ({
      id: i.id,
      dimension: i.dimension,
      impactDirection: i.impact_direction,
      impactMagnitude: i.impact_magnitude,
      affectedMetrics: JSON.parse(i.affected_metrics as string || '[]'),
      recommendedActions: JSON.parse(i.recommended_actions as string || '[]'),
      llmReasoning: i.llm_reasoning,
      createdAt: i.created_at,
    })),
  });
});

// POST /api/radar/signals/:signalId/analyse — Re-analyse a signal's impacts
radar.post('/signals/:signalId/analyse', async (c) => {
  const tenantId = getTenantId(c);
  const signalId = c.req.param('signalId');

  try {
    const impacts = await analyseSignalImpact(c.env.DB, c.env.AI, tenantId, signalId);
    return c.json({ impacts });
  } catch (err) {
    return c.json({ error: 'Analysis failed', detail: (err as Error).message }, 500);
  }
});

// PUT /api/radar/signals/:signalId — Update signal status
radar.put('/signals/:signalId', async (c) => {
  const tenantId = getTenantId(c);
  const signalId = c.req.param('signalId');
  const body = await c.req.json<{ status?: string; severity?: string }>();

  const updates: string[] = [];
  const binds: unknown[] = [];

  if (body.status) {
    const validStatuses = ['new', 'analysed', 'dismissed', 'expired'];
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
    `UPDATE radar_signals SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...binds, signalId, tenantId).run();

  return c.json({ success: true });
});

// GET /api/radar/impacts — List all impacts across signals (for dimension-level view)
radar.get('/impacts', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);

  const dimension = c.req.query('dimension');
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 200);

  let query = 'SELECT si.*, rs.title as signal_title, rs.signal_type, rs.severity as signal_severity FROM radar_signal_impacts si JOIN radar_signals rs ON si.signal_id = rs.id WHERE si.tenant_id = ?';
  const binds: unknown[] = [tenantId];

  if (dimension) {
    query += ' AND si.dimension = ?';
    binds.push(dimension);
  }

  query += ' ORDER BY si.impact_magnitude DESC LIMIT ?';
  binds.push(limit);

  const results = await c.env.DB.prepare(query).bind(...binds).all();

  const impacts = results.results.map((i: Record<string, unknown>) => ({
    id: i.id,
    signalId: i.signal_id,
    signalTitle: i.signal_title,
    signalType: i.signal_type,
    signalSeverity: i.signal_severity,
    dimension: i.dimension,
    impactDirection: i.impact_direction,
    impactMagnitude: i.impact_magnitude,
    affectedMetrics: JSON.parse(i.affected_metrics as string || '[]'),
    recommendedActions: JSON.parse(i.recommended_actions as string || '[]'),
    createdAt: i.created_at,
  }));

  return c.json({ impacts, total: impacts.length });
});

export default radar;
