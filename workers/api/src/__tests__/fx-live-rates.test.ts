/**
 * Tier-B FX revaluation (spec §6.2) — live feed rates replace the hardcoded
 * table for ZAR normalisation.
 *
 * 1. loadLatestFxRates reads the latest frankfurter rows per pair; empty
 *    tenant → null; non-positive/bad readings skipped.
 * 2. resolveFxRates: live wins per pair, missing pairs fall back to
 *    FALLBACK_FX_RATES with staleRates=true, ZAR is 1.0 unconditionally.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { env } from 'cloudflare:test';
import { ensureMigrated } from './setup';
import { loadLatestFxRates } from '../services/external-signals-feed';
import { resolveFxRates, FALLBACK_FX_RATES } from '../services/assessment-findings';

const SEEDED_TENANT = `fx-seeded-${randomUUID().slice(0, 8)}`;
const EMPTY_TENANT = `fx-empty-${randomUUID().slice(0, 8)}`;

async function seedSignal(tenantId: string, rawData: Record<string, unknown>) {
  await env.DB.prepare(
    `INSERT INTO external_signals (id, tenant_id, category, title, summary, source_url, source_name,
       reliability_score, relevance_score, sentiment, raw_data, detected_at)
     VALUES (?, ?, 'market', 'FX', 'test', '', 'frankfurter', 0.9, 0.9, 'neutral', ?, datetime('now'))`,
  ).bind(randomUUID(), tenantId, JSON.stringify(rawData)).run();
}

beforeAll(async () => {
  await ensureMigrated();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, 'FX Seeded Co', ?, 'enterprise', 'active')`,
  ).bind(SEEDED_TENANT, SEEDED_TENANT).run();
  await seedSignal(SEEDED_TENANT, {
    signal_key: 'fx.usd_zar', latest_value: 18.72, latest_date: '2026-07-13', unit: 'ZAR per USD', history: [],
  });
  await seedSignal(SEEDED_TENANT, {
    signal_key: 'fx.eur_zar', latest_value: 20.41, latest_date: '2026-07-12', unit: 'ZAR per EUR', history: [],
  });
  // Broken GBP reading — non-positive value must be skipped, not used.
  await seedSignal(SEEDED_TENANT, {
    signal_key: 'fx.gbp_zar', latest_value: 0, latest_date: '2026-07-13', unit: 'ZAR per GBP', history: [],
  });
});

describe('loadLatestFxRates', () => {
  it('returns stored pairs, skips non-positive readings, as_of = oldest date used', async () => {
    const live = await loadLatestFxRates(env.DB, SEEDED_TENANT);
    expect(live).not.toBeNull();
    expect(live!.rates).toEqual({ USD: 18.72, EUR: 20.41 });
    expect(live!.as_of).toBe('2026-07-12');
  });

  it('returns null for a tenant with no FX signals', async () => {
    expect(await loadLatestFxRates(env.DB, EMPTY_TENANT)).toBeNull();
  });
});

describe('resolveFxRates', () => {
  it('null feed → hardcoded fallback, staleRates flagged', () => {
    const fx = resolveFxRates(null);
    expect(fx.exchangeRates).toEqual(FALLBACK_FX_RATES);
    expect(fx.staleRates).toBe(true);
    expect(fx.source).toBe('fallback');
    expect(fx.as_of).toBeNull();
  });

  it('all pairs live → live source, no stale flag', () => {
    const fx = resolveFxRates({ rates: { USD: 19.1, EUR: 20.9, GBP: 24.2 }, as_of: '2026-07-14' });
    expect(fx.exchangeRates).toEqual({ ZAR: 1.0, USD: 19.1, EUR: 20.9, GBP: 24.2 });
    expect(fx.staleRates).toBe(false);
    expect(fx.source).toBe('live');
    expect(fx.as_of).toBe('2026-07-14');
  });

  it('partial feed → mixed: live pair wins, missing pair falls back, stale flagged', () => {
    const fx = resolveFxRates({ rates: { USD: 19.1 }, as_of: '2026-07-14' });
    expect(fx.exchangeRates.USD).toBe(19.1);
    expect(fx.exchangeRates.EUR).toBe(FALLBACK_FX_RATES.EUR);
    expect(fx.exchangeRates.GBP).toBe(FALLBACK_FX_RATES.GBP);
    expect(fx.staleRates).toBe(true);
    expect(fx.source).toBe('mixed');
  });

  it('ZAR is 1.0 unconditionally — a feed row can never revalue the base currency', () => {
    const fx = resolveFxRates({ rates: { USD: 19.1, EUR: 20.9, GBP: 24.2, ZAR: 42 }, as_of: '2026-07-14' });
    expect(fx.exchangeRates.ZAR).toBe(1.0);
  });
});
