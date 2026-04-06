/**
 * §11.3 Goal Setting & Target Tracking
 * GET /, POST /, PUT /:id, DELETE /:id
 */

import { Hono } from 'hono';
import type { AppBindings } from '../types';

const app = new Hono<AppBindings>();

// GET / — List all targets with dynamic current_value computation
app.get('/', async (c) => {
  const auth = c.get('auth');
  const db = c.env.DB;

  const targets = await db.prepare(
    'SELECT * FROM health_targets WHERE tenant_id = ? ORDER BY created_at DESC'
  ).bind(auth.tenantId).all();

  const enriched = [];
  for (const t of targets.results) {
    const row = t as Record<string, unknown>;
    let currentValue = (row.current_value as number) || 0;

    // Dynamically compute current value
    if (row.target_type === 'overall') {
      const health = await db.prepare(
        'SELECT overall_score FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
      ).bind(auth.tenantId).first();
      currentValue = (health?.overall_score as number) || 0;
    } else if (row.target_type === 'dimension') {
      const health = await db.prepare(
        'SELECT dimensions FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
      ).bind(auth.tenantId).first();
      if (health?.dimensions) {
        const dims = JSON.parse(health.dimensions as string);
        const dimData = dims[row.target_name as string];
        if (dimData) currentValue = dimData.score || 0;
      }
    } else if (row.target_type === 'metric') {
      const metric = await db.prepare(
        'SELECT value FROM process_metrics WHERE tenant_id = ? AND name = ? ORDER BY measured_at DESC LIMIT 1'
      ).bind(auth.tenantId, row.target_name).first();
      if (metric?.value) currentValue = metric.value as number;
    }

    const targetValue = row.target_value as number;
    const gap = targetValue - currentValue;

    // Simple linear projection from last 5 data points
    let projectedAchieveDate: string | null = null;
    if (gap > 0 && row.target_type === 'overall') {
      const history = await db.prepare(
        'SELECT overall_score, calculated_at FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 5'
      ).bind(auth.tenantId).all();
      if (history.results.length >= 2) {
        const scores = history.results.map((h: Record<string, unknown>) => h.overall_score as number);
        const weeklyDelta = (scores[0] - scores[scores.length - 1]) / scores.length;
        if (weeklyDelta > 0) {
          const weeksNeeded = Math.ceil(gap / weeklyDelta);
          const projected = new Date(Date.now() + weeksNeeded * 7 * 24 * 60 * 60 * 1000);
          projectedAchieveDate = projected.toISOString().split('T')[0];
        }
      }
    }

    enriched.push({
      id: row.id,
      targetType: row.target_type,
      targetName: row.target_name,
      targetValue,
      targetDeadline: row.target_deadline,
      currentValue,
      gap,
      projectedAchieveDate,
      status: row.status,
      createdBy: row.created_by,
      createdAt: row.created_at,
      achievedAt: row.achieved_at,
    });
  }

  return c.json({ targets: enriched });
});

// POST / — Create a target
app.post('/', async (c) => {
  const auth = c.get('auth');
  const db = c.env.DB;

  let body: { targetType: string; targetName: string; targetValue: number; targetDeadline?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.targetType || !body.targetName || body.targetValue === undefined) {
    return c.json({ error: 'targetType, targetName, and targetValue are required' }, 400);
  }

  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO health_targets (id, tenant_id, target_type, target_name, target_value, target_deadline, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, auth.tenantId, body.targetType, body.targetName, body.targetValue, body.targetDeadline || null, auth.userId).run();

  return c.json({ id, targetType: body.targetType, targetName: body.targetName, targetValue: body.targetValue });
});

// PUT /:id — Update target
app.put('/:id', async (c) => {
  const auth = c.get('auth');
  const db = c.env.DB;
  const id = c.req.param('id');

  let body: { targetValue?: number; targetDeadline?: string; status?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const sets: string[] = [];
  const vals: unknown[] = [];

  if (body.targetValue !== undefined) { sets.push('target_value = ?'); vals.push(body.targetValue); }
  if (body.targetDeadline !== undefined) { sets.push('target_deadline = ?'); vals.push(body.targetDeadline); }
  if (body.status) { sets.push('status = ?'); vals.push(body.status); }

  if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400);

  vals.push(id, auth.tenantId);
  await db.prepare(`UPDATE health_targets SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...vals).run();

  return c.json({ success: true });
});

// DELETE /:id — Remove target
app.delete('/:id', async (c) => {
  const auth = c.get('auth');
  const db = c.env.DB;
  const id = c.req.param('id');

  await db.prepare('DELETE FROM health_targets WHERE id = ? AND tenant_id = ?').bind(id, auth.tenantId).run();
  return c.json({ success: true });
});

export default app;
