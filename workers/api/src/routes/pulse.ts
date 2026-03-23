import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';

const pulse = new Hono<AppBindings>();

/** Superadmin/support_admin can override tenant via ?tenant_id= query param */
const CROSS_TENANT_ROLES = new Set(['superadmin', 'support_admin']);
function getTenantId(c: { get: (key: string) => unknown; req: { query: (key: string) => string | undefined } }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  const defaultTenantId = auth?.tenantId || c.req.query('tenant_id') || '';
  if (CROSS_TENANT_ROLES.has(auth?.role || '')) {
    return c.req.query('tenant_id') || defaultTenantId;
  }
  return defaultTenantId;
}

// M2: Helper to parse pagination params
function getPagination(c: { req: { query: (k: string) => string | undefined } }): { limit: number; offset: number } {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '100', 10) || 100, 1), 500);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0);
  return { limit, offset };
}

// GET /api/pulse/metrics
pulse.get('/metrics', async (c) => {
  const tenantId = getTenantId(c);
  const { limit, offset } = getPagination(c);
  const results = await c.env.DB.prepare(
    'SELECT * FROM process_metrics WHERE tenant_id = ? ORDER BY name ASC LIMIT ? OFFSET ?'
  ).bind(tenantId, limit, offset).all();
  const countResult = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM process_metrics WHERE tenant_id = ?'
  ).bind(tenantId).first<{ count: number }>();

  const formatted = results.results.map((m: Record<string, unknown>) => ({
    id: m.id,
    name: m.name,
    value: m.value,
    unit: m.unit,
    status: m.status,
    thresholds: {
      green: m.threshold_green,
      amber: m.threshold_amber,
      red: m.threshold_red,
    },
    trend: JSON.parse(m.trend as string || '[]'),
    sourceSystem: m.source_system,
    measuredAt: m.measured_at,
  }));

  return c.json({ metrics: formatted, total: countResult?.count || formatted.length, limit, offset });
});

// POST /api/pulse/metrics
pulse.post('/metrics', async (c) => {
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{
    name: string; value: number; unit: string;
    threshold_green?: number; threshold_amber?: number; threshold_red?: number; source_system?: string;
  }>(c, [
    { field: 'name', type: 'string', required: true, minLength: 1, maxLength: 200 },
    { field: 'value', type: 'number', required: true },
    { field: 'unit', type: 'string', required: true, minLength: 1, maxLength: 32 },
    { field: 'source_system', type: 'string', required: false, maxLength: 64 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const id = crypto.randomUUID();

  // Calculate status
  let status = 'green';
  if (body.threshold_red !== undefined && body.threshold_amber !== undefined && body.threshold_green !== undefined) {
    if (body.threshold_green > body.threshold_red) {
      // Higher is better (e.g., %)
      if (body.value < body.threshold_red) status = 'red';
      else if (body.value < body.threshold_amber) status = 'amber';
    } else {
      // Lower is better (e.g., days)
      if (body.value > body.threshold_red) status = 'red';
      else if (body.value > body.threshold_amber) status = 'amber';
    }
  }

  await c.env.DB.prepare(
    'INSERT INTO process_metrics (id, tenant_id, name, value, unit, status, threshold_green, threshold_amber, threshold_red, source_system) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, tenantId, body.name, body.value, body.unit, status, body.threshold_green || null, body.threshold_amber || null, body.threshold_red || null, body.source_system || null).run();

  return c.json({ id, status }, 201);
});

// GET /api/pulse/anomalies
pulse.get('/anomalies', async (c) => {
  const tenantId = getTenantId(c);
  const results = await c.env.DB.prepare(
    'SELECT * FROM anomalies WHERE tenant_id = ? ORDER BY CASE severity WHEN \'critical\' THEN 1 WHEN \'high\' THEN 2 WHEN \'medium\' THEN 3 WHEN \'low\' THEN 4 END'
  ).bind(tenantId).all();

  const formatted = results.results.map((a: Record<string, unknown>) => ({
    id: a.id,
    metric: a.metric,
    severity: a.severity,
    expectedValue: a.expected_value,
    actualValue: a.actual_value,
    deviation: a.deviation,
    hypothesis: a.hypothesis,
    status: a.status,
    detectedAt: a.detected_at,
  }));

  return c.json({ anomalies: formatted, total: formatted.length, limit: formatted.length, offset: 0 });
});

// PUT /api/pulse/anomalies/:id
pulse.put('/anomalies/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ status?: string }>();

  if (body.status) {
    await c.env.DB.prepare('UPDATE anomalies SET status = ? WHERE id = ?').bind(body.status, id).run();
  }

  return c.json({ success: true });
});

// GET /api/pulse/processes
pulse.get('/processes', async (c) => {
  const tenantId = getTenantId(c);
  const results = await c.env.DB.prepare(
    'SELECT * FROM process_flows WHERE tenant_id = ?'
  ).bind(tenantId).all();

  const formatted = results.results.map((f: Record<string, unknown>) => ({
    id: f.id,
    name: f.name,
    steps: JSON.parse(f.steps as string || '[]'),
    variants: f.variants,
    avgDuration: f.avg_duration,
    conformanceRate: f.conformance_rate,
    bottlenecks: JSON.parse(f.bottlenecks as string || '[]'),
  }));

  return c.json({ processes: formatted, total: formatted.length, limit: formatted.length, offset: 0 });
});

// GET /api/pulse/correlations
pulse.get('/correlations', async (c) => {
  const tenantId = getTenantId(c);
  const results = await c.env.DB.prepare(
    'SELECT * FROM correlation_events WHERE tenant_id = ? ORDER BY confidence DESC'
  ).bind(tenantId).all();

  const formatted = results.results.map((ce: Record<string, unknown>) => ({
    id: ce.id,
    sourceSystem: ce.source_system,
    sourceEvent: ce.source_event,
    targetSystem: ce.target_system,
    targetImpact: ce.target_impact,
    confidence: ce.confidence,
    lagDays: ce.lag_days,
    detectedAt: ce.detected_at,
  }));

  return c.json({ correlations: formatted, total: formatted.length, limit: formatted.length, offset: 0 });
});

// POST /api/pulse/refresh — On-demand process mining refresh from catalyst runs
pulse.post('/refresh', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'No tenant context' }, 400);

  // Count catalyst actions for this tenant
  const actionCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM catalyst_actions WHERE tenant_id = ?'
  ).bind(tenantId).first<{ count: number }>();

  if (!actionCount || actionCount.count === 0) {
    return c.json({ refreshed: false, message: 'No catalyst runs found. Run a catalyst first to generate process mining data.' });
  }

  // Group catalyst actions by catalyst_name to build process flows
  const actions = await c.env.DB.prepare(
    'SELECT catalyst_name, status, confidence, input_data, output_data, created_at, completed_at FROM catalyst_actions WHERE tenant_id = ? ORDER BY created_at DESC'
  ).bind(tenantId).all();

  const catalystGroups: Record<string, Array<Record<string, unknown>>> = {};
  for (const a of actions.results) {
    const row = a as Record<string, unknown>;
    const name = row.catalyst_name as string;
    if (!catalystGroups[name]) catalystGroups[name] = [];
    catalystGroups[name].push(row);
  }

  let flowsCreated = 0;
  let metricsCreated = 0;

  for (const [catalystName, runs] of Object.entries(catalystGroups)) {
    const flowId = `pf-${tenantId.substring(0, 8)}-${catalystName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const completed = runs.filter(r => r.status === 'completed');
    const exceptions = runs.filter(r => r.status === 'exception');
    const pending = runs.filter(r => r.status === 'pending');
    const total = runs.length;
    const conformanceRate = total > 0 ? Math.round((completed.length / total) * 100) : 100;
    const uniqueActions = new Set(runs.map(r => r.status as string));

    // Avg duration
    let avgDuration = 0;
    const durationsMs: number[] = [];
    for (const r of completed) {
      if (r.completed_at && r.created_at) {
        const diff = new Date(r.completed_at as string).getTime() - new Date(r.created_at as string).getTime();
        if (diff > 0) durationsMs.push(diff);
      }
    }
    if (durationsMs.length > 0) {
      avgDuration = Math.round(durationsMs.reduce((s, d) => s + d, 0) / durationsMs.length / 1000);
    }

    // Bottlenecks from exceptions
    const bottlenecks: string[] = [];
    for (const r of exceptions.slice(0, 5)) {
      try {
        const output = JSON.parse(r.output_data as string || '{}');
        if (output.exception_type) {
          bottlenecks.push(`${output.exception_type}: ${output.exception_detail || 'Requires review'}`);
        }
      } catch { /* skip */ }
    }
    if (exceptions.length > 0 && bottlenecks.length === 0) {
      bottlenecks.push(`${exceptions.length} action(s) escalated for human review`);
    }

    const steps = JSON.stringify([
      { name: 'Received', count: total },
      { name: 'Processing', count: pending.length },
      { name: 'Completed', count: completed.length },
      { name: 'Escalated', count: exceptions.length },
    ]);

    await c.env.DB.prepare(
      `INSERT INTO process_flows (id, tenant_id, name, steps, variants, avg_duration, conformance_rate, bottlenecks, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET steps = excluded.steps, variants = excluded.variants,
         avg_duration = excluded.avg_duration, conformance_rate = excluded.conformance_rate,
         bottlenecks = excluded.bottlenecks`
    ).bind(flowId, tenantId, catalystName, steps, uniqueActions.size, avgDuration, conformanceRate, JSON.stringify(bottlenecks)).run();
    flowsCreated++;

    // Success rate metric
    const metricId = `pm-${tenantId.substring(0, 8)}-${catalystName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const successRate = total > 0 ? Math.round((completed.length / total) * 100) : 100;
    let metricStatus = 'green';
    if (successRate < 60) metricStatus = 'red';
    else if (successRate < 80) metricStatus = 'amber';

    await c.env.DB.prepare(
      `INSERT INTO process_metrics (id, tenant_id, name, value, unit, status, threshold_green, threshold_amber, threshold_red, trend, source_system, measured_at)
       VALUES (?, ?, ?, ?, '%', ?, 80, 80, 60, '[]', 'catalyst-engine', datetime('now'))
       ON CONFLICT(id) DO UPDATE SET value = excluded.value, status = excluded.status, measured_at = excluded.measured_at`
    ).bind(metricId, tenantId, `${catalystName} Success Rate`, successRate, metricStatus).run();
    metricsCreated++;

    // Exception rate metric
    const excMetricId = `pm-${tenantId.substring(0, 8)}-${catalystName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-exc`;
    const exceptionRate = total > 0 ? Math.round((exceptions.length / total) * 100) : 0;
    let excStatus = 'green';
    if (exceptionRate > 40) excStatus = 'red';
    else if (exceptionRate > 20) excStatus = 'amber';

    await c.env.DB.prepare(
      `INSERT INTO process_metrics (id, tenant_id, name, value, unit, status, threshold_green, threshold_amber, threshold_red, trend, source_system, measured_at)
       VALUES (?, ?, ?, ?, '%', ?, 20, 20, 40, '[]', 'catalyst-engine', datetime('now'))
       ON CONFLICT(id) DO UPDATE SET value = excluded.value, status = excluded.status, measured_at = excluded.measured_at`
    ).bind(excMetricId, tenantId, `${catalystName} Exception Rate`, exceptionRate, excStatus).run();
    metricsCreated++;
  }

  return c.json({ refreshed: true, processFlows: flowsCreated, metricsGenerated: metricsCreated, catalystActions: actionCount.count });
});

// GET /api/pulse/catalyst-runs — Transaction-level reporting for catalyst runs
pulse.get('/catalyst-runs', async (c) => {
  const tenantId = getTenantId(c);
  const { limit, offset } = getPagination(c);
  const catalystFilter = c.req.query('catalyst');

  let query = 'SELECT id, cluster_id, catalyst_name, action, status, confidence, input_data, output_data, reasoning, approved_by, created_at, completed_at FROM catalyst_actions WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];

  if (catalystFilter) {
    query += ' AND catalyst_name = ?';
    binds.push(catalystFilter);
  }
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  binds.push(limit, offset);

  const results = await c.env.DB.prepare(query).bind(...binds).all();

  // Get total count
  let countQuery = 'SELECT COUNT(*) as count FROM catalyst_actions WHERE tenant_id = ?';
  const countBinds: unknown[] = [tenantId];
  if (catalystFilter) {
    countQuery += ' AND catalyst_name = ?';
    countBinds.push(catalystFilter);
  }
  const countResult = await c.env.DB.prepare(countQuery).bind(...countBinds).first<{ count: number }>();

  // Get summary stats per catalyst
  const summaryQuery = await c.env.DB.prepare(
    `SELECT catalyst_name,
       COUNT(*) as total_runs,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
       SUM(CASE WHEN status = 'exception' THEN 1 ELSE 0 END) as exceptions,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
       AVG(confidence) as avg_confidence
     FROM catalyst_actions WHERE tenant_id = ? GROUP BY catalyst_name ORDER BY total_runs DESC`
  ).bind(tenantId).all();

  const runs = results.results.map((r: Record<string, unknown>) => {
    let inputData = null;
    let outputData = null;
    try { inputData = JSON.parse(r.input_data as string || 'null'); } catch { /* skip */ }
    try { outputData = JSON.parse(r.output_data as string || 'null'); } catch { /* skip */ }

    return {
      id: r.id,
      clusterId: r.cluster_id,
      catalystName: r.catalyst_name,
      action: r.action,
      status: r.status,
      confidence: r.confidence,
      inputData,
      outputData,
      reasoning: r.reasoning,
      approvedBy: r.approved_by,
      createdAt: r.created_at,
      completedAt: r.completed_at,
      needsHumanReview: r.status === 'exception' || r.status === 'pending',
    };
  });

  const summary = summaryQuery.results.map((s: Record<string, unknown>) => ({
    catalystName: s.catalyst_name,
    totalRuns: s.total_runs,
    completed: s.completed,
    exceptions: s.exceptions,
    pending: s.pending,
    avgConfidence: Math.round((s.avg_confidence as number || 0) * 100) / 100,
    successRate: (s.total_runs as number) > 0
      ? Math.round(((s.completed as number) / (s.total_runs as number)) * 100)
      : 0,
  }));

  return c.json({
    runs,
    summary,
    total: countResult?.count || runs.length,
    limit,
    offset,
  });
});

// GET /api/pulse/summary (aggregated overview)
pulse.get('/summary', async (c) => {
  const tenantId = getTenantId(c);

  const totalMetrics = await c.env.DB.prepare('SELECT COUNT(*) as count FROM process_metrics WHERE tenant_id = ?').bind(tenantId).first<{ count: number }>();
  const greenMetrics = await c.env.DB.prepare('SELECT COUNT(*) as count FROM process_metrics WHERE tenant_id = ? AND status = ?').bind(tenantId, 'green').first<{ count: number }>();
  const amberMetrics = await c.env.DB.prepare('SELECT COUNT(*) as count FROM process_metrics WHERE tenant_id = ? AND status = ?').bind(tenantId, 'amber').first<{ count: number }>();
  const redMetrics = await c.env.DB.prepare('SELECT COUNT(*) as count FROM process_metrics WHERE tenant_id = ? AND status = ?').bind(tenantId, 'red').first<{ count: number }>();
  const openAnomalies = await c.env.DB.prepare('SELECT COUNT(*) as count FROM anomalies WHERE tenant_id = ? AND status = ?').bind(tenantId, 'open').first<{ count: number }>();

  return c.json({
    totalMetrics: totalMetrics?.count || 0,
    statusBreakdown: {
      green: greenMetrics?.count || 0,
      amber: amberMetrics?.count || 0,
      red: redMetrics?.count || 0,
    },
    openAnomalies: openAnomalies?.count || 0,
  });
});

export default pulse;
