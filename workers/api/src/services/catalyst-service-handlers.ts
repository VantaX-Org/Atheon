/**
 * Service domain catalyst handlers: healthcare, technology, financial services.
 * See catalyst-operational-handlers.ts for the pattern.
 */

import {
  type CatalystHandler,
  registerHandler,
} from './catalyst-handler-registry';
import { taskText, anyWord as anyOf, companyFilter, scopeLabel } from './catalyst-match-utils';
import type { TaskDefinition } from './catalyst-engine';

// ── HEALTHCARE ──────────────────────────────────────────────────────────

async function runHealthcareStaffingCoverage(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  const byDept = await db.prepare(
    `SELECT department, position, COUNT(*) as active_count,
            SUM(CASE WHEN status != 'active' THEN 1 ELSE 0 END) as inactive_count,
            AVG(gross_salary) as avg_salary
     FROM erp_employees
     WHERE tenant_id = ? AND department IS NOT NULL${clause}
     GROUP BY department, position
     ORDER BY active_count ASC`,
  ).bind(task.tenantId, ...params).all();

  const shortStaffed = byDept.results.filter(r => {
    const row = r as { active_count: number };
    return (row.active_count || 0) < 3;
  });

  const recentDepartures = await db.prepare(
    `SELECT first_name, last_name, department, position, termination_date
     FROM erp_employees
     WHERE tenant_id = ? AND termination_date IS NOT NULL
       AND termination_date >= date('now', '-60 days')${clause}
     ORDER BY termination_date DESC LIMIT 10`,
  ).bind(task.tenantId, ...params).all();

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
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

async function runHealthcareOverdueCollections(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  // In the healthcare domain model, erp_customers stand in for patients/payers.
  const { clause, params } = companyFilter(task.companyId);
  const overdue = await db.prepare(
    `SELECT invoice_number, customer_name, invoice_date, due_date, total, amount_due
     FROM erp_invoices
     WHERE tenant_id = ? AND payment_status IN ('unpaid', 'partial')
       AND due_date IS NOT NULL AND due_date < date('now')${clause}
     ORDER BY due_date ASC LIMIT 30`,
  ).bind(task.tenantId, ...params).all();

  const summary = await db.prepare(
    `SELECT payment_status, COUNT(*) as count, SUM(amount_due) as total_due
     FROM erp_invoices
     WHERE tenant_id = ? AND payment_status IN ('unpaid', 'partial')${clause}
     GROUP BY payment_status`,
  ).bind(task.tenantId, ...params).all();

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
    scopedToCompany: scopeLabel(task.companyId),
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
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

async function runHealthcareReadmissionFlag(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const anomalies = await db.prepare(
    `SELECT metric, severity, expected_value, actual_value, deviation, hypothesis, detected_at
     FROM anomalies
     WHERE tenant_id = ? AND status = 'open'
       AND (LOWER(metric) LIKE '%readmission%' OR LOWER(metric) LIKE '%bounce%' OR LOWER(metric) LIKE '%return visit%' OR LOWER(metric) LIKE '%30-day%')
     ORDER BY deviation DESC LIMIT 15`,
  ).bind(task.tenantId).all();

  const metrics = await db.prepare(
    `SELECT name, value, unit, status, threshold_red FROM process_metrics
     WHERE tenant_id = ? AND (LOWER(name) LIKE '%readmission%' OR LOWER(name) LIKE '%30-day%')
     ORDER BY measured_at DESC LIMIT 10`,
  ).bind(task.tenantId).all();

  const breaches = metrics.results.filter(m => (m as { status: string }).status === 'red');

  return {
    type: 'healthcare_readmission_flag',
    openAnomalies: anomalies.results.length,
    redMetrics: breaches.length,
    anomalies: anomalies.results,
    metrics: metrics.results,
    recommendation: anomalies.results.length > 0 || breaches.length > 0
      ? `${anomalies.results.length + breaches.length} readmission signal(s) elevated — trigger case-management review for affected service lines`
      : metrics.results.length === 0
        ? 'No readmission metrics ingested — wire up encounter/episode data'
        : 'Readmission rates within target',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

async function runHealthcareSupplyShortages(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  const critical = await db.prepare(
    `SELECT sku, name, category, stock_on_hand, reorder_level, warehouse
     FROM erp_products
     WHERE tenant_id = ? AND is_active = 1
       AND (LOWER(category) LIKE '%med%' OR LOWER(category) LIKE '%pharma%' OR LOWER(category) LIKE '%consumable%'
            OR LOWER(category) LIKE '%ppe%' OR LOWER(category) LIKE '%surgical%' OR LOWER(category) LIKE '%diagnostic%'
            OR LOWER(category) LIKE '%dressing%' OR LOWER(category) LIKE '%reagent%')
       AND (stock_on_hand <= 0 OR stock_on_hand < reorder_level * 0.25)${clause}
     ORDER BY stock_on_hand ASC LIMIT 40`,
  ).bind(task.tenantId, ...params).all();

  const byCategory = await db.prepare(
    `SELECT category, COUNT(*) as count
     FROM erp_products
     WHERE tenant_id = ? AND is_active = 1
       AND (LOWER(category) LIKE '%med%' OR LOWER(category) LIKE '%consumable%' OR LOWER(category) LIKE '%ppe%')
       AND stock_on_hand < reorder_level * 0.25${clause}
     GROUP BY category ORDER BY count DESC`,
  ).bind(task.tenantId, ...params).all();

  return {
    type: 'healthcare_supply_shortages',
    criticalSupplies: critical.results.length,
    items: critical.results,
    byCategory: byCategory.results,
    recommendation: critical.results.length > 0
      ? `${critical.results.length} clinical supply(ies) critically low — escalate to procurement for same-day reorder`
      : 'Clinical supply levels adequate',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

const healthcareHandler: CatalystHandler = {
  name: 'domain:healthcare',
  match: t => {
    const s = taskText(t);
    return anyOf(s, 'healthcare', 'clinical', 'patient', 'hospital', 'ndoh', 'readmission')
      || (anyOf(s, 'staffing') && anyOf(s, 'coverage', 'rotation'))
      || (anyOf(s, 'supply', 'supplies') && anyOf(s, 'shortage', 'shortages', 'clinical', 'medical'));
  },
  execute: async (task, db) => {
    const s = taskText(task);
    if (anyOf(s, 'readmission', 'bounce', '30-day')) return runHealthcareReadmissionFlag(task, db);
    if (anyOf(s, 'supply', 'supplies', 'shortage', 'shortages') && anyOf(s, 'clinical', 'medical', 'healthcare', 'supply'))
      return runHealthcareSupplyShortages(task, db);
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
    scopedToCompany: scopeLabel(task.companyId),
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
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

async function runTechnologyChurnSignal(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  const inactive = await db.prepare(
    `SELECT name, customer_group, status, credit_limit, credit_balance
     FROM erp_customers
     WHERE tenant_id = ? AND (status IN ('inactive', 'churned', 'suspended')
       OR (credit_limit > 0 AND credit_balance > credit_limit))${clause}
     ORDER BY credit_balance DESC LIMIT 25`,
  ).bind(task.tenantId, ...params).all();

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
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

async function runTechnologySLOCompliance(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const metrics = await db.prepare(
    `SELECT name, value, unit, status, threshold_green, threshold_amber, threshold_red, measured_at
     FROM process_metrics
     WHERE tenant_id = ?
       AND (LOWER(name) LIKE '%slo%' OR LOWER(name) LIKE '%sla%' OR LOWER(name) LIKE '%uptime%' OR LOWER(name) LIKE '%availability%' OR LOWER(name) LIKE '%p95%' OR LOWER(name) LIKE '%p99%')
     ORDER BY measured_at DESC LIMIT 20`,
  ).bind(task.tenantId).all();

  const breaches = metrics.results.filter(m => (m as { status: string }).status === 'red');
  const warning = metrics.results.filter(m => (m as { status: string }).status === 'amber');

  return {
    type: 'technology_slo_compliance',
    metricCount: metrics.results.length,
    burning: breaches.length,
    warning: warning.length,
    metrics: metrics.results,
    recommendation: breaches.length > 0
      ? `${breaches.length} SLO/SLA metric(s) burning — declare incident and freeze non-critical deploys`
      : warning.length > 0
        ? `${warning.length} SLO/SLA metric(s) amber — review error budget before next deploy`
        : 'SLO/SLA compliance on target',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

async function runTechnologyFeatureAdoption(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const metrics = await db.prepare(
    `SELECT id, name, value, unit, status, measured_at FROM process_metrics
     WHERE tenant_id = ?
       AND (LOWER(name) LIKE '%adoption%' OR LOWER(name) LIKE '%activation%' OR LOWER(name) LIKE '%dau%' OR LOWER(name) LIKE '%mau%' OR LOWER(name) LIKE '%feature%')
     ORDER BY measured_at DESC LIMIT 20`,
  ).bind(task.tenantId).all();

  const trends: Record<string, unknown>[] = [];
  for (const m of metrics.results) {
    const metric = m as { id: string; name: string; value: number };
    const history = await db.prepare(
      `SELECT value FROM process_metric_history
       WHERE tenant_id = ? AND metric_id = ?
       ORDER BY recorded_at DESC LIMIT 8`,
    ).bind(task.tenantId, metric.id).all();
    const values = history.results.map(h => (h as { value: number }).value || 0);
    if (values.length < 2) {
      trends.push({ metric: metric.name, currentValue: metric.value, note: 'insufficient history' });
      continue;
    }
    const first = values[values.length - 1];
    const last = values[0];
    const changePct = first !== 0 ? ((last - first) / first) * 100 : 0;
    trends.push({
      metric: metric.name,
      currentValue: metric.value,
      trendPct: Math.round(changePct * 10) / 10,
      sampleSize: values.length,
    });
  }

  const stagnant = trends.filter(t => typeof t.trendPct === 'number' && (t.trendPct as number) < 1);

  return {
    type: 'technology_feature_adoption',
    metricsAnalysed: trends.length,
    stagnant: stagnant.length,
    trends,
    recommendation: stagnant.length > 0
      ? `${stagnant.length} adoption metric(s) flat/declining — review onboarding and in-product nudges`
      : trends.length === 0
        ? 'No adoption metrics ingested — instrument DAU/MAU/feature-flag metrics'
        : 'Adoption metrics trending positive',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

const technologyHandler: CatalystHandler = {
  name: 'domain:technology',
  match: t => {
    const s = taskText(t);
    return anyOf(s, 'technology', 'devops', 'sre', 'software', 'product', 'slo', 'sla', 'uptime', 'adoption')
      || (anyOf(s, 'security') && anyOf(s, 'alert', 'vuln', 'cve'))
      || (anyOf(s, 'customer') && anyOf(s, 'churn', 'retention'));
  },
  execute: async (task, db) => {
    const s = taskText(task);
    if (anyOf(s, 'slo', 'sla', 'uptime', 'availability')) return runTechnologySLOCompliance(task, db);
    if (anyOf(s, 'adoption', 'activation', 'dau', 'mau', 'feature adoption')) return runTechnologyFeatureAdoption(task, db);
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
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

async function runFinServCreditExposure(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  const exposure = await db.prepare(
    `SELECT COUNT(*) as customer_count,
            SUM(credit_limit) as total_limit,
            SUM(credit_balance) as total_outstanding
     FROM erp_customers
     WHERE tenant_id = ? AND status = 'active'${clause}`,
  ).bind(task.tenantId, ...params).first<{ customer_count: number; total_limit: number; total_outstanding: number }>();

  const overLimit = await db.prepare(
    `SELECT name, customer_group, credit_limit, credit_balance,
            ROUND((credit_balance / NULLIF(credit_limit, 0)) * 100, 1) as utilization_pct
     FROM erp_customers
     WHERE tenant_id = ? AND status = 'active' AND credit_limit > 0 AND credit_balance > credit_limit${clause}
     ORDER BY (credit_balance / NULLIF(credit_limit, 0)) DESC LIMIT 15`,
  ).bind(task.tenantId, ...params).all();

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
    scopedToCompany: scopeLabel(task.companyId),
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
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

async function runFinServCashFlowForecast(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  const buckets = await db.prepare(
    `SELECT
       SUM(CASE WHEN due_date <= date('now', '+30 days') THEN amount_due ELSE 0 END) as due_30d,
       SUM(CASE WHEN due_date > date('now', '+30 days') AND due_date <= date('now', '+60 days') THEN amount_due ELSE 0 END) as due_31_60d,
       SUM(CASE WHEN due_date > date('now', '+60 days') AND due_date <= date('now', '+90 days') THEN amount_due ELSE 0 END) as due_61_90d,
       SUM(CASE WHEN due_date > date('now', '+90 days') THEN amount_due ELSE 0 END) as due_90_plus,
       SUM(CASE WHEN due_date < date('now') THEN amount_due ELSE 0 END) as overdue
     FROM erp_invoices
     WHERE tenant_id = ? AND payment_status IN ('unpaid', 'partial')${clause}`,
  ).bind(task.tenantId, ...params).first<{
    due_30d: number; due_31_60d: number; due_61_90d: number; due_90_plus: number; overdue: number;
  }>();

  const next30 = buckets?.due_30d || 0;
  const overdue = buckets?.overdue || 0;

  return {
    type: 'finserv_cash_flow_forecast',
    overdueReceivable: Math.round(overdue * 100) / 100,
    next30Days: Math.round(next30 * 100) / 100,
    next31To60Days: Math.round((buckets?.due_31_60d || 0) * 100) / 100,
    next61To90Days: Math.round((buckets?.due_61_90d || 0) * 100) / 100,
    beyond90Days: Math.round((buckets?.due_90_plus || 0) * 100) / 100,
    recommendation: overdue > next30
      ? `Overdue (R${Math.round(overdue).toLocaleString()}) exceeds next-30d expected inflows — accelerate collections`
      : next30 > 0
        ? `R${Math.round(next30).toLocaleString()} due in next 30 days — prepare treasury disbursement plan`
        : 'No material near-term receivables',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

async function runFinServConcentrationRisk(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  const custCompanyClause = clause.replace(' AND company_id', ' AND c.company_id');
  const byGroup = await db.prepare(
    `SELECT c.customer_group,
            COUNT(DISTINCT c.id) as customer_count,
            COALESCE(SUM(i.total), 0) as total_revenue
     FROM erp_customers c
     LEFT JOIN erp_invoices i ON i.customer_id = c.id AND i.tenant_id = c.tenant_id AND i.status != 'cancelled'
     WHERE c.tenant_id = ? AND c.status = 'active'${custCompanyClause}
     GROUP BY c.customer_group
     ORDER BY total_revenue DESC`,
  ).bind(task.tenantId, ...params).all();

  const totalRevenue = byGroup.results.reduce((s, r) => s + ((r as { total_revenue: number }).total_revenue || 0), 0);
  const groups = byGroup.results.map(r => {
    const row = r as { customer_group: string; customer_count: number; total_revenue: number };
    const pct = totalRevenue > 0 ? (row.total_revenue / totalRevenue) * 100 : 0;
    return {
      group: row.customer_group,
      customers: row.customer_count,
      revenue: Math.round((row.total_revenue || 0) * 100) / 100,
      sharePct: Math.round(pct * 10) / 10,
    };
  });

  const dominant = groups.filter(g => g.sharePct > 40);

  return {
    type: 'finserv_concentration_risk',
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    groupCount: groups.length,
    dominantSegments: dominant.length,
    groups,
    recommendation: dominant.length > 0
      ? `${dominant.length} customer segment(s) exceed 40% revenue share — concentration risk elevated, diversify`
      : totalRevenue === 0
        ? 'No invoice revenue to analyse'
        : 'Customer concentration within policy',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

const finServHandler: CatalystHandler = {
  name: 'domain:financial-services',
  match: t => {
    const s = taskText(t);
    return anyOf(s, 'finserv', 'financial-services', 'banking', 'insurance', 'portfolio')
      || (anyOf(s, 'credit') && anyOf(s, 'exposure', 'limit', 'utilization'))
      || (anyOf(s, 'regulatory') && anyOf(s, 'snapshot', 'report'))
      || (anyOf(s, 'cash') && anyOf(s, 'flow', 'forecast'))
      || (anyOf(s, 'concentration') && anyOf(s, 'risk', 'segment'));
  },
  execute: async (task, db) => {
    const s = taskText(task);
    if (anyOf(s, 'cash') && anyOf(s, 'flow', 'forecast')) return runFinServCashFlowForecast(task, db);
    if (anyOf(s, 'concentration', 'diversification')) return runFinServConcentrationRisk(task, db);
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
