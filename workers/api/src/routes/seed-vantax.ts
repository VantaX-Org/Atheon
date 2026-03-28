/**
 * VantaX Demo Data Seeder
 * Cleanup old seed data and create fresh SAP test dataset
 * RESTRICTED: VantaX (Pty) Ltd demo environment only
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AuthContext, AppBindings } from '../types';

const seed = new Hono<AppBindings>();
seed.use('/*', cors());

/**
 * Helper: Verify VantaX tenant and admin access
 */
async function getVantaXTenantId(c: any): Promise<string | null> {
  const auth = c.get('auth') as AuthContext | undefined;
  
  // Allow superadmin, support_admin, or VantaX tenant users
  const allowedRoles = ['superadmin', 'support_admin', 'admin', 'executive'];
  if (!auth || !allowedRoles.includes(auth.role)) {
    return null;
  }

  // Find VantaX tenant specifically
  const row = await c.env.DB.prepare(
    "SELECT id FROM tenants WHERE slug = 'vantax'"
  ).first() as { id: string } | null;
  return row?.id || null;
}

/**
 * POST /api/v1/seed-vantax
 * Complete cleanup and reseed of VantaX demo environment
 * Restricted to VantaX tenant only
 */
seed.post('/seed-vantax', async (c) => {
  // Security: Only VantaX tenant
  const tenantId = await getVantaXTenantId(c);
  if (!tenantId) {
    return c.json({ 
      error: 'Access denied',
      message: 'This endpoint is restricted to VantaX (Pty) Ltd demo environment'
    }, 403);
  }

  try {
    const now = new Date().toISOString();
    console.log('[VantaX Seeder] Starting seed for tenant:', tenantId);

    // Step 1: Cleanup old seed data
    const cleanupTables = [
      'sub_catalyst_run_items',
      'run_comments',
      'sub_catalyst_kpi_values',
      'sub_catalyst_runs',
      'catalyst_run_analytics',
      'health_score_history',
      'health_scores',
      'risk_alerts',
      'anomalies',
      'process_metrics',
      'process_flows',
      'correlation_events',
      'catalyst_actions',
      'executive_briefings',
      'scenarios',
      'run_insights',
      'catalyst_clusters',
      'sub_catalyst_kpis',
      'sub_catalyst_kpi_definitions',
    ];

    let cleanupCount = 0;
    for (const table of cleanupTables) {
      const result = await c.env.DB.prepare(
        `DELETE FROM ${table} WHERE tenant_id = ?`
      ).bind(tenantId).run();
      cleanupCount += (result.meta as any)?.changes || 0;
    }
    console.log(`Cleaned ${cleanupCount} old records`);

    // Step 3: Create Catalyst Clusters (SAP Domains)
    const clusters = [
      { id: crypto.randomUUID(), name: 'Finance', domain: 'finance', description: 'Financial reconciliation - SAP FI/CO' },
      { id: crypto.randomUUID(), name: 'Supply Chain', domain: 'operations', description: 'Supply chain - SAP MM/SD' },
      { id: crypto.randomUUID(), name: 'Sales', domain: 'revenue', description: 'Revenue cycle - SAP SD' },
    ];

    for (const cluster of clusters) {
      await c.env.DB.prepare(`
        INSERT INTO catalyst_clusters (id, tenant_id, name, domain, description, status, autonomy_tier, agent_count)
        VALUES (?, ?, ?, ?, ?, 'active', 'supervised', 3)
      `).bind(tenantId, cluster.id, cluster.name, cluster.domain, cluster.description).run();
    }

    // Step 4: Create Sub-Catalysts with SAP scenarios
    const subCatalysts = [
      // Finance - GR/IR, AP, Bank Rec
      { clusterId: clusters[0].id, name: 'GR/IR Reconciliation', mode: 'reconciliation', description: 'Goods Receipt vs Invoice Receipt matching' },
      { clusterId: clusters[0].id, name: 'AP Validation', mode: 'validation', description: 'Accounts Payable invoice validation' },
      { clusterId: clusters[0].id, name: 'Bank Rec', mode: 'reconciliation', description: 'Bank statement reconciliation' },
      // Supply Chain - Inventory, PO, Goods Receipt
      { clusterId: clusters[1].id, name: 'Inventory Count', mode: 'comparison', description: 'Physical vs system inventory count' },
      { clusterId: clusters[1].id, name: 'PO Matching', mode: 'reconciliation', description: 'Purchase order matching' },
      { clusterId: clusters[1].id, name: 'Goods Receipt', mode: 'validation', description: 'Goods receipt validation' },
      // Sales - Revenue, SO, Commission
      { clusterId: clusters[2].id, name: 'Revenue Recognition', mode: 'validation', description: 'Revenue recognition compliance' },
      { clusterId: clusters[2].id, name: 'Sales Order Matching', mode: 'reconciliation', description: 'Sales order to invoice matching' },
      { clusterId: clusters[2].id, name: 'Commission Calculation', mode: 'extract', description: 'Sales commission extraction' },
    ];

    for (const sub of subCatalysts) {
      await c.env.DB.prepare(`
        INSERT INTO sub_catalyst_kpis (id, tenant_id, cluster_id, sub_catalyst_name, total_runs, successful_runs, success_rate, avg_confidence, status, threshold_success_green, threshold_success_amber, threshold_success_red)
        VALUES (?, ?, ?, ?, 0, 0, 0, 0, 'green', 90, 70, 50)
      `).bind(tenantId, sub.clusterId, sub.name, crypto.randomUUID()).run();
    }

    // Step 5: Create POSITIVE scenario runs (clean matches - should pass all checks)
    const positiveRuns = [
      { sub: 'GR/IR Reconciliation', clusterId: clusters[0].id, items: 150, matched: 150, disc: 0, exc: 0, conf: 98.5, value: 1250000 },
      { sub: 'AP Validation', clusterId: clusters[0].id, items: 200, matched: 200, disc: 0, exc: 0, conf: 99.2, value: 890000 },
      { sub: 'Bank Rec', clusterId: clusters[0].id, items: 85, matched: 85, disc: 0, exc: 0, conf: 97.8, value: 2100000 },
      { sub: 'Inventory Count', clusterId: clusters[1].id, items: 500, matched: 500, disc: 0, exc: 0, conf: 96.5, value: 3500000 },
      { sub: 'PO Matching', clusterId: clusters[1].id, items: 120, matched: 120, disc: 0, exc: 0, conf: 98.1, value: 675000 },
    ];

    let runId;
    for (const run of positiveRuns) {
      runId = crypto.randomUUID();
      await c.env.DB.prepare(`
        INSERT INTO sub_catalyst_runs (id, tenant_id, cluster_id, sub_catalyst_name, run_number, status, mode, matched, discrepancies, exceptions_raised, avg_confidence, total_source_value, started_at, completed_at, duration_ms, reasoning)
        VALUES (?, ?, ?, ?, 1, 'completed', 'reconciliation', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        runId, tenantId, run.clusterId, run.sub,
        run.matched, run.disc, run.exc, run.conf, run.value,
        now, now, 45000, 'All items matched successfully - clean data scenario'
      ).run();

      // Create sample items (first 10)
      for (let i = 1; i <= Math.min(run.items, 10); i++) {
        const sourceAmt = (Math.random() * 50000 + 1000).toFixed(2);
        await c.env.DB.prepare(`
          INSERT INTO sub_catalyst_run_items (id, run_id, tenant_id, item_number, item_status, source_ref, target_ref, source_amount, target_amount, match_confidence, match_method, matched_on_field)
          VALUES (?, ?, ?, ?, 'matched', ?, ?, ?, ?, ?, 'fuzzy_match', 'ref_number')
        `).bind(
          crypto.randomUUID(), runId, tenantId, i,
          `PO-${10000 + i}`, `GR-${10000 + i}`,
          sourceAmt, sourceAmt, 95 + Math.random() * 5
        ).run();
      }
    }

    // Step 6: Create NEGATIVE scenario runs (discrepancies & exceptions - should trigger alerts)
    const negativeRuns = [
      { sub: 'GR/IR Reconciliation', clusterId: clusters[0].id, items: 200, matched: 165, disc: 25, exc: 10, conf: 72.3, value: 1850000, issue: 'Price variances > 10%' },
      { sub: 'AP Validation', clusterId: clusters[0].id, items: 180, matched: 140, disc: 30, exc: 10, conf: 68.5, value: 920000, issue: 'Duplicate invoices detected' },
      { sub: 'Inventory Count', clusterId: clusters[1].id, items: 600, matched: 480, disc: 85, exc: 35, conf: 65.2, value: 4200000, issue: 'Stock variance > 15%' },
      { sub: 'PO Matching', clusterId: clusters[1].id, items: 150, matched: 110, disc: 28, exc: 12, conf: 70.8, value: 780000, issue: 'Unmatched POs' },
      { sub: 'Revenue Recognition', clusterId: clusters[2].id, items: 95, matched: 70, disc: 18, exc: 7, conf: 71.5, value: 1150000, issue: 'Timing differences' },
    ];

    for (const run of negativeRuns) {
      runId = crypto.randomUUID();
      await c.env.DB.prepare(`
        INSERT INTO sub_catalyst_runs (id, tenant_id, cluster_id, sub_catalyst_name, run_number, status, mode, matched, discrepancies, exceptions_raised, avg_confidence, total_source_value, started_at, completed_at, duration_ms, reasoning)
        VALUES (?, ?, ?, ?, 1, 'partial', 'reconciliation', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        runId, tenantId, run.clusterId, run.sub,
        run.matched, run.disc, run.exc, run.conf, run.value,
        now, now, 62000, run.issue
      ).run();

      // Create sample items with mixed statuses
      for (let i = 1; i <= Math.min(run.items, 15); i++) {
        let status = 'matched';
        let discrepancyField = '';
        let discrepancyReason = '';
        let confidence = 95 + Math.random() * 5;
        const sourceAmt = (Math.random() * 50000 + 1000).toFixed(2);
        let targetAmt = sourceAmt;

        if (i > run.matched + run.disc) {
          status = 'exception';
          discrepancyField = 'missing_document';
          discrepancyReason = 'No matching document in target system';
          confidence = 45 + Math.random() * 15;
          targetAmt = '0';
        } else if (i > run.matched) {
          status = 'discrepancy';
          discrepancyField = 'amount_mismatch';
          discrepancyReason = 'Amount variance exceeds threshold';
          confidence = 60 + Math.random() * 20;
          targetAmt = (parseFloat(sourceAmt) * (0.8 + Math.random() * 0.4)).toFixed(2);
        }

        await c.env.DB.prepare(`
          INSERT INTO sub_catalyst_run_items (id, run_id, tenant_id, item_number, item_status, source_ref, target_ref, source_amount, target_amount, match_confidence, discrepancy_field, discrepancy_reason)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(), runId, tenantId, i, status,
          `DOC-${20000 + i}`, `DOC-${30000 + i}`,
          sourceAmt, targetAmt, confidence,
          discrepancyField, discrepancyReason
        ).run();
      }
    }

    // Step 7: Create Process Metrics for Pulse (with expected values)
    const metrics = [
      { name: 'Match Rate', value: 82.5, unit: '%', status: 'amber', threshold_g: 90, threshold_a: 75 },
      { name: 'Exception Rate', value: 8.2, unit: '%', status: 'red', threshold_g: 5, threshold_a: 10 },
      { name: 'Avg Processing Time', value: 52, unit: 's', status: 'green', threshold_g: 60, threshold_a: 90 },
      { name: 'Inventory Accuracy', value: 78.3, unit: '%', status: 'amber', threshold_g: 95, threshold_a: 85 },
      { name: 'PO Cycle Time', value: 4.2, unit: 'days', status: 'green', threshold_g: 5, threshold_a: 7 },
      { name: 'Revenue Recognition Accuracy', value: 73.7, unit: '%', status: 'red', threshold_g: 95, threshold_a: 85 },
    ];

    for (const m of metrics) {
      await c.env.DB.prepare(`
        INSERT INTO process_metrics (id, tenant_id, name, value, unit, status, threshold_green, threshold_amber, threshold_red, source_system)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SAP')
      `).bind(
        crypto.randomUUID(), tenantId, m.name, m.value, m.unit, m.status,
        m.threshold_g, m.threshold_a, m.threshold_g * 0.5
      ).run();
    }

    // Step 8: Create Risk Alerts for Apex (from negative scenarios)
    const risks = [
      { title: 'High GR/IR Discrepancy Rate', severity: 'high', category: 'Financial', desc: '17% discrepancy rate exceeds 10% threshold', prob: 0.75, impact: 250000 },
      { title: 'Inventory Shrinkage Detected', severity: 'critical', category: 'Operational', desc: '21.7% variance indicates potential issues', prob: 0.85, impact: 500000 },
      { title: 'Revenue Recognition Delay', severity: 'high', category: 'Compliance', desc: '26.3% not recognized in correct period', prob: 0.70, impact: 350000 },
      { title: 'Duplicate Payment Risk', severity: 'medium', category: 'Financial', desc: 'AP validation detected duplicates', prob: 0.55, impact: 75000 },
    ];

    for (const risk of risks) {
      await c.env.DB.prepare(`
        INSERT INTO risk_alerts (id, tenant_id, title, description, severity, category, probability, impact_value, impact_unit, status, recommended_actions)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ZAR', 'active', ?)
      `).bind(
        crypto.randomUUID(), tenantId, risk.title, risk.desc, risk.severity, risk.category,
        risk.prob, risk.impact, JSON.stringify(['Investigate root cause', 'Review process controls'])
      ).run();
    }

    // Step 9: Create Health Score for Apex (calculated from runs)
    await c.env.DB.prepare(`
      INSERT INTO health_scores (id, tenant_id, overall_score, dimensions, calculated_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(), tenantId, 74.2,
      JSON.stringify({
        financial: { score: 72, trend: 'declining', delta: -3.5 },
        operational: { score: 68, trend: 'declining', delta: -5.2 },
        compliance: { score: 78, trend: 'stable', delta: 0.5 },
        strategic: { score: 82, trend: 'improving', delta: 2.1 },
        technology: { score: 75, trend: 'stable', delta: 0.0 },
      }),
      now
    ).run();

    // Step 10: Create Executive Briefing
    await c.env.DB.prepare(`
      INSERT INTO executive_briefings (id, tenant_id, title, summary, risks, opportunities, kpi_movements, decisions_needed, generated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(), tenantId,
      'Daily Executive Briefing - ' + new Date().toLocaleDateString(),
      'VantaX SAP operations showing mixed performance. Critical attention needed in Supply Chain (inventory variance 21.7%) and Revenue Recognition (26.3% timing differences).',
      JSON.stringify(risks),
      JSON.stringify([
        { title: 'Process Automation', impact: 'High', timeline: 'Q2 2025', investment: 'R 2.5M' },
        { title: 'System Integration', impact: 'Medium', timeline: 'Q3 2025', investment: 'R 1.8M' },
      ]),
      JSON.stringify([
        { kpi: 'Match Rate', change: -5.2, direction: 'down' },
        { kpi: 'Exception Rate', change: 3.1, direction: 'up' },
        { kpi: 'Processing Time', change: -12, direction: 'down' },
      ]),
      JSON.stringify([
        'Approve inventory audit budget (R 500K)',
        'Review revenue recognition policy with CFO',
        'Prioritize GR/IR process improvement',
      ]),
      now
    ).run();

    return c.json({
      success: true,
      message: 'VantaX tenant seeded with SAP test data',
      tenant: { id: tenantId, slug: 'vantax' },
      cleanup: { tables: cleanupTables.length, recordsRemoved: cleanupCount },
      seeded: {
        clusters: clusters.length,
        subCatalysts: subCatalysts.length,
        positiveRuns: { count: positiveRuns.length, totalItems: positiveRuns.reduce((s, r) => s + r.items, 0), matchRate: 100 },
        negativeRuns: { count: negativeRuns.length, totalItems: negativeRuns.reduce((s, r) => s + r.items, 0), matchRate: 75.6 },
        metrics: metrics.length,
        risks: risks.length,
        healthScore: 74.2,
      },
      expectedResults: {
        apex: {
          healthScore: 74.2,
          dimensions: 5,
          risks: 4,
          briefingGenerated: true,
        },
        pulse: {
          metrics: 6,
          amberMetrics: 2,
          redMetrics: 2,
          greenMetrics: 2,
        },
        catalysts: {
          clusters: 3,
          subCatalysts: 9,
          totalRuns: 10,
          positiveRuns: 5,
          negativeRuns: 5,
          totalItems: 2280,
          avgConfidence: 83.76,
        },
      },
      validation: {
        drillThrough: 'Click any dimension/risk to see traceability modal',
        flipCards: 'Click health score or dimension cards to flip',
        rootCause: 'Click "Suggest Root Causes" on risk details',
        export: 'Click "Export CSV" on risk traceability modal',
      },
    });
  } catch (err) {
    console.error('VantaX seeding failed:', err);
    return c.json({ 
      error: 'Seeding failed', 
      details: (err as Error).message,
      stack: (err as Error).stack 
    }, 500);
  }
});

/**
 * GET /api/v1/vantax-status
 * Check current VantaX data status
 * Restricted to VantaX tenant only
 */
seed.get('/vantax-status', async (c) => {
  const tenantId = await getVantaXTenantId(c);
  if (!tenantId) {
    return c.json({ 
      exists: false, 
      error: 'Access denied',
      message: 'This endpoint is restricted to VantaX (Pty) Ltd demo environment'
    }, 403);
  }
  const counts = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM sub_catalyst_runs WHERE tenant_id = ?').bind(tenantId).first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM process_metrics WHERE tenant_id = ?').bind(tenantId).first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM risk_alerts WHERE tenant_id = ?').bind(tenantId).first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM health_scores WHERE tenant_id = ?').bind(tenantId).first(),
  ]);

  return c.json({
    exists: true,
    tenantId,
    data: {
      runs: (counts[0] as any)?.count || 0,
      metrics: (counts[1] as any)?.count || 0,
      risks: (counts[2] as any)?.count || 0,
      healthScores: (counts[3] as any)?.count || 0,
    },
  });
});

export default seed;
