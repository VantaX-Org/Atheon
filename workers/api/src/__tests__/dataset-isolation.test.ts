import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { ensureMigrated } from './setup';
import { collectVolumeSnapshot } from '../services/assessment-engine';

const TENANT = 'iso-tenant';

describe('cross-dataset isolation', () => {
  beforeAll(async () => {
    await ensureMigrated();
    await env.DB.prepare(`INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, 'Iso', 'iso', 'enterprise', 'active')`).bind(TENANT).run();
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM erp_invoices WHERE tenant_id = ?').bind(TENANT).run();
    // total_revenue_12m sums erp_invoices.total over the last 12 months. The huge
    // tenant (dataset_id NULL) value makes any cross-dataset/tenant bleed obvious.
    const mk = (id: string, ds: string | null, total: number) =>
      env.DB.prepare(`INSERT INTO erp_invoices (id, tenant_id, dataset_id, source_system, invoice_number, invoice_date, total, amount_due, payment_status) VALUES (?, ?, ?, 'seed', ?, '2026-01-01', ?, ?, 'unpaid')`)
        .bind(id, TENANT, ds, `INV-${id}`, total, total).run();
    await mk('tenantRow', null, 1000000);
    await mk('xRow', 'DS_X', 10);
    await mk('yRow', 'DS_Y', 20);
  });

  it('dataset X sees only X rows — no Y, no tenant bleed', async () => {
    const snapX = await collectVolumeSnapshot(env.DB, TENANT, '', 'DS_X');
    const snapAll = await collectVolumeSnapshot(env.DB, TENANT, '');
    // X-scoped aggregate must equal the X row (10) only — never Y(20) or tenant(1e6).
    expect(snapX.total_revenue_12m).toBe(10);
    // Unscoped run sees all three: 1000000 + 10 + 20 = 1000030.
    expect(snapAll.total_revenue_12m).toBe(1000030);
  });
});
