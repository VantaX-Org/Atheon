/**
 * Pulse Diagnostics Engine
 * 
 * Root-cause analysis pipeline with L0-L5 causal chain.
 * When a metric turns red/amber, this engine analyses contributing factors,
 * builds a causal chain from symptom → root cause, and suggests fixes.
 * 
 * Causal Chain Levels:
 * L0: Symptom (the metric itself)
 * L1: Direct cause (what directly caused the metric to degrade)
 * L2: Contributing factors (upstream processes/systems)
 * L3: Systemic issues (organizational, process design)
 * L4: Environmental factors (market, regulatory, external)
 * L5: Root cause (fundamental underlying issue)
 */

import { loadLlmConfig, llmChatWithFallback, stripCodeFences } from './llm-provider';
import type { LlmMessage } from './llm-provider';

// ── Types ──

export interface DiagnosticAnalysis {
  id: string;
  tenant_id: string;
  metric_id: string;
  metric_name: string;
  metric_value: number;
  metric_status: string;
  trigger_type: 'manual' | 'auto' | 'scheduled';
  status: 'pending' | 'running' | 'completed' | 'failed';
  created_at: string;
  completed_at?: string;
}

export interface CausalChainLink {
  id: string;
  tenant_id: string;
  analysis_id: string;
  level: number;
  cause_type: 'direct' | 'contributing' | 'systemic' | 'environmental' | 'root';
  title: string;
  description: string;
  confidence: number;
  evidence: string[];
  related_metrics: string[];
  recommended_fix?: string;
  fix_priority: 'critical' | 'high' | 'medium' | 'low';
  fix_effort: 'low' | 'medium' | 'high';
  created_at: string;
}

export interface FixTracking {
  id: string;
  tenant_id: string;
  chain_id: string;
  analysis_id: string;
  status: 'proposed' | 'accepted' | 'in_progress' | 'completed' | 'rejected';
  assigned_to?: string;
  started_at?: string;
  completed_at?: string;
  outcome?: string;
  notes?: string;
  created_at: string;
}

export interface DiagnosticSummary {
  totalAnalyses: number;
  pendingAnalyses: number;
  completedAnalyses: number;
  undiagnosedMetrics: number;
  criticalFindings: number;
  activeFixes: number;
}

// ── Run Diagnostic Analysis ──

export async function runDiagnosticAnalysis(
  db: D1Database,
  ai: Ai,
  tenantId: string,
  metricId: string,
  triggerType: 'manual' | 'auto' | 'scheduled' = 'manual',
): Promise<{ analysis: DiagnosticAnalysis; causalChain: CausalChainLink[] }> {
  // Get the metric details - check KPI definitions and values
  const kpiDef = await db.prepare(
    'SELECT kd.id, kd.kpi_name, kd.unit, kd.direction, kd.threshold_green, kd.threshold_amber, kd.threshold_red, kd.cluster_id, kd.sub_catalyst_name, kd.category FROM sub_catalyst_kpi_definitions kd WHERE kd.id = ? AND kd.tenant_id = ?'
  ).bind(metricId, tenantId).first();

  const kpiValue = await db.prepare(
    'SELECT value, status, trend, measured_at FROM sub_catalyst_kpi_values WHERE definition_id = ? AND tenant_id = ? ORDER BY measured_at DESC LIMIT 1'
  ).bind(metricId, tenantId).first<{ value: number; status: string; trend: string; measured_at: string }>();

  const metricName = kpiDef ? kpiDef.kpi_name as string : `Metric ${metricId}`;
  const metricValue = kpiValue?.value || 0;
  const metricStatus = kpiValue?.status || 'unknown';

  // Create the analysis record
  const analysisId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.prepare(
    `INSERT INTO diagnostic_analyses (id, tenant_id, metric_id, metric_name, metric_value, metric_status, trigger_type, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?)`
  ).bind(analysisId, tenantId, metricId, metricName, metricValue, metricStatus, triggerType, now).run();

  // Gather context for RCA
  const recentRuns = await db.prepare(
    'SELECT id, sub_catalyst_name, status, matched, discrepancies, exceptions_raised, total_source_value, started_at FROM sub_catalyst_runs WHERE tenant_id = ? ORDER BY started_at DESC LIMIT 10'
  ).bind(tenantId).all();

  const recentInsights = await db.prepare(
    "SELECT title, description, severity, category FROM catalyst_insights WHERE tenant_id = ? ORDER BY generated_at DESC LIMIT 10"
  ).bind(tenantId).all();

  const healthScore = await db.prepare(
    'SELECT overall_score, dimensions FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(tenantId).first<{ overall_score: number; dimensions: string }>();

  const risks = await db.prepare(
    "SELECT title, severity, category FROM risk_alerts WHERE tenant_id = ? AND status = 'active' ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END LIMIT 5"
  ).bind(tenantId).all();

  const tenant = await db.prepare(
    'SELECT industry FROM tenants WHERE id = ?'
  ).bind(tenantId).first<{ industry: string }>();

  // Build LLM prompt for RCA
  const llmConfig = await loadLlmConfig(db, tenantId);

  const runSummary = recentRuns.results.map((r: Record<string, unknown>) =>
    `${r.sub_catalyst_name}: ${r.status} (matched: ${r.matched}, discrepancies: ${r.discrepancies}, exceptions: ${r.exceptions_raised})`
  ).join('\n');

  const insightSummary = recentInsights.results.map((i: Record<string, unknown>) =>
    `[${i.severity}/${i.category}] ${i.title}: ${i.description}`
  ).join('\n');

  const riskSummary = risks.results.map((r: Record<string, unknown>) =>
    `[${r.severity}] ${r.title} (${r.category})`
  ).join('\n');

  const systemPrompt = `You are Atheon Intelligence, performing root-cause analysis on a degraded business metric.
Industry: ${tenant?.industry || 'general'} (South Africa context)

Build a causal chain from L0 (symptom) to L5 (root cause):
L0: Symptom — the metric itself and its current state
L1: Direct cause — what directly caused this metric to degrade
L2: Contributing factors — upstream processes or systems that contributed
L3: Systemic issues — organizational or process design problems
L4: Environmental factors — market, regulatory, or external pressures
L5: Root cause — the fundamental underlying issue

For each level provide:
- level: 0-5
- cause_type: direct, contributing, systemic, environmental, or root
- title: short descriptive title
- description: detailed explanation
- confidence: 0-100
- evidence: list of evidence points
- related_metrics: other metrics that may be affected
- recommended_fix: actionable fix recommendation
- fix_priority: critical, high, medium, or low
- fix_effort: low, medium, or high

Respond ONLY with a valid JSON array of chain links. No markdown, no explanation.`;

  const userPrompt = `Metric Under Analysis:
Name: ${metricName}
Value: ${metricValue} ${kpiDef?.unit || ''}
Status: ${metricStatus}
Category: ${kpiDef?.category || 'unknown'}
Direction: ${kpiDef?.direction || 'unknown'}
Thresholds: Green=${kpiDef?.threshold_green || 'N/A'}, Amber=${kpiDef?.threshold_amber || 'N/A'}, Red=${kpiDef?.threshold_red || 'N/A'}

Recent Catalyst Runs:
${runSummary || 'No recent runs'}

Recent Insights:
${insightSummary || 'No recent insights'}

Health Score: ${healthScore?.overall_score || 'N/A'}/100
Dimensions: ${healthScore?.dimensions || '{}'}

Active Risks:
${riskSummary || 'No active risks'}

Perform root-cause analysis and build the L0-L5 causal chain.`;

  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let chainData: Array<{
    level: number;
    cause_type: string;
    title: string;
    description: string;
    confidence: number;
    evidence: string[];
    related_metrics: string[];
    recommended_fix?: string;
    fix_priority: string;
    fix_effort: string;
  }> = [];

  try {
    const llmResult = await llmChatWithFallback(llmConfig, ai, messages, { maxTokens: 2000 });
    const cleaned = stripCodeFences(llmResult.text);
    const parsed = JSON.parse(cleaned);
    chainData = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // Fallback: generate a basic chain
    chainData = [
      {
        level: 0,
        cause_type: 'direct',
        title: `${metricName} degraded to ${metricStatus}`,
        description: `The metric ${metricName} is currently at ${metricValue}, which is in ${metricStatus} status.`,
        confidence: 90,
        evidence: [`Current value: ${metricValue}`, `Status: ${metricStatus}`],
        related_metrics: [],
        recommended_fix: 'Review recent catalyst runs and insights for contributing factors.',
        fix_priority: metricStatus === 'red' ? 'high' : 'medium',
        fix_effort: 'medium',
      },
      {
        level: 1,
        cause_type: 'direct',
        title: 'Insufficient data for deep analysis',
        description: 'Unable to perform automated root-cause analysis. Manual investigation recommended.',
        confidence: 50,
        evidence: ['LLM analysis could not be completed'],
        related_metrics: [],
        recommended_fix: 'Review related catalyst runs and process metrics manually.',
        fix_priority: 'medium',
        fix_effort: 'medium',
      },
    ];
  }

  // Store the causal chain
  const causalChain: CausalChainLink[] = [];
  for (const link of chainData) {
    const chainId = crypto.randomUUID();
    const chainLink: CausalChainLink = {
      id: chainId,
      tenant_id: tenantId,
      analysis_id: analysisId,
      level: Math.min(5, Math.max(0, link.level || 0)),
      cause_type: (['direct', 'contributing', 'systemic', 'environmental', 'root'].includes(link.cause_type) ? link.cause_type : 'direct') as CausalChainLink['cause_type'],
      title: link.title || 'Unknown',
      description: link.description || '',
      confidence: Math.min(100, Math.max(0, link.confidence || 50)),
      evidence: link.evidence || [],
      related_metrics: link.related_metrics || [],
      recommended_fix: link.recommended_fix,
      fix_priority: (['critical', 'high', 'medium', 'low'].includes(link.fix_priority) ? link.fix_priority : 'medium') as CausalChainLink['fix_priority'],
      fix_effort: (['low', 'medium', 'high'].includes(link.fix_effort) ? link.fix_effort : 'medium') as CausalChainLink['fix_effort'],
      created_at: now,
    };

    await db.prepare(
      `INSERT INTO diagnostic_causal_chains (id, tenant_id, analysis_id, level, cause_type, title, description, confidence, evidence, related_metrics, recommended_fix, fix_priority, fix_effort, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      chainId, tenantId, analysisId, chainLink.level, chainLink.cause_type,
      chainLink.title, chainLink.description, chainLink.confidence,
      JSON.stringify(chainLink.evidence), JSON.stringify(chainLink.related_metrics),
      chainLink.recommended_fix || null, chainLink.fix_priority, chainLink.fix_effort, now,
    ).run();

    causalChain.push(chainLink);
  }

  // Update analysis status to completed
  const completedAt = new Date().toISOString();
  await db.prepare(
    "UPDATE diagnostic_analyses SET status = 'completed', completed_at = ? WHERE id = ?"
  ).bind(completedAt, analysisId).run();

  const analysis: DiagnosticAnalysis = {
    id: analysisId,
    tenant_id: tenantId,
    metric_id: metricId,
    metric_name: metricName,
    metric_value: metricValue,
    metric_status: metricStatus,
    trigger_type: triggerType,
    status: 'completed',
    created_at: now,
    completed_at: completedAt,
  };

  return { analysis, causalChain };
}

// ── Get Diagnostic Summary ──

export async function getDiagnosticSummary(
  db: D1Database,
  tenantId: string,
): Promise<DiagnosticSummary> {
  const totalRow = await db.prepare(
    'SELECT COUNT(*) as cnt FROM diagnostic_analyses WHERE tenant_id = ?'
  ).bind(tenantId).first<{ cnt: number }>();

  const pendingRow = await db.prepare(
    "SELECT COUNT(*) as cnt FROM diagnostic_analyses WHERE tenant_id = ? AND status IN ('pending', 'running')"
  ).bind(tenantId).first<{ cnt: number }>();

  const completedRow = await db.prepare(
    "SELECT COUNT(*) as cnt FROM diagnostic_analyses WHERE tenant_id = ? AND status = 'completed'"
  ).bind(tenantId).first<{ cnt: number }>();

  // Count metrics in red/amber that have no diagnostic analysis
  const undiagnosedRow = await db.prepare(
    `SELECT COUNT(DISTINCT kv.definition_id) as cnt FROM sub_catalyst_kpi_values kv
     LEFT JOIN diagnostic_analyses da ON da.metric_id = kv.definition_id AND da.tenant_id = kv.tenant_id
     WHERE kv.tenant_id = ? AND kv.status IN ('red', 'amber') AND da.id IS NULL`
  ).bind(tenantId).first<{ cnt: number }>();

  const criticalRow = await db.prepare(
    "SELECT COUNT(*) as cnt FROM diagnostic_causal_chains WHERE tenant_id = ? AND fix_priority = 'critical'"
  ).bind(tenantId).first<{ cnt: number }>();

  const activeFixRow = await db.prepare(
    "SELECT COUNT(*) as cnt FROM diagnostic_fix_tracking WHERE tenant_id = ? AND status IN ('accepted', 'in_progress')"
  ).bind(tenantId).first<{ cnt: number }>();

  return {
    totalAnalyses: totalRow?.cnt || 0,
    pendingAnalyses: pendingRow?.cnt || 0,
    completedAnalyses: completedRow?.cnt || 0,
    undiagnosedMetrics: undiagnosedRow?.cnt || 0,
    criticalFindings: criticalRow?.cnt || 0,
    activeFixes: activeFixRow?.cnt || 0,
  };
}

// ── Get Analysis with Causal Chain ──

export async function getAnalysisWithChain(
  db: D1Database,
  tenantId: string,
  analysisId: string,
): Promise<{ analysis: DiagnosticAnalysis | null; causalChain: CausalChainLink[]; fixes: FixTracking[] }> {
  const row = await db.prepare(
    'SELECT * FROM diagnostic_analyses WHERE id = ? AND tenant_id = ?'
  ).bind(analysisId, tenantId).first();

  if (!row) return { analysis: null, causalChain: [], fixes: [] };

  const analysis: DiagnosticAnalysis = {
    id: row.id as string,
    tenant_id: row.tenant_id as string,
    metric_id: row.metric_id as string,
    metric_name: row.metric_name as string,
    metric_value: row.metric_value as number,
    metric_status: row.metric_status as string,
    trigger_type: row.trigger_type as DiagnosticAnalysis['trigger_type'],
    status: row.status as DiagnosticAnalysis['status'],
    created_at: row.created_at as string,
    completed_at: row.completed_at as string | undefined,
  };

  const chainRows = await db.prepare(
    'SELECT * FROM diagnostic_causal_chains WHERE analysis_id = ? AND tenant_id = ? ORDER BY level ASC'
  ).bind(analysisId, tenantId).all();

  const causalChain: CausalChainLink[] = chainRows.results.map((c: Record<string, unknown>) => ({
    id: c.id as string,
    tenant_id: c.tenant_id as string,
    analysis_id: c.analysis_id as string,
    level: c.level as number,
    cause_type: c.cause_type as CausalChainLink['cause_type'],
    title: c.title as string,
    description: c.description as string,
    confidence: c.confidence as number,
    evidence: JSON.parse(c.evidence as string || '[]'),
    related_metrics: JSON.parse(c.related_metrics as string || '[]'),
    recommended_fix: c.recommended_fix as string | undefined,
    fix_priority: c.fix_priority as CausalChainLink['fix_priority'],
    fix_effort: c.fix_effort as CausalChainLink['fix_effort'],
    created_at: c.created_at as string,
  }));

  const fixRows = await db.prepare(
    'SELECT * FROM diagnostic_fix_tracking WHERE analysis_id = ? AND tenant_id = ? ORDER BY created_at DESC'
  ).bind(analysisId, tenantId).all();

  const fixes: FixTracking[] = fixRows.results.map((f: Record<string, unknown>) => ({
    id: f.id as string,
    tenant_id: f.tenant_id as string,
    chain_id: f.chain_id as string,
    analysis_id: f.analysis_id as string,
    status: f.status as FixTracking['status'],
    assigned_to: f.assigned_to as string | undefined,
    started_at: f.started_at as string | undefined,
    completed_at: f.completed_at as string | undefined,
    outcome: f.outcome as string | undefined,
    notes: f.notes as string | undefined,
    created_at: f.created_at as string,
  }));

  return { analysis, causalChain, fixes };
}

// ── List Analyses for Tenant ──

export async function listAnalyses(
  db: D1Database,
  tenantId: string,
  options?: { status?: string; limit?: number },
): Promise<DiagnosticAnalysis[]> {
  let query = 'SELECT * FROM diagnostic_analyses WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];

  if (options?.status) {
    query += ' AND status = ?';
    binds.push(options.status);
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  binds.push(options?.limit || 20);

  const rows = await db.prepare(query).bind(...binds).all();

  return rows.results.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    tenant_id: r.tenant_id as string,
    metric_id: r.metric_id as string,
    metric_name: r.metric_name as string,
    metric_value: r.metric_value as number,
    metric_status: r.metric_status as string,
    trigger_type: r.trigger_type as DiagnosticAnalysis['trigger_type'],
    status: r.status as DiagnosticAnalysis['status'],
    created_at: r.created_at as string,
    completed_at: r.completed_at as string | undefined,
  }));
}
