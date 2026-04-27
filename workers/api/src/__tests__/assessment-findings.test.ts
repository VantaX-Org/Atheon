/**
 * Assessment Findings Engine — integration tests.
 *
 * Each test seeds a focused ERP fixture and asserts the matching detector
 * fires (and the unrelated detectors don't). The detectors are best-in-the-
 * world because revenue depends on them; these tests are the safety net.
 *
 * Strategy:
 *   - Each test uses a unique tenant id to isolate from other tests.
 *   - Migration is run once via the admin endpoint then we INSERT directly.
 *   - Assertions cover both the "fires" path and the "doesn't fire on empty"
 *     path so we don't silently accept a regression that broke a detector.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  detectAllFindings,
  detectAllFindingsByCompany,
  summariseFindings,
  FINDING_CATALYST_MAP,
  type FindingCode,
  type FindingsContext,
} from '../services/assessment-findings';

const CTX: FindingsContext = {
  baseCurrency: 'ZAR',
  exchangeRates: { ZAR: 1.0, USD: 18.5, EUR: 20.0 },
  monthsOfData: 12,
};

let testCounter = 0;
function nextTenantId(prefix: string): string {
  testCounter += 1;
  return `findings-${prefix}-${testCounter}`;
}

async function migrate(): Promise<void> {
  const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
    method: 'POST',
    headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
  });
  if (res.status !== 200) throw new Error(`Migration failed: ${res.status}`);
}

async function seedTenant(tenantId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`,
  ).bind(tenantId, tenantId, tenantId).run();
}

async function findingByCode(tenantId: string, code: FindingCode) {
  const findings = await detectAllFindings(env.DB, tenantId, CTX);
  return findings.find(f => f.code === code) || null;
}

describe('Assessment Findings — sanity', () => {
  beforeAll(async () => {
    await migrate();
  });

  it('returns no findings for a tenant with no ERP data', async () => {
    const tenantId = nextTenantId('empty');
    await seedTenant(tenantId);
    const findings = await detectAllFindings(env.DB, tenantId, CTX);
    expect(findings).toEqual([]);
  });

  it('every FindingCode has a catalyst mapping', () => {
    const codes = Object.keys(FINDING_CATALYST_MAP);
    expect(codes.length).toBeGreaterThanOrEqual(30);
    for (const c of codes) {
      const m = FINDING_CATALYST_MAP[c as FindingCode];
      expect(m.catalyst).toBeTruthy();
      expect(m.sub_catalyst).toBeTruthy();
    }
  });

  it('summariseFindings returns 0 totals for empty findings', () => {
    const s = summariseFindings([]);
    expect(s.total_count).toBe(0);
    expect(s.total_value_at_risk_zar).toBe(0);
    expect(s.recommended_catalysts).toEqual([]);
  });
});

describe('Assessment Findings — AR aging detectors', () => {
  beforeAll(async () => { await migrate(); });

  it('detects 30-60, 60-90, and 90+ day buckets independently', async () => {
    const tenantId = nextTenantId('ar-aging');
    await seedTenant(tenantId);
    // Seed 5 unpaid invoices in each bucket — small enough to land in 'low'/'medium'
    // but enough to trip the "0 unpaid invoices in bucket → no finding" guard.
    const today = new Date();
    const offsets = [
      { days: 45, bucket: 30 },     // 30-60
      { days: 75, bucket: 60 },     // 60-90
      { days: 120, bucket: 90 },    // 90+
    ];
    for (const o of offsets) {
      for (let i = 0; i < 5; i++) {
        const dueDate = new Date(today.getTime() - o.days * 86400_000).toISOString().slice(0, 10);
        await env.DB.prepare(
          `INSERT INTO erp_invoices (id, tenant_id, invoice_number, customer_name,
             invoice_date, due_date, total, amount_due, currency, payment_status, status)
           VALUES (?, ?, ?, ?, date('now', '-' || ? || ' days'), ?, ?, ?, 'ZAR', 'unpaid', 'sent')`,
        ).bind(
          `inv-${tenantId}-${o.bucket}-${i}`, tenantId,
          `INV-${o.bucket}-${i}`, `Customer ${o.bucket}-${i}`,
          o.days + 30, dueDate, 50_000, 50_000,
        ).run();
      }
    }

    const findings = await detectAllFindings(env.DB, tenantId, CTX);
    const codes = findings.map(f => f.code);
    expect(codes).toContain('ar_aging_overdue_30_60');
    expect(codes).toContain('ar_aging_overdue_60_90');
    expect(codes).toContain('ar_aging_overdue_90_plus');

    const f90 = findings.find(f => f.code === 'ar_aging_overdue_90_plus')!;
    expect(f90.affected_count).toBe(5);
    expect(f90.value_at_risk_zar).toBeGreaterThan(0);
    expect(f90.sample_records.length).toBeLessThanOrEqual(10);
    expect(f90.recommended_catalyst.catalyst).toBe('Finance');
    expect(f90.recommended_catalyst.sub_catalyst).toBe('AR Collection');
    expect(f90.severity).toMatch(/^(high|critical)$/);
    expect(f90.metric_signature).toBe('ar_aging_overdue_90_plus');
  });

  it('credit-limit-breach fires for over-limit customers and quotes the breach', async () => {
    const tenantId = nextTenantId('ar-credit');
    await seedTenant(tenantId);
    for (let i = 0; i < 6; i++) {
      await env.DB.prepare(
        `INSERT INTO erp_customers (id, tenant_id, name, credit_limit, credit_balance, currency, status)
         VALUES (?, ?, ?, ?, ?, 'ZAR', 'active')`,
      ).bind(`cust-${tenantId}-${i}`, tenantId, `Over-Limit ${i}`, 100_000, 200_000).run();
    }
    const f = await findingByCode(tenantId, 'ar_credit_limit_breach');
    expect(f).not.toBeNull();
    expect(f!.affected_count).toBe(6);
    expect(f!.title).toContain('exceeding credit limit');
    expect(f!.recommended_catalyst.sub_catalyst).toBe('Credit Vetting');
  });

  it('top-debtor-concentration fires when 5 customers hold ≥50% of AR', async () => {
    const tenantId = nextTenantId('ar-conc');
    await seedTenant(tenantId);
    // 5 big debtors + 5 small ones. Top 5 = 5 × 1M = 5M, total = 5M + 5 × 100k = 5.5M, 91%.
    for (let i = 0; i < 5; i++) {
      await env.DB.prepare(
        `INSERT INTO erp_invoices (id, tenant_id, invoice_number, customer_name, invoice_date, total, amount_due, currency, payment_status, status)
         VALUES (?, ?, ?, ?, date('now', '-30 days'), ?, ?, 'ZAR', 'unpaid', 'sent')`,
      ).bind(`inv-big-${tenantId}-${i}`, tenantId, `INV-BIG-${i}`, `Big Customer ${i}`, 1_000_000, 1_000_000).run();
    }
    for (let i = 0; i < 5; i++) {
      await env.DB.prepare(
        `INSERT INTO erp_invoices (id, tenant_id, invoice_number, customer_name, invoice_date, total, amount_due, currency, payment_status, status)
         VALUES (?, ?, ?, ?, date('now', '-30 days'), ?, ?, 'ZAR', 'unpaid', 'sent')`,
      ).bind(`inv-sml-${tenantId}-${i}`, tenantId, `INV-SML-${i}`, `Small Customer ${i}`, 100_000, 100_000).run();
    }
    const f = await findingByCode(tenantId, 'ar_top_debtor_concentration');
    expect(f).not.toBeNull();
    expect(f!.title).toContain('Top 5 customers');
  });
});

describe('Assessment Findings — Inventory detectors', () => {
  beforeAll(async () => { await migrate(); });

  it('negative-stock fires for SKUs with stock_on_hand < 0', async () => {
    const tenantId = nextTenantId('inv-neg');
    await seedTenant(tenantId);
    for (let i = 0; i < 3; i++) {
      await env.DB.prepare(
        `INSERT INTO erp_products (id, tenant_id, sku, name, cost_price, selling_price, stock_on_hand, is_active)
         VALUES (?, ?, ?, ?, 100, 200, ?, 1)`,
      ).bind(`prod-${tenantId}-${i}`, tenantId, `SKU-NEG-${i}`, `Negative Stock ${i}`, -10).run();
    }
    const f = await findingByCode(tenantId, 'inv_negative_stock');
    expect(f).not.toBeNull();
    expect(f!.affected_count).toBe(3);
    expect(f!.recommended_catalyst.sub_catalyst).toBe('Inventory Data Quality');
  });

  it('margin-erosion fires for SKUs where cost ≥ selling', async () => {
    const tenantId = nextTenantId('inv-margin');
    await seedTenant(tenantId);
    for (let i = 0; i < 4; i++) {
      await env.DB.prepare(
        `INSERT INTO erp_products (id, tenant_id, sku, name, cost_price, selling_price, stock_on_hand, is_active)
         VALUES (?, ?, ?, ?, 200, 150, 50, 1)`,
      ).bind(`prod-mg-${tenantId}-${i}`, tenantId, `SKU-MG-${i}`, `Loss Maker ${i}`).run();
    }
    const f = await findingByCode(tenantId, 'inv_margin_erosion');
    expect(f).not.toBeNull();
    // 4 SKUs × (200-150) × 50 = R10,000 loss exposure
    expect(f!.value_at_risk_zar).toBe(10_000);
    expect(f!.recommended_catalyst.catalyst).toBe('Sales');
    expect(f!.recommended_catalyst.sub_catalyst).toBe('Pricing & Margin Analysis');
  });

  it('inactive-with-value fires for is_active=0 SKUs with stock', async () => {
    const tenantId = nextTenantId('inv-inactive');
    await seedTenant(tenantId);
    await env.DB.prepare(
      `INSERT INTO erp_products (id, tenant_id, sku, name, cost_price, stock_on_hand, is_active)
       VALUES (?, ?, ?, ?, 1000, 100, 0)`,
    ).bind(`prod-iv-${tenantId}-1`, tenantId, 'SKU-INA-1', 'Discontinued').run();
    const f = await findingByCode(tenantId, 'inv_inactive_with_value');
    expect(f).not.toBeNull();
    expect(f!.affected_count).toBe(1);
  });

  it('below-reorder fires for SKUs under their reorder level', async () => {
    const tenantId = nextTenantId('inv-reorder');
    await seedTenant(tenantId);
    for (let i = 0; i < 25; i++) {
      await env.DB.prepare(
        `INSERT INTO erp_products (id, tenant_id, sku, name, cost_price, stock_on_hand, reorder_level, is_active)
         VALUES (?, ?, ?, ?, 50, 5, 20, 1)`,
      ).bind(`prod-ro-${tenantId}-${i}`, tenantId, `SKU-RO-${i}`, `Below Reorder ${i}`).run();
    }
    const f = await findingByCode(tenantId, 'inv_below_reorder');
    expect(f).not.toBeNull();
    expect(f!.affected_count).toBe(25);
    expect(f!.severity).toMatch(/^(medium|high)$/);
  });
});

describe('Assessment Findings — Procurement detectors', () => {
  beforeAll(async () => { await migrate(); });

  it('inactive-supplier-with-open-pos fires', async () => {
    const tenantId = nextTenantId('proc-inactive');
    await seedTenant(tenantId);
    await env.DB.prepare(
      `INSERT INTO erp_suppliers (id, tenant_id, name, status) VALUES (?, ?, 'Closed Supplier', 'inactive')`,
    ).bind(`sup-${tenantId}-1`, tenantId).run();
    await env.DB.prepare(
      `INSERT INTO erp_purchase_orders (id, tenant_id, po_number, supplier_name, order_date, total, currency, status, delivery_status)
       VALUES (?, ?, 'PO-001', 'Closed Supplier', date('now', '-30 days'), 250000, 'ZAR', 'open', 'pending')`,
    ).bind(`po-${tenantId}-1`, tenantId).run();
    const f = await findingByCode(tenantId, 'proc_inactive_with_open_pos');
    expect(f).not.toBeNull();
    expect(f!.affected_count).toBe(1);
  });

  it('duplicate-suppliers fires when 2+ share a VAT number', async () => {
    const tenantId = nextTenantId('proc-dup');
    await seedTenant(tenantId);
    for (let i = 0; i < 3; i++) {
      await env.DB.prepare(
        `INSERT INTO erp_suppliers (id, tenant_id, name, vat_number, status) VALUES (?, ?, ?, ?, 'active')`,
      ).bind(`sup-${tenantId}-${i}`, tenantId, `Supplier Variant ${i}`, '1234567890').run();
    }
    const f = await findingByCode(tenantId, 'proc_duplicate_suppliers');
    expect(f).not.toBeNull();
    // GROUP BY VAT collapses to 1 group with 3 records
    expect(f!.affected_count).toBe(3);
  });
});

describe('Assessment Findings — HR detectors', () => {
  beforeAll(async () => { await migrate(); });

  it('terminated-in-payroll fires for terminated employees with non-zero salary', async () => {
    const tenantId = nextTenantId('hr-term');
    await seedTenant(tenantId);
    await env.DB.prepare(
      `INSERT INTO erp_employees (id, tenant_id, employee_number, first_name, last_name, gross_salary, salary_frequency, status)
       VALUES (?, ?, 'E001', 'Ghost', 'Worker', 50000, 'monthly', 'terminated')`,
    ).bind(`emp-${tenantId}-1`, tenantId).run();
    const f = await findingByCode(tenantId, 'hr_terminated_in_payroll');
    expect(f).not.toBeNull();
    expect(f!.value_at_risk_zar).toBe(50_000 * 12); // annualised
    expect(f!.recommended_catalyst.sub_catalyst).toBe('Payroll Audit');
  });
});

describe('Assessment Findings — Tax + FX detectors', () => {
  beforeAll(async () => { await migrate(); });

  it('overdue-vat-submission fires for entries 60+ days old', async () => {
    const tenantId = nextTenantId('tax-vat');
    await seedTenant(tenantId);
    await env.DB.prepare(
      `INSERT INTO erp_tax_entries (id, tenant_id, tax_period, tax_type, output_vat, input_vat, net_vat, status, created_at)
       VALUES (?, ?, '2025-01', 'VAT', 100000, 30000, 70000, 'draft', datetime('now', '-90 days'))`,
    ).bind(`tax-${tenantId}-1`, tenantId).run();
    const f = await findingByCode(tenantId, 'tax_overdue_submission');
    expect(f).not.toBeNull();
    // Penalty risk = 70k × 15% = 10.5k
    expect(f!.value_at_risk_zar).toBeCloseTo(10_500, -1);
    expect(f!.severity).toMatch(/^(medium|high|critical)$/);
  });

  it('vat-rate-anomaly fires for ZAR invoices with non-15% effective rate', async () => {
    const tenantId = nextTenantId('tax-rate');
    await seedTenant(tenantId);
    // 5 invoices with 10% VAT instead of 15%
    for (let i = 0; i < 5; i++) {
      await env.DB.prepare(
        `INSERT INTO erp_invoices (id, tenant_id, invoice_number, customer_name, invoice_date, subtotal, vat_amount, total, currency, payment_status, status)
         VALUES (?, ?, ?, ?, date('now', '-10 days'), 100000, 10000, 110000, 'ZAR', 'unpaid', 'sent')`,
      ).bind(`inv-rate-${tenantId}-${i}`, tenantId, `INV-RATE-${i}`, `Customer ${i}`).run();
    }
    const f = await findingByCode(tenantId, 'tax_vat_rate_anomaly');
    expect(f).not.toBeNull();
    expect(f!.affected_count).toBe(5);
  });

  it('fx-currency-exposure fires when there are unpaid foreign-currency invoices', async () => {
    const tenantId = nextTenantId('fx-exposure');
    await seedTenant(tenantId);
    for (let i = 0; i < 3; i++) {
      await env.DB.prepare(
        `INSERT INTO erp_invoices (id, tenant_id, invoice_number, customer_name, invoice_date, total, amount_due, currency, payment_status, status)
         VALUES (?, ?, ?, ?, date('now', '-30 days'), 50000, 50000, 'USD', 'unpaid', 'sent')`,
      ).bind(`inv-usd-${tenantId}-${i}`, tenantId, `INV-USD-${i}`, `US Customer ${i}`).run();
    }
    const f = await findingByCode(tenantId, 'fx_currency_exposure');
    expect(f).not.toBeNull();
    expect(f!.currency_breakdown.USD).toBeGreaterThan(0);
    // ZAR exposure = 3 × 50k × 18.5 = R2,775,000; volatility @ 10% = R277,500
    expect(f!.value_at_risk_zar).toBeCloseTo(277_500, -2);
  });
});

describe('Assessment Findings — sorting + summary', () => {
  beforeAll(async () => { await migrate(); });

  it('returns findings sorted by severity then value-at-risk', async () => {
    const tenantId = nextTenantId('sort');
    await seedTenant(tenantId);
    // High-severity FX exposure: 1× large USD invoice
    await env.DB.prepare(
      `INSERT INTO erp_invoices (id, tenant_id, invoice_number, customer_name, invoice_date, total, amount_due, currency, payment_status, status)
       VALUES (?, ?, 'INV-USD-BIG', 'Big USD Customer', date('now', '-30 days'), 1000000, 1000000, 'USD', 'unpaid', 'sent')`,
    ).bind(`inv-sort-1-${tenantId}`, tenantId).run();
    // Low-severity negative stock: 1 SKU
    await env.DB.prepare(
      `INSERT INTO erp_products (id, tenant_id, sku, name, cost_price, stock_on_hand, is_active)
       VALUES (?, ?, 'SKU-NEG-1', 'Neg One', 10, -1, 1)`,
    ).bind(`prod-sort-1-${tenantId}`, tenantId).run();

    const findings = await detectAllFindings(env.DB, tenantId, CTX);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    // First finding should have severity >= last finding's severity
    const order = ['low', 'medium', 'high', 'critical'];
    expect(order.indexOf(findings[0].severity)).toBeGreaterThanOrEqual(
      order.indexOf(findings[findings.length - 1].severity),
    );
  });

  it('summariseFindings rolls up counts, value, and unique catalysts', async () => {
    const tenantId = nextTenantId('summary');
    await seedTenant(tenantId);
    await env.DB.prepare(
      `INSERT INTO erp_products (id, tenant_id, sku, name, cost_price, stock_on_hand, is_active)
       VALUES (?, ?, 'SKU-1', 'A', 10, -1, 1)`,
    ).bind(`prod-${tenantId}-1`, tenantId).run();
    await env.DB.prepare(
      `INSERT INTO erp_employees (id, tenant_id, employee_number, first_name, last_name, gross_salary, salary_frequency, status)
       VALUES (?, ?, 'E1', 'Term', 'Worker', 30000, 'monthly', 'terminated')`,
    ).bind(`emp-${tenantId}-1`, tenantId).run();

    const findings = await detectAllFindings(env.DB, tenantId, CTX);
    const summary = summariseFindings(findings);
    expect(summary.total_count).toBeGreaterThanOrEqual(2);
    expect(summary.recommended_catalysts.length).toBeGreaterThanOrEqual(1);
    expect(summary.by_category.supply_chain.count).toBeGreaterThanOrEqual(1);
  });
});

describe('Assessment Findings — multi-company per-entity', () => {
  beforeAll(async () => { await migrate(); });

  it('returns one findings group per active erp_company, plus a consolidated rollup', async () => {
    const tenantId = nextTenantId('mc');
    await seedTenant(tenantId);
    // Two companies — ZA and UK — each with its own data quality issue.
    await env.DB.prepare(
      `INSERT INTO erp_companies (id, tenant_id, name, currency, country, is_primary, status)
       VALUES ('co-za', ?, 'VantaX South Africa', 'ZAR', 'ZA', 1, 'active')`,
    ).bind(tenantId).run();
    await env.DB.prepare(
      `INSERT INTO erp_companies (id, tenant_id, name, currency, country, is_primary, status)
       VALUES ('co-uk', ?, 'VantaX UK', 'GBP', 'GB', 0, 'active')`,
    ).bind(tenantId).run();

    // ZA company: 2 SKUs with negative stock (fires inv_negative_stock)
    for (let i = 0; i < 2; i++) {
      await env.DB.prepare(
        `INSERT INTO erp_products (id, tenant_id, company_id, sku, name, cost_price, stock_on_hand, is_active)
         VALUES (?, ?, 'co-za', ?, ?, 100, -5, 1)`,
      ).bind(`prod-mc-za-${i}`, tenantId, `SKU-ZA-${i}`, `ZA Product ${i}`).run();
    }
    // UK company: 1 inactive employee on payroll (fires hr_terminated_in_payroll).
    // erp_employees has no company_id column — finding is unscoped, so it
    // appears in BOTH company runs and the consolidated run.
    await env.DB.prepare(
      `INSERT INTO erp_employees (id, tenant_id, employee_number, first_name, last_name, gross_salary, salary_frequency, status)
       VALUES (?, ?, 'E-UK-001', 'Ghost', 'Worker', 80000, 'monthly', 'terminated')`,
    ).bind(`emp-mc-uk-1`, tenantId).run();

    const result = await detectAllFindingsByCompany(env.DB, tenantId, CTX);
    expect(result.per_company.length).toBe(2);
    const za = result.per_company.find(p => p.company.id === 'co-za')!;
    const uk = result.per_company.find(p => p.company.id === 'co-uk')!;
    expect(za).toBeTruthy();
    expect(uk).toBeTruthy();

    // ZA-only finding: negative stock with company_id tagged.
    const zaNeg = za.findings.find(f => f.code === 'inv_negative_stock');
    expect(zaNeg).toBeTruthy();
    expect(zaNeg!.company_id).toBe('co-za');
    expect(zaNeg!.company_name).toBe('VantaX South Africa');

    // UK shouldn't see ZA-scoped negative stock — its erp_products list is empty.
    const ukNeg = uk.findings.find(f => f.code === 'inv_negative_stock');
    expect(ukNeg).toBeUndefined();

    // Consolidated rollup runs WITHOUT company filter — sees the ZA stock and the unscoped employee.
    const consolidatedCodes = result.consolidated.map(f => f.code);
    expect(consolidatedCodes).toContain('inv_negative_stock');
    expect(consolidatedCodes).toContain('hr_terminated_in_payroll');
    // Consolidated findings are not company-tagged.
    expect(result.consolidated.every(f => f.company_id === undefined)).toBe(true);
  });

  it('falls back to a single tenant-wide run when no erp_companies are registered', async () => {
    const tenantId = nextTenantId('mc-empty');
    await seedTenant(tenantId);
    await env.DB.prepare(
      `INSERT INTO erp_products (id, tenant_id, sku, name, cost_price, stock_on_hand, is_active)
       VALUES (?, ?, 'SKU-NEG', 'A', 10, -3, 1)`,
    ).bind(`prod-mc-empty-1`, tenantId).run();

    const result = await detectAllFindingsByCompany(env.DB, tenantId, CTX);
    expect(result.per_company).toEqual([]);
    expect(result.consolidated.length).toBeGreaterThan(0);
    expect(result.consolidated.find(f => f.code === 'inv_negative_stock')).toBeTruthy();
  });
});

describe('Assessment Findings — multi-currency normalisation', () => {
  beforeAll(async () => { await migrate(); });

  it('normalises EUR amounts to ZAR using the rate table', async () => {
    const tenantId = nextTenantId('multicur');
    await seedTenant(tenantId);
    // 1 EUR invoice × R20/EUR = R20,000 ZAR equivalent
    await env.DB.prepare(
      `INSERT INTO erp_invoices (id, tenant_id, invoice_number, customer_name, invoice_date, due_date, total, amount_due, currency, payment_status, status)
       VALUES (?, ?, 'INV-EUR-1', 'EU Customer', date('now', '-100 days'), date('now', '-100 days'), 1000, 1000, 'EUR', 'unpaid', 'sent')`,
    ).bind(`inv-mc-${tenantId}-1`, tenantId).run();

    const findings = await detectAllFindings(env.DB, tenantId, CTX);
    const aging = findings.find(f => f.code === 'ar_aging_overdue_90_plus');
    expect(aging).toBeTruthy();
    expect(aging!.currency_breakdown.EUR).toBe(1000);
    // Recovery uplift = R20,000 × 12% = R2,400
    expect(aging!.value_at_risk_zar).toBe(2_400);
  });
});
