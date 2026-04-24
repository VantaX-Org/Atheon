/**
 * General / cross-cutting catalyst handlers: HR turnover, sales pipeline,
 * operations red-metrics. These are generic enterprise catalysts that apply
 * across industries.
 */

import {
  type CatalystHandler,
  registerHandler,
} from './catalyst-handler-registry';
import { taskText, anyWord as anyOf } from './catalyst-match-utils';
import type { TaskDefinition } from './catalyst-engine';

// ── HR TURNOVER ─────────────────────────────────────────────────────────

async function runHRTurnover(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const departuresLast90 = await db.prepare(
    `SELECT first_name, last_name, department, position, hire_date, termination_date
     FROM erp_employees
     WHERE tenant_id = ? AND termination_date IS NOT NULL
       AND termination_date >= date('now', '-90 days')
     ORDER BY termination_date DESC LIMIT 50`,
  ).bind(task.tenantId).all();

  const headcountByDept = await db.prepare(
    `SELECT department, COUNT(*) as active_count,
            SUM(CASE WHEN termination_date >= date('now', '-90 days') THEN 1 ELSE 0 END) as departed_90d
     FROM erp_employees
     WHERE tenant_id = ? AND department IS NOT NULL
     GROUP BY department`,
  ).bind(task.tenantId).all();

  const turnoverByDept = headcountByDept.results.map(r => {
    const row = r as { department: string; active_count: number; departed_90d: number };
    const rate = row.active_count > 0 ? (row.departed_90d / row.active_count) * 100 : 0;
    return {
      department: row.department,
      activeHeadcount: row.active_count,
      departures90d: row.departed_90d,
      turnoverPct: Math.round(rate * 10) / 10,
    };
  }).sort((a, b) => b.turnoverPct - a.turnoverPct);

  const highTurnover = turnoverByDept.filter(d => d.turnoverPct > 15);

  return {
    type: 'hr_turnover',
    window: 'last_90_days',
    totalDepartures: departuresLast90.results.length,
    byDepartment: turnoverByDept,
    highTurnoverDepartments: highTurnover,
    recommendation: highTurnover.length > 0
      ? `${highTurnover.length} department(s) with >15% quarterly turnover — launch retention review`
      : 'Turnover within expected range across departments',
    timestamp: new Date().toISOString(),
  };
}

const hrHandler: CatalystHandler = {
  name: 'general:hr',
  match: t => {
    const s = taskText(t);
    return anyOf(s, 'hr', 'turnover', 'attrition', 'retention', 'workforce', 'headcount', 'people');
  },
  execute: runHRTurnover,
};

// ── SALES PIPELINE ──────────────────────────────────────────────────────

async function runSalesPipelineRisk(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const risks = await db.prepare(
    `SELECT title, description, severity, category, probability, impact_value, detected_at
     FROM risk_alerts
     WHERE tenant_id = ? AND status = 'active'
       AND (LOWER(category) LIKE '%sales%' OR LOWER(category) LIKE '%revenue%'
            OR LOWER(category) LIKE '%pipeline%' OR LOWER(category) LIKE '%opportunity%')
     ORDER BY impact_value DESC LIMIT 15`,
  ).bind(task.tenantId).all();

  const anomalies = await db.prepare(
    `SELECT metric, severity, expected_value, actual_value, deviation, detected_at
     FROM anomalies
     WHERE tenant_id = ? AND status = 'open'
       AND (LOWER(metric) LIKE '%sales%' OR LOWER(metric) LIKE '%revenue%' OR LOWER(metric) LIKE '%pipeline%' OR LOWER(metric) LIKE '%conversion%')
     ORDER BY deviation DESC LIMIT 10`,
  ).bind(task.tenantId).all();

  const totalRiskImpact = risks.results.reduce((s, r) => s + ((r as { impact_value: number }).impact_value || 0), 0);

  return {
    type: 'sales_pipeline_risk',
    openRisks: risks.results.length,
    openAnomalies: anomalies.results.length,
    totalRiskImpact: Math.round(totalRiskImpact * 100) / 100,
    risks: risks.results,
    anomalies: anomalies.results,
    recommendation: risks.results.length > 0
      ? `${risks.results.length} sales/revenue risk(s) with R${Math.round(totalRiskImpact).toLocaleString()} at stake — review in weekly sales review`
      : 'No active sales pipeline risks',
    timestamp: new Date().toISOString(),
  };
}

const salesHandler: CatalystHandler = {
  name: 'general:sales',
  match: t => {
    const s = taskText(t);
    return (anyOf(s, 'sales') && anyOf(s, 'pipeline', 'risk', 'opportunity', 'conversion'))
      || anyOf(s, 'revenue risk');
  },
  execute: runSalesPipelineRisk,
};

// ── OPERATIONS RED METRICS ──────────────────────────────────────────────

async function runOperationsRedMetrics(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const red = await db.prepare(
    `SELECT name, value, unit, threshold_red, source_system, measured_at
     FROM process_metrics
     WHERE tenant_id = ? AND status = 'red'
     ORDER BY measured_at DESC LIMIT 30`,
  ).bind(task.tenantId).all();

  const amber = await db.prepare(
    `SELECT COUNT(*) as count FROM process_metrics WHERE tenant_id = ? AND status = 'amber'`,
  ).bind(task.tenantId).first<{ count: number }>();

  const green = await db.prepare(
    `SELECT COUNT(*) as count FROM process_metrics WHERE tenant_id = ? AND status = 'green'`,
  ).bind(task.tenantId).first<{ count: number }>();

  const bySource = red.results.reduce((acc: Record<string, number>, r) => {
    const row = r as { source_system: string };
    const src = row.source_system || 'unknown';
    acc[src] = (acc[src] || 0) + 1;
    return acc;
  }, {});

  return {
    type: 'operations_red_metrics',
    red: red.results.length,
    amber: amber?.count || 0,
    green: green?.count || 0,
    byCategory: Object.entries(bySource).map(([source, count]) => ({ source, count })),
    metrics: red.results,
    recommendation: red.results.length > 0
      ? `${red.results.length} metric(s) currently red — assign owners for top 5 by recency`
      : 'All operational metrics green/amber — healthy posture',
    timestamp: new Date().toISOString(),
  };
}

const opsHandler: CatalystHandler = {
  name: 'general:operations',
  match: t => {
    const s = taskText(t);
    return (anyOf(s, 'operations', 'ops') && anyOf(s, 'red', 'metric', 'bottleneck'))
      || anyOf(s, 'red metrics', 'traffic light', 'rag status');
  },
  execute: runOperationsRedMetrics,
};

// ── SUPPLIER CONCENTRATION ─────────────────────────────────────────────

async function runSupplierConcentration(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const byVolume = await db.prepare(
    `SELECT s.name, s.risk_score, s.supplier_group,
            COUNT(po.id) as po_count,
            COALESCE(SUM(po.total), 0) as total_spend
     FROM erp_suppliers s
     LEFT JOIN erp_purchase_orders po ON po.supplier_id = s.id AND po.tenant_id = s.tenant_id AND po.status != 'cancelled'
     WHERE s.tenant_id = ? AND s.status = 'active'
     GROUP BY s.id, s.name, s.risk_score, s.supplier_group
     ORDER BY total_spend DESC LIMIT 25`,
  ).bind(task.tenantId).all();

  const totalSpend = byVolume.results.reduce((s, r) => s + ((r as { total_spend: number }).total_spend || 0), 0);
  const top5Spend = byVolume.results.slice(0, 5).reduce((s, r) => s + ((r as { total_spend: number }).total_spend || 0), 0);
  const concentration = totalSpend > 0 ? (top5Spend / totalSpend) * 100 : 0;
  const risky = byVolume.results.filter(r => {
    const row = r as { risk_score: number; total_spend: number };
    return (row.risk_score || 0) > 0.6 && (row.total_spend || 0) > 0;
  });

  return {
    type: 'general_supplier_concentration',
    supplierCount: byVolume.results.length,
    totalSpend: Math.round(totalSpend * 100) / 100,
    top5ConcentrationPct: Math.round(concentration * 10) / 10,
    riskySuppliersWithSpend: risky.length,
    suppliers: byVolume.results,
    recommendation: concentration > 70
      ? `Top 5 suppliers hold ${Math.round(concentration)}% of spend — single-point-of-failure risk; diversify sourcing`
      : risky.length > 0
        ? `${risky.length} high-risk supplier(s) with active spend — add contingency or secondary source`
        : byVolume.results.length === 0
          ? 'No supplier activity'
          : 'Supplier spend diversified within policy',
    timestamp: new Date().toISOString(),
  };
}

const supplierHandler: CatalystHandler = {
  name: 'general:supplier',
  match: t => {
    const s = taskText(t);
    return (anyOf(s, 'supplier') && anyOf(s, 'concentration', 'consolidation', 'diversification'))
      || anyOf(s, 'supplier concentration', 'vendor concentration');
  },
  execute: runSupplierConcentration,
};

// ── ANOMALY TRIAGE ─────────────────────────────────────────────────────

async function runAnomalyTriage(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const bySeverity = await db.prepare(
    `SELECT severity, status, COUNT(*) as count, AVG(deviation) as avg_deviation
     FROM anomalies
     WHERE tenant_id = ?
     GROUP BY severity, status
     ORDER BY severity DESC`,
  ).bind(task.tenantId).all();

  const staleOpen = await db.prepare(
    `SELECT metric, severity, deviation, detected_at
     FROM anomalies
     WHERE tenant_id = ? AND status = 'open' AND detected_at < datetime('now', '-14 days')
     ORDER BY severity DESC, detected_at ASC LIMIT 15`,
  ).bind(task.tenantId).all();

  const criticalOpen = await db.prepare(
    `SELECT COUNT(*) as count FROM anomalies
     WHERE tenant_id = ? AND status = 'open' AND severity IN ('critical', 'high')`,
  ).bind(task.tenantId).first<{ count: number }>();

  return {
    type: 'general_anomaly_triage',
    openCriticalOrHigh: criticalOpen?.count || 0,
    staleOpen: staleOpen.results.length,
    bySeverityStatus: bySeverity.results,
    staleItems: staleOpen.results,
    recommendation: (criticalOpen?.count || 0) > 0
      ? `${criticalOpen?.count} critical/high anomalies open — triage in next standup`
      : staleOpen.results.length > 0
        ? `${staleOpen.results.length} open anomaly(ies) older than 14 days — resolve or downgrade`
        : 'Anomaly backlog healthy',
    timestamp: new Date().toISOString(),
  };
}

const anomalyHandler: CatalystHandler = {
  name: 'general:anomaly-triage',
  match: t => {
    const s = taskText(t);
    return (anyOf(s, 'anomaly', 'anomalies') && anyOf(s, 'triage', 'backlog', 'review', 'scan'));
  },
  execute: runAnomalyTriage,
};

// ── Registration ────────────────────────────────────────────────────────

export function registerGeneralHandlers(): void {
  registerHandler(hrHandler);
  registerHandler(salesHandler);
  registerHandler(opsHandler);
  registerHandler(supplierHandler);
  registerHandler(anomalyHandler);
}

registerGeneralHandlers();
