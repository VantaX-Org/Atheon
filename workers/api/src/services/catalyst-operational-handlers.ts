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
import type { TaskDefinition } from './catalyst-engine';

// ── Shared helpers ──────────────────────────────────────────────────────

function taskText(task: TaskDefinition): string {
  const domain = typeof task.inputData?.domain === 'string' ? task.inputData.domain : '';
  return `${task.catalystName} ${task.action} ${domain}`.toLowerCase();
}

function anyOf(s: string, ...terms: string[]): boolean {
  return terms.some(t => s.includes(t));
}

// ── MINING ──────────────────────────────────────────────────────────────

async function runMiningSafetyIncidentTrend(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
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
    timestamp: new Date().toISOString(),
  };
}

async function runMiningPPECompliance(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
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
    timestamp: new Date().toISOString(),
  };
}

async function runMiningFatigueRisk(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  // Proxy for fatigue in the absence of shift/hours tables: tenure concentration by department.
  // Long-tenured, small-headcount departments are a known fatigue proxy in operational workforces.
  const byDept = await db.prepare(
    `SELECT department, COUNT(*) as headcount,
            AVG(JULIANDAY('now') - JULIANDAY(hire_date)) as avg_tenure_days,
            SUM(CASE WHEN termination_date IS NOT NULL THEN 1 ELSE 0 END) as departed_count
     FROM erp_employees
     WHERE tenant_id = ? AND status = 'active' AND department IS NOT NULL
     GROUP BY department
     ORDER BY avg_tenure_days DESC`,
  ).bind(task.tenantId).all();

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
    timestamp: new Date().toISOString(),
  };
}

const miningHandler: CatalystHandler = {
  name: 'domain:mining',
  match: t => {
    const s = taskText(t);
    // 'ore' excluded to avoid matching "store", "before", "core" etc. Mining
    // tasks should set catalystName containing "mining"/"steel" or an
    // inputData.domain of 'mining'/'mining-*'.
    return anyOf(s, 'mining', 'steel') || (anyOf(s, 'safety') && anyOf(s, 'incident', 'ppe', 'fatigue'));
  },
  execute: async (task, db) => {
    const s = taskText(task);
    if (anyOf(s, 'fatigue', 'rotation', 'shift')) return runMiningFatigueRisk(task, db);
    if (anyOf(s, 'ppe', 'compliance')) return runMiningPPECompliance(task, db);
    return runMiningSafetyIncidentTrend(task, db);
  },
};

// ── MANUFACTURING ──────────────────────────────────────────────────────

async function runManufacturingThroughput(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
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
    timestamp: new Date().toISOString(),
  };
}

const manufacturingHandler: CatalystHandler = {
  name: 'domain:manufacturing',
  match: t => {
    const s = taskText(t);
    return anyOf(s, 'manufacturing', 'factory', 'production', 'oee', 'throughput')
      || (anyOf(s, 'quality') && anyOf(s, 'defect', 'reject'))
      || (anyOf(s, 'equipment', 'machine') && anyOf(s, 'maintenance'));
  },
  execute: async (task, db) => {
    const s = taskText(task);
    if (anyOf(s, 'quality', 'defect', 'reject', 'rework')) return runManufacturingQualityDefects(task, db);
    if (anyOf(s, 'maintenance', 'equipment', 'machine')) return runManufacturingMaintenanceDue(task, db);
    return runManufacturingThroughput(task, db);
  },
};

// ── LOGISTICS ───────────────────────────────────────────────────────────

async function runLogisticsFleetUtilization(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
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
    timestamp: new Date().toISOString(),
  };
}

async function runLogisticsDeliveryCompliance(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const delayed = await db.prepare(
    `SELECT po_number, supplier_name, order_date, delivery_date, delivery_status, total
     FROM erp_purchase_orders
     WHERE tenant_id = ?
       AND (delivery_status = 'delayed' OR (delivery_date IS NOT NULL AND delivery_date < date('now') AND delivery_status != 'delivered'))
     ORDER BY delivery_date ASC LIMIT 20`,
  ).bind(task.tenantId).all();

  const summary = await db.prepare(
    `SELECT delivery_status, COUNT(*) as count, SUM(total) as total_value
     FROM erp_purchase_orders
     WHERE tenant_id = ? GROUP BY delivery_status`,
  ).bind(task.tenantId).all();

  return {
    type: 'logistics_delivery_compliance',
    delayedCount: delayed.results.length,
    delayed: delayed.results,
    summary: summary.results,
    recommendation: delayed.results.length > 0
      ? `${delayed.results.length} PO(s) overdue or delayed — escalate with supplier account managers`
      : 'All deliveries on track',
    timestamp: new Date().toISOString(),
  };
}

async function runLogisticsWarehouseStock(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const lowStock = await db.prepare(
    `SELECT sku, name, warehouse, stock_on_hand, reorder_level, reorder_quantity, cost_price
     FROM erp_products
     WHERE tenant_id = ? AND is_active = 1 AND stock_on_hand <= reorder_level
     ORDER BY stock_on_hand ASC LIMIT 25`,
  ).bind(task.tenantId).all();

  const byWarehouse = await db.prepare(
    `SELECT warehouse, COUNT(*) as sku_count, SUM(stock_on_hand * cost_price) as inventory_value
     FROM erp_products
     WHERE tenant_id = ? AND is_active = 1
     GROUP BY warehouse`,
  ).bind(task.tenantId).all();

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
    timestamp: new Date().toISOString(),
  };
}

const logisticsHandler: CatalystHandler = {
  name: 'domain:logistics',
  match: t => {
    const s = taskText(t);
    return anyOf(s, 'logistics', 'fleet', 'delivery', 'warehouse', 'transport', 'shipping');
  },
  execute: async (task, db) => {
    const s = taskText(task);
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
