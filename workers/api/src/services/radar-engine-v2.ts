/**
 * Apex Radar Engine V2
 * 
 * External signal processing with competitors, benchmarks, regulatory events,
 * and unified strategic context. Uses the V2 schema tables:
 * external_signals, signal_impacts, competitors, market_benchmarks, regulatory_events
 */

import { loadLlmConfig, llmChatWithFallback, stripCodeFences } from './llm-provider';
import type { LlmMessage } from './llm-provider';
import { createNotification } from './notifications';

// ── analyseSignalImpact ──

export async function analyseSignalImpact(
  db: D1Database,
  tenantId: string,
  signalId: string,
  env: { AI: Ai },
): Promise<void> {
  const signal = await db.prepare(
    'SELECT * FROM external_signals WHERE id = ? AND tenant_id = ?'
  ).bind(signalId, tenantId).first();
  if (!signal) throw new Error('Signal not found');

  const health = await db.prepare(
    'SELECT dimensions FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(tenantId).first<{ dimensions: string }>();
  const dimensions = health?.dimensions ? JSON.parse(health.dimensions) : {};

  const llmConfig = await loadLlmConfig(db, tenantId);
  const messages: LlmMessage[] = [
    {
      role: 'system',
      content: `You are Atheon Intelligence. Given this external signal and business health dimensions with scores, determine for EACH affected dimension: 1) impact_magnitude 1-10, 2) direction headwind or tailwind, 3) timeline immediate/near-term/strategic, 4) recommended_response. Respond ONLY in JSON: { "impacts": [{ "dimension": "", "magnitude": 1, "direction": "headwind", "timeline": "near-term", "response": "" }] }`,
    },
    {
      role: 'user',
      content: `Signal: ${signal.title}\nSummary: ${signal.summary}\nCategory: ${signal.category}\n\nHealth dimensions: ${JSON.stringify(dimensions)}`,
    },
  ];

  const llmResult = await llmChatWithFallback(llmConfig, env.AI, messages, { maxTokens: 1200 });
  const cleaned = stripCodeFences(llmResult.text);

  let impacts: Array<{ dimension: string; magnitude: number; direction: string; timeline: string; response: string }> = [];
  try {
    const parsed = JSON.parse(cleaned);
    impacts = parsed.impacts || (Array.isArray(parsed) ? parsed : []);
  } catch {
    impacts = [{ dimension: 'strategic', magnitude: 5, direction: 'headwind', timeline: 'near-term', response: 'Review signal and assess impact manually' }];
  }

  let maxMag = 0;
  for (const imp of impacts) {
    const id = crypto.randomUUID();
    const mag = Math.min(10, Math.max(1, imp.magnitude || 5));
    if (mag > maxMag) maxMag = mag;
    await db.prepare(
      `INSERT INTO signal_impacts (id, signal_id, tenant_id, health_dimension, impact_magnitude, impact_direction, impact_timeline, confidence, recommended_response, analysis, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(
      id, signalId, tenantId,
      imp.dimension || 'strategic',
      mag,
      imp.direction === 'tailwind' ? 'tailwind' : 'headwind',
      imp.timeline || 'near-term',
      0.7,
      imp.response || null,
      JSON.stringify(imp),
    ).run();
  }

  // Update relevance_score = max magnitude / 10
  await db.prepare(
    'UPDATE external_signals SET relevance_score = ? WHERE id = ? AND tenant_id = ?'
  ).bind(maxMag / 10, signalId, tenantId).run();

  // §9.1.1 — Auto-triggered notification: critical signal (magnitude >= 8)
  if (maxMag >= 8) {
    try {
      await createNotification(db, {
        tenantId,
        type: 'alert',
        title: `Critical External Signal: ${signal.title}`,
        message: `High-impact ${signal.category} signal detected (magnitude ${maxMag}/10). Affects: ${impacts.map(i => i.dimension).join(', ')}.`,
        severity: 'critical',
        actionUrl: '/apex?tab=context',
        metadata: { signalId, category: signal.category as string },
      });
    } catch { /* non-fatal */ }
  }
}

// ── computeStrategicContext ──

export async function computeStrategicContext(
  db: D1Database,
  tenantId: string,
  env: { AI: Ai },
): Promise<Record<string, unknown>> {
  const health = await db.prepare(
    'SELECT overall_score, dimensions FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(tenantId).first<{ overall_score: number; dimensions: string }>();

  const headwindsResult = await db.prepare(
    "SELECT si.*, es.title as signal_title, es.category FROM signal_impacts si JOIN external_signals es ON si.signal_id = es.id WHERE si.tenant_id = ? AND si.impact_direction = 'headwind' ORDER BY si.impact_magnitude DESC"
  ).bind(tenantId).all();

  const tailwindsResult = await db.prepare(
    "SELECT si.*, es.title as signal_title, es.category FROM signal_impacts si JOIN external_signals es ON si.signal_id = es.id WHERE si.tenant_id = ? AND si.impact_direction = 'tailwind' ORDER BY si.impact_magnitude DESC"
  ).bind(tenantId).all();

  const compCountRow = await db.prepare(
    'SELECT COUNT(*) as cnt FROM competitors WHERE tenant_id = ?'
  ).bind(tenantId).first<{ cnt: number }>();

  const regEvents = await db.prepare(
    "SELECT * FROM regulatory_events WHERE tenant_id = ? AND status = 'upcoming' AND compliance_deadline IS NOT NULL AND julianday(compliance_deadline) - julianday('now') < 90 ORDER BY compliance_deadline ASC"
  ).bind(tenantId).all();

  const topSignals = await db.prepare(
    'SELECT * FROM external_signals WHERE tenant_id = ? ORDER BY relevance_score DESC LIMIT 5'
  ).bind(tenantId).all();

  const benchmarks = await db.prepare(
    'SELECT * FROM market_benchmarks WHERE tenant_id = ? ORDER BY measured_at DESC LIMIT 5'
  ).bind(tenantId).all();

  // tenants.industry is intentionally dropped by migrate.ts — reading it here
  // would throw "no such column: industry" at runtime. The narrative bucket is
  // global-only for now; revisit once the aggregator buckets per-tenant.
  const tenant: { industry: string } = { industry: 'general' };

  // Compute industry benchmark score from market_benchmarks
  let industryBenchmark = 0;
  if (benchmarks.results.length > 0) {
    industryBenchmark = Math.round(
      benchmarks.results.reduce((s, b) => s + (b.benchmark_value as number || 0), 0) / benchmarks.results.length
    );
  }

  // Generate narrative via LLM
  const llmConfig = await loadLlmConfig(db, tenantId);
  const narrativeMessages: LlmMessage[] = [
    {
      role: 'system',
      content: 'You are Atheon Intelligence. Summarise in ONE sentence the strategic context.',
    },
    {
      role: 'user',
      content: `Health ${health?.overall_score || 0}/100, ${headwindsResult.results.length} headwinds, ${tailwindsResult.results.length} tailwinds, ${compCountRow?.cnt || 0} competitors tracked, ${regEvents.results.length} regulatory deadlines approaching. Industry: ${tenant?.industry || 'general'}. Top signal: ${topSignals.results[0]?.title || 'none'}.`,
    },
  ];

  let contextNarrative = '';
  try {
    const narrativeResult = await llmChatWithFallback(llmConfig, env.AI, narrativeMessages, { maxTokens: 200 });
    contextNarrative = narrativeResult.text.trim();
  } catch {
    contextNarrative = `Business health at ${health?.overall_score || 0}/100 with ${headwindsResult.results.length} headwinds and ${tailwindsResult.results.length} tailwinds requiring attention.`;
  }

  const mapImpact = (r: Record<string, unknown>) => ({
    id: r.id as string,
    signalId: r.signal_id as string,
    signalTitle: r.signal_title as string,
    category: r.category as string,
    healthDimension: r.health_dimension as string,
    impactMagnitude: r.impact_magnitude as number,
    impactDirection: r.impact_direction as string,
    impactTimeline: r.impact_timeline as string,
    confidence: r.confidence as number,
    recommendedResponse: r.recommended_response as string,
  });

  return {
    healthScore: health?.overall_score || 0,
    industryBenchmark,
    headwinds: headwindsResult.results.map(mapImpact),
    tailwinds: tailwindsResult.results.map(mapImpact),
    competitorCount: compCountRow?.cnt || 0,
    regulatoryDeadlines: regEvents.results.map((e: Record<string, unknown>) => ({
      id: e.id as string,
      title: e.title as string,
      complianceDeadline: e.compliance_deadline as string,
      readinessScore: e.readiness_score as number,
    })),
    topSignals: topSignals.results.map((s: Record<string, unknown>) => ({
      id: s.id as string,
      category: s.category as string,
      title: s.title as string,
      summary: s.summary as string,
      relevanceScore: s.relevance_score as number,
    })),
    contextNarrative,
  };
}

// ── runScheduledRadarScan ──

export async function runScheduledRadarScan(
  db: D1Database,
  tenantId: string,
  env: { AI: Ai },
): Promise<void> {
  // Find signals without impacts
  const unanalysed = await db.prepare(
    `SELECT es.id FROM external_signals es
     LEFT JOIN signal_impacts si ON si.signal_id = es.id
     WHERE es.tenant_id = ? AND si.id IS NULL
     AND es.detected_at >= datetime('now', '-1 day')`
  ).bind(tenantId).all();

  for (const row of unanalysed.results) {
    try {
      await analyseSignalImpact(db, tenantId, row.id as string, env);
    } catch (err) {
      console.error(`Radar scan: failed to analyse signal ${row.id}:`, err);
    }
  }

  // Recompute context (we don't store it, it's computed on demand via GET /context)
}
