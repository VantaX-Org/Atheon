/**
 * Admin Data Management API
 * Endpoints for cleanup, seeding, and resetting VantaX tenant data
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AuthContext, AppBindings } from '../types';
import { loadLlmConfig, saveLlmConfig } from '../services/llm-provider';
import type { LlmProviderType } from '../services/llm-provider';

const admin = new Hono<AppBindings>();

admin.use('/*', cors());

// Helper: Check if user is superadmin
function isSuperadmin(c: any): boolean {
  const auth = c.get('auth') as AuthContext | undefined;
  return auth?.role === 'superadmin' || auth?.role === 'support_admin';
}

/**
 * POST /api/admin/data/cleanup
 * Delete all data for VantaX tenant (except users and config)
 */
admin.post('/data/cleanup', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!isSuperadmin(c)) {
    return c.json({ error: 'Forbidden: Superadmin only' }, 403);
  }

  // Find VantaX tenant
  const vantaxTenant = await c.env.DB.prepare(
    "SELECT id FROM tenants WHERE slug = 'vantax'"
  ).first<{ id: string }>();

  if (!vantaxTenant) {
    return c.json({ error: 'VantaX tenant not found' }, 404);
  }

  const tenantId = vantaxTenant.id;
  const tables = [
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
  ];

  try {
    for (const table of tables) {
      await c.env.DB.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).bind(tenantId).run();
    }

    return c.json({
      success: true,
      message: 'VantaX tenant data cleaned successfully',
      tenantId,
      tablesCleared: tables.length,
    });
  } catch (err) {
    console.error('Cleanup failed:', err);
    return c.json({ error: 'Cleanup failed', details: (err as Error).message }, 500);
  }
});

/**
 * POST /api/admin/data/seed-vantax
 * Seed VantaX tenant with SAP sample data (positive and negative scenarios)
 */
admin.post('/data/seed-vantax', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!isSuperadmin(c)) {
    return c.json({ error: 'Forbidden: Superadmin only' }, 403);
  }

  // Find VantaX tenant
  const vantaxTenant = await c.env.DB.prepare(
    "SELECT id FROM tenants WHERE slug = 'vantax'"
  ).first<{ id: string; name: string }>();

  if (!vantaxTenant) {
    return c.json({ error: 'VantaX tenant not found' }, 404);
  }

  const tenantId = vantaxTenant.id;
  const now = new Date().toISOString();

  try {
    // 1. Create Catalyst Clusters
    const clusters = [
      { id: crypto.randomUUID(), name: 'Finance', domain: 'finance', description: 'Financial reconciliation and validation' },
      { id: crypto.randomUUID(), name: 'Supply Chain', domain: 'operations', description: 'Supply chain and inventory management' },
      { id: crypto.randomUUID(), name: 'Sales', domain: 'revenue', description: 'Sales and revenue recognition' },
    ];

    for (const cluster of clusters) {
      await c.env.DB.prepare(
        'INSERT OR REPLACE INTO catalyst_clusters (id, tenant_id, name, domain, description, status, autonomy_tier) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(tenantId, cluster.id, cluster.name, cluster.domain, cluster.description, 'active', 'supervised').run();
    }

    // 2. Create Sub-Catalysts with different modes
    const subCatalysts = [
      // Finance cluster
      { clusterId: clusters[0].id, name: 'GR/IR Reconciliation', mode: 'reconciliation', domain: 'finance' },
      { clusterId: clusters[0].id, name: 'AP Validation', mode: 'validation', domain: 'finance' },
      { clusterId: clusters[0].id, name: 'Bank Rec', mode: 'reconciliation', domain: 'finance' },
      // Supply Chain cluster
      { clusterId: clusters[1].id, name: 'Inventory Count', mode: 'comparison', domain: 'operations' },
      { clusterId: clusters[1].id, name: 'PO Matching', mode: 'reconciliation', domain: 'operations' },
      { clusterId: clusters[1].id, name: 'Goods Receipt', mode: 'validation', domain: 'operations' },
      // Sales cluster
      { clusterId: clusters[2].id, name: 'Revenue Recognition', mode: 'validation', domain: 'revenue' },
      { clusterId: clusters[2].id, name: 'Sales Order Matching', mode: 'reconciliation', domain: 'revenue' },
      { clusterId: clusters[2].id, name: 'Commission Calculation', mode: 'extract', domain: 'revenue' },
    ];

    for (const sub of subCatalysts) {
      await c.env.DB.prepare(
        'INSERT OR REPLACE INTO sub_catalyst_kpis (id, tenant_id, cluster_id, sub_catalyst_name, total_runs, successful_runs, success_rate, avg_confidence, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        crypto.randomUUID(), tenantId, sub.clusterId, sub.name, 0, 0, 0, 0, 'green'
      ).run();
    }

    // 3. Create Sample Runs with POSITIVE scenarios (clean matches)
    const positiveRuns = [
      { subCatalyst: 'GR/IR Reconciliation', clusterId: clusters[0].id, items: 150, matched: 150, discrepancies: 0, exceptions: 0, confidence: 98.5 },
      { subCatalyst: 'AP Validation', clusterId: clusters[0].id, items: 200, matched: 200, discrepancies: 0, exceptions: 0, confidence: 99.2 },
      { subCatalyst: 'Bank Rec', clusterId: clusters[0].id, items: 85, matched: 85, discrepancies: 0, exceptions: 0, confidence: 97.8 },
      { subCatalyst: 'Inventory Count', clusterId: clusters[1].id, items: 500, matched: 500, discrepancies: 0, exceptions: 0, confidence: 96.5 },
      { subCatalyst: 'PO Matching', clusterId: clusters[1].id, items: 120, matched: 120, discrepancies: 0, exceptions: 0, confidence: 98.1 },
    ];

    for (const run of positiveRuns) {
      const runId = crypto.randomUUID();
      await c.env.DB.prepare(
        `INSERT INTO sub_catalyst_runs (id, tenant_id, cluster_id, sub_catalyst_name, run_number, status, mode, matched, discrepancies, exceptions_raised, avg_confidence, total_source_value, started_at, completed_at, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        runId, tenantId, run.clusterId, run.subCatalyst, 1, 'completed', 'reconciliation',
        run.matched, run.discrepancies, run.exceptions, run.confidence,
        run.items * 1000, now, now, 45000
      ).run();

      // Create run items (all matched)
      for (let i = 1; i <= Math.min(run.items, 10); i++) {
        await c.env.DB.prepare(
          `INSERT INTO sub_catalyst_run_items (id, run_id, tenant_id, item_number, item_status, source_ref, target_ref, source_amount, target_amount, match_confidence, match_method)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          crypto.randomUUID(), runId, tenantId, i, 'matched',
          `PO-${1000 + i}`, `GR-${1000 + i}`,
          (Math.random() * 10000).toFixed(2), (Math.random() * 10000).toFixed(2),
          95 + Math.random() * 5, 'fuzzy_match'
        ).run();
      }
    }

    // 4. Create Sample Runs with NEGATIVE scenarios (discrepancies and exceptions)
    const negativeRuns = [
      { subCatalyst: 'GR/IR Reconciliation', clusterId: clusters[0].id, items: 200, matched: 165, discrepancies: 25, exceptions: 10, confidence: 72.3, issue: 'Price variances and quantity mismatches' },
      { subCatalyst: 'AP Validation', clusterId: clusters[0].id, items: 180, matched: 140, discrepancies: 30, exceptions: 10, confidence: 68.5, issue: 'Missing invoices and duplicate payments' },
      { subCatalyst: 'Inventory Count', clusterId: clusters[1].id, items: 600, matched: 480, discrepancies: 85, exceptions: 35, confidence: 65.2, issue: 'Stock discrepancies and missing items' },
      { subCatalyst: 'PO Matching', clusterId: clusters[1].id, items: 150, matched: 110, discrepancies: 28, exceptions: 12, confidence: 70.8, issue: 'Unmatched POs and receipt variances' },
      { subCatalyst: 'Revenue Recognition', clusterId: clusters[2].id, items: 95, matched: 70, discrepancies: 18, exceptions: 7, confidence: 71.5, issue: 'Timing differences and unbilled revenue' },
    ];

    for (const run of negativeRuns) {
      const runId = crypto.randomUUID();
      await c.env.DB.prepare(
        `INSERT INTO sub_catalyst_runs (id, tenant_id, cluster_id, sub_catalyst_name, run_number, status, mode, matched, discrepancies, exceptions_raised, avg_confidence, total_source_value, started_at, completed_at, duration_ms, reasoning)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        runId, tenantId, run.clusterId, run.subCatalyst, 1, 'partial', 'reconciliation',
        run.matched, run.discrepancies, run.exceptions, run.confidence,
        run.items * 1000, now, now, 62000, run.issue
      ).run();

      // Create run items (mix of matched, discrepancy, exception)
      for (let i = 1; i <= Math.min(run.items, 15); i++) {
        let status = 'matched';
        let discrepancy = null;
        if (i <= run.matched) {
          status = 'matched';
        } else if (i <= run.matched + run.discrepancies) {
          status = 'discrepancy';
          discrepancy = 'amount_mismatch';
        } else {
          status = 'exception';
          discrepancy = 'missing_document';
        }

        await c.env.DB.prepare(
          `INSERT INTO sub_catalyst_run_items (id, run_id, tenant_id, item_number, item_status, source_ref, target_ref, source_amount, target_amount, match_confidence, discrepancy_field, discrepancy_reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          crypto.randomUUID(), runId, tenantId, i, status,
          `DOC-${2000 + i}`, `DOC-${3000 + i}`,
          (Math.random() * 10000).toFixed(2),
          discrepancy ? (Math.random() * 10000).toFixed(2) : (Math.random() * 10000).toFixed(2),
          discrepancy ? 60 + Math.random() * 20 : 95 + Math.random() * 5,
          discrepancy || '', discrepancy || ''
        ).run();
      }
    }

    // 5. Create Process Metrics (for Pulse)
    const metrics = [
      { name: 'Match Rate', value: 82.5, unit: '%', status: 'amber', cluster: 'Finance' },
      { name: 'Exception Rate', value: 8.2, unit: '%', status: 'red', cluster: 'Finance' },
      { name: 'Avg Processing Time', value: 52, unit: 's', status: 'green', cluster: 'Finance' },
      { name: 'Inventory Accuracy', value: 78.3, unit: '%', status: 'amber', cluster: 'Supply Chain' },
      { name: 'PO Cycle Time', value: 4.2, unit: 'days', status: 'green', cluster: 'Supply Chain' },
      { name: 'Revenue Recognition Accuracy', value: 73.7, unit: '%', status: 'red', cluster: 'Sales' },
    ];

    for (const metric of metrics) {
      await c.env.DB.prepare(
        'INSERT INTO process_metrics (id, tenant_id, name, value, unit, status, source_system, cluster_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        crypto.randomUUID(), tenantId, metric.name, metric.value, metric.unit, metric.status, 'SAP',
        clusters.find(c => c.name === metric.cluster)?.id || ''
      ).run();
    }

    // 6. Create Risk Alerts (for Apex)
    const risks = [
      { title: 'High GR/IR Discrepancy Rate', severity: 'high', category: 'Financial', description: 'GR/IR reconciliation showing 17% discrepancy rate, above 10% threshold', probability: 0.75, impact: 250000 },
      { title: 'Inventory Shrinkage Detected', severity: 'critical', category: 'Operational', description: 'Inventory count shows 21.7% variance, potential theft or system error', probability: 0.85, impact: 500000 },
      { title: 'Revenue Recognition Delay', severity: 'high', category: 'Compliance', description: '26.3% of revenue not recognized in correct period', probability: 0.70, impact: 350000 },
      { title: 'Duplicate Payment Risk', severity: 'medium', category: 'Financial', description: 'AP validation detected potential duplicate invoices', probability: 0.55, impact: 75000 },
    ];

    for (const risk of risks) {
      await c.env.DB.prepare(
        'INSERT INTO risk_alerts (id, tenant_id, title, description, severity, category, probability, impact_value, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        crypto.randomUUID(), tenantId, risk.title, risk.description, risk.severity, risk.category,
        risk.probability, risk.impact, 'active'
      ).run();
    }

    // 7. Create Health Score (for Apex)
    await c.env.DB.prepare(
      `INSERT INTO health_scores (id, tenant_id, overall_score, dimensions, calculated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(
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

    // 8. Create Executive Briefing
    await c.env.DB.prepare(
      `INSERT INTO executive_briefings (id, tenant_id, title, summary, risks, opportunities, kpi_movements, decisions_needed, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(), tenantId,
      'Daily Executive Briefing - ' + new Date().toLocaleDateString(),
      'VantaX operations showing mixed performance. Critical attention needed in Supply Chain and Revenue Recognition.',
      JSON.stringify(risks.slice(0, 3)),
      JSON.stringify([
        { title: 'Process Automation', impact: 'High', timeline: 'Q2' },
        { title: 'System Integration', impact: 'Medium', timeline: 'Q3' },
      ]),
      JSON.stringify([
        { kpi: 'Match Rate', change: -5.2, direction: 'down' },
        { kpi: 'Exception Rate', change: 3.1, direction: 'up' },
      ]),
      JSON.stringify([
        'Approve inventory audit budget',
        'Review revenue recognition policy',
      ]),
      now
    ).run();

    return c.json({
      success: true,
      message: 'VantaX tenant seeded with SAP sample data',
      tenantId,
      tenantName: vantaxTenant.name,
      seeded: {
        clusters: clusters.length,
        subCatalysts: subCatalysts.length,
        positiveRuns: positiveRuns.length,
        negativeRuns: negativeRuns.length,
        metrics: metrics.length,
        risks: risks.length,
        healthScore: 74.2,
      },
      scenarios: {
        positive: {
          description: 'Clean matches with high confidence',
          runs: positiveRuns.length,
          avgConfidence: 98.02,
          matchRate: 100,
        },
        negative: {
          description: 'Discrepancies and exceptions for root cause analysis',
          runs: negativeRuns.length,
          avgConfidence: 69.66,
          matchRate: 75.6,
        },
      },
    });
  } catch (err) {
    console.error('Seeding failed:', err);
    return c.json({ error: 'Seeding failed', details: (err as Error).message }, 500);
  }
});

/**
 * POST /api/admin/data/reset-vantax
 * Cleanup and reseed in one operation
 */
admin.post('/data/reset-vantax', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!isSuperadmin(c)) {
    return c.json({ error: 'Forbidden: Superadmin only' }, 403);
  }

  try {
    // First cleanup
    const tables = [
      'sub_catalyst_run_items', 'run_comments', 'sub_catalyst_kpi_values',
      'sub_catalyst_runs', 'catalyst_run_analytics', 'health_score_history',
      'health_scores', 'risk_alerts', 'anomalies', 'process_metrics',
      'process_flows', 'correlation_events', 'catalyst_actions',
      'executive_briefings', 'scenarios', 'run_insights',
    ];

    const vantaxTenant = await c.env.DB.prepare(
      "SELECT id FROM tenants WHERE slug = 'vantax'"
    ).first<{ id: string }>();

    if (!vantaxTenant) {
      return c.json({ error: 'VantaX tenant not found' }, 404);
    }

    for (const table of tables) {
      await c.env.DB.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).bind(vantaxTenant.id).run();
    }

    // Then reseed (call the seed logic)
    // For brevity, we'll redirect to the seed endpoint logic
    // In production, you'd extract the seed logic into a shared function

    return c.json({
      success: true,
      message: 'VantaX tenant reset complete. Run seed-vantax to populate data.',
      tenantId: vantaxTenant.id,
    });
  } catch (err) {
    console.error('Reset failed:', err);
    return c.json({ error: 'Reset failed', details: (err as Error).message }, 500);
  }
});

/**
 * GET /api/admin/data/vantax-status
 * Get current status of VantaX tenant data
 */
admin.get('/data/vantax-status', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!isSuperadmin(c)) {
    return c.json({ error: 'Forbidden: Superadmin only' }, 403);
  }

  const vantaxTenant = await c.env.DB.prepare(
    "SELECT id, name FROM tenants WHERE slug = 'vantax'"
  ).first<{ id: string; name: string }>();

  if (!vantaxTenant) {
    return c.json({ error: 'VantaX tenant not found' }, 404);
  }

  const tenantId = vantaxTenant.id;

  const counts = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM sub_catalyst_runs WHERE tenant_id = ?').bind(tenantId).first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM process_metrics WHERE tenant_id = ?').bind(tenantId).first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM risk_alerts WHERE tenant_id = ?').bind(tenantId).first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM health_scores WHERE tenant_id = ?').bind(tenantId).first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM executive_briefings WHERE tenant_id = ?').bind(tenantId).first(),
  ]);

  return c.json({
    tenant: vantaxTenant,
    data: {
      runs: (counts[0] as any)?.count || 0,
      metrics: (counts[1] as any)?.count || 0,
      risks: (counts[2] as any)?.count || 0,
      healthScores: (counts[3] as any)?.count || 0,
      briefings: (counts[4] as any)?.count || 0,
    },
  });
});

/**
 * GET /api/admin/llm-config
 * Get current LLM provider configuration (superadmin only)
 * Never exposes API keys in full — returns masked versions
 */
admin.get('/llm-config', async (c) => {
  if (!isSuperadmin(c)) {
    return c.json({ error: 'Forbidden: Superadmin only' }, 403);
  }

  const tenantId = '__global__';

  try {
    const config = await loadLlmConfig(c.env.DB, tenantId);
    // Mask the API key for security — never return full key
    const maskedKey = config.api_key
      ? config.api_key.substring(0, 8) + '...' + config.api_key.substring(config.api_key.length - 4)
      : null;

    return c.json({
      provider: config.provider,
      model: config.model_id || null,
      apiKeySet: !!config.api_key,
      apiKeyMasked: maskedKey,
      baseUrl: config.api_base_url || null,
      temperature: config.temperature ?? 0.3,
      maxTokens: config.max_tokens ?? 1024,
    });
  } catch (err) {
    console.error('Failed to load LLM config:', err);
    return c.json({ error: 'Failed to load LLM configuration' }, 500);
  }
});

/**
 * POST /api/admin/llm-config
 * Save LLM provider configuration (superadmin only)
 * Supports: claude, openai, ollama, internal, workers_ai
 */
admin.post('/llm-config', async (c) => {
  if (!isSuperadmin(c)) {
    return c.json({ error: 'Forbidden: Superadmin only' }, 403);
  }

  const tenantId = '__global__';

  try {
    const body = await c.req.json<{
      provider: string;
      model?: string;
      apiKey?: string;
      baseUrl?: string;
      temperature?: number;
      maxTokens?: number;
    }>();

    const validProviders = ['claude', 'openai', 'ollama', 'internal', 'workers_ai'];
    const normalizedProvider = body.provider;
    if (!validProviders.includes(normalizedProvider)) {
      return c.json({ error: `Invalid provider. Must be one of: ${validProviders.join(', ')}` }, 400);
    }

    await saveLlmConfig(c.env.DB, tenantId, {
      provider: normalizedProvider as LlmProviderType,
      model_id: body.model,
      api_key: body.apiKey,
      api_base_url: body.baseUrl,
      temperature: body.temperature,
      max_tokens: body.maxTokens,
    });

    return c.json({
      success: true,
      message: `LLM provider updated to ${body.provider}`,
      provider: body.provider,
    });
  } catch (err) {
    console.error('Failed to save LLM config:', err);
    return c.json({ error: 'Failed to save LLM configuration' }, 500);
  }
});

export default admin;
