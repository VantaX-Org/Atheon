/**
 * Operational domain catalyst handlers: mining, manufacturing, logistics.
 *
 * Each handler is a coarse domain adapter that inspects the task's
 * catalystName, action, and inputData.domain to decide whether it owns the
 * task, then routes internally to the correct sub-catalyst implementation.
 *
 * All queries target existing canonical tables (erp_*, process_metrics,
 * anomalies, risk_alerts). No new schema.
 */

import {
  type CatalystHandler,
  registerHandler,
} from './catalyst-handler-registry';
import { taskText, anyWord as anyOf, companyFilter, scopeLabel } from './catalyst-match-utils';
import type { TaskDefinition } from './catalyst-engine';

// ── MINING ──────────────────────────────────────────────────────────────

async function runMiningSafetyIncidentTrend(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  // anomalies + risk_alerts are tenant-scoped only (no company_id column) —
  // results are the same regardless of task.companyId.
  const anomalies = await db.prepare(
    `SELECT severity, COUNT(*) as count, AVG(deviation) as avg_deviation
     FROM anomalies
     WHERE tenant_id = ? AND (metric LIKE '%safety%' OR metric LIKE '%incident%' OR metric LIKE '%injury%')
       AND detected_at >= datetime('now', '-30 days')
     GROUP BY severity`,
  ).bind(task.tenantId).all();

  const risks = await db.prepare(
    `SELECT title, severity, impact_value, detected_at
     FROM risk_alerts
     WHERE tenant_id = ? AND (category LIKE '%safety%' OR category LIKE '%incident%')
       AND status = 'active'
     ORDER BY impact_value DESC LIMIT 10`,
  ).bind(task.tenantId).all();

  const total = anomalies.results.reduce((s, r) => s + ((r as { count: number }).count || 0), 0);
  const critical = anomalies.results
    .filter(r => (r as { severity: string }).severity === 'critical' || (r as { severity: string }).severity === 'high')
    .reduce((s, r) => s + ((r as { count: number }).count || 0), 0);

  return {
    type: 'mining_safety_incident_trend',
    window: 'last_30_days',
    totalIncidents: total,
    highSeverityCount: critical,
    severityBreakdown: anomalies.results,
    activeRisks: risks.results,
    recommendation: critical > 0
      ? `${critical} high-severity incidents in last 30 days — trigger safety review and increase inspection frequency`
      : 'No high-severity incidents detected — maintain current safety posture',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

async function runMiningPPECompliance(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  // process_metrics is tenant-scoped only.
  const metrics = await db.prepare(
    `SELECT id, name, value, unit, status, threshold_green, threshold_amber, threshold_red, measured_at
     FROM process_metrics
     WHERE tenant_id = ? AND (LOWER(name) LIKE '%ppe%' OR LOWER(name) LIKE '%compliance%' OR LOWER(name) LIKE '%safety%')
     ORDER BY measured_at DESC LIMIT 20`,
  ).bind(task.tenantId).all();

  const breaches = metrics.results.filter(m => (m as { status: string }).status === 'red');
  const warning = metrics.results.filter(m => (m as { status: string }).status === 'amber');

  return {
    type: 'mining_ppe_compliance',
    metricCount: metrics.results.length,
    breachCount: breaches.length,
    warningCount: warning.length,
    breaches: breaches.slice(0, 5),
    metrics: metrics.results,
    recommendation: breaches.length > 0
      ? `${breaches.length} compliance metric(s) in red — issue corrective action notices and schedule site inspection`
      : warning.length > 0
        ? `${warning.length} metric(s) trending towards breach — proactive coaching recommended`
        : 'All PPE/compliance metrics within tolerance',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

async function runMiningFatigueRisk(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  // Proxy for fatigue in the absence of shift/hours tables: tenure concentration by department.
  // Long-tenured, small-headcount departments are a known fatigue proxy in operational workforces.
  const { clause, params } = companyFilter(task.companyId);
  const byDept = await db.prepare(
    `SELECT department, COUNT(*) as headcount,
            AVG(JULIANDAY('now') - JULIANDAY(hire_date)) as avg_tenure_days,
            SUM(CASE WHEN termination_date IS NOT NULL THEN 1 ELSE 0 END) as departed_count
     FROM erp_employees
     WHERE tenant_id = ? AND status = 'active' AND department IS NOT NULL${clause}
     GROUP BY department
     ORDER BY avg_tenure_days DESC`,
  ).bind(task.tenantId, ...params).all();

  const atRisk = byDept.results.filter(r => {
    const row = r as { headcount: number; avg_tenure_days: number | null };
    return (row.headcount || 0) < 5 && (row.avg_tenure_days || 0) > 1825; // <5 people, >5yrs avg tenure
  });

  return {
    type: 'mining_fatigue_risk',
    departmentsAnalysed: byDept.results.length,
    atRiskDepartments: atRisk.length,
    atRiskDetails: atRisk,
    allDepartments: byDept.results,
    recommendation: atRisk.length > 0
      ? `${atRisk.length} department(s) show fatigue-risk indicators (small team + long avg tenure). Schedule rotation review.`
      : 'Workforce rotation patterns within healthy bounds',
    note: 'Fatigue-risk calculation uses tenure/headcount as a proxy. Hook up shift-hours data for higher accuracy.',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

async function runMiningSparePartsForecast(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  const critical = await db.prepare(
    `SELECT sku, name, category, stock_on_hand, reorder_level, reorder_quantity, cost_price
     FROM erp_products
     WHERE tenant_id = ? AND is_active = 1
       AND (LOWER(category) LIKE '%spare%' OR LOWER(category) LIKE '%part%' OR LOWER(category) LIKE '%consumable%' OR LOWER(category) LIKE '%bearing%' OR LOWER(category) LIKE '%belt%' OR LOWER(category) LIKE '%liner%')
       AND stock_on_hand <= reorder_level${clause}
     ORDER BY (stock_on_hand / NULLIF(reorder_level, 0)) ASC LIMIT 30`,
  ).bind(task.tenantId, ...params).all();

  const estCost = critical.results.reduce((s, r) => {
    const row = r as { reorder_quantity: number; cost_price: number };
    return s + (row.reorder_quantity || 0) * (row.cost_price || 0);
  }, 0);

  return {
    type: 'mining_spare_parts_forecast',
    criticalItems: critical.results.length,
    estimatedReorderCost: Math.round(estCost * 100) / 100,
    items: critical.results,
    recommendation: critical.results.length > 0
      ? `${critical.results.length} spare part(s) at/below reorder level — raise POs (est. R${Math.round(estCost).toLocaleString()}) to prevent equipment downtime`
      : 'Spare parts stock healthy',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

async function runMiningEnvironmentalCompliance(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  // process_metrics + risk_alerts are tenant-scoped only.
  const metrics = await db.prepare(
    `SELECT name, value, unit, status, threshold_red, measured_at
     FROM process_metrics
     WHERE tenant_id = ?
       AND (LOWER(name) LIKE '%gas%' OR LOWER(name) LIKE '%dust%' OR LOWER(name) LIKE '%emission%'
            OR LOWER(name) LIKE '%noise%' OR LOWER(name) LIKE '%air quality%' OR LOWER(name) LIKE '%water%'
            OR LOWER(name) LIKE '%pollut%' OR LOWER(name) LIKE '%environment%')
     ORDER BY measured_at DESC LIMIT 30`,
  ).bind(task.tenantId).all();

  const breaches = metrics.results.filter(m => (m as { status: string }).status === 'red');

  const risks = await db.prepare(
    `SELECT title, severity, impact_value, detected_at
     FROM risk_alerts
     WHERE tenant_id = ? AND status = 'active'
       AND (LOWER(category) LIKE '%environment%' OR LOWER(category) LIKE '%pollut%')
     ORDER BY impact_value DESC LIMIT 10`,
  ).bind(task.tenantId).all();

  return {
    type: 'mining_environmental_compliance',
    metricCount: metrics.results.length,
    breachCount: breaches.length,
    breaches,
    activeEnvRisks: risks.results,
    recommendation: breaches.length > 0
      ? `${breaches.length} environmental metric(s) in red — notify environmental officer and file required reports`
      : 'Environmental metrics within compliance thresholds',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

const miningHandler: CatalystHandler = {
  name: 'domain:mining',
  match: t => {
    const s = taskText(t);
    return anyOf(s, 'mining', 'steel', 'ore') || (anyOf(s, 'safety') && anyOf(s, 'incident', 'ppe', 'fatigue'));
  },
  execute: async (task, db) => {
    const s = taskText(task);
    // Listing singular + plural/adjective forms explicitly — word-boundary
    // matching is strict (it won't match 'environment' inside 'environmental').
    if (anyOf(s, 'environment', 'environmental', 'emission', 'emissions', 'pollution', 'pollutant', 'dust', 'gas')) return runMiningEnvironmentalCompliance(task, db);
    if (anyOf(s, 'spare', 'parts', 'consumable', 'consumables', 'forecast')) return runMiningSparePartsForecast(task, db);
    if (anyOf(s, 'fatigue', 'rotation', 'shift')) return runMiningFatigueRisk(task, db);
    if (anyOf(s, 'ppe', 'compliance')) return runMiningPPECompliance(task, db);
    return runMiningSafetyIncidentTrend(task, db);
  },
};

// ── MANUFACTURING ──────────────────────────────────────────────────────

async function runManufacturingThroughput(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  // process_metrics is tenant-scoped only.
  const metrics = await db.prepare(
    `SELECT name, value, unit, status, threshold_green, threshold_amber, threshold_red, measured_at
     FROM process_metrics
     WHERE tenant_id = ? AND (LOWER(name) LIKE '%throughput%' OR LOWER(name) LIKE '%production%' OR LOWER(name) LIKE '%oee%' OR LOWER(name) LIKE '%yield%')
     ORDER BY measured_at DESC LIMIT 30`,
  ).bind(task.tenantId).all();

  const red = metrics.results.filter(m => (m as { status: string }).status === 'red');
  const green = metrics.results.filter(m => (m as { status: string }).status === 'green');

  return {
    type: 'manufacturing_throughput',
    metricCount: metrics.results.length,
    belowTarget: red.length,
    onTarget: green.length,
    breaches: red,
    metrics: metrics.results,
    recommendation: red.length > 0
      ? `${red.length} production metric(s) below target — trigger bottleneck analysis and line-supervisor review`
      : 'Production metrics on target',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

async function runManufacturingQualityDefects(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const anomalies = await db.prepare(
    `SELECT metric, severity, expected_value, actual_value, deviation, detected_at
     FROM anomalies
     WHERE tenant_id = ?
       AND (LOWER(metric) LIKE '%defect%' OR LOWER(metric) LIKE '%quality%' OR LOWER(metric) LIKE '%reject%' OR LOWER(metric) LIKE '%rework%')
       AND status = 'open'
     ORDER BY deviation DESC LIMIT 20`,
  ).bind(task.tenantId).all();

  const totalDeviation = anomalies.results.reduce((s, r) => s + ((r as { deviation: number }).deviation || 0), 0);

  return {
    type: 'manufacturing_quality_defects',
    openAnomalies: anomalies.results.length,
    totalDeviation: Math.round(totalDeviation * 100) / 100,
    topDefects: anomalies.results.slice(0, 5),
    all: anomalies.results,
    recommendation: anomalies.results.length > 3
      ? `${anomalies.results.length} open quality anomalies — initiate root-cause analysis for top ${Math.min(3, anomalies.results.length)}`
      : 'Quality anomaly count within acceptable range',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

async function runManufacturingMaintenanceDue(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const critical = await db.prepare(
    `SELECT name, value, unit, threshold_red, measured_at
     FROM process_metrics
     WHERE tenant_id = ? AND status = 'red'
       AND (LOWER(name) LIKE '%machine%' OR LOWER(name) LIKE '%maintenance%' OR LOWER(name) LIKE '%uptime%' OR LOWER(name) LIKE '%downtime%' OR LOWER(name) LIKE '%equipment%')
     ORDER BY measured_at DESC LIMIT 20`,
  ).bind(task.tenantId).all();

  const warning = await db.prepare(
    `SELECT name, value, unit, threshold_amber, measured_at
     FROM process_metrics
     WHERE tenant_id = ? AND status = 'amber'
       AND (LOWER(name) LIKE '%machine%' OR LOWER(name) LIKE '%maintenance%' OR LOWER(name) LIKE '%uptime%' OR LOWER(name) LIKE '%downtime%')
     ORDER BY measured_at DESC LIMIT 20`,
  ).bind(task.tenantId).all();

  return {
    type: 'manufacturing_maintenance_due',
    criticalCount: critical.results.length,
    warningCount: warning.results.length,
    critical: critical.results,
    warning: warning.results,
    recommendation: critical.results.length > 0
      ? `${critical.results.length} equipment metric(s) in red — schedule maintenance within 24h and raise work orders`
      : warning.results.length > 0
        ? `${warning.results.length} equipment metric(s) trending — schedule preventive maintenance`
        : 'No equipment maintenance actions required',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

async function runManufacturingEnergyEfficiency(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const metrics = await db.prepare(
    `SELECT name, value, unit, status, threshold_amber, threshold_red, measured_at
     FROM process_metrics
     WHERE tenant_id = ?
       AND (LOWER(name) LIKE '%energy%' OR LOWER(name) LIKE '%power%' OR LOWER(name) LIKE '%kwh%' OR LOWER(name) LIKE '%consumption%' OR LOWER(name) LIKE '%efficiency%')
     ORDER BY measured_at DESC LIMIT 20`,
  ).bind(task.tenantId).all();

  const breaches = metrics.results.filter(m => (m as { status: string }).status === 'red');
  const warning = metrics.results.filter(m => (m as { status: string }).status === 'amber');

  return {
    type: 'manufacturing_energy_efficiency',
    metricCount: metrics.results.length,
    overConsumption: breaches.length,
    warning: warning.length,
    metrics: metrics.results,
    recommendation: breaches.length > 0
      ? `${breaches.length} energy metric(s) over threshold — schedule load audit on affected lines`
      : warning.length > 0
        ? `${warning.length} energy metric(s) trending — investigate before next billing cycle`
        : 'Energy consumption within target',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

async function runManufacturingCostVariance(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  // Compare PO cost trends by supplier over last 90 days vs prior 90 days.
  const { clause, params } = companyFilter(task.companyId);
  const recent = await db.prepare(
    `SELECT supplier_name, AVG(total) as avg_po, COUNT(*) as po_count
     FROM erp_purchase_orders
     WHERE tenant_id = ? AND order_date >= date('now', '-90 days') AND status != 'cancelled'${clause}
     GROUP BY supplier_name`,
  ).bind(task.tenantId, ...params).all();

  const baseline = await db.prepare(
    `SELECT supplier_name, AVG(total) as avg_po
     FROM erp_purchase_orders
     WHERE tenant_id = ? AND order_date >= date('now', '-180 days') AND order_date < date('now', '-90 days') AND status != 'cancelled'${clause}
     GROUP BY supplier_name`,
  ).bind(task.tenantId, ...params).all();

  const baselineMap = new Map<string, number>();
  for (const b of baseline.results) {
    const row = b as { supplier_name: string; avg_po: number };
    baselineMap.set(row.supplier_name, row.avg_po);
  }

  const variances = recent.results.map(r => {
    const row = r as { supplier_name: string; avg_po: number; po_count: number };
    const prior = baselineMap.get(row.supplier_name);
    const variancePct = prior && prior > 0 ? ((row.avg_po - prior) / prior) * 100 : null;
    return {
      supplier: row.supplier_name,
      recentAvg: Math.round((row.avg_po || 0) * 100) / 100,
      priorAvg: prior ? Math.round(prior * 100) / 100 : null,
      variancePct: variancePct !== null ? Math.round(variancePct * 10) / 10 : null,
      poCount: row.po_count,
    };
  });

  const inflating = variances.filter(v => v.variancePct !== null && v.variancePct > 10);

  return {
    type: 'manufacturing_cost_variance',
    window: 'recent_90d_vs_prior_90d',
    suppliersAnalysed: variances.length,
    suppliersInflating: inflating.length,
    variances,
    recommendation: inflating.length > 0
      ? `${inflating.length} supplier(s) with >10% cost inflation — initiate sourcing review`
      : 'Supplier cost profile stable',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

const manufacturingHandler: CatalystHandler = {
  name: 'domain:manufacturing',
  match: t => {
    const s = taskText(t);
    return anyOf(s, 'manufacturing', 'factory', 'production', 'oee', 'throughput')
      || (anyOf(s, 'quality') && anyOf(s, 'defect', 'reject'))
      || (anyOf(s, 'equipment', 'machine') && anyOf(s, 'maintenance'))
      || (anyOf(s, 'energy', 'power', 'kwh') && !anyOf(s, 'portfolio'));
  },
  execute: async (task, db) => {
    const s = taskText(task);
    if (anyOf(s, 'energy', 'power', 'kwh', 'consumption')) return runManufacturingEnergyEfficiency(task, db);
    if (anyOf(s, 'cost', 'variance', 'supplier cost', 'inflation')) return runManufacturingCostVariance(task, db);
    if (anyOf(s, 'quality', 'defect', 'reject', 'rework')) return runManufacturingQualityDefects(task, db);
    if (anyOf(s, 'maintenance', 'equipment', 'machine')) return runManufacturingMaintenanceDue(task, db);
    return runManufacturingThroughput(task, db);
  },
};

// ── LOGISTICS ───────────────────────────────────────────────────────────

async function runLogisticsFleetUtilization(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  // process_metrics is tenant-scoped only.
  const metrics = await db.prepare(
    `SELECT name, value, unit, status, threshold_red, measured_at
     FROM process_metrics
     WHERE tenant_id = ? AND (LOWER(name) LIKE '%fleet%' OR LOWER(name) LIKE '%vehicle%' OR LOWER(name) LIKE '%utiliz%' OR LOWER(name) LIKE '%mileage%')
     ORDER BY measured_at DESC LIMIT 20`,
  ).bind(task.tenantId).all();

  const underused = metrics.results.filter(m => (m as { status: string }).status === 'red');

  return {
    type: 'logistics_fleet_utilization',
    fleetMetricCount: metrics.results.length,
    alerts: underused.length,
    metrics: metrics.results,
    recommendation: underused.length > 0
      ? `${underused.length} fleet metric(s) in red — review route planning and consider fleet rebalancing`
      : 'Fleet utilization healthy',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

async function runLogisticsDeliveryCompliance(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  const delayed = await db.prepare(
    `SELECT po_number, supplier_name, order_date, delivery_date, delivery_status, total
     FROM erp_purchase_orders
     WHERE tenant_id = ?
       AND (delivery_status = 'delayed' OR (delivery_date IS NOT NULL AND delivery_date < date('now') AND delivery_status != 'delivered'))${clause}
     ORDER BY delivery_date ASC LIMIT 20`,
  ).bind(task.tenantId, ...params).all();

  const summary = await db.prepare(
    `SELECT delivery_status, COUNT(*) as count, SUM(total) as total_value
     FROM erp_purchase_orders
     WHERE tenant_id = ?${clause} GROUP BY delivery_status`,
  ).bind(task.tenantId, ...params).all();

  return {
    type: 'logistics_delivery_compliance',
    delayedCount: delayed.results.length,
    delayed: delayed.results,
    summary: summary.results,
    recommendation: delayed.results.length > 0
      ? `${delayed.results.length} PO(s) overdue or delayed — escalate with supplier account managers`
      : 'All deliveries on track',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

async function runLogisticsWarehouseStock(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  const lowStock = await db.prepare(
    `SELECT sku, name, warehouse, stock_on_hand, reorder_level, reorder_quantity, cost_price
     FROM erp_products
     WHERE tenant_id = ? AND is_active = 1 AND stock_on_hand <= reorder_level${clause}
     ORDER BY stock_on_hand ASC LIMIT 25`,
  ).bind(task.tenantId, ...params).all();

  const byWarehouse = await db.prepare(
    `SELECT warehouse, COUNT(*) as sku_count, SUM(stock_on_hand * cost_price) as inventory_value
     FROM erp_products
     WHERE tenant_id = ? AND is_active = 1${clause}
     GROUP BY warehouse`,
  ).bind(task.tenantId, ...params).all();

  const reorderValue = lowStock.results.reduce((s, r) => {
    const row = r as { reorder_quantity: number; cost_price: number };
    return s + (row.reorder_quantity || 0) * (row.cost_price || 0);
  }, 0);

  return {
    type: 'logistics_warehouse_stock',
    lowStockItems: lowStock.results.length,
    recommendedReorderValue: Math.round(reorderValue * 100) / 100,
    lowStock: lowStock.results,
    byWarehouse: byWarehouse.results,
    recommendation: lowStock.results.length > 0
      ? `${lowStock.results.length} SKU(s) at/below reorder level — raise POs (est. R${Math.round(reorderValue).toLocaleString()})`
      : 'All warehouse stock above reorder levels',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

async function runLogisticsCarrierPerformance(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  const carriers = await db.prepare(
    `SELECT supplier_name,
            COUNT(*) as po_count,
            SUM(CASE WHEN delivery_status = 'delivered' THEN 1 ELSE 0 END) as delivered,
            SUM(CASE WHEN delivery_status = 'delayed' THEN 1 ELSE 0 END) as delayed,
            SUM(CASE WHEN delivery_status = 'pending' AND delivery_date < date('now') THEN 1 ELSE 0 END) as overdue,
            AVG(total) as avg_value
     FROM erp_purchase_orders
     WHERE tenant_id = ? AND order_date >= date('now', '-90 days')${clause}
     GROUP BY supplier_name
     ORDER BY po_count DESC LIMIT 20`,
  ).bind(task.tenantId, ...params).all();

  const ranked = carriers.results.map(c => {
    const row = c as { supplier_name: string; po_count: number; delivered: number; delayed: number; overdue: number; avg_value: number };
    const reliability = row.po_count > 0 ? ((row.delivered || 0) / row.po_count) * 100 : 0;
    return {
      carrier: row.supplier_name,
      poCount: row.po_count,
      delivered: row.delivered || 0,
      delayed: row.delayed || 0,
      overdue: row.overdue || 0,
      reliabilityPct: Math.round(reliability * 10) / 10,
      avgOrderValue: Math.round((row.avg_value || 0) * 100) / 100,
    };
  }).sort((a, b) => a.reliabilityPct - b.reliabilityPct);

  const underperforming = ranked.filter(c => c.reliabilityPct < 80 && c.poCount >= 3);

  return {
    type: 'logistics_carrier_performance',
    carrierCount: ranked.length,
    underperforming: underperforming.length,
    carriers: ranked,
    recommendation: underperforming.length > 0
      ? `${underperforming.length} carrier(s) below 80% reliability with meaningful volume — review service-level agreements`
      : ranked.length === 0 ? 'No carrier activity in last 90 days' : 'All carriers performing above threshold',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

async function runLogisticsRouteEfficiency(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  // process_metrics is tenant-scoped only.
  const metrics = await db.prepare(
    `SELECT name, value, unit, status, measured_at
     FROM process_metrics
     WHERE tenant_id = ?
       AND (LOWER(name) LIKE '%route%' OR LOWER(name) LIKE '%mileage%' OR LOWER(name) LIKE '%km %' OR LOWER(name) LIKE '%fuel%' OR LOWER(name) LIKE '%stops per%')
     ORDER BY measured_at DESC LIMIT 20`,
  ).bind(task.tenantId).all();

  const red = metrics.results.filter(m => (m as { status: string }).status === 'red');

  return {
    type: 'logistics_route_efficiency',
    metricCount: metrics.results.length,
    alerts: red.length,
    metrics: metrics.results,
    recommendation: red.length > 0
      ? `${red.length} route metric(s) in red — run route optimisation pass and review fuel logs`
      : metrics.results.length === 0
        ? 'No route metrics ingested — connect telematics or dispatch data to enable'
        : 'Route efficiency within target',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

const logisticsHandler: CatalystHandler = {
  name: 'domain:logistics',
  match: t => {
    const s = taskText(t);
    return anyOf(s, 'logistics', 'fleet', 'delivery', 'warehouse', 'transport', 'shipping', 'carrier', 'route');
  },
  execute: async (task, db) => {
    const s = taskText(task);
    if (anyOf(s, 'carrier', 'sla')) return runLogisticsCarrierPerformance(task, db);
    if (anyOf(s, 'route', 'mileage', 'fuel')) return runLogisticsRouteEfficiency(task, db);
    if (anyOf(s, 'delivery', 'shipment', 'shipping')) return runLogisticsDeliveryCompliance(task, db);
    if (anyOf(s, 'warehouse', 'stock', 'inventory')) return runLogisticsWarehouseStock(task, db);
    return runLogisticsFleetUtilization(task, db);
  },
};

// ── Registration ────────────────────────────────────────────────────────

export function registerOperationalHandlers(): void {
  registerHandler(miningHandler);
  registerHandler(manufacturingHandler);
  registerHandler(logisticsHandler);
}

// Auto-register on import.
registerOperationalHandlers();
