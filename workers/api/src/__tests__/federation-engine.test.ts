/**
 * Federation Engine — DP peer-pattern learning integration tests.
 *
 * Properties to prove:
 *   1. recordObservation persists clamped values; raw inputs above
 *      caps don't pollute aggregates.
 *   2. refreshAggregates publishes only when n >= 5 distinct tenants;
 *      below-threshold buckets are purged from the published table.
 *   3. Output is noised — repeated refreshes on the same data produce
 *      slightly different averages (Laplace noise visible).
 *   4. Read API returns null for unknown / sub-threshold buckets.
 *   5. listPeerPatterns scopes correctly by industry.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  recordObservation,
  refreshAggregates,
  getPeerPattern,
  listPeerPatterns,
  MIN_CONTRIBUTORS_FOR_PUBLISH,
  _testExports,
} from '../services/federation-engine';

const TENANTS = Array.from({ length: 7 }, (_, i) => `fed-tenant-${i}`);

async function migrate(): Promise<void> {
  const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
    method: 'POST',
    headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
  });
  if (res.status !== 200) throw new Error(`Migration failed: ${res.status}`);
}

async function seedTenants(): Promise<void> {
  for (const id of TENANTS) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`,
    ).bind(id, id, id).run();
  }
}

async function clearFederation(): Promise<void> {
  await env.DB.prepare(`DELETE FROM federation_observations`).run();
  await env.DB.prepare(`DELETE FROM federation_aggregates`).run();
}

describe('Federation Engine — Laplace noise primitive', () => {
  it('produces approximately zero mean over many samples', () => {
    const samples = Array.from({ length: 5000 }, () => _testExports.laplaceNoise(1));
    const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
    // 5000 samples of Laplace(0, 1) — std error ~ sqrt(2/5000) ≈ 0.02. mean should be << 1.
    expect(Math.abs(mean)).toBeLessThan(0.2);
  });

  it('scales with the scale parameter (rough variance check)', () => {
    const small = Array.from({ length: 1000 }, () => _testExports.laplaceNoise(1));
    const large = Array.from({ length: 1000 }, () => _testExports.laplaceNoise(10));
    const varSmall = small.reduce((s, v) => s + v * v, 0) / small.length;
    const varLarge = large.reduce((s, v) => s + v * v, 0) / large.length;
    // Variance scales as scale^2 — so 10x scale ⇒ ~100x variance.
    expect(varLarge / Math.max(varSmall, 0.01)).toBeGreaterThan(20);
  });

  it('noisyMean clamps to [0, max]', () => {
    // With sensitivity = 100/1 = 100, scale = 100/0.001 = 100000 (very noisy).
    // Many draws will be way negative or way over max — must be clamped.
    for (let i = 0; i < 20; i++) {
      const v = _testExports.noisyMean(50, 100, 1, 0.001);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

describe('Federation Engine — recordObservation', () => {
  beforeAll(async () => { await migrate(); await seedTenants(); });
  beforeEach(async () => { await clearFederation(); });

  it('persists a single observation with clamped values', async () => {
    await recordObservation(env.DB, TENANTS[0], {
      industryBucket: 'manufacturing',
      findingCode: 'inv_dead_stock',
      resolvedInDays: 1000, // above cap (365)
      recoveryPct: 200,     // above cap (100)
      rawValueZar: 50000,
    });
    const row = await env.DB.prepare(
      `SELECT industry_bucket, finding_code, resolved_in_days, recovery_pct, raw_value_zar
         FROM federation_observations WHERE tenant_id = ?`,
    ).bind(TENANTS[0]).first<{
      industry_bucket: string; finding_code: string;
      resolved_in_days: number; recovery_pct: number; raw_value_zar: number;
    }>();
    expect(row).not.toBeNull();
    expect(row!.resolved_in_days).toBe(365); // clamped
    expect(row!.recovery_pct).toBe(100); // clamped
    expect(row!.raw_value_zar).toBe(50000);
  });

  it('defaults industryBucket to "general" when blank', async () => {
    await recordObservation(env.DB, TENANTS[0], {
      industryBucket: '',
      findingCode: 'ar_aging_overdue_90_plus',
      resolvedInDays: 30,
      recoveryPct: 65,
      rawValueZar: 1_000_000,
    });
    const row = await env.DB.prepare(
      `SELECT industry_bucket FROM federation_observations WHERE tenant_id = ?`,
    ).bind(TENANTS[0]).first<{ industry_bucket: string }>();
    expect(row!.industry_bucket).toBe('general');
  });
});

describe('Federation Engine — refreshAggregates', () => {
  beforeAll(async () => { await migrate(); await seedTenants(); });
  beforeEach(async () => { await clearFederation(); });

  it('does NOT publish when fewer than 5 contributors', async () => {
    // 3 tenants only
    for (let i = 0; i < 3; i++) {
      await recordObservation(env.DB, TENANTS[i], {
        industryBucket: 'manufacturing',
        findingCode: 'inv_stale_stock',
        resolvedInDays: 30,
        recoveryPct: 50,
        rawValueZar: 100_000,
      });
    }
    const result = await refreshAggregates(env.DB);
    expect(result.buckets_refreshed).toBe(0);
    const row = await env.DB.prepare(
      `SELECT * FROM federation_aggregates WHERE industry_bucket = 'manufacturing' AND finding_code = 'inv_stale_stock'`,
    ).first();
    expect(row).toBeNull();
  });

  it('publishes when n >= 5 distinct tenants contribute', async () => {
    for (let i = 0; i < 5; i++) {
      await recordObservation(env.DB, TENANTS[i], {
        industryBucket: 'manufacturing',
        findingCode: 'inv_dead_stock',
        resolvedInDays: 20 + i * 2, // 20, 22, 24, 26, 28
        recoveryPct: 60 + i * 2,    // 60, 62, 64, 66, 68
        rawValueZar: 100_000,
      });
    }
    const result = await refreshAggregates(env.DB);
    expect(result.buckets_refreshed).toBe(1);
    const pattern = await getPeerPattern(env.DB, 'manufacturing', 'inv_dead_stock');
    expect(pattern).not.toBeNull();
    expect(pattern!.n_contributors).toBe(5);
    // Raw mean of recovery: (60+62+64+66+68)/5 = 64. With Laplace noise
    // the published value will differ — we just check it's still in
    // a defensible range. (sensitivity = 100/5 = 20; scale = 20/1 = 20;
    // 95% of draws within ±60 of the mean — wide.)
    expect(pattern!.avg_recovery_pct).toBeGreaterThanOrEqual(0);
    expect(pattern!.avg_recovery_pct).toBeLessThanOrEqual(100);
    // Percentiles are NOT noised
    expect(pattern!.p25_recovery_pct).toBe(62);
    expect(pattern!.p75_recovery_pct).toBe(66);
  });

  it('purges aggregates when contributor count drops below threshold', async () => {
    // Seed 5 contributors first → publishes.
    for (let i = 0; i < 5; i++) {
      await recordObservation(env.DB, TENANTS[i], {
        industryBucket: 'tech',
        findingCode: 'svc_low_billable_utilisation',
        resolvedInDays: 14,
        recoveryPct: 40,
        rawValueZar: 250_000,
      });
    }
    await refreshAggregates(env.DB);
    expect(await getPeerPattern(env.DB, 'tech', 'svc_low_billable_utilisation')).not.toBeNull();

    // Then drop 3 of them — bucket falls to 2, should be purged.
    await env.DB.prepare(
      `DELETE FROM federation_observations WHERE tenant_id IN (?, ?, ?)`,
    ).bind(TENANTS[0], TENANTS[1], TENANTS[2]).run();
    const result = await refreshAggregates(env.DB);
    expect(result.buckets_purged).toBe(1);
    expect(await getPeerPattern(env.DB, 'tech', 'svc_low_billable_utilisation')).toBeNull();
  });

  it('produces different values across refreshes (noise visible)', async () => {
    for (let i = 0; i < 5; i++) {
      await recordObservation(env.DB, TENANTS[i], {
        industryBucket: 'fmcg',
        findingCode: 'proc_maverick_spend',
        resolvedInDays: 10,
        recoveryPct: 50, // identical raw values across tenants
        rawValueZar: 100_000,
      });
    }
    await refreshAggregates(env.DB);
    const v1 = (await getPeerPattern(env.DB, 'fmcg', 'proc_maverick_spend'))!.avg_recovery_pct;
    await refreshAggregates(env.DB);
    const v2 = (await getPeerPattern(env.DB, 'fmcg', 'proc_maverick_spend'))!.avg_recovery_pct;
    // With identical raw inputs, the only source of variation is the
    // Laplace noise added each refresh. The probability of two samples
    // landing on EXACTLY the same value is essentially zero.
    expect(v1).not.toBe(v2);
  });
});

describe('Federation Engine — read API', () => {
  beforeAll(async () => { await migrate(); await seedTenants(); });
  beforeEach(async () => { await clearFederation(); });

  it('getPeerPattern returns null for unknown bucket', async () => {
    const result = await getPeerPattern(env.DB, 'manufacturing', 'unknown_finding');
    expect(result).toBeNull();
  });

  it('listPeerPatterns scopes by industry bucket', async () => {
    // Seed 5 contributors in 'mfg' for ar_90_plus, 5 contributors in 'fmcg' for inv_dead_stock.
    for (let i = 0; i < 5; i++) {
      await recordObservation(env.DB, TENANTS[i], {
        industryBucket: 'mfg',
        findingCode: 'ar_aging_overdue_90_plus',
        resolvedInDays: 30, recoveryPct: 70, rawValueZar: 100_000,
      });
      await recordObservation(env.DB, TENANTS[i], {
        industryBucket: 'fmcg',
        findingCode: 'inv_dead_stock',
        resolvedInDays: 60, recoveryPct: 40, rawValueZar: 200_000,
      });
    }
    await refreshAggregates(env.DB);
    const mfgPatterns = await listPeerPatterns(env.DB, 'mfg');
    const fmcgPatterns = await listPeerPatterns(env.DB, 'fmcg');
    expect(mfgPatterns.length).toBe(1);
    expect(mfgPatterns[0].finding_code).toBe('ar_aging_overdue_90_plus');
    expect(fmcgPatterns.length).toBe(1);
    expect(fmcgPatterns[0].finding_code).toBe('inv_dead_stock');
  });

  it('exports MIN_CONTRIBUTORS_FOR_PUBLISH = 5 (privacy floor)', () => {
    expect(MIN_CONTRIBUTORS_FOR_PUBLISH).toBe(5);
  });
});
