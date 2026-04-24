/**
 * Commercial domain catalyst handlers: retail, FMCG, agriculture.
 * See catalyst-operational-handlers.ts for the pattern.
 */

import {
  type CatalystHandler,
  registerHandler,
} from './catalyst-handler-registry';
import type { TaskDefinition } from './catalyst-engine';

function taskText(task: TaskDefinition): string {
  const domain = typeof task.inputData.domain === 'string' ? task.inputData.domain : '';
  return `${task.catalystName} ${task.action} ${domain}`.toLowerCase();
}

function anyOf(s: string, ...terms: string[]): boolean {
  return terms.some(t => s.includes(t));
}

// ── RETAIL ──────────────────────────────────────────────────────────────

async function runRetailBasketAnalysis(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const summary = await db.prepare(
    `SELECT COUNT(*) as invoice_count,
            AVG(total) as avg_basket,
            MIN(total) as min_basket,
            MAX(total) as max_basket,
            SUM(total) as revenue
     FROM erp_invoices
     WHERE tenant_id = ? AND status != 'cancelled'`,
  ).bind(task.tenantId).first<{
    invoice_count: number; avg_basket: number; min_basket: number; max_basket: number; revenue: number;
  }>();

  const topCustomers = await db.prepare(
    `SELECT customer_name, COUNT(*) as invoices, SUM(total) as spend
     FROM erp_invoices
     WHERE tenant_id = ? AND status != 'cancelled'
     GROUP BY customer_name
     ORDER BY spend DESC LIMIT 10`,
  ).bind(task.tenantId).all();

  return {
    type: 'retail_basket_analysis',
    invoiceCount: summary?.invoice_count || 0,
    avgBasket: Math.round((summary?.avg_basket || 0) * 100) / 100,
    minBasket: summary?.min_basket || 0,
    maxBasket: summary?.max_basket || 0,
    totalRevenue: Math.round((summary?.revenue || 0) * 100) / 100,
    topCustomers: topCustomers.results,
    recommendation: (summary?.invoice_count || 0) < 10
      ? 'Insufficient invoice volume for reliable basket insights — ingest more POS data'
      : `Avg basket size R${Math.round(summary?.avg_basket || 0).toLocaleString()}. Target upsell to top 10 customers.`,
    timestamp: new Date().toISOString(),
  };
}

async function runRetailOutOfStock(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const outOfStock = await db.prepare(
    `SELECT sku, name, category, warehouse, stock_on_hand, selling_price, cost_price
     FROM erp_products
     WHERE tenant_id = ? AND is_active = 1 AND stock_on_hand <= 0
     ORDER BY selling_price DESC LIMIT 50`,
  ).bind(task.tenantId).all();

  const byCategory = await db.prepare(
    `SELECT category, COUNT(*) as out_count
     FROM erp_products
     WHERE tenant_id = ? AND is_active = 1 AND stock_on_hand <= 0
     GROUP BY category
     ORDER BY out_count DESC`,
  ).bind(task.tenantId).all();

  const lostRevenueDaily = outOfStock.results.reduce((s, r) => {
    const row = r as { selling_price: number };
    return s + (row.selling_price || 0);
  }, 0);

  return {
    type: 'retail_out_of_stock',
    outOfStockCount: outOfStock.results.length,
    estDailyLostRevenue: Math.round(lostRevenueDaily * 100) / 100,
    outOfStock: outOfStock.results,
    byCategory: byCategory.results,
    recommendation: outOfStock.results.length > 0
      ? `${outOfStock.results.length} SKU(s) out of stock — ~R${Math.round(lostRevenueDaily).toLocaleString()}/day lost revenue estimate. Expedite reorders.`
      : 'No SKUs currently out of stock',
    timestamp: new Date().toISOString(),
  };
}

async function runRetailCustomerSegmentation(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const segments = await db.prepare(
    `SELECT customer_group, status, COUNT(*) as count,
            AVG(credit_limit) as avg_credit_limit,
            SUM(credit_balance) as total_outstanding
     FROM erp_customers
     WHERE tenant_id = ?
     GROUP BY customer_group, status
     ORDER BY count DESC`,
  ).bind(task.tenantId).all();

  const atRisk = await db.prepare(
    `SELECT name, customer_group, credit_limit, credit_balance
     FROM erp_customers
     WHERE tenant_id = ? AND credit_limit > 0 AND credit_balance > credit_limit * 0.8
     ORDER BY (credit_balance / credit_limit) DESC LIMIT 10`,
  ).bind(task.tenantId).all();

  return {
    type: 'retail_customer_segmentation',
    segments: segments.results,
    customersAtCreditRisk: atRisk.results.length,
    creditRiskDetails: atRisk.results,
    recommendation: atRisk.results.length > 0
      ? `${atRisk.results.length} customer(s) using >80% of credit limit — review credit policy and payment terms`
      : 'No customers at credit-limit risk',
    timestamp: new Date().toISOString(),
  };
}

const retailHandler: CatalystHandler = {
  name: 'domain:retail',
  match: t => {
    const s = taskText(t);
    // 'pos' intentionally excluded — it's a common substring (e.g. "exposure")
    // and causes cross-domain false positives. Retail POS tasks should set
    // catalystName containing "retail" or an explicit inputData.domain.
    return anyOf(s, 'retail', 'basket', 'storefront')
      || (anyOf(s, 'customer') && anyOf(s, 'segment'));
  },
  execute: async (task, db) => {
    const s = taskText(task);
    if (anyOf(s, 'stock', 'oos', 'out-of-stock', 'out of stock')) return runRetailOutOfStock(task, db);
    if (anyOf(s, 'customer', 'segment')) return runRetailCustomerSegmentation(task, db);
    return runRetailBasketAnalysis(task, db);
  },
};

// ── FMCG ────────────────────────────────────────────────────────────────

async function runFMCGShelfStockout(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const critical = await db.prepare(
    `SELECT sku, name, category, warehouse, stock_on_hand, reorder_level, selling_price
     FROM erp_products
     WHERE tenant_id = ? AND is_active = 1
       AND (stock_on_hand <= 0 OR stock_on_hand < reorder_level * 0.25)
     ORDER BY stock_on_hand ASC LIMIT 40`,
  ).bind(task.tenantId).all();

  const byCategory = await db.prepare(
    `SELECT category, COUNT(*) as critical_count
     FROM erp_products
     WHERE tenant_id = ? AND is_active = 1 AND stock_on_hand < reorder_level * 0.25
     GROUP BY category
     ORDER BY critical_count DESC LIMIT 10`,
  ).bind(task.tenantId).all();

  return {
    type: 'fmcg_shelf_stockout',
    criticalSkus: critical.results.length,
    details: critical.results,
    byCategory: byCategory.results,
    recommendation: critical.results.length > 0
      ? `${critical.results.length} SKU(s) at critical stock levels — expedite replenishment`
      : 'Shelf availability healthy',
    timestamp: new Date().toISOString(),
  };
}

async function runFMCGDistributorPerformance(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const perf = await db.prepare(
    `SELECT c.name as distributor, c.customer_group,
            COUNT(i.id) as invoice_count,
            COALESCE(SUM(i.total), 0) as total_revenue,
            COALESCE(SUM(CASE WHEN i.payment_status = 'unpaid' AND i.due_date < date('now') THEN i.amount_due ELSE 0 END), 0) as overdue_amount
     FROM erp_customers c
     LEFT JOIN erp_invoices i ON i.customer_id = c.id AND i.tenant_id = c.tenant_id
     WHERE c.tenant_id = ? AND (LOWER(c.customer_group) LIKE '%distributor%' OR LOWER(c.customer_group) LIKE '%wholesale%' OR LOWER(c.customer_group) LIKE '%reseller%')
     GROUP BY c.id, c.name, c.customer_group
     ORDER BY total_revenue DESC LIMIT 25`,
  ).bind(task.tenantId).all();

  const overdueDistributors = perf.results.filter(p => (p as { overdue_amount: number }).overdue_amount > 0);

  return {
    type: 'fmcg_distributor_performance',
    distributorCount: perf.results.length,
    withOverdues: overdueDistributors.length,
    performance: perf.results,
    recommendation: overdueDistributors.length > 0
      ? `${overdueDistributors.length} distributor(s) with overdue balances — initiate collections and review credit terms`
      : perf.results.length === 0
        ? 'No distributor-group customers found — verify customer_group classification'
        : 'Distributor book in good health',
    timestamp: new Date().toISOString(),
  };
}

async function runFMCGPromotionEffectiveness(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  // Use process_metric_history to compare a promo metric pre/post date.
  const promoMetrics = await db.prepare(
    `SELECT id, name, value, unit, status
     FROM process_metrics
     WHERE tenant_id = ? AND (LOWER(name) LIKE '%promo%' OR LOWER(name) LIKE '%campaign%' OR LOWER(name) LIKE '%lift%')
     ORDER BY measured_at DESC LIMIT 10`,
  ).bind(task.tenantId).all();

  const trends = [] as Record<string, unknown>[];
  for (const m of promoMetrics.results) {
    const metric = m as { id: string; name: string; value: number; unit: string };
    const history = await db.prepare(
      `SELECT value, recorded_at FROM process_metric_history
       WHERE tenant_id = ? AND metric_id = ?
       ORDER BY recorded_at DESC LIMIT 10`,
    ).bind(task.tenantId, metric.id).all();
    const values = history.results.map(h => (h as { value: number }).value);
    const earliest = values[values.length - 1] || metric.value;
    const latest = values[0] || metric.value;
    const lift = earliest !== 0 ? ((latest - earliest) / earliest) * 100 : 0;
    trends.push({
      name: metric.name,
      currentValue: metric.value,
      lift_pct: Math.round(lift * 10) / 10,
      sampleSize: values.length,
    });
  }

  return {
    type: 'fmcg_promotion_effectiveness',
    promoMetricsAnalysed: promoMetrics.results.length,
    trends,
    recommendation: promoMetrics.results.length === 0
      ? 'No promotion metrics found — tag process_metrics with promo/campaign/lift names to enable analysis'
      : `Analysed ${promoMetrics.results.length} promo metric(s). Review negative-lift metrics for discontinuation.`,
    timestamp: new Date().toISOString(),
  };
}

const fmcgHandler: CatalystHandler = {
  name: 'domain:fmcg',
  match: t => {
    const s = taskText(t);
    return anyOf(s, 'fmcg', 'distributor', 'shelf', 'promotion', 'promo')
      || (anyOf(s, 'trade') && anyOf(s, 'promotion', 'promo', 'campaign'));
  },
  execute: async (task, db) => {
    const s = taskText(task);
    if (anyOf(s, 'distributor', 'wholesale', 'reseller')) return runFMCGDistributorPerformance(task, db);
    if (anyOf(s, 'promotion', 'promo', 'campaign', 'lift')) return runFMCGPromotionEffectiveness(task, db);
    return runFMCGShelfStockout(task, db);
  },
};

// ── AGRICULTURE ─────────────────────────────────────────────────────────

async function runAgricultureReorder(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const critical = await db.prepare(
    `SELECT sku, name, category, stock_on_hand, reorder_level, reorder_quantity, cost_price
     FROM erp_products
     WHERE tenant_id = ? AND is_active = 1
       AND (LOWER(category) LIKE '%seed%' OR LOWER(category) LIKE '%feed%' OR LOWER(category) LIKE '%fertil%' OR LOWER(category) LIKE '%chem%' OR LOWER(category) LIKE '%crop%')
       AND stock_on_hand <= reorder_level
     ORDER BY (stock_on_hand / NULLIF(reorder_level, 0)) ASC LIMIT 30`,
  ).bind(task.tenantId).all();

  const estCost = critical.results.reduce((s, r) => {
    const row = r as { reorder_quantity: number; cost_price: number };
    return s + (row.reorder_quantity || 0) * (row.cost_price || 0);
  }, 0);

  return {
    type: 'agriculture_reorder',
    itemsAtOrBelowReorder: critical.results.length,
    estimatedReorderCost: Math.round(estCost * 100) / 100,
    items: critical.results,
    recommendation: critical.results.length > 0
      ? `${critical.results.length} input(s) at/below reorder level — raise POs (est. R${Math.round(estCost).toLocaleString()})`
      : 'Agricultural input stocks healthy',
    timestamp: new Date().toISOString(),
  };
}

async function runAgricultureMarketMetrics(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const metrics = await db.prepare(
    `SELECT name, value, unit, status, threshold_red, measured_at, source_system
     FROM process_metrics
     WHERE tenant_id = ? AND (LOWER(name) LIKE '%yield%' OR LOWER(name) LIKE '%price%' OR LOWER(name) LIKE '%market%' OR LOWER(name) LIKE '%harvest%')
     ORDER BY measured_at DESC LIMIT 20`,
  ).bind(task.tenantId).all();

  const red = metrics.results.filter(m => (m as { status: string }).status === 'red');

  return {
    type: 'agriculture_market_metrics',
    metricCount: metrics.results.length,
    breaches: red.length,
    metrics: metrics.results,
    recommendation: red.length > 0
      ? `${red.length} market metric(s) in red — review pricing and harvest timing`
      : 'Market metrics within expected range',
    timestamp: new Date().toISOString(),
  };
}

async function runAgricultureSupplierRisk(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const highRisk = await db.prepare(
    `SELECT name, supplier_group, risk_score, country, status
     FROM erp_suppliers
     WHERE tenant_id = ? AND status = 'active'
     ORDER BY risk_score DESC LIMIT 15`,
  ).bind(task.tenantId).all();

  const risky = highRisk.results.filter(s => (s as { risk_score: number }).risk_score > 0.5);

  return {
    type: 'agriculture_supplier_risk',
    supplierCount: highRisk.results.length,
    atRisk: risky.length,
    topRisk: highRisk.results.slice(0, 5),
    recommendation: risky.length > 0
      ? `${risky.length} supplier(s) with risk_score > 0.5 — diversify and renegotiate terms`
      : 'Supplier book within acceptable risk thresholds',
    timestamp: new Date().toISOString(),
  };
}

const agricultureHandler: CatalystHandler = {
  name: 'domain:agriculture',
  match: t => {
    const s = taskText(t);
    return anyOf(s, 'agriculture', 'farm', 'crop', 'irrigation', 'harvest', 'agri');
  },
  execute: async (task, db) => {
    const s = taskText(task);
    if (anyOf(s, 'market', 'yield', 'price', 'harvest')) return runAgricultureMarketMetrics(task, db);
    if (anyOf(s, 'supplier', 'risk')) return runAgricultureSupplierRisk(task, db);
    return runAgricultureReorder(task, db);
  },
};

// ── Registration ────────────────────────────────────────────────────────

export function registerCommercialHandlers(): void {
  registerHandler(retailHandler);
  registerHandler(fmcgHandler);
  registerHandler(agricultureHandler);
}

registerCommercialHandlers();
