/**
 * Commercial domain catalyst handlers: retail, FMCG, agriculture.
 * See catalyst-operational-handlers.ts for the pattern.
 */

import {
  type CatalystHandler,
  registerHandler,
} from './catalyst-handler-registry';
import { taskText, anyWord as anyOf } from './catalyst-match-utils';
import type { TaskDefinition } from './catalyst-engine';

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

async function runRetailTopCustomers(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const top = await db.prepare(
    `SELECT c.name, c.customer_group,
            COUNT(i.id) as invoice_count,
            COALESCE(SUM(i.total), 0) as lifetime_value,
            COALESCE(MAX(i.invoice_date), '') as last_purchase
     FROM erp_customers c
     LEFT JOIN erp_invoices i ON i.customer_id = c.id AND i.tenant_id = c.tenant_id AND i.status != 'cancelled'
     WHERE c.tenant_id = ?
     GROUP BY c.id, c.name, c.customer_group
     ORDER BY lifetime_value DESC LIMIT 20`,
  ).bind(task.tenantId).all();

  const totalLtv = top.results.reduce((s, r) => s + ((r as { lifetime_value: number }).lifetime_value || 0), 0);
  const topTenLtv = top.results.slice(0, 10).reduce((s, r) => s + ((r as { lifetime_value: number }).lifetime_value || 0), 0);
  const concentration = totalLtv > 0 ? (topTenLtv / totalLtv) * 100 : 0;

  return {
    type: 'retail_top_customers',
    customersAnalysed: top.results.length,
    top10Concentration: Math.round(concentration * 10) / 10,
    totalLifetimeValue: Math.round(totalLtv * 100) / 100,
    customers: top.results,
    recommendation: concentration > 60
      ? `Top 10 customers account for ${Math.round(concentration)}% of revenue — diversify with mid-tier retention plays`
      : top.results.length === 0
        ? 'No purchase history yet — ingest POS/invoice data'
        : `Top 10 customers account for ${Math.round(concentration)}% of revenue — healthy diversification`,
    timestamp: new Date().toISOString(),
  };
}

async function runRetailPricingAdvice(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  // Surface SKUs with weak margin (cost / selling < X%) and slow turnover (high stock).
  const weakMargin = await db.prepare(
    `SELECT sku, name, category, cost_price, selling_price, stock_on_hand,
            CASE WHEN selling_price > 0 THEN ROUND((1 - cost_price/selling_price) * 100, 1) ELSE 0 END as margin_pct
     FROM erp_products
     WHERE tenant_id = ? AND is_active = 1 AND selling_price > 0 AND cost_price > 0
       AND (cost_price / selling_price) > 0.75
     ORDER BY margin_pct ASC LIMIT 25`,
  ).bind(task.tenantId).all();

  const overstocked = await db.prepare(
    `SELECT sku, name, category, stock_on_hand, reorder_level, selling_price
     FROM erp_products
     WHERE tenant_id = ? AND is_active = 1 AND reorder_level > 0 AND stock_on_hand > reorder_level * 5
     ORDER BY (stock_on_hand * selling_price) DESC LIMIT 15`,
  ).bind(task.tenantId).all();

  return {
    type: 'retail_pricing_advice',
    weakMarginSkus: weakMargin.results.length,
    overstockedSkus: overstocked.results.length,
    weakMargin: weakMargin.results,
    overstocked: overstocked.results,
    recommendation: (weakMargin.results.length + overstocked.results.length) > 0
      ? `${weakMargin.results.length} SKU(s) under 25% margin, ${overstocked.results.length} overstocked — review pricing and clearance plans`
      : 'Margin and stock turnover within target',
    timestamp: new Date().toISOString(),
  };
}

const retailHandler: CatalystHandler = {
  name: 'domain:retail',
  match: t => {
    const s = taskText(t);
    return anyOf(s, 'retail', 'pos', 'basket', 'storefront')
      || (anyOf(s, 'customer') && anyOf(s, 'segment', 'lifetime', 'ltv', 'top'))
      || (anyOf(s, 'pricing') && anyOf(s, 'advice', 'margin', 'review'));
  },
  execute: async (task, db) => {
    const s = taskText(task);
    if (anyOf(s, 'stock', 'oos', 'out-of-stock', 'out of stock')) return runRetailOutOfStock(task, db);
    if (anyOf(s, 'lifetime', 'ltv', 'top customer', 'top-customer')) return runRetailTopCustomers(task, db);
    if (anyOf(s, 'pricing', 'margin', 'markup')) return runRetailPricingAdvice(task, db);
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

async function runFMCGCategoryPerformance(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const byCategory = await db.prepare(
    `SELECT category,
            COUNT(*) as sku_count,
            SUM(stock_on_hand) as total_units,
            SUM(stock_on_hand * cost_price) as inventory_value,
            AVG(CASE WHEN selling_price > 0 AND cost_price > 0 THEN (1 - cost_price/selling_price) * 100 ELSE NULL END) as avg_margin_pct,
            SUM(CASE WHEN stock_on_hand <= 0 THEN 1 ELSE 0 END) as oos_count
     FROM erp_products
     WHERE tenant_id = ? AND is_active = 1
     GROUP BY category
     ORDER BY inventory_value DESC LIMIT 20`,
  ).bind(task.tenantId).all();

  const totalValue = byCategory.results.reduce((s, r) => s + ((r as { inventory_value: number }).inventory_value || 0), 0);

  return {
    type: 'fmcg_category_performance',
    categoryCount: byCategory.results.length,
    totalInventoryValue: Math.round(totalValue * 100) / 100,
    categories: byCategory.results,
    recommendation: byCategory.results.length === 0
      ? 'No categorised products — populate category field to enable analysis'
      : `Top category by value holds R${Math.round((byCategory.results[0] as { inventory_value: number }).inventory_value || 0).toLocaleString()} — review demand coverage`,
    timestamp: new Date().toISOString(),
  };
}

async function runFMCGTradeSpend(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const tradeInvoices = await db.prepare(
    `SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total_spend
     FROM erp_invoices
     WHERE tenant_id = ?
       AND invoice_date >= date('now', '-90 days')
       AND (LOWER(reference) LIKE '%promo%' OR LOWER(reference) LIKE '%trade%' OR LOWER(reference) LIKE '%campaign%' OR LOWER(notes) LIKE '%promo%' OR LOWER(notes) LIKE '%trade%')`,
  ).bind(task.tenantId).first<{ count: number; total_spend: number }>();

  const topDistributors = await db.prepare(
    `SELECT customer_name, COUNT(*) as invoice_count, SUM(total) as total_spend
     FROM erp_invoices
     WHERE tenant_id = ?
       AND invoice_date >= date('now', '-90 days')
       AND (LOWER(reference) LIKE '%promo%' OR LOWER(reference) LIKE '%trade%' OR LOWER(notes) LIKE '%promo%' OR LOWER(notes) LIKE '%trade%')
     GROUP BY customer_name
     ORDER BY total_spend DESC LIMIT 10`,
  ).bind(task.tenantId).all();

  return {
    type: 'fmcg_trade_spend',
    window: 'last_90_days',
    tradeInvoiceCount: tradeInvoices?.count || 0,
    totalTradeSpend: Math.round((tradeInvoices?.total_spend || 0) * 100) / 100,
    topDistributors: topDistributors.results,
    recommendation: (tradeInvoices?.count || 0) === 0
      ? 'No trade/promo-tagged invoices found — tag invoice reference or notes to enable trade-spend analysis'
      : `Trade spend R${Math.round(tradeInvoices?.total_spend || 0).toLocaleString()} across ${tradeInvoices?.count || 0} invoice(s) — review ROI with top partners`,
    timestamp: new Date().toISOString(),
  };
}

const fmcgHandler: CatalystHandler = {
  name: 'domain:fmcg',
  match: t => {
    const s = taskText(t);
    return anyOf(s, 'fmcg', 'distributor', 'shelf', 'promotion', 'promo')
      || (anyOf(s, 'trade') && anyOf(s, 'promotion', 'promo', 'campaign', 'spend'))
      || (anyOf(s, 'category') && anyOf(s, 'performance', 'review', 'mix'));
  },
  execute: async (task, db) => {
    const s = taskText(task);
    if (anyOf(s, 'category') && anyOf(s, 'performance', 'review', 'mix')) return runFMCGCategoryPerformance(task, db);
    if (anyOf(s, 'trade spend') || (anyOf(s, 'trade') && anyOf(s, 'spend'))) return runFMCGTradeSpend(task, db);
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

async function runAgricultureYieldVariance(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const yieldMetrics = await db.prepare(
    `SELECT id, name, value, unit, status FROM process_metrics
     WHERE tenant_id = ? AND LOWER(name) LIKE '%yield%'
     ORDER BY measured_at DESC LIMIT 10`,
  ).bind(task.tenantId).all();

  const analyses: Record<string, unknown>[] = [];
  for (const m of yieldMetrics.results) {
    const metric = m as { id: string; name: string; value: number; unit: string };
    const history = await db.prepare(
      `SELECT value FROM process_metric_history
       WHERE tenant_id = ? AND metric_id = ?
       ORDER BY recorded_at DESC LIMIT 12`,
    ).bind(task.tenantId, metric.id).all();
    const values = history.results.map(h => (h as { value: number }).value || 0);
    if (values.length < 2) {
      analyses.push({ metric: metric.name, currentValue: metric.value, note: 'Insufficient history', sampleSize: values.length });
      continue;
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    const stdev = Math.sqrt(variance);
    const cv = mean !== 0 ? (stdev / Math.abs(mean)) * 100 : 0;
    analyses.push({
      metric: metric.name,
      currentValue: metric.value,
      mean: Math.round(mean * 100) / 100,
      stdev: Math.round(stdev * 100) / 100,
      coefficientOfVariationPct: Math.round(cv * 10) / 10,
      sampleSize: values.length,
    });
  }

  const volatile = analyses.filter(a => typeof a.coefficientOfVariationPct === 'number' && (a.coefficientOfVariationPct as number) > 20);

  return {
    type: 'agriculture_yield_variance',
    metricsAnalysed: analyses.length,
    volatile: volatile.length,
    analyses,
    recommendation: volatile.length > 0
      ? `${volatile.length} yield metric(s) with CV >20% — investigate agronomy inputs and planting rotation`
      : analyses.length === 0
        ? 'No yield metrics ingested — wire up field/sensor data'
        : 'Yield stability within acceptable range',
    timestamp: new Date().toISOString(),
  };
}

async function runAgricultureSeasonalDemand(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const monthly = await db.prepare(
    `SELECT strftime('%Y-%m', invoice_date) as month,
            COUNT(*) as invoice_count,
            COALESCE(SUM(total), 0) as revenue
     FROM erp_invoices
     WHERE tenant_id = ? AND invoice_date IS NOT NULL AND status != 'cancelled'
       AND invoice_date >= date('now', '-12 months')
     GROUP BY month
     ORDER BY month DESC`,
  ).bind(task.tenantId).all();

  const revenues = monthly.results.map(r => (r as { revenue: number }).revenue || 0);
  const avg = revenues.length > 0 ? revenues.reduce((a, b) => a + b, 0) / revenues.length : 0;
  const peak = revenues.length > 0 ? Math.max(...revenues) : 0;
  const trough = revenues.length > 0 ? Math.min(...revenues) : 0;
  const amplitude = avg > 0 ? ((peak - trough) / avg) * 100 : 0;

  return {
    type: 'agriculture_seasonal_demand',
    monthsAnalysed: monthly.results.length,
    avgMonthlyRevenue: Math.round(avg * 100) / 100,
    peakMonthlyRevenue: Math.round(peak * 100) / 100,
    troughMonthlyRevenue: Math.round(trough * 100) / 100,
    seasonalAmplitudePct: Math.round(amplitude * 10) / 10,
    monthly: monthly.results,
    recommendation: amplitude > 50
      ? `Seasonal amplitude ${Math.round(amplitude)}% — plan working capital + crew rotation around peaks`
      : monthly.results.length === 0
        ? 'No invoice history yet'
        : 'Demand pattern stable across the year',
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
    if (anyOf(s, 'yield') && anyOf(s, 'variance', 'stability', 'volatility')) return runAgricultureYieldVariance(task, db);
    if (anyOf(s, 'seasonal', 'demand', 'monthly')) return runAgricultureSeasonalDemand(task, db);
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
