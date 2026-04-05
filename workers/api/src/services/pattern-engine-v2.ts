/**
 * Catalyst Intelligence — Pattern Engine V2
 * 
 * Pattern discovery, effectiveness tracking, dependency mapping, and ROI calculation.
 * Uses V2 schema: catalyst_patterns (new schema), catalyst_effectiveness (new schema),
 * catalyst_dependencies (new schema), catalyst_prescriptions, roi_tracking
 */

import { loadLlmConfig, llmChatWithFallback, stripCodeFences } from './llm-provider';
import type { LlmMessage } from './llm-provider';

// ── analysePatterns ──

export async function analysePatterns(
  db: D1Database,
  tenantId: string,
  clusterId: string,
  subCatalystName: string,
  env: { AI: Ai },
): Promise<void> {
  // Load last 15 runs
  const runs = await db.prepare(
    `SELECT * FROM sub_catalyst_runs WHERE tenant_id = ? AND cluster_id = ? AND sub_catalyst_name = ?
     ORDER BY started_at DESC LIMIT 15`
  ).bind(tenantId, clusterId, subCatalystName).all();

  if (runs.results.length < 3) return;

  const tenant = await db.prepare('SELECT industry FROM tenants WHERE id = ?').bind(tenantId).first<{ industry: string }>();
  const llmConfig = await loadLlmConfig(db, tenantId);

  // Build run data summary for LLM
  const runData = runs.results.map((r: Record<string, unknown>) => ({
    id: r.id,
    status: r.status,
    discrepancies: r.discrepancies,
    exceptions: r.exceptions_raised,
    discrepancy_details: r.discrepancy_details ? String(r.discrepancy_details).substring(0, 500) : '{}',
    result_data: r.result_data ? String(r.result_data).substring(0, 500) : '{}',
    total_discrepancy_value: r.total_discrepancy_value,
    started_at: r.started_at,
  }));

  const messages: LlmMessage[] = [
    {
      role: 'system',
      content: `You are Atheon Intelligence analysing catalyst run patterns for ${tenant?.industry || 'general'} (South Africa).

Analyse for these pattern types:
1. discrepancy_clustering: Common field values in discrepancies across 3+ runs (>30% of total)
2. exception_recurrence: Same exception items appearing in 3+ runs
3. temporal_pattern: Discrepancy rate varying >50% between time periods
4. field_hotspot: One field appearing in >40% of discrepancies

For each pattern found, also generate a prescription with SAP transaction codes if relevant.

Respond JSON: { "patterns": [{ "pattern_type": "discrepancy_clustering|exception_recurrence|temporal_pattern|field_hotspot", "title": "", "description": "", "affected_records_pct": 0-100, "confidence": 0-100, "prescription": { "type": "configuration|process|training|automation", "title": "", "description": "", "steps": [], "sap_transactions": [], "expected_impact": "", "effort_level": "low|medium|high", "priority": "immediate|short-term|strategic" } }] }`,
    },
    {
      role: 'user',
      content: `Sub-catalyst: ${subCatalystName} in cluster ${clusterId}\n\nRun data (last ${runs.results.length} runs):\n${JSON.stringify(runData, null, 1)}`,
    },
  ];

  let parsed: { patterns?: Array<{
    pattern_type: string; title: string; description: string;
    affected_records_pct: number; confidence: number;
    prescription?: { type: string; title: string; description: string; steps: string[]; sap_transactions: string[]; expected_impact: string; effort_level: string; priority: string };
  }> } = {};

  try {
    const result = await llmChatWithFallback(llmConfig, env.AI, messages, { maxTokens: 1500 });
    parsed = JSON.parse(stripCodeFences(result.text));
  } catch {
    return;
  }

  const now = new Date().toISOString();
  for (const p of (parsed.patterns || [])) {
    const patternId = crypto.randomUUID();
    let prescriptionId: string | null = null;

    // Create prescription first if present
    if (p.prescription) {
      prescriptionId = crypto.randomUUID();
      await db.prepare(
        `INSERT INTO catalyst_prescriptions (id, tenant_id, pattern_id, cluster_id, sub_catalyst_name, prescription_type, title, description, steps, sap_transactions, expected_impact, effort_level, priority, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
      ).bind(
        prescriptionId, tenantId, patternId, clusterId, subCatalystName,
        p.prescription.type || 'process',
        p.prescription.title || p.title,
        p.prescription.description || '',
        JSON.stringify(p.prescription.steps || []),
        JSON.stringify(p.prescription.sap_transactions || []),
        p.prescription.expected_impact || null,
        p.prescription.effort_level || 'medium',
        p.prescription.priority || 'short-term',
        now,
      ).run();
    }

    // Check for existing pattern with same title to update instead
    const existing = await db.prepare(
      "SELECT id, run_count FROM catalyst_patterns WHERE tenant_id = ? AND cluster_id = ? AND sub_catalyst_name = ? AND title = ? AND status = 'active'"
    ).bind(tenantId, clusterId, subCatalystName, p.title).first<{ id: string; run_count: number }>();

    if (existing) {
      await db.prepare(
        "UPDATE catalyst_patterns SET run_count = run_count + 1, last_confirmed = ?, confidence = ? WHERE id = ?"
      ).bind(now, Math.min(100, Math.max(0, p.confidence || 50)), existing.id).run();
    } else {
      await db.prepare(
        `INSERT INTO catalyst_patterns (id, tenant_id, cluster_id, sub_catalyst_name, pattern_type, title, description, evidence, affected_records_pct, confidence, first_detected, last_confirmed, run_count, status, prescription_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, 1, 'active', ?)`
      ).bind(
        patternId, tenantId, clusterId, subCatalystName,
        p.pattern_type || 'discrepancy_clustering',
        p.title || 'Unnamed pattern',
        p.description || '',
        Math.min(100, Math.max(0, p.affected_records_pct || 0)),
        Math.min(100, Math.max(0, p.confidence || 50)),
        now, now,
        prescriptionId,
      ).run();
    }
  }
}

// ── calculateEffectiveness ──

export async function calculateEffectiveness(
  db: D1Database,
  tenantId: string,
  clusterId: string,
  subCatalystName: string,
): Promise<void> {
  const runs = await db.prepare(
    'SELECT * FROM sub_catalyst_runs WHERE tenant_id = ? AND cluster_id = ? AND sub_catalyst_name = ? ORDER BY started_at DESC'
  ).bind(tenantId, clusterId, subCatalystName).all();

  if (runs.results.length === 0) return;

  const totalRuns = runs.results.length;
  const totalItems = runs.results.reduce((s, r) => s + ((r.items_total as number) || (r.matched as number || 0) + (r.discrepancies as number || 0)), 0);
  const totalValueFound = runs.results.reduce((s, r) => s + (r.total_discrepancy_value as number || 0), 0);
  const totalValueResolved = runs.results.reduce((s, r) => s + (r.total_matched_value as number || 0), 0);
  const recoveryRate = totalValueFound > 0 ? (totalValueResolved / totalValueFound) * 100 : 0;

  // Build trend arrays (last 10 data points)
  const recentRuns = runs.results.slice(0, 10);
  const matchRateTrend = recentRuns.map((r: Record<string, unknown>) => {
    const m = (r.matched as number) || 0;
    const d = (r.discrepancies as number) || 0;
    return m + d > 0 ? Math.round((m / (m + d)) * 100) : 0;
  });
  const confidenceTrend = recentRuns.map((r: Record<string, unknown>) => Math.round((r.avg_confidence as number) || 0));
  const durationTrend = recentRuns.map((r: Record<string, unknown>) => (r.duration_ms as number) || 0);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.prepare(
    `INSERT INTO catalyst_effectiveness (id, tenant_id, cluster_id, sub_catalyst_name, period, total_runs, total_items_processed, total_discrepancy_value_found, total_discrepancy_value_resolved, recovery_rate, avg_match_rate_trend, avg_confidence_trend, avg_duration_trend, intervention_impacts, calculated_at)
     VALUES (?, ?, ?, ?, 'all-time', ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)
     ON CONFLICT(tenant_id, cluster_id, sub_catalyst_name, period) DO UPDATE SET
     total_runs = excluded.total_runs, total_items_processed = excluded.total_items_processed,
     total_discrepancy_value_found = excluded.total_discrepancy_value_found,
     total_discrepancy_value_resolved = excluded.total_discrepancy_value_resolved,
     recovery_rate = excluded.recovery_rate, avg_match_rate_trend = excluded.avg_match_rate_trend,
     avg_confidence_trend = excluded.avg_confidence_trend, avg_duration_trend = excluded.avg_duration_trend,
     calculated_at = excluded.calculated_at`
  ).bind(
    id, tenantId, clusterId, subCatalystName,
    totalRuns, totalItems, totalValueFound, totalValueResolved,
    Math.round(recoveryRate * 100) / 100,
    JSON.stringify(matchRateTrend),
    JSON.stringify(confidenceTrend),
    JSON.stringify(durationTrend),
    now,
  ).run();
}

// ── calculateROI ──

export async function calculateROI(
  db: D1Database,
  tenantId: string,
): Promise<void> {
  // Aggregate across all sub-catalysts
  const valueResult = await db.prepare(
    'SELECT SUM(total_discrepancy_value) as identified, COUNT(*) as total_runs, SUM(items_total) as total_items FROM sub_catalyst_runs WHERE tenant_id = ?'
  ).bind(tenantId).first<{ identified: number; total_runs: number; total_items: number }>();

  const resolvedResult = await db.prepare(
    'SELECT SUM(total_matched_value) as recovered FROM sub_catalyst_runs WHERE tenant_id = ?'
  ).bind(tenantId).first<{ recovered: number }>();

  // Person-hours saved: total_items * 0.25 hours estimated manual effort
  const personHours = ((valueResult?.total_items || 0) * 0.25);

  // Get licence cost
  const licenceRow = await db.prepare(
    "SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = 'licence_cost_annual'"
  ).bind(tenantId).first<{ value: string }>();
  const licenceCost = licenceRow ? parseFloat(licenceRow.value) || 0 : 0;

  const identified = valueResult?.identified || 0;
  const recovered = resolvedResult?.recovered || 0;
  const roiMultiple = licenceCost > 0 ? Math.round(((recovered + personHours * 150) / licenceCost) * 10) / 10 : 0;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const period = now.substring(0, 7); // YYYY-MM

  await db.prepare(
    `INSERT INTO roi_tracking (id, tenant_id, period, total_discrepancy_value_identified, total_discrepancy_value_recovered, total_downstream_losses_prevented, total_person_hours_saved, total_catalyst_runs, licence_cost_annual, roi_multiple, calculated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, period) DO UPDATE SET
     total_discrepancy_value_identified = excluded.total_discrepancy_value_identified,
     total_discrepancy_value_recovered = excluded.total_discrepancy_value_recovered,
     total_person_hours_saved = excluded.total_person_hours_saved,
     total_catalyst_runs = excluded.total_catalyst_runs,
     licence_cost_annual = excluded.licence_cost_annual,
     roi_multiple = excluded.roi_multiple,
     calculated_at = excluded.calculated_at`
  ).bind(
    id, tenantId, period,
    identified, recovered, personHours,
    valueResult?.total_runs || 0, licenceCost, roiMultiple, now,
  ).run();
}
