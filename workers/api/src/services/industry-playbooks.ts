/**
 * Industry Playbooks Service
 * 
 * Seeds tenant Radar with industry-specific signals, benchmarks, and regulatory events
 * during onboarding.
 */

import { analyseSignalImpact } from './radar-engine-v2';

export async function seedIndustryRadar(
  db: D1Database,
  tenantId: string,
  industry: string,
  env: { AI: Ai },
): Promise<{ signals: number; benchmarks: number; regulatory: number }> {
  let signalsCreated = 0;
  let benchmarksCreated = 0;
  let regulatoryCreated = 0;

  // Seed signals from industry_radar_seeds
  const signalSeeds = await db.prepare(
    'SELECT * FROM industry_radar_seeds WHERE industry = ? OR industry = ?'
  ).bind(industry, 'general').all();

  for (const seed of signalSeeds.results) {
    const signalId = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO external_signals (id, tenant_id, category, title, summary, source_name, reliability_score, relevance_score, sentiment, detected_at)
       VALUES (?, ?, ?, ?, ?, ?, 0.7, 0.5, 'neutral', datetime('now'))`
    ).bind(
      signalId, tenantId,
      seed.category as string,
      seed.title as string,
      seed.summary as string,
      seed.source_name as string || 'Industry Playbook',
    ).run();
    signalsCreated++;

    // Auto-analyse signal impact
    try {
      await analyseSignalImpact(db, tenantId, signalId, env);
    } catch {
      // Non-critical — signal is created even if analysis fails
    }
  }

  // Seed benchmarks from industry_benchmark_seeds
  const benchmarkSeeds = await db.prepare(
    'SELECT * FROM industry_benchmark_seeds WHERE industry = ? OR industry = ?'
  ).bind(industry, 'general').all();

  for (const seed of benchmarkSeeds.results) {
    const bmId = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO market_benchmarks (id, tenant_id, industry, metric_name, benchmark_value, benchmark_unit, percentile_25, percentile_50, percentile_75, source, measured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(
      bmId, tenantId,
      seed.industry as string,
      seed.metric_name as string,
      seed.benchmark_value as number,
      seed.benchmark_unit as string || null,
      seed.percentile_25 as number || null,
      seed.percentile_50 as number || null,
      seed.percentile_75 as number || null,
      seed.source as string || null,
    ).run();
    benchmarksCreated++;
  }

  // Seed regulatory events from industry_regulatory_seeds
  const regSeeds = await db.prepare(
    'SELECT * FROM industry_regulatory_seeds WHERE industry = ? OR industry = ?'
  ).bind(industry, 'general').all();

  for (const seed of regSeeds.results) {
    const regId = crypto.randomUUID();
    // Calculate a deadline based on typical_deadline_month
    const month = (seed.typical_deadline_month as number) || 3;
    const now = new Date();
    const deadlineDate = new Date(now.getFullYear(), month - 1, 28);
    if (deadlineDate < now) deadlineDate.setFullYear(deadlineDate.getFullYear() + 1);

    await db.prepare(
      `INSERT INTO regulatory_events (id, tenant_id, title, description, jurisdiction, affected_dimensions, effective_date, compliance_deadline, readiness_score, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'upcoming')`
    ).bind(
      regId, tenantId,
      seed.title as string,
      seed.description as string,
      seed.jurisdiction as string || 'South Africa',
      seed.affected_dimensions as string || '[]',
      deadlineDate.toISOString().substring(0, 10),
      deadlineDate.toISOString().substring(0, 10),
    ).run();
    regulatoryCreated++;
  }

  return { signals: signalsCreated, benchmarks: benchmarksCreated, regulatory: regulatoryCreated };
}
