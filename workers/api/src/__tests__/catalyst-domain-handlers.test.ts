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

  // ── Extra fixtures for expanded sub-catalysts ──

  // Mining spare parts + medical supplies + pricing/overstocked examples
  await runSql(
    `INSERT OR REPLACE INTO erp_products (id, tenant_id, sku, name, category, stock_on_hand, reorder_level, reorder_quantity, cost_price, selling_price, is_active, warehouse)
     VALUES (?, ?, 'SPARE-01', 'Ball Bearing Set', 'spare parts', 2, 20, 50, 250, 400, 1, 'WH-1')`,
    'prod-spare', TENANT,
  );
  await runSql(
    `INSERT OR REPLACE INTO erp_products (id, tenant_id, sku, name, category, stock_on_hand, reorder_level, reorder_quantity, cost_price, selling_price, is_active, warehouse)
     VALUES (?, ?, 'MED-01', 'Surgical Gloves', 'medical consumable', 0, 100, 500, 2, 5, 1, 'WH-MED')`,
    'prod-med', TENANT,
  );
  await runSql(
    `INSERT OR REPLACE INTO erp_products (id, tenant_id, sku, name, category, stock_on_hand, reorder_level, reorder_quantity, cost_price, selling_price, is_active, warehouse)
     VALUES (?, ?, 'WEAK-MARGIN', 'Low-Margin Widget', 'general', 50, 10, 20, 80, 100, 1, 'WH-1')`,
    'prod-weak', TENANT,
  );
  await runSql(
    `INSERT OR REPLACE INTO erp_products (id, tenant_id, sku, name, category, stock_on_hand, reorder_level, reorder_quantity, cost_price, selling_price, is_active, warehouse)
     VALUES (?, ?, 'OVERSTOCK', 'Slow Mover', 'general', 500, 10, 20, 5, 15, 1, 'WH-1')`,
    'prod-over', TENANT,
  );

  // Extra metrics: env, energy, route, SLO, adoption, yield (with history)
  const extraMetrics: [string, string, number, string, string][] = [
    ['m-env', 'Dust Exposure Level', 150, 'mg/m3', 'red'],
    ['m-eng', 'Energy Consumption Line A', 95, 'kWh', 'red'],
    ['m-route', 'Route Efficiency Index', 62, '%', 'red'],
    ['m-slo', 'API P99 Latency SLO', 1200, 'ms', 'red'],
    ['m-adopt', 'Feature X Adoption Rate', 8, '%', 'amber'],
    ['m-yield', 'Maize Yield per Ha', 7, 'tons', 'green'],
  ];
  for (const [id, name, value, unit, status] of extraMetrics) {
    await runSql(
      `INSERT OR REPLACE INTO process_metrics (id, tenant_id, name, value, unit, status, threshold_green, threshold_amber, threshold_red, source_system)
       VALUES (?, ?, ?, ?, ?, ?, 90, 80, 70, 'test')`,
      id, TENANT, name, value, unit, status,
    );
  }

  // History for yield + adoption to enable variance/trend calcs.
  const historyYields = [6.5, 7.0, 6.8, 8.5, 5.5, 9.0];
  for (let i = 0; i < historyYields.length; i++) {
    await runSql(
      `INSERT OR REPLACE INTO process_metric_history (id, tenant_id, metric_id, value, recorded_at)
       VALUES (?, ?, 'm-yield', ?, datetime('now', '-${(i + 1) * 30} days'))`,
      `h-yield-${i}`, TENANT, historyYields[i],
    );
  }
  const historyAdoption = [5, 6, 7, 8];
  for (let i = 0; i < historyAdoption.length; i++) {
    await runSql(
      `INSERT OR REPLACE INTO process_metric_history (id, tenant_id, metric_id, value, recorded_at)
       VALUES (?, ?, 'm-adopt', ?, datetime('now', '-${(i + 1) * 7} days'))`,
      `h-adopt-${i}`, TENANT, historyAdoption[i],
    );
  }

  // Readmission anomaly
  await runSql(
    `INSERT OR REPLACE INTO anomalies (id, tenant_id, metric, severity, expected_value, actual_value, deviation, hypothesis, status, detected_at)
     VALUES (?, ?, '30-day readmission rate', 'high', 0.05, 0.12, 0.07, 'Post-discharge follow-up gap', 'open', datetime('now', '-3 days'))`,
    'a-readmit', TENANT,
  );

  // Invoice with promo/trade tag
  await runSql(
    `INSERT OR REPLACE INTO erp_invoices (id, tenant_id, invoice_number, customer_id, customer_name, invoice_date, due_date, total, amount_due, payment_status, status, reference, notes)
     VALUES (?, ?, 'INV-PROMO', ?, 'Big Distributor', ?, ?, 2500, 0, 'paid', 'issued', 'trade-promo-Q1', 'trade promotion')`,
    'inv-promo', TENANT, 'cust-1', new Date().toISOString().slice(0, 10), new Date(Date.now() + 10 * 86400 * 1000).toISOString().slice(0, 10),
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

    it('falls through to default:catalog catch-all when no keyword matches', async () => {
      // The previous catch-all (default:generic, type='generic_result') was
      // replaced with default:catalog (catalog_default:<bucket>) which uses
      // the catalog's domain field to produce a domain-shaped payload, or
      // catalog_default:unknown for an off-catalog catalystName.
      const out = await dispatchAction(makeTask({
        catalystName: 'Mystery Action',
        action: 'xyzzy_zzz',
      }), env.DB);
      expect(out.type).toBe('catalog_default:unknown');
    });
  });

  // ── EXPANDED SUB-CATALYSTS (Phase 3, PR #11) ────────────────────────

  describe('Mining (expanded)', () => {
    it('routes spare parts forecast', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Mining Supply',
        action: 'mining_spare_parts_forecast',
      }), env.DB);
      expect(out.type).toBe('mining_spare_parts_forecast');
      expect(out.criticalItems).toBeGreaterThanOrEqual(1);
    });

    it('routes environmental compliance', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Mining Environmental',
        action: 'environmental_compliance_scan',
      }), env.DB);
      expect(out.type).toBe('mining_environmental_compliance');
    });
  });

  describe('Manufacturing (expanded)', () => {
    it('routes energy efficiency', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Energy Catalyst',
        action: 'energy_consumption_check',
      }), env.DB);
      expect(out.type).toBe('manufacturing_energy_efficiency');
    });

    it('routes cost variance', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Production Cost Review',
        action: 'supplier_cost_variance_check',
      }), env.DB);
      expect(out.type).toBe('manufacturing_cost_variance');
    });
  });

  describe('Logistics (expanded)', () => {
    it('routes carrier performance', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Carrier Review',
        action: 'carrier_performance_scan',
      }), env.DB);
      expect(out.type).toBe('logistics_carrier_performance');
    });

    it('routes route efficiency', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Route Optimiser',
        action: 'route_efficiency_check',
      }), env.DB);
      expect(out.type).toBe('logistics_route_efficiency');
    });
  });

  describe('Retail (expanded)', () => {
    it('routes top customers / LTV', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Retail CX',
        action: 'customer_lifetime_value',
      }), env.DB);
      expect(out.type).toBe('retail_top_customers');
    });

    it('routes pricing advice', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Retail Pricing',
        action: 'pricing_margin_review',
      }), env.DB);
      expect(out.type).toBe('retail_pricing_advice');
    });
  });

  describe('FMCG (expanded)', () => {
    it('routes category performance', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'FMCG Category',
        action: 'category_performance_review',
      }), env.DB);
      expect(out.type).toBe('fmcg_category_performance');
    });

    it('routes trade spend', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'FMCG Trade Spend',
        action: 'trade_spend_analysis',
      }), env.DB);
      expect(out.type).toBe('fmcg_trade_spend');
    });
  });

  describe('Agriculture (expanded)', () => {
    it('routes yield variance', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Agri Yield',
        action: 'yield_variance_check',
      }), env.DB);
      expect(out.type).toBe('agriculture_yield_variance');
    });

    it('routes seasonal demand', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Agri Seasonal',
        action: 'seasonal_demand_forecast',
      }), env.DB);
      expect(out.type).toBe('agriculture_seasonal_demand');
    });
  });

  describe('Healthcare (expanded)', () => {
    it('routes readmission flag', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Clinical Readmission',
        action: 'readmission_flag_check',
      }), env.DB);
      expect(out.type).toBe('healthcare_readmission_flag');
    });

    it('routes supply shortages', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Clinical Supply',
        action: 'medical_supply_shortage_scan',
      }), env.DB);
      expect(out.type).toBe('healthcare_supply_shortages');
    });
  });

  describe('Technology (expanded)', () => {
    it('routes SLO compliance', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'SRE SLO Catalyst',
        action: 'slo_compliance_scan',
      }), env.DB);
      expect(out.type).toBe('technology_slo_compliance');
    });

    it('routes feature adoption', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Product Adoption',
        action: 'feature_adoption_check',
      }), env.DB);
      expect(out.type).toBe('technology_feature_adoption');
    });
  });

  describe('Financial Services (expanded)', () => {
    it('routes cash flow forecast', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'FinServ Treasury',
        action: 'cash_flow_forecast_30d',
      }), env.DB);
      expect(out.type).toBe('finserv_cash_flow_forecast');
    });

    it('routes concentration risk', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'FinServ Concentration',
        action: 'customer_concentration_risk_check',
      }), env.DB);
      expect(out.type).toBe('finserv_concentration_risk');
    });
  });

  describe('General (expanded)', () => {
    it('routes supplier concentration', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Supplier Concentration Review',
        action: 'supplier_concentration_check',
      }), env.DB);
      expect(out.type).toBe('general_supplier_concentration');
    });

    it('routes anomaly triage', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Anomaly Ops',
        action: 'anomaly_triage_scan',
      }), env.DB);
      expect(out.type).toBe('general_anomaly_triage');
    });
  });

  // ── OBSERVABILITY & ROBUSTNESS ──────────────────────

  describe('Observability', () => {
    it('dispatch output includes _handler for domain match', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Mining Safety',
        action: 'check_safety_incidents',
      }), env.DB);
      expect(out._handler).toBe('domain:mining');
    });

    it('dispatch output includes _handler for catalog-aware fallback', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Mystery',
        action: 'zzz_unknown',
      }), env.DB);
      expect(out._handler).toBe('default:catalog');
    });
  });

  describe('Word-boundary match (regression)', () => {
    // Regression for the PR #10 bug where 'pos' matched inside "exposure"
    // and routed finserv credit-exposure tasks to retail basket analysis.
    it('does not match "pos" inside "exposure"', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'FinServ Credit',
        action: 'credit_exposure_check',
      }), env.DB);
      expect(out.type).toBe('finserv_credit_exposure');
      expect(out._handler).toBe('domain:financial-services');
    });

    it('does not match "ore" inside "store"', async () => {
      // Task text contains 'store' but no mining keywords — mining must not match.
      const out = await dispatchAction(makeTask({
        catalystName: 'Storefront Review',
        action: 'generic_store_scan',
      }), env.DB);
      expect(out._handler).not.toBe('domain:mining');
    });

    it('does not match "hr" inside "chrome"', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'Chrome Browser Usage',
        action: 'chrome_adoption_check',
      }), env.DB);
      expect(out._handler).not.toBe('general:hr');
    });

    it('still matches hr_ prefix via word-boundary', async () => {
      const out = await dispatchAction(makeTask({
        catalystName: 'HR Catalyst',
        action: 'hr_turnover_scan',
      }), env.DB);
      expect(out.type).toBe('hr_turnover');
      expect(out._handler).toBe('general:hr');
    });
  });

  // ── DLQ HANDLER ─────────────────────────────────────

  describe('Dead-letter queue handler', () => {
    it('persists a dead-letter message to audit_log and acks it', async () => {
      const { handleDlqMessage } = await import('../services/scheduled');

      let ackCalled = false;
      const fakeMessage = {
        id: 'dlq-test-msg-1',
        timestamp: new Date(),
        attempts: 4,
        body: {
          type: 'catalyst_execution',
          tenantId: TENANT,
          payload: { catalystName: 'Broken Catalyst', action: 'broken_action' },
        },
        ack: () => { ackCalled = true; },
        retry: () => { throw new Error('retry should not be called from DLQ'); },
      } as unknown as Parameters<typeof handleDlqMessage>[0]['messages'][number];

      const fakeBatch = {
        queue: 'catalyst-dlq',
        messages: [fakeMessage],
        ackAll: () => undefined,
        retryAll: () => undefined,
      } as unknown as Parameters<typeof handleDlqMessage>[0];

      await handleDlqMessage(fakeBatch, env);

      expect(ackCalled).toBe(true);

      const row = await env.DB.prepare(
        `SELECT tenant_id, action, layer, outcome FROM audit_log
         WHERE tenant_id = ? AND action = 'catalyst.queue.dead_letter'
         ORDER BY created_at DESC LIMIT 1`,
      ).bind(TENANT).first<{ tenant_id: string; action: string; layer: string; outcome: string }>();
      expect(row).not.toBeNull();
      expect(row?.outcome).toBe('failure');
      expect(row?.layer).toBe('catalysts');
    });
  });

  // ── PER-COMPANY SCOPING ────────────────────────────────────────
  //
  // Multi-company schema landed in PR #219. Handlers now accept an optional
  // `companyId` on the TaskDefinition. When provided, canonical erp_* queries
  // get an extra `AND company_id = ?` filter; tenant-scoped tables
  // (process_metrics, anomalies, risk_alerts) ignore it.

  describe('Company scoping', () => {
    const COMPANY_A = 'company-scope-a';
    const COMPANY_B = 'company-scope-b';

    // Seed fixtures once for the whole company-scoping suite. We use a separate
    // tenant so we don't collide with the primary fixture set.
    const SCOPE_TENANT = 'scope-test-tenant';

    beforeAll(async () => {
      // Tenant
      await env.DB.prepare(
        `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, 'Scope Test Corp', 'scope-test', 'enterprise', 'active')`,
      ).bind(SCOPE_TENANT).run();

      // Two companies under the same tenant
      await env.DB.prepare(
        `INSERT OR REPLACE INTO erp_companies (id, tenant_id, source_system, code, name, is_primary, status)
         VALUES (?, ?, 'manual', 'A', 'Company A', 1, 'active')`,
      ).bind(COMPANY_A, SCOPE_TENANT).run();
      await env.DB.prepare(
        `INSERT OR REPLACE INTO erp_companies (id, tenant_id, source_system, code, name, is_primary, status)
         VALUES (?, ?, 'manual', 'B', 'Company B', 0, 'active')`,
      ).bind(COMPANY_B, SCOPE_TENANT).run();

      // Invoices — 3 in A (all overdue, unpaid), 2 in B (both paid).
      const overdueDate = new Date(Date.now() - 40 * 86400 * 1000).toISOString().slice(0, 10);
      const insertInvoice = async (id: string, companyId: string, total: number, paymentStatus: string, dueDate: string) => {
        await env.DB.prepare(
          `INSERT OR REPLACE INTO erp_invoices (id, tenant_id, company_id, invoice_number, customer_name, invoice_date, due_date, total, amount_due, payment_status, status)
           VALUES (?, ?, ?, ?, 'Cust', ?, ?, ?, ?, ?, 'issued')`,
        ).bind(id, SCOPE_TENANT, companyId, id, overdueDate, dueDate, total, paymentStatus === 'paid' ? 0 : total, paymentStatus).run();
      };
      await insertInvoice('scope-inv-A1', COMPANY_A, 1000, 'unpaid', overdueDate);
      await insertInvoice('scope-inv-A2', COMPANY_A, 2000, 'unpaid', overdueDate);
      await insertInvoice('scope-inv-A3', COMPANY_A, 3000, 'unpaid', overdueDate);
      await insertInvoice('scope-inv-B1', COMPANY_B, 5000, 'paid', overdueDate);
      await insertInvoice('scope-inv-B2', COMPANY_B, 7000, 'paid', overdueDate);

      // A red metric tenant-scoped (no company_id) — used to assert
      // non-company tables ignore the filter.
      await env.DB.prepare(
        `INSERT OR REPLACE INTO process_metrics (id, tenant_id, name, value, unit, status, threshold_green, threshold_amber, threshold_red, source_system)
         VALUES ('scope-metric-red', ?, 'Latency', 900, 'ms', 'red', 90, 80, 70, 'test')`,
      ).bind(SCOPE_TENANT).run();

      // An open critical anomaly tenant-scoped — used by operations_red_metrics
      // smoke check.
      await env.DB.prepare(
        `INSERT OR REPLACE INTO anomalies (id, tenant_id, metric, severity, expected_value, actual_value, deviation, hypothesis, status, detected_at)
         VALUES ('scope-anom-1', ?, 'scope_metric', 'critical', 1, 0.5, 0.5, 'hypothesis', 'open', datetime('now', '-1 days'))`,
      ).bind(SCOPE_TENANT).run();
    });

    function scopedTask(companyId: string | undefined): TaskDefinition {
      return {
        id: `scope-${crypto.randomUUID()}`,
        clusterId: 'scope-cluster',
        tenantId: SCOPE_TENANT,
        catalystName: 'Retail POS Catalyst',
        action: 'basket_analysis',
        inputData: {},
        riskLevel: 'low',
        autonomyTier: 'read-only',
        trustScore: 50,
        companyId,
      };
    }

    it('consolidated (no companyId) aggregates across both companies', async () => {
      const out = await dispatchAction(scopedTask(undefined), env.DB);
      expect(out.type).toBe('retail_basket_analysis');
      // 5 invoices across both companies, total revenue 1000+2000+3000+5000+7000 = 18000
      expect(out.invoiceCount).toBe(5);
      expect(out.totalRevenue).toBe(18000);
      expect(out.scopedToCompany).toBe('all');
    });

    it('scoped to company A only includes rows from A', async () => {
      const out = await dispatchAction(scopedTask(COMPANY_A), env.DB);
      expect(out.type).toBe('retail_basket_analysis');
      expect(out.invoiceCount).toBe(3);
      expect(out.totalRevenue).toBe(6000);
      expect(out.scopedToCompany).toBe(COMPANY_A);
    });

    it('scoped to company B only includes rows from B', async () => {
      const out = await dispatchAction(scopedTask(COMPANY_B), env.DB);
      expect(out.type).toBe('retail_basket_analysis');
      expect(out.invoiceCount).toBe(2);
      expect(out.totalRevenue).toBe(12000);
      expect(out.scopedToCompany).toBe(COMPANY_B);
    });

    it('invalid company_id returns empty result without crashing', async () => {
      const out = await dispatchAction(scopedTask('does-not-exist'), env.DB);
      expect(out.type).toBe('retail_basket_analysis');
      expect(out.invoiceCount).toBe(0);
      expect(out.totalRevenue).toBe(0);
      expect(out.scopedToCompany).toBe('does-not-exist');
    });

    it("output includes scopedToCompany: 'all' when companyId is undefined", async () => {
      const out = await dispatchAction(scopedTask(undefined), env.DB);
      expect(out.scopedToCompany).toBe('all');
    });

    it('output includes scopedToCompany: <id> when companyId is set', async () => {
      const out = await dispatchAction(scopedTask(COMPANY_A), env.DB);
      expect(out.scopedToCompany).toBe(COMPANY_A);
    });

    it('non-company tables ignore the filter (operations_red_metrics)', async () => {
      // process_metrics/anomalies/risk_alerts are tenant-scoped only. Passing
      // a company_id must NOT filter them — we should still see the red
      // metric regardless of scope.
      const taskAll = {
        id: `scope-red-all-${crypto.randomUUID()}`,
        clusterId: 'scope-cluster',
        tenantId: SCOPE_TENANT,
        catalystName: 'Ops Red Metrics',
        action: 'operations_red_metric_scan',
        inputData: {},
        riskLevel: 'low' as const,
        autonomyTier: 'read-only',
        trustScore: 50,
      };
      const outAll = await dispatchAction(taskAll, env.DB);
      expect(outAll.type).toBe('operations_red_metrics');
      expect(outAll.red).toBeGreaterThanOrEqual(1);

      const outScoped = await dispatchAction({ ...taskAll, companyId: COMPANY_A }, env.DB);
      expect(outScoped.type).toBe('operations_red_metrics');
      expect(outScoped.red).toBe(outAll.red); // identical — filter did NOT apply
      expect(outScoped.scopedToCompany).toBe(COMPANY_A); // label still reflects request
    });

    it('DAG triggerDownstream propagates upstream companyId to downstream payload', async () => {
      const { triggerDownstream } = await import('../services/catalyst-dag');

      const upstreamCluster = `scope-up-${crypto.randomUUID()}`;
      const upstreamSub = 'Upstream Sub';
      const downstreamCluster = `scope-down-${crypto.randomUUID()}`;
      const downstreamSub = 'Downstream Sub';

      // Seed clusters first (source_cluster_id and target_cluster_id are FKs).
      await env.DB.prepare(
        `INSERT OR IGNORE INTO catalyst_clusters (id, tenant_id, name, domain, status)
         VALUES (?, ?, 'Upstream Cluster', 'test', 'active')`,
      ).bind(upstreamCluster, SCOPE_TENANT).run();
      await env.DB.prepare(
        `INSERT OR IGNORE INTO catalyst_clusters (id, tenant_id, name, domain, status)
         VALUES (?, ?, 'Downstream Cluster', 'test', 'active')`,
      ).bind(downstreamCluster, SCOPE_TENANT).run();

      // Seed a dependency edge upstream -> downstream. The table still has
      // NOT NULL source_* columns (v1 schema) so we populate both sides.
      // triggerDownstream reads the v2 upstream_*/downstream_* columns when
      // present, falls back to source_*/target_*.
      await env.DB.prepare(
        `INSERT INTO catalyst_dependencies
           (id, tenant_id,
            source_cluster_id, source_sub_catalyst,
            target_cluster_id, target_sub_catalyst,
            upstream_cluster_id, upstream_sub_name,
            downstream_cluster_id, downstream_sub_name,
            dependency_type, strength)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'data_flow', 1.0)`,
      ).bind(
        `dep-${crypto.randomUUID()}`,
        SCOPE_TENANT,
        upstreamCluster, upstreamSub,
        downstreamCluster, downstreamSub,
        upstreamCluster, upstreamSub,
        downstreamCluster, downstreamSub,
      ).run();

      // Fake queue that captures the sent message.
      const sent: unknown[] = [];
      const fakeQueue = {
        send: async (msg: unknown) => { sent.push(msg); },
      } as unknown as Queue<import('../services/scheduled').CatalystQueueMessage>;

      const result = await triggerDownstream({
        tenantId: SCOPE_TENANT,
        upstreamClusterId: upstreamCluster,
        upstreamSubCatalystName: upstreamSub,
        chainDepth: 0,
        parentContext: { source: 'test' },
        companyId: COMPANY_A,
      }, env.DB, fakeQueue);

      expect(result.enqueued).toBe(1);
      expect(sent).toHaveLength(1);
      const msg = sent[0] as { payload: { companyId?: string; clusterId: string } };
      expect(msg.payload.companyId).toBe(COMPANY_A);
      expect(msg.payload.clusterId).toBe(downstreamCluster);
    });
  });
});
