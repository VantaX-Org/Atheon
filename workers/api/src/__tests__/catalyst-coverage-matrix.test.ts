/**
 * Coverage matrix test — guards against silent regressions where new
 * sub-catalysts get added to CATALYST_CATALOG without a handler that returns
 * a meaningful shape.
 *
 * The contract:
 *   For every enabled sub-catalyst in CATALYST_CATALOG, dispatchAction must
 *   return a payload whose `type` is NOT the legacy `generic_result`. The
 *   catalog-aware default already guarantees this for any catalystName that
 *   appears in CATALYST_CATALOG, so this test will fail only if a future
 *   change breaks that wiring (e.g. someone re-registers the old
 *   genericHandler, or a new code path bypasses the registry).
 *
 * Also asserts the cross-cutting handlers fire on representative actions —
 * payroll audit, compliance risk, data quality, customer experience, KPI
 * anomaly, vendor master cleanup — with their typed payloads.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import '../services/catalyst-engine';
import { dispatchAction } from '../services/catalyst-handler-registry';
import type { TaskDefinition } from '../services/catalyst-engine';
import { CATALYST_CATALOG } from '../services/catalyst-templates';

const TENANT = 'coverage-matrix-tenant';

function makeTask(overrides: Partial<TaskDefinition>): TaskDefinition {
  return {
    id: `cov-${crypto.randomUUID()}`,
    clusterId: 'cov-cluster',
    tenantId: TENANT,
    catalystName: '',
    action: '',
    inputData: {},
    riskLevel: 'low',
    autonomyTier: 'read-only',
    trustScore: 50,
    ...overrides,
  };
}

async function runSql(sql: string, ...binds: unknown[]): Promise<void> {
  await env.DB.prepare(sql).bind(...binds).run();
}

async function seedFixtures(): Promise<void> {
  await runSql(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`,
    TENANT, 'Coverage Matrix Tenant', 'cov-mat',
  );
  // Minimal payroll fixtures: one ghost (terminated but active row) and one
  // active employee, so payroll audit returns at least one signal.
  await runSql(
    `INSERT OR REPLACE INTO erp_employees (id, tenant_id, employee_number, first_name, last_name, department, position, hire_date, termination_date, gross_salary, status)
     VALUES (?, ?, 'C001', 'Alex', 'Active', 'Operations', 'Operator', '2020-01-01', NULL, 35000, 'active')`,
    'cov-emp-1', TENANT,
  );
  await runSql(
    `INSERT OR REPLACE INTO erp_employees (id, tenant_id, employee_number, first_name, last_name, department, position, hire_date, termination_date, gross_salary, status)
     VALUES (?, ?, 'C002', 'Ghost', 'OnPayroll', 'Operations', 'Operator', '2018-01-01', date('now', '-30 days'), 35000, 'active')`,
    'cov-emp-2', TENANT,
  );
  // Customers — one active near-limit, one inactive, for CX + churn signal.
  await runSql(
    `INSERT OR REPLACE INTO erp_customers (id, tenant_id, name, customer_group, credit_limit, credit_balance, status)
     VALUES (?, ?, 'Active Customer', 'enterprise', 100000, 95000, 'active')`,
    'cov-cust-1', TENANT,
  );
  await runSql(
    `INSERT OR REPLACE INTO erp_customers (id, tenant_id, name, customer_group, credit_limit, credit_balance, status)
     VALUES (?, ?, 'Churned Customer', 'enterprise', 50000, 0, 'inactive')`,
    'cov-cust-2', TENANT,
  );
  // Suppliers — duplicate name pair + one dormant (no recent PO) + complete.
  await runSql(
    `INSERT OR REPLACE INTO erp_suppliers (id, tenant_id, name, supplier_group, risk_score, status, country)
     VALUES (?, ?, 'Acme Supplies', 'wholesale', 0.4, 'active', 'ZA')`,
    'cov-sup-1', TENANT,
  );
  await runSql(
    `INSERT OR REPLACE INTO erp_suppliers (id, tenant_id, name, supplier_group, risk_score, status, country)
     VALUES (?, ?, 'acme supplies', 'wholesale', 0.5, 'active', 'ZA')`,
    'cov-sup-2', TENANT,
  );
  // Products — one healthy SKU.
  await runSql(
    `INSERT OR REPLACE INTO erp_products (id, tenant_id, sku, name, category, stock_on_hand, reorder_level, reorder_quantity, cost_price, selling_price, is_active, warehouse)
     VALUES (?, ?, 'COV-OK', 'Healthy SKU', 'general', 100, 10, 20, 5, 15, 1, 'WH-1')`,
    'cov-prod-1', TENANT,
  );
  // Process metric (red) + matching anomaly so KPI-anomaly intersects.
  await runSql(
    `INSERT OR REPLACE INTO process_metrics (id, tenant_id, name, value, unit, status, threshold_green, threshold_amber, threshold_red, source_system)
     VALUES (?, ?, 'API P95 Latency', 1500, 'ms', 'red', 200, 500, 1000, 'test')`,
    'cov-met-1', TENANT,
  );
  await runSql(
    `INSERT OR REPLACE INTO process_metrics (id, tenant_id, name, value, unit, status, threshold_green, threshold_amber, threshold_red, source_system)
     VALUES (?, ?, 'NPS Score', 45, 'score', 'red', 50, 30, 0, 'test')`,
    'cov-met-2', TENANT,
  );
  await runSql(
    `INSERT OR REPLACE INTO anomalies (id, tenant_id, metric, severity, expected_value, actual_value, deviation, hypothesis, status, detected_at)
     VALUES (?, ?, 'API P95 Latency', 'high', 800, 1500, 700, 'sustained latency rise', 'open', datetime('now', '-2 days'))`,
    'cov-anom-1', TENANT,
  );
  // Risk alerts — at least one compliance-flavoured.
  await runSql(
    `INSERT OR REPLACE INTO risk_alerts (id, tenant_id, title, description, severity, category, probability, impact_value, status, detected_at)
     VALUES (?, ?, 'POPIA processor agreement gap', 'Missing DPA on Vendor X', 'high', 'compliance-popia', 0.6, 250000, 'active', datetime('now', '-7 days'))`,
    'cov-risk-1', TENANT,
  );
  // Audit log — one event in last 30 days.
  await runSql(
    `INSERT OR REPLACE INTO audit_log (id, tenant_id, action, layer, resource, outcome, created_at)
     VALUES (?, ?, 'cov.test.event', 'audit', 'audit-test', 'success', datetime('now', '-3 days'))`,
    'cov-audit-1', TENANT,
  );
}

describe('Catalyst coverage matrix', () => {
  beforeAll(async () => {
    const migRes = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST',
      headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
    });
    if (migRes.status !== 200) throw new Error(`Migration failed: ${migRes.status}`);
    await seedFixtures();
  });

  // ── Coverage matrix: every enabled sub-catalyst returns a non-generic shape
  describe('every enabled sub-catalyst in CATALYST_CATALOG returns a typed payload', () => {
    for (const cluster of CATALYST_CATALOG) {
      for (const sub of cluster.sub_catalysts) {
        if (!sub.enabled) continue;
        it(`${cluster.name} / ${sub.name}`, async () => {
          const out = await dispatchAction(makeTask({
            catalystName: cluster.name,
            action: `${sub.name} default-coverage`,
            inputData: { domain: cluster.domain },
          }), env.DB);
          expect(out.type).toBeDefined();
          expect(out.type).not.toBe('generic_result');
          expect(typeof out.timestamp).toBe('string');
          // Either a domain handler matched (any non-generic type), or the
          // catalog-aware default did. Both are acceptable.
        });
      }
    }
  });

  // ── Cross-cutting handlers: assert the typed payloads land
  describe('cross-cutting handlers', () => {
    it('payroll audit returns ghost-employee evidence', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'HR Catalyst',
        action: 'run payroll audit',
      }), env.DB);
      expect(out.type).toBe('cross:payroll_audit');
      expect(out.ghostCount).toBeGreaterThanOrEqual(1);
      expect(out.recommendation).toMatch(/payroll discrepancy/);
    });

    it('compliance risk surfaces active risks + audit freshness', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Compliance Catalyst',
        action: 'compliance risk review',
      }), env.DB);
      expect(out.type).toBe('cross:compliance_risk');
      expect(out.activeRiskCount).toBeGreaterThanOrEqual(1);
      expect(out).toHaveProperty('totalImpactExposure');
    });

    it('data quality scores customer/supplier/product masters', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Data Quality Catalyst',
        action: 'master data quality scan',
      }), env.DB);
      expect(out.type).toBe('cross:data_quality_score');
      expect(typeof out.overallScore).toBe('number');
      expect(out).toHaveProperty('customerStats');
    });

    it('customer experience returns NPS + churn proxy', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Customer Experience Catalyst',
        action: 'nps trend review',
      }), env.DB);
      expect(out.type).toBe('cross:customer_experience');
      expect(typeof out.churnRatePct).toBe('number');
    });

    it('op KPI anomaly intersects red metrics with anomalies', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Operations Catalyst',
        action: 'kpi anomaly intersect',
      }), env.DB);
      expect(out.type).toBe('cross:op_kpi_anomaly');
      expect(out.intersection).toBeGreaterThanOrEqual(1);
    });

    it('vendor master cleanup detects duplicates', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Procurement Catalyst',
        action: 'vendor master cleanup',
      }), env.DB);
      expect(out.type).toBe('cross:vendor_master_cleanup');
      expect(out.duplicateGroupCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Catalog-aware default for an off-catalog name
  it('unknown catalystName still returns a typed payload (no throw)', async () => {
    const out = await dispatchAction(makeTask({
      catalystName: 'No Such Catalyst In Any Catalog',
      action: 'do something nondescript',
    }), env.DB);
    expect(out.type).toMatch(/catalog_default:/);
    expect(out.recommendation).toBeDefined();
  });
});
