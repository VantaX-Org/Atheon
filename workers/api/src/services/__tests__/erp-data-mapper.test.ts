import { describe, it, expect } from 'vitest';
import {
  extractCompanyKey,
  mapRecord,
  canonicalTableName,
} from '../erp-data-mapper';

// ---------------------------------------------------------------------------
// All three exported functions are PURE (no D1). They call crypto.randomUUID()
// and new Date().toISOString() for id/updated_at, which are non-deterministic,
// so those two fields are checked for shape only — every other field has an
// independently hand-computed oracle below.
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ═══════════════════════════════════════════════════════════════════════════
// canonicalTableName
// Oracle: mirror the documented intent — group each entity alias to its table
// from first principles, not by echoing the source.
// ═══════════════════════════════════════════════════════════════════════════
describe('canonicalTableName', () => {
  const cases: Array<[string, string | null]> = [
    ['customers', 'erp_customers'],
    ['contacts', 'erp_customers'],
    ['accounts', 'erp_customers'],
    ['business_partners', 'erp_customers'],
    ['suppliers', 'erp_suppliers'],
    ['vendors', 'erp_suppliers'],
    ['invoices', 'erp_invoices'],
    ['sales_invoices', 'erp_invoices'],
    ['purchase_invoices', 'erp_invoices'],
    ['sales_orders', 'erp_invoices'],
    ['products', 'erp_products'],
    ['items', 'erp_products'],
    ['stock_items', 'erp_products'],
    ['inventory', 'erp_products'],
    ['materials', 'erp_products'],
    ['purchase_orders', 'erp_purchase_orders'],
    ['gl_accounts', 'erp_gl_accounts'],
    ['ledger_accounts', 'erp_gl_accounts'],
    ['gl_journals', 'erp_gl_accounts'],
    ['employees', 'erp_employees'],
    ['workers', 'erp_employees'],
    ['nonsense', null],
    ['', null],
  ];
  for (const [input, expected] of cases) {
    it(`maps "${input}" -> ${expected}`, () => {
      expect(canonicalTableName(input)).toBe(expected);
    });
  }

  it('is case-insensitive on the entity type', () => {
    expect(canonicalTableName('Customers')).toBe('erp_customers');
    expect(canonicalTableName('PURCHASE_ORDERS')).toBe('erp_purchase_orders');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// extractCompanyKey
// Oracle: per-vendor field precedence read straight from the doc block +
// asKey() rules (trim; '' and 'false' -> undefined).
// ═══════════════════════════════════════════════════════════════════════════
describe('extractCompanyKey', () => {
  it('SAP: prefers BUKRS', () => {
    expect(extractCompanyKey('sap', { BUKRS: '1000', CompanyCode: '9999' })).toBe('1000');
  });

  it('SAP: falls back to CompanyCode string; normalises messy system names', () => {
    // 'SAP S/4HANA' -> lowercase + strip [\s_-] -> 'saps/4hana' (still .includes('sap'))
    expect(extractCompanyKey('SAP S/4HANA', { CompanyCode: '2000' })).toBe('2000');
  });

  it('SAP: whitespace-only value is treated as absent (undefined)', () => {
    expect(extractCompanyKey('sap', { BUKRS: '   ' })).toBeUndefined();
  });

  // Regression: when raw.CompanyCode is a nested OBJECT, asKey must reject it
  // (not stringify to "[object Object]") so the nested `?.CompanyCode` fallback
  // at erp-data-mapper.ts:622 is reachable and yields the real code.
  it('SAP: nested-object CompanyCode unwraps to the inner code', () => {
    expect(extractCompanyKey('sap', { CompanyCode: { CompanyCode: '3000' } })).toBe('3000');
  });

  it('Odoo: [id, name] tuple -> id as string', () => {
    expect(extractCompanyKey('odoo', { company_id: [5, 'My Company'] })).toBe('5');
  });

  it('Odoo: bare int -> string', () => {
    expect(extractCompanyKey('odoo', { company_id: 7 })).toBe('7');
  });

  it('Odoo: false (empty relation) -> undefined', () => {
    expect(extractCompanyKey('odoo', { company_id: false })).toBeUndefined();
  });

  it('Xero: TenantId', () => {
    expect(extractCompanyKey('xero', { TenantId: 't-guid', OrganisationID: 'org' })).toBe('t-guid');
  });

  it('Dynamics 365: companyId GUID', () => {
    expect(extractCompanyKey('dynamics365', { companyId: 'guid-1' })).toBe('guid-1');
  });

  it('NetSuite: subsidiary object -> id', () => {
    expect(extractCompanyKey('netsuite', { subsidiary: { id: '2', refName: 'AU' } })).toBe('2');
  });

  it('NetSuite: subsidiary scalar id', () => {
    expect(extractCompanyKey('netsuite', { subsidiary: 5 })).toBe('5');
  });

  it('Oracle Fusion: BusinessUnitId (and not caught by the netsuite branch)', () => {
    expect(extractCompanyKey('oracle', { BusinessUnitId: 'BU1' })).toBe('BU1');
  });

  it('Workday: Company_Reference.ID', () => {
    expect(extractCompanyKey('workday', { Company_Reference: { ID: 'W1' } })).toBe('W1');
  });

  it('Sage Business Cloud: business_id', () => {
    expect(extractCompanyKey('sage', { business_id: 'b1' })).toBe('b1');
  });

  it('Sage Pastel: CompanyDatabase (pastel branch, even for "sage_pastel")', () => {
    expect(extractCompanyKey('pastel', { CompanyDatabase: 'DEMO' })).toBe('DEMO');
    // 'sage_pastel' -> 'sagepastel'; sage branch is guarded by !includes('pastel')
    expect(extractCompanyKey('sage_pastel', { CompanyDatabase: 'DEMO2' })).toBe('DEMO2');
  });

  it('Salesforce & QuickBooks: no native multi-company -> undefined', () => {
    expect(extractCompanyKey('salesforce', { Id: 'x' })).toBeUndefined();
    expect(extractCompanyKey('quickbooks', { Id: 'x' })).toBeUndefined();
  });

  it('Unknown system -> undefined', () => {
    expect(extractCompanyKey('acme-erp', { anything: 1 })).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// mapRecord
// Oracle: each expected object below is hand-derived from the vendor mapper's
// field expressions. Non-deterministic id/updated_at checked for shape only.
// ═══════════════════════════════════════════════════════════════════════════
describe('mapRecord', () => {
  const TENANT = 't1';

  it('SAP customer: deletion flag -> inactive, ZAR default, provided CreationDate', () => {
    const raw = {
      Customer: 'C1', CustomerName: 'Acme',
      CreditLimit: '5000', DeletionIndicator: 1,
      CreationDate: '2020-01-01T00:00:00Z',
    };
    const r = mapRecord('sap', 'customers', raw, TENANT) as any;
    expect(r).not.toBeNull();
    expect(r.id).toMatch(UUID_RE);
    expect(r.tenant_id).toBe('t1');
    expect(r.source_system).toBe('sap');
    expect(r.source_id).toBe('C1');
    expect(r.name).toBe('Acme');
    expect(r.email).toBe('');
    expect(r.credit_limit).toBe(5000);
    expect(r.outstanding_balance).toBe(0);
    expect(r.currency).toBe('ZAR');
    expect(r.status).toBe('inactive');
    expect(r.created_at).toBe('2020-01-01T00:00:00Z');
    expect(typeof r.updated_at).toBe('string');
  });

  it('QuickBooks invoice: subtotal = TotalAmt - tax; amount_paid = TotalAmt - Balance', () => {
    const raw = {
      Id: '7', DocNumber: 'INV-7',
      CustomerRef: { value: '42', name: 'Bob' },
      TxnDate: '2021-05-01', DueDate: '2021-06-01',
      CurrencyRef: { value: 'USD' },
      TotalAmt: 115, TxnTaxDetail: { TotalTax: 15 }, Balance: 40,
    };
    const r = mapRecord('quickbooks', 'invoices', raw, TENANT) as any;
    expect(r.source_system).toBe('quickbooks');
    expect(r.source_id).toBe('7');
    expect(r.invoice_number).toBe('INV-7');
    expect(r.customer_id).toBe('42');
    expect(r.customer_name).toBe('Bob');
    expect(r.currency).toBe('USD');
    expect(r.subtotal).toBe(100); // 115 - 15
    expect(r.tax).toBe(15);
    expect(r.total).toBe(115);
    expect(r.amount_paid).toBe(75); // 115 - 40
    expect(r.amount_due).toBe(40);
    expect(r.status).toBe('sent'); // Balance != 0
  });

  it('QuickBooks invoice: zero balance -> paid', () => {
    const r = mapRecord('quickbooks', 'invoices', { Id: '8', TotalAmt: 50, Balance: 0 }, TENANT) as any;
    expect(r.amount_paid).toBe(50);
    expect(r.status).toBe('paid');
  });

  it('Xero invoice: AUTHORISED status maps to "sent", line_items JSON-encoded', () => {
    const raw = {
      InvoiceID: 'x1', InvoiceNumber: 'XN-1',
      Contact: { ContactID: 'cc1', Name: 'Cust' },
      DateString: '2022-01-01', DueDateString: '2022-02-01',
      CurrencyCode: 'GBP',
      SubTotal: 100, TotalTax: 20, Total: 120,
      AmountPaid: 50, AmountDue: 70,
      Status: 'AUTHORISED', LineItems: [{ a: 1 }],
    };
    const r = mapRecord('xero', 'invoices', raw, TENANT) as any;
    expect(r.source_system).toBe('xero');
    expect(r.source_id).toBe('x1');
    expect(r.invoice_number).toBe('XN-1');
    expect(r.customer_id).toBe('cc1');
    expect(r.customer_name).toBe('Cust');
    expect(r.invoice_date).toBe('2022-01-01');
    expect(r.due_date).toBe('2022-02-01');
    expect(r.currency).toBe('GBP');
    expect(r.subtotal).toBe(100);
    expect(r.tax).toBe(20);
    expect(r.total).toBe(120);
    expect(r.amount_paid).toBe(50);
    expect(r.amount_due).toBe(70);
    expect(r.status).toBe('sent');
    expect(r.line_items).toBe('[{"a":1}]');
  });

  it('Odoo invoice: posted+not-paid -> sent; amount_paid = total - residual; tuple fields unpacked', () => {
    const raw = {
      id: 9, name: 'INV/9', ref: 'r',
      partner_id: [3, 'PartnerX'],
      invoice_date: '2023-03-03', invoice_date_due: '2023-04-04',
      currency_id: [1, 'USD'],
      amount_untaxed: 200, amount_tax: 30, amount_total: 230, amount_residual: 30,
      move_type: 'out_invoice', state: 'posted', payment_state: 'not_paid',
      invoice_line_ids: [1, 2],
    };
    const r = mapRecord('odoo', 'invoices', raw, TENANT) as any;
    expect(r.source_id).toBe('9');
    expect(r.invoice_number).toBe('INV/9');
    expect(r.customer_id).toBe('3');
    expect(r.customer_name).toBe('PartnerX');
    expect(r.currency).toBe('USD');
    expect(r.subtotal).toBe(200);
    expect(r.tax).toBe(30);
    expect(r.total).toBe(230);
    expect(r.amount_paid).toBe(200); // 230 - 30
    expect(r.amount_due).toBe(30);
    expect(r.status).toBe('sent');
    expect(r.line_items).toBe('[1,2]');
  });

  it('Odoo invoice: refund move_type forces cancelled regardless of state/payment', () => {
    const raw = {
      id: 10, partner_id: [3, 'P'], currency_id: [1, 'USD'],
      move_type: 'out_refund', state: 'posted', payment_state: 'paid',
      amount_total: 100, amount_residual: 0,
    };
    const r = mapRecord('odoo', 'invoices', raw, TENANT) as any;
    expect(r.status).toBe('cancelled');
  });

  it('Salesforce accounts entity routes to the customer mapper', () => {
    const r = mapRecord('salesforce', 'accounts', { Id: 'a1', Name: 'SF Co' }, TENANT) as any;
    expect(r.source_system).toBe('salesforce');
    expect(r.name).toBe('SF Co');
    expect(r.currency).toBe('USD'); // salesforce default
  });

  it('normalises system + entityType casing/separators', () => {
    const r = mapRecord('SAP', 'Customers', { Customer: 'Z9' }, TENANT) as any;
    expect(r).not.toBeNull();
    expect(r.source_system).toBe('sap');
    expect(r.source_id).toBe('Z9');
  });

  it('stamps ctx.companyId onto the mapped row', () => {
    const r = mapRecord('sap', 'customers', { Customer: 'C1' }, TENANT, { companyId: 'co-99' }) as any;
    expect(r.company_id).toBe('co-99');
  });

  it('leaves company_id undefined when no ctx given', () => {
    const r = mapRecord('sap', 'customers', { Customer: 'C1' }, TENANT) as any;
    expect(r.company_id).toBeUndefined();
  });

  it('produces a fresh id per call', () => {
    const a = mapRecord('sap', 'customers', { Customer: 'C1' }, TENANT) as any;
    const b = mapRecord('sap', 'customers', { Customer: 'C1' }, TENANT) as any;
    expect(a.id).not.toBe(b.id);
  });

  it('returns null for unknown system', () => {
    expect(mapRecord('acme-erp', 'customers', {}, TENANT)).toBeNull();
  });

  it('returns null for a system that lacks a mapper for the entity', () => {
    // SAP has no employee mapper; Xero has no purchase_orders mapper.
    expect(mapRecord('sap', 'employees', {}, TENANT)).toBeNull();
    expect(mapRecord('xero', 'purchase_orders', {}, TENANT)).toBeNull();
  });
});
