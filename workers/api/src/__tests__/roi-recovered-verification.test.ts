/**
 * ROI recovered-value verification filter.
 *
 * `recovered` (pattern-engine-v2.calculateROI) and the automated bucket
 * (roi.computeActionAttribution) are the customer-facing "money Atheon booked"
 * figure. A completed action only counts as recovered when its ERP write was
 * not repudiated: NULL (seeded/legacy, pre-verifier) or 'verified'. Stub /
 * preview ('skipped'), unconfirmed ('deferred'), and repudiated ('failed')
 * actions must NOT inflate it — billing bills strictly 'verified', and this
 * keeps the operational ROI figure from overstating realised value.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { calculateROI } from '../services/pattern-engine-v2';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'roi-recovered-tenant';

async function seedAction(
  id: string,
  status: string,
  verification: string | null,
  valueZar: number,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO catalyst_actions
       (id, tenant_id, cluster_id, catalyst_name, action, status, action_type,
        value_zar, verification_status, completed_at)
     VALUES (?, ?, 'c', 'Recon', 'invoice_post', ?, 'invoice_post', ?, ?, datetime('now'))`
  ).bind(id, TENANT, status, valueZar, verification).run();
}

async function recoveredForTenant(): Promise<number> {
  await calculateROI(env.DB, TENANT);
  const row = await env.DB.prepare(
    `SELECT total_discrepancy_value_recovered AS r FROM roi_tracking
      WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1`
  ).bind(TENANT).first<{ r: number }>();
  return row?.r ?? -1;
}

describe('ROI recovered-value verification filter', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    expect(res.status).toBeLessThan(500);
    await env.DB.prepare(
      `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`
    ).bind(TENANT, TENANT, TENANT).run();
    await env.DB.prepare(
      `INSERT OR REPLACE INTO catalyst_clusters (id, tenant_id, name, domain, status, autonomy_tier)
       VALUES ('c', ?, 'AR', 'finance', 'active', 'autonomous')`
    ).bind(TENANT).run();
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM catalyst_actions WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM roi_tracking WHERE tenant_id = ?').bind(TENANT).run();
  });

  it('counts completed NULL-verification and verified actions', async () => {
    await seedAction('a-null', 'completed', null, 100000);
    await seedAction('a-verified', 'completed', 'verified', 50000);
    expect(await recoveredForTenant()).toBe(150000);
  });

  it('excludes skipped (stub/preview) and deferred from recovered', async () => {
    await seedAction('a-null', 'completed', null, 100000);
    await seedAction('a-skipped', 'completed', 'skipped', 999000); // stub/preview
    await seedAction('a-deferred', 'completed', 'deferred', 888000); // unconfirmed
    expect(await recoveredForTenant()).toBe(100000);
  });

  it('excludes failed and non-completed statuses', async () => {
    await seedAction('a-verified', 'completed', 'verified', 70000);
    await seedAction('a-failed', 'completed', 'failed', 500000); // ERP repudiated
    await seedAction('a-pending', 'pending_approval', null, 400000); // not booked yet
    await seedAction('a-rejected', 'rejected', null, 300000);
    expect(await recoveredForTenant()).toBe(70000);
  });
});
