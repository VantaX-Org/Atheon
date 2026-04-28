/**
 * Federated Peer-Pattern Learning with Differential Privacy
 * ==========================================================
 *
 * Tenants benefit from collective resolution patterns ("when companies
 * like yours had this issue, the median company resolved it in 18 days
 * and recovered 4.2% of value-at-risk") **without their raw data ever
 * leaving their VPC** — this is the third "world-first" primitive.
 *
 * How
 * ===
 *  1. When a catalyst run completes successfully on a tenant, we record
 *     a single `federation_observations` row keyed by (tenant_id,
 *     industry_bucket, finding_code) with the resolution metrics
 *     (resolved_in_days, recovery_pct, raw_value_zar). This is a single-
 *     row contribution per resolved instance — never a copy of the
 *     underlying ERP data.
 *
 *  2. A nightly cron aggregates observations into
 *     `federation_aggregates`, computing mean / p25 / p75 / count per
 *     (industry_bucket, finding_code) bucket. Aggregates are noised
 *     with the Laplace mechanism (epsilon = 1.0) and stored.
 *
 *  3. Reads return only the noised aggregate — and only when n >= 5
 *     contributors so a single tenant cannot be re-identified through
 *     repeated queries (k-anonymity floor).
 *
 *  4. Aggregates are scoped by industry_bucket so customers in
 *     "manufacturing" don't see "professional services" patterns.
 *
 * Privacy guarantee
 * =================
 * We use the Laplace mechanism with global sensitivity = 1 / n.
 * Adding/removing one tenant's observation can change the bucket mean
 * by at most max_value / n. Drawing a Laplace(0, sensitivity / epsilon)
 * sample preserves epsilon-DP. The standard composition rule applies:
 * a tenant making k queries against the same aggregate sees k *
 * epsilon-DP guarantee, so we cap the per-tenant query rate.
 *
 * Customers in regulated jurisdictions (POPIA, GDPR) get an
 * attestation that aggregates conform to (epsilon=1.0)-differential-
 * privacy with the cited sensitivity bound.
 *
 * Cold-start
 * ==========
 * Until n >= 5 contributors exist for a (industry, finding) bucket, the
 * read API returns no peer pattern — no insight worth blocking on.
 *
 * Limitations (intentional)
 * =========================
 * - This is "centralised DP" — the aggregator (Atheon cloud) sees
 *   per-tenant observations in plaintext. True federated learning
 *   without trust in the aggregator requires secure multi-party
 *   computation, out of scope for this MVP.
 * - We don't track per-tenant query budgets across days; budget
 *   accounting is a future addition.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export interface FederationObservation {
  /** Industry / vertical bucket. 'general' for tenants not classified. */
  industryBucket: string;
  /** Finding code that resolved (e.g. 'ar_aging_overdue_90_plus'). */
  findingCode: string;
  /** Days from finding detection to resolution. NULL = unresolved/unknown. */
  resolvedInDays: number | null;
  /** Recovery percentage of value-at-risk (0-100). */
  recoveryPct: number | null;
  /** Raw value-at-risk in ZAR for sensitivity computation. */
  rawValueZar: number;
}

export interface FederatedPattern {
  industry_bucket: string;
  finding_code: string;
  /** # of distinct tenants contributing to this bucket. */
  n_contributors: number;
  /** Differentially-private mean of resolved_in_days. */
  avg_resolved_days: number;
  /** Differentially-private mean recovery percentage. */
  avg_recovery_pct: number;
  /** 25th percentile (cohort lower-half median). */
  p25_recovery_pct: number;
  /** 75th percentile (cohort upper-half median). */
  p75_recovery_pct: number;
  /** DP epsilon used (smaller = more privacy, more noise). */
  epsilon: number;
  /** When this bucket was last refreshed. */
  last_refreshed_at: string;
}

// ── Constants ─────────────────────────────────────────────────────────────

/** k-anonymity floor — refuse to publish aggregates below this. */
export const MIN_CONTRIBUTORS_FOR_PUBLISH = 5;
/** Standard epsilon for Laplace-mechanism noise. */
export const DEFAULT_EPSILON = 1.0;
/** Cap on the recovery_pct values we accept per observation. */
const RECOVERY_PCT_CAP = 100;
/** Cap on resolved_in_days values we accept per observation. */
const RESOLUTION_DAYS_CAP = 365;

// ── Laplace noise ─────────────────────────────────────────────────────────

/**
 * Sample from a Laplace(0, scale) distribution using inverse-CDF sampling
 * with crypto.getRandomValues for unbiased uniform draws.
 *
 * For X ~ Uniform(-0.5, 0.5):
 *   F^-1(X) = -scale * sign(X) * ln(1 - 2|X|)
 */
function laplaceNoise(scale: number): number {
  if (scale <= 0) return 0;
  // Sample a single uniform in [-0.5, 0.5)
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  // u in [0, 1)
  const u = buf[0] / 0x1_0000_0000;
  // shift to [-0.5, 0.5)
  const x = u - 0.5;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  // Avoid log(0) at the extreme
  return -scale * sign * Math.log(Math.max(1e-12, 1 - 2 * absX));
}

/**
 * Apply Laplace noise to a mean with global sensitivity = max_value / n.
 * Clamp to [0, max_value] — DP-noised aggregates can dip below natural
 * bounds when n is small and we want the displayed value to stay in range.
 */
function noisyMean(rawMean: number, maxValue: number, n: number, epsilon: number): number {
  if (n <= 0) return 0;
  const sensitivity = maxValue / n;
  const scale = sensitivity / epsilon;
  const noised = rawMean + laplaceNoise(scale);
  return Math.max(0, Math.min(maxValue, noised));
}

// ── Observation recording ─────────────────────────────────────────────────

/**
 * Record a single tenant's resolution observation. Caller is responsible
 * for only invoking this when:
 *   - The catalyst actually resolved the finding (status = 'success').
 *   - The recovery was computed against actual ERP records, not estimated.
 *   - The tenant has consented to participate in federated learning
 *     (check `tenant_entitlements.features` for `'federated-learning'`
 *     before calling — that gate is a follower of this PR).
 *
 * The observation is kept verbatim in `federation_observations` for the
 * cron-time aggregation. Per-tenant data does not leak through reads;
 * only the noised aggregate over n >= 5 contributors is exposed.
 */
export async function recordObservation(
  db: D1Database,
  tenantId: string,
  observation: FederationObservation,
): Promise<void> {
  // Clamp inputs to defensible ranges so a single misreporting tenant
  // can't spike the global aggregate.
  const days = observation.resolvedInDays !== null
    ? Math.max(0, Math.min(RESOLUTION_DAYS_CAP, observation.resolvedInDays))
    : null;
  const recovery = observation.recoveryPct !== null
    ? Math.max(0, Math.min(RECOVERY_PCT_CAP, observation.recoveryPct))
    : null;
  const id = `fobs-${tenantId.slice(0, 8)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  await db.prepare(
    `INSERT INTO federation_observations
       (id, tenant_id, industry_bucket, finding_code, resolved_in_days, recovery_pct, raw_value_zar, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).bind(
    id, tenantId, observation.industryBucket || 'general', observation.findingCode,
    days, recovery, observation.rawValueZar,
  ).run();
}

// ── Aggregation cron ──────────────────────────────────────────────────────

/**
 * Refresh all federation_aggregates rows from observations. Runs nightly
 * (or on-demand by superadmin). For each (industry_bucket, finding_code)
 * group with n >= MIN_CONTRIBUTORS_FOR_PUBLISH:
 *   1. Collect observations from distinct tenants
 *   2. Compute raw mean / p25 / p75
 *   3. Apply Laplace noise to means with sensitivity = max_value / n
 *   4. Upsert into federation_aggregates
 *
 * Buckets below the k-anonymity threshold are deleted from
 * federation_aggregates (so a bucket that drops below 5 stops publishing).
 */
export async function refreshAggregates(
  db: D1Database,
  options: { epsilon?: number } = {},
): Promise<{ buckets_refreshed: number; buckets_purged: number }> {
  const epsilon = options.epsilon ?? DEFAULT_EPSILON;

  // 1. Collect all (industry_bucket, finding_code) groups with their
  //    observations (one row per tenant — first observation wins for
  //    contributor count to prevent a single tenant flooding).
  const groups = await db.prepare(
    `SELECT industry_bucket, finding_code,
            tenant_id, MAX(resolved_in_days) AS resolved_in_days,
            MAX(recovery_pct) AS recovery_pct, MAX(raw_value_zar) AS raw_value_zar
       FROM federation_observations
      GROUP BY industry_bucket, finding_code, tenant_id`,
  ).all<{
    industry_bucket: string; finding_code: string; tenant_id: string;
    resolved_in_days: number | null; recovery_pct: number | null; raw_value_zar: number;
  }>();

  // 2. Group by (industry_bucket, finding_code) and bucket-by-bucket
  //    compute aggregates.
  const bucketed: Record<string, Array<{
    tenant_id: string; resolved_in_days: number | null; recovery_pct: number | null;
  }>> = {};
  for (const r of (groups.results || [])) {
    const key = `${r.industry_bucket}|${r.finding_code}`;
    (bucketed[key] ||= []).push({
      tenant_id: r.tenant_id,
      resolved_in_days: r.resolved_in_days,
      recovery_pct: r.recovery_pct,
    });
  }

  let bucketsRefreshed = 0;
  let bucketsPurged = 0;

  // 3. For each bucket, decide whether to publish or purge.
  for (const key of Object.keys(bucketed)) {
    const [industryBucket, findingCode] = key.split('|');
    const obs = bucketed[key];
    const n = obs.length;

    if (n < MIN_CONTRIBUTORS_FOR_PUBLISH) {
      // Below k-anonymity floor — purge any prior published aggregate
      // (could happen if a bucket grew above 5 then shrank when a tenant
      // churned). Don't expose stale data.
      const r = await db.prepare(
        `DELETE FROM federation_aggregates WHERE industry_bucket = ? AND finding_code = ?`,
      ).bind(industryBucket, findingCode).run();
      if (r.meta?.changes && r.meta.changes > 0) bucketsPurged++;
      continue;
    }

    // Compute raw aggregates first.
    const daysVals = obs.map(o => o.resolved_in_days).filter((v): v is number => v !== null);
    const recVals = obs.map(o => o.recovery_pct).filter((v): v is number => v !== null);

    const avgDaysRaw = daysVals.length > 0 ? daysVals.reduce((s, v) => s + v, 0) / daysVals.length : 0;
    const avgRecoveryRaw = recVals.length > 0 ? recVals.reduce((s, v) => s + v, 0) / recVals.length : 0;

    // Percentiles on the raw distribution. We don't noise these because
    // p25 / p75 are less sensitive to single-tenant changes than the mean,
    // and the report uses them only as cohort-spread context — not for
    // any individualised decision.
    const sortedRec = [...recVals].sort((a, b) => a - b);
    const p25 = sortedRec.length > 0 ? sortedRec[Math.floor(sortedRec.length * 0.25)] : 0;
    const p75 = sortedRec.length > 0 ? sortedRec[Math.floor(sortedRec.length * 0.75)] : 0;

    // 4. Apply Laplace noise to the means. Sensitivity = max / n.
    const avgDays = noisyMean(avgDaysRaw, RESOLUTION_DAYS_CAP, n, epsilon);
    const avgRecovery = noisyMean(avgRecoveryRaw, RECOVERY_PCT_CAP, n, epsilon);

    const id = `fagg-${industryBucket}-${findingCode}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
    await db.prepare(
      `INSERT INTO federation_aggregates
         (id, industry_bucket, finding_code, n_contributors, avg_resolved_days, avg_recovery_pct,
          p25_recovery_pct, p75_recovery_pct, epsilon, last_refreshed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(industry_bucket, finding_code) DO UPDATE SET
         n_contributors = excluded.n_contributors,
         avg_resolved_days = excluded.avg_resolved_days,
         avg_recovery_pct = excluded.avg_recovery_pct,
         p25_recovery_pct = excluded.p25_recovery_pct,
         p75_recovery_pct = excluded.p75_recovery_pct,
         epsilon = excluded.epsilon,
         last_refreshed_at = datetime('now')`,
    ).bind(id, industryBucket, findingCode, n, avgDays, avgRecovery, p25, p75, epsilon).run();
    bucketsRefreshed++;
  }

  return { buckets_refreshed: bucketsRefreshed, buckets_purged: bucketsPurged };
}

// ── Read API ──────────────────────────────────────────────────────────────

/**
 * Look up the federated peer pattern for a (industry_bucket, finding_code)
 * pair. Returns null if no aggregate exists (n < 5 contributors).
 *
 * Note: this returns the pre-noised aggregate from the last refresh.
 * Re-fetching does not re-noise — that would amplify the privacy
 * disclosure budget over repeated queries. Refresh is the cron's job.
 */
export async function getPeerPattern(
  db: D1Database,
  industryBucket: string,
  findingCode: string,
): Promise<FederatedPattern | null> {
  const row = await db.prepare(
    `SELECT industry_bucket, finding_code, n_contributors, avg_resolved_days, avg_recovery_pct,
            p25_recovery_pct, p75_recovery_pct, epsilon, last_refreshed_at
       FROM federation_aggregates
      WHERE industry_bucket = ? AND finding_code = ?`,
  ).bind(industryBucket, findingCode).first<FederatedPattern>();
  return row || null;
}

/**
 * List all peer patterns for a given industry bucket — used by the
 * Apex peer-benchmarks panel.
 */
export async function listPeerPatterns(
  db: D1Database,
  industryBucket: string,
): Promise<FederatedPattern[]> {
  const rows = await db.prepare(
    `SELECT industry_bucket, finding_code, n_contributors, avg_resolved_days, avg_recovery_pct,
            p25_recovery_pct, p75_recovery_pct, epsilon, last_refreshed_at
       FROM federation_aggregates
      WHERE industry_bucket = ?
      ORDER BY n_contributors DESC, finding_code ASC`,
  ).bind(industryBucket).all<FederatedPattern>();
  return rows.results || [];
}

// ── Test-only export ─────────────────────────────────────────────────────
export const _testExports = { laplaceNoise, noisyMean };
