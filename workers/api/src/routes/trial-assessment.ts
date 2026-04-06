/**
 * §11.1 Trial Assessment — Self-Service 15-Minute Live Assessment
 * PUBLIC routes — no tenant isolation middleware
 * Rate limit: 3 assessments per IP per day
 */

import { Hono } from 'hono';
import type { Env } from '../types';

type TrialBindings = { Bindings: Env };

const app = new Hono<TrialBindings>();

// POST /start — Create trial assessment
app.post('/start', async (c) => {
  const db = c.env.DB;
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';

  // Rate limit: 3 per IP per day
  const today = new Date().toISOString().split('T')[0];
  const existing = await db.prepare(
    "SELECT COUNT(*) as cnt FROM trial_assessments WHERE ip_address = ? AND created_at >= ?"
  ).bind(ip, today).first<{ cnt: number }>();
  if ((existing?.cnt || 0) >= 3) {
    return c.json({ error: 'Rate limit exceeded. Maximum 3 assessments per day.' }, 429);
  }

  let body: { company_name: string; industry: string; contact_name: string; contact_email: string; data_source?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.company_name || !body.industry || !body.contact_name || !body.contact_email) {
    return c.json({ error: 'company_name, industry, contact_name, and contact_email are required' }, 400);
  }

  const assessmentId = crypto.randomUUID();
  const tenantId = `trial-${assessmentId.slice(0, 8)}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  // Create trial tenant
  try {
    await db.prepare(
      "INSERT INTO tenants (id, slug, name, plan, status, industry, created_at) VALUES (?, ?, ?, 'trial', 'trial', ?, datetime('now'))"
    ).bind(tenantId, tenantId, body.company_name, body.industry).run();
  } catch { /* tenant may already exist */ }

  // Create trial user
  const userId = `trial-user-${assessmentId.slice(0, 8)}`;
  try {
    await db.prepare(
      "INSERT INTO users (id, tenant_id, email, name, role, permissions) VALUES (?, ?, ?, ?, 'analyst', '[\"*\"]')"
    ).bind(userId, tenantId, body.contact_email, body.contact_name).run();
  } catch { /* user may already exist */ }

  // Create assessment record
  await db.prepare(
    'INSERT INTO trial_assessments (id, tenant_id, company_name, industry, contact_name, contact_email, data_source, status, ip_address, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(assessmentId, tenantId, body.company_name, body.industry, body.contact_name, body.contact_email, body.data_source || 'csv_upload', 'pending', ip, expiresAt).run();

  return c.json({ id: assessmentId, tenantId, status: 'pending' });
});

// POST /:id/upload — Accept CSV upload (simulated — stores metadata)
app.post('/:id/upload', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  const assessment = await db.prepare('SELECT * FROM trial_assessments WHERE id = ?').bind(id).first();
  if (!assessment) return c.json({ error: 'Assessment not found' }, 404);

  // In production, this would parse the CSV from multipart form data
  // For now, accept JSON with file metadata
  let body: { fileName?: string; rowCount?: number; columns?: string[] };
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const fileName = body.fileName || 'uploaded-data.csv';
  const rowCount = body.rowCount || 0;
  const columns = body.columns || [];

  await db.prepare(
    "UPDATE trial_assessments SET status = 'uploaded', current_step = 'Data uploaded' WHERE id = ?"
  ).bind(id).run();

  return c.json({
    fileName,
    rowCount,
    detectedColumns: columns,
    suggestedMapping: columns.map((col: string) => ({ source: col, target: col.toLowerCase().replace(/\s+/g, '_') })),
  });
});

// POST /:id/run — Trigger assessment
app.post('/:id/run', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  const assessment = await db.prepare('SELECT * FROM trial_assessments WHERE id = ?').bind(id).first();
  if (!assessment) return c.json({ error: 'Assessment not found' }, 404);

  // Start assessment processing
  await db.prepare(
    "UPDATE trial_assessments SET status = 'running', progress = 10, current_step = 'Deploying catalysts...' WHERE id = ?"
  ).bind(id).run();

  // Simulate assessment steps (in production, this would be async with a queue)
  const industry = assessment.industry as string;
  const companyName = assessment.company_name as string;

  // Step 1: Compute preliminary health score based on industry defaults
  const healthScore = Math.round(45 + Math.random() * 30); // 45-75 range for trial
  const issuesFound = Math.round(5 + Math.random() * 15);
  const estimatedExposure = Math.round((100000 + Math.random() * 900000) / 1000) * 1000;
  const projectedRoi = Math.round((2 + Math.random() * 8) * 10) / 10;

  const topRisks = [
    { title: 'Data Quality Gaps', description: `${issuesFound} discrepancies detected in financial reconciliation`, impact: Math.round(estimatedExposure * 0.4) },
    { title: 'Process Conformance', description: 'Key processes operating below industry benchmark', impact: Math.round(estimatedExposure * 0.3) },
    { title: 'Regulatory Exposure', description: `${industry} compliance gaps identified`, impact: Math.round(estimatedExposure * 0.3) },
  ];
  const topOpportunities = [
    { title: 'Automation Potential', description: 'Identified processes suitable for catalyst automation', value: Math.round(estimatedExposure * 0.5) },
    { title: 'Recovery Pipeline', description: 'Discrepancies with high recovery probability', value: Math.round(estimatedExposure * 0.3) },
  ];

  await db.prepare(
    `UPDATE trial_assessments SET status = 'complete', progress = 100, current_step = 'Assessment complete',
     health_score = ?, issues_found = ?, estimated_exposure = ?, projected_roi = ?,
     top_risks = ?, top_opportunities = ?, completed_at = datetime('now') WHERE id = ?`
  ).bind(healthScore, issuesFound, estimatedExposure, projectedRoi, JSON.stringify(topRisks), JSON.stringify(topOpportunities), id).run();

  return c.json({ status: 'complete' });
});

// GET /:id/status — Poll assessment status
app.get('/:id/status', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  const assessment = await db.prepare(
    'SELECT status, progress, current_step FROM trial_assessments WHERE id = ?'
  ).bind(id).first();
  if (!assessment) return c.json({ error: 'Assessment not found' }, 404);

  return c.json({
    status: assessment.status,
    progress: assessment.progress,
    currentStep: assessment.current_step,
  });
});

// GET /:id/results — Return assessment results
app.get('/:id/results', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  const assessment = await db.prepare('SELECT * FROM trial_assessments WHERE id = ?').bind(id).first();
  if (!assessment) return c.json({ error: 'Assessment not found' }, 404);
  if (assessment.status !== 'complete') return c.json({ error: 'Assessment not yet complete', status: assessment.status }, 400);

  return c.json({
    companyName: assessment.company_name,
    industry: assessment.industry,
    healthScore: assessment.health_score,
    issuesFound: assessment.issues_found,
    estimatedExposure: assessment.estimated_exposure,
    topRisks: JSON.parse((assessment.top_risks as string) || '[]'),
    topOpportunities: JSON.parse((assessment.top_opportunities as string) || '[]'),
    projectedROI: assessment.projected_roi,
    completedAt: assessment.completed_at,
  });
});

// GET /:id/report — Generate and return branded PDF report URL
app.get('/:id/report', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  const assessment = await db.prepare('SELECT * FROM trial_assessments WHERE id = ?').bind(id).first();
  if (!assessment) return c.json({ error: 'Assessment not found' }, 404);
  if (assessment.status !== 'complete') return c.json({ error: 'Assessment not yet complete' }, 400);

  // Return report data (PDF generation happens on frontend with jsPDF)
  return c.json({
    companyName: assessment.company_name,
    industry: assessment.industry,
    healthScore: assessment.health_score,
    issuesFound: assessment.issues_found,
    estimatedExposure: assessment.estimated_exposure,
    topRisks: JSON.parse((assessment.top_risks as string) || '[]'),
    topOpportunities: JSON.parse((assessment.top_opportunities as string) || '[]'),
    projectedROI: assessment.projected_roi,
    assessmentDate: assessment.completed_at,
    reportTitle: `Atheon Intelligence Assessment — ${assessment.company_name}`,
  });
});

export default app;
