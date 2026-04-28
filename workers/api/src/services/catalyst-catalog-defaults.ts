/**
 * Catalog-aware default handler — closes the silent-fallback gap.
 *
 * Before this handler existed, any task that didn't match a custom domain
 * handler or one of the four action-keyword defaults (read/notify/investigate/
 * mutation) fell through to a minimal `generic_result` payload that just
 * counted process_metrics rows. That shape was technically a response but
 * carried no domain knowledge — a Compliance Risk task and a Customer NPS
 * task would return identical, unhelpful output.
 *
 * This handler replaces the old final catch-all. It looks up the task's
 * catalystName in CATALYST_CATALOG, takes the cluster's `domain` field
 * (e.g. 'finance', 'mining-safety', 'compliance-audit'), and routes to a
 * domain-shaped query that returns evidence + a recommendation. Unknown or
 * malformed tasks still get a payload — never a thrown error — but the
 * payload is grounded in real ERP data wherever possible.
 *
 * Output shape:
 *   {
 *     type: 'catalog_default:<domain-bucket>',
 *     catalyst: <catalyst name>,
 *     subCatalyst?: <matched sub-catalyst name>,
 *     description?: <sub-catalyst description>,
 *     <evidence fields>...,
 *     recommendation: <human-readable next step>,
 *     scopedToCompany: <'all' | companyId>,
 *     timestamp: ISO8601,
 *   }
 *
 * The handler MUST always match — it replaces the final generic catch-all in
 * the registry. For any catalystName not found in the catalog, it still
 * returns a typed payload (`catalog_default:unknown`) so downstream consumers
 * (audit log, output_data) get a stable shape.
 */

import type { CatalystHandler } from './catalyst-handler-registry';
import type { TaskDefinition } from './catalyst-engine';
import { scopeLabel, companyFilter } from './catalyst-match-utils';
import { CATALYST_CATALOG, type CatalystTemplate, type SubCatalystTemplate } from './catalyst-templates';

// ── Catalog index (lazy, single-pass) ────────────────────────────────────

type CatalogHit = { cluster: CatalystTemplate; sub?: SubCatalystTemplate };

let catalogIndex: Map<string, CatalystTemplate> | null = null;

function indexCatalog(): Map<string, CatalystTemplate> {
  if (catalogIndex) return catalogIndex;
  const idx = new Map<string, CatalystTemplate>();
  for (const cluster of CATALYST_CATALOG) {
    idx.set(cluster.name.toLowerCase(), cluster);
  }
  catalogIndex = idx;
  return idx;
}

function lookupCatalog(task: TaskDefinition): CatalogHit | null {
  const cluster = indexCatalog().get(task.catalystName.toLowerCase());
  if (!cluster) return null;
  const actionLower = task.action.toLowerCase();
  // Pick the sub-catalyst whose name appears in the action. If none does,
  // leave undefined and let the cluster-level domain decide the response.
  const sub = cluster.sub_catalysts.find(s => actionLower.includes(s.name.toLowerCase()));
  return { cluster, sub };
}

/** Coarse bucket for routing — first segment of the domain. */
function domainBucket(domain: string): string {
  const head = domain.split('-')[0] || 'unknown';
  return head.toLowerCase();
}

// ── Domain query helpers ─────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round((n || 0) * 100) / 100;
}

async function queryFinance(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  const aging = await db.prepare(
    `SELECT
        COUNT(*) AS total_invoices,
        SUM(CASE WHEN payment_status = 'unpaid' AND due_date < date('now') THEN amount_due ELSE 0 END) AS overdue_amount,
        SUM(CASE WHEN payment_status = 'unpaid' AND due_date >= date('now') THEN amount_due ELSE 0 END) AS upcoming_amount,
        SUM(CASE WHEN payment_status = 'unpaid' THEN 1 ELSE 0 END) AS unpaid_count
     FROM erp_invoices
     WHERE tenant_id = ?${clause}`,
  ).bind(task.tenantId, ...params).first<{
    total_invoices: number; overdue_amount: number; upcoming_amount: number; unpaid_count: number;
  }>();

  const overdue = round2(aging?.overdue_amount || 0);
  const upcoming = round2(aging?.upcoming_amount || 0);
  return {
    totalInvoices: aging?.total_invoices || 0,
    unpaidCount: aging?.unpaid_count || 0,
    overdueAmount: overdue,
    upcomingAmount: upcoming,
    recommendation: overdue > 0
      ? `R${overdue.toLocaleString()} overdue across ${aging?.unpaid_count || 0} unpaid invoice(s) — prioritise collections cadence`
      : aging?.unpaid_count
        ? `${aging.unpaid_count} invoice(s) unpaid but not yet overdue — confirm payment commitments`
        : 'No outstanding invoices on the books',
  };
}

async function queryProcurement(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  const orders = await db.prepare(
    `SELECT
        COUNT(*) AS total_pos,
        SUM(CASE WHEN delivery_status = 'delayed' THEN 1 ELSE 0 END) AS delayed_pos,
        SUM(CASE WHEN status NOT IN ('cancelled', 'closed') THEN total ELSE 0 END) AS open_value
     FROM erp_purchase_orders
     WHERE tenant_id = ?${clause}`,
  ).bind(task.tenantId, ...params).first<{ total_pos: number; delayed_pos: number; open_value: number }>();

  const supSql = `SELECT COUNT(*) AS active_suppliers, AVG(risk_score) AS avg_risk
                  FROM erp_suppliers
                  WHERE tenant_id = ? AND status = 'active'${clause}`;
  const suppliers = await db.prepare(supSql).bind(task.tenantId, ...params).first<{ active_suppliers: number; avg_risk: number }>();

  const delayed = orders?.delayed_pos || 0;
  return {
    totalPurchaseOrders: orders?.total_pos || 0,
    delayedDeliveries: delayed,
    openOrderValue: round2(orders?.open_value || 0),
    activeSuppliers: suppliers?.active_suppliers || 0,
    averageSupplierRisk: round2(suppliers?.avg_risk || 0),
    recommendation: delayed > 0
      ? `${delayed} purchase order(s) flagged as delayed — escalate with affected suppliers and update ETA`
      : (suppliers?.avg_risk || 0) > 0.6
        ? 'Average supplier risk score above policy threshold (0.6) — schedule mitigation review'
        : 'Procurement posture stable — no flagged exceptions',
  };
}

async function queryInventory(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  const stockSql = `SELECT
        COUNT(*) AS total_skus,
        SUM(CASE WHEN stock_on_hand <= 0 THEN 1 ELSE 0 END) AS oos_count,
        SUM(CASE WHEN stock_on_hand > 0 AND stock_on_hand <= reorder_level THEN 1 ELSE 0 END) AS low_count,
        SUM(stock_on_hand * cost_price) AS inventory_value
     FROM erp_products
     WHERE tenant_id = ? AND is_active = 1${clause}`;
  const stock = await db.prepare(stockSql).bind(task.tenantId, ...params).first<{
    total_skus: number; oos_count: number; low_count: number; inventory_value: number;
  }>();

  const oos = stock?.oos_count || 0;
  const low = stock?.low_count || 0;
  return {
    totalActiveSkus: stock?.total_skus || 0,
    outOfStockCount: oos,
    lowStockCount: low,
    inventoryValue: round2(stock?.inventory_value || 0),
    recommendation: oos > 0
      ? `${oos} SKU(s) out of stock — issue replenishment POs and review safety stock policy`
      : low > 0
        ? `${low} SKU(s) at or below reorder level — schedule next replenishment cycle`
        : 'Inventory cover within policy across active SKUs',
  };
}

async function queryHR(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  const headcount = await db.prepare(
    `SELECT
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN termination_date >= date('now', '-90 days') THEN 1 ELSE 0 END) AS departures_90d,
        SUM(CASE WHEN hire_date >= date('now', '-90 days') THEN 1 ELSE 0 END) AS hires_90d
     FROM erp_employees
     WHERE tenant_id = ?${clause}`,
  ).bind(task.tenantId, ...params).first<{ active: number; departures_90d: number; hires_90d: number }>();

  const active = headcount?.active || 0;
  const departures = headcount?.departures_90d || 0;
  const hires = headcount?.hires_90d || 0;
  const turnover = active > 0 ? Math.round((departures / active) * 1000) / 10 : 0;
  return {
    activeHeadcount: active,
    departuresLast90d: departures,
    hiresLast90d: hires,
    quarterlyTurnoverPct: turnover,
    recommendation: turnover > 15
      ? `Quarterly turnover ${turnover}% is above the 15% review threshold — launch retention diagnostic`
      : departures > hires
        ? 'Net headcount declining — confirm hiring plan covers attrition'
        : 'Workforce composition stable across the last quarter',
  };
}

async function queryOperations(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  // process_metrics + anomalies + risk_alerts are tenant-scoped only.
  const metrics = await db.prepare(
    `SELECT
        SUM(CASE WHEN status = 'red' THEN 1 ELSE 0 END) AS red_count,
        SUM(CASE WHEN status = 'amber' THEN 1 ELSE 0 END) AS amber_count,
        SUM(CASE WHEN status = 'green' THEN 1 ELSE 0 END) AS green_count
     FROM process_metrics WHERE tenant_id = ?`,
  ).bind(task.tenantId).first<{ red_count: number; amber_count: number; green_count: number }>();

  const anomalies = await db.prepare(
    `SELECT COUNT(*) AS open_count
     FROM anomalies WHERE tenant_id = ? AND status = 'open'`,
  ).bind(task.tenantId).first<{ open_count: number }>();

  const red = metrics?.red_count || 0;
  const open = anomalies?.open_count || 0;
  return {
    redMetrics: red,
    amberMetrics: metrics?.amber_count || 0,
    greenMetrics: metrics?.green_count || 0,
    openAnomalies: open,
    recommendation: red > 0
      ? `${red} operational metric(s) currently red — assign owners for top breaches`
      : open > 0
        ? `${open} open anomalies — schedule triage in next standup`
        : 'Operational posture green — no breaches or open anomalies',
  };
}

async function queryCompliance(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const risks = await db.prepare(
    `SELECT severity, COUNT(*) AS count, SUM(impact_value) AS impact
     FROM risk_alerts
     WHERE tenant_id = ? AND status = 'active'
       AND (LOWER(category) LIKE '%compli%' OR LOWER(category) LIKE '%popia%' OR LOWER(category) LIKE '%audit%' OR LOWER(category) LIKE '%regul%')
     GROUP BY severity`,
  ).bind(task.tenantId).all();

  const auditCount = await db.prepare(
    `SELECT COUNT(*) AS count FROM audit_log
     WHERE tenant_id = ? AND created_at >= datetime('now', '-30 days')`,
  ).bind(task.tenantId).first<{ count: number }>();

  const totalImpact = risks.results.reduce((s, r) => s + ((r as { impact: number }).impact || 0), 0);
  const totalRisks = risks.results.reduce((s, r) => s + ((r as { count: number }).count || 0), 0);
  return {
    activeComplianceRisks: totalRisks,
    totalImpactExposure: round2(totalImpact),
    severityBreakdown: risks.results,
    auditEventsLast30d: auditCount?.count || 0,
    recommendation: totalRisks > 0
      ? `${totalRisks} active compliance risk(s) with R${Math.round(totalImpact).toLocaleString()} exposure — prioritise remediation`
      : (auditCount?.count || 0) === 0
        ? 'No compliance risks active and no audit events in last 30 days — verify event capture is healthy'
        : 'No active compliance risks — audit trail healthy',
  };
}

async function queryCustomer(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  const customers = await db.prepare(
    `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) AS inactive,
        SUM(CASE WHEN credit_balance > credit_limit THEN 1 ELSE 0 END) AS over_limit
     FROM erp_customers
     WHERE tenant_id = ?${clause}`,
  ).bind(task.tenantId, ...params).first<{ total: number; active: number; inactive: number; over_limit: number }>();

  const active = customers?.active || 0;
  const inactive = customers?.inactive || 0;
  const overLimit = customers?.over_limit || 0;
  const churnPct = (active + inactive) > 0 ? Math.round((inactive / (active + inactive)) * 1000) / 10 : 0;
  return {
    totalCustomers: customers?.total || 0,
    activeCustomers: active,
    inactiveCustomers: inactive,
    overCreditLimitCount: overLimit,
    churnRatePct: churnPct,
    recommendation: overLimit > 0
      ? `${overLimit} customer(s) over credit limit — escalate to credit control before further shipments`
      : churnPct > 10
        ? `Churn rate ${churnPct}% above 10% review threshold — launch retention review`
        : 'Customer base stable — credit and churn within policy',
  };
}

async function queryRetail(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  // Retail combines customer-side invoice flow + inventory cover.
  const { clause, params } = companyFilter(task.companyId);
  const recent = await db.prepare(
    `SELECT COUNT(*) AS recent_sales, SUM(total) AS revenue
     FROM erp_invoices
     WHERE tenant_id = ? AND invoice_date >= date('now', '-30 days')${clause}`,
  ).bind(task.tenantId, ...params).first<{ recent_sales: number; revenue: number }>();
  const inventory = await queryInventory(task, db);

  return {
    salesLast30d: recent?.recent_sales || 0,
    revenueLast30d: round2(recent?.revenue || 0),
    outOfStockCount: inventory.outOfStockCount,
    lowStockCount: inventory.lowStockCount,
    recommendation: (inventory.outOfStockCount as number) > 0
      ? `${inventory.outOfStockCount} SKU(s) out of stock — risk of lost sales; expedite replenishment`
      : (recent?.recent_sales || 0) === 0
        ? 'No invoiced sales in last 30 days — verify POS feed is delivering transactions'
        : 'Retail cover and recent sales flow looking healthy',
  };
}

async function queryAgriculture(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  const inputs = await db.prepare(
    `SELECT COUNT(*) AS input_skus,
            SUM(CASE WHEN stock_on_hand <= reorder_level THEN 1 ELSE 0 END) AS low_input_skus
     FROM erp_products
     WHERE tenant_id = ? AND is_active = 1
       AND (LOWER(category) LIKE '%seed%' OR LOWER(category) LIKE '%fertil%' OR LOWER(category) LIKE '%chem%' OR LOWER(category) LIKE '%agri%')${clause}`,
  ).bind(task.tenantId, ...params).first<{ input_skus: number; low_input_skus: number }>();
  // process_metrics is tenant-scoped only.
  const yieldMetric = await db.prepare(
    `SELECT name, value, unit, status, measured_at
     FROM process_metrics
     WHERE tenant_id = ? AND (LOWER(name) LIKE '%yield%' OR LOWER(name) LIKE '%harvest%' OR LOWER(name) LIKE '%crop%')
     ORDER BY measured_at DESC LIMIT 5`,
  ).bind(task.tenantId).all();

  const lowInputs = inputs?.low_input_skus || 0;
  return {
    activeInputSkus: inputs?.input_skus || 0,
    lowInputSkus: lowInputs,
    recentYieldMetrics: yieldMetric.results,
    recommendation: lowInputs > 0
      ? `${lowInputs} agri input SKU(s) below reorder level — secure pre-season replenishment`
      : yieldMetric.results.length === 0
        ? 'No yield/harvest metrics captured — confirm field data ingestion'
        : 'Agri input cover and yield telemetry look healthy',
  };
}

async function queryTechnology(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  // tech tasks usually live in process_metrics + anomalies (api/latency/incident).
  const slo = await db.prepare(
    `SELECT name, value, unit, status, measured_at
     FROM process_metrics
     WHERE tenant_id = ? AND (LOWER(name) LIKE '%api%' OR LOWER(name) LIKE '%latency%' OR LOWER(name) LIKE '%uptime%' OR LOWER(name) LIKE '%error%')
     ORDER BY measured_at DESC LIMIT 10`,
  ).bind(task.tenantId).all();
  const incidents = await db.prepare(
    `SELECT COUNT(*) AS open_count
     FROM anomalies
     WHERE tenant_id = ? AND status = 'open'
       AND (LOWER(metric) LIKE '%api%' OR LOWER(metric) LIKE '%error%' OR LOWER(metric) LIKE '%incident%' OR LOWER(metric) LIKE '%latency%')`,
  ).bind(task.tenantId).first<{ open_count: number }>();

  const breached = slo.results.filter(r => (r as { status: string }).status === 'red');
  const open = incidents?.open_count || 0;
  return {
    sloMetrics: slo.results.length,
    breachedSlos: breached.length,
    openTechAnomalies: open,
    metrics: slo.results,
    recommendation: breached.length > 0
      ? `${breached.length} SLO(s) currently red — page on-call and confirm error budgets`
      : open > 0
        ? `${open} open tech anomaly(ies) — assign incident owner`
        : 'SLOs and tech anomalies all healthy',
  };
}

// ── Domain dispatch table ────────────────────────────────────────────────

type DomainQuery = (task: TaskDefinition, db: D1Database) => Promise<Record<string, unknown>>;

const DOMAIN_QUERIES: Record<string, DomainQuery> = {
  finance: queryFinance,
  procurement: queryProcurement,
  supply: queryProcurement,
  inventory: queryInventory,
  hr: queryHR,
  health: queryHR,
  mining: queryOperations,
  mfg: queryOperations,
  operations: queryOperations,
  service: queryOperations,
  logistics: queryProcurement,
  compliance: queryCompliance,
  customer: queryCustomer,
  sales: queryCustomer,
  retail: queryRetail,
  fmcg: queryRetail,
  agri: queryAgriculture,
  tech: queryTechnology,
};

async function queryUnknown(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  // Last-resort fallback for tasks whose catalystName is not in the catalog
  // or whose domain doesn't map to a bucket. Aggregate counts across tables
  // so we still tell the caller what the tenant looks like.
  const [customers, suppliers, products, invoices, metrics] = await Promise.all([
    db.prepare('SELECT COUNT(*) as c FROM erp_customers WHERE tenant_id = ?').bind(task.tenantId).first<{ c: number }>(),
    db.prepare('SELECT COUNT(*) as c FROM erp_suppliers WHERE tenant_id = ?').bind(task.tenantId).first<{ c: number }>(),
    db.prepare('SELECT COUNT(*) as c FROM erp_products WHERE tenant_id = ?').bind(task.tenantId).first<{ c: number }>(),
    db.prepare('SELECT COUNT(*) as c FROM erp_invoices WHERE tenant_id = ?').bind(task.tenantId).first<{ c: number }>(),
    db.prepare('SELECT COUNT(*) as c FROM process_metrics WHERE tenant_id = ?').bind(task.tenantId).first<{ c: number }>(),
  ]);
  return {
    dataCounts: {
      customers: customers?.c || 0,
      suppliers: suppliers?.c || 0,
      products: products?.c || 0,
      invoices: invoices?.c || 0,
      metrics: metrics?.c || 0,
    },
    recommendation: 'No domain-specific handler matched — review task routing or add a domain handler',
  };
}

// ── The handler ──────────────────────────────────────────────────────────

export const catalogAwareDefaultHandler: CatalystHandler = {
  name: 'default:catalog',
  match: () => true,
  execute: async (task, db) => {
    const hit = lookupCatalog(task);
    const bucket = hit ? domainBucket(hit.cluster.domain) : 'unknown';
    const query = DOMAIN_QUERIES[bucket] || queryUnknown;
    const evidence = await query(task, db);
    return {
      type: `catalog_default:${bucket}`,
      catalyst: task.catalystName,
      ...(hit?.sub
        ? { subCatalyst: hit.sub.name, description: hit.sub.description }
        : {}),
      ...(hit?.cluster ? { catalogDomain: hit.cluster.domain } : {}),
      ...evidence,
      scopedToCompany: scopeLabel(task.companyId),
      timestamp: new Date().toISOString(),
    };
  },
};

/** Test-only: clear the cached catalog index so re-imports re-build it. */
export function _resetCatalogIndexForTests(): void {
  catalogIndex = null;
}
