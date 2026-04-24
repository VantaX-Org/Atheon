/**
 * Domain catalyst handler test suite.
 *
 * Seeds a tenant with realistic fixtures (employees, products, invoices,
 * POs, customers, suppliers, metrics, anomalies, risks) and then dispatches
 * one representative action per sub-catalyst, asserting the handler returns
 * the expected shape.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
// Import catalyst-engine once — its module-level code wires up all domain
// handlers (operational, commercial, service, general) via the registry.
import '../services/catalyst-engine';
import { dispatchAction } from '../services/catalyst-handler-registry';
import type { TaskDefinition } from '../services/catalyst-engine';

const TENANT = 'domain-test-tenant';

function makeTask(overrides: Partial<TaskDefinition>): TaskDefinition {
  return {
    id: `test-${crypto.randomUUID()}`,
    clusterId: 'test-cluster',
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
  const now = new Date().toISOString();
  // Tenant
  await runSql(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`,
    TENANT, 'Domain Test Corp', 'dom-test',
  );

  // Employees (mix of depts, some terminated)
  await runSql(
    `INSERT OR REPLACE INTO erp_employees (id, tenant_id, employee_number, first_name, last_name, department, position, hire_date, termination_date, gross_salary, status)
     VALUES (?, ?, 'E001', 'Alice', 'A', 'Mining Ops', 'Operator', '2015-01-01', NULL, 30000, 'active')`,
    'emp-1', TENANT,
  );
  await runSql(
    `INSERT OR REPLACE INTO erp_employees (id, tenant_id, employee_number, first_name, last_name, department, position, hire_date, termination_date, gross_salary, status)
     VALUES (?, ?, 'E002', 'Bob', 'B', 'Mining Ops', 'Operator', '2014-03-15', NULL, 32000, 'active')`,
    'emp-2', TENANT,
  );
  await runSql(
    `INSERT OR REPLACE INTO erp_employees (id, tenant_id, employee_number, first_name, last_name, department, position, hire_date, termination_date, gross_salary, status)
     VALUES (?, ?, 'E003', 'Carol', 'C', 'Engineering', 'Engineer', '2022-06-01', ?, 50000, 'terminated')`,
    'emp-3', TENANT, new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10),
  );
  await runSql(
    `INSERT OR REPLACE INTO erp_employees (id, tenant_id, employee_number, first_name, last_name, department, position, hire_date, termination_date, gross_salary, status)
     VALUES (?, ?, 'E004', 'Dan', 'D', 'Engineering', 'Engineer', '2023-01-01', NULL, 55000, 'active')`,
    'emp-4', TENANT,
  );
  await runSql(
    `INSERT OR REPLACE INTO erp_employees (id, tenant_id, employee_number, first_name, last_name, department, position, hire_date, termination_date, gross_salary, status)
     VALUES (?, ?, 'E005', 'Eve', 'E', 'Clinical', 'Nurse', '2021-01-01', NULL, 40000, 'active')`,
    'emp-5', TENANT,
  );
  await runSql(
    `INSERT OR REPLACE INTO erp_employees (id, tenant_id, employee_number, first_name, last_name, department, position, hire_date, termination_date, gross_salary, status)
     VALUES (?, ?, 'E006', 'Frank', 'F', 'Clinical', 'Nurse', '2021-04-01', NULL, 42000, 'active')`,
    'emp-6', TENANT,
  );

  // Customers (mix of groups, some over credit limit)
  await runSql(
    `INSERT OR REPLACE INTO erp_customers (id, tenant_id, name, customer_group, credit_limit, credit_balance, status)
     VALUES (?, ?, 'Big Distributor', 'distributor', 100000, 95000, 'active')`,
    'cust-1', TENANT,
  );
  await runSql(
    `INSERT OR REPLACE INTO erp_customers (id, tenant_id, name, customer_group, credit_limit, credit_balance, status)
     VALUES (?, ?, 'Small Retailer', 'retail', 10000, 12000, 'active')`,
    'cust-2', TENANT,
  );
  await runSql(
    `INSERT OR REPLACE INTO erp_customers (id, tenant_id, name, customer_group, credit_limit, credit_balance, status)
     VALUES (?, ?, 'Churned Co', 'enterprise', 50000, 50000, 'inactive')`,
    'cust-3', TENANT,
  );

  // Suppliers (with risk scores)
  await runSql(
    `INSERT OR REPLACE INTO erp_suppliers (id, tenant_id, name, supplier_group, risk_score, status, country)
     VALUES (?, ?, 'Risky Supplier', 'wholesale', 0.8, 'active', 'ZA')`,
    'sup-1', TENANT,
  );
  await runSql(
    `INSERT OR REPLACE INTO erp_suppliers (id, tenant_id, name, supplier_group, risk_score, status, country)
     VALUES (?, ?, 'Safe Supplier', 'wholesale', 0.2, 'active', 'ZA')`,
    'sup-2', TENANT,
  );

  // Products — mix of out-of-stock, low-stock, healthy; seed/chem for agri
  await runSql(
    `INSERT OR REPLACE INTO erp_products (id, tenant_id, sku, name, category, stock_on_hand, reorder_level, reorder_quantity, cost_price, selling_price, is_active, warehouse)
     VALUES (?, ?, 'SKU-OOS', 'Out Of Stock Item', 'general', 0, 10, 50, 10, 25, 1, 'WH-1')`,
    'prod-1', TENANT,
  );
  await runSql(
    `INSERT OR REPLACE INTO erp_products (id, tenant_id, sku, name, category, stock_on_hand, reorder_level, reorder_quantity, cost_price, selling_price, is_active, warehouse)
     VALUES (?, ?, 'SKU-LOW', 'Low Stock Item', 'general', 3, 10, 20, 5, 15, 1, 'WH-1')`,
    'prod-2', TENANT,
  );
  await runSql(
    `INSERT OR REPLACE INTO erp_products (id, tenant_id, sku, name, category, stock_on_hand, reorder_level, reorder_quantity, cost_price, selling_price, is_active, warehouse)
     VALUES (?, ?, 'SKU-SEED', 'Maize Seed Bag', 'seed', 2, 5, 10, 100, 200, 1, 'WH-2')`,
    'prod-3', TENANT,
  );
  await runSql(
    `INSERT OR REPLACE INTO erp_products (id, tenant_id, sku, name, category, stock_on_hand, reorder_level, reorder_quantity, cost_price, selling_price, is_active, warehouse)
     VALUES (?, ?, 'SKU-HEALTHY', 'Healthy Stock Item', 'general', 100, 10, 20, 8, 20, 1, 'WH-1')`,
    'prod-4', TENANT,
  );

  // Invoices — some overdue
  const overdueDate = new Date(Date.now() - 40 * 86400 * 1000).toISOString().slice(0, 10);
  const futureDate = new Date(Date.now() + 20 * 86400 * 1000).toISOString().slice(0, 10);
  await runSql(
    `INSERT OR REPLACE INTO erp_invoices (id, tenant_id, invoice_number, customer_id, customer_name, invoice_date, due_date, total, amount_due, payment_status, status)
     VALUES (?, ?, 'INV-001', ?, 'Big Distributor', ?, ?, 10000, 10000, 'unpaid', 'issued')`,
    'inv-1', TENANT, 'cust-1', overdueDate, overdueDate,
  );
  await runSql(
    `INSERT OR REPLACE INTO erp_invoices (id, tenant_id, invoice_number, customer_id, customer_name, invoice_date, due_date, total, amount_due, payment_status, status)
     VALUES (?, ?, 'INV-002', ?, 'Small Retailer', ?, ?, 500, 0, 'paid', 'issued')`,
    'inv-2', TENANT, 'cust-2', overdueDate, overdueDate,
  );
  await runSql(
    `INSERT OR REPLACE INTO erp_invoices (id, tenant_id, invoice_number, customer_id, customer_name, invoice_date, due_date, total, amount_due, payment_status, status)
     VALUES (?, ?, 'INV-003', ?, 'Big Distributor', ?, ?, 3000, 3000, 'unpaid', 'issued')`,
    'inv-3', TENANT, 'cust-1', now.slice(0, 10), futureDate,
  );

  // Purchase orders — some delayed
  await runSql(
    `INSERT OR REPLACE INTO erp_purchase_orders (id, tenant_id, po_number, supplier_id, supplier_name, order_date, delivery_date, total, delivery_status, status)
     VALUES (?, ?, 'PO-001', ?, 'Risky Supplier', ?, ?, 5000, 'delayed', 'approved')`,
    'po-1', TENANT, 'sup-1', overdueDate, overdueDate,
  );
  await runSql(
    `INSERT OR REPLACE INTO erp_purchase_orders (id, tenant_id, po_number, supplier_id, supplier_name, order_date, delivery_date, total, delivery_status, status)
     VALUES (?, ?, 'PO-002', ?, 'Safe Supplier', ?, ?, 2000, 'delivered', 'approved')`,
    'po-2', TENANT, 'sup-2', overdueDate, now.slice(0, 10),
  );

  // Process metrics — mix of red, amber, green; varied names for domain routing
  const metricInserts: [string, string, number, string, string][] = [
    ['m-1', 'PPE Compliance Rate', 60, '%', 'red'],
    ['m-2', 'Machine Uptime', 70, '%', 'red'],
    ['m-3', 'Production Throughput', 1200, 'units', 'amber'],
    ['m-4', 'Fleet Utilization', 45, '%', 'red'],
    ['m-5', 'Crop Yield', 7, 'tons/ha', 'amber'],
    ['m-6', 'Promo Uplift Q1', 12, '%', 'green'],
    ['m-7', 'API P95 Latency', 800, 'ms', 'red'],
  ];
  for (const [id, name, value, unit, status] of metricInserts) {
    await runSql(
      `INSERT OR REPLACE INTO process_metrics (id, tenant_id, name, value, unit, status, threshold_green, threshold_amber, threshold_red, source_system)
       VALUES (?, ?, ?, ?, ?, ?, 90, 80, 70, 'test')`,
      id, TENANT, name, value, unit, status,
    );
  }

  // Anomalies — mix of types
  const anomalyInserts: [string, string, string, number][] = [
    ['a-1', 'safety_incident_rate', 'high', 1.5],
    ['a-2', 'defect_rate_line_a', 'high', 0.12],
    ['a-3', 'api_error_rate', 'critical', 0.08],
    ['a-4', 'sales_conversion_rate', 'medium', 0.03],
  ];
  for (const [id, metric, severity, deviation] of anomalyInserts) {
    await runSql(
      `INSERT OR REPLACE INTO anomalies (id, tenant_id, metric, severity, expected_value, actual_value, deviation, hypothesis, status, detected_at)
       VALUES (?, ?, ?, ?, 1, 0.5, ?, 'Hypothesis', 'open', datetime('now', '-2 days'))`,
      id, TENANT, metric, severity, deviation,
    );
  }

  // Risk alerts — mix of categories
  const riskInserts: [string, string, string, number][] = [
    ['r-1', 'Safety Incident Trend', 'incident-safety', 250000],
    ['r-2', 'POPIA Compliance Gap', 'compliance-popia', 500000],
    ['r-3', 'CVE-2026-XYZ', 'security-vuln', 100000],
    ['r-4', 'Sales Pipeline Slippage', 'sales-pipeline', 750000],
    ['r-5', 'Credit Concentration', 'portfolio', 1500000],
  ];
  for (const [id, title, category, impact] of riskInserts) {
    await runSql(
      `INSERT OR REPLACE INTO risk_alerts (id, tenant_id, title, description, severity, category, probability, impact_value, status, detected_at)
       VALUES (?, ?, ?, 'Description', 'high', ?, 0.4, ?, 'active', datetime('now', '-5 days'))`,
      id, TENANT, title, category, impact,
    );
  }

  // Audit log — compliance events for finserv regulatory snapshot
  await runSql(
    `INSERT OR REPLACE INTO audit_log (id, tenant_id, action, layer, resource, outcome, created_at)
     VALUES (?, ?, 'popia.data_export.completed', 'compliance', 'data-export', 'success', datetime('now', '-3 days'))`,
    'audit-1', TENANT,
  );
}

describe('Domain catalyst handlers', () => {
  beforeAll(async () => {
    const migRes = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST',
      headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
    });
    if (migRes.status !== 200) throw new Error(`Migration failed: ${migRes.status}`);
    await seedFixtures();
  });

  // ── MINING ────────────────────────────────────────

  describe('Mining', () => {
    it('routes safety incident trend', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Mining Safety Catalyst',
        action: 'check_safety_incidents',
      }), env.DB);
      expect(out.type).toBe('mining_safety_incident_trend');
      expect(out.totalIncidents).toBeGreaterThanOrEqual(0);
    });

    it('routes PPE compliance', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Mining PPE',
        action: 'ppe_compliance_check',
      }), env.DB);
      expect(out.type).toBe('mining_ppe_compliance');
      expect(Array.isArray(out.metrics)).toBe(true);
    });

    it('routes fatigue risk', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Mining Workforce',
        action: 'assess_fatigue_rotation',
      }), env.DB);
      expect(out.type).toBe('mining_fatigue_risk');
    });
  });

  // ── MANUFACTURING ───────────────────────────────

  describe('Manufacturing', () => {
    it('routes throughput', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Production Line Catalyst',
        action: 'check_throughput',
      }), env.DB);
      expect(out.type).toBe('manufacturing_throughput');
    });

    it('routes quality defects', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Quality Catalyst',
        action: 'quality_defect_scan',
      }), env.DB);
      expect(out.type).toBe('manufacturing_quality_defects');
      expect(out.openAnomalies).toBeGreaterThanOrEqual(1);
    });

    it('routes maintenance due', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Maintenance Catalyst',
        action: 'equipment_maintenance_check',
      }), env.DB);
      expect(out.type).toBe('manufacturing_maintenance_due');
    });
  });

  // ── LOGISTICS ───────────────────────────────────

  describe('Logistics', () => {
    it('routes fleet utilization', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Fleet Catalyst',
        action: 'fleet_utilization_check',
      }), env.DB);
      expect(out.type).toBe('logistics_fleet_utilization');
    });

    it('routes delivery compliance', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Logistics Delivery',
        action: 'delivery_compliance_scan',
      }), env.DB);
      expect(out.type).toBe('logistics_delivery_compliance');
      expect(out.delayedCount).toBeGreaterThanOrEqual(1);
    });

    it('routes warehouse stock', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Warehouse Catalyst',
        action: 'warehouse_stock_audit',
      }), env.DB);
      expect(out.type).toBe('logistics_warehouse_stock');
    });
  });

  // ── RETAIL ──────────────────────────────────────

  describe('Retail', () => {
    it('routes basket analysis', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Retail POS Catalyst',
        action: 'basket_analysis',
      }), env.DB);
      expect(out.type).toBe('retail_basket_analysis');
    });

    it('routes out-of-stock', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Retail Inventory',
        action: 'retail_oos_check',
      }), env.DB);
      expect(out.type).toBe('retail_out_of_stock');
      expect(out.outOfStockCount).toBeGreaterThanOrEqual(1);
    });

    it('routes customer segmentation', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Retail CX',
        action: 'customer_segment_analysis',
      }), env.DB);
      expect(out.type).toBe('retail_customer_segmentation');
    });
  });

  // ── FMCG ────────────────────────────────────────

  describe('FMCG', () => {
    it('routes shelf stockout', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'FMCG Shelf',
        action: 'shelf_stockout_scan',
      }), env.DB);
      expect(out.type).toBe('fmcg_shelf_stockout');
    });

    it('routes distributor performance', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'FMCG Distributor Catalyst',
        action: 'distributor_performance_review',
      }), env.DB);
      expect(out.type).toBe('fmcg_distributor_performance');
    });

    it('routes promotion effectiveness', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'FMCG Trade Promo',
        action: 'promotion_effectiveness_check',
      }), env.DB);
      expect(out.type).toBe('fmcg_promotion_effectiveness');
    });
  });

  // ── AGRICULTURE ─────────────────────────────────

  describe('Agriculture', () => {
    it('routes reorder', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Farm Catalyst',
        action: 'agriculture_reorder_check',
      }), env.DB);
      expect(out.type).toBe('agriculture_reorder');
      expect(out.itemsAtOrBelowReorder).toBeGreaterThanOrEqual(1);
    });

    it('routes market metrics', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Agri Market',
        action: 'crop_market_scan',
      }), env.DB);
      expect(out.type).toBe('agriculture_market_metrics');
    });

    it('routes supplier risk', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Agri Supply',
        action: 'agri_supplier_risk',
      }), env.DB);
      expect(out.type).toBe('agriculture_supplier_risk');
    });
  });

  // ── HEALTHCARE ──────────────────────────────────

  describe('Healthcare', () => {
    it('routes staffing coverage', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Clinical Staffing Catalyst',
        action: 'staffing_coverage_check',
      }), env.DB);
      expect(out.type).toBe('healthcare_staffing_coverage');
    });

    it('routes overdue collections', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Healthcare Billing',
        action: 'payer_overdue_collection',
      }), env.DB);
      expect(out.type).toBe('healthcare_overdue_collections');
      expect(out.overdueInvoices).toBeGreaterThanOrEqual(1);
    });

    it('routes compliance risk scan', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Healthcare Compliance',
        action: 'popia_compliance_scan',
      }), env.DB);
      expect(out.type).toBe('healthcare_compliance_risk_scan');
    });
  });

  // ── TECHNOLOGY ──────────────────────────────────

  describe('Technology', () => {
    it('routes incident trend', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'DevOps Catalyst',
        action: 'devops_incident_trend',
      }), env.DB);
      expect(out.type).toBe('technology_incident_trend');
    });

    it('routes security alerts', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Technology Security',
        action: 'security_alert_scan',
      }), env.DB);
      expect(out.type).toBe('technology_security_alerts');
    });

    it('routes churn signal', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Tech Customer Success',
        action: 'customer_churn_check',
      }), env.DB);
      expect(out.type).toBe('technology_churn_signal');
    });
  });

  // ── FINANCIAL SERVICES ──────────────────────────

  describe('Financial Services', () => {
    it('routes portfolio risk', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'FinServ Portfolio',
        action: 'portfolio_risk_scan',
      }), env.DB);
      expect(out.type).toBe('finserv_portfolio_risk');
    });

    it('routes credit exposure', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'FinServ Credit',
        action: 'credit_exposure_check',
      }), env.DB);
      expect(out.type).toBe('finserv_credit_exposure');
      expect(out.overLimitCustomers).toBeGreaterThanOrEqual(1);
    });

    it('routes regulatory snapshot', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'FinServ Compliance',
        action: 'regulatory_snapshot_report',
      }), env.DB);
      expect(out.type).toBe('finserv_regulatory_snapshot');
    });
  });

  // ── GENERAL ─────────────────────────────────────

  describe('General cross-cutting', () => {
    it('routes HR turnover', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'HR Catalyst',
        action: 'hr_turnover_scan',
      }), env.DB);
      expect(out.type).toBe('hr_turnover');
      expect(out.totalDepartures).toBeGreaterThanOrEqual(1);
    });

    it('routes sales pipeline risk', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Sales Risk Catalyst',
        action: 'sales_pipeline_risk_check',
      }), env.DB);
      expect(out.type).toBe('sales_pipeline_risk');
    });

    it('routes operations red metrics', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Ops Red Metrics',
        action: 'operations_red_metric_scan',
      }), env.DB);
      expect(out.type).toBe('operations_red_metrics');
      expect(out.red).toBeGreaterThanOrEqual(1);
    });
  });

  // ── FALLBACK BEHAVIOUR ──────────────────────────

  describe('Fallback', () => {
    it('falls through to default read handler for unknown domain', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Generic Report',
        action: 'report_summary',
      }), env.DB);
      // default:read hits — inventory/invoice keywords are absent, so it
      // lands on either metric_analysis (via 'report' kw hitting nothing
      // specific) or data_summary. Both are valid default:read outputs.
      expect(['metric_analysis', 'data_summary', 'customer_analysis']).toContain(out.type);
    });

    it('falls through to default:generic catch-all when no keyword matches', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Mystery Action',
        action: 'xyzzy_zzz',
      }), env.DB);
      expect(out.type).toBe('generic_result');
    });
  });
});
