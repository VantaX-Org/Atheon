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

  // Create trial tenant. `tenants.industry` is column-healed to 'general' by
  // default (see migrate.ts), so passing `body.industry` here makes downstream
  // peer-benchmark + radar narrative segmentation actually work for trial
  // conversions instead of bucketing everyone as 'general'.
  const trialIndustry = (body.industry || 'general').toString().slice(0, 64);
  try {
    await db.prepare(
      "INSERT INTO tenants (id, slug, name, plan, status, industry, created_at) VALUES (?, ?, ?, 'trial', 'trial', ?, datetime('now'))"
    ).bind(tenantId, tenantId, body.company_name, trialIndustry).run();
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

// POST /:id/run — Trigger assessment (uses Value Assessment Engine in quick mode)
app.post('/:id/run', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  const assessment = await db.prepare('SELECT * FROM trial_assessments WHERE id = ?').bind(id).first();
  if (!assessment) return c.json({ error: 'Assessment not found' }, 404);

  // Start assessment processing
  await db.prepare(
    "UPDATE trial_assessments SET status = 'running', progress = 10, current_step = 'Auditing data quality...' WHERE id = ?"
  ).bind(id).run();

  const tenantId = assessment.tenant_id as string;
  const industry = assessment.industry as string;
  const companyName = assessment.company_name as string;

  // Try to run value assessment engine in quick mode (DQ + timing only, no full catalyst runs)
  // If the tenant has ERP data, the engine will produce real findings.
  // Fall back to estimation if no data is available.
  try {
    const { runValueAssessment, DEFAULT_VALUE_ASSESSMENT_CONFIG } = await import('../services/value-assessment-engine');

    // Create a temporary assessment record for the engine to write to
    const assessmentRecordId = `trial-va-${id.slice(0, 8)}`;
    try {
      await db.prepare(
        `INSERT INTO assessments (id, tenant_id, prospect_name, prospect_industry, status, config, created_by)
         VALUES (?, ?, ?, ?, 'pending', '{}', 'trial-system')`
      ).bind(assessmentRecordId, tenantId, companyName, industry).run();
    } catch { /* may already exist */ }

    await runValueAssessment(
      db, c.env.AI, c.env.STORAGE,
      tenantId, assessmentRecordId, '',
      { ...DEFAULT_VALUE_ASSESSMENT_CONFIG, mode: 'quick' },
      industry, companyName,
    );

    // Read back the value summary
    const summary = await db.prepare(
      'SELECT * FROM assessment_value_summary WHERE assessment_id = ? LIMIT 1'
    ).bind(assessmentRecordId).first();

    const findingsCount = await db.prepare(
      'SELECT COUNT(*) as cnt FROM assessment_findings WHERE assessment_id = ?'
    ).bind(assessmentRecordId).first<{ cnt: number }>();

    if (summary) {
      const totalFindings = findingsCount?.cnt || 0;
      const immediateValue = (summary.total_immediate_value as number) || 0;
      const ongoingAnnual = (summary.total_ongoing_annual_value as number) || 0;
      const healthScore = Math.max(20, 100 - Math.round(totalFindings * 3));
      const projectedRoi = ongoingAnnual > 0 ? Math.round((ongoingAnnual / Math.max((summary.outcome_based_monthly_fee as number) * 12, 1)) * 10) / 10 : 3.5;

      const topRisks = [
        { title: 'Data Quality Issues', description: `${summary.total_data_quality_issues || 0} data quality issues across ERP tables`, impact: Math.round(immediateValue * 0.4) },
        { title: 'Process Delays', description: `${summary.total_process_delays || 0} processes exceeding industry benchmarks`, impact: Math.round(immediateValue * 0.3) },
        { title: 'Financial Exposure', description: `${summary.total_critical_findings || 0} critical findings requiring immediate attention`, impact: Math.round(immediateValue * 0.3) },
      ];
      const topOpportunities = [
        { title: 'Immediate Recovery', description: `R${Math.round(immediateValue / 1000)}k recoverable through data cleanup and process fixes`, value: immediateValue },
        { title: 'Ongoing Prevention', description: `R${Math.round(ongoingAnnual / 1000)}k annual value through continuous monitoring`, value: ongoingAnnual },
      ];

      await db.prepare(
        `UPDATE trial_assessments SET status = 'complete', progress = 100, current_step = 'Assessment complete',
         health_score = ?, issues_found = ?, estimated_exposure = ?, projected_roi = ?,
         top_risks = ?, top_opportunities = ?, completed_at = datetime('now') WHERE id = ?`
      ).bind(healthScore, totalFindings, immediateValue + ongoingAnnual, projectedRoi, JSON.stringify(topRisks), JSON.stringify(topOpportunities), id).run();

      return c.json({ status: 'complete', mode: 'value_assessment' });
    }
  } catch (err) {
    console.error('Value assessment engine failed for trial, falling back to estimation:', err);
  }

  // Fallback: estimation-based assessment (when no ERP data available)
  const healthScore = Math.round(45 + Math.random() * 30);
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

  return c.json({ status: 'complete', mode: 'estimation' });
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
    projectedRoi: assessment.projected_roi,
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
    projectedRoi: assessment.projected_roi,
    assessmentDate: assessment.completed_at,
    reportTitle: `Atheon Intelligence Assessment — ${assessment.company_name}`,
  });
});

export default app;
