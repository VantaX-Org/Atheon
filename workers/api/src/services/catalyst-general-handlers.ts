/**
 * General / cross-cutting catalyst handlers: HR turnover, sales pipeline,
 * operations red-metrics. These are generic enterprise catalysts that apply
 * across industries.
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
    // 'hr' excluded — 2-char substring false-positives on words like
    // "chrome", "three". Rely on the longer, more specific keywords.
    return anyOf(s, 'turnover', 'attrition', 'retention', 'workforce', 'headcount', 'human resources', 'hr_');
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

// ── Registration ────────────────────────────────────────────────────────

export function registerGeneralHandlers(): void {
  registerHandler(hrHandler);
  registerHandler(salesHandler);
  registerHandler(opsHandler);
}

registerGeneralHandlers();
