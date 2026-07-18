/**
 * Shared-savings billing — money-correctness tests.
 *
 * Covers the three high-value paths on src/routes/billing.ts + the billing
 * engine, since these bill customers real money:
 *
 *  1. computeBillablePeriod bills STRICTLY verification_status='verified'
 *     catalyst_actions. Seeds verified / skipped / failed / NULL actions and
 *     asserts only the 'verified' RCA's savings reach the billable total and
 *     the shared-savings fee (default 20%).
 *  2. validatePeriodRange (exercised through GET /period) rejects malformed
 *     dates and from>=to, accepts valid ranges.
 *  3. Role gating: the shared-savings endpoints require
 *     admin/support_admin/superadmin/system_admin.
 *
 * The real exported computeBillablePeriod is tested against a real D1;
 * expected amounts are computed by hand as an independent oracle.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';
import { computeBillablePeriod } from '../services/billing-engine';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'billing-test-tenant';
const SLUG = 'billing-test';
const PASSWORD = 'SecurePass1!';
const CLUSTER = 'billing-test-cluster';

// Period window: [2026-06-01, 2026-07-01). All RCAs resolve inside it.
const FROM = '2026-06-01';
const TO = '2026-07-01';
const RESOLVED_AT = '2026-06-15 12:00:00';
const DEFAULT_SHARE = 0.2;

async function login(email: string, tenantSlug: string): Promise<string> {
  const res = await SELF.fetch('http://localhost/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, tenant_slug: tenantSlug }),
  });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status}`);
  return (await res.json() as { token: string }).token;
}

/** Seed one resolved, billable-eligible RCA + one causal factor (impact) +
 *  one prescription + one catalyst_action with the given verification_status.
 *  Only verification_status='verified' should make the RCA billable. */
async function seedRca(opts: {
  id: string; impact: number; verificationStatus: string | null; confidence?: number;
}): Promise<void> {
  const presId = `pres-${opts.id}`;
  await env.DB.prepare(
    `INSERT INTO root_cause_analyses
       (id, tenant_id, metric_id, metric_name, trigger_status, causal_chain,
        confidence, status, resolved_at)
     VALUES (?, ?, ?, ?, 'red', '[]', ?, 'resolved', ?)`
  ).bind(opts.id, TENANT, `m-${opts.id}`, `metric-${opts.id}`, opts.confidence ?? 80, RESOLVED_AT).run();

  await env.DB.prepare(
    `INSERT INTO causal_factors
       (id, rca_id, tenant_id, layer, factor_type, title, description, impact_value, confidence)
     VALUES (?, ?, ?, 'pulse', 'root', 'f', 'f', ?, 0.9)`
  ).bind(`cf-${opts.id}`, opts.id, TENANT, opts.impact).run();

  await env.DB.prepare(
    `INSERT INTO diagnostic_prescriptions
       (id, rca_id, tenant_id, title, description)
     VALUES (?, ?, ?, 'do it', 'desc')`
  ).bind(presId, opts.id, TENANT).run();

  // catalyst_action linked to the prescription via source_finding_id — this
  // is the join the engine uses. verification_status decides billability.
  await env.DB.prepare(
    `INSERT INTO catalyst_actions
       (id, cluster_id, tenant_id, catalyst_name, action, status, source_finding_id, verification_status)
     VALUES (?, ?, ?, 'AR', 'collect', 'completed', ?, ?)`
  ).bind(`act-${opts.id}`, CLUSTER, TENANT, presId, opts.verificationStatus).run();
}

async function period(from = FROM, to = TO) {
  const { period } = await computeBillablePeriod(env.DB, TENANT, {
    periodStart: from, periodEnd: to, persist: false,
  });
  return period;
}

let adminToken: string;
let viewerToken: string;

describe('Shared-savings billing', () => {
  beforeAll(async () => {
    const mig = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (mig.status !== 200) throw new Error(`Migration failed: ${mig.status}`);

    await env.DB.prepare(
      `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status, region)
       VALUES (?, ?, ?, 'enterprise', 'active', 'af-south-1')`
    ).bind(TENANT, 'Billing Test Corp', SLUG).run();

    // Cluster FIRST — catalyst_actions.cluster_id FKs catalyst_clusters(id).
    await env.DB.prepare(
      `INSERT OR REPLACE INTO catalyst_clusters (id, tenant_id, name, domain, status, autonomy_tier)
       VALUES (?, ?, 'AR', 'finance', 'active', 'autonomous')`
    ).bind(CLUSTER, TENANT).run();

    const admHash = await hashPassword(PASSWORD);
    await env.DB.prepare(
      `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status)
       VALUES (?, ?, ?, 'Admin', 'admin', ?, '["*"]', 'active')`
    ).bind('bill-admin', TENANT, 'bill-admin@test.com', admHash).run();
    await env.DB.prepare(
      `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status)
       VALUES (?, ?, ?, 'Viewer', 'viewer', ?, '["*"]', 'active')`
    ).bind('bill-viewer', TENANT, 'bill-viewer@test.com', admHash).run();

    adminToken = await login('bill-admin@test.com', SLUG);
    viewerToken = await login('bill-viewer@test.com', SLUG);
  });

  beforeEach(async () => {
    // Order matters for FKs: children before parents.
    for (const t of ['catalyst_actions', 'diagnostic_prescriptions', 'causal_factors',
      'billable_line_items', 'billable_periods', 'root_cause_analyses']) {
      await env.DB.prepare(`DELETE FROM ${t} WHERE tenant_id = ?`).bind(TENANT).run();
    }
  });

  describe('computeBillablePeriod - verified-only gate', () => {
    it('counts ONLY verification_status=verified toward the billable total + fee', async () => {
      await seedRca({ id: 'r-verified', impact: 1000, verificationStatus: 'verified' });
      await seedRca({ id: 'r-skipped', impact: 2000, verificationStatus: 'skipped' });
      await seedRca({ id: 'r-failed', impact: 4000, verificationStatus: 'failed' });
      await seedRca({ id: 'r-null', impact: 8000, verificationStatus: null });

      const p = await period();

      // Independent oracle: only the verified RCA's 1000 is billable.
      expect(p.line_items).toHaveLength(1);
      expect(p.line_items[0].rca_id).toBe('r-verified');
      expect(p.line_items[0].attributed_savings).toBe(1000);
      expect(p.total_realised_savings).toBe(1000);
      // Shared-savings fee = round(total * default share 20%).
      expect(p.share_pct).toBe(DEFAULT_SHARE);
      expect(p.atheon_revenue).toBe(Math.round(1000 * DEFAULT_SHARE)); // 200
    });

    it('bills an RCA that has a verified action even when a failed one is also present', async () => {
      await seedRca({ id: 'r-mixed', impact: 500, verificationStatus: 'verified' });
      // second action on same prescription, failed — must not exclude the RCA.
      await env.DB.prepare(
        `INSERT INTO catalyst_actions
           (id, cluster_id, tenant_id, catalyst_name, action, status, source_finding_id, verification_status)
         VALUES (?, ?, ?, 'AR', 'x', 'completed', 'pres-r-mixed', 'failed')`
      ).bind('act-r-mixed-2', CLUSTER, TENANT).run();

      const p = await period();
      expect(p.total_realised_savings).toBe(500);
      expect(p.atheon_revenue).toBe(Math.round(500 * DEFAULT_SHARE)); // 100
    });

    it('bills nothing when the only action is non-verified', async () => {
      await seedRca({ id: 'r-only-skipped', impact: 9999, verificationStatus: 'skipped' });
      const p = await period();
      expect(p.line_items).toHaveLength(0);
      expect(p.total_realised_savings).toBe(0);
      expect(p.atheon_revenue).toBe(0);
    });
  });

  describe('validatePeriodRange (via GET /period)', () => {
    async function getPeriod(qs: string, token = adminToken): Promise<Response> {
      return SELF.fetch(`http://localhost/api/v1/billing/period${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }

    it('rejects a malformed "from" (not YYYY-MM-DD)', async () => {
      const res = await getPeriod('?from=2026-6-1&to=2026-07-01');
      expect(res.status).toBe(400);
      expect((await res.json() as { error: string }).error).toBe('invalid_from');
    });

    it('rejects a malformed "to" (contains time component)', async () => {
      const res = await getPeriod('?from=2026-06-01&to=2026-07-01T00:00:00Z');
      expect(res.status).toBe(400);
      expect((await res.json() as { error: string }).error).toBe('invalid_to');
    });

    it('rejects from >= to', async () => {
      const res = await getPeriod('?from=2026-07-01&to=2026-07-01');
      expect(res.status).toBe(400);
      expect((await res.json() as { error: string }).error).toBe('from_must_precede_to');
    });

    it('accepts a valid range', async () => {
      const res = await getPeriod(`?from=${FROM}&to=${TO}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { period: { period_start: string; period_end: string } };
      expect(body.period.period_start).toBe(FROM);
      expect(body.period.period_end).toBe(TO);
    });
  });

  describe('Role gating on shared-savings endpoints', () => {
    const path = `/api/v1/billing/period?from=${FROM}&to=${TO}`;

    it('rejects an unauthenticated request (401)', async () => {
      const res = await SELF.fetch(`http://localhost${path}`);
      expect(res.status).toBe(401);
    });

    it('rejects a viewer (403 - not in allowed role set)', async () => {
      const res = await SELF.fetch(`http://localhost${path}`, {
        headers: { Authorization: `Bearer ${viewerToken}` },
      });
      expect(res.status).toBe(403);
    });

    it('allows an admin (200)', async () => {
      const res = await SELF.fetch(`http://localhost${path}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
    });

    it('gates GET /periods the same way (viewer 403, admin 200)', async () => {
      const denied = await SELF.fetch('http://localhost/api/v1/billing/periods', {
        headers: { Authorization: `Bearer ${viewerToken}` },
      });
      expect(denied.status).toBe(403);
      const ok = await SELF.fetch('http://localhost/api/v1/billing/periods', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(ok.status).toBe(200);
    });
  });
});
