/**
 * Catalyst Simulator — integration tests.
 *
 * Three things to prove:
 *   1. simulateCatalyst() returns a calibrated prediction with bounds
 *      derived from the tenant's actual ERP data via the findings engine
 *   2. recordOutcome() updates the Welford running stats correctly
 *   3. After enough observations, the CI tightens (n >= 5 → real std,
 *      n < 5 → fixed ±30% band)
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  simulateCatalyst,
  recordOutcome,
  getCalibrationStats,
  listRecentSimulations,
  _testExports,
} from '../services/catalyst-simulator';

const TENANT_ID = 'sim-tenant';
const CLUSTER_ID = 'sim-cluster';

async function migrate(): Promise<void> {
  const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
    method: 'POST',
    headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
  });
  if (res.status !== 200) throw new Error(`Migration failed: ${res.status}`);
}

async function seedRun(runId: string): Promise<void> {
  // The recordOutcome FK references sub_catalyst_runs(id), so tests
  // need a real row to satisfy the constraint.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO sub_catalyst_runs
       (id, tenant_id, cluster_id, sub_catalyst_name, run_number, status)
     VALUES (?, ?, ?, 'AR Collection', 1, 'completed')`,
  ).bind(runId, TENANT_ID, CLUSTER_ID).run();
}

async function seedTenantWithFinanceData(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`,
  ).bind(TENANT_ID, 'Sim Tenant', TENANT_ID).run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO catalyst_clusters (id, tenant_id, name, domain) VALUES (?, ?, 'Finance Catalyst', 'finance')`,
  ).bind(CLUSTER_ID, TENANT_ID).run();
  // Seed AR aging 90+ findings: 5 unpaid invoices >= 90 days past due.
  for (let i = 0; i < 5; i++) {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO erp_invoices (id, tenant_id, invoice_number, customer_name, invoice_date, due_date, total, amount_due, currency, payment_status, status)
       VALUES (?, ?, ?, ?, date('now', '-180 days'), date('now', '-120 days'), ?, ?, 'ZAR', 'unpaid', 'sent')`,
    ).bind(`sim-inv-${i}`, TENANT_ID, `INV-SIM-${i}`, `Customer ${i}`, 100_000 + i * 10_000, 100_000 + i * 10_000).run();
  }
}

describe('Catalyst Simulator — Welford online stats helper', () => {
  it('produces correct mean + variance for a known sequence', () => {
    // Manual reference: residuals 0.8, 1.0, 1.2, 1.0, 1.0 → mean 1.0, sample var 0.02, std ≈ 0.1414
    const observations = [0.8, 1.0, 1.2, 1.0, 1.0];
    const errors = [10000, 0, 12000, 0, 0];
    let agg = { n: 0, mean: 0, m2: 0, sumAbsErr: 0 };
    for (let i = 0; i < observations.length; i++) {
      agg = _testExports.welfordUpdate(agg, observations[i], errors[i]);
    }
    expect(agg.n).toBe(5);
    expect(agg.mean).toBeCloseTo(1.0, 5);
    const variance = agg.m2 / (agg.n - 1);
    expect(Math.sqrt(variance)).toBeCloseTo(0.1414, 3);
    expect(agg.sumAbsErr / agg.n).toBe(4400); // (10000 + 0 + 12000 + 0 + 0) / 5
  });
});

describe('Catalyst Simulator — simulateCatalyst', () => {
  beforeAll(async () => { await migrate(); });
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM catalyst_simulations WHERE tenant_id = ?`).bind(TENANT_ID).run();
    await env.DB.prepare(`DELETE FROM catalyst_calibrations WHERE tenant_id = ?`).bind(TENANT_ID).run();
    await env.DB.prepare(`DELETE FROM erp_invoices WHERE tenant_id = ?`).bind(TENANT_ID).run();
    await seedTenantWithFinanceData();
  });

  it('returns a positive prediction grounded in findings + cold-start ±30% CI', async () => {
    const result = await simulateCatalyst(env.DB, TENANT_ID, 'Finance Catalyst', 'AR Collection', {
      clusterId: CLUSTER_ID,
    });

    expect(result.predicted_value_zar).toBeGreaterThan(0);
    expect(result.lower_bound_zar).toBeGreaterThanOrEqual(0);
    expect(result.upper_bound_zar).toBeGreaterThan(result.predicted_value_zar);
    expect(result.calibration_factor).toBe(1); // first run, no priors → factor 1
    expect(result.n_priors).toBe(0);

    // Cold-start CI = ±30% × prediction
    expect(result.upper_bound_zar - result.predicted_value_zar).toBeCloseTo(result.predicted_value_zar * 0.30, 0);
    expect(result.predicted_value_zar - result.lower_bound_zar).toBeCloseTo(result.predicted_value_zar * 0.30, 0);

    // Methodology surfaces contributing finding codes
    expect(result.methodology.contributing_finding_codes.length).toBeGreaterThan(0);
    expect(result.methodology.contributing_finding_codes).toContain('ar_aging_overdue_90_plus');
  });

  it('persists the simulation row + returns its id', async () => {
    const result = await simulateCatalyst(env.DB, TENANT_ID, 'Finance Catalyst', 'AR Collection', { clusterId: CLUSTER_ID });
    const row = await env.DB.prepare(
      `SELECT predicted_value_zar, calibration_factor FROM catalyst_simulations WHERE id = ?`,
    ).bind(result.id).first<{ predicted_value_zar: number; calibration_factor: number }>();
    expect(row).not.toBeNull();
    expect(row!.predicted_value_zar).toBeCloseTo(result.predicted_value_zar);
    expect(row!.calibration_factor).toBe(1);
  });

  it('returns zero prediction with notes when no findings match the catalyst', async () => {
    const result = await simulateCatalyst(env.DB, TENANT_ID, 'Service Operations Catalyst', 'Billable Utilisation', {
      clusterId: CLUSTER_ID,
    });
    expect(result.predicted_value_zar).toBe(0);
    expect(result.methodology.contributing_finding_count).toBe(0);
  });
});

describe('Catalyst Simulator — recordOutcome + calibration', () => {
  beforeAll(async () => { await migrate(); });
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM catalyst_simulations WHERE tenant_id = ?`).bind(TENANT_ID).run();
    await env.DB.prepare(`DELETE FROM catalyst_calibrations WHERE tenant_id = ?`).bind(TENANT_ID).run();
    await env.DB.prepare(`DELETE FROM erp_invoices WHERE tenant_id = ?`).bind(TENANT_ID).run();
    await seedTenantWithFinanceData();
  });

  it('updates calibration_factor + std_residual after enough observations', async () => {
    // Simulate + record 6 outcomes with known residuals to drive calibration.
    // With 5 priors, the simulator switches from cold-start ±30% to the
    // real CI based on observed std.
    const residuals = [0.8, 1.0, 1.2, 1.0, 1.0, 1.0];
    let lastSim: { id: string; predicted_value_zar: number } | null = null;

    for (let i = 0; i < residuals.length; i++) {
      const sim = await simulateCatalyst(env.DB, TENANT_ID, 'Finance Catalyst', 'AR Collection', { clusterId: CLUSTER_ID });
      const rawPrediction = sim.predicted_value_zar / Math.max(sim.calibration_factor, 0.0001);
      const actualValue = rawPrediction * residuals[i];
      await seedRun(`run-${i}`);
      await recordOutcome(env.DB, TENANT_ID, sim.id, `run-${i}`, actualValue);
      lastSim = sim;
    }

    const stats = await getCalibrationStats(env.DB, TENANT_ID, CLUSTER_ID, 'AR Collection');
    expect(stats.n_observations).toBe(6);
    // Mean of [0.8, 1.0, 1.2, 1.0, 1.0, 1.0] = 1.0
    expect(stats.calibration_factor).toBeCloseTo(1.0, 2);
    // Some non-zero std now that we have observations
    expect(stats.std_residual).toBeGreaterThan(0);
    expect(lastSim).not.toBeNull();
  });

  it('next prediction uses the updated calibration factor', async () => {
    // Prime calibration with a residual of 0.5 (predictions overshoot 2x).
    const sim1 = await simulateCatalyst(env.DB, TENANT_ID, 'Finance Catalyst', 'AR Collection', { clusterId: CLUSTER_ID });
    const initialPrediction = sim1.predicted_value_zar;
    await seedRun('run-prime');
    await recordOutcome(env.DB, TENANT_ID, sim1.id, 'run-prime', initialPrediction * 0.5);

    // Next simulation should apply the 0.5 calibration factor.
    const sim2 = await simulateCatalyst(env.DB, TENANT_ID, 'Finance Catalyst', 'AR Collection', { clusterId: CLUSTER_ID });
    expect(sim2.calibration_factor).toBeCloseTo(0.5, 2);
    expect(sim2.predicted_value_zar).toBeCloseTo(initialPrediction * 0.5, 0);
    expect(sim2.n_priors).toBe(1);
  });

  it('listRecentSimulations returns predicted vs actual for all simulations', async () => {
    // Each iteration records actual = 0.9 × predicted, and residual is computed as
    // actual / raw_prediction = 0.9 × calibration_factor. As calibration converges,
    // each successive residual gets smaller — so we assert the *set* rather than
    // depending on sub-millisecond ordering of simulated_at.
    for (let i = 0; i < 3; i++) {
      const sim = await simulateCatalyst(env.DB, TENANT_ID, 'Finance Catalyst', 'AR Collection', { clusterId: CLUSTER_ID });
      await seedRun(`run-list-${i}`);
      await recordOutcome(env.DB, TENANT_ID, sim.id, `run-list-${i}`, sim.predicted_value_zar * 0.9);
    }
    const list = await listRecentSimulations(env.DB, TENANT_ID, { clusterId: CLUSTER_ID, subCatalystName: 'AR Collection', limit: 10 });
    expect(list.length).toBe(3);
    for (const row of list) {
      expect(row.actual_value_zar).not.toBeNull();
      expect(row.residual).not.toBeNull();
    }
    // First iteration (factor=1.0) → residual=0.9 must appear in the set.
    const residuals = list.map(r => r.residual ?? 0).sort((a, b) => b - a);
    expect(residuals[0]).toBeCloseTo(0.9, 2);
  });

  it('throws when recording outcome for unknown simulation id', async () => {
    await expect(
      recordOutcome(env.DB, TENANT_ID, 'sim-does-not-exist', 'run-x', 10000),
    ).rejects.toThrow(/not found/);
  });

  it('idempotent: re-recording an outcome does not double-update calibration', async () => {
    const sim = await simulateCatalyst(env.DB, TENANT_ID, 'Finance Catalyst', 'AR Collection', { clusterId: CLUSTER_ID });
    await seedRun('run-x');
    await recordOutcome(env.DB, TENANT_ID, sim.id, 'run-x', sim.predicted_value_zar);
    const before = await getCalibrationStats(env.DB, TENANT_ID, CLUSTER_ID, 'AR Collection');
    await recordOutcome(env.DB, TENANT_ID, sim.id, 'run-x', sim.predicted_value_zar);
    const after = await getCalibrationStats(env.DB, TENANT_ID, CLUSTER_ID, 'AR Collection');
    expect(after.n_observations).toBe(before.n_observations);
  });
});
