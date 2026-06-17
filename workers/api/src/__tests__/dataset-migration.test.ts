import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { ensureMigrated } from './setup';

describe('dataset_id migration', () => {
  beforeAll(async () => { await ensureMigrated(); });

  const TABLES = [
    'erp_invoices', 'erp_purchase_orders', 'erp_journal_entries', 'erp_bank_transactions',
    'erp_employees', 'erp_customers', 'erp_suppliers', 'erp_products',
  ];

  it('adds nullable dataset_id to all 8 canonical erp_* tables', async () => {
    for (const t of TABLES) {
      const info = await env.DB.prepare(`PRAGMA table_info(${t})`).all<{ name: string; notnull: number }>();
      const col = info.results.find(r => r.name === 'dataset_id');
      expect(col, `${t}.dataset_id missing`).toBeTruthy();
      expect(col!.notnull).toBe(0); // nullable
    }
  });

  it('creates assessment_datasets table', async () => {
    const info = await env.DB.prepare(`PRAGMA table_info(assessment_datasets)`).all<{ name: string }>();
    const names = info.results.map(r => r.name);
    expect(names).toEqual(expect.arrayContaining(['id', 'assessment_id', 'tenant_id', 'status', 'row_counts', 'error', 'uploaded_at']));
  });
});
