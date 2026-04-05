/**
 * Apex Radar Engine
 * 
 * External signal processing and strategic context engine.
 * Ingests external signals (regulatory changes, market shifts, competitor moves),
 * uses LLM to assess impact on health dimensions, and builds strategic context.
 * 
 * All LLM calls use the configurable provider abstraction (llm-provider.ts).
 * The platform NEVER exposes which model/provider is being used.
 */

import { loadLlmConfig, llmChatWithFallback, stripCodeFences } from './llm-provider';
import type { LlmMessage } from './llm-provider';

// ── Types ──

export interface RadarSignal {
  id: string;
  tenant_id: string;
  source: string;
  signal_type: 'regulatory' | 'market' | 'competitor' | 'economic' | 'technology' | 'geopolitical';
  title: string;
  description: string;
  url?: string;
  raw_data: Record<string, unknown>;
  severity: 'critical' | 'high' | 'medium' | 'low';
  relevance_score: number;
  status: 'new' | 'analysed' | 'dismissed' | 'expired';
  detected_at: string;
  expires_at?: string;
  created_at: string;
}

export interface SignalImpact {
  id: string;
  tenant_id: string;
  signal_id: string;
  dimension: string;
  impact_direction: 'positive' | 'negative' | 'neutral';
  impact_magnitude: number;
  affected_metrics: string[];
  recommended_actions: string[];
  llm_reasoning: string;
  created_at: string;
}

export interface StrategicContext {
  id: string;
  tenant_id: string;
  context_type: 'macro' | 'industry' | 'competitive' | 'regulatory';
  title: string;
  summary: string;
  factors: Array<{ name: string; direction: string; magnitude: number }>;
  sentiment: 'positive' | 'negative' | 'neutral' | 'mixed';
  confidence: number;
  source_signal_ids: string[];
  valid_from: string;
  valid_to?: string;
  created_at: string;
}

// ── Signal Impact Analysis (LLM-powered) ──

export async function analyseSignalImpact(
  db: D1Database,
  ai: Ai,
  tenantId: string,
  signalId: string,
): Promise<SignalImpact[]> {
  // Load the signal
  const signal = await db.prepare(
    'SELECT * FROM radar_signals WHERE id = ? AND tenant_id = ?'
  ).bind(signalId, tenantId).first();

  if (!signal) throw new Error('Signal not found');

  // Get current health dimensions for context
  const health = await db.prepare(
    'SELECT dimensions FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(tenantId).first<{ dimensions: string }>();

  const dimensions = health?.dimensions ? JSON.parse(health.dimensions) : {};

  // Get tenant industry for context
  const tenant = await db.prepare(
    'SELECT industry FROM tenants WHERE id = ?'
  ).bind(tenantId).first<{ industry: string }>();

  const llmConfig = await loadLlmConfig(db, tenantId);

  const systemPrompt = `You are Atheon Intelligence, an enterprise strategic analysis engine.
Analyse the impact of an external signal on business health dimensions.
The company operates in the ${tenant?.industry || 'general'} industry in South Africa.

Current health dimensions: ${JSON.stringify(dimensions)}

For each affected dimension, provide:
- dimension: one of [financial, operational, compliance, strategic, technology, risk]
- impact_direction: positive, negative, or neutral
- impact_magnitude: 0-100 (how severe the impact)
- affected_metrics: list of metric names that could be affected
- recommended_actions: list of 1-3 concrete actions to take

Respond ONLY with valid JSON array. No markdown, no explanation.`;

  const userPrompt = `Signal: ${signal.title}
Type: ${signal.signal_type}
Description: ${signal.description}
Severity: ${signal.severity}
Source: ${signal.source}
${signal.url ? `URL: ${signal.url}` : ''}

Analyse the impact on our business dimensions and provide recommendations.`;

  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const llmResult = await llmChatWithFallback(llmConfig, ai, messages, { maxTokens: 1500 });
  const cleaned = stripCodeFences(llmResult.text);

  let impacts: Array<{
    dimension: string;
    impact_direction: string;
    impact_magnitude: number;
    affected_metrics: string[];
    recommended_actions: string[];
  }> = [];

  try {
    impacts = JSON.parse(cleaned);
    if (!Array.isArray(impacts)) impacts = [impacts];
  } catch {
    // Fallback: create a single generic impact based on signal severity
    const severityToMagnitude: Record<string, number> = { critical: 80, high: 60, medium: 40, low: 20 };
    impacts = [{
      dimension: 'strategic',
      impact_direction: 'negative',
      impact_magnitude: severityToMagnitude[signal.severity as string] || 40,
      affected_metrics: [],
      recommended_actions: ['Review signal details and assess business impact manually'],
    }];
  }

  const storedImpacts: SignalImpact[] = [];

  for (const impact of impacts) {
    const id = crypto.randomUUID();
    const impactRecord: SignalImpact = {
      id,
      tenant_id: tenantId,
      signal_id: signalId,
      dimension: impact.dimension || 'strategic',
      impact_direction: (impact.impact_direction as 'positive' | 'negative' | 'neutral') || 'negative',
      impact_magnitude: Math.min(100, Math.max(0, impact.impact_magnitude || 0)),
      affected_metrics: impact.affected_metrics || [],
      recommended_actions: impact.recommended_actions || [],
      llm_reasoning: llmResult.text.substring(0, 2000),
      created_at: new Date().toISOString(),
    };

    await db.prepare(
      `INSERT INTO radar_signal_impacts (id, tenant_id, signal_id, dimension, impact_direction, impact_magnitude, affected_metrics, recommended_actions, llm_reasoning, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, tenantId, signalId, impactRecord.dimension, impactRecord.impact_direction,
      impactRecord.impact_magnitude, JSON.stringify(impactRecord.affected_metrics),
      JSON.stringify(impactRecord.recommended_actions), impactRecord.llm_reasoning,
      impactRecord.created_at,
    ).run();

    storedImpacts.push(impactRecord);
  }

  // Update signal status to 'analysed'
  await db.prepare(
    "UPDATE radar_signals SET status = 'analysed' WHERE id = ? AND tenant_id = ?"
  ).bind(signalId, tenantId).run();

  return storedImpacts;
}

// ── Strategic Context Builder ──

export async function buildStrategicContext(
  db: D1Database,
  ai: Ai,
  tenantId: string,
): Promise<StrategicContext> {
  // Gather recent analysed signals
  const signals = await db.prepare(
    "SELECT id, title, signal_type, description, severity, relevance_score FROM radar_signals WHERE tenant_id = ? AND status = 'analysed' ORDER BY detected_at DESC LIMIT 20"
  ).bind(tenantId).all();

  // Gather recent impacts
  const impacts = await db.prepare(
    'SELECT dimension, impact_direction, impact_magnitude, recommended_actions FROM radar_signal_impacts WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50'
  ).bind(tenantId).all();

  // Get health score
  const health = await db.prepare(
    'SELECT overall_score, dimensions FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(tenantId).first<{ overall_score: number; dimensions: string }>();

  // Get active risks
  const risks = await db.prepare(
    "SELECT title, severity, category FROM risk_alerts WHERE tenant_id = ? AND status = 'active' ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END LIMIT 5"
  ).bind(tenantId).all();

  const tenant = await db.prepare(
    'SELECT industry FROM tenants WHERE id = ?'
  ).bind(tenantId).first<{ industry: string }>();

  const llmConfig = await loadLlmConfig(db, tenantId);

  const signalSummary = signals.results.map((s: Record<string, unknown>) =>
    `[${s.signal_type}/${s.severity}] ${s.title}`
  ).join('\n');

  const impactSummary = impacts.results.map((i: Record<string, unknown>) =>
    `${i.dimension}: ${i.impact_direction} (magnitude: ${i.impact_magnitude})`
  ).join('\n');

  const riskSummary = risks.results.map((r: Record<string, unknown>) =>
    `[${r.severity}] ${r.title} (${r.category})`
  ).join('\n');

  const systemPrompt = `You are Atheon Intelligence, providing strategic context analysis for a ${tenant?.industry || 'general'} business in South Africa.

Synthesize the following signals, impacts, health data, and risks into a strategic context briefing.

Respond with valid JSON:
{
  "title": "Strategic Context Summary title",
  "summary": "2-3 paragraph executive summary",
  "factors": [{"name": "factor name", "direction": "positive|negative|neutral", "magnitude": 0-100}],
  "sentiment": "positive|negative|neutral|mixed",
  "confidence": 0-100
}`;

  const userPrompt = `Signals (${signals.results.length}):
${signalSummary || 'No recent signals'}

Impact Analysis:
${impactSummary || 'No impact data'}

Health Score: ${health?.overall_score || 'N/A'}/100
Dimensions: ${health?.dimensions || '{}'}

Active Risks:
${riskSummary || 'No active risks'}

Provide a strategic context briefing.`;

  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const llmResult = await llmChatWithFallback(llmConfig, ai, messages, { maxTokens: 1500 });
  const cleaned = stripCodeFences(llmResult.text);

  let parsed: { title?: string; summary?: string; factors?: Array<{ name: string; direction: string; magnitude: number }>; sentiment?: string; confidence?: number } = {};
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = {
      title: 'Strategic Context Summary',
      summary: `Based on ${signals.results.length} recent signals and current health score of ${health?.overall_score || 0}/100. ${risks.results.length} active risks require attention.`,
      factors: [],
      sentiment: 'neutral',
      confidence: 50,
    };
  }

  const signalIds = signals.results.map((s: Record<string, unknown>) => s.id as string);

  const id = crypto.randomUUID();
  const context: StrategicContext = {
    id,
    tenant_id: tenantId,
    context_type: 'macro',
    title: parsed.title || 'Strategic Context Summary',
    summary: parsed.summary || '',
    factors: parsed.factors || [],
    sentiment: (parsed.sentiment as StrategicContext['sentiment']) || 'neutral',
    confidence: Math.min(100, Math.max(0, parsed.confidence || 50)),
    source_signal_ids: signalIds,
    valid_from: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };

  await db.prepare(
    `INSERT INTO radar_strategic_context (id, tenant_id, context_type, title, summary, factors, sentiment, confidence, source_signal_ids, valid_from, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, tenantId, context.context_type, context.title, context.summary,
    JSON.stringify(context.factors), context.sentiment, context.confidence,
    JSON.stringify(context.source_signal_ids), context.valid_from, context.created_at,
  ).run();

  return context;
}

// ── Get Full Strategic Context (for API) ──

export async function getStrategicContext(
  db: D1Database,
  tenantId: string,
): Promise<{
  context: StrategicContext | null;
  signals: RadarSignal[];
  impacts: SignalImpact[];
  summary: { totalSignals: number; activeSignals: number; criticalImpacts: number; overallSentiment: string };
}> {
  // Latest context
  const ctxRow = await db.prepare(
    'SELECT * FROM radar_strategic_context WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(tenantId).first();

  const context: StrategicContext | null = ctxRow ? {
    id: ctxRow.id as string,
    tenant_id: ctxRow.tenant_id as string,
    context_type: ctxRow.context_type as StrategicContext['context_type'],
    title: ctxRow.title as string,
    summary: ctxRow.summary as string,
    factors: JSON.parse(ctxRow.factors as string || '[]'),
    sentiment: ctxRow.sentiment as StrategicContext['sentiment'],
    confidence: ctxRow.confidence as number,
    source_signal_ids: JSON.parse(ctxRow.source_signal_ids as string || '[]'),
    valid_from: ctxRow.valid_from as string,
    valid_to: ctxRow.valid_to as string | undefined,
    created_at: ctxRow.created_at as string,
  } : null;

  // Recent signals
  const signalRows = await db.prepare(
    'SELECT * FROM radar_signals WHERE tenant_id = ? ORDER BY detected_at DESC LIMIT 20'
  ).bind(tenantId).all();

  const signals: RadarSignal[] = signalRows.results.map((s: Record<string, unknown>) => ({
    id: s.id as string,
    tenant_id: s.tenant_id as string,
    source: s.source as string,
    signal_type: s.signal_type as RadarSignal['signal_type'],
    title: s.title as string,
    description: s.description as string,
    url: s.url as string | undefined,
    raw_data: JSON.parse(s.raw_data as string || '{}'),
    severity: s.severity as RadarSignal['severity'],
    relevance_score: s.relevance_score as number,
    status: s.status as RadarSignal['status'],
    detected_at: s.detected_at as string,
    expires_at: s.expires_at as string | undefined,
    created_at: s.created_at as string,
  }));

  // Recent impacts
  const impactRows = await db.prepare(
    'SELECT * FROM radar_signal_impacts WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50'
  ).bind(tenantId).all();

  const impacts: SignalImpact[] = impactRows.results.map((i: Record<string, unknown>) => ({
    id: i.id as string,
    tenant_id: i.tenant_id as string,
    signal_id: i.signal_id as string,
    dimension: i.dimension as string,
    impact_direction: i.impact_direction as SignalImpact['impact_direction'],
    impact_magnitude: i.impact_magnitude as number,
    affected_metrics: JSON.parse(i.affected_metrics as string || '[]'),
    recommended_actions: JSON.parse(i.recommended_actions as string || '[]'),
    llm_reasoning: i.llm_reasoning as string,
    created_at: i.created_at as string,
  }));

  // Summary counts
  const totalSignals = signals.length;
  const activeSignals = signals.filter(s => s.status === 'new' || s.status === 'analysed').length;
  const criticalImpacts = impacts.filter(i => i.impact_magnitude >= 70).length;
  const overallSentiment = context?.sentiment || 'neutral';

  return {
    context,
    signals,
    impacts,
    summary: { totalSignals, activeSignals, criticalImpacts, overallSentiment },
  };
}
