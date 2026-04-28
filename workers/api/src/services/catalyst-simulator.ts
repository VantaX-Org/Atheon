/**
 * Catalyst Simulator with Closed-Loop Calibration
 * ================================================
 *
 * Predict the dollar impact of running a catalyst against a tenant's
 * current ERP state, **before** executing it; then record the actual
 * outcome and use the residual to make the next prediction better.
 *
 * This is the differentiator behind the "world-first" claim. Every
 * BI tool tells you what's wrong; a few autonomous tools execute a
 * fix. Atheon is the only one that:
 *
 *   1. Predicts the impact with a quantified confidence interval
 *      derived from this customer's own historical predictions.
 *   2. Tracks predicted vs actual on every run.
 *   3. Improves its own per-tenant calibration over time using
 *      Welford's online stats — no global model retraining required.
 *
 * Architecture
 * ============
 *  ┌─ catalyst_simulations table ──────────────────────────────┐
 *  │ • id, tenant_id, cluster_id, sub_catalyst_name            │
 *  │ • predicted_value_zar, lower_bound, upper_bound, conf_pct │
 *  │ • calibration_factor (applied at simulation time)         │
 *  │ • n_priors (# of historical observations behind the CI)   │
 *  │ • methodology_json (which detectors contributed, weights) │
 *  │ • run_id, actual_value_zar, residual, recorded_at         │
 *  └────────────────────────────────────────────────────────────┘
 *
 *  ┌─ catalyst_calibrations table ─────────────────────────────┐
 *  │ • per-(tenant, cluster, sub_catalyst) running stats        │
 *  │ • n_observations, mean_residual, m2_residual (Welford M2)  │
 *  │ • calibration_factor = mean_residual                       │
 *  │ • std_residual = sqrt(m2 / max(n - 1, 1))                  │
 *  │ • mae = mean absolute error                                │
 *  └────────────────────────────────────────────────────────────┘
 *
 * Welford's online algorithm: numerically stable single-pass
 * mean + variance, see Knuth TAOCP vol. 2 §4.2.2. Each new
 * observation updates the existing aggregate without recomputing
 * over history — important because production tenants will have
 * thousands of catalyst runs.
 *
 * Cold-start (n < 5)
 * ==================
 * Below 5 prior observations the residual std is unstable, so the
 * confidence interval falls back to a fixed ±30% band. Tenants
 * with no priors get calibration_factor = 1.0 (raw prediction).
 *
 * The prediction itself
 * =====================
 * For a given (cluster, sub_catalyst), we look up the matching
 * `Finding` from the live assessment-findings engine — its
 * `value_at_risk_zar` is our raw prediction (this is the current
 * state of the customer's ERP, post-detector logic).
 *
 *   raw_prediction = sum of value_at_risk on findings whose
 *                    recommended_catalyst matches (cluster, sub)
 *
 *   predicted_value_zar = raw_prediction × calibration_factor
 *
 *   bounds (n >= 5):     ± (1.96 × std_residual × raw_prediction)
 *   bounds (n < 5):      ± (0.30 × predicted_value_zar)
 *
 * Recording the outcome
 * =====================
 * After the catalyst runs, the actual recovered value is computed
 * from the catalyst run's `total_discrepancy_value` (or another
 * catalyst-defined metric — see CATALYST_OUTCOME_FIELDS for the
 * mapping). We record it on the simulation row and update the
 * calibration aggregate with the residual = actual / raw_prediction.
 */

import {
  detectAllFindings,
  FINDING_CATALYST_MAP,
  type Finding,
  type FindingsContext,
} from './assessment-findings';

// ── Types ─────────────────────────────────────────────────────────────────

export interface SimulationResult {
  id: string;
  cluster_id: string | null;
  sub_catalyst_name: string;
  /** Calibration-adjusted point prediction, in ZAR. */
  predicted_value_zar: number;
  /** Lower bound of the confidence interval. */
  lower_bound_zar: number;
  /** Upper bound of the confidence interval. */
  upper_bound_zar: number;
  /** Width of the CI (default 95%). */
  confidence_pct: number;
  /** Multiplier applied to the raw detector prediction to produce predicted_value_zar. */
  calibration_factor: number;
  /** How many historical observations went into the calibration. < 5 → fixed ±30% bound. */
  n_priors: number;
  /** Sample of contributing findings (top N by value) for the report. */
  methodology: {
    raw_prediction_zar: number;
    contributing_finding_codes: string[];
    contributing_finding_count: number;
    notes: string;
  };
  simulated_at: string;
}

export interface CalibrationStats {
  cluster_id: string | null;
  sub_catalyst_name: string;
  /** # of completed simulations with a recorded outcome. */
  n_observations: number;
  /** mean residual (calibration_factor that next prediction will use). */
  calibration_factor: number;
  /** standard deviation of the residual. */
  std_residual: number;
  /** mean absolute error of the calibration-adjusted predictions, in ZAR. */
  mae_zar: number;
  /** ISO of the most recent recorded outcome. */
  last_observation_at: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────

/** Z-score for a 95% two-sided CI. */
const Z_95 = 1.96;
/** Cold-start CI half-width as a fraction of the prediction. */
const COLD_START_BOUND_PCT = 0.30;
/** Minimum observations before we trust the calibration's std. */
const MIN_PRIORS_FOR_CI = 5;

// ── Welford's online stats ────────────────────────────────────────────────

/**
 * Update running mean / M2 with a new observation, returning the new
 * aggregate. Pure function for testability.
 *
 * Welford (1962) recurrence:
 *   delta  = x - mean_old
 *   mean   = mean_old + delta / n
 *   delta2 = x - mean
 *   M2     = M2_old + delta * delta2
 *
 * Variance = M2 / (n - 1) (sample) or M2 / n (population).
 * We use sample variance because we treat the observations as a
 * random sample of all possible runs.
 */
function welfordUpdate(
  prior: { n: number; mean: number; m2: number; sumAbsErr: number },
  observation: number,
  absErr: number,
): { n: number; mean: number; m2: number; sumAbsErr: number } {
  const n = prior.n + 1;
  const delta = observation - prior.mean;
  const mean = prior.mean + delta / n;
  const delta2 = observation - mean;
  const m2 = prior.m2 + delta * delta2;
  const sumAbsErr = prior.sumAbsErr + absErr;
  return { n, mean, m2, sumAbsErr };
}

// ── Calibration access ────────────────────────────────────────────────────

interface CalibrationRow {
  n_observations: number;
  mean_residual: number;
  m2_residual: number;
  calibration_factor: number;
  std_residual: number;
  mae: number;
  last_observation_at: string | null;
}

async function getCalibration(
  db: D1Database,
  tenantId: string,
  clusterId: string | null,
  subCatalystName: string,
): Promise<CalibrationRow | null> {
  // SQL `IS NULL` requires a different bind shape than `= ?` when clusterId is null.
  if (clusterId === null) {
    return db.prepare(
      `SELECT n_observations, mean_residual, m2_residual, calibration_factor, std_residual, mae, last_observation_at
         FROM catalyst_calibrations
        WHERE tenant_id = ? AND cluster_id IS NULL AND sub_catalyst_name = ?`,
    ).bind(tenantId, subCatalystName).first<CalibrationRow>();
  }
  return db.prepare(
    `SELECT n_observations, mean_residual, m2_residual, calibration_factor, std_residual, mae, last_observation_at
       FROM catalyst_calibrations
      WHERE tenant_id = ? AND cluster_id = ? AND sub_catalyst_name = ?`,
  ).bind(tenantId, clusterId, subCatalystName).first<CalibrationRow>();
}

async function upsertCalibration(
  db: D1Database,
  tenantId: string,
  clusterId: string | null,
  subCatalystName: string,
  next: { n: number; mean: number; m2: number; sumAbsErr: number },
): Promise<void> {
  const stdResidual = next.n > 1 ? Math.sqrt(next.m2 / (next.n - 1)) : 0;
  const mae = next.n > 0 ? next.sumAbsErr / next.n : 0;
  const id = `cal-${tenantId}-${clusterId || 'global'}-${subCatalystName}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  // 11 placeholders → 11 binds. last_observation_at is the only bound
  // ISO timestamp so the value is consistent if the same recordOutcome is
  // observed twice within a millisecond. updated_at uses SQLite's clock.
  const nowIso = new Date().toISOString();
  await db.prepare(
    `INSERT INTO catalyst_calibrations
       (id, tenant_id, cluster_id, sub_catalyst_name, n_observations, mean_residual, m2_residual,
        calibration_factor, std_residual, mae, last_observation_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(tenant_id, cluster_id, sub_catalyst_name) DO UPDATE SET
       n_observations = excluded.n_observations,
       mean_residual = excluded.mean_residual,
       m2_residual = excluded.m2_residual,
       calibration_factor = excluded.calibration_factor,
       std_residual = excluded.std_residual,
       mae = excluded.mae,
       last_observation_at = excluded.last_observation_at,
       updated_at = datetime('now')`,
  ).bind(id, tenantId, clusterId, subCatalystName, next.n, next.mean, next.m2, next.mean, stdResidual, mae, nowIso).run();
}

// ── Prediction ───────────────────────────────────────────────────────────

/**
 * Aggregate findings whose `recommended_catalyst` matches the requested
 * (clusterCatalystName, subCatalystName) into a single raw prediction.
 *
 * Note: `recommended_catalyst.catalyst` in FINDING_CATALYST_MAP is the
 * canonical cluster name from CATALYST_CATALOG (e.g. "Finance Catalyst"),
 * NOT the cluster_id. So the caller should pass the cluster's `name`
 * not its UUID, OR we accept null and aggregate across all matching
 * findings regardless of cluster.
 */
function findingsForCatalyst(
  findings: Finding[],
  catalystName: string,
  subCatalystName: string,
): Finding[] {
  return findings.filter(f => {
    const m = f.recommended_catalyst;
    return m && m.catalyst === catalystName && m.sub_catalyst === subCatalystName;
  });
}

export interface SimulateOptions {
  /** Optional cluster_id for storage; doesn't affect prediction logic. */
  clusterId?: string;
  /** ZAR is currently the only supported base currency. */
  exchangeRates?: Record<string, number>;
  monthsOfData?: number;
}

/**
 * Generate a calibrated prediction for running a catalyst against the
 * tenant's current state. Persists the prediction row so a later
 * `recordOutcome()` call can update the calibration. Returns the
 * SimulationResult shape the API surfaces.
 *
 * @param catalystName    Canonical cluster name from CATALYST_CATALOG, e.g. "Finance Catalyst"
 * @param subCatalystName Sub-catalyst name, e.g. "AR Collection"
 */
export async function simulateCatalyst(
  db: D1Database,
  tenantId: string,
  catalystName: string,
  subCatalystName: string,
  opts: SimulateOptions = {},
): Promise<SimulationResult> {
  // Verify the (catalyst, sub_catalyst) is a known mapping target. We don't
  // require it — a user could simulate a custom catalyst — but we surface
  // a warning in methodology.notes so the report is honest.
  const knownTarget = Object.values(FINDING_CATALYST_MAP).some(
    m => m.catalyst === catalystName && m.sub_catalyst === subCatalystName,
  );

  // Build a findings context. The simulator uses the SAME detector engine
  // the assessment uses — there is no separate prediction model. The
  // value-at-risk numbers are the prediction.
  const ctx: FindingsContext = {
    baseCurrency: 'ZAR',
    exchangeRates: opts.exchangeRates ?? { ZAR: 1, USD: 18.5, EUR: 20, GBP: 23 },
    monthsOfData: opts.monthsOfData,
  };
  const allFindings = await detectAllFindings(db, tenantId, ctx);
  const matching = findingsForCatalyst(allFindings, catalystName, subCatalystName);
  const rawPrediction = matching.reduce((s, f) => s + f.value_at_risk_zar, 0);

  // Look up calibration. Cluster_id-keyed AND fall back to global (cluster_id IS NULL).
  const clusterId = opts.clusterId ?? null;
  let calibration = await getCalibration(db, tenantId, clusterId, subCatalystName);
  if (!calibration) {
    // Try global fallback (cluster_id IS NULL) so a customer's history of
    // running this sub-catalyst across any cluster informs the prediction.
    calibration = await getCalibration(db, tenantId, null, subCatalystName);
  }

  const n = calibration?.n_observations ?? 0;
  const factor = calibration?.calibration_factor ?? 1.0;
  const std = calibration?.std_residual ?? 0;

  const adjusted = rawPrediction * factor;
  let halfWidth: number;
  if (n >= MIN_PRIORS_FOR_CI && std > 0) {
    halfWidth = Z_95 * std * rawPrediction;
  } else {
    halfWidth = COLD_START_BOUND_PCT * adjusted;
  }
  const lower = Math.max(0, adjusted - halfWidth);
  const upper = adjusted + halfWidth;

  // Persist the prediction so recordOutcome() can find it later by id.
  const simulationId = `sim-${tenantId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const methodology = {
    raw_prediction_zar: rawPrediction,
    contributing_finding_codes: matching.slice(0, 10).map(f => f.code),
    contributing_finding_count: matching.length,
    notes: knownTarget
      ? (n >= MIN_PRIORS_FOR_CI
        ? `CI based on ${n} prior observations. Residual std = ${std.toFixed(3)}.`
        : `Cold-start: only ${n} prior observations. CI is a fixed ±${(COLD_START_BOUND_PCT * 100).toFixed(0)}% band; will tighten as outcomes accumulate.`)
      : `Catalyst "${catalystName} / ${subCatalystName}" is not in the standard FINDING_CATALYST_MAP — prediction is the sum of any findings whose recommended_catalyst matches verbatim. Confidence is best-effort.`,
  };

  await db.prepare(
    `INSERT INTO catalyst_simulations
       (id, tenant_id, cluster_id, sub_catalyst_name, predicted_value_zar,
        lower_bound_zar, upper_bound_zar, confidence_pct,
        calibration_factor, n_priors, methodology_json, simulated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 95, ?, ?, ?, datetime('now'))`,
  ).bind(
    simulationId, tenantId, clusterId, subCatalystName, adjusted,
    lower, upper, factor, n, JSON.stringify(methodology),
  ).run();

  return {
    id: simulationId,
    cluster_id: clusterId,
    sub_catalyst_name: subCatalystName,
    predicted_value_zar: adjusted,
    lower_bound_zar: lower,
    upper_bound_zar: upper,
    confidence_pct: 95,
    calibration_factor: factor,
    n_priors: n,
    methodology,
    simulated_at: new Date().toISOString(),
  };
}

// ── Outcome recording ────────────────────────────────────────────────────

/**
 * After a catalyst run completes, attach the actual recovered value to
 * the simulation row, compute the residual, and update the running
 * calibration via Welford. Idempotent: re-recording the same simulation
 * (same simulationId) returns without modifying calibration twice.
 *
 * `actualValueZar`: the catalyst's measured outcome (e.g. recovered AR
 *   in ZAR). Caller picks the metric — for AR Collection it's amount
 *   recovered; for Inventory Optimisation it's reduced carrying cost.
 */
export async function recordOutcome(
  db: D1Database,
  tenantId: string,
  simulationId: string,
  runId: string,
  actualValueZar: number,
): Promise<{ residual: number; calibration: CalibrationStats }> {
  const sim = await db.prepare(
    `SELECT id, cluster_id, sub_catalyst_name, predicted_value_zar, calibration_factor,
            actual_value_zar, methodology_json
       FROM catalyst_simulations
      WHERE id = ? AND tenant_id = ?`,
  ).bind(simulationId, tenantId).first<{
    id: string; cluster_id: string | null; sub_catalyst_name: string;
    predicted_value_zar: number; calibration_factor: number;
    actual_value_zar: number | null; methodology_json: string;
  }>();
  if (!sim) {
    throw new Error(`simulation ${simulationId} not found for tenant ${tenantId}`);
  }

  // Idempotency: if outcome already recorded, return current calibration.
  if (sim.actual_value_zar !== null && sim.actual_value_zar !== undefined) {
    const existing = await getCalibration(db, tenantId, sim.cluster_id, sim.sub_catalyst_name);
    return {
      residual: sim.actual_value_zar / Math.max(sim.predicted_value_zar / sim.calibration_factor, 1),
      calibration: {
        cluster_id: sim.cluster_id,
        sub_catalyst_name: sim.sub_catalyst_name,
        n_observations: existing?.n_observations || 0,
        calibration_factor: existing?.calibration_factor || 1,
        std_residual: existing?.std_residual || 0,
        mae_zar: existing?.mae || 0,
        last_observation_at: existing?.last_observation_at || null,
      },
    };
  }

  // Residual = actual / raw_prediction. raw_prediction = predicted / calibration_factor.
  // (The next calibration update applies to the RAW predictor — calibration_factor
  // shouldn't compound across observations.)
  const rawPrediction = sim.predicted_value_zar / Math.max(sim.calibration_factor, 0.0001);
  const residual = rawPrediction > 0 ? actualValueZar / rawPrediction : 1;
  const absErr = Math.abs(actualValueZar - sim.predicted_value_zar);

  // Persist outcome on the simulation row.
  await db.prepare(
    `UPDATE catalyst_simulations
        SET run_id = ?, actual_value_zar = ?, residual = ?, recorded_at = datetime('now')
      WHERE id = ?`,
  ).bind(runId, actualValueZar, residual, simulationId).run();

  // Update calibration stats via Welford.
  const prior = await getCalibration(db, tenantId, sim.cluster_id, sim.sub_catalyst_name);
  const next = welfordUpdate(
    {
      n: prior?.n_observations ?? 0,
      mean: prior?.mean_residual ?? 0,
      m2: prior?.m2_residual ?? 0,
      sumAbsErr: (prior?.mae ?? 0) * (prior?.n_observations ?? 0),
    },
    residual,
    absErr,
  );
  await upsertCalibration(db, tenantId, sim.cluster_id, sim.sub_catalyst_name, next);

  return {
    residual,
    calibration: {
      cluster_id: sim.cluster_id,
      sub_catalyst_name: sim.sub_catalyst_name,
      n_observations: next.n,
      calibration_factor: next.mean,
      std_residual: next.n > 1 ? Math.sqrt(next.m2 / (next.n - 1)) : 0,
      mae_zar: next.n > 0 ? next.sumAbsErr / next.n : 0,
      last_observation_at: new Date().toISOString(),
    },
  };
}

// ── Read helpers ─────────────────────────────────────────────────────────

/**
 * List recent simulations for a (tenant, cluster, sub_catalyst), most recent first.
 * Used by the calibration chart on the frontend — predicted vs actual scatter.
 */
export async function listRecentSimulations(
  db: D1Database,
  tenantId: string,
  filter: { clusterId?: string; subCatalystName?: string; limit?: number },
): Promise<Array<{
  id: string;
  sub_catalyst_name: string;
  cluster_id: string | null;
  predicted_value_zar: number;
  lower_bound_zar: number;
  upper_bound_zar: number;
  actual_value_zar: number | null;
  residual: number | null;
  calibration_factor: number;
  n_priors: number;
  simulated_at: string;
  recorded_at: string | null;
}>> {
  const limit = Math.min(filter.limit ?? 50, 200);
  const conditions = ['tenant_id = ?'];
  const binds: unknown[] = [tenantId];
  if (filter.clusterId) {
    conditions.push('cluster_id = ?');
    binds.push(filter.clusterId);
  }
  if (filter.subCatalystName) {
    conditions.push('sub_catalyst_name = ?');
    binds.push(filter.subCatalystName);
  }
  const rows = await db.prepare(
    `SELECT id, sub_catalyst_name, cluster_id, predicted_value_zar, lower_bound_zar, upper_bound_zar,
            actual_value_zar, residual, calibration_factor, n_priors, simulated_at, recorded_at
       FROM catalyst_simulations
      WHERE ${conditions.join(' AND ')}
      ORDER BY simulated_at DESC
      LIMIT ${limit}`,
  ).bind(...binds).all();
  return (rows.results || []) as Array<{
    id: string;
    sub_catalyst_name: string;
    cluster_id: string | null;
    predicted_value_zar: number;
    lower_bound_zar: number;
    upper_bound_zar: number;
    actual_value_zar: number | null;
    residual: number | null;
    calibration_factor: number;
    n_priors: number;
    simulated_at: string;
    recorded_at: string | null;
  }>;
}

/** Read-only calibration snapshot for the calibration chart header. */
export async function getCalibrationStats(
  db: D1Database,
  tenantId: string,
  clusterId: string | null,
  subCatalystName: string,
): Promise<CalibrationStats> {
  const row = await getCalibration(db, tenantId, clusterId, subCatalystName);
  return {
    cluster_id: clusterId,
    sub_catalyst_name: subCatalystName,
    n_observations: row?.n_observations ?? 0,
    calibration_factor: row?.calibration_factor ?? 1,
    std_residual: row?.std_residual ?? 0,
    mae_zar: row?.mae ?? 0,
    last_observation_at: row?.last_observation_at ?? null,
  };
}

// ── Test-only export ─────────────────────────────────────────────────────
export const _testExports = { welfordUpdate };
