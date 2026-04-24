/**
 * Service domain catalyst handlers: healthcare, technology, financial services.
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

// ── HEALTHCARE ──────────────────────────────────────────────────────────

async function runHealthcareStaffingCoverage(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const byDept = await db.prepare(
    `SELECT department, position, COUNT(*) as active_count,
            SUM(CASE WHEN status != 'active' THEN 1 ELSE 0 END) as inactive_count,
            AVG(gross_salary) as avg_salary
     FROM erp_employees
     WHERE tenant_id = ? AND department IS NOT NULL
     GROUP BY department, position
     ORDER BY active_count ASC`,
  ).bind(task.tenantId).all();

  const shortStaffed = byDept.results.filter(r => {
    const row = r as { active_count: number };
    return (row.active_count || 0) < 3;
  });

  const recentDepartures = await db.prepare(
    `SELECT first_name, last_name, department, position, termination_date
     FROM erp_employees
     WHERE tenant_id = ? AND termination_date IS NOT NULL
       AND termination_date >= date('now', '-60 days')
     ORDER BY termination_date DESC LIMIT 10`,
  ).bind(task.tenantId).all();

  return {
    type: 'healthcare_staffing_coverage',
    departmentPositions: byDept.results.length,
    shortStaffedLines: shortStaffed.length,
    shortStaffed,
    recentDeparturesLast60Days: recentDepartures.results.length,
    recentDepartures: recentDepartures.results,
    recommendation: shortStaffed.length > 0
      ? `${shortStaffed.length} department/position line(s) with <3 active staff — review recruitment pipeline and agency cover`
      : 'Staffing coverage adequate across departments',
    timestamp: new Date().toISOString(),
  };
}

async function runHealthcareOverdueCollections(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  // In the healthcare domain model, erp_customers stand in for patients/payers.
  const overdue = await db.prepare(
    `SELECT invoice_number, customer_name, invoice_date, due_date, total, amount_due
     FROM erp_invoices
     WHERE tenant_id = ? AND payment_status IN ('unpaid', 'partial')
       AND due_date IS NOT NULL AND due_date < date('now')
     ORDER BY due_date ASC LIMIT 30`,
  ).bind(task.tenantId).all();

  const summary = await db.prepare(
    `SELECT payment_status, COUNT(*) as count, SUM(amount_due) as total_due
     FROM erp_invoices
     WHERE tenant_id = ? AND payment_status IN ('unpaid', 'partial')
     GROUP BY payment_status`,
  ).bind(task.tenantId).all();

  const totalOverdueValue = overdue.results.reduce((s, r) => s + ((r as { amount_due: number }).amount_due || 0), 0);

  return {
    type: 'healthcare_overdue_collections',
    overdueInvoices: overdue.results.length,
    totalOverdueValue: Math.round(totalOverdueValue * 100) / 100,
    summary: summary.results,
    topOverdue: overdue.results.slice(0, 10),
    recommendation: overdue.results.length > 0
      ? `${overdue.results.length} overdue payer invoice(s) totalling R${Math.round(totalOverdueValue).toLocaleString()} — initiate staged collection workflow`
      : 'No overdue payer invoices',
    timestamp: new Date().toISOString(),
  };
}

async function runHealthcareComplianceRiskScan(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const risks = await db.prepare(
    `SELECT title, description, severity, category, impact_value, recommended_actions, detected_at
     FROM risk_alerts
     WHERE tenant_id = ? AND status = 'active'
       AND (LOWER(category) LIKE '%compliance%' OR LOWER(category) LIKE '%clinical%'
            OR LOWER(category) LIKE '%regulatory%' OR LOWER(category) LIKE '%popia%'
            OR LOWER(category) LIKE '%ndoh%' OR LOWER(category) LIKE '%privacy%')
     ORDER BY impact_value DESC LIMIT 15`,
  ).bind(task.tenantId).all();

  const anomalies = await db.prepare(
    `SELECT metric, severity, hypothesis, detected_at
     FROM anomalies
     WHERE tenant_id = ? AND status = 'open'
       AND (LOWER(metric) LIKE '%compliance%' OR LOWER(metric) LIKE '%audit%' OR LOWER(metric) LIKE '%consent%')
     ORDER BY detected_at DESC LIMIT 10`,
  ).bind(task.tenantId).all();

  const impactTotal = risks.results.reduce((s, r) => s + ((r as { impact_value: number }).impact_value || 0), 0);

  return {
    type: 'healthcare_compliance_risk_scan',
    activeRisks: risks.results.length,
    openAnomalies: anomalies.results.length,
    totalImpactValue: Math.round(impactTotal * 100) / 100,
    risks: risks.results,
    anomalies: anomalies.results,
    recommendation: risks.results.length > 0
      ? `${risks.results.length} active compliance risk(s) with total impact R${Math.round(impactTotal).toLocaleString()} — schedule compliance review`
      : 'No active compliance risks detected',
    timestamp: new Date().toISOString(),
  };
}

const healthcareHandler: CatalystHandler = {
  name: 'domain:healthcare',
  match: t => {
    const s = taskText(t);
    return anyOf(s, 'healthcare', 'clinical', 'patient', 'hospital', 'ndoh')
      || (anyOf(s, 'staffing') && anyOf(s, 'coverage', 'rotation'));
  },
  execute: async (task, db) => {
    const s = taskText(task);
    if (anyOf(s, 'compliance', 'clinical audit', 'popia', 'ndoh', 'privacy', 'regulatory')) return runHealthcareComplianceRiskScan(task, db);
    if (anyOf(s, 'collection', 'overdue', 'payer', 'receivable', 'billing')) return runHealthcareOverdueCollections(task, db);
    return runHealthcareStaffingCoverage(task, db);
  },
};

// ── TECHNOLOGY ──────────────────────────────────────────────────────────

async function runTechnologyIncidentTrend(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const anomalies = await db.prepare(
    `SELECT metric, severity, expected_value, actual_value, deviation, hypothesis, detected_at
     FROM anomalies
     WHERE tenant_id = ? AND status = 'open'
       AND (LOWER(metric) LIKE '%latency%' OR LOWER(metric) LIKE '%error%' OR LOWER(metric) LIKE '%uptime%'
            OR LOWER(metric) LIKE '%availability%' OR LOWER(metric) LIKE '%p95%' OR LOWER(metric) LIKE '%slo%')
     ORDER BY detected_at DESC LIMIT 15`,
  ).bind(task.tenantId).all();

  const critical = anomalies.results.filter(a => ['critical', 'high'].includes((a as { severity: string }).severity));

  return {
    type: 'technology_incident_trend',
    openAnomalies: anomalies.results.length,
    critical: critical.length,
    anomalies: anomalies.results,
    recommendation: critical.length > 0
      ? `${critical.length} critical/high-severity technology anomalies open — page on-call and open incident`
      : anomalies.results.length > 0
        ? `${anomalies.results.length} open technology anomalies — review during next standup`
        : 'No open technology anomalies',
    timestamp: new Date().toISOString(),
  };
}

async function runTechnologySecurityAlerts(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const risks = await db.prepare(
    `SELECT title, description, severity, category, impact_value, detected_at
     FROM risk_alerts
     WHERE tenant_id = ? AND status = 'active'
       AND (LOWER(category) LIKE '%security%' OR LOWER(category) LIKE '%vuln%'
            OR LOWER(category) LIKE '%cve%' OR LOWER(category) LIKE '%breach%' OR LOWER(category) LIKE '%threat%')
     ORDER BY
       CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       impact_value DESC LIMIT 20`,
  ).bind(task.tenantId).all();

  const critical = risks.results.filter(r => (r as { severity: string }).severity === 'critical');

  return {
    type: 'technology_security_alerts',
    activeAlerts: risks.results.length,
    critical: critical.length,
    alerts: risks.results,
    recommendation: critical.length > 0
      ? `${critical.length} critical security alert(s) — remediate within 24h per policy`
      : risks.results.length > 0
        ? `${risks.results.length} security alert(s) open — review and prioritise`
        : 'No active security alerts',
    timestamp: new Date().toISOString(),
  };
}

async function runTechnologyChurnSignal(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const inactive = await db.prepare(
    `SELECT name, customer_group, status, credit_limit, credit_balance
     FROM erp_customers
     WHERE tenant_id = ? AND (status IN ('inactive', 'churned', 'suspended')
       OR (credit_limit > 0 AND credit_balance > credit_limit))
     ORDER BY credit_balance DESC LIMIT 25`,
  ).bind(task.tenantId).all();

  const recentlyInactive = inactive.results.filter(c => (c as { status: string }).status === 'inactive');
  const creditExceeded = inactive.results.filter(c => {
    const row = c as { credit_limit: number; credit_balance: number };
    return (row.credit_limit || 0) > 0 && (row.credit_balance || 0) > (row.credit_limit || 0);
  });

  return {
    type: 'technology_churn_signal',
    inactiveAccounts: recentlyInactive.length,
    creditExceededAccounts: creditExceeded.length,
    flagged: inactive.results,
    recommendation: inactive.results.length > 0
      ? `${inactive.results.length} account(s) flagged for churn risk — trigger customer success outreach`
      : 'No churn-risk signals detected',
    timestamp: new Date().toISOString(),
  };
}

const technologyHandler: CatalystHandler = {
  name: 'domain:technology',
  match: t => {
    const s = taskText(t);
    return anyOf(s, 'technology', 'devops', 'sre', 'software', 'product')
      || (anyOf(s, 'security') && anyOf(s, 'alert', 'vuln', 'cve'))
      || (anyOf(s, 'customer') && anyOf(s, 'churn', 'retention'));
  },
  execute: async (task, db) => {
    const s = taskText(task);
    if (anyOf(s, 'security', 'vuln', 'cve', 'breach', 'threat')) return runTechnologySecurityAlerts(task, db);
    if (anyOf(s, 'churn', 'retention', 'customer success')) return runTechnologyChurnSignal(task, db);
    return runTechnologyIncidentTrend(task, db);
  },
};

// ── FINANCIAL SERVICES ──────────────────────────────────────────────────

async function runFinServPortfolioRisk(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const byCategory = await db.prepare(
    `SELECT category, COUNT(*) as alert_count,
            AVG(probability) as avg_probability,
            SUM(impact_value) as total_impact
     FROM risk_alerts
     WHERE tenant_id = ? AND status = 'active'
     GROUP BY category
     ORDER BY total_impact DESC LIMIT 15`,
  ).bind(task.tenantId).all();

  const top = await db.prepare(
    `SELECT title, severity, category, probability, impact_value, detected_at
     FROM risk_alerts
     WHERE tenant_id = ? AND status = 'active'
     ORDER BY impact_value DESC LIMIT 10`,
  ).bind(task.tenantId).all();

  const totalExposure = byCategory.results.reduce((s, r) => s + ((r as { total_impact: number }).total_impact || 0), 0);

  return {
    type: 'finserv_portfolio_risk',
    categoryCount: byCategory.results.length,
    totalActiveExposure: Math.round(totalExposure * 100) / 100,
    byCategory: byCategory.results,
    topRisks: top.results,
    recommendation: totalExposure > 0
      ? `Aggregate active risk exposure R${Math.round(totalExposure).toLocaleString()} across ${byCategory.results.length} categor(ies) — review risk appetite`
      : 'No active portfolio risk',
    timestamp: new Date().toISOString(),
  };
}

async function runFinServCreditExposure(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const exposure = await db.prepare(
    `SELECT COUNT(*) as customer_count,
            SUM(credit_limit) as total_limit,
            SUM(credit_balance) as total_outstanding
     FROM erp_customers
     WHERE tenant_id = ? AND status = 'active'`,
  ).bind(task.tenantId).first<{ customer_count: number; total_limit: number; total_outstanding: number }>();

  const overLimit = await db.prepare(
    `SELECT name, customer_group, credit_limit, credit_balance,
            ROUND((credit_balance / NULLIF(credit_limit, 0)) * 100, 1) as utilization_pct
     FROM erp_customers
     WHERE tenant_id = ? AND status = 'active' AND credit_limit > 0 AND credit_balance > credit_limit
     ORDER BY (credit_balance / NULLIF(credit_limit, 0)) DESC LIMIT 15`,
  ).bind(task.tenantId).all();

  const totalLimit = exposure?.total_limit || 0;
  const totalOutstanding = exposure?.total_outstanding || 0;
  const utilization = totalLimit > 0 ? (totalOutstanding / totalLimit) * 100 : 0;

  return {
    type: 'finserv_credit_exposure',
    activeCustomers: exposure?.customer_count || 0,
    totalCreditLimit: Math.round(totalLimit * 100) / 100,
    totalOutstanding: Math.round(totalOutstanding * 100) / 100,
    utilizationPct: Math.round(utilization * 10) / 10,
    overLimitCustomers: overLimit.results.length,
    overLimitDetails: overLimit.results,
    recommendation: overLimit.results.length > 0
      ? `${overLimit.results.length} customer(s) over credit limit — escalate to credit committee`
      : utilization > 80
        ? `Portfolio utilization at ${Math.round(utilization)}% — close to capacity, review limits`
        : `Portfolio utilization at ${Math.round(utilization)}% — within target`,
    timestamp: new Date().toISOString(),
  };
}

async function runFinServRegulatorySnapshot(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const recentAudit = await db.prepare(
    `SELECT action, COUNT(*) as count
     FROM audit_log
     WHERE tenant_id = ? AND created_at >= datetime('now', '-30 days')
       AND (LOWER(action) LIKE '%compliance%' OR LOWER(action) LIKE '%popia%'
            OR LOWER(action) LIKE '%data_export%' OR LOWER(action) LIKE '%erasure%'
            OR LOWER(action) LIKE '%consent%' OR LOWER(action) LIKE '%audit%')
     GROUP BY action
     ORDER BY count DESC`,
  ).bind(task.tenantId).all();

  const openCompliance = await db.prepare(
    `SELECT title, severity, category, detected_at FROM risk_alerts
     WHERE tenant_id = ? AND status = 'active'
       AND (LOWER(category) LIKE '%regulatory%' OR LOWER(category) LIKE '%compliance%')
     ORDER BY detected_at DESC LIMIT 10`,
  ).bind(task.tenantId).all();

  return {
    type: 'finserv_regulatory_snapshot',
    window: 'last_30_days',
    complianceActionCounts: recentAudit.results,
    openComplianceRisks: openCompliance.results.length,
    risks: openCompliance.results,
    recommendation: openCompliance.results.length > 0
      ? `${openCompliance.results.length} open regulatory risk(s) — escalate to compliance committee`
      : 'No open regulatory risks; audit trail continuous',
    timestamp: new Date().toISOString(),
  };
}

const finServHandler: CatalystHandler = {
  name: 'domain:financial-services',
  match: t => {
    const s = taskText(t);
    return anyOf(s, 'finserv', 'financial-services', 'banking', 'insurance', 'portfolio')
      || (anyOf(s, 'credit') && anyOf(s, 'exposure', 'limit', 'utilization'))
      || (anyOf(s, 'regulatory') && anyOf(s, 'snapshot', 'report'));
  },
  execute: async (task, db) => {
    const s = taskText(task);
    if (anyOf(s, 'credit', 'exposure', 'limit', 'utilization')) return runFinServCreditExposure(task, db);
    if (anyOf(s, 'regulatory', 'snapshot', 'audit trail')) return runFinServRegulatorySnapshot(task, db);
    return runFinServPortfolioRisk(task, db);
  },
};

// ── Registration ────────────────────────────────────────────────────────

export function registerServiceHandlers(): void {
  registerHandler(healthcareHandler);
  registerHandler(technologyHandler);
  registerHandler(finServHandler);
}

registerServiceHandlers();
