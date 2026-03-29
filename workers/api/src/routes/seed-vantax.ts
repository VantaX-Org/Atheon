/**
 * VantaX Demo Data Seeder
 * Comprehensive seed covering 6 catalyst clusters, 18 sub-catalysts,
 * 36 runs (positive + negative), KPI definitions, process metrics,
 * risk alerts, anomalies, process flows, correlations, health scores,
 * executive briefings, catalyst_insights, and health_score_history.
 *
 * RESTRICTED: VantaX (Pty) Ltd demo environment only
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AuthContext, AppBindings } from '../types';

const seed = new Hono<AppBindings>();
seed.use('/*', cors());

async function getVantaXTenantId(c: any): Promise<string | null> {
  const auth = c.get('auth') as AuthContext | undefined;
  const allowedRoles = ['superadmin', 'support_admin', 'admin', 'executive'];
  if (!auth || !allowedRoles.includes(auth.role)) return null;
  const row = await c.env.DB.prepare("SELECT id FROM tenants WHERE slug = 'vantax'").first() as { id: string } | null;
  return row?.id || null;
}

// -- Cluster / Sub-catalyst definitions --

interface ClusterDef { name: string; domain: string; description: string; subs: SubDef[] }
interface SubDef {
  name: string; mode: string; description: string;
  pos: { items: number; matched: number; disc: number; exc: number; conf: number; value: number };
  neg: { items: number; matched: number; disc: number; exc: number; conf: number; value: number; issue: string };
  kpis: KpiDef[];
}
interface KpiDef { name: string; category: string; unit: string; direction: string; value: number; status: string; tg: number; ta: number; tr: number }

const CLUSTERS: ClusterDef[] = [
  {
    name: 'Finance', domain: 'finance', description: 'Financial reconciliation & AP/AR',
    subs: [
      {
        name: 'GR/IR Reconciliation', mode: 'reconciliation', description: 'Goods Receipt vs Invoice Receipt matching',
        pos: { items: 150, matched: 150, disc: 0, exc: 0, conf: 98.5, value: 1250000 },
        neg: { items: 200, matched: 165, disc: 25, exc: 10, conf: 72.3, value: 1850000, issue: 'Price variances > 10%' },
        kpis: [
          { name: 'Match Rate', category: 'financial', unit: '%', direction: 'higher_is_better', value: 82.5, status: 'amber', tg: 95, ta: 80, tr: 60 },
          { name: 'Discrepancy Value', category: 'financial', unit: 'ZAR', direction: 'lower_is_better', value: 185000, status: 'red', tg: 50000, ta: 100000, tr: 200000 },
          { name: 'Processing Time', category: 'operational', unit: 's', direction: 'lower_is_better', value: 45, status: 'green', tg: 60, ta: 90, tr: 120 },
        ],
      },
      {
        name: 'AP Validation', mode: 'validation', description: 'Accounts Payable invoice validation & duplicate detection',
        pos: { items: 200, matched: 200, disc: 0, exc: 0, conf: 99.2, value: 890000 },
        neg: { items: 180, matched: 140, disc: 30, exc: 10, conf: 68.5, value: 920000, issue: 'Duplicate invoices detected' },
        kpis: [
          { name: 'Duplicate Rate', category: 'compliance', unit: '%', direction: 'lower_is_better', value: 3.8, status: 'amber', tg: 1, ta: 5, tr: 10 },
          { name: 'Validation Accuracy', category: 'financial', unit: '%', direction: 'higher_is_better', value: 77.8, status: 'amber', tg: 95, ta: 80, tr: 60 },
          { name: 'Invoice Cycle Time', category: 'operational', unit: 'days', direction: 'lower_is_better', value: 3.2, status: 'green', tg: 5, ta: 7, tr: 14 },
        ],
      },
      {
        name: 'Bank Reconciliation', mode: 'reconciliation', description: 'Bank statement to GL reconciliation',
        pos: { items: 85, matched: 85, disc: 0, exc: 0, conf: 97.8, value: 2100000 },
        neg: { items: 120, matched: 95, disc: 18, exc: 7, conf: 74.1, value: 2800000, issue: 'Unreconciled items > 5 days' },
        kpis: [
          { name: 'Reconciliation Rate', category: 'financial', unit: '%', direction: 'higher_is_better', value: 79.2, status: 'amber', tg: 98, ta: 85, tr: 70 },
          { name: 'Outstanding Items Age', category: 'compliance', unit: 'days', direction: 'lower_is_better', value: 6.5, status: 'red', tg: 3, ta: 5, tr: 7 },
        ],
      },
    ],
  },
  {
    name: 'Supply Chain', domain: 'operations', description: 'Supply chain operations',
    subs: [
      {
        name: 'Inventory Count', mode: 'comparison', description: 'Physical vs system inventory count reconciliation',
        pos: { items: 500, matched: 500, disc: 0, exc: 0, conf: 96.5, value: 3500000 },
        neg: { items: 600, matched: 480, disc: 85, exc: 35, conf: 65.2, value: 4200000, issue: 'Stock variance > 15%' },
        kpis: [
          { name: 'Inventory Accuracy', category: 'operational', unit: '%', direction: 'higher_is_better', value: 78.3, status: 'amber', tg: 95, ta: 85, tr: 70 },
          { name: 'Shrinkage Rate', category: 'financial', unit: '%', direction: 'lower_is_better', value: 5.8, status: 'red', tg: 1, ta: 3, tr: 5 },
          { name: 'Count Cycle Time', category: 'operational', unit: 'hours', direction: 'lower_is_better', value: 4.2, status: 'green', tg: 6, ta: 8, tr: 12 },
        ],
      },
      {
        name: 'PO Matching', mode: 'reconciliation', description: 'Purchase order to goods receipt to invoice 3-way match',
        pos: { items: 120, matched: 120, disc: 0, exc: 0, conf: 98.1, value: 675000 },
        neg: { items: 150, matched: 110, disc: 28, exc: 12, conf: 70.8, value: 780000, issue: 'Unmatched POs past 30 days' },
        kpis: [
          { name: 'PO Match Rate', category: 'operational', unit: '%', direction: 'higher_is_better', value: 73.3, status: 'red', tg: 95, ta: 80, tr: 70 },
          { name: 'PO Cycle Time', category: 'operational', unit: 'days', direction: 'lower_is_better', value: 4.2, status: 'green', tg: 5, ta: 7, tr: 14 },
        ],
      },
      {
        name: 'Goods Receipt Validation', mode: 'validation', description: 'Goods receipt quality and quantity validation',
        pos: { items: 300, matched: 300, disc: 0, exc: 0, conf: 97.3, value: 1800000 },
        neg: { items: 350, matched: 290, disc: 42, exc: 18, conf: 69.4, value: 2100000, issue: 'Quantity variances on 12% of receipts' },
        kpis: [
          { name: 'Receipt Accuracy', category: 'operational', unit: '%', direction: 'higher_is_better', value: 82.9, status: 'amber', tg: 95, ta: 85, tr: 70 },
          { name: 'Quality Rejection Rate', category: 'compliance', unit: '%', direction: 'lower_is_better', value: 5.1, status: 'amber', tg: 2, ta: 5, tr: 10 },
        ],
      },
    ],
  },
  {
    name: 'Sales & Revenue', domain: 'revenue', description: 'Revenue cycle & sales operations',
    subs: [
      {
        name: 'Revenue Recognition', mode: 'validation', description: 'Revenue recognition compliance (IFRS 15)',
        pos: { items: 80, matched: 80, disc: 0, exc: 0, conf: 99.1, value: 5200000 },
        neg: { items: 95, matched: 70, disc: 18, exc: 7, conf: 71.5, value: 6100000, issue: 'Timing differences in 26.3% of contracts' },
        kpis: [
          { name: 'Revenue Recognition Accuracy', category: 'financial', unit: '%', direction: 'higher_is_better', value: 73.7, status: 'red', tg: 98, ta: 90, tr: 80 },
          { name: 'Deferred Revenue Age', category: 'compliance', unit: 'days', direction: 'lower_is_better', value: 42, status: 'amber', tg: 30, ta: 45, tr: 60 },
        ],
      },
      {
        name: 'Sales Order Matching', mode: 'reconciliation', description: 'Sales order to delivery to invoice matching',
        pos: { items: 250, matched: 250, disc: 0, exc: 0, conf: 97.6, value: 3800000 },
        neg: { items: 280, matched: 220, disc: 40, exc: 20, conf: 72.8, value: 4500000, issue: 'Pricing discrepancies on 14.3% of orders' },
        kpis: [
          { name: 'Order Match Rate', category: 'financial', unit: '%', direction: 'higher_is_better', value: 78.6, status: 'amber', tg: 95, ta: 80, tr: 65 },
          { name: 'Order-to-Cash Cycle', category: 'operational', unit: 'days', direction: 'lower_is_better', value: 28, status: 'amber', tg: 20, ta: 30, tr: 45 },
        ],
      },
      {
        name: 'Commission Calculation', mode: 'extract', description: 'Sales commission extraction and validation',
        pos: { items: 60, matched: 60, disc: 0, exc: 0, conf: 98.8, value: 450000 },
        neg: { items: 75, matched: 55, disc: 15, exc: 5, conf: 73.2, value: 620000, issue: 'Commission tier mismatch' },
        kpis: [
          { name: 'Commission Accuracy', category: 'financial', unit: '%', direction: 'higher_is_better', value: 73.3, status: 'red', tg: 98, ta: 90, tr: 80 },
        ],
      },
    ],
  },
  {
    name: 'HR & Payroll', domain: 'hr', description: 'Human resources & payroll operations',
    subs: [
      {
        name: 'Payroll Reconciliation', mode: 'reconciliation', description: 'Payroll run vs bank payment reconciliation',
        pos: { items: 350, matched: 350, disc: 0, exc: 0, conf: 99.5, value: 8500000 },
        neg: { items: 380, matched: 340, disc: 30, exc: 10, conf: 82.1, value: 9200000, issue: 'Overtime calculation errors' },
        kpis: [
          { name: 'Payroll Accuracy', category: 'compliance', unit: '%', direction: 'higher_is_better', value: 89.5, status: 'amber', tg: 99, ta: 95, tr: 90 },
          { name: 'Payroll Processing Time', category: 'operational', unit: 'hours', direction: 'lower_is_better', value: 3.5, status: 'green', tg: 4, ta: 8, tr: 12 },
        ],
      },
      {
        name: 'Leave Balance Audit', mode: 'validation', description: 'Leave balance validation and accrual accuracy',
        pos: { items: 350, matched: 350, disc: 0, exc: 0, conf: 98.2, value: 0 },
        neg: { items: 380, matched: 330, disc: 40, exc: 10, conf: 76.3, value: 0, issue: 'Accrual miscalculations in 10.5% of records' },
        kpis: [
          { name: 'Leave Accrual Accuracy', category: 'compliance', unit: '%', direction: 'higher_is_better', value: 86.8, status: 'amber', tg: 99, ta: 90, tr: 80 },
        ],
      },
      {
        name: 'Headcount Variance', mode: 'comparison', description: 'Budgeted vs actual headcount analysis',
        pos: { items: 50, matched: 50, disc: 0, exc: 0, conf: 97.0, value: 0 },
        neg: { items: 55, matched: 42, disc: 10, exc: 3, conf: 78.5, value: 0, issue: 'Unfilled positions > 60 days' },
        kpis: [
          { name: 'Headcount Variance', category: 'strategic', unit: '%', direction: 'lower_is_better', value: 8.2, status: 'amber', tg: 3, ta: 8, tr: 15 },
          { name: 'Time to Fill', category: 'operational', unit: 'days', direction: 'lower_is_better', value: 45, status: 'amber', tg: 30, ta: 45, tr: 60 },
        ],
      },
    ],
  },
  {
    name: 'Compliance & Audit', domain: 'health-compliance', description: 'Regulatory compliance & internal audit',
    subs: [
      {
        name: 'Tax Compliance Check', mode: 'validation', description: 'VAT/income tax filing compliance validation',
        pos: { items: 100, matched: 100, disc: 0, exc: 0, conf: 99.0, value: 3200000 },
        neg: { items: 120, matched: 98, disc: 15, exc: 7, conf: 79.2, value: 3800000, issue: 'Late filings and calculation errors' },
        kpis: [
          { name: 'Filing Compliance Rate', category: 'compliance', unit: '%', direction: 'higher_is_better', value: 81.7, status: 'amber', tg: 100, ta: 90, tr: 75 },
          { name: 'Tax Penalty Exposure', category: 'financial', unit: 'ZAR', direction: 'lower_is_better', value: 125000, status: 'red', tg: 0, ta: 50000, tr: 100000 },
        ],
      },
      {
        name: 'POPIA Data Audit', mode: 'validation', description: 'Personal data handling compliance audit',
        pos: { items: 200, matched: 200, disc: 0, exc: 0, conf: 98.5, value: 0 },
        neg: { items: 220, matched: 185, disc: 25, exc: 10, conf: 75.8, value: 0, issue: 'Consent records missing for 15.9%' },
        kpis: [
          { name: 'Data Compliance Score', category: 'compliance', unit: '%', direction: 'higher_is_better', value: 84.1, status: 'amber', tg: 98, ta: 90, tr: 80 },
          { name: 'Consent Coverage', category: 'compliance', unit: '%', direction: 'higher_is_better', value: 84.1, status: 'amber', tg: 100, ta: 90, tr: 80 },
        ],
      },
      {
        name: 'Internal Control Testing', mode: 'validation', description: 'SOX-style internal control effectiveness testing',
        pos: { items: 80, matched: 80, disc: 0, exc: 0, conf: 97.5, value: 0 },
        neg: { items: 90, matched: 68, disc: 15, exc: 7, conf: 71.2, value: 0, issue: 'Control failures in 24.4% of tests' },
        kpis: [
          { name: 'Control Effectiveness', category: 'compliance', unit: '%', direction: 'higher_is_better', value: 75.6, status: 'red', tg: 95, ta: 85, tr: 75 },
        ],
      },
    ],
  },
  {
    name: 'Technology & IT', domain: 'tech-devops', description: 'IT operations & system health',
    subs: [
      {
        name: 'System Uptime Audit', mode: 'validation', description: 'SLA compliance and uptime validation',
        pos: { items: 30, matched: 30, disc: 0, exc: 0, conf: 99.8, value: 0 },
        neg: { items: 35, matched: 28, disc: 5, exc: 2, conf: 82.5, value: 0, issue: 'SLA breaches on 3 critical systems' },
        kpis: [
          { name: 'System Uptime', category: 'technology', unit: '%', direction: 'higher_is_better', value: 99.2, status: 'green', tg: 99.5, ta: 99, tr: 98 },
          { name: 'SLA Compliance', category: 'technology', unit: '%', direction: 'higher_is_better', value: 80.0, status: 'amber', tg: 95, ta: 85, tr: 70 },
        ],
      },
      {
        name: 'License Compliance', mode: 'comparison', description: 'Software license usage vs entitlement audit',
        pos: { items: 50, matched: 50, disc: 0, exc: 0, conf: 98.0, value: 850000 },
        neg: { items: 55, matched: 42, disc: 10, exc: 3, conf: 75.5, value: 950000, issue: 'Over-deployment on 18.2% of licenses' },
        kpis: [
          { name: 'License Utilization', category: 'technology', unit: '%', direction: 'lower_is_better', value: 112, status: 'red', tg: 85, ta: 95, tr: 100 },
          { name: 'License Cost Variance', category: 'financial', unit: 'ZAR', direction: 'lower_is_better', value: 95000, status: 'amber', tg: 0, ta: 50000, tr: 100000 },
        ],
      },
      {
        name: 'Data Integration Health', mode: 'validation', description: 'ETL pipeline and data integration monitoring',
        pos: { items: 100, matched: 100, disc: 0, exc: 0, conf: 99.5, value: 0 },
        neg: { items: 110, matched: 90, disc: 15, exc: 5, conf: 78.2, value: 0, issue: 'Pipeline failures on 18.2% of jobs' },
        kpis: [
          { name: 'Pipeline Success Rate', category: 'technology', unit: '%', direction: 'higher_is_better', value: 81.8, status: 'amber', tg: 98, ta: 90, tr: 80 },
          { name: 'Data Freshness', category: 'technology', unit: 'hours', direction: 'lower_is_better', value: 2.5, status: 'green', tg: 4, ta: 8, tr: 24 },
        ],
      },
    ],
  },
];

// -- Static data for Pulse, Apex, and Dashboard --

const PROCESS_METRICS = [
  { name: 'Overall Match Rate', value: 79.4, unit: '%', status: 'amber', tg: 90, ta: 75, domain: 'finance' },
  { name: 'Exception Rate', value: 8.2, unit: '%', status: 'red', tg: 5, ta: 10, domain: 'finance' },
  { name: 'Avg Processing Time', value: 52, unit: 's', status: 'green', tg: 60, ta: 90, domain: 'operations' },
  { name: 'Inventory Accuracy', value: 78.3, unit: '%', status: 'amber', tg: 95, ta: 85, domain: 'operations' },
  { name: 'PO Cycle Time', value: 4.2, unit: 'days', status: 'green', tg: 5, ta: 7, domain: 'operations' },
  { name: 'Revenue Recognition Accuracy', value: 73.7, unit: '%', status: 'red', tg: 95, ta: 85, domain: 'revenue' },
  { name: 'Payroll Accuracy', value: 89.5, unit: '%', status: 'amber', tg: 99, ta: 95, domain: 'hr' },
  { name: 'Filing Compliance Rate', value: 81.7, unit: '%', status: 'amber', tg: 100, ta: 90, domain: 'health-compliance' },
  { name: 'System Uptime', value: 99.2, unit: '%', status: 'green', tg: 99.5, ta: 99, domain: 'tech-devops' },
  { name: 'Pipeline Success Rate', value: 81.8, unit: '%', status: 'amber', tg: 98, ta: 90, domain: 'tech-devops' },
];

const RISKS = [
  { title: 'High GR/IR Discrepancy Rate', severity: 'high', category: 'Financial', desc: '17.5% discrepancy rate exceeds 10% threshold - R185K at risk', prob: 0.75, impact: 185000 },
  { title: 'Inventory Shrinkage Detected', severity: 'critical', category: 'Operational', desc: '21.7% stock variance across 600 items - R4.2M exposure', prob: 0.85, impact: 500000 },
  { title: 'Revenue Recognition Delay', severity: 'high', category: 'Compliance', desc: '26.3% of contracts not recognized in correct period - IFRS 15 risk', prob: 0.70, impact: 350000 },
  { title: 'Duplicate Payment Risk', severity: 'medium', category: 'Financial', desc: 'AP validation detected duplicate invoices - R920K batch affected', prob: 0.55, impact: 75000 },
  { title: 'Tax Filing Non-Compliance', severity: 'high', category: 'Compliance', desc: 'Late filings and calculation errors - R125K penalty exposure', prob: 0.80, impact: 125000 },
  { title: 'POPIA Consent Gaps', severity: 'medium', category: 'Compliance', desc: '15.9% of personal data records missing consent - regulatory risk', prob: 0.60, impact: 200000 },
  { title: 'Software License Over-Deployment', severity: 'medium', category: 'Technology', desc: '18.2% of licenses exceed entitlement - R95K annual overspend', prob: 0.65, impact: 95000 },
];

const ANOMALIES = [
  { metric: 'GR/IR Match Rate', severity: 'high', expected: 95, actual: 82.5, deviation: 13.2, hyp: 'Price master data may be stale - last sync 72 hours ago' },
  { metric: 'Inventory Count Accuracy', severity: 'critical', expected: 95, actual: 78.3, deviation: 17.6, hyp: 'Warehouse zone C has systematic under-counting - likely scanner issues' },
  { metric: 'Revenue Recognition Compliance', severity: 'high', expected: 98, actual: 73.7, deviation: 24.8, hyp: 'New contract type not mapped in recognition rules - Q4 contracts affected' },
  { metric: 'PO Match Rate', severity: 'medium', expected: 95, actual: 73.3, deviation: 22.8, hyp: 'Supplier X changed PO format - automated matching rules need updating' },
];

const PROCESS_FLOWS = [
  { name: 'Procure-to-Pay', steps: ['Create PR', 'Approve PR', 'Create PO', 'Goods Receipt', 'Invoice Receipt', 'Payment'], variants: 8, avgDuration: 12.5, conformance: 72.3, bottlenecks: [{ step: 'Approve PR', avgWait: 3.2, unit: 'days' }, { step: 'Invoice Receipt', avgWait: 2.1, unit: 'days' }] },
  { name: 'Order-to-Cash', steps: ['Sales Order', 'Credit Check', 'Delivery', 'Goods Issue', 'Billing', 'Payment'], variants: 6, avgDuration: 28.0, conformance: 78.6, bottlenecks: [{ step: 'Credit Check', avgWait: 1.8, unit: 'days' }, { step: 'Payment', avgWait: 15.2, unit: 'days' }] },
  { name: 'Record-to-Report', steps: ['Journal Entry', 'Review', 'Post', 'Period Close', 'Consolidation', 'Report'], variants: 4, avgDuration: 5.0, conformance: 88.2, bottlenecks: [{ step: 'Period Close', avgWait: 1.5, unit: 'days' }] },
];

const CORRELATIONS = [
  { srcSys: 'SAP MM', srcEvt: 'PO Price Change', tgtSys: 'SAP FI', tgtImpact: 'GR/IR Discrepancy Spike', conf: 0.89, lag: 2 },
  { srcSys: 'SAP SD', srcEvt: 'New Contract Type', tgtSys: 'SAP FI', tgtImpact: 'Revenue Recognition Failure', conf: 0.82, lag: 30 },
  { srcSys: 'SAP HR', srcEvt: 'Overtime Policy Change', tgtSys: 'SAP Payroll', tgtImpact: 'Payroll Calculation Error', conf: 0.76, lag: 1 },
  { srcSys: 'Warehouse Scanner', srcEvt: 'Firmware Update', tgtSys: 'SAP MM', tgtImpact: 'Inventory Count Variance', conf: 0.71, lag: 3 },
];

const HEALTH_DIMENSIONS = {
  financial: { score: 72, trend: 'declining', delta: -3.5, kpiContributors: [{ status: 'green', count: 3 }, { status: 'amber', count: 4 }, { status: 'red', count: 3 }] },
  operational: { score: 76, trend: 'stable', delta: -1.2, kpiContributors: [{ status: 'green', count: 4 }, { status: 'amber', count: 5 }, { status: 'red', count: 1 }] },
  compliance: { score: 80, trend: 'declining', delta: -2.8, kpiContributors: [{ status: 'green', count: 0 }, { status: 'amber', count: 5 }, { status: 'red', count: 1 }] },
  strategic: { score: 82, trend: 'improving', delta: 2.1, kpiContributors: [{ status: 'green', count: 0 }, { status: 'amber', count: 2 }, { status: 'red', count: 0 }] },
  technology: { score: 85, trend: 'stable', delta: 0.5, kpiContributors: [{ status: 'green', count: 2 }, { status: 'amber', count: 2 }, { status: 'red', count: 1 }] },
};

const OVERALL_HEALTH = 76.8;
const HEALTH_HISTORY = [82.1, 80.5, 79.2, 78.0, 77.5, 77.0, 76.8];

seed.post('/seed-vantax', async (c) => {
  const tenantId = await getVantaXTenantId(c);
  if (!tenantId) {
    return c.json({ error: 'Access denied', message: 'This endpoint is restricted to VantaX (Pty) Ltd demo environment' }, 403);
  }

  try {
    const now = new Date().toISOString();
    console.log('[VantaX Seeder] Starting comprehensive seed for tenant:', tenantId);

    // Step 1: Cleanup
    const cleanupTables = [
      'sub_catalyst_run_items', 'run_comments', 'sub_catalyst_kpi_values',
      'sub_catalyst_runs', 'catalyst_run_analytics',
      'health_score_history', 'health_scores',
      'risk_alerts', 'anomalies', 'process_metrics', 'process_flows',
      'correlation_events', 'catalyst_actions', 'executive_briefings',
      'scenarios', 'catalyst_insights',
      'sub_catalyst_kpi_definitions', 'sub_catalyst_kpis', 'catalyst_clusters',
    ];
    let cleanupCount = 0;
    for (const table of cleanupTables) {
      try {
        const result = await c.env.DB.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).bind(tenantId).run();
        cleanupCount += (result.meta as any)?.changes || 0;
      } catch { /* table may not exist yet */ }
    }

    // Step 2: Create Catalyst Clusters
    const clusterIds: Record<string, string> = {};
    for (const cluster of CLUSTERS) {
      const cid = crypto.randomUUID();
      clusterIds[cluster.name] = cid;
      const avgRate = cluster.subs.reduce((sum, s) => {
        const posRate = s.pos.matched / s.pos.items * 100;
        const negTotal = s.neg.matched + s.neg.disc + s.neg.exc;
        const negRate = s.neg.matched / negTotal * 100;
        return sum + (posRate + negRate) / 2;
      }, 0) / cluster.subs.length;
      await c.env.DB.prepare(
        `INSERT INTO catalyst_clusters (id, tenant_id, name, domain, description, status, autonomy_tier, agent_count, success_rate, trust_score)
         VALUES (?, ?, ?, ?, ?, 'active', 'supervised', 3, ?, ?)`
      ).bind(cid, tenantId, cluster.name, cluster.domain, cluster.description, avgRate, 85 + Math.random() * 10).run();
    }

    // Step 3: Sub-Catalysts, KPI defs, runs, items, insights
    let totalSubs = 0, posRuns = 0, negRuns = 0, totalKpis = 0, totalItems = 0, totalInsights = 0;

    for (const cluster of CLUSTERS) {
      const clusterId = clusterIds[cluster.name];
      for (const sub of cluster.subs) {
        totalSubs++;

        // Sub-catalyst KPI tracker
        await c.env.DB.prepare(
          `INSERT INTO sub_catalyst_kpis (id, tenant_id, cluster_id, sub_catalyst_name, total_runs, successful_runs, success_rate, avg_confidence, status, threshold_success_green, threshold_success_amber, threshold_success_red)
           VALUES (?, ?, ?, ?, 2, 1, 50, ?, 'amber', 90, 70, 50)`
        ).bind(crypto.randomUUID(), tenantId, clusterId, sub.name, (sub.pos.conf + sub.neg.conf) / 2).run();

        // KPI definitions + latest values
        for (let ki = 0; ki < sub.kpis.length; ki++) {
          const kpi = sub.kpis[ki];
          const defId = crypto.randomUUID();
          totalKpis++;
          await c.env.DB.prepare(
            `INSERT INTO sub_catalyst_kpi_definitions (id, tenant_id, cluster_id, sub_catalyst_name, kpi_name, category, unit, direction, threshold_green, threshold_amber, threshold_red, enabled, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
          ).bind(defId, tenantId, clusterId, sub.name, kpi.name, kpi.category, kpi.unit, kpi.direction, kpi.tg, kpi.ta, kpi.tr, ki + 1).run();
          await c.env.DB.prepare(
            `INSERT INTO sub_catalyst_kpi_values (id, tenant_id, definition_id, value, status, trend, measured_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).bind(crypto.randomUUID(), tenantId, defId, kpi.value, kpi.status, JSON.stringify([kpi.value * 1.05, kpi.value * 1.02, kpi.value]), now).run();
        }

        // Positive run
        const posRunId = crypto.randomUUID();
        posRuns++;
        const posStarted = new Date(Date.now() - 3600000).toISOString();
        await c.env.DB.prepare(
          `INSERT INTO sub_catalyst_runs (id, tenant_id, cluster_id, sub_catalyst_name, run_number, status, mode, matched, discrepancies, exceptions_raised, avg_confidence, total_source_value, started_at, completed_at, duration_ms, reasoning)
           VALUES (?, ?, ?, ?, 1, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, 45000, 'All items matched successfully')`
        ).bind(posRunId, tenantId, clusterId, sub.name, sub.mode, sub.pos.matched, sub.pos.disc, sub.pos.exc, sub.pos.conf, sub.pos.value, posStarted, now).run();

        for (let i = 1; i <= Math.min(sub.pos.items, 10); i++) {
          const amt = (Math.random() * 50000 + 1000).toFixed(2);
          totalItems++;
          await c.env.DB.prepare(
            `INSERT INTO sub_catalyst_run_items (id, run_id, tenant_id, item_number, item_status, source_ref, target_ref, source_amount, target_amount, match_confidence, match_method, matched_on_field)
             VALUES (?, ?, ?, ?, 'matched', ?, ?, ?, ?, ?, 'fuzzy_match', 'ref_number')`
          ).bind(crypto.randomUUID(), posRunId, tenantId, i, `PO-${10000 + i}`, `GR-${10000 + i}`, amt, amt, 95 + Math.random() * 5).run();
        }

        // Negative run
        const negRunId = crypto.randomUUID();
        negRuns++;
        const negStarted = new Date(Date.now() - 7200000).toISOString();
        const negTotal = sub.neg.matched + sub.neg.disc + sub.neg.exc;
        await c.env.DB.prepare(
          `INSERT INTO sub_catalyst_runs (id, tenant_id, cluster_id, sub_catalyst_name, run_number, status, mode, matched, discrepancies, exceptions_raised, avg_confidence, total_source_value, started_at, completed_at, duration_ms, reasoning)
           VALUES (?, ?, ?, ?, 2, 'partial', ?, ?, ?, ?, ?, ?, ?, ?, 62000, ?)`
        ).bind(negRunId, tenantId, clusterId, sub.name, sub.mode, sub.neg.matched, sub.neg.disc, sub.neg.exc, sub.neg.conf, sub.neg.value, negStarted, now, sub.neg.issue).run();

        for (let i = 1; i <= Math.min(negTotal, 15); i++) {
          let status = 'matched', discF = '', discR = '', confidence = 95 + Math.random() * 5;
          const srcAmt = (Math.random() * 50000 + 1000).toFixed(2);
          let tgtAmt = srcAmt;
          totalItems++;
          if (i > sub.neg.matched + sub.neg.disc) {
            status = 'exception'; discF = 'missing_document'; discR = 'No matching document in target system';
            confidence = 45 + Math.random() * 15; tgtAmt = '0';
          } else if (i > sub.neg.matched) {
            status = 'discrepancy'; discF = 'amount_mismatch'; discR = 'Amount variance exceeds threshold';
            confidence = 60 + Math.random() * 20; tgtAmt = (parseFloat(srcAmt) * (0.8 + Math.random() * 0.4)).toFixed(2);
          }
          await c.env.DB.prepare(
            `INSERT INTO sub_catalyst_run_items (id, run_id, tenant_id, item_number, item_status, source_ref, target_ref, source_amount, target_amount, match_confidence, discrepancy_field, discrepancy_reason)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(crypto.randomUUID(), negRunId, tenantId, i, status, `DOC-${20000 + i}`, `DOC-${30000 + i}`, srcAmt, tgtAmt, confidence, discF, discR).run();
        }

        // Run analytics for both runs
        for (const [rid, rd, st] of [[posRunId, sub.pos, 'completed'], [negRunId, sub.neg, 'partial']] as const) {
          const total = rd.matched + rd.disc + rd.exc;
          await c.env.DB.prepare(
            `INSERT INTO catalyst_run_analytics (id, tenant_id, cluster_id, sub_catalyst_name, run_id, started_at, completed_at, duration_ms, total_items, completed_items, exception_items, escalated_items, pending_items, auto_approved_items, avg_confidence, min_confidence, max_confidence, confidence_distribution, status, insights)
             VALUES (?, ?, ?, ?, ?, ?, ?, 55000, ?, ?, ?, 0, 0, ?, ?, ?, 99.5, ?, ?, ?)`
          ).bind(crypto.randomUUID(), tenantId, clusterId, sub.name, rid, now, now, total, rd.matched, rd.exc, rd.matched, rd.conf, rd.conf - 10, JSON.stringify({ high: rd.matched, medium: rd.disc, low: rd.exc }), st, JSON.stringify([])).run();
        }

        // Generate catalyst_insights
        const matchRate = sub.neg.matched / negTotal * 100;
        const discRate = sub.neg.disc / negTotal * 100;
        const excRate = sub.neg.exc / negTotal * 100;
        const discValue = sub.neg.value * (sub.neg.disc / negTotal);

        if (discRate > 10) {
          totalInsights++;
          const sev = discRate > 25 ? 'critical' : 'warning';
          await c.env.DB.prepare(
            `INSERT INTO catalyst_insights (id, tenant_id, source_type, source_run_id, cluster_id, sub_catalyst_name, domain, insight_level, category, title, description, severity, data, traceability, generated_at) VALUES (?, ?, 'catalyst_run', ?, ?, ?, ?, 'pulse', 'issue_detected', ?, ?, ?, ?, ?, ?)`
          ).bind(`ins-${crypto.randomUUID()}`, tenantId, negRunId, clusterId, sub.name, cluster.domain,
            `High Discrepancy Rate: ${discRate.toFixed(1)}%`,
            `${sub.name} found ${sub.neg.disc} discrepancies out of ${negTotal} records. ${sev === 'critical' ? 'Immediate review required.' : 'Review recommended.'}`,
            sev, JSON.stringify({ discrepancies: sub.neg.disc, discrepancyRate: discRate, totalDiscrepancyValue: discValue }),
            JSON.stringify({ source_run_id: negRunId, cluster_id: clusterId, sub_catalyst_name: sub.name }), now).run();
        }
        if (matchRate < 80) {
          totalInsights++;
          await c.env.DB.prepare(
            `INSERT INTO catalyst_insights (id, tenant_id, source_type, source_run_id, cluster_id, sub_catalyst_name, domain, insight_level, category, title, description, severity, data, traceability, generated_at) VALUES (?, ?, 'catalyst_run', ?, ?, ?, ?, 'pulse', 'issue_detected', ?, ?, ?, ?, ?, ?)`
          ).bind(`ins-${crypto.randomUUID()}`, tenantId, negRunId, clusterId, sub.name, cluster.domain,
            `Low Match Rate: ${matchRate.toFixed(1)}%`,
            `${sub.name} only matched ${sub.neg.matched} of ${negTotal} records. Investigation needed.`,
            matchRate < 60 ? 'critical' : 'warning', JSON.stringify({ matched: sub.neg.matched, matchRate }),
            JSON.stringify({ source_run_id: negRunId, cluster_id: clusterId, sub_catalyst_name: sub.name }), now).run();
        }
        if (excRate > 5) {
          totalInsights++;
          await c.env.DB.prepare(
            `INSERT INTO catalyst_insights (id, tenant_id, source_type, source_run_id, cluster_id, sub_catalyst_name, domain, insight_level, category, title, description, severity, data, traceability, generated_at) VALUES (?, ?, 'catalyst_run', ?, ?, ?, ?, 'pulse', 'issue_detected', ?, ?, 'warning', ?, ?, ?)`
          ).bind(`ins-${crypto.randomUUID()}`, tenantId, negRunId, clusterId, sub.name, cluster.domain,
            `Elevated Exception Rate: ${excRate.toFixed(1)}%`,
            `${sub.name} raised ${sub.neg.exc} exceptions (${excRate.toFixed(1)}%). These require human review.`,
            JSON.stringify({ exceptions: sub.neg.exc, exceptionRate: excRate }),
            JSON.stringify({ source_run_id: negRunId, cluster_id: clusterId, sub_catalyst_name: sub.name }), now).run();
        }
        if (discValue > 50000) {
          totalInsights++;
          await c.env.DB.prepare(
            `INSERT INTO catalyst_insights (id, tenant_id, source_type, source_run_id, cluster_id, sub_catalyst_name, domain, insight_level, category, title, description, severity, data, traceability, generated_at) VALUES (?, ?, 'catalyst_run', ?, ?, ?, ?, 'apex', 'issue_detected', ?, ?, ?, ?, ?, ?)`
          ).bind(`ins-${crypto.randomUUID()}`, tenantId, negRunId, clusterId, sub.name, cluster.domain,
            `Significant Financial Discrepancy: R${Math.round(discValue).toLocaleString()}`,
            `${sub.name} identified R${Math.round(discValue).toLocaleString()} in discrepancies. Executive attention required.`,
            discValue > 250000 ? 'critical' : 'warning',
            JSON.stringify({ totalDiscrepancyValue: discValue, currency: 'ZAR', domain: cluster.domain }),
            JSON.stringify({ source_run_id: negRunId, cluster_id: clusterId, sub_catalyst_name: sub.name }), now).run();
        }
        for (const kpi of sub.kpis) {
          if (kpi.status === 'red') {
            totalInsights++;
            await c.env.DB.prepare(
              `INSERT INTO catalyst_insights (id, tenant_id, source_type, source_run_id, cluster_id, sub_catalyst_name, domain, insight_level, category, title, description, severity, data, traceability, generated_at) VALUES (?, ?, 'catalyst_run', ?, ?, ?, ?, 'pulse', 'kpi_movement', ?, ?, 'critical', ?, ?, ?)`
            ).bind(`ins-${crypto.randomUUID()}`, tenantId, negRunId, clusterId, sub.name, cluster.domain,
              `KPI Critical: ${kpi.name} at ${kpi.value}`,
              `${kpi.name} (${kpi.category}) has breached the RED threshold. Current: ${kpi.value}${kpi.unit === '%' ? '%' : ' ' + kpi.unit}. From ${sub.name}.`,
              JSON.stringify({ kpiName: kpi.name, category: kpi.category, currentValue: kpi.value, status: kpi.status }),
              JSON.stringify({ source_run_id: negRunId, cluster_id: clusterId, sub_catalyst_name: sub.name }), now).run();
          }
        }
      }
    }

    // Step 4: Process Metrics for Pulse
    for (const m of PROCESS_METRICS) {
      await c.env.DB.prepare(
        `INSERT INTO process_metrics (id, tenant_id, name, value, unit, status, threshold_green, threshold_amber, threshold_red, source_system, domain) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SAP', ?)`
      ).bind(crypto.randomUUID(), tenantId, m.name, m.value, m.unit, m.status, m.tg, m.ta, m.tg * 0.5, m.domain).run();
    }

    // Step 5: Risk Alerts for Apex
    for (const risk of RISKS) {
      await c.env.DB.prepare(
        `INSERT INTO risk_alerts (id, tenant_id, title, description, severity, category, probability, impact_value, impact_unit, status, recommended_actions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ZAR', 'active', ?)`
      ).bind(crypto.randomUUID(), tenantId, risk.title, risk.desc, risk.severity, risk.category, risk.prob, risk.impact,
        JSON.stringify(['Investigate root cause', 'Review process controls', 'Escalate to department head'])).run();
    }

    // Step 6: Anomalies
    for (const a of ANOMALIES) {
      await c.env.DB.prepare(
        `INSERT INTO anomalies (id, tenant_id, metric, severity, expected_value, actual_value, deviation, hypothesis, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`
      ).bind(crypto.randomUUID(), tenantId, a.metric, a.severity, a.expected, a.actual, a.deviation, a.hyp).run();
    }

    // Step 7: Process Flows
    for (const f of PROCESS_FLOWS) {
      await c.env.DB.prepare(
        `INSERT INTO process_flows (id, tenant_id, name, steps, variants, avg_duration, conformance_rate, bottlenecks) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), tenantId, f.name, JSON.stringify(f.steps), f.variants, f.avgDuration, f.conformance, JSON.stringify(f.bottlenecks)).run();
    }

    // Step 8: Correlations
    for (const cor of CORRELATIONS) {
      await c.env.DB.prepare(
        `INSERT INTO correlation_events (id, tenant_id, source_system, source_event, target_system, target_impact, confidence, lag_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), tenantId, cor.srcSys, cor.srcEvt, cor.tgtSys, cor.tgtImpact, cor.conf, cor.lag).run();
    }

    // Step 9: Health Score + History
    await c.env.DB.prepare(
      `INSERT INTO health_scores (id, tenant_id, overall_score, dimensions, calculated_at) VALUES (?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), tenantId, OVERALL_HEALTH, JSON.stringify(HEALTH_DIMENSIONS), now).run();

    for (let d = 6; d >= 0; d--) {
      const histDate = new Date(Date.now() - d * 86400000).toISOString();
      await c.env.DB.prepare(
        `INSERT INTO health_score_history (id, tenant_id, overall_score, dimensions, recorded_at) VALUES (?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), tenantId, HEALTH_HISTORY[6 - d], JSON.stringify(HEALTH_DIMENSIONS), histDate).run();
    }

    // Step 10: Executive Briefing
    await c.env.DB.prepare(
      `INSERT INTO executive_briefings (id, tenant_id, title, summary, risks, opportunities, kpi_movements, decisions_needed, generated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(), tenantId,
      'Daily Executive Briefing - ' + new Date().toLocaleDateString('en-ZA'),
      'VantaX SAP operations showing mixed performance across 6 domains. Critical attention needed in Supply Chain (inventory variance 21.7%, R4.2M exposure), Revenue Recognition (26.3% timing differences, IFRS 15 risk), and Compliance (tax filing gaps, POPIA consent at 84.1%). Financial reconciliation trending down with GR/IR discrepancy rate at 17.5%. Overall health score declined from 82.1 to 76.8 over the past 7 days.',
      JSON.stringify(RISKS),
      JSON.stringify([
        { title: 'Process Automation', impact: 'High', timeline: 'Q2 2026', investment: 'R 2.5M', description: 'Automate PO matching and GR/IR reconciliation' },
        { title: 'System Integration', impact: 'Medium', timeline: 'Q3 2026', investment: 'R 1.8M', description: 'Improve SAP module data integration' },
        { title: 'Compliance Automation', impact: 'High', timeline: 'Q2 2026', investment: 'R 900K', description: 'Automate tax filing and POPIA consent tracking' },
      ]),
      JSON.stringify([
        { kpi: 'Match Rate', change: -5.2, direction: 'down', from: 84.6, to: 79.4 },
        { kpi: 'Exception Rate', change: 3.1, direction: 'up', from: 5.1, to: 8.2 },
        { kpi: 'Inventory Accuracy', change: -4.8, direction: 'down', from: 83.1, to: 78.3 },
        { kpi: 'Health Score', change: -5.3, direction: 'down', from: 82.1, to: 76.8 },
      ]),
      JSON.stringify([
        'Approve inventory audit budget (R 500K) - warehouse zone C scanner replacement',
        'Review revenue recognition policy with CFO - new contract type mapping',
        'Prioritize GR/IR process improvement - price master data sync automation',
        'POPIA remediation plan sign-off - 15.9% consent gap',
        'Tax compliance review - late filing penalties R125K YTD',
      ]),
      now,
    ).run();

    // Step 11: Scenarios
    const scenarios = [
      { title: 'Automate PO Matching', desc: 'What if we automate 3-way PO matching with ML?', query: 'Simulate automating PO matching to reduce discrepancy rate from 18.7% to 5%', variables: [{ name: 'target_disc_rate', value: 5 }, { name: 'investment', value: 500000 }], results: { matchRateImprovement: '+21.4pp', costSaving: 'R 320K/year', paybackPeriod: '18 months', riskReduction: '3 fewer active risk alerts' } },
      { title: 'Centralize Compliance', desc: 'What if we centralize all compliance checks?', query: 'Simulate consolidating tax, POPIA, and SOX compliance into unified monitoring', variables: [{ name: 'compliance_target', value: 98 }, { name: 'investment', value: 900000 }], results: { complianceImprovement: '+16pp', penaltyReduction: 'R 125K/year', auditEfficiency: '+40%', regulatoryRisk: 'Low' } },
    ];
    for (const sc of scenarios) {
      await c.env.DB.prepare(
        `INSERT INTO scenarios (id, tenant_id, title, description, input_query, variables, results, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')`
      ).bind(crypto.randomUUID(), tenantId, sc.title, sc.desc, sc.query, JSON.stringify(sc.variables), JSON.stringify(sc.results)).run();
    }

    return c.json({
      success: true,
      message: 'VantaX tenant seeded with comprehensive demo data',
      tenant: { id: tenantId, slug: 'vantax' },
      cleanup: { tables: cleanupTables.length, recordsRemoved: cleanupCount },
      seeded: {
        clusters: CLUSTERS.length, subCatalysts: totalSubs, kpiDefinitions: totalKpis,
        positiveRuns: posRuns, negativeRuns: negRuns, totalRunItems: totalItems,
        insights: totalInsights, processMetrics: PROCESS_METRICS.length, riskAlerts: RISKS.length,
        anomalies: ANOMALIES.length, processFlows: PROCESS_FLOWS.length, correlations: CORRELATIONS.length,
        healthScore: OVERALL_HEALTH, healthHistory: HEALTH_HISTORY.length, executiveBriefings: 1, scenarios: scenarios.length,
      },
      expectedResults: {
        apex: { healthScore: OVERALL_HEALTH, dimensions: Object.keys(HEALTH_DIMENSIONS).length, risks: RISKS.length, scenarios: scenarios.length, briefingGenerated: true, trendDirection: 'declining (82.1 to 76.8 over 7 days)' },
        pulse: { totalMetrics: PROCESS_METRICS.length, greenMetrics: PROCESS_METRICS.filter(m => m.status === 'green').length, amberMetrics: PROCESS_METRICS.filter(m => m.status === 'amber').length, redMetrics: PROCESS_METRICS.filter(m => m.status === 'red').length, anomalies: ANOMALIES.length, processFlows: PROCESS_FLOWS.length, correlations: CORRELATIONS.length },
        catalysts: { clusters: CLUSTERS.length, subCatalysts: totalSubs, totalRuns: posRuns + negRuns, positiveRuns: posRuns, negativeRuns: negRuns, kpiDefinitions: totalKpis },
        insights: { total: totalInsights, pulseLevel: 'issue_detected + kpi_movement insights per domain', apexLevel: 'financial discrepancy insights for executive attention', aiInsightsReady: true },
      },
    });
  } catch (err) {
    console.error('VantaX seeding failed:', err);
    return c.json({ error: 'Seeding failed', details: (err as Error).message, stack: (err as Error).stack }, 500);
  }
});

seed.get('/vantax-status', async (c) => {
  const tenantId = await getVantaXTenantId(c);
  if (!tenantId) return c.json({ exists: false, error: 'Access denied' }, 403);
  const counts = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM sub_catalyst_runs WHERE tenant_id = ?').bind(tenantId).first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM process_metrics WHERE tenant_id = ?').bind(tenantId).first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM risk_alerts WHERE tenant_id = ?').bind(tenantId).first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM health_scores WHERE tenant_id = ?').bind(tenantId).first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM catalyst_insights WHERE tenant_id = ?').bind(tenantId).first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM anomalies WHERE tenant_id = ?').bind(tenantId).first(),
  ]);
  return c.json({
    exists: true, tenantId,
    data: {
      runs: (counts[0] as any)?.count || 0, metrics: (counts[1] as any)?.count || 0,
      risks: (counts[2] as any)?.count || 0, healthScores: (counts[3] as any)?.count || 0,
      insights: (counts[4] as any)?.count || 0, anomalies: (counts[5] as any)?.count || 0,
    },
  });
});

export default seed;
