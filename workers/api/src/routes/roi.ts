/**
 * ROI Tracking Routes
 */

import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { calculateROI } from '../services/pattern-engine-v2';
import { toCSV, csvResponse } from '../services/csv-export';
import { computeRoiAttribution } from '../services/erp-attribution';

interface RoiActionAttribution {
  automated_count: number;
  automated_value_zar: number;
  pending_count: number;
  pending_value_zar: number;
  rejected_count: number;
  rejected_value_zar: number;
  open_value_zar: number;
}

/** Compute the action-state attribution split for the ROI response.
 *  This bridges the gap between "value identified" and "value realised":
 *    automated_value_zar   — Atheon wrote-back actions that completed
 *    pending_value_zar     — actions in the approval queue, value at stake
 *    open_value_zar        — identified opportunity not yet covered by an
 *                            automated or pending action (i.e. customer
 *                            still needs to act, or Atheon hasn't surfaced
 *                            an automation for it yet)
 *  This is the v1 attribution model — proves the loop is closed
 *  end-to-end. Future work: add a finding-resolution signal (customer
 *  confirms they did it manually) to introduce an `advisory_acted`
 *  bucket between automated and open. */
async function computeActionAttribution(
  db: D1Database, tenantId: string, totalIdentifiedZar: number,
): Promise<RoiActionAttribution> {
  const result = {
    automated_count: 0, automated_value_zar: 0,
    pending_count: 0, pending_value_zar: 0,
    rejected_count: 0, rejected_value_zar: 0,
    open_value_zar: 0,
  };
  try {
    // Exclude 'failed' (dispatched but ERP didn't record the change),
    // 'skipped' (stub/preview — no ERP write happened), and 'deferred'
    // (verifier could not confirm) from the automated bucket. Billing them
    // as "automated by Atheon" would overstate realised value. NULL
    // (seeded/legacy, pre-verifier) and 'verified' count — matching
    // pattern-engine-v2.calculateROI so recovered means the same thing here.
    const rows = await db.prepare(
      `SELECT status, COUNT(*) as count, COALESCE(SUM(value_zar), 0) as value_zar
         FROM catalyst_actions
        WHERE tenant_id = ?
          AND (verification_status IS NULL
               OR verification_status NOT IN ('failed', 'skipped', 'deferred'))
        GROUP BY status`
    ).bind(tenantId).all<{ status: string; count: number; value_zar: number }>();
    for (const r of rows.results || []) {
      if (r.status === 'completed') {
        result.automated_count = r.count; result.automated_value_zar = r.value_zar;
      } else if (r.status === 'pending_approval') {
        result.pending_count = r.count; result.pending_value_zar = r.value_zar;
      } else if (r.status === 'rejected') {
        result.rejected_count = r.count; result.rejected_value_zar = r.value_zar;
      }
    }
  } catch { /* tolerate */ }

  result.open_value_zar = Math.max(
    0,
    totalIdentifiedZar - result.automated_value_zar - result.pending_value_zar,
  );
  return result;
}

const roi = new Hono<AppBindings>();

const CROSS_TENANT_ROLES = new Set(['superadmin', 'support_admin']);
function getTenantId(c: { get: (key: string) => unknown; req: { query: (key: string) => string | undefined } }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  const defaultTenantId = auth?.tenantId || c.req.query('tenant_id') || '';
  if (CROSS_TENANT_ROLES.has(auth?.role || '')) {
    return c.req.query('tenant_id') || defaultTenantId;
  }
  return defaultTenantId;
}

// GET /api/roi/ — Latest ROI
roi.get('/', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const row = await c.env.DB.prepare('SELECT * FROM roi_tracking WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1').bind(tenantId).first();
  // No ROI ever computed for this tenant. Return nulls, NOT zeros — a fresh
  // tenant hasn't *measured* R0 recovered, it has measured nothing. The /x
  // cards render null as an honest em-dash; a 0 would be a fabricated figure.
  if (!row) return c.json({ id: null, totalDiscrepancyValueIdentified: null, totalDiscrepancyValueRecovered: null, totalPreventedLosses: null, totalPersonHoursSaved: null, roiMultiple: null, platformCost: null, calculatedAt: null, breakdown: { byCluster: [], byConnection: [] } });

  // §9.4 CSV export
  if (c.req.query('format') === 'csv') {
    const csvRow = [{
      period: row.period, identified: row.total_discrepancy_value_identified,
      recovered: row.total_discrepancy_value_recovered, prevented: row.total_downstream_losses_prevented,
      hoursSaved: row.total_person_hours_saved, runs: row.total_catalyst_runs,
      cost: row.licence_cost_annual, roiMultiple: row.roi_multiple, calculatedAt: row.calculated_at,
    }];
    return csvResponse(toCSV(csvRow, [
      { key: 'period', label: 'Period' }, { key: 'identified', label: 'Value Identified (ZAR)' },
      { key: 'recovered', label: 'Value Recovered (ZAR)' }, { key: 'prevented', label: 'Prevented Losses (ZAR)' },
      { key: 'hoursSaved', label: 'Person Hours Saved' }, { key: 'runs', label: 'Catalyst Runs' },
      { key: 'cost', label: 'Platform Cost (ZAR)' }, { key: 'roiMultiple', label: 'Operational ROI (vs Licence)' },
    ]), 'roi-tracking.csv');
  }

  // v60 attribution — split the recovered total per ERP/subsystem connection
  // so the customer can audit which connection drove which dollars under the
  // shared-savings model. Best-effort: never fails the response.
  const recovered = (row.total_discrepancy_value_recovered as number) || 0;
  const identified = (row.total_discrepancy_value_identified as number) || 0;
  let byConnection: Awaited<ReturnType<typeof computeRoiAttribution>> = [];
  try {
    byConnection = await computeRoiAttribution(c.env.DB, tenantId, recovered);
  } catch { /* leave empty */ }

  // v63 — split identified opportunity by action state (automated vs
  // pending vs open). This proves the read→action loop is closed
  // end-to-end and shows the customer where each rand of opportunity
  // sits in the realisation pipeline.
  const byActionState = await computeActionAttribution(c.env.DB, tenantId, identified);

  return c.json({
    id: row.id, period: row.period,
    totalDiscrepancyValueIdentified: row.total_discrepancy_value_identified,
    totalDiscrepancyValueRecovered: row.total_discrepancy_value_recovered,
    totalPreventedLosses: row.total_downstream_losses_prevented,
    totalPersonHoursSaved: row.total_person_hours_saved,
    totalCatalystRuns: row.total_catalyst_runs,
    platformCost: row.licence_cost_annual,
    roiMultiple: row.roi_multiple, calculatedAt: row.calculated_at,
    breakdown: { byCluster: [], byConnection, byActionState },
  });
});

// GET /api/roi/overnight — the Overnight Recovery Receipt.
// What Atheon's autonomous (scheduled) sub-catalysts did since `since`
// (default: last 24h). triggered_by='schedule' ONLY — this is the "while you
// were away, the platform worked" proof, so manual runs are excluded. Honest
// empty state when nothing ran; recoveredZar can be 0 while identifiedZar > 0
// (found discrepancies, no verified write-back yet) — never fabricated.
roi.get('/overnight', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const sinceParam = c.req.query('since');
  const since = sinceParam && /^\d{4}-\d{2}-\d{2}T/.test(sinceParam)
    ? sinceParam
    : new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const runsRes = await c.env.DB.prepare(
    `SELECT id, sub_catalyst_name, cluster_id, status, matched, discrepancies,
            exceptions_raised, actions_created, total_source_value,
            total_discrepancy_value, currency, started_at, completed_at
       FROM sub_catalyst_runs
      WHERE tenant_id = ? AND triggered_by = 'schedule'
        AND COALESCE(completed_at, started_at) >= ?
      ORDER BY COALESCE(completed_at, started_at) DESC`
  ).bind(tenantId, since).all<{
    id: string; sub_catalyst_name: string; cluster_id: string; status: string;
    matched: number; discrepancies: number; exceptions_raised: number;
    actions_created: number; total_source_value: number;
    total_discrepancy_value: number; currency: string;
    started_at: string; completed_at: string | null;
  }>();
  const runs = runsRes.results || [];

  // Recovered = verified/completed write-back value from actions those runs
  // created. Same honesty filter as computeActionAttribution: exclude
  // failed/skipped/deferred — the ERP did not confirm the change.
  let recoveredZar = 0, actionsCompleted = 0, actionsPending = 0;
  if (runs.length) {
    const ids = runs.map((r) => r.id);
    const ph = ids.map(() => '?').join(',');
    const actRes = await c.env.DB.prepare(
      `SELECT status, COUNT(*) AS n, COALESCE(SUM(value_zar), 0) AS v
         FROM catalyst_actions
        WHERE tenant_id = ? AND run_id IN (${ph})
          AND (verification_status IS NULL
               OR verification_status NOT IN ('failed', 'skipped', 'deferred'))
        GROUP BY status`
    ).bind(tenantId, ...ids).all<{ status: string; n: number; v: number }>();
    for (const a of actRes.results || []) {
      if (a.status === 'completed') { recoveredZar += a.v; actionsCompleted += a.n; }
      else if (a.status === 'pending_approval') { actionsPending += a.n; }
    }
  }

  const identifiedZar = runs.reduce((s, r) => s + (Number(r.total_discrepancy_value) || 0), 0);
  const currency = runs.find((r) => r.currency)?.currency || 'ZAR';

  return c.json({
    since,
    runCount: runs.length,
    recoveredZar,
    identifiedZar,
    actionsCompleted,
    actionsPending,
    currency,
    runs: runs.map((r) => ({
      id: r.id, name: r.sub_catalyst_name, clusterId: r.cluster_id,
      status: r.status, matched: r.matched, discrepancies: r.discrepancies,
      exceptions: r.exceptions_raised, actionsCreated: r.actions_created,
      identifiedZar: r.total_discrepancy_value, sourceValue: r.total_source_value,
      startedAt: r.started_at, completedAt: r.completed_at,
    })),
  });
});

// GET /api/roi/history — ROI history
roi.get('/history', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const limit = Math.min(parseInt(c.req.query('limit') || '12', 10) || 12, 36);
  const results = await c.env.DB.prepare('SELECT * FROM roi_tracking WHERE tenant_id = ? ORDER BY period DESC LIMIT ?').bind(tenantId, limit).all();
  const history = results.results.map((r: Record<string, unknown>) => ({
    period: r.period,
    totalDiscrepancyValueIdentified: r.total_discrepancy_value_identified,
    totalDiscrepancyValueRecovered: r.total_discrepancy_value_recovered,
    roiMultiple: r.roi_multiple, calculatedAt: r.calculated_at,
  }));
  return c.json({ history, total: history.length });
});

// GET /api/roi/export — Export ROI data
roi.get('/export', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);

  // Recalculate first
  try { await calculateROI(c.env.DB, tenantId); } catch { /* use existing data */ }

  const results = await c.env.DB.prepare('SELECT * FROM roi_tracking WHERE tenant_id = ? ORDER BY period DESC').bind(tenantId).all();
  const rows = results.results.map((r: Record<string, unknown>) => ({
    period: r.period,
    identified: r.total_discrepancy_value_identified,
    recovered: r.total_discrepancy_value_recovered,
    prevented: r.total_downstream_losses_prevented,
    personHours: r.total_person_hours_saved,
    runs: r.total_catalyst_runs,
    licenceCost: r.licence_cost_annual,
    roiMultiple: r.roi_multiple,
  }));
  return c.json({ export: rows, total: rows.length, currency: 'ZAR' });
});

export default roi;
