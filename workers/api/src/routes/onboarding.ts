/**
 * Onboarding Checklist Routes — Spec §9.2
 * 7-step guided onboarding with progress tracking.
 */

import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';

const onboarding = new Hono<AppBindings>();

const ONBOARDING_STEPS = [
  { id: 'connect_erp', label: 'Connect your ERP system', description: 'Link SAP, Xero, Sage, or another ERP adapter.' },
  { id: 'deploy_catalyst', label: 'Deploy your first catalyst', description: 'Choose a template or create a catalyst cluster.' },
  { id: 'run_catalyst', label: 'Run a catalyst', description: 'Execute a catalyst manually or via schedule.' },
  { id: 'review_action', label: 'Review a catalyst action', description: 'Approve or reject an AI-generated action.' },
  { id: 'view_diagnostics', label: 'View diagnostics', description: 'Check the Pulse Diagnostics tab for root-cause analyses.' },
  { id: 'generate_report', label: 'Generate a board report', description: 'Create an executive board report from Apex.' },
  { id: 'invite_user', label: 'Invite a team member', description: 'Add a colleague via IAM to collaborate.' },
];

// GET /api/onboarding/progress
onboarding.get('/progress', async (c) => {
  const auth = c.get('auth') as AuthContext;
  const tenantId = auth.tenantId;
  const userId = auth.userId;

  const rows = await c.env.DB.prepare(
    'SELECT step_id, completed_at FROM onboarding_progress WHERE tenant_id = ? AND user_id = ?'
  ).bind(tenantId, userId).all();

  const completedMap: Record<string, string> = {};
  for (const r of rows.results) {
    const row = r as Record<string, unknown>;
    completedMap[row.step_id as string] = row.completed_at as string;
  }

  const steps = ONBOARDING_STEPS.map(s => ({
    ...s,
    completed: !!completedMap[s.id],
    completedAt: completedMap[s.id] || null,
  }));

  const completedCount = steps.filter(s => s.completed).length;

  return c.json({
    steps,
    completedCount,
    totalSteps: ONBOARDING_STEPS.length,
    progressPct: Math.round((completedCount / ONBOARDING_STEPS.length) * 100),
    allComplete: completedCount === ONBOARDING_STEPS.length,
  });
});

// PUT /api/onboarding/complete/:stepId
onboarding.put('/complete/:stepId', async (c) => {
  const auth = c.get('auth') as AuthContext;
  const tenantId = auth.tenantId;
  const userId = auth.userId;
  const stepId = c.req.param('stepId');

  const validStep = ONBOARDING_STEPS.find(s => s.id === stepId);
  if (!validStep) return c.json({ error: 'Invalid step ID' }, 400);

  const existing = await c.env.DB.prepare(
    'SELECT id FROM onboarding_progress WHERE tenant_id = ? AND user_id = ? AND step_id = ?'
  ).bind(tenantId, userId, stepId).first();

  if (existing) return c.json({ success: true, message: 'Already completed' });

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO onboarding_progress (id, tenant_id, user_id, step_id, completed_at) VALUES (?, ?, ?, ?, datetime('now'))"
  ).bind(id, tenantId, userId, stepId).run();

  // Audit log
  try {
    await c.env.DB.prepare(
      "INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), tenantId, 'onboarding.step_completed', 'platform', 'onboarding',
      JSON.stringify({ stepId, userId }), 'success').run();
  } catch { /* non-fatal */ }

  return c.json({ success: true, stepId });
});

// PUT /api/onboarding/dismiss
onboarding.put('/dismiss', async (c) => {
  const auth = c.get('auth') as AuthContext;
  // Mark all steps as complete to dismiss
  for (const step of ONBOARDING_STEPS) {
    const existing = await c.env.DB.prepare(
      'SELECT id FROM onboarding_progress WHERE tenant_id = ? AND user_id = ? AND step_id = ?'
    ).bind(auth.tenantId, auth.userId, step.id).first();
    if (!existing) {
      await c.env.DB.prepare(
        "INSERT INTO onboarding_progress (id, tenant_id, user_id, step_id, completed_at) VALUES (?, ?, ?, ?, datetime('now'))"
      ).bind(crypto.randomUUID(), auth.tenantId, auth.userId, step.id).run();
    }
  }
  return c.json({ success: true, message: 'Onboarding dismissed' });
});

export default onboarding;
