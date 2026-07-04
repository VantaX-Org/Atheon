import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { ingestDomains } from '../lib/ingest-write';
import { ensureMigrated } from './setup';

const TENANT = 'iw-tenant';
const DATASET = 'iw-ds-1';

describe('ingestDomains', () => {
  beforeAll(async () => {
    await ensureMigrated();
    await env.DB.prepare(`INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, 'IW', ?, 'enterprise', 'active')`).bind(TENANT, TENANT).run();
  });
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM erp_invoices WHERE tenant_id = ?').bind(TENANT).run();
  });

  it('validates + writes rows and returns row_counts', async () => {
    const res = await ingestDomains(env.DB, TENANT, DATASET, {
      invoices: {
        header: ['invoice_number', 'invoice_date', 'total'],
        rows: [
          { invoice_number: 'INV-1', invoice_date: '2026-01-10', total: '500' },
          { invoice_number: 'INV-2', invoice_date: '2026-01-11', total: '750' },
        ],
      },
    }, { maxRowsPerDomain: 100000 });

    expect(res.errors).toEqual([]);
    expect(res.row_counts.invoices).toBe(2);
    const cnt = await env.DB.prepare('SELECT COUNT(*) c FROM erp_invoices WHERE tenant_id = ? AND dataset_id = ?').bind(TENANT, DATASET).first<{ c: number }>();
    expect(cnt?.c).toBe(2);
  });

  it('rejects the whole domain on any error and writes nothing', async () => {
    const res = await ingestDomains(env.DB, TENANT, DATASET, {
      invoices: {
        header: ['invoice_number', 'invoice_date', 'total', 'evil'],
        rows: [{ invoice_number: 'X', invoice_date: '2026-01-10', total: '1', evil: 'y' }],
      },
    }, { maxRowsPerDomain: 100000 });

    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.row_counts).toEqual({});
    const cnt = await env.DB.prepare('SELECT COUNT(*) c FROM erp_invoices WHERE tenant_id = ?').bind(TENANT).first<{ c: number }>();
    expect(cnt?.c).toBe(0);
  });

  it('enforces maxRowsPerDomain before insert (whole-domain reject, nothing written)', async () => {
    const res = await ingestDomains(env.DB, TENANT, DATASET, {
      invoices: {
        header: ['invoice_number', 'invoice_date', 'total'],
        rows: [
          { invoice_number: 'INV-1', invoice_date: '2026-01-10', total: '500' },
          { invoice_number: 'INV-2', invoice_date: '2026-01-11', total: '750' },
        ],
      },
    }, { maxRowsPerDomain: 1 });

    expect(res.errors.some(e => /exceeds cap/.test(e.message))).toBe(true);
    expect(res.row_counts).toEqual({});
    const cnt = await env.DB.prepare('SELECT COUNT(*) c FROM erp_invoices WHERE tenant_id = ?').bind(TENANT).first<{ c: number }>();
    expect(cnt?.c).toBe(0);
  });
});
