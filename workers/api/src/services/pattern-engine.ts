/**
 * Catalyst Intelligence — Pattern Engine
 * 
 * Analyses catalyst run history to discover patterns, calculate effectiveness,
 * and map cross-catalyst dependencies.
 * 
 * Features:
 * - Pattern discovery: recurring issues, seasonal trends, cascade failures
 * - Effectiveness tracking: success rates, match rates, ROI estimates per sub-catalyst
 * - Dependency mapping: data-flow and temporal dependencies between sub-catalysts
 */

import { loadLlmConfig, llmChatWithFallback, stripCodeFences } from './llm-provider';
import type { LlmMessage } from './llm-provider';

// ── Types ──

export interface CatalystPattern {
  id: string;
  tenant_id: string;
  pattern_type: 'recurring_issue' | 'seasonal_trend' | 'cascade_failure' | 'improvement_opportunity' | 'anomaly';
  title: string;
  description: string;
  frequency: number;
  first_seen: string;
  last_seen: string;
  affected_clusters: string[];
  affected_sub_catalysts: string[];
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'active' | 'resolved' | 'monitoring';
  recommended_actions: string[];
  created_at: string;
}

export interface CatalystEffectiveness {
  id: string;
  tenant_id: string;
  cluster_id: string;
  sub_catalyst_name: string;
  period_start: string;
  period_end: string;
  runs_count: number;
  success_rate: number;
  avg_match_rate: number;
  avg_duration_ms: number;
  total_value_processed: number;
  total_exceptions: number;
  improvement_trend: number;
  roi_estimate: number;
  created_at: string;
}

export interface CatalystDependency {
  id: string;
  tenant_id: string;
  source_cluster_id: string;
  source_sub_catalyst: string;
  target_cluster_id: string;
  target_sub_catalyst: string;
  dependency_type: 'data_flow' | 'temporal' | 'causal' | 'resource';
  strength: number;
  description?: string;
  discovered_at: string;
}

// ── Pattern Discovery ──

export async function discoverPatterns(
  db: D1Database,
  ai: Ai,
  tenantId: string,
): Promise<CatalystPattern[]> {
  // Get recent run history
  const runs = await db.prepare(
    'SELECT id, cluster_id, sub_catalyst_name, status, matched, discrepancies, exceptions_raised, total_source_value, started_at, completed_at FROM sub_catalyst_runs WHERE tenant_id = ? ORDER BY started_at DESC LIMIT 100'
  ).bind(tenantId).all();

  if (runs.results.length === 0) return [];

  // Get cluster info for context
  const clusters = await db.prepare(
    'SELECT id, name, domain, sub_catalysts FROM catalyst_clusters WHERE tenant_id = ?'
  ).bind(tenantId).all();

  // Get recent insights
  const insights = await db.prepare(
    'SELECT title, description, severity, category, domain FROM catalyst_insights WHERE tenant_id = ? ORDER BY generated_at DESC LIMIT 20'
  ).bind(tenantId).all();

  // Get existing patterns to avoid duplicates
  const existingPatterns = await db.prepare(
    "SELECT title, pattern_type FROM catalyst_patterns WHERE tenant_id = ? AND status = 'active'"
  ).bind(tenantId).all();

  const tenant = await db.prepare(
    'SELECT industry FROM tenants WHERE id = ?'
  ).bind(tenantId).first<{ industry: string }>();

  const llmConfig = await loadLlmConfig(db, tenantId);

  const runSummary = runs.results.slice(0, 30).map((r: Record<string, unknown>) =>
    `${r.sub_catalyst_name} [${r.status}]: matched=${r.matched}, disc=${r.discrepancies}, exc=${r.exceptions_raised}, val=${r.total_source_value}, at=${r.started_at}`
  ).join('\n');

  const clusterSummary = clusters.results.map((c: Record<string, unknown>) => {
    const subs = JSON.parse(c.sub_catalysts as string || '[]') as Array<{ name: string }>;
    return `${c.name} (${c.domain}): ${subs.map(s => s.name).join(', ')}`;
  }).join('\n');

  const insightSummary = insights.results.map((i: Record<string, unknown>) =>
    `[${i.severity}/${i.category}] ${i.title}`
  ).join('\n');

  const existingSummary = existingPatterns.results.map((p: Record<string, unknown>) =>
    `[${p.pattern_type}] ${p.title}`
  ).join('\n');

  const systemPrompt = `You are Atheon Intelligence, analysing catalyst execution patterns for a ${tenant?.industry || 'general'} business in South Africa.

Discover patterns in the run data. Look for:
- recurring_issue: same problem appearing across multiple runs
- seasonal_trend: patterns tied to time/cycles
- cascade_failure: one failure causing others
- improvement_opportunity: areas where small changes could yield big improvements
- anomaly: unusual deviations from expected behavior

Existing patterns (DO NOT duplicate): ${existingSummary || 'None'}

Return a JSON array of NEW patterns only:
[{
  "pattern_type": "recurring_issue|seasonal_trend|cascade_failure|improvement_opportunity|anomaly",
  "title": "short title",
  "description": "detailed description",
  "frequency": number_of_occurrences,
  "affected_clusters": ["cluster_id"],
  "affected_sub_catalysts": ["sub_catalyst_name"],
  "severity": "critical|high|medium|low",
  "recommended_actions": ["action1", "action2"]
}]

Respond ONLY with valid JSON array. If no new patterns found, return [].`;

  const userPrompt = `Run History (${runs.results.length} runs):
${runSummary}

Clusters:
${clusterSummary}

Recent Insights:
${insightSummary || 'None'}

Discover new patterns from this data.`;

  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let patternData: Array<{
    pattern_type: string;
    title: string;
    description: string;
    frequency: number;
    affected_clusters: string[];
    affected_sub_catalysts: string[];
    severity: string;
    recommended_actions: string[];
  }> = [];

  try {
    const llmResult = await llmChatWithFallback(llmConfig, ai, messages, { maxTokens: 1500 });
    const cleaned = stripCodeFences(llmResult.text);
    const parsed = JSON.parse(cleaned);
    patternData = Array.isArray(parsed) ? parsed : [];
  } catch {
    patternData = [];
  }

  const now = new Date().toISOString();
  const storedPatterns: CatalystPattern[] = [];

  for (const p of patternData) {
    const id = crypto.randomUUID();
    const validTypes = ['recurring_issue', 'seasonal_trend', 'cascade_failure', 'improvement_opportunity', 'anomaly'];
    const validSeverities = ['critical', 'high', 'medium', 'low'];

    const pattern: CatalystPattern = {
      id,
      tenant_id: tenantId,
      pattern_type: (validTypes.includes(p.pattern_type) ? p.pattern_type : 'recurring_issue') as CatalystPattern['pattern_type'],
      title: p.title || 'Unnamed Pattern',
      description: p.description || '',
      frequency: Math.max(1, p.frequency || 1),
      first_seen: now,
      last_seen: now,
      affected_clusters: p.affected_clusters || [],
      affected_sub_catalysts: p.affected_sub_catalysts || [],
      severity: (validSeverities.includes(p.severity) ? p.severity : 'medium') as CatalystPattern['severity'],
      status: 'active',
      recommended_actions: p.recommended_actions || [],
      created_at: now,
    };

    await db.prepare(
      `INSERT INTO catalyst_patterns (id, tenant_id, pattern_type, title, description, frequency, first_seen, last_seen, affected_clusters, affected_sub_catalysts, severity, status, recommended_actions, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, tenantId, pattern.pattern_type, pattern.title, pattern.description,
      pattern.frequency, pattern.first_seen, pattern.last_seen,
      JSON.stringify(pattern.affected_clusters), JSON.stringify(pattern.affected_sub_catalysts),
      pattern.severity, pattern.status, JSON.stringify(pattern.recommended_actions), now,
    ).run();

    storedPatterns.push(pattern);
  }

  return storedPatterns;
}

// ── Effectiveness Calculation ──

export async function calculateEffectiveness(
  db: D1Database,
  tenantId: string,
  periodDays: number = 30,
): Promise<CatalystEffectiveness[]> {
  const now = new Date();
  const periodStart = new Date(now.getTime() - periodDays * 86400000).toISOString();
  const periodEnd = now.toISOString();

  // Get all runs in the period grouped by cluster/sub-catalyst
  const runs = await db.prepare(
    `SELECT cluster_id, sub_catalyst_name, status, matched, discrepancies, exceptions_raised, total_source_value,
     CAST((julianday(COALESCE(completed_at, datetime('now'))) - julianday(started_at)) * 86400000 AS INTEGER) as duration_ms
     FROM sub_catalyst_runs WHERE tenant_id = ? AND started_at >= ? ORDER BY started_at DESC`
  ).bind(tenantId, periodStart).all();

  if (runs.results.length === 0) return [];

  // Group by cluster_id + sub_catalyst_name
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const r of runs.results) {
    const key = `${r.cluster_id}::${r.sub_catalyst_name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r as Record<string, unknown>);
  }

  const results: CatalystEffectiveness[] = [];

  for (const [key, groupRuns] of groups) {
    const [clusterId, subName] = key.split('::');
    const runsCount = groupRuns.length;
    const successRuns = groupRuns.filter(r => r.status === 'completed').length;
    const successRate = runsCount > 0 ? (successRuns / runsCount) * 100 : 0;

    const totalMatched = groupRuns.reduce((sum, r) => sum + (r.matched as number || 0), 0);
    const totalItems = groupRuns.reduce((sum, r) => sum + (r.matched as number || 0) + (r.discrepancies as number || 0), 0);
    const avgMatchRate = totalItems > 0 ? (totalMatched / totalItems) * 100 : 0;

    const totalDuration = groupRuns.reduce((sum, r) => sum + (r.duration_ms as number || 0), 0);
    const avgDuration = runsCount > 0 ? Math.round(totalDuration / runsCount) : 0;

    const totalValue = groupRuns.reduce((sum, r) => sum + (r.total_source_value as number || 0), 0);
    const totalExceptions = groupRuns.reduce((sum, r) => sum + (r.exceptions_raised as number || 0), 0);

    // Calculate improvement trend: compare first half vs second half of the period
    const midpoint = Math.floor(runsCount / 2);
    let trend = 0;
    if (runsCount >= 4) {
      const firstHalf = groupRuns.slice(midpoint);
      const secondHalf = groupRuns.slice(0, midpoint);
      const firstHalfSuccess = firstHalf.filter(r => r.status === 'completed').length / firstHalf.length;
      const secondHalfSuccess = secondHalf.filter(r => r.status === 'completed').length / secondHalf.length;
      trend = Math.round((secondHalfSuccess - firstHalfSuccess) * 100);
    }

    // Estimate ROI: value processed / (exceptions * avg fix cost estimate)
    const estimatedFixCost = 500; // ZAR per exception (simplified estimate)
    const roiEstimate = totalExceptions > 0 ? totalValue / (totalExceptions * estimatedFixCost) : totalValue > 0 ? 100 : 0;

    const id = crypto.randomUUID();
    const eff: CatalystEffectiveness = {
      id,
      tenant_id: tenantId,
      cluster_id: clusterId,
      sub_catalyst_name: subName,
      period_start: periodStart,
      period_end: periodEnd,
      runs_count: runsCount,
      success_rate: Math.round(successRate * 100) / 100,
      avg_match_rate: Math.round(avgMatchRate * 100) / 100,
      avg_duration_ms: avgDuration,
      total_value_processed: totalValue,
      total_exceptions: totalExceptions,
      improvement_trend: trend,
      roi_estimate: Math.round(roiEstimate * 100) / 100,
      created_at: new Date().toISOString(),
    };

    // Upsert effectiveness record
    await db.prepare(
      `INSERT INTO catalyst_effectiveness (id, tenant_id, cluster_id, sub_catalyst_name, period_start, period_end, runs_count, success_rate, avg_match_rate, avg_duration_ms, total_value_processed, total_exceptions, improvement_trend, roi_estimate, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, cluster_id, sub_catalyst_name, period_start) DO UPDATE SET
       runs_count = excluded.runs_count, success_rate = excluded.success_rate,
       avg_match_rate = excluded.avg_match_rate, avg_duration_ms = excluded.avg_duration_ms,
       total_value_processed = excluded.total_value_processed, total_exceptions = excluded.total_exceptions,
       improvement_trend = excluded.improvement_trend, roi_estimate = excluded.roi_estimate`
    ).bind(
      id, tenantId, clusterId, subName, periodStart, periodEnd,
      runsCount, eff.success_rate, eff.avg_match_rate, avgDuration,
      totalValue, totalExceptions, trend, eff.roi_estimate, eff.created_at,
    ).run();

    results.push(eff);
  }

  return results;
}

// ── Dependency Discovery ──

export async function discoverDependencies(
  db: D1Database,
  ai: Ai,
  tenantId: string,
): Promise<CatalystDependency[]> {
  // Get all clusters and their sub-catalysts
  const clusters = await db.prepare(
    'SELECT id, name, domain, sub_catalysts FROM catalyst_clusters WHERE tenant_id = ?'
  ).bind(tenantId).all();

  if (clusters.results.length < 2) return [];

  // Get recent runs to find temporal patterns
  const runs = await db.prepare(
    'SELECT cluster_id, sub_catalyst_name, status, started_at FROM sub_catalyst_runs WHERE tenant_id = ? ORDER BY started_at DESC LIMIT 50'
  ).bind(tenantId).all();

  // Get existing dependencies
  const existing = await db.prepare(
    'SELECT source_cluster_id, source_sub_catalyst, target_cluster_id, target_sub_catalyst FROM catalyst_dependencies WHERE tenant_id = ?'
  ).bind(tenantId).all();

  const existingSet = new Set(
    existing.results.map((d: Record<string, unknown>) =>
      `${d.source_cluster_id}::${d.source_sub_catalyst}::${d.target_cluster_id}::${d.target_sub_catalyst}`
    )
  );

  const tenant = await db.prepare(
    'SELECT industry FROM tenants WHERE id = ?'
  ).bind(tenantId).first<{ industry: string }>();

  const llmConfig = await loadLlmConfig(db, tenantId);

  const clusterSummary = clusters.results.map((c: Record<string, unknown>) => {
    const subs = JSON.parse(c.sub_catalysts as string || '[]') as Array<{ name: string; description?: string }>;
    return `Cluster: ${c.name} (${c.domain}, id: ${c.id})\n  Sub-catalysts: ${subs.map(s => `${s.name}${s.description ? ` - ${s.description}` : ''}`).join('; ')}`;
  }).join('\n');

  const runSummary = runs.results.slice(0, 20).map((r: Record<string, unknown>) =>
    `${r.sub_catalyst_name} in cluster ${r.cluster_id}: ${r.status} at ${r.started_at}`
  ).join('\n');

  const systemPrompt = `You are Atheon Intelligence, mapping dependencies between catalyst sub-processes for a ${tenant?.industry || 'general'} business.

Identify dependencies where one sub-catalyst's output feeds into another, or where they must run in sequence.

Dependency types:
- data_flow: output of one is input to another
- temporal: one must run before another
- causal: failure in one causes issues in another
- resource: they compete for the same resource

Return JSON array:
[{
  "source_cluster_id": "cluster_id",
  "source_sub_catalyst": "name",
  "target_cluster_id": "cluster_id",
  "target_sub_catalyst": "name",
  "dependency_type": "data_flow|temporal|causal|resource",
  "strength": 0-100,
  "description": "why this dependency exists"
}]

Return [] if no dependencies found. Do NOT return self-dependencies.`;

  const userPrompt = `Clusters and Sub-catalysts:
${clusterSummary}

Recent Execution History:
${runSummary || 'No runs yet'}

Identify cross-catalyst dependencies.`;

  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let depData: Array<{
    source_cluster_id: string;
    source_sub_catalyst: string;
    target_cluster_id: string;
    target_sub_catalyst: string;
    dependency_type: string;
    strength: number;
    description?: string;
  }> = [];

  try {
    const llmResult = await llmChatWithFallback(llmConfig, ai, messages, { maxTokens: 1200 });
    const cleaned = stripCodeFences(llmResult.text);
    const parsed = JSON.parse(cleaned);
    depData = Array.isArray(parsed) ? parsed : [];
  } catch {
    depData = [];
  }

  const now = new Date().toISOString();
  const stored: CatalystDependency[] = [];

  for (const d of depData) {
    const key = `${d.source_cluster_id}::${d.source_sub_catalyst}::${d.target_cluster_id}::${d.target_sub_catalyst}`;
    if (existingSet.has(key)) continue;
    if (d.source_cluster_id === d.target_cluster_id && d.source_sub_catalyst === d.target_sub_catalyst) continue;

    const validTypes = ['data_flow', 'temporal', 'causal', 'resource'];
    const id = crypto.randomUUID();

    const dep: CatalystDependency = {
      id,
      tenant_id: tenantId,
      source_cluster_id: d.source_cluster_id,
      source_sub_catalyst: d.source_sub_catalyst,
      target_cluster_id: d.target_cluster_id,
      target_sub_catalyst: d.target_sub_catalyst,
      dependency_type: (validTypes.includes(d.dependency_type) ? d.dependency_type : 'data_flow') as CatalystDependency['dependency_type'],
      strength: Math.min(100, Math.max(0, d.strength || 50)),
      description: d.description,
      discovered_at: now,
    };

    try {
      await db.prepare(
        `INSERT INTO catalyst_dependencies (id, tenant_id, source_cluster_id, source_sub_catalyst, target_cluster_id, target_sub_catalyst, dependency_type, strength, description, discovered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id, tenantId, dep.source_cluster_id, dep.source_sub_catalyst,
        dep.target_cluster_id, dep.target_sub_catalyst,
        dep.dependency_type, dep.strength, dep.description || null, now,
      ).run();

      stored.push(dep);
    } catch {
      // Skip if foreign key constraint fails (invalid cluster_id)
    }
  }

  return stored;
}

// ── Get Patterns ──

export async function getPatterns(
  db: D1Database,
  tenantId: string,
  options?: { status?: string; type?: string; limit?: number },
): Promise<CatalystPattern[]> {
  let query = 'SELECT * FROM catalyst_patterns WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];

  if (options?.status) {
    query += ' AND status = ?';
    binds.push(options.status);
  }
  if (options?.type) {
    query += ' AND pattern_type = ?';
    binds.push(options.type);
  }

  query += ' ORDER BY CASE severity WHEN \'critical\' THEN 1 WHEN \'high\' THEN 2 WHEN \'medium\' THEN 3 ELSE 4 END, last_seen DESC LIMIT ?';
  binds.push(options?.limit || 20);

  const rows = await db.prepare(query).bind(...binds).all();

  return rows.results.map((p: Record<string, unknown>) => ({
    id: p.id as string,
    tenant_id: p.tenant_id as string,
    pattern_type: p.pattern_type as CatalystPattern['pattern_type'],
    title: p.title as string,
    description: p.description as string,
    frequency: p.frequency as number,
    first_seen: p.first_seen as string,
    last_seen: p.last_seen as string,
    affected_clusters: JSON.parse(p.affected_clusters as string || '[]'),
    affected_sub_catalysts: JSON.parse(p.affected_sub_catalysts as string || '[]'),
    severity: p.severity as CatalystPattern['severity'],
    status: p.status as CatalystPattern['status'],
    recommended_actions: JSON.parse(p.recommended_actions as string || '[]'),
    created_at: p.created_at as string,
  }));
}

// ── Get Effectiveness Data ──

export async function getEffectiveness(
  db: D1Database,
  tenantId: string,
  clusterId?: string,
): Promise<CatalystEffectiveness[]> {
  let query = 'SELECT * FROM catalyst_effectiveness WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];

  if (clusterId) {
    query += ' AND cluster_id = ?';
    binds.push(clusterId);
  }

  query += ' ORDER BY period_start DESC';

  const rows = await db.prepare(query).bind(...binds).all();

  return rows.results.map((e: Record<string, unknown>) => ({
    id: e.id as string,
    tenant_id: e.tenant_id as string,
    cluster_id: e.cluster_id as string,
    sub_catalyst_name: e.sub_catalyst_name as string,
    period_start: e.period_start as string,
    period_end: e.period_end as string,
    runs_count: e.runs_count as number,
    success_rate: e.success_rate as number,
    avg_match_rate: e.avg_match_rate as number,
    avg_duration_ms: e.avg_duration_ms as number,
    total_value_processed: e.total_value_processed as number,
    total_exceptions: e.total_exceptions as number,
    improvement_trend: e.improvement_trend as number,
    roi_estimate: e.roi_estimate as number,
    created_at: e.created_at as string,
  }));
}

// ── Get Dependencies ──

export async function getDependencies(
  db: D1Database,
  tenantId: string,
  clusterId?: string,
): Promise<CatalystDependency[]> {
  let query = 'SELECT * FROM catalyst_dependencies WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];

  if (clusterId) {
    query += ' AND (source_cluster_id = ? OR target_cluster_id = ?)';
    binds.push(clusterId, clusterId);
  }

  query += ' ORDER BY strength DESC';

  const rows = await db.prepare(query).bind(...binds).all();

  return rows.results.map((d: Record<string, unknown>) => ({
    id: d.id as string,
    tenant_id: d.tenant_id as string,
    source_cluster_id: d.source_cluster_id as string,
    source_sub_catalyst: d.source_sub_catalyst as string,
    target_cluster_id: d.target_cluster_id as string,
    target_sub_catalyst: d.target_sub_catalyst as string,
    dependency_type: d.dependency_type as CatalystDependency['dependency_type'],
    strength: d.strength as number,
    description: d.description as string | undefined,
    discovered_at: d.discovered_at as string,
  }));
}
