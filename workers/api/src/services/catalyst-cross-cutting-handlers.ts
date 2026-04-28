/**
 * Cross-cutting catalyst handlers — sub-catalysts that fire across every
 * customer regardless of vertical:
 *
 *   - HR Payroll Audit          (ghost employees / terminated-on-payroll)
 *   - Compliance Risk           (open compliance risks + audit gap detection)
 *   - Data Quality Score        (master-data completeness + duplicates)
 *   - Customer Experience NPS   (NPS / CSAT signal + churn proxy)
 *   - Operational KPI Anomaly   (anomalies × red metrics intersect)
 *   - Vendor Master Cleanup     (duplicate / dormant / banking-detail gaps)
 *
 * Each handler queries existing canonical tables (erp_*, process_metrics,
 * anomalies, risk_alerts, audit_log) and returns
 *   { type, evidence fields, recommendation, scopedToCompany, timestamp }
 * — the same shape as the operational/commercial/service/general handlers.
 *
 * Registered ahead of the catalog-aware default so they win when their
 * keywords match.
 */

import { type CatalystHandler, registerHandler } from './catalyst-handler-registry';
import { taskText, anyWord as anyOf, allWords, companyFilter, scopeLabel } from './catalyst-match-utils';
import type { TaskDefinition } from './catalyst-engine';

function round2(n: number): number {
  return Math.round((n || 0) * 100) / 100;
}

// ── HR PAYROLL AUDIT ────────────────────────────────────────────────────

async function runPayrollAudit(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  // Ghost: terminated employees still showing as 'active', or active rows with
  // a termination_date in the past. Both are payroll-fraud red flags.
  const ghosts = await db.prepare(
    `SELECT id, employee_number, first_name, last_name, department, gross_salary, termination_date, status
     FROM erp_employees
     WHERE tenant_id = ?
       AND (
         (status = 'active' AND termination_date IS NOT NULL AND termination_date <= date('now'))
         OR (status = 'terminated' AND gross_salary > 0)
       )${clause}
     ORDER BY gross_salary DESC LIMIT 25`,
  ).bind(task.tenantId, ...params).all();

  const totalActive = await db.prepare(
    `SELECT COUNT(*) AS c, COALESCE(SUM(gross_salary), 0) AS payroll
     FROM erp_employees
     WHERE tenant_id = ? AND status = 'active'${clause}`,
  ).bind(task.tenantId, ...params).first<{ c: number; payroll: number }>();

  const ghostExposure = ghosts.results.reduce((s, r) => s + ((r as { gross_salary: number }).gross_salary || 0), 0);
  return {
    type: 'cross:payroll_audit',
    activeHeadcount: totalActive?.c || 0,
    monthlyPayroll: round2(totalActive?.payroll || 0),
    ghostCount: ghosts.results.length,
    ghostMonthlyExposure: round2(ghostExposure),
    ghostEmployees: ghosts.results,
    recommendation: ghosts.results.length > 0
      ? `${ghosts.results.length} payroll discrepancy(ies) detected with R${Math.round(ghostExposure).toLocaleString()}/mo exposure — freeze affected payroll runs and reconcile with HR records`
      : 'No ghost-employee or terminated-on-payroll signals — payroll roster matches HR status',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

const payrollAuditHandler: CatalystHandler = {
  name: 'cross:payroll-audit',
  match: t => {
    const s = taskText(t);
    return allWords(s, 'payroll', 'audit')
      || anyOf(s, 'ghost-employee', 'ghost employees', 'payroll-audit', 'payroll fraud');
  },
  execute: runPayrollAudit,
};

// ── COMPLIANCE RISK ─────────────────────────────────────────────────────

async function runComplianceRisk(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  // risk_alerts is tenant-scoped only.
  const bySeverity = await db.prepare(
    `SELECT severity, COUNT(*) AS count, COALESCE(SUM(impact_value), 0) AS impact
     FROM risk_alerts
     WHERE tenant_id = ? AND status = 'active'
       AND (
         LOWER(category) LIKE '%compli%' OR LOWER(category) LIKE '%popia%'
         OR LOWER(category) LIKE '%regul%' OR LOWER(category) LIKE '%audit%'
         OR LOWER(category) LIKE '%legal%' OR LOWER(category) LIKE '%hpcsa%'
       )
     GROUP BY severity ORDER BY severity DESC`,
  ).bind(task.tenantId).all();

  const top = await db.prepare(
    `SELECT title, description, severity, impact_value, detected_at
     FROM risk_alerts
     WHERE tenant_id = ? AND status = 'active'
       AND (
         LOWER(category) LIKE '%compli%' OR LOWER(category) LIKE '%popia%'
         OR LOWER(category) LIKE '%regul%' OR LOWER(category) LIKE '%audit%'
         OR LOWER(category) LIKE '%legal%'
       )
     ORDER BY impact_value DESC LIMIT 10`,
  ).bind(task.tenantId).all();

  const auditFreshness = await db.prepare(
    `SELECT COUNT(*) AS c, MAX(created_at) AS last_event
     FROM audit_log WHERE tenant_id = ? AND created_at >= datetime('now', '-30 days')`,
  ).bind(task.tenantId).first<{ c: number; last_event: string | null }>();

  const totalImpact = bySeverity.results.reduce((s, r) => s + ((r as { impact: number }).impact || 0), 0);
  const totalRisks = bySeverity.results.reduce((s, r) => s + ((r as { count: number }).count || 0), 0);
  const auditEvents = auditFreshness?.c || 0;
  return {
    type: 'cross:compliance_risk',
    activeRiskCount: totalRisks,
    totalImpactExposure: round2(totalImpact),
    severityBreakdown: bySeverity.results,
    topRisks: top.results,
    auditEventsLast30d: auditEvents,
    auditEventLastSeen: auditFreshness?.last_event,
    recommendation: totalRisks > 0
      ? `${totalRisks} active compliance risk(s) totalling R${Math.round(totalImpact).toLocaleString()} — assign owners against top exposures`
      : auditEvents === 0
        ? 'No active compliance risks but no audit events in last 30 days — verify event-capture pipeline is healthy'
        : 'Compliance posture clean across active risks and audit log',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

const complianceRiskHandler: CatalystHandler = {
  name: 'cross:compliance-risk',
  match: t => {
    const s = taskText(t);
    return (anyOf(s, 'compliance', 'regulatory', 'popia', 'gdpr') && anyOf(s, 'risk', 'audit', 'gap', 'review'))
      || anyOf(s, 'compliance-risk', 'regulatory-risk');
  },
  execute: runComplianceRisk,
};

// ── DATA QUALITY SCORE ──────────────────────────────────────────────────

async function runDataQualityScore(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  // Customer master completeness
  const customerStats = await db.prepare(
    `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN customer_group IS NULL OR customer_group = '' THEN 1 ELSE 0 END) AS missing_group,
        SUM(CASE WHEN credit_limit IS NULL OR credit_limit <= 0 THEN 1 ELSE 0 END) AS missing_limit
     FROM erp_customers
     WHERE tenant_id = ?${clause}`,
  ).bind(task.tenantId, ...params).first<{ total: number; missing_group: number; missing_limit: number }>();

  // Supplier master completeness
  const supplierStats = await db.prepare(
    `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN risk_score IS NULL THEN 1 ELSE 0 END) AS missing_risk,
        SUM(CASE WHEN country IS NULL OR country = '' THEN 1 ELSE 0 END) AS missing_country
     FROM erp_suppliers
     WHERE tenant_id = ?${clause}`,
  ).bind(task.tenantId, ...params).first<{ total: number; missing_risk: number; missing_country: number }>();

  // Product master completeness
  const productStats = await db.prepare(
    `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN reorder_level IS NULL OR reorder_level <= 0 THEN 1 ELSE 0 END) AS missing_reorder,
        SUM(CASE WHEN cost_price IS NULL OR cost_price <= 0 THEN 1 ELSE 0 END) AS missing_cost
     FROM erp_products
     WHERE tenant_id = ? AND is_active = 1${clause}`,
  ).bind(task.tenantId, ...params).first<{ total: number; missing_reorder: number; missing_cost: number }>();

  function pct(missing: number, total: number): number {
    if (!total) return 0;
    return round2(((total - missing) / total) * 100);
  }

  const customerScore = pct((customerStats?.missing_group || 0) + (customerStats?.missing_limit || 0),
                            (customerStats?.total || 0) * 2);
  const supplierScore = pct((supplierStats?.missing_risk || 0) + (supplierStats?.missing_country || 0),
                            (supplierStats?.total || 0) * 2);
  const productScore = pct((productStats?.missing_reorder || 0) + (productStats?.missing_cost || 0),
                           (productStats?.total || 0) * 2);

  const totals = [customerScore, supplierScore, productScore].filter(s => s > 0);
  const overall = totals.length > 0 ? round2(totals.reduce((a, b) => a + b, 0) / totals.length) : 0;
  const weakest = Math.min(customerScore || 100, supplierScore || 100, productScore || 100);

  return {
    type: 'cross:data_quality_score',
    overallScore: overall,
    customerMasterScore: customerScore,
    supplierMasterScore: supplierScore,
    productMasterScore: productScore,
    customerStats,
    supplierStats,
    productStats,
    recommendation: overall < 80
      ? `Overall master-data score ${overall}% (weakest domain: ${weakest}%) — schedule master-data cleanup sprint`
      : 'Master-data quality healthy across customer/supplier/product domains',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

const dataQualityHandler: CatalystHandler = {
  name: 'cross:data-quality',
  match: t => {
    const s = taskText(t);
    return allWords(s, 'data', 'quality')
      || anyOf(s, 'master-data', 'data-quality', 'data hygiene')
      || (anyOf(s, 'master') && anyOf(s, 'data', 'cleanup', 'completeness'));
  },
  execute: runDataQualityScore,
};

// ── CUSTOMER EXPERIENCE NPS ─────────────────────────────────────────────

async function runCustomerExperience(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  // NPS / CSAT live in process_metrics if the tenant feeds them. We surface
  // the latest signals + a churn proxy from erp_customers (inactive ratio).
  // process_metrics is tenant-scoped only.
  const cxMetrics = await db.prepare(
    `SELECT name, value, unit, status, measured_at
     FROM process_metrics
     WHERE tenant_id = ?
       AND (
         LOWER(name) LIKE '%nps%' OR LOWER(name) LIKE '%csat%'
         OR LOWER(name) LIKE '%customer satisfaction%' OR LOWER(name) LIKE '%customer effort%'
       )
     ORDER BY measured_at DESC LIMIT 10`,
  ).bind(task.tenantId).all();

  const { clause, params } = companyFilter(task.companyId);
  const churn = await db.prepare(
    `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) AS inactive,
        SUM(CASE WHEN status = 'active' AND credit_balance >= credit_limit THEN 1 ELSE 0 END) AS at_risk
     FROM erp_customers
     WHERE tenant_id = ?${clause}`,
  ).bind(task.tenantId, ...params).first<{ total: number; inactive: number; at_risk: number }>();

  const churnRate = (churn?.total || 0) > 0
    ? Math.round(((churn?.inactive || 0) / (churn!.total)) * 1000) / 10
    : 0;
  const latestNps = cxMetrics.results.find(r =>
    ((r as { name: string }).name || '').toLowerCase().includes('nps'),
  ) as { value: number; status: string } | undefined;

  const ratingNarrative = latestNps
    ? `Latest NPS ${latestNps.value}${latestNps.status === 'red' ? ' (red)' : ''}`
    : 'No NPS/CSAT metric captured';

  return {
    type: 'cross:customer_experience',
    churnRatePct: churnRate,
    activeCustomers: (churn?.total || 0) - (churn?.inactive || 0),
    inactiveCustomers: churn?.inactive || 0,
    atRiskCustomers: churn?.at_risk || 0,
    npsCsatMetrics: cxMetrics.results,
    latestNpsValue: latestNps?.value ?? null,
    recommendation: latestNps?.status === 'red'
      ? `${ratingNarrative} — schedule voice-of-customer review and route detractors to retention`
      : churnRate > 10
        ? `Churn rate ${churnRate}% above 10% threshold — launch retention diagnostic`
        : (churn?.at_risk || 0) > 0
          ? `${churn?.at_risk} customer(s) at credit-limit ceiling — proactively contact account owners`
          : `${ratingNarrative} — customer base posture stable`,
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

const customerExperienceHandler: CatalystHandler = {
  name: 'cross:customer-experience',
  match: t => {
    const s = taskText(t);
    return anyOf(s, 'nps', 'csat', 'customer-experience', 'customer experience', 'voice-of-customer', 'voc')
      || (anyOf(s, 'customer') && anyOf(s, 'satisfaction', 'experience', 'sentiment'));
  },
  execute: runCustomerExperience,
};

// ── OPERATIONAL KPI ANOMALY ─────────────────────────────────────────────

async function runOpKpiAnomaly(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  // Intersect open anomalies with currently-red metrics — that's the
  // intersection set that's actually moving (and noticed). Tenant-scoped.
  const anomalies = await db.prepare(
    `SELECT id, metric, severity, expected_value, actual_value, deviation, hypothesis, detected_at
     FROM anomalies
     WHERE tenant_id = ? AND status = 'open'
     ORDER BY severity DESC, deviation DESC LIMIT 15`,
  ).bind(task.tenantId).all();

  const redMetrics = await db.prepare(
    `SELECT name, value, unit, status, source_system, measured_at
     FROM process_metrics
     WHERE tenant_id = ? AND status = 'red'
     ORDER BY measured_at DESC LIMIT 15`,
  ).bind(task.tenantId).all();

  // Naive intersection: anomaly.metric ≈ metric.name (case-insensitive overlap).
  const redNames = new Set(
    redMetrics.results.map(r => ((r as { name: string }).name || '').toLowerCase()),
  );
  const intersect = anomalies.results.filter(a => {
    const m = ((a as { metric: string }).metric || '').toLowerCase();
    for (const n of redNames) {
      if (n && (n.includes(m) || m.includes(n))) return true;
    }
    return false;
  });

  const critical = anomalies.results.filter(a => {
    const sev = (a as { severity: string }).severity;
    return sev === 'critical' || sev === 'high';
  });

  return {
    type: 'cross:op_kpi_anomaly',
    openAnomalies: anomalies.results.length,
    redMetricCount: redMetrics.results.length,
    intersection: intersect.length,
    criticalOrHigh: critical.length,
    anomalies: anomalies.results,
    redMetrics: redMetrics.results,
    intersectionItems: intersect,
    recommendation: intersect.length > 0
      ? `${intersect.length} KPI(s) showing both an anomaly AND a red status — start root-cause from these first`
      : critical.length > 0
        ? `${critical.length} critical/high anomalies open — assign owners`
        : redMetrics.results.length > 0
          ? `${redMetrics.results.length} red metric(s) but no open anomalies — verify anomaly detector is running`
          : 'No KPI anomalies or red metrics — operational telemetry quiet',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

const opKpiAnomalyHandler: CatalystHandler = {
  name: 'cross:op-kpi-anomaly',
  match: t => {
    const s = taskText(t);
    return (anyOf(s, 'kpi', 'metric', 'metrics') && anyOf(s, 'anomaly', 'anomalies', 'deviation', 'breach'))
      || anyOf(s, 'kpi-anomaly', 'metric-anomaly', 'operational anomaly');
  },
  execute: runOpKpiAnomaly,
};

// ── VENDOR MASTER CLEANUP ───────────────────────────────────────────────

async function runVendorMasterCleanup(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  // Duplicate detection by lowercased name across the same tenant. SQLite
  // doesn't support full string normalisation but lowercase trim catches the
  // common "Acme Inc" / "acme inc " case.
  const dupes = await db.prepare(
    `SELECT LOWER(TRIM(name)) AS norm_name, COUNT(*) AS dup_count
     FROM erp_suppliers
     WHERE tenant_id = ?${clause}
     GROUP BY norm_name
     HAVING dup_count > 1
     ORDER BY dup_count DESC LIMIT 25`,
  ).bind(task.tenantId, ...params).all();

  const dormant = await db.prepare(
    `SELECT s.id, s.name, s.risk_score
     FROM erp_suppliers s
     WHERE s.tenant_id = ? AND s.status = 'active'${clause}
       AND NOT EXISTS (
         SELECT 1 FROM erp_purchase_orders po
         WHERE po.supplier_id = s.id AND po.tenant_id = s.tenant_id
           AND po.order_date >= date('now', '-365 days')
       )
     LIMIT 50`,
  ).bind(task.tenantId, ...params).all();

  const incomplete = await db.prepare(
    `SELECT id, name, country
     FROM erp_suppliers
     WHERE tenant_id = ? AND status = 'active'
       AND (country IS NULL OR country = '' OR risk_score IS NULL)${clause}
     LIMIT 25`,
  ).bind(task.tenantId, ...params).all();

  const totals = await db.prepare(
    `SELECT COUNT(*) AS active FROM erp_suppliers WHERE tenant_id = ? AND status = 'active'${clause}`,
  ).bind(task.tenantId, ...params).first<{ active: number }>();

  const dupCount = dupes.results.length;
  const dormantCount = dormant.results.length;
  const incompleteCount = incomplete.results.length;

  return {
    type: 'cross:vendor_master_cleanup',
    activeSuppliers: totals?.active || 0,
    duplicateGroupCount: dupCount,
    dormantSuppliers: dormantCount,
    incompleteSuppliers: incompleteCount,
    duplicates: dupes.results,
    dormant: dormant.results,
    incomplete: incomplete.results,
    recommendation: dupCount > 0
      ? `${dupCount} duplicate supplier group(s) — merge masters and re-route POs to surviving record`
      : dormantCount > 0
        ? `${dormantCount} active supplier(s) without orders in last 12 months — deactivate or confirm relationship`
        : incompleteCount > 0
          ? `${incompleteCount} active supplier(s) missing country/risk-score — complete master record`
          : 'Vendor master clean — no duplicates, dormants or incompletes',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

const vendorMasterHandler: CatalystHandler = {
  name: 'cross:vendor-master',
  match: t => {
    const s = taskText(t);
    return (anyOf(s, 'vendor', 'supplier') && anyOf(s, 'cleanup', 'master', 'duplicate', 'dormant'))
      || anyOf(s, 'vendor-master', 'supplier-master');
  },
  execute: runVendorMasterCleanup,
};

// ── Registration ────────────────────────────────────────────────────────

export function registerCrossCuttingHandlers(): void {
  registerHandler(payrollAuditHandler);
  registerHandler(complianceRiskHandler);
  // Vendor master is registered BEFORE data quality because
  // "vendor master cleanup" would otherwise match the broader data-quality
  // matcher first ("master" + "cleanup" → data quality).
  registerHandler(vendorMasterHandler);
  registerHandler(dataQualityHandler);
  registerHandler(customerExperienceHandler);
  registerHandler(opKpiAnomalyHandler);
}

registerCrossCuttingHandlers();
