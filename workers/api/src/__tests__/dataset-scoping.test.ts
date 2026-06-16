import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { ensureMigrated } from './setup';
import { collectVolumeSnapshot } from '../services/assessment-engine';

const TENANT = 'scope-tenant';

describe('collectVolumeSnapshot dataset scoping', () => {
  beforeAll(async () => {
    await ensureMigrated();
    await env.DB.prepare(`INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, 'Scope', 'scope', 'enterprise', 'active')`).bind(TENANT).run();
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM erp_invoices WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare(`INSERT INTO erp_invoices (id, tenant_id, dataset_id, source_system, invoice_number, invoice_date, total, amount_due, payment_status) VALUES ('seed1', ?, NULL, 'seed', 'S-1', '2026-01-01', 999999, 999999, 'unpaid')`).bind(TENANT).run();
    await env.DB.prepare(`INSERT INTO erp_invoices (id, tenant_id, dataset_id, source_system, invoice_number, invoice_date, total, amount_due, payment_status) VALUES ('d1', ?, 'DSX', 'upload', 'D-1', '2026-01-01', 100, 100, 'unpaid')`).bind(TENANT).run();
  });

  // VolumeSnapshot has no raw invoice-count field. monthly_invoices divides the
  // raw count by months-of-data so it cannot reliably distinguish 1 vs 2 rows.
  // total_revenue_12m sums erp_invoices.total over the last 12 months, so the
  // huge seed value makes any leak unmistakable: scoped -> 100, unscoped -> 1000099.
  it('with datasetId returns only that dataset rows', async () => {
    const snap = await collectVolumeSnapshot(env.DB, TENANT, '', 'DSX');
    expect(snap.total_revenue_12m).toBe(100);
  });

  it('without datasetId returns all tenant rows (back-compat)', async () => {
    const snap = await collectVolumeSnapshot(env.DB, TENANT, '');
    expect(snap.total_revenue_12m).toBe(1000099);
  });
});
