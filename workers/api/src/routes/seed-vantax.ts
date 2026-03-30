/**
 * VantaX Demo Data Seeder
 * Creates a realistic SAP S/4HANA demo environment with:
 * - Real ERP data (invoices, POs, suppliers, customers, products, bank transactions, GL entries)
 * - Configured sub-catalysts with data sources and field mappings
 * - SAP connector in erp_connections
 * - Deliberate discrepancies for realistic reconciliation results
 *
 * RESTRICTED: VantaX (Pty) Ltd demo environment only
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AuthContext, AppBindings } from '../types';

const seed = new Hono<AppBindings>();
seed.use('/*', cors());

async function getVantaXTenantId(c: any): Promise<string | null> {
  const auth = c.get('auth') as AuthContext | undefined;
  const allowedRoles = ['superadmin', 'support_admin', 'admin', 'executive'];
  if (!auth || !allowedRoles.includes(auth.role)) {
    return null;
  }
  const row = await c.env.DB.prepare(
    "SELECT id FROM tenants WHERE slug = 'vantax'"
  ).first() as { id: string } | null;
  return row?.id || null;
}

// South African supplier names (realistic SAP vendor master)
const SA_SUPPLIERS = [
  { name: 'Sasol Chemical Industries', vat: '4120456789', terms: 'Net 30', group: 'chemicals', city: 'Sasolburg', province: 'Free State' },
  { name: 'Tsebo Solutions Group', vat: '4230567890', terms: 'Net 45', group: 'facilities', city: 'Sandton', province: 'Gauteng' },
  { name: 'Barloworld Logistics', vat: '4340678901', terms: 'Net 30', group: 'logistics', city: 'Johannesburg', province: 'Gauteng' },
  { name: 'Bidvest Industrial', vat: '4450789012', terms: 'Net 60', group: 'industrial', city: 'Johannesburg', province: 'Gauteng' },
  { name: 'Grindrod Shipping', vat: '4560890123', terms: 'Net 30', group: 'shipping', city: 'Durban', province: 'KwaZulu-Natal' },
  { name: 'Nampak Packaging', vat: '4670901234', terms: 'Net 45', group: 'packaging', city: 'Johannesburg', province: 'Gauteng' },
  { name: 'Mpact Operations', vat: '4781012345', terms: 'Net 30', group: 'packaging', city: 'Pinetown', province: 'KwaZulu-Natal' },
  { name: 'ArcelorMittal SA', vat: '4891123456', terms: 'Net 60', group: 'steel', city: 'Vanderbijlpark', province: 'Gauteng' },
  { name: 'AECI Mining Explosives', vat: '4901234567', terms: 'Net 30', group: 'mining', city: 'Modderfontein', province: 'Gauteng' },
  { name: 'Omnia Holdings', vat: '4011345678', terms: 'Net 45', group: 'agriculture', city: 'Bryanston', province: 'Gauteng' },
  { name: 'Raubex Construction', vat: '4121456789', terms: 'Net 30', group: 'construction', city: 'Bloemfontein', province: 'Free State' },
  { name: 'Murray and Roberts', vat: '4231567890', terms: 'Net 60', group: 'construction', city: 'Bedfordview', province: 'Gauteng' },
  { name: 'Afrimat Limited', vat: '4341678901', terms: 'Net 30', group: 'mining', city: 'Worcester', province: 'Western Cape' },
  { name: 'DCD Group', vat: '4451789012', terms: 'Net 45', group: 'engineering', city: 'Vereeniging', province: 'Gauteng' },
  { name: 'enX Group', vat: '4561890123', terms: 'Net 30', group: 'industrial', city: 'Boksburg', province: 'Gauteng' },
];

const SA_CUSTOMERS = [
  { name: 'Pick n Pay Stores', reg: '1968/004855/06', group: 'retail', city: 'Cape Town', province: 'Western Cape' },
  { name: 'Woolworths Holdings', reg: '1929/001986/06', group: 'retail', city: 'Cape Town', province: 'Western Cape' },
  { name: 'Shoprite Holdings', reg: '1936/007721/06', group: 'retail', city: 'Brackenfell', province: 'Western Cape' },
  { name: 'Clicks Group', reg: '1996/000645/06', group: 'pharmacy', city: 'Cape Town', province: 'Western Cape' },
  { name: 'Discovery Health', reg: '1999/007789/06', group: 'insurance', city: 'Sandton', province: 'Gauteng' },
  { name: 'Old Mutual Ltd', reg: '1845/002001/06', group: 'financial', city: 'Cape Town', province: 'Western Cape' },
  { name: 'Naspers Group', reg: '1925/001431/06', group: 'media', city: 'Cape Town', province: 'Western Cape' },
  { name: 'Sasol Energy', reg: '1979/003231/06', group: 'energy', city: 'Sasolburg', province: 'Free State' },
  { name: 'MTN Group', reg: '1994/009283/06', group: 'telecoms', city: 'Fairland', province: 'Gauteng' },
  { name: 'Vodacom Business', reg: '1993/003367/06', group: 'telecoms', city: 'Midrand', province: 'Gauteng' },
  { name: 'Standard Bank Corp', reg: '1969/017128/06', group: 'banking', city: 'Johannesburg', province: 'Gauteng' },
  { name: 'FirstRand Limited', reg: '1966/010753/06', group: 'banking', city: 'Sandton', province: 'Gauteng' },
  { name: 'Transnet SOC Ltd', reg: '1990/000900/30', group: 'logistics', city: 'Johannesburg', province: 'Gauteng' },
  { name: 'Eskom Holdings', reg: '2002/015527/06', group: 'energy', city: 'Megawatt Park', province: 'Gauteng' },
  { name: 'City of Johannesburg', reg: '2000/002013/06', group: 'government', city: 'Johannesburg', province: 'Gauteng' },
  { name: 'Capitec Bank', reg: '1999/025903/06', group: 'banking', city: 'Stellenbosch', province: 'Western Cape' },
  { name: 'Nedbank Group', reg: '1966/010630/06', group: 'banking', city: 'Sandton', province: 'Gauteng' },
  { name: 'Sanlam Limited', reg: '1959/001562/06', group: 'financial', city: 'Bellville', province: 'Western Cape' },
  { name: 'Life Healthcare', reg: '2003/002733/06', group: 'healthcare', city: 'Rosebank', province: 'Gauteng' },
  { name: 'Netcare Limited', reg: '1996/015813/06', group: 'healthcare', city: 'Sandton', province: 'Gauteng' },
];

const SA_PRODUCTS = [
  { sku: 'SAP-RM-001', name: 'Polyethylene Resin (25kg)', cat: 'Raw Materials', cost: 1250.00, sell: 1625.00, stock: 450, reorder: 100, uom: 'BAG' },
  { sku: 'SAP-RM-002', name: 'Industrial Solvent (200L)', cat: 'Raw Materials', cost: 3800.00, sell: 4940.00, stock: 120, reorder: 30, uom: 'DRM' },
  { sku: 'SAP-RM-003', name: 'Carbon Steel Plate (6mm)', cat: 'Raw Materials', cost: 8500.00, sell: 11050.00, stock: 85, reorder: 20, uom: 'TON' },
  { sku: 'SAP-RM-004', name: 'Copper Wire (2.5mm, 100m)', cat: 'Raw Materials', cost: 2400.00, sell: 3360.00, stock: 200, reorder: 40, uom: 'COI' },
  { sku: 'SAP-RM-005', name: 'Aluminium Sheet (3mm)', cat: 'Raw Materials', cost: 6200.00, sell: 8060.00, stock: 65, reorder: 15, uom: 'TON' },
  { sku: 'SAP-FG-001', name: 'Industrial Lubricant (20L)', cat: 'Finished Goods', cost: 450.00, sell: 720.00, stock: 800, reorder: 200, uom: 'PCK' },
  { sku: 'SAP-FG-002', name: 'Mining Drill Bit (48mm)', cat: 'Finished Goods', cost: 2200.00, sell: 3520.00, stock: 340, reorder: 50, uom: 'EA' },
  { sku: 'SAP-FG-003', name: 'Safety Valve Assembly', cat: 'Finished Goods', cost: 15600.00, sell: 24960.00, stock: 45, reorder: 10, uom: 'EA' },
  { sku: 'SAP-FG-004', name: 'Transformer Oil (210L)', cat: 'Finished Goods', cost: 5800.00, sell: 8120.00, stock: 90, reorder: 20, uom: 'DRM' },
  { sku: 'SAP-SP-001', name: 'Conveyor Belt (10m)', cat: 'Spare Parts', cost: 4200.00, sell: 5880.00, stock: 25, reorder: 5, uom: 'ROL' },
  { sku: 'SAP-SP-002', name: 'Hydraulic Pump HX-400', cat: 'Spare Parts', cost: 28000.00, sell: 36400.00, stock: 12, reorder: 3, uom: 'EA' },
  { sku: 'SAP-SP-003', name: 'Electric Motor 75kW', cat: 'Spare Parts', cost: 42000.00, sell: 54600.00, stock: 8, reorder: 2, uom: 'EA' },
  { sku: 'SAP-PM-001', name: 'Packaging Film (500m)', cat: 'Packaging', cost: 680.00, sell: 884.00, stock: 1200, reorder: 300, uom: 'ROL' },
  { sku: 'SAP-PM-002', name: 'Corrugated Box (600x400)', cat: 'Packaging', cost: 18.50, sell: 27.75, stock: 5000, reorder: 1000, uom: 'EA' },
  { sku: 'SAP-CH-001', name: 'Sulfuric Acid (1000L)', cat: 'Chemicals', cost: 5200.00, sell: 7280.00, stock: 40, reorder: 10, uom: 'IBC' },
  { sku: 'SAP-CH-002', name: 'Caustic Soda Flake (25kg)', cat: 'Chemicals', cost: 890.00, sell: 1246.00, stock: 200, reorder: 50, uom: 'BAG' },
  { sku: 'SAP-EQ-001', name: 'PPE Safety Kit', cat: 'Equipment', cost: 350.00, sell: 525.00, stock: 600, reorder: 150, uom: 'KIT' },
  { sku: 'SAP-EQ-002', name: 'Fire Extinguisher (9kg)', cat: 'Equipment', cost: 780.00, sell: 1170.00, stock: 180, reorder: 30, uom: 'EA' },
];

// GL account chart of accounts (SAP FI)
const GL_ACCOUNTS = [
  { code: '1000', name: 'Cash and Cash Equivalents', type: 'asset', cls: 'current_asset', balance: 2450000 },
  { code: '1100', name: 'Trade Receivables', type: 'asset', cls: 'current_asset', balance: 3820000 },
  { code: '1200', name: 'Inventory - Raw Materials', type: 'asset', cls: 'current_asset', balance: 1680000 },
  { code: '1210', name: 'Inventory - Finished Goods', type: 'asset', cls: 'current_asset', balance: 2150000 },
  { code: '1300', name: 'Prepaid Expenses', type: 'asset', cls: 'current_asset', balance: 340000 },
  { code: '1500', name: 'Property Plant and Equipment', type: 'asset', cls: 'non_current_asset', balance: 12500000 },
  { code: '1510', name: 'Accumulated Depreciation', type: 'asset', cls: 'non_current_asset', balance: -4200000 },
  { code: '2000', name: 'Trade Payables', type: 'liability', cls: 'current_liability', balance: 2890000 },
  { code: '2100', name: 'VAT Output', type: 'liability', cls: 'current_liability', balance: 520000 },
  { code: '2200', name: 'VAT Input', type: 'asset', cls: 'current_asset', balance: 380000 },
  { code: '2300', name: 'PAYE Payable', type: 'liability', cls: 'current_liability', balance: 185000 },
  { code: '2400', name: 'Accrued Expenses', type: 'liability', cls: 'current_liability', balance: 450000 },
  { code: '3000', name: 'Share Capital', type: 'equity', cls: 'equity', balance: 5000000 },
  { code: '3100', name: 'Retained Earnings', type: 'equity', cls: 'equity', balance: 8200000 },
  { code: '4000', name: 'Revenue - Product Sales', type: 'revenue', cls: 'income', balance: 18500000 },
  { code: '4100', name: 'Revenue - Services', type: 'revenue', cls: 'income', balance: 4200000 },
  { code: '5000', name: 'Cost of Sales', type: 'expense', cls: 'expense', balance: 11800000 },
  { code: '5100', name: 'Employee Costs', type: 'expense', cls: 'expense', balance: 5600000 },
  { code: '5200', name: 'Operating Expenses', type: 'expense', cls: 'expense', balance: 2100000 },
  { code: '5300', name: 'Depreciation', type: 'expense', cls: 'expense', balance: 840000 },
];

/**
 * POST /api/v1/seed-vantax
 * Complete cleanup and reseed of VantaX demo environment with realistic SAP data.
 * Creates SAP connector, populates all ERP tables, configures sub-catalysts with
 * data_sources and field_mappings for real reconciliation execution.
 */
seed.post('/seed-vantax', async (c) => {
  const tenantId = await getVantaXTenantId(c);
  if (!tenantId) {
    return c.json({ error: 'Access denied', message: 'This endpoint is restricted to VantaX (Pty) Ltd demo environment' }, 403);
  }

  try {
    const now = new Date().toISOString();
    console.log('[VantaX Seeder] Starting seed for tenant:', tenantId);

    // STEP 1: Cleanup ALL old data for this tenant
    const cleanupTables = [
      'sub_catalyst_run_items', 'run_comments', 'sub_catalyst_kpi_values',
      'sub_catalyst_runs', 'catalyst_run_analytics', 'health_score_history',
      'health_scores', 'risk_alerts', 'anomalies', 'process_metrics',
      'process_flows', 'correlation_events', 'catalyst_actions',
      'executive_briefings', 'scenarios', 'run_insights', 'catalyst_insights',
      'catalyst_clusters', 'sub_catalyst_kpis', 'sub_catalyst_kpi_definitions',
      'cross_system_correlations', 'execution_logs',
      'erp_invoices', 'erp_purchase_orders', 'erp_suppliers', 'erp_customers',
      'erp_products', 'erp_bank_transactions', 'erp_journal_entries',
      'erp_gl_accounts', 'erp_employees', 'erp_tax_entries',
      'erp_connections',
    ];

    let cleanupCount = 0;
    for (const table of cleanupTables) {
      try {
        const result = await c.env.DB.prepare(
          `DELETE FROM ${table} WHERE tenant_id = ?`
        ).bind(tenantId).run();
        cleanupCount += (result.meta as any)?.changes || 0;
      } catch {
        // Table may not exist yet
      }
    }
    console.log(`[VantaX Seeder] Cleaned ${cleanupCount} old records`);

    // STEP 2: Create SAP S/4HANA Connector in erp_connections
    const sapAdapterId = 'sap-s4hana';
    try {
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods)
         VALUES (?, 'SAP S/4HANA', 'sap', '2023', 'OData', 'available', ?, ?)`
      ).bind(
        sapAdapterId,
        JSON.stringify(['sync', 'read', 'write', 'reconcile']),
        JSON.stringify(['oauth2', 'basic', 'api_key']),
      ).run();
    } catch { /* adapter may already exist */ }

    const connectionId = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO erp_connections (id, tenant_id, adapter_id, name, status, config, last_sync, sync_frequency, records_synced, connected_at)
       VALUES (?, ?, ?, 'SAP S/4HANA Production', 'connected', ?, ?, 'hourly', 2847, ?)`
    ).bind(
      connectionId, tenantId, sapAdapterId,
      JSON.stringify({
        host: 'sap-prod.vantax.co.za',
        client: '100',
        system_id: 'PRD',
        instance_number: '00',
        auth_type: 'oauth2',
        odata_version: 'v4',
        modules: ['FI', 'CO', 'MM', 'SD', 'PP', 'QM'],
      }),
      now, now,
    ).run();

    // STEP 3: Seed SAP Suppliers (Vendor Master)
    const supplierIds: string[] = [];
    for (let i = 0; i < SA_SUPPLIERS.length; i++) {
      const s = SA_SUPPLIERS[i];
      const id = crypto.randomUUID();
      supplierIds.push(id);
      await c.env.DB.prepare(
        `INSERT INTO erp_suppliers (id, tenant_id, external_id, source_system, name, supplier_group, vat_number, payment_terms, currency, city, province, country, contact_name, contact_email, status, synced_at)
         VALUES (?, ?, ?, 'SAP', ?, ?, ?, ?, 'ZAR', ?, ?, 'ZA', ?, ?, 'active', ?)`
      ).bind(
        id, tenantId, `SAP-V${(10000 + i).toString()}`,
        s.name, s.group, s.vat, s.terms,
        s.city, s.province,
        'Accounts Dept', `accounts@${s.name.toLowerCase().replace(/[^a-z]/g, '')}.co.za`,
        now,
      ).run();
    }

    // STEP 4: Seed SAP Customers (Customer Master)
    const customerIds: string[] = [];
    for (let i = 0; i < SA_CUSTOMERS.length; i++) {
      const cu = SA_CUSTOMERS[i];
      const id = crypto.randomUUID();
      customerIds.push(id);
      const creditLimit = (500000 + Math.floor(i * 150000 + 50000));
      const outstanding = Math.floor(creditLimit * (0.15 + (i % 5) * 0.1));
      await c.env.DB.prepare(
        `INSERT INTO erp_customers (id, tenant_id, external_id, source_system, name, registration_number, customer_group, credit_limit, credit_balance, payment_terms, currency, city, province, country, contact_name, contact_email, status, synced_at)
         VALUES (?, ?, ?, 'SAP', ?, ?, ?, ?, ?, 'Net 30', 'ZAR', ?, ?, 'ZA', ?, ?, 'active', ?)`
      ).bind(
        id, tenantId, `SAP-C${(20000 + i).toString()}`,
        cu.name, cu.reg, cu.group, creditLimit, outstanding,
        cu.city, cu.province,
        'Procurement', `procurement@${cu.name.toLowerCase().replace(/[^a-z]/g, '')}.co.za`,
        now,
      ).run();
    }

    // STEP 5: Seed SAP Products (Material Master)
    for (let i = 0; i < SA_PRODUCTS.length; i++) {
      const p = SA_PRODUCTS[i];
      await c.env.DB.prepare(
        `INSERT INTO erp_products (id, tenant_id, external_id, source_system, sku, name, category, product_group, uom, cost_price, selling_price, vat_rate, stock_on_hand, reorder_level, reorder_quantity, warehouse, is_active, synced_at)
         VALUES (?, ?, ?, 'SAP', ?, ?, ?, ?, ?, ?, ?, 15, ?, ?, ?, 'JHB-MAIN', 1, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, `SAP-M${(30000 + i).toString()}`,
        p.sku, p.name, p.cat, p.cat, p.uom, p.cost, p.sell, p.stock, p.reorder, Math.floor(p.reorder * 1.5),
        now,
      ).run();
    }

    // STEP 6: Seed SAP Invoices (80 invoices: mix of paid, posted, pending, overdue)
    const invoiceRefs: string[] = [];
    const invoiceAmounts: number[] = [];
    for (let i = 1; i <= 80; i++) {
      const invNum = `SAP-INV-${(100000 + i).toString()}`;
      invoiceRefs.push(invNum);
      const suppIdx = i % SA_SUPPLIERS.length;
      const daysAgo = 3 + Math.floor((i * 37) % 90);
      const invDate = new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];
      const dueDate = new Date(Date.now() - (daysAgo - 30) * 86400000).toISOString().split('T')[0];

      const subtotal = Math.round((5000 + (i * 1423.17) % 115000) * 100) / 100;
      const vat = Math.round(subtotal * 0.15 * 100) / 100;
      const total = Math.round((subtotal + vat) * 100) / 100;
      invoiceAmounts.push(total);

      const statusMap = ['posted', 'posted', 'posted', 'paid', 'paid', 'paid', 'pending', 'overdue', 'posted'];
      const status = statusMap[i % statusMap.length];
      const amountPaid = status === 'paid' ? total : status === 'pending' ? 0 : (status === 'overdue' ? Math.round(total * 0.3 * 100) / 100 : 0);

      await c.env.DB.prepare(
        `INSERT INTO erp_invoices (id, tenant_id, external_id, source_system, invoice_number, customer_id, customer_name, invoice_date, due_date, subtotal, vat_amount, total, amount_paid, amount_due, status, payment_status, reference, notes, synced_at)
         VALUES (?, ?, ?, 'SAP', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, `SAP-FI-${(100000 + i).toString()}`,
        invNum, supplierIds[suppIdx], SA_SUPPLIERS[suppIdx].name,
        invDate, dueDate, subtotal, vat, total,
        amountPaid, Math.round((total - amountPaid) * 100) / 100,
        status, status === 'paid' ? 'paid' : 'unpaid',
        `PO-${(50000 + i).toString()}`,
        `SAP Document ${(100000 + i).toString()} - ${SA_SUPPLIERS[suppIdx].name}`,
        now,
      ).run();
    }

    // STEP 7: Seed SAP Purchase Orders (80 POs)
    // POs 1-65: exact amount match with invoices (clean reconciliation)
    // POs 66-72: price variance 3-7% (discrepancy detection)
    // POs 73-80: no matching invoice (unmatched PO detection)
    for (let i = 1; i <= 80; i++) {
      const poNum = `PO-${(50000 + i).toString()}`;
      const suppIdx = i % SA_SUPPLIERS.length;
      const daysAgo = 10 + Math.floor((i * 43) % 120);
      const orderDate = new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];
      const deliveryDate = new Date(Date.now() - (daysAgo - 14) * 86400000).toISOString().split('T')[0];

      let total: number;
      if (i <= 65) {
        // Exact match with invoice amount
        total = invoiceAmounts[i - 1];
      } else if (i <= 72) {
        // Price variance 3-7%
        const variancePct = 0.03 + ((i * 13) % 5) * 0.01;
        const direction = i % 2 === 0 ? 1 : -1;
        total = Math.round(invoiceAmounts[i - 1] * (1 + variancePct * direction) * 100) / 100;
      } else {
        // Unmatched POs (no corresponding invoice)
        total = Math.round((8000 + (i * 2731.41) % 45000) * 100) / 100;
      }

      const subtotal = Math.round(total / 1.15 * 100) / 100;
      const vatAmt = Math.round((total - subtotal) * 100) / 100;
      const deliveryStatuses = ['received', 'received', 'received', 'received', 'partial', 'pending'];
      const poStatuses = ['approved', 'approved', 'approved', 'approved', 'approved', 'pending'];

      await c.env.DB.prepare(
        `INSERT INTO erp_purchase_orders (id, tenant_id, external_id, source_system, po_number, supplier_id, supplier_name, order_date, delivery_date, subtotal, vat_amount, total, status, delivery_status, reference, synced_at)
         VALUES (?, ?, ?, 'SAP', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, `SAP-MM-${(50000 + i).toString()}`,
        poNum, supplierIds[suppIdx], SA_SUPPLIERS[suppIdx].name,
        orderDate, deliveryDate, subtotal, vatAmt, total,
        poStatuses[i % poStatuses.length],
        deliveryStatuses[i % deliveryStatuses.length],
        i <= 72 ? (invoiceRefs[i - 1] || null) : null,
        now,
      ).run();
    }

    // STEP 8: Seed Bank Transactions (80 transactions)
    // 1-55: match paid invoices (reconciled)
    // 56-65: bank charges/fees (unreconciled)
    // 66-80: unreconciled EFT payments
    for (let i = 1; i <= 80; i++) {
      const daysAgo = 1 + Math.floor((i * 29) % 60);
      const txDate = new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];

      let debit = 0;
      let credit = 0;
      let ref = '';
      let desc = '';
      let reconciled = 0;

      if (i <= 55) {
        credit = invoiceAmounts[i - 1];
        ref = invoiceRefs[i - 1];
        desc = `Payment: ${ref} - ${SA_SUPPLIERS[i % SA_SUPPLIERS.length].name}`;
        reconciled = 1;
      } else if (i <= 65) {
        const feeTypes = ['Monthly service fee', 'SWIFT charge', 'Card processing fee', 'Cash handling fee', 'Statement fee', 'EFT batch fee', 'Cheque processing', 'Interest charge', 'Insurance debit', 'Merchant fee'];
        debit = Math.round((150 + (i * 317.23) % 3500) * 100) / 100;
        ref = `BNK-FEE-${(90000 + i).toString()}`;
        desc = feeTypes[(i - 56) % feeTypes.length];
        reconciled = 0;
      } else {
        credit = Math.round((5000 + (i * 2187.49) % 40000) * 100) / 100;
        ref = `EFT-${(80000 + i).toString()}`;
        desc = `EFT Payment - ${SA_SUPPLIERS[(i + 3) % SA_SUPPLIERS.length].name}`;
        reconciled = 0;
      }

      const runningBalance = Math.round((2500000 - i * 8750 + (i % 7) * 15000) * 100) / 100;

      await c.env.DB.prepare(
        `INSERT INTO erp_bank_transactions (id, tenant_id, external_id, source_system, bank_account, transaction_date, description, reference, debit, credit, balance, reconciled, synced_at)
         VALUES (?, ?, ?, 'SAP', 'FNB-62-000-4521-01', ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, `SAP-BK-${(80000 + i).toString()}`,
        txDate, desc, ref, debit, credit, runningBalance, reconciled, now,
      ).run();
    }

    // STEP 9: Seed GL Accounts and Journal Entries (SAP FI)
    for (const gl of GL_ACCOUNTS) {
      await c.env.DB.prepare(
        `INSERT INTO erp_gl_accounts (id, tenant_id, external_id, source_system, account_code, account_name, account_type, account_class, currency, balance, is_active, synced_at)
         VALUES (?, ?, ?, 'SAP', ?, ?, ?, ?, 'ZAR', ?, 1, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, `SAP-GL-${gl.code}`,
        gl.code, gl.name, gl.type, gl.cls, gl.balance, now,
      ).run();
    }

    const jeDescriptions = [
      'Supplier payment - Sasol Chemical Industries',
      'Customer receipt - Pick n Pay Stores',
      'Payroll processing - March 2026',
      'Inventory adjustment - warehouse count',
      'Depreciation - Property Plant and Equipment',
      'VAT return - period 03/2026',
      'Bank charges - FNB Corporate',
      'Accrual reversal - Q1 2026',
      'Intercompany transfer - Durban branch',
      'Provision for doubtful debts',
    ];
    for (let i = 1; i <= 40; i++) {
      const daysAgo = Math.floor((i * 23) % 30);
      const jDate = new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];
      const amount = Math.round((2000 + (i * 1847.63) % 80000) * 100) / 100;
      await c.env.DB.prepare(
        `INSERT INTO erp_journal_entries (id, tenant_id, external_id, source_system, journal_number, journal_date, description, total_debit, total_credit, status, posted_by, synced_at)
         VALUES (?, ?, ?, 'SAP', ?, ?, ?, ?, ?, 'posted', 'SAP-AUTO', ?)`
      ).bind(
        crypto.randomUUID(), tenantId, `SAP-JE-${(60000 + i).toString()}`,
        `JE-${(60000 + i).toString()}`, jDate,
        jeDescriptions[i % jeDescriptions.length],
        amount, amount, now,
      ).run();
    }

    // STEP 10: Create Catalyst Clusters with CONFIGURED sub-catalysts
    // Each sub-catalyst has data_sources and field_mappings for real execution

    // -- FINANCE CLUSTER --
    const financeClusterId = crypto.randomUUID();
    const financeSubCatalysts = [
      {
        name: 'GR/IR Reconciliation',
        enabled: true,
        description: 'Goods Receipt vs Invoice Receipt matching - SAP MM/FI cross-module 3-way match',
        data_sources: [
          { type: 'erp', config: { erp_type: 'sap', module: 'purchase_order', label: 'SAP MM - Purchase Orders' } },
          { type: 'erp', config: { erp_type: 'sap', module: 'invoice', label: 'SAP FI - Vendor Invoices' } },
        ],
        field_mappings: [
          { source_field: 'reference', target_field: 'invoice_number', source_index: 0, target_index: 1, match_type: 'exact', label: 'PO Reference to Invoice Number' },
          { source_field: 'total', target_field: 'amount', source_index: 0, target_index: 1, match_type: 'numeric_tolerance', tolerance: 0.01, label: 'PO Total to Invoice Amount' },
        ],
        execution_config: { mode: 'reconciliation', parameters: { exception_discrepancy_threshold: 10, exception_match_rate_threshold: 50 } },
      },
      {
        name: 'AP Invoice Validation',
        enabled: true,
        description: 'Accounts Payable invoice completeness, duplicate detection, and accuracy validation',
        data_sources: [
          { type: 'erp', config: { erp_type: 'sap', module: 'accounts_payable', label: 'SAP FI - AP Invoices' } },
        ],
        execution_config: { mode: 'validation' },
      },
      {
        name: 'Bank Reconciliation',
        enabled: true,
        description: 'Bank statement vs SAP payment matching - FNB Corporate account 62-000-4521-01',
        data_sources: [
          { type: 'erp', config: { erp_type: 'sap', module: 'bank_statement', label: 'FNB Bank Statement' } },
          { type: 'erp', config: { erp_type: 'sap', module: 'invoice', label: 'SAP FI - Payment Records' } },
        ],
        field_mappings: [
          { source_field: 'reference', target_field: 'invoice_number', source_index: 0, target_index: 1, match_type: 'contains', label: 'Bank Reference to Invoice Number' },
          { source_field: 'credit', target_field: 'amount', source_index: 0, target_index: 1, match_type: 'numeric_tolerance', tolerance: 0.50, label: 'Bank Credit to Invoice Amount' },
        ],
        execution_config: { mode: 'reconciliation', parameters: { exception_discrepancy_threshold: 5 } },
      },
    ];

    await c.env.DB.prepare(`
      INSERT INTO catalyst_clusters (id, tenant_id, name, domain, description, status, autonomy_tier, agent_count, sub_catalysts)
      VALUES (?, ?, 'Finance', 'finance', 'Financial reconciliation and controls - SAP FI/CO modules. GR/IR 3-way match, AP invoice validation, bank reconciliation against FNB Corporate.', 'active', 'supervised', 3, ?)
    `).bind(financeClusterId, tenantId, JSON.stringify(financeSubCatalysts)).run();

    // -- SUPPLY CHAIN CLUSTER --
    const supplyChainClusterId = crypto.randomUUID();
    const supplyChainSubCatalysts = [
      {
        name: 'Inventory Reconciliation',
        enabled: true,
        description: 'System inventory vs physical count - SAP MM warehouse verification (JHB-MAIN)',
        data_sources: [
          { type: 'erp', config: { erp_type: 'sap', module: 'inventory', label: 'SAP MM - Material Master' } },
          { type: 'erp', config: { erp_type: 'sap', module: 'inventory', label: 'SAP MM - Physical Count' } },
        ],
        field_mappings: [
          { source_field: 'sku', target_field: 'sku', source_index: 0, target_index: 1, match_type: 'exact', label: 'Material Number to Material Number' },
          { source_field: 'stock_on_hand', target_field: 'stock_on_hand', source_index: 0, target_index: 1, match_type: 'numeric_tolerance', tolerance: 1, label: 'System Stock to Physical Count' },
        ],
        execution_config: { mode: 'reconciliation' },
      },
      {
        name: 'PO-to-GR Matching',
        enabled: true,
        description: 'Purchase Order to Goods Receipt matching - delivery verification and quantity check',
        data_sources: [
          { type: 'erp', config: { erp_type: 'sap', module: 'purchase_order', label: 'SAP MM - Purchase Orders' } },
          { type: 'erp', config: { erp_type: 'sap', module: 'goods_receipt', label: 'SAP MM - Goods Receipts' } },
        ],
        field_mappings: [
          { source_field: 'po_number', target_field: 'po_number', source_index: 0, target_index: 1, match_type: 'exact', label: 'PO Number to GR PO Reference' },
          { source_field: 'total', target_field: 'total', source_index: 0, target_index: 1, match_type: 'numeric_tolerance', tolerance: 0.01, label: 'PO Amount to GR Amount' },
        ],
        execution_config: { mode: 'reconciliation' },
      },
      {
        name: 'Supplier Validation',
        enabled: true,
        description: 'Vendor master data quality - tax numbers, payment terms, B-BBEE status, bank details',
        data_sources: [
          { type: 'erp', config: { erp_type: 'sap', module: 'vendor', label: 'SAP MM - Vendor Master' } },
        ],
        execution_config: { mode: 'validation' },
      },
    ];

    await c.env.DB.prepare(`
      INSERT INTO catalyst_clusters (id, tenant_id, name, domain, description, status, autonomy_tier, agent_count, sub_catalysts)
      VALUES (?, ?, 'Supply Chain', 'operations', 'Supply chain management and procurement - SAP MM/SD. Inventory verification, PO-to-GR matching, vendor master validation.', 'active', 'supervised', 3, ?)
    `).bind(supplyChainClusterId, tenantId, JSON.stringify(supplyChainSubCatalysts)).run();

    // -- REVENUE CLUSTER --
    const revenueClusterId = crypto.randomUUID();
    const revenueSubCatalysts = [
      {
        name: 'Revenue Recognition',
        enabled: true,
        description: 'Revenue recognition compliance - IFRS 15 timing and completeness validation',
        data_sources: [
          { type: 'erp', config: { erp_type: 'sap', module: 'accounts_receivable', label: 'SAP SD - Customer Invoices' } },
        ],
        execution_config: { mode: 'validation' },
      },
      {
        name: 'Customer Receivables',
        enabled: true,
        description: 'Customer accounts receivable aging, credit limit monitoring, and collection tracking',
        data_sources: [
          { type: 'erp', config: { erp_type: 'sap', module: 'customer', label: 'SAP SD - Customer Master' } },
        ],
        execution_config: { mode: 'validation' },
      },
      {
        name: 'Sales Order Matching',
        enabled: true,
        description: 'Sales order to invoice matching - order fulfilment and billing verification',
        data_sources: [
          { type: 'erp', config: { erp_type: 'sap', module: 'invoice', label: 'SAP SD - Sales Invoices' } },
          { type: 'erp', config: { erp_type: 'sap', module: 'invoice', label: 'SAP FI - AR Postings' } },
        ],
        field_mappings: [
          { source_field: 'invoice_number', target_field: 'invoice_number', source_index: 0, target_index: 1, match_type: 'exact', label: 'SO Invoice to FI Invoice' },
          { source_field: 'amount', target_field: 'amount', source_index: 0, target_index: 1, match_type: 'numeric_tolerance', tolerance: 0.01, label: 'SO Amount to FI Amount' },
        ],
        execution_config: { mode: 'reconciliation' },
      },
    ];

    await c.env.DB.prepare(`
      INSERT INTO catalyst_clusters (id, tenant_id, name, domain, description, status, autonomy_tier, agent_count, sub_catalysts)
      VALUES (?, ?, 'Revenue', 'revenue', 'Revenue cycle management - SAP SD/FI. IFRS 15 compliance, AR aging, sales order-to-invoice matching.', 'active', 'supervised', 3, ?)
    `).bind(revenueClusterId, tenantId, JSON.stringify(revenueSubCatalysts)).run();

    // STEP 11: Create Sub-Catalyst KPIs (aggregate tracking)
    const allSubCatalysts = [
      ...financeSubCatalysts.map(s => ({ ...s, clusterId: financeClusterId })),
      ...supplyChainSubCatalysts.map(s => ({ ...s, clusterId: supplyChainClusterId })),
      ...revenueSubCatalysts.map(s => ({ ...s, clusterId: revenueClusterId })),
    ];

    for (const sub of allSubCatalysts) {
      await c.env.DB.prepare(`
        INSERT INTO sub_catalyst_kpis (id, tenant_id, cluster_id, sub_catalyst_name, total_runs, successful_runs, success_rate, avg_confidence, status, threshold_success_green, threshold_success_amber, threshold_success_red)
        VALUES (?, ?, ?, ?, 0, 0, 0, 0, 'green', 90, 70, 50)
      `).bind(crypto.randomUUID(), tenantId, sub.clusterId, sub.name).run();
    }

    // STEP 12: Baseline health score (overwritten by first catalyst run)
    await c.env.DB.prepare(`
      INSERT INTO health_scores (id, tenant_id, overall_score, dimensions, calculated_at)
      VALUES (?, ?, 0, '{}', ?)
    `).bind(crypto.randomUUID(), tenantId, now).run();

    // Summary
    const totalErpRecords = SA_SUPPLIERS.length + SA_CUSTOMERS.length + SA_PRODUCTS.length + 80 + 80 + 80 + GL_ACCOUNTS.length + 40;

    return c.json({
      success: true,
      message: 'VantaX tenant seeded with realistic SAP S/4HANA demo data',
      tenant: { id: tenantId, slug: 'vantax' },
      cleanup: { tables: cleanupTables.length, recordsRemoved: cleanupCount },
      seeded: {
        sapConnector: { id: connectionId, name: 'SAP S/4HANA Production', status: 'connected', modules: ['FI', 'CO', 'MM', 'SD', 'PP', 'QM'] },
        erpData: {
          total: totalErpRecords,
          suppliers: SA_SUPPLIERS.length,
          customers: SA_CUSTOMERS.length,
          products: SA_PRODUCTS.length,
          invoices: 80,
          purchaseOrders: 80,
          bankTransactions: 80,
          glAccounts: GL_ACCOUNTS.length,
          journalEntries: 40,
        },
        dataQuality: {
          cleanMatches: '65 of 80 POs match invoices exactly (81.25%)',
          priceVariances: '7 POs have 3-7% price variance vs invoice (8.75%)',
          unmatchedPOs: '8 POs have no matching invoice (10%)',
          reconciledBankTx: '55 of 80 bank transactions reconciled (68.75%)',
          bankCharges: '10 bank charges/fees unreconciled',
          unmatchedPayments: '15 EFT payments unmatched',
        },
        catalysts: {
          clusters: 3,
          clusterNames: ['Finance', 'Supply Chain', 'Revenue'],
          subCatalysts: allSubCatalysts.length,
          withDataSources: allSubCatalysts.filter(s => s.data_sources && s.data_sources.length > 0).length,
          reconciliationReady: allSubCatalysts.filter(s => s.data_sources && s.data_sources.length >= 2).length,
        },
        healthScore: { overall: 0, note: 'Baseline - will be calculated on first catalyst run' },
      },
      nextSteps: [
        'Go to Catalysts page and execute any sub-catalyst',
        'GR/IR Reconciliation: will find ~81% match rate, ~9% price variances, ~10% unmatched',
        'Bank Reconciliation: will find ~69% reconciled, ~31% unreconciled',
        'AP Invoice Validation: will validate 80 invoices for completeness',
        'Pulse metrics, Apex health scores, risks, and briefings will update from actual results',
      ],
    });
  } catch (err) {
    console.error('VantaX seeding failed:', err);
    return c.json({ error: 'Seeding failed', details: (err as Error).message, stack: (err as Error).stack }, 500);
  }
});

/**
 * GET /api/v1/vantax-status
 * Check current VantaX data status
 */
seed.get('/vantax-status', async (c) => {
  const tenantId = await getVantaXTenantId(c);
  if (!tenantId) {
    return c.json({ exists: false, error: 'Access denied', message: 'This endpoint is restricted to VantaX (Pty) Ltd demo environment' }, 403);
  }

  try {
    const counts: Record<string, number> = {};
    const tables = [
      ['catalystRuns', 'sub_catalyst_runs'],
      ['processMetrics', 'process_metrics'],
      ['riskAlerts', 'risk_alerts'],
      ['healthScores', 'health_scores'],
      ['catalystClusters', 'catalyst_clusters'],
      ['invoices', 'erp_invoices'],
      ['purchaseOrders', 'erp_purchase_orders'],
      ['bankTransactions', 'erp_bank_transactions'],
      ['suppliers', 'erp_suppliers'],
      ['customers', 'erp_customers'],
      ['products', 'erp_products'],
      ['connections', 'erp_connections'],
      ['glAccounts', 'erp_gl_accounts'],
      ['journalEntries', 'erp_journal_entries'],
    ];

    for (const [key, table] of tables) {
      try {
        const row = await c.env.DB.prepare(`SELECT COUNT(*) as count FROM ${table} WHERE tenant_id = ?`).bind(tenantId).first();
        counts[key] = (row as any)?.count || 0;
      } catch {
        counts[key] = 0;
      }
    }

    return c.json({
      exists: true,
      tenantId,
      data: counts,
    });
  } catch (err) {
    console.error('VantaX status check failed:', err);
    return c.json({ exists: false, error: (err as Error).message });
  }
});

export default seed;
