// workers/api/src/routes/assessments.ts
// Pre-Assessment Tool API — writes are superadmin-only; reads extend to
// support_admin (any tenant) and tenant admins (own tenant only), so the
// billing-proof findings are visible to the people being billed.
import { Hono, type Context } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import {
  runAssessment,
  DEFAULT_ASSESSMENT_CONFIG,
  type AssessmentConfig,
} from '../services/assessment-engine';
import {
  runValueAssessment,
  generateValueReportPDF,
  DEFAULT_VALUE_ASSESSMENT_CONFIG,
  type ValueAssessmentConfig,
} from '../services/value-assessment-engine';
import { INGEST_MANIFEST } from '../lib/ingest-manifest';
import { ingestDomains } from '../lib/ingest-write';

const assessments = new Hono<AppBindings>();

function requireSuperAdmin(auth: AuthContext | undefined): boolean {
  return auth?.role === 'superadmin';
}

function isPlatformStaff(auth: AuthContext | undefined): boolean {
  return auth?.role === 'superadmin' || auth?.role === 'support_admin';
}

/**
 * Read gate for /:id routes: platform staff read any assessment; a tenant
 * admin reads only assessments belonging to their own tenant. Returns the
 * denial Response to send, or null when allowed. Cross-tenant lookups 404
 * (don't leak existence). Writes stay superadmin-only.
 */
async function assessmentReadGate(c: Context<AppBindings>): Promise<Response | null> {
  const auth = c.get('auth') as AuthContext | undefined;
  if (isPlatformStaff(auth)) return null;
  if (!['admin', 'executive', 'board_member'].includes(auth?.role || '')) return c.json({ error: 'Forbidden' }, 403);
  const row = await c.env.DB.prepare('SELECT tenant_id FROM assessments WHERE id = ?')
    .bind(c.req.param('id')).first<{ tenant_id: string }>();
  if (!row || row.tenant_id !== auth.tenantId) return c.json({ error: 'Not found' }, 404);
  return null;
}

// ── GET /api/assessments — list all assessments ───────────────────────────
assessments.get('/', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  // Tenant-scoped read: executives/board consume assessment results in /x;
  // writes below stay superadmin-only.
  const TENANT_READ_ROLES = new Set(['admin', 'executive', 'board_member']);
  if (!isPlatformStaff(auth) && !TENANT_READ_ROLES.has(auth?.role || '')) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // Tenant roles see only their own tenant's assessments.
  const scoped = !isPlatformStaff(auth);
  const stmt = c.env.DB.prepare(`
    SELECT a.*, t.name as tenant_name
    FROM assessments a
    JOIN tenants t ON a.tenant_id = t.id
    ${scoped ? 'WHERE a.tenant_id = ?' : ''}
    ORDER BY a.created_at DESC
  `);
  const results = await (scoped ? stmt.bind(auth!.tenantId) : stmt).all<Record<string, unknown>>();

  return c.json({
    assessments: results.results.map(formatAssessment),
    total: results.results.length
  });
});

// ── POST /api/assessments — create + run assessment ───────────────────────
assessments.post('/', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req.json<{
    prospect_name: string;
    prospect_industry: string;
    erp_connection_id?: string;
    config: AssessmentConfig;
    /** ISO date (YYYY-MM-DD). Optional — null/empty means unbounded start. */
    period_start?: string | null;
    /** ISO date (YYYY-MM-DD). Optional — null/empty means unbounded end. */
    period_end?: string | null;
    /** When true: create the assessment 'pending' and DON'T auto-run. The
     *  caller uploads a dataset then triggers POST /:id/run. */
    defer_run?: boolean;
  }>();

  if (!body.prospect_name || !body.prospect_industry) {
    return c.json({ error: 'prospect_name and prospect_industry are required' }, 400);
  }

  const id = crypto.randomUUID();
  const config = { ...DEFAULT_ASSESSMENT_CONFIG, ...body.config };

  // Normalise period bounds — empty strings become null so the engine's
  // "both present?" check is unambiguous downstream.
  const periodStart = body.period_start && body.period_start.trim() !== ''
    ? body.period_start.trim() : null;
  const periodEnd = body.period_end && body.period_end.trim() !== ''
    ? body.period_end.trim() : null;

  // For pre-assessment: resolve tenant_id from the ERP connection so we query
  // the prospect's data, not the superadmin's home tenant.
  let tenantId = auth!.tenantId;
  if (body.erp_connection_id) {
    const conn = await c.env.DB.prepare(
      'SELECT tenant_id FROM erp_connections WHERE id = ?'
    ).bind(body.erp_connection_id).first<{ tenant_id: string }>();
    if (conn) tenantId = conn.tenant_id;
  }

  await c.env.DB.prepare(`
    INSERT INTO assessments (id, tenant_id, prospect_name, prospect_industry, erp_connection_id, status, config, period_start, period_end, created_by)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
  `).bind(
    id,
    tenantId,
    body.prospect_name,
    body.prospect_industry,
    body.erp_connection_id || null,
    JSON.stringify(config),
    periodStart,
    periodEnd,
    auth!.userId
  ).run();

  // Deferred run: the caller will upload a dataset then POST /:id/run. Leave
  // the assessment 'pending' and do NOT dispatch a background run now.
  if (body.defer_run) {
    return c.json({ id, status: 'pending' }, 201);
  }

  // If a ready uploaded dataset already exists for this assessment, scope the
  // run to it so the assessment reads ONLY that dataset's rows (data isolation).
  // Normally a dataset is uploaded after creation via POST /:id/dataset and a
  // re-run is triggered separately; this covers the create-after-upload path.
  const dataset = await c.env.DB.prepare(
    "SELECT id FROM assessment_datasets WHERE assessment_id = ? AND status = 'ready'"
  ).bind(id).first<{ id: string }>();
  const datasetId = dataset?.id;

  // Run assessment in background (use waitUntil for Cloudflare Workers)
  const assessmentPromise = runAssessment(
    c.env.DB,
    c.env.AI,
    c.env.STORAGE,
    tenantId,
    id,
    body.erp_connection_id || '',
    config,
    body.prospect_industry,
    body.prospect_name,
    { periodStart, periodEnd },
    datasetId,
  );

  c.executionCtx.waitUntil(assessmentPromise);

  return c.json({ id, status: 'running' }, 201);
});

// ── POST /api/assessments/:id/dataset ─────────────────────────────────────
// Ingest uploaded prospect data into an isolated per-assessment dataset.
// Re-validates server-side (strong inference: any unknown column / type
// mismatch rejects the WHOLE upload — nothing ingested).
assessments.post('/:id/dataset', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const assessmentId = c.req.param('id');

  const assessment = await c.env.DB.prepare('SELECT id, tenant_id FROM assessments WHERE id = ?')
    .bind(assessmentId).first<{ id: string; tenant_id: string }>();
  if (!assessment) return c.json({ error: 'assessment not found' }, 404);

  // The dataset belongs to the assessment's own tenant — that is what the run
  // path resolves against. Derive tenantId from the record, not a query param,
  // so the uploaded erp_* rows can never be tagged to a divergent tenant. A
  // mismatched explicit tenant_id is a caller error, not a silent reassignment.
  const tenantId = assessment.tenant_id;
  const qpTenant = c.req.query('tenant_id');
  if (qpTenant && qpTenant !== tenantId) {
    return c.json({ error: 'tenant_id does not match assessment' }, 400);
  }

  const body = await c.req.json<{ domains: Record<string, { header: string[]; rows: Array<Record<string, unknown>> }> }>().catch(() => null);
  if (!body?.domains || typeof body.domains !== 'object') return c.json({ error: 'domains required' }, 400);

  const datasetId = `ds_${assessmentId}_${tenantId}`.replace(/[^a-zA-Z0-9_]/g, '_');

  let result: { row_counts: Record<string, number>; errors: Array<{ domain: string; row: number; column: string; message: string }> };
  try {
    // maxRowsPerDomain is a no-op ceiling for the authenticated route; the trial
    // funnel passes a real cap.
    result = await ingestDomains(c.env.DB, tenantId, datasetId, body.domains, { maxRowsPerDomain: 100000 });
  } catch {
    // A mid-batch throw is non-atomic — mark failed so the dataset is never left
    // neither ready nor failed.
    await c.env.DB.prepare(
      `INSERT INTO assessment_datasets (id, assessment_id, tenant_id, status, row_counts, error)
       VALUES (?, ?, ?, 'failed', '{}', ?)
       ON CONFLICT(assessment_id) DO UPDATE SET status='failed', error=excluded.error`
    ).bind(datasetId, assessmentId, tenantId, JSON.stringify([{ domain: '', row: 0, column: '', message: 'ingest write failed' }])).run();
    return c.json({ error: 'ingest write failed' }, 500);
  }

  if (result.errors.length) {
    await c.env.DB.prepare(
      `INSERT INTO assessment_datasets (id, assessment_id, tenant_id, status, row_counts, error)
       VALUES (?, ?, ?, 'failed', '{}', ?)
       ON CONFLICT(assessment_id) DO UPDATE SET status='failed', error=excluded.error`
    ).bind(datasetId, assessmentId, tenantId, JSON.stringify(result.errors)).run();
    return c.json({ error: 'validation failed', errors: result.errors }, 422);
  }

  await c.env.DB.prepare(
    `INSERT INTO assessment_datasets (id, assessment_id, tenant_id, status, row_counts, error)
     VALUES (?, ?, ?, 'ready', ?, NULL)
     ON CONFLICT(assessment_id) DO UPDATE SET status='ready', row_counts=excluded.row_counts, error=NULL`
  ).bind(datasetId, assessmentId, tenantId, JSON.stringify(result.row_counts)).run();

  return c.json({ dataset_id: datasetId, status: 'ready', row_counts: result.row_counts });
});

// ── POST /api/assessments/:id/run ─────────────────────────────────────────
// Trigger the run for a deferred (status='pending') assessment, scoping it to
// the ready uploaded dataset. Mirrors the auto-run path in POST '/'.
assessments.post('/:id/run', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const assessmentId = c.req.param('id');
  const a = await c.env.DB.prepare(
    'SELECT id, tenant_id, status, prospect_name, prospect_industry, erp_connection_id, config, period_start, period_end FROM assessments WHERE id = ?'
  ).bind(assessmentId).first<{
    id: string; tenant_id: string; status: string; prospect_name: string; prospect_industry: string;
    erp_connection_id: string | null; config: string; period_start: string | null; period_end: string | null;
  }>();
  if (!a) return c.json({ error: 'assessment not found' }, 404);

  // Reject concurrent kick-offs. Mirrors run-value-assessment: two back-to-back
  // POSTs would both fire the engine and duplicate findings/dq/timing rows. The
  // engine does a per-run DELETE, but a true overlap still interleaves inserts.
  if (a.status === 'running') {
    return c.json({
      error: 'assessment_in_progress',
      message: 'An assessment run for this record is already in progress.',
      id: assessmentId,
      status: 'running',
    }, 409);
  }

  const config = { ...DEFAULT_ASSESSMENT_CONFIG, ...(JSON.parse(a.config || '{}') as Partial<AssessmentConfig>) };

  // Resolve the ready dataset (same lookup as the create handler) so the run
  // reads ONLY that dataset's rows.
  const dataset = await c.env.DB.prepare(
    "SELECT id FROM assessment_datasets WHERE assessment_id = ? AND status = 'ready'"
  ).bind(assessmentId).first<{ id: string }>();
  const datasetId = dataset?.id;

  const promise = runAssessment(
    c.env.DB,
    c.env.AI,
    c.env.STORAGE,
    a.tenant_id,
    assessmentId,
    a.erp_connection_id || '',
    config,
    a.prospect_industry,
    a.prospect_name,
    { periodStart: a.period_start, periodEnd: a.period_end },
    datasetId,
  );

  c.executionCtx.waitUntil(promise);

  return c.json({ id: assessmentId, status: 'running' });
});

// ── GET /api/assessments/config/defaults — return default config ──────────
assessments.get('/config/defaults', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const saved = await c.env.CACHE.get('assessment_defaults');
  if (saved) {
    try {
      return c.json(JSON.parse(saved) as AssessmentConfig);
    } catch { /* fall through */ }
  }
  return c.json(DEFAULT_ASSESSMENT_CONFIG);
});

// ── PUT /api/assessments/config/defaults — save default config ────────────
assessments.put('/config/defaults', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const config = await c.req.json<AssessmentConfig>();
  await c.env.CACHE.put('assessment_defaults', JSON.stringify(config));
  return c.json({ success: true });
});

// ── GET /api/assessments/:id — get assessment + results ───────────────────
assessments.get('/:id', async (c) => {
  const deny = await assessmentReadGate(c);
  if (deny) return deny;

  const assessment = await c.env.DB.prepare(`
    SELECT a.*, t.name as tenant_name
    FROM assessments a
    JOIN tenants t ON a.tenant_id = t.id
    WHERE a.id = ?
  `).bind(c.req.param('id')).first<Record<string, unknown>>();

  if (!assessment) return c.json({ error: 'Not found' }, 404);
  const out = formatAssessment(assessment);
  // findings_summary is part of the read contract: older/seeded assessments
  // persisted empty results, so derive it from the stored finding rows.
  if (!out.results.findings_summary) {
    const rows = await c.env.DB.prepare(`
      SELECT category, severity, COUNT(*) AS count, SUM(financial_impact) AS value_zar
      FROM assessment_findings WHERE assessment_id = ?
      GROUP BY category, severity
    `).bind(c.req.param('id')).all<{ category: string; severity: string; count: number; value_zar: number | null }>();
    const found = rows.results ?? [];
    if (found.length) {
      const by_category: Record<string, { count: number; value_at_risk_zar: number }> = {};
      const by_severity: Record<string, number> = {};
      let total = 0, totalCount = 0;
      for (const r of found) {
        const cat = (by_category[r.category] ??= { count: 0, value_at_risk_zar: 0 });
        cat.count += r.count;
        cat.value_at_risk_zar += r.value_zar ?? 0;
        by_severity[r.severity] = (by_severity[r.severity] ?? 0) + r.count;
        total += r.value_zar ?? 0;
        totalCount += r.count;
      }
      out.results.findings_summary = {
        total_count: totalCount,
        total_value_at_risk_zar: total,
        by_severity,
        by_category,
      };
    }
  }
  return c.json(out);
});

// ── GET /api/assessments/:id/status — polling endpoint ────────────────────
assessments.get('/:id/status', async (c) => {
  const deny = await assessmentReadGate(c);
  if (deny) return deny;

  const assessment = await c.env.DB.prepare(
    'SELECT status, results FROM assessments WHERE id = ?'
  ).bind(c.req.param('id')).first<Record<string, unknown>>();

  if (!assessment) return c.json({ error: 'Not found' }, 404);

  const status = assessment.status as string;
  let progress = 'pending';
  if (status === 'running') progress = 'Processing data...';
  if (status === 'complete') progress = 'Complete';
  if (status === 'failed') {
    const results = JSON.parse(assessment.results as string || '{}');
    progress = results.error || 'Assessment failed';
  }

  return c.json({ status, progress });
});

// ── GET /api/assessments/:id/report/business — download business PDF ──────
assessments.get('/:id/report/business', async (c) => {
  const deny = await assessmentReadGate(c);
  if (deny) return deny;

  const assessmentId = c.req.param('id');
  const assessment = await c.env.DB.prepare(
    'SELECT id, tenant_id, business_report_key, prospect_name FROM assessments WHERE id = ?'
  ).bind(assessmentId).first<Record<string, unknown>>();

  if (!assessment) {
    return c.json({ error: 'Report not available' }, 404);
  }

  let key = assessment.business_report_key as string | null;

  // Fallback: if the key was never set (e.g. seeder failed to generate during
  // bulk insert), regenerate it on demand from the value-summary row. This
  // means the Download Report button works even if seeding had a hiccup.
  if (!key) {
    try {
      const generated = await generateValueReportPDF(
        c.env.DB,
        c.env.STORAGE,
        assessment.tenant_id as string,
        assessment.id as string,
        (assessment.prospect_name as string) || 'Prospect',
        DEFAULT_VALUE_ASSESSMENT_CONFIG,
      );
      if (generated) key = generated;
    } catch (err) {
      console.warn('[Assessments] On-demand report regen failed:', (err as Error).message);
    }
  }

  if (!key) {
    return c.json({ error: 'Report not available' }, 404);
  }

  const obj = await c.env.STORAGE.get(key);
  if (!obj) return c.json({ error: 'Report file not found' }, 404);

  const filenameBase = sanitizeFilename(assessment.prospect_name as string);
  const arrayBuf = await obj.arrayBuffer();

  // HTML report: serve inline so the browser opens it (print-to-PDF available
  // from there). The Value Assessment engine produces A4-styled HTML.
  if (key.endsWith('.html')) {
    return new Response(arrayBuf, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="${filenameBase}-business-case.html"`,
      },
    });
  }

  // PDF path: validate magic bytes before serving.
  const header = new Uint8Array(arrayBuf.slice(0, 5));
  const isPdf = header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46; // %PDF
  if (!isPdf) {
    return c.json({ error: 'Stored report is not a recognised format' }, 415);
  }

  return new Response(arrayBuf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filenameBase}-business-case.pdf"`,
    },
  });
});

// ── GET /api/assessments/:id/report/technical — download technical PDF ────
assessments.get('/:id/report/technical', async (c) => {
  const deny = await assessmentReadGate(c);
  if (deny) return deny;

  const assessment = await c.env.DB.prepare(
    'SELECT technical_report_key, prospect_name FROM assessments WHERE id = ?'
  ).bind(c.req.param('id')).first<Record<string, unknown>>();

  if (!assessment || !assessment.technical_report_key) {
    return c.json({ error: 'Report not available' }, 404);
  }

  const obj = await c.env.STORAGE.get(assessment.technical_report_key as string);
  if (!obj) return c.json({ error: 'Report file not found' }, 404);

  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${sanitizeFilename(assessment.prospect_name as string)}-technical-sizing.pdf"`,
    },
  });
});

// ── GET /api/assessments/:id/report/excel — download Excel model ──────────
assessments.get('/:id/report/excel', async (c) => {
  const deny = await assessmentReadGate(c);
  if (deny) return deny;

  const assessment = await c.env.DB.prepare(
    'SELECT excel_model_key, prospect_name FROM assessments WHERE id = ?'
  ).bind(c.req.param('id')).first<Record<string, unknown>>();

  if (!assessment || !assessment.excel_model_key) {
    return c.json({ error: 'Excel model not available' }, 404);
  }

  const obj = await c.env.STORAGE.get(assessment.excel_model_key as string);
  if (!obj) return c.json({ error: 'Excel file not found' }, 404);

  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${sanitizeFilename(assessment.prospect_name as string)}-model.xlsx"`,
    },
  });
});

// ── POST /api/assessments/:id/run-value-assessment ────────────────────────
assessments.post('/:id/run-value-assessment', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const assessmentId = c.req.param('id');
  const body = await c.req.json<{ mode?: 'full' | 'quick'; outcomeFeePercent?: number }>().catch(() => ({ mode: undefined as 'full' | 'quick' | undefined, outcomeFeePercent: undefined as number | undefined }));

  const assessment = await c.env.DB.prepare(
    'SELECT * FROM assessments WHERE id = ?'
  ).bind(assessmentId).first<Record<string, unknown>>();
  if (!assessment) return c.json({ error: 'Not found' }, 404);

  // Reject concurrent kick-offs. Without this, two POSTs land
  // back-to-back, both set status='running', both fire the engine,
  // and findings/dq/timing/value_summary rows duplicate. The engine
  // itself does a per-run DELETE, but a true overlap would still
  // interleave inserts.
  if ((assessment.status as string) === 'running') {
    return c.json({
      error: 'assessment_in_progress',
      message: 'A value assessment for this record is already running.',
      id: assessmentId,
      status: 'running',
    }, 409);
  }

  const tenantId = assessment.tenant_id as string;
  const config: ValueAssessmentConfig = {
    ...DEFAULT_VALUE_ASSESSMENT_CONFIG,
    mode: body.mode ?? 'full',
    outcomeFeePercent: body.outcomeFeePercent ?? 20,
  };

  // Run in background
  const promise = runValueAssessment(
    c.env.DB, c.env.AI, c.env.STORAGE,
    tenantId, assessmentId,
    (assessment.erp_connection_id as string) || '',
    config,
    (assessment.prospect_industry as string) || 'general',
    (assessment.prospect_name as string) || 'Prospect',
  );
  c.executionCtx.waitUntil(promise);

  return c.json({ id: assessmentId, status: 'running', mode: config.mode }, 200);
});

// ── GET /api/assessments/:id/findings ──────────────────────────────────────
assessments.get('/:id/findings', async (c) => {
  const deny = await assessmentReadGate(c);
  if (deny) return deny;

  const assessmentId = c.req.param('id');
  const category = c.req.query('category');
  const severity = c.req.query('severity');
  const domain = c.req.query('domain');

  let sql = 'SELECT * FROM assessment_findings WHERE assessment_id = ?';
  const binds: unknown[] = [assessmentId];

  if (category) { sql += ' AND category = ?'; binds.push(category); }
  if (severity) { sql += ' AND severity = ?'; binds.push(severity); }
  if (domain) { sql += ' AND domain = ?'; binds.push(domain); }
  sql += ' ORDER BY financial_impact DESC';

  const results = await c.env.DB.prepare(sql).bind(...binds).all<Record<string, unknown>>();
  return c.json({
    findings: (results.results || []).map(f => {
      // SOC 2 PI1 + trade-secret: finding_insight_model is persisted for audit
      // replay only — never expose it to API clients (llm-provider.ts:11).
      const { finding_insight_model, ...rest } = f;
      void finding_insight_model;
      return {
        ...rest,
        evidence: JSON.parse(f.evidence as string || '{}'),
      };
    }),
    total: results.results?.length || 0,
  });
});

// ── GET /api/assessments/:id/data-quality ──────────────────────────────────
assessments.get('/:id/data-quality', async (c) => {
  const deny = await assessmentReadGate(c);
  if (deny) return deny;

  const results = await c.env.DB.prepare(
    'SELECT * FROM assessment_data_quality WHERE assessment_id = ? ORDER BY table_name'
  ).bind(c.req.param('id')).all<Record<string, unknown>>();

  return c.json({
    dataQuality: (results.results || []).map(dq => ({
      ...dq,
      field_scores: JSON.parse(dq.field_scores as string || '{}'),
      issues: JSON.parse(dq.issues as string || '[]'),
    })),
    total: results.results?.length || 0,
  });
});

// ── GET /api/assessments/:id/process-timing ────────────────────────────────
assessments.get('/:id/process-timing', async (c) => {
  const deny = await assessmentReadGate(c);
  if (deny) return deny;

  const results = await c.env.DB.prepare(
    'SELECT * FROM assessment_process_timing WHERE assessment_id = ? ORDER BY process_name'
  ).bind(c.req.param('id')).all<Record<string, unknown>>();

  return c.json({
    processTiming: (results.results || []).map(t => ({
      ...t,
      evidence: JSON.parse(t.evidence as string || '{}'),
    })),
    total: results.results?.length || 0,
  });
});

// ── GET /api/assessments/:id/value-summary ─────────────────────────────────
assessments.get('/:id/value-summary', async (c) => {
  const deny = await assessmentReadGate(c);
  if (deny) return deny;

  const summary = await c.env.DB.prepare(
    'SELECT * FROM assessment_value_summary WHERE assessment_id = ? LIMIT 1'
  ).bind(c.req.param('id')).first<Record<string, unknown>>();

  if (!summary) return c.json({ error: 'No value summary found' }, 404);

  return c.json({
    ...summary,
    value_by_domain: JSON.parse(summary.value_by_domain as string || '{}'),
    value_by_category: JSON.parse(summary.value_by_category as string || '{}'),
  });
});

// ── GET /api/assessments/:id/report/value — download Value Assessment report ──
assessments.get('/:id/report/value', async (c) => {
  const deny = await assessmentReadGate(c);
  if (deny) return deny;

  const assessment = await c.env.DB.prepare(
    'SELECT business_report_key, prospect_name FROM assessments WHERE id = ?'
  ).bind(c.req.param('id')).first<Record<string, unknown>>();

  if (!assessment || !assessment.business_report_key) {
    return c.json({ error: 'Value report not available' }, 404);
  }

  const key = assessment.business_report_key as string;
  const obj = await c.env.STORAGE.get(key);
  if (!obj) return c.json({ error: 'Report file not found' }, 404);

  const filenameBase = sanitizeFilename(assessment.prospect_name as string);
  const arrayBuf = await obj.arrayBuffer();

  if (key.endsWith('.html')) {
    return new Response(arrayBuf, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="${filenameBase}-value-assessment.html"`,
      },
    });
  }

  const header = new Uint8Array(arrayBuf.slice(0, 5));
  const isPdf = header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46;
  if (!isPdf) {
    return c.json({ error: 'Stored report is not a recognised format' }, 415);
  }

  return new Response(arrayBuf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filenameBase}-value-assessment.pdf"`,
    },
  });
});

// ── GET /api/assessments/:id/evidence/:findingId ──────────────────────────
assessments.get('/:id/evidence/:findingId', async (c) => {
  const deny = await assessmentReadGate(c);
  if (deny) return deny;

  const finding = await c.env.DB.prepare(
    'SELECT * FROM assessment_findings WHERE id = ? AND assessment_id = ?'
  ).bind(c.req.param('findingId'), c.req.param('id')).first<Record<string, unknown>>();

  if (!finding) return c.json({ error: 'Finding not found' }, 404);

  // SOC 2 PI1 + trade-secret: strip provider/model name (llm-provider.ts:11).
  const { finding_insight_model, ...rest } = finding;
  void finding_insight_model;
  return c.json({
    ...rest,
    evidence: JSON.parse(finding.evidence as string || '{}'),
  });
});

// ── DELETE /api/assessments/:id ───────────────────────────────────────────
assessments.delete('/:id', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const assessment = await c.env.DB.prepare(
    'SELECT business_report_key, technical_report_key, excel_model_key FROM assessments WHERE id = ?'
  ).bind(c.req.param('id')).first<Record<string, unknown>>();

  if (!assessment) return c.json({ error: 'Not found' }, 404);

  // Delete stored files
  const keys = [
    assessment.business_report_key,
    assessment.technical_report_key,
    assessment.excel_model_key,
  ].filter(Boolean) as string[];

  for (const key of keys) {
    try { await c.env.STORAGE.delete(key); } catch { /* ignore */ }
  }

  const assessmentId = c.req.param('id');

  // Purge any uploaded dataset(s) and their ingested erp_* rows so deleting an
  // assessment leaves no orphans. erp_* rows are tagged with the dataset_id; the
  // assessment_datasets row is keyed by assessment_id.
  const datasets = await c.env.DB.prepare(
    'SELECT id FROM assessment_datasets WHERE assessment_id = ?'
  ).bind(assessmentId).all<{ id: string }>();
  const datasetIds = (datasets.results ?? []).map(d => d.id);
  if (datasetIds.length) {
    const placeholders = datasetIds.map(() => '?').join(', ');
    const stmts = INGEST_MANIFEST.map(def =>
      c.env.DB.prepare(`DELETE FROM ${def.table} WHERE dataset_id IN (${placeholders})`).bind(...datasetIds)
    );
    stmts.push(c.env.DB.prepare('DELETE FROM assessment_datasets WHERE assessment_id = ?').bind(assessmentId));
    await c.env.DB.batch(stmts);
  }

  await c.env.DB.prepare('DELETE FROM assessments WHERE id = ?')
    .bind(assessmentId).run();

  return c.json({ success: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────
function sanitizeFilename(name: string): string {
  return name.replace(/["\r\n\\/:*?<>|]/g, '_').slice(0, 100);
}

function formatAssessment(a: Record<string, unknown>) {
  return {
    id: a.id,
    tenantId: a.tenant_id,
    tenantName: a.tenant_name,
    prospectName: a.prospect_name,
    prospectIndustry: a.prospect_industry,
    erpConnectionId: a.erp_connection_id,
    status: a.status,
    config: JSON.parse(a.config as string || '{}'),
    dataSnapshot: JSON.parse(a.data_snapshot as string || '{}'),
    results: JSON.parse(a.results as string || '{}'),
    businessReportKey: a.business_report_key,
    technicalReportKey: a.technical_report_key,
    excelModelKey: a.excel_model_key,
    // Period scoping (nullable on either side; null === "all data" for that bound).
    periodStart: (a.period_start as string | null) ?? null,
    periodEnd: (a.period_end as string | null) ?? null,
    createdBy: a.created_by,
    createdAt: a.created_at,
    completedAt: a.completed_at,
  };
}

export default assessments;
