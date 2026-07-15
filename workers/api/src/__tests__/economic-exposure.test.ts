/**
 * Economic exposure — supply (PO spend), demand (invoiced revenue) and
 * value-chain net position per foreign currency, straight from erp rows.
 *
 * Honesty invariants: cards are value_kind 'context' with value_zar null,
 * native-currency figures only, suggestions are conditional prose paired
 * with the live pulse — no Rand is ever computed from a signal.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { env } from 'cloudflare:test';
import { ensureMigrated } from './setup';
import {
  readEconomicExposure,
  economicExposureCard,
  type ExternalPulse,
} from '../services/persona-insights';

const TENANT = `econ-${randomUUID().slice(0, 8)}`;
const EMPTY_TENANT = `econ-empty-${randomUUID().slice(0, 8)}`;

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function seedPo(currency: string, total: number, status: string, orderDate: string) {
  await env.DB.prepare(
    `INSERT INTO erp_purchase_orders (id, tenant_id, po_number, order_date, total, currency, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(randomUUID(), TENANT, `PO-${randomUUID().slice(0, 6)}`, orderDate, total, currency, status).run();
}

async function seedInvoice(currency: string, total: number, status: string, invoiceDate: string) {
  await env.DB.prepare(
    `INSERT INTO erp_invoices (id, tenant_id, invoice_number, invoice_date, total, currency, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(randomUUID(), TENANT, `INV-${randomUUID().slice(0, 6)}`, invoiceDate, total, currency, status).run();
}

beforeAll(async () => {
  await ensureMigrated();
  for (const t of [TENANT, EMPTY_TENANT]) {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, 'Econ Co', ?, 'enterprise', 'active')`,
    ).bind(t, t).run();
  }
  await seedPo('USD', 100_000, 'approved', daysAgo(30));
  await seedPo('USD', 50_000, 'approved', daysAgo(60));
  await seedPo('EUR', 30_000, 'approved', daysAgo(90));
  await seedPo('USD', 999_999, 'cancelled', daysAgo(30));   // excluded: cancelled
  await seedPo('USD', 888_888, 'approved', daysAgo(400));   // excluded: outside 12mo
  await seedPo('ZAR', 777_777, 'approved', daysAgo(30));    // excluded: base currency
  await seedInvoice('USD', 200_000, 'sent', daysAgo(20));
  await seedInvoice('EUR', 111_111, 'cancelled', daysAgo(20)); // excluded: cancelled
});

describe('readEconomicExposure', () => {
  it('merges trailing-12mo PO spend and invoiced revenue per foreign currency', async () => {
    const legs = await readEconomicExposure(env.DB, TENANT);
    expect(legs).toEqual([
      { currency: 'USD', spend_native: 150_000, po_count: 2, revenue_native: 200_000, invoice_count: 1 },
      { currency: 'EUR', spend_native: 30_000, po_count: 1, revenue_native: 0, invoice_count: 0 },
    ]);
  });

  it('empty tenant → no legs', async () => {
    expect(await readEconomicExposure(env.DB, EMPTY_TENANT)).toEqual([]);
  });
});

describe('economicExposureCard', () => {
  const LEGS = [
    { currency: 'USD', spend_native: 150_000, po_count: 2, revenue_native: 200_000, invoice_count: 1 },
    { currency: 'EUR', spend_native: 30_000, po_count: 1, revenue_native: 0, invoice_count: 0 },
  ];
  const PULSE: ExternalPulse = {
    fx: {
      signal_id: 'sig-fx', signal_key: 'fx.usd_zar', value: 18.72, unit: 'ZAR',
      direction: 'up', change_pct: 2.1, as_of: '2026-07-14',
    },
    brent: null,
    cpi: { signal_id: 'sig-cpi', signal_key: 'macro.za_cpi_inflation', value: 4.4, unit: '% y/y', direction: 'flat', change_pct: null, as_of: '2025' },
    gdp: null,
    news_latest: { signal_id: 'sig-news', title: 'Rand slides on power cuts', url: 'https://news.test/a', date: '2026-07-14', domain: 'news.test' },
    regulatory_latest: null,
  };

  it('CPO card = input-cost side, context-only, suggestion pairs booked spend with rate move + CPI + news', () => {
    const card = economicExposureCard('cpo', LEGS, PULSE, 'a1');
    expect(card).not.toBeNull();
    expect(card!.value_zar).toBeNull();
    expect(card!.value_kind).toBe('context');
    expect(card!.headline).toContain('input costs');
    expect(card!.headline).toContain('USD');
    expect(card!.headline).toContain('EUR');
    expect(card!.detail).toContain('weaker rand raises');
    expect(card!.detail).toContain('CPI inflation 4.4%');
    expect(card!.detail).toContain('Rand slides on power cuts');
    expect(card!.detail).toContain('Context only');
    expect(card!.external_context?.signal).toBe('fx.usd_zar');
  });

  it('CMO card = demand side, only currencies with revenue', () => {
    const card = economicExposureCard('cmo', LEGS, PULSE, 'a1');
    expect(card!.headline).toContain('revenue');
    expect(card!.headline).toContain('USD');
    expect(card!.headline).not.toContain('EUR');
    expect(card!.detail).toContain('lifts the rand value');
    expect(card!.value_zar).toBeNull();
  });

  it('CFO card = value-chain net position per currency', () => {
    const card = economicExposureCard('cfo', LEGS, PULSE, 'a1');
    expect(card!.headline).toContain('Value-chain');
    expect(card!.detail).toContain('revenue exceeds spend by USD 50k');
    expect(card!.detail).toContain('spend exceeds revenue by EUR 30k');
    expect(card!.detail).toContain('natural hedge');
    expect(card!.value_zar).toBeNull();
  });

  it('personas outside the map and empty legs → no card', () => {
    expect(economicExposureCard('coo', LEGS, PULSE, 'a1')).toBeNull();
    expect(economicExposureCard('cfo', [], PULSE, 'a1')).toBeNull();
  });

  it('no pulse → card still renders from booked rows alone, no suggestion', () => {
    const card = economicExposureCard('cpo', LEGS, null, 'a1');
    expect(card).not.toBeNull();
    expect(card!.detail).not.toContain('Potential effect');
    expect(card!.external_context).toBeUndefined();
  });
});
