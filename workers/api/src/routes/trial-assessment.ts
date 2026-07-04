/**
 * §11.1 Trial Assessment — Self-Service 15-Minute Live Assessment
 * PUBLIC routes — no tenant isolation middleware
 * Rate limit: 3 assessments per IP per day
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { ingestDomains } from '../lib/ingest-write';

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

  // Create trial tenant. The `industry` column is intentionally dropped from
  // tenants by migrate.ts (line ~909); body.industry is captured on the
  // trial_assessments row below for analytics. Adding it to this INSERT
  // would silently no-op (caught by the surrounding try/catch) and the SELECT
  // path would throw — see radar-engine-v2.ts which now also avoids that read.
  try {
    await db.prepare(
      "INSERT INTO tenants (id, slug, name, plan, status, created_at) VALUES (?, ?, ?, 'trial', 'trial', datetime('now'))"
    ).bind(tenantId, tenantId, body.company_name).run();
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

// POST /:id/upload — REAL ingest of the prospect's uploaded CSV data into an
// isolated trial dataset (ds_trial_<id>). Same {domains} shape and validation
// as the authenticated /api/assessments/:id/dataset route. No fabrication: the
// detectors in /run read exactly these rows.
app.post('/:id/upload', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  const assessment = await db.prepare('SELECT tenant_id FROM trial_assessments WHERE id = ?')
    .bind(id).first<{ tenant_id: string }>();
  if (!assessment) return c.json({ error: 'Assessment not found' }, 404);

  const body = await c.req.json<{ domains?: Record<string, { header: string[]; rows: Array<Record<string, unknown>> }> }>().catch(() => null);
  if (!body?.domains || typeof body.domains !== 'object') return c.json({ error: 'domains required' }, 400);

  const datasetId = `ds_trial_${id}`;
  let result: { row_counts: Record<string, number>; errors: Array<{ domain: string; row: number; column: string; message: string }> };
  try {
    // 50k/domain cap guards the public write surface (abuse); the /start
    // 3-per-IP-per-day limit already bounds how many trial datasets exist.
    result = await ingestDomains(db, assessment.tenant_id, datasetId, body.domains, { maxRowsPerDomain: 50000 });
  } catch {
    return c.json({ error: 'ingest write failed' }, 500);
  }

  if (result.errors.length) {
    return c.json({ error: 'validation failed', errors: result.errors }, 422);
  }

  await db.prepare(
    "UPDATE trial_assessments SET status = 'uploaded', current_step = 'Data uploaded' WHERE id = ?"
  ).bind(id).run();

  return c.json({ row_counts: result.row_counts });
});

// POST /:id/run — REAL detectors only. Runs the 39-detector engine scoped to
// the trial's ingested dataset and reports the confidence-gated exposure. No
// randomised fabrication: zero gate-passed findings → honest insufficient_data.
app.post('/:id/run', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  const assessment = await db.prepare('SELECT tenant_id FROM trial_assessments WHERE id = ?')
    .bind(id).first<{ tenant_id: string }>();
  if (!assessment) return c.json({ error: 'Assessment not found' }, 404);

  await db.prepare(
    "UPDATE trial_assessments SET status = 'running', progress = 20, current_step = 'Detecting exposure...' WHERE id = ?"
  ).bind(id).run();

  const datasetId = `ds_trial_${id}`;
  const { detectAllFindings, summariseFindings } = await import('../services/assessment-findings');
  const findings = await detectAllFindings(db, assessment.tenant_id, {
    baseCurrency: 'ZAR',
    exchangeRates: { ZAR: 1, USD: 18.5, EUR: 20, GBP: 23 },
    monthsOfData: 6, // trial = ≤ 6 months of CSV data typically
    datasetId,        // scope every erp_* query to this trial's uploaded rows
  });
  const summary = summariseFindings(findings);

  // Exposure = the CONFIDENCE-GATED confirmed total only (summariseFindings
  // sums it from findings that cleared the ≥25-record gate). Every Rand traces
  // to a real erp_* row. Zero gate-passed findings → honest insufficient_data
  // with a NULL exposure — never a fabricated or zero-dressed-as-real number.
  const gatePassedCount = summary.total_count - summary.unverified_count;
  const insufficient = gatePassedCount === 0;
  const exposure = insufficient ? null : summary.total_value_at_risk_zar;

  // topRisks derive from the real per-category value-at-risk breakdown — never
  // an invented 40/30/30 split.
  const topRisks = Object.entries(summary.by_category)
    .filter(([, v]) => v.value_at_risk_zar > 0)
    .sort((a, b) => b[1].value_at_risk_zar - a[1].value_at_risk_zar)
    .slice(0, 3)
    .map(([category, v]) => ({
      title: category.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase()),
      description: `${v.count} finding${v.count === 1 ? '' : 's'}`,
      impact: v.value_at_risk_zar,
    }));

  await db.prepare(
    `UPDATE trial_assessments SET status = 'complete', progress = 100, current_step = 'Assessment complete',
       health_score = NULL, issues_found = ?, estimated_exposure = ?, projected_roi = NULL,
       top_risks = ?, top_opportunities = '[]',
       findings_json = ?, findings_summary_json = ?,
       completed_at = datetime('now') WHERE id = ?`
  ).bind(
    summary.total_count, exposure,
    JSON.stringify(topRisks),
    JSON.stringify(findings), JSON.stringify(summary),
    id,
  ).run();

  return c.json({ status: 'complete', insufficient_data: insufficient });
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

  // PR H: parse findings_json + findings_summary_json (default to empty
  // when not present, e.g. older trial rows from before the heal column).
  let findings: unknown[] = [];
  let findingsSummary: unknown = {};
  try { findings = JSON.parse((assessment.findings_json as string) || '[]'); } catch { /* corrupt → empty */ }
  try { findingsSummary = JSON.parse((assessment.findings_summary_json as string) || '{}'); } catch { /* corrupt → empty */ }

  // insufficient_data is a property of the RESULT, not the run lifecycle: the
  // run always completes, but exposure is NULL when no finding cleared the gate.
  // A NULL exposure IS the honest insufficient-data signal.
  return c.json({
    id: assessment.id,
    companyName: assessment.company_name,
    industry: assessment.industry,
    status: assessment.status,
    estimatedExposure: assessment.estimated_exposure,
    issuesFound: assessment.issues_found,
    insufficientData: assessment.estimated_exposure == null,
    topRisks: JSON.parse((assessment.top_risks as string) || '[]'),
    completedAt: assessment.completed_at,
    findings,
    findingsSummary,
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
