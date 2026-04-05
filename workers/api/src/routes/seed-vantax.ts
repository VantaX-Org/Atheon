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

// Whitelist of allowed table names to prevent SQL injection via interpolation
const ALLOWED_TABLES = new Set([
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
  // New engine tables
  'radar_signals', 'radar_signal_impacts', 'radar_strategic_context',
  'diagnostic_analyses', 'diagnostic_causal_chains', 'diagnostic_fix_tracking',
  'catalyst_patterns', 'catalyst_effectiveness', 'catalyst_dependencies',
  // SAP native tables
  'sap_bkpf', 'sap_bseg', 'sap_bsid', 'sap_bsik', 'sap_febep',
  'sap_ekko', 'sap_ekpo', 'sap_ekbe', 'sap_mard', 'sap_iseg',
  'sap_vbak', 'sap_vbap', 'sap_vbrk', 'sap_vbrp',
  'sap_lfa1', 'sap_lfb1', 'sap_kna1', 'sap_knb1',
]);

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
    const cleanupTables = [...ALLOWED_TABLES];

    let cleanupCount = 0;
    for (const table of cleanupTables) {
      if (!ALLOWED_TABLES.has(table)) continue;
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
    // Deliberate data quality issues for validation:
    // - Suppliers 0-7: complete records (bank details, contact, VAT)
    // - Suppliers 8-10: missing bank details
    // - Suppliers 11-12: missing VAT number
    // - Suppliers 13-14: missing contact info
    const supplierIds: string[] = [];
    for (let i = 0; i < SA_SUPPLIERS.length; i++) {
      const s = SA_SUPPLIERS[i];
      const id = crypto.randomUUID();
      supplierIds.push(id);
      const hasBankDetails = i < 8;
      const hasVat = i < 11 || i > 12;
      const hasContact = i < 13;
      await c.env.DB.prepare(
        `INSERT INTO erp_suppliers (id, tenant_id, external_id, source_system, name, supplier_group, vat_number, payment_terms, currency, city, province, country, contact_name, contact_email, bank_name, bank_account, status, synced_at)
         VALUES (?, ?, ?, 'SAP', ?, ?, ?, ?, 'ZAR', ?, ?, 'ZA', ?, ?, ?, ?, 'active', ?)`
      ).bind(
        id, tenantId, `SAP-V${(10000 + i).toString()}`,
        s.name, s.group,
        hasVat ? s.vat : null,
        s.terms,
        s.city, s.province,
        hasContact ? 'Accounts Dept' : null,
        hasContact ? `accounts@${s.name.toLowerCase().replace(/[^a-z]/g, '')}.co.za` : null,
        hasBankDetails ? 'First National Bank' : null,
        hasBankDetails ? `62-${(10000 + i * 37).toString()}-${(4521 + i * 13).toString()}` : null,
        now,
      ).run();
    }

    // STEP 4: Seed SAP Customers (Customer Master)
    // Deliberate data quality issues for validation:
    // - Customers 0-11: normal (credit balance within limits)
    // - Customers 12-14: credit balance EXCEEDS credit limit (over-exposed)
    // - Customers 15-17: no credit limit set (0)
    // - Customers 18-19: missing registration number
    const customerIds: string[] = [];
    for (let i = 0; i < SA_CUSTOMERS.length; i++) {
      const cu = SA_CUSTOMERS[i];
      const id = crypto.randomUUID();
      customerIds.push(id);
      let creditLimit = (500000 + Math.floor(i * 150000 + 50000));
      let outstanding = Math.floor(creditLimit * (0.15 + (i % 5) * 0.1));
      const hasRegNum = i < 18;
      const hasContact = i < 17;

      if (i >= 12 && i <= 14) {
        // Over-exposed: credit balance exceeds limit
        outstanding = Math.floor(creditLimit * (1.15 + (i - 12) * 0.12));
      } else if (i >= 15 && i <= 17) {
        // No credit limit set
        creditLimit = 0;
        outstanding = Math.floor(250000 * (0.3 + i * 0.05));
      }

      await c.env.DB.prepare(
        `INSERT INTO erp_customers (id, tenant_id, external_id, source_system, name, registration_number, customer_group, credit_limit, credit_balance, payment_terms, currency, city, province, country, contact_name, contact_email, status, synced_at)
         VALUES (?, ?, ?, 'SAP', ?, ?, ?, ?, ?, 'Net 30', 'ZAR', ?, ?, 'ZA', ?, ?, 'active', ?)`
      ).bind(
        id, tenantId, `SAP-C${(20000 + i).toString()}`,
        cu.name,
        hasRegNum ? cu.reg : null,
        cu.group, creditLimit, outstanding,
        cu.city, cu.province,
        hasContact ? 'Procurement' : null,
        hasContact ? `procurement@${cu.name.toLowerCase().replace(/[^a-z]/g, '')}.co.za` : null,
        now,
      ).run();
    }

    // STEP 5: Seed SAP Products (Material Master) — system inventory
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

    // STEP 5b: Seed Physical Count records (PHYSICAL_COUNT source_system)
    // These simulate warehouse physical count with deliberate stock variances:
    // - Products 0-9: exact match (good warehouse discipline)
    // - Products 10-13: -8% to -22% shortage (shrinkage / theft / damage)
    // - Products 14-17: +5% to +15% surplus (receiving errors / miscounts)
    for (let i = 0; i < SA_PRODUCTS.length; i++) {
      const p = SA_PRODUCTS[i];
      let physicalStock: number;
      if (i < 10) {
        // Exact match with SAP system
        physicalStock = p.stock;
      } else if (i < 14) {
        // Shortage: shrinkage detected
        const shrinkagePct = 0.08 + (i - 10) * 0.047;  // 8%, 12.7%, 17.4%, 22.1%
        physicalStock = Math.floor(p.stock * (1 - shrinkagePct));
      } else {
        // Surplus: receiving errors
        const surplusPct = 0.05 + (i - 14) * 0.033;  // 5%, 8.3%, 11.6%, 14.9%
        physicalStock = Math.floor(p.stock * (1 + surplusPct));
      }
      await c.env.DB.prepare(
        `INSERT INTO erp_products (id, tenant_id, external_id, source_system, sku, name, category, product_group, uom, cost_price, selling_price, vat_rate, stock_on_hand, reorder_level, reorder_quantity, warehouse, is_active, synced_at)
         VALUES (?, ?, ?, 'PHYSICAL_COUNT', ?, ?, ?, ?, ?, ?, ?, 15, ?, ?, ?, 'JHB-MAIN', 1, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, `PHY-M${(30000 + i).toString()}`,
        p.sku, p.name, p.cat, p.cat, p.uom, p.cost, p.sell, physicalStock, p.reorder, Math.floor(p.reorder * 1.5),
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

    // STEP 6b: Seed AR Posting records (SAP-AR source_system)
    // These simulate the FI-AR module postings with deliberate differences vs SD invoices:
    // - Invoices 1-55: exact match (clean posting)
    // - Invoices 56-65: amount variance 2-8% (rounding, forex, partial payments posted differently)
    // - Invoices 66-72: different status (posted vs paid mismatch)
    // - Invoices 73-80: no AR posting (missing from AR module — unmatched)
    for (let i = 1; i <= 72; i++) {
      const invNum = `SAP-INV-${(100000 + i).toString()}`;
      const suppIdx = i % SA_SUPPLIERS.length;
      const daysAgo = 3 + Math.floor((i * 37) % 90);
      const invDate = new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];
      const dueDate = new Date(Date.now() - (daysAgo - 30) * 86400000).toISOString().split('T')[0];

      const subtotal = Math.round((5000 + (i * 1423.17) % 115000) * 100) / 100;
      const vat = Math.round(subtotal * 0.15 * 100) / 100;
      let arTotal = Math.round((subtotal + vat) * 100) / 100;

      const statusMap = ['posted', 'posted', 'posted', 'paid', 'paid', 'paid', 'pending', 'overdue', 'posted'];
      let arStatus = statusMap[i % statusMap.length];

      if (i >= 56 && i <= 65) {
        // Amount variance: 2-8% difference in AR posting
        const variancePct = 0.02 + ((i - 56) * 0.007);
        const direction = i % 2 === 0 ? 1 : -1;
        arTotal = Math.round(arTotal * (1 + variancePct * direction) * 100) / 100;
      } else if (i >= 66 && i <= 72) {
        // Status mismatch: AR shows different status
        arStatus = arStatus === 'paid' ? 'posted' : 'paid';
      }

      const amountPaid = arStatus === 'paid' ? arTotal : arStatus === 'pending' ? 0 : (arStatus === 'overdue' ? Math.round(arTotal * 0.3 * 100) / 100 : 0);

      await c.env.DB.prepare(
        `INSERT INTO erp_invoices (id, tenant_id, external_id, source_system, invoice_number, customer_id, customer_name, invoice_date, due_date, subtotal, vat_amount, total, amount_paid, amount_due, status, payment_status, reference, notes, synced_at)
         VALUES (?, ?, ?, 'SAP-AR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, `SAP-AR-${(100000 + i).toString()}`,
        invNum, supplierIds[suppIdx], SA_SUPPLIERS[suppIdx].name,
        invDate, dueDate,
        Math.round(arTotal / 1.15 * 100) / 100,
        Math.round((arTotal - arTotal / 1.15) * 100) / 100,
        arTotal,
        amountPaid, Math.round((arTotal - amountPaid) * 100) / 100,
        arStatus, arStatus === 'paid' ? 'paid' : 'unpaid',
        `PO-${(50000 + i).toString()}`,
        `SAP-AR Posting ${(100000 + i).toString()} - ${SA_SUPPLIERS[suppIdx].name}`,
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

    // ── SAP NATIVE TABLE SEEDING ──
    // Populate actual SAP table structures so the LLM sees real SAP field names
    // and sub-catalysts process authentic SAP data.

    // SAP-SEED-1: LFA1 — Vendor Master General Data
    // Quality gaps: vendors 11-12 missing STCD1 (tax number), vendors 13-14 missing TELF1
    for (let i = 0; i < SA_SUPPLIERS.length; i++) {
      const s = SA_SUPPLIERS[i];
      const lifnr = (10000 + i).toString().padStart(10, '0');
      await c.env.DB.prepare(
        `INSERT INTO sap_lfa1 (id, tenant_id, LIFNR, LAND1, NAME1, NAME2, ORT01, PSTLZ, REGIO, STCD1, STCD2, TELF1, KTOKK, LOEVM, SPERR, SPERM)
         VALUES (?, ?, ?, 'ZA', ?, ?, ?, ?, ?, ?, ?, ?, 'KRED', ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, lifnr,
        s.name, s.group,
        s.city, s.city === 'Johannesburg' ? '2001' : s.city === 'Cape Town' ? '8001' : '0001',
        s.province,
        (i < 11 || i > 12) ? s.vat : null,  // missing tax number for 11-12
        (i < 11 || i > 12) ? `IT${s.vat}` : null,
        i < 13 ? `+27${(11 + i).toString()}${(1000000 + i * 12345).toString().slice(0, 7)}` : null,  // missing phone for 13-14
        null, null,  // LOEVM, SPERR
        i === 14 ? 'X' : null,  // payment block on last vendor
      ).run();
    }

    // SAP-SEED-2: LFB1 — Vendor Master Company Code Data
    // Quality gaps: vendors 8-10 missing AKONT (recon account), vendor 14 missing ZTERM
    for (let i = 0; i < SA_SUPPLIERS.length; i++) {
      const lifnr = (10000 + i).toString().padStart(10, '0');
      const zterms = ['ZB30', 'ZB45', 'ZB30', 'ZB60', 'ZB30', 'ZB45', 'ZB30', 'ZB60'];
      await c.env.DB.prepare(
        `INSERT INTO sap_lfb1 (id, tenant_id, LIFNR, BUKRS, AKONT, ZTERM, ZWELS, REPRF, HBKID)
         VALUES (?, ?, ?, '1000', ?, ?, 'CT', ?, 'FNB1')`
      ).bind(
        crypto.randomUUID(), tenantId, lifnr,
        (i >= 8 && i <= 10) ? null : '2000',  // missing recon account
        i === 14 ? null : zterms[i % zterms.length],  // missing payment terms
        i < 8 ? 'X' : null,  // double-invoice check
      ).run();
    }

    // SAP-SEED-3: KNA1 — Customer Master General Data
    // Quality gaps: customers 18-19 missing STCD1, customer 15-17 missing ORT01
    for (let i = 0; i < SA_CUSTOMERS.length; i++) {
      const cu = SA_CUSTOMERS[i];
      const kunnr = (20000 + i).toString().padStart(10, '0');
      await c.env.DB.prepare(
        `INSERT INTO sap_kna1 (id, tenant_id, KUNNR, LAND1, NAME1, NAME2, ORT01, PSTLZ, REGIO, STCD1, TELF1, KTOKD, LOEVM, SPERR)
         VALUES (?, ?, ?, 'ZA', ?, ?, ?, ?, ?, ?, ?, 'DEBI', ?, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, kunnr,
        cu.name, cu.group,
        (i >= 15 && i <= 17) ? null : cu.city,  // missing city
        cu.city === 'Cape Town' ? '8001' : cu.city === 'Sandton' ? '2196' : '0001',
        cu.province,
        i < 18 ? cu.reg : null,  // missing tax/reg number
        i < 17 ? `+27${(21 + i).toString()}${(2000000 + i * 54321).toString().slice(0, 7)}` : null,
        null, null,
      ).run();
    }

    // SAP-SEED-4: KNB1 — Customer Master Company Code Data
    // Quality gaps: customers 12-14 KLIMK exceeded, customers 15-17 KLIMK = 0
    for (let i = 0; i < SA_CUSTOMERS.length; i++) {
      const kunnr = (20000 + i).toString().padStart(10, '0');
      let klimk = 500000 + i * 150000 + 50000;
      if (i >= 15 && i <= 17) klimk = 0;

      await c.env.DB.prepare(
        `INSERT INTO sap_knb1 (id, tenant_id, KUNNR, BUKRS, AKONT, ZTERM, KLIMK, CTLPC)
         VALUES (?, ?, ?, '1000', '1100', 'ZB30', ?, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, kunnr,
        klimk,
        klimk > 0 ? 'A' : null,  // no credit control for zero-limit customers
      ).run();
    }

    // SAP-SEED-5: BKPF — Accounting Document Headers (80 vendor invoices)
    // Quality gaps: docs 73-80 missing XBLNR (external reference)
    const bkpfBelnrs: string[] = [];
    for (let i = 1; i <= 80; i++) {
      const belnr = (5100000000 + i).toString();
      bkpfBelnrs.push(belnr);
      const daysAgo = 3 + Math.floor((i * 37) % 90);
      const budat = new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];
      const bldat = new Date(Date.now() - (daysAgo + 2) * 86400000).toISOString().split('T')[0];
      const monat = new Date(Date.now() - daysAgo * 86400000).toISOString().slice(5, 7);

      await c.env.DB.prepare(
        `INSERT INTO sap_bkpf (id, tenant_id, BUKRS, BELNR, GJAHR, BLART, BUDAT, BLDAT, MONAT, CPUDT, XBLNR, BSTAT, WAERS, USNAM, TCODE, AWTYP, AWKEY)
         VALUES (?, ?, '1000', ?, '2026', ?, ?, ?, ?, ?, ?, ?, 'ZAR', 'SAPUSER', 'FB60', 'BKPF', ?)`
      ).bind(
        crypto.randomUUID(), tenantId, belnr,
        i <= 40 ? 'KR' : 'KG',  // KR=vendor invoice, KG=vendor credit
        budat, bldat, monat, budat,
        i <= 72 ? `PO-${(50000 + i).toString()}` : null,  // missing XBLNR for 73-80
        i <= 65 ? '' : 'V',  // V = parked (not posted)
        belnr,
      ).run();
    }

    // SAP-SEED-6: BSEG — Accounting Document Line Items (2 lines per doc: vendor + expense)
    // Quality gaps: items 56-65 have DMBTR that differs from WRBTR (forex variance)
    for (let i = 1; i <= 80; i++) {
      const belnr = bkpfBelnrs[i - 1];
      const suppIdx = i % SA_SUPPLIERS.length;
      const lifnr = (10000 + suppIdx).toString().padStart(10, '0');
      const subtotal = Math.round((5000 + (i * 1423.17) % 115000) * 100) / 100;
      const vat = Math.round(subtotal * 0.15 * 100) / 100;
      const total = Math.round((subtotal + vat) * 100) / 100;
      let dmbtr = total;
      if (i >= 56 && i <= 65) {
        // Forex variance: DMBTR differs from WRBTR by 2-8%
        const variancePct = 0.02 + ((i - 56) * 0.007);
        dmbtr = Math.round(total * (1 + variancePct * (i % 2 === 0 ? 1 : -1)) * 100) / 100;
      }

      // Line 1: Vendor posting (BSCHL 31 = vendor credit)
      await c.env.DB.prepare(
        `INSERT INTO sap_bseg (id, tenant_id, BUKRS, BELNR, GJAHR, BUZEI, BSCHL, KOART, KONTO, DMBTR, WRBTR, MWSKZ, MWSTS, SGTXT, LIFNR, EBELN, SHKZG, ZFBDT, ZBD1T)
         VALUES (?, ?, '1000', ?, '2026', '001', '31', 'K', ?, ?, ?, 'I2', ?, ?, ?, ?, 'H', ?, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, belnr,
        lifnr, dmbtr, total, vat,
        `Invoice ${SA_SUPPLIERS[suppIdx].name}`,
        lifnr,
        i <= 72 ? `PO-${(50000 + i).toString()}` : null,
        new Date(Date.now() - (3 + Math.floor((i * 37) % 90) - 30) * 86400000).toISOString().split('T')[0],
        30,
      ).run();

      // Line 2: Expense posting (BSCHL 40 = debit)
      await c.env.DB.prepare(
        `INSERT INTO sap_bseg (id, tenant_id, BUKRS, BELNR, GJAHR, BUZEI, BSCHL, KOART, KONTO, DMBTR, WRBTR, MWSKZ, MWSTS, SGTXT, SHKZG)
         VALUES (?, ?, '1000', ?, '2026', '002', '40', 'S', '5000', ?, ?, 'I2', 0, ?, 'S')`
      ).bind(
        crypto.randomUUID(), tenantId, belnr,
        Math.round((dmbtr - vat) * 100) / 100, Math.round((total - vat) * 100) / 100,
        `Cost of Sales - ${SA_SUPPLIERS[suppIdx].name}`,
      ).run();
    }

    // SAP-SEED-7: BSIK — Vendor Open Items
    // Quality gaps: items 66-72 have wrong SHKZG (debit/credit indicator), 73-80 missing EBELN
    for (let i = 1; i <= 80; i++) {
      const belnr = bkpfBelnrs[i - 1];
      const suppIdx = i % SA_SUPPLIERS.length;
      const lifnr = (10000 + suppIdx).toString().padStart(10, '0');
      const subtotal = Math.round((5000 + (i * 1423.17) % 115000) * 100) / 100;
      const vat = Math.round(subtotal * 0.15 * 100) / 100;
      const total = Math.round((subtotal + vat) * 100) / 100;
      const daysAgo = 3 + Math.floor((i * 37) % 90);
      const budat = new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];
      const statusMap = ['', '', '', 'C', 'C', 'C', '', '', ''];  // C = cleared
      const augbl = statusMap[i % statusMap.length] === 'C' ? belnr : null;
      const augdt = augbl ? new Date(Date.now() - (daysAgo - 15) * 86400000).toISOString().split('T')[0] : null;

      await c.env.DB.prepare(
        `INSERT INTO sap_bsik (id, tenant_id, BUKRS, LIFNR, AUGDT, AUGBL, GJAHR, BELNR, BUZEI, BUDAT, BLDAT, WAERS, SHKZG, DMBTR, WRBTR, SGTXT, ZFBDT, ZBD1T, EBELN)
         VALUES (?, ?, '1000', ?, ?, ?, '2026', ?, '001', ?, ?, 'ZAR', ?, ?, ?, ?, ?, 30, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, lifnr,
        augdt, augbl, belnr,
        budat, budat,
        (i >= 66 && i <= 72) ? 'S' : 'H',  // wrong indicator for 66-72
        total, total,
        `Vendor invoice - ${SA_SUPPLIERS[suppIdx].name}`,
        new Date(Date.now() - (daysAgo - 30) * 86400000).toISOString().split('T')[0],
        i <= 72 ? `PO-${(50000 + i).toString()}` : null,  // missing EBELN for 73-80
      ).run();
    }

    // SAP-SEED-8: EKKO — Purchase Order Headers (80 POs)
    for (let i = 1; i <= 80; i++) {
      const ebeln = (4500000000 + i).toString();
      const suppIdx = i % SA_SUPPLIERS.length;
      const lifnr = (10000 + suppIdx).toString().padStart(10, '0');
      const daysAgo = 10 + Math.floor((i * 43) % 120);
      const bedat = new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];

      await c.env.DB.prepare(
        `INSERT INTO sap_ekko (id, tenant_id, EBELN, BUKRS, BSTYP, BSART, LOEKZ, STATU, AEDAT, ERNAM, LIFNR, EKGRP, WAERS, BEDAT, RLWRT, ZTERM)
         VALUES (?, ?, ?, '1000', 'F', 'NB', ?, ?, ?, 'SAPBUYER', ?, ?, 'ZAR', ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, ebeln,
        i > 75 ? 'L' : null,  // L = deletion flag on last 5
        i <= 65 ? 'B' : 'A',  // B = PO completed, A = active
        bedat, lifnr,
        `E${(100 + suppIdx % 10).toString()}`,
        bedat,
        invoiceAmounts[i - 1] || Math.round((8000 + (i * 2731.41) % 45000) * 100) / 100,
        ['ZB30', 'ZB45', 'ZB60'][i % 3],
      ).run();
    }

    // SAP-SEED-9: EKPO — Purchase Order Items (1-2 items per PO)
    for (let i = 1; i <= 80; i++) {
      const ebeln = (4500000000 + i).toString();
      const prodIdx = i % SA_PRODUCTS.length;
      const p = SA_PRODUCTS[prodIdx];
      const total = invoiceAmounts[i - 1] || Math.round((8000 + (i * 2731.41) % 45000) * 100) / 100;
      const qty = Math.max(1, Math.floor(total / p.cost));
      const netpr = Math.round(total / qty * 100) / 100;

      await c.env.DB.prepare(
        `INSERT INTO sap_ekpo (id, tenant_id, EBELN, EBELP, MATNR, TXZ01, MENGE, MEINS, NETPR, PEINH, NETWR, MATKL, WERKS, LGORT, MWSKZ)
         VALUES (?, ?, ?, '00010', ?, ?, ?, ?, ?, 1, ?, ?, 'JHB1', '0001', 'I2')`
      ).bind(
        crypto.randomUUID(), tenantId, ebeln,
        p.sku, p.name, qty, p.uom, netpr, Math.round(netpr * qty * 100) / 100,
        p.cat,
      ).run();
    }

    // SAP-SEED-10: EKBE — PO History (Goods Receipt + Invoice Receipt)
    // Quality gaps: POs 66-72 have GR qty mismatch, POs 73-80 no IR entry
    for (let i = 1; i <= 80; i++) {
      const ebeln = (4500000000 + i).toString();
      const prodIdx = i % SA_PRODUCTS.length;
      const p = SA_PRODUCTS[prodIdx];
      const total = invoiceAmounts[i - 1] || Math.round((8000 + (i * 2731.41) % 45000) * 100) / 100;
      const qty = Math.max(1, Math.floor(total / p.cost));
      const daysAgo = 10 + Math.floor((i * 43) % 120);
      const budat = new Date(Date.now() - (daysAgo - 7) * 86400000).toISOString().split('T')[0];

      // Goods Receipt (VGABE = '1')
      let grQty = qty;
      if (i >= 66 && i <= 72) {
        // GR qty mismatch: received 5-15% less than ordered
        grQty = Math.max(1, Math.floor(qty * (0.85 + (i - 66) * 0.015)));
      }

      await c.env.DB.prepare(
        `INSERT INTO sap_ekbe (id, tenant_id, EBELN, EBELP, ZEESSION, VGABE, GJAHR, BELNR, BUZEI, BEWTP, MENGE, WRBTR, WAERS, BUDAT)
         VALUES (?, ?, ?, '00010', '0001', '1', '2026', ?, '001', 'E', ?, ?, 'ZAR', ?)`
      ).bind(
        crypto.randomUUID(), tenantId, ebeln,
        (5000000000 + i).toString(),
        grQty, Math.round(grQty * (total / qty) * 100) / 100, budat,
      ).run();

      // Invoice Receipt (VGABE = '2') — only for POs 1-72
      if (i <= 72) {
        let irAmt = total;
        if (i >= 66 && i <= 72) {
          // IR amount differs from PO by 3-7%
          const variancePct = 0.03 + ((i * 13) % 5) * 0.01;
          irAmt = Math.round(total * (1 + variancePct * (i % 2 === 0 ? 1 : -1)) * 100) / 100;
        }
        await c.env.DB.prepare(
          `INSERT INTO sap_ekbe (id, tenant_id, EBELN, EBELP, ZEESSION, VGABE, GJAHR, BELNR, BUZEI, BEWTP, MENGE, WRBTR, WAERS, BUDAT)
           VALUES (?, ?, ?, '00010', '0002', '2', '2026', ?, '001', 'Q', ?, ?, 'ZAR', ?)`
        ).bind(
          crypto.randomUUID(), tenantId, ebeln,
          bkpfBelnrs[i - 1],
          qty, irAmt, budat,
        ).run();
      }
    }

    // SAP-SEED-11: MARD — Material Warehouse Stock
    for (let i = 0; i < SA_PRODUCTS.length; i++) {
      const p = SA_PRODUCTS[i];
      await c.env.DB.prepare(
        `INSERT INTO sap_mard (id, tenant_id, MATNR, WERKS, LGORT, LABST, INSME, SPEME, EINME, RETME, LFGJA, LFMON)
         VALUES (?, ?, ?, 'JHB1', '0001', ?, ?, ?, 0, 0, '2026', '03')`
      ).bind(
        crypto.randomUUID(), tenantId,
        p.sku, p.stock,
        i >= 10 && i < 14 ? Math.floor(p.stock * 0.05) : 0,  // quality inspection stock
        i >= 14 ? Math.floor(p.stock * 0.03) : 0,  // blocked stock
      ).run();
    }

    // SAP-SEED-12: ISEG — Physical Inventory Count (deliberate variances)
    for (let i = 0; i < SA_PRODUCTS.length; i++) {
      const p = SA_PRODUCTS[i];
      let physQty: number;
      if (i < 10) {
        physQty = p.stock;  // exact match
      } else if (i < 14) {
        const shrinkagePct = 0.08 + (i - 10) * 0.047;
        physQty = Math.floor(p.stock * (1 - shrinkagePct));  // shortage
      } else {
        const surplusPct = 0.05 + (i - 14) * 0.033;
        physQty = Math.floor(p.stock * (1 + surplusPct));  // surplus
      }

      await c.env.DB.prepare(
        `INSERT INTO sap_iseg (id, tenant_id, IBLNR, GJAHR, ZEESSION, MATNR, WERKS, LGORT, MENGE, MEINS, BUCHM, XNULL, XDIFF)
         VALUES (?, ?, ?, '2026', ?, ?, 'JHB1', '0001', ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), tenantId,
        (4000000 + i).toString(),
        (i + 1).toString().padStart(4, '0'),
        p.sku, physQty, p.uom,
        physQty === p.stock ? physQty : 0,  // BUCHM = posted qty (0 if diff)
        physQty === 0 ? 'X' : null,  // XNULL = zero count flag
        physQty !== p.stock ? 'X' : null,  // XDIFF = difference flag
      ).run();
    }

    // SAP-SEED-13: VBAK — Sales Order Headers (80 sales orders)
    const vbakVbelns: string[] = [];
    for (let i = 1; i <= 80; i++) {
      const vbeln = (800000 + i).toString().padStart(10, '0');
      vbakVbelns.push(vbeln);
      const custIdx = i % SA_CUSTOMERS.length;
      const kunnr = (20000 + custIdx).toString().padStart(10, '0');
      const daysAgo = 5 + Math.floor((i * 31) % 90);
      const audat = new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];
      const total = invoiceAmounts[i - 1] || Math.round((10000 + (i * 1847.63) % 80000) * 100) / 100;

      await c.env.DB.prepare(
        `INSERT INTO sap_vbak (id, tenant_id, VBELN, AUART, VKORG, VTWEG, SPART, KUNNR, BSTNK, AUDAT, VDATU, NETWR, WAERK, VBTYP, ERNAM)
         VALUES (?, ?, ?, 'TA', '1000', '10', '00', ?, ?, ?, ?, ?, 'ZAR', 'C', 'SAPSALES')`
      ).bind(
        crypto.randomUUID(), tenantId, vbeln,
        kunnr,
        `CUST-PO-${(60000 + i).toString()}`,
        audat,
        new Date(Date.now() - (daysAgo - 14) * 86400000).toISOString().split('T')[0],
        total,
      ).run();
    }

    // SAP-SEED-14: VBAP — Sales Order Items
    for (let i = 1; i <= 80; i++) {
      const vbeln = vbakVbelns[i - 1];
      const prodIdx = i % SA_PRODUCTS.length;
      const p = SA_PRODUCTS[prodIdx];
      const total = invoiceAmounts[i - 1] || Math.round((10000 + (i * 1847.63) % 80000) * 100) / 100;
      const qty = Math.max(1, Math.floor(total / p.sell));

      await c.env.DB.prepare(
        `INSERT INTO sap_vbap (id, tenant_id, VBELN, POSNR, MATNR, ARKTX, KWMENG, VRKME, NETPR, NETWR, WAERK, WERKS, MATKL)
         VALUES (?, ?, ?, '000010', ?, ?, ?, ?, ?, ?, 'ZAR', 'JHB1', ?)`
      ).bind(
        crypto.randomUUID(), tenantId, vbeln,
        p.sku, p.name, qty, p.uom,
        Math.round(total / qty * 100) / 100, total,
        p.cat,
      ).run();
    }

    // SAP-SEED-15: VBRK — Billing Documents (only 72 of 80 orders billed)
    // Quality gaps: billing 56-65 have amount variance, 66-72 wrong RFBSK status, 73-80 not billed
    const vbrkVbelns: string[] = [];
    for (let i = 1; i <= 72; i++) {
      const billingVbeln = (9000000 + i).toString().padStart(10, '0');
      vbrkVbelns.push(billingVbeln);
      const custIdx = i % SA_CUSTOMERS.length;
      const kunnr = (20000 + custIdx).toString().padStart(10, '0');
      const daysAgo = 3 + Math.floor((i * 29) % 60);
      const fkdat = new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];
      let netwr = invoiceAmounts[i - 1] || Math.round((10000 + (i * 1847.63) % 80000) * 100) / 100;

      if (i >= 56 && i <= 65) {
        // Amount variance 2-8%
        const variancePct = 0.02 + ((i - 56) * 0.007);
        netwr = Math.round(netwr * (1 + variancePct * (i % 2 === 0 ? 1 : -1)) * 100) / 100;
      }

      const rfbsk = (i >= 66 && i <= 72) ? 'A' : 'C';  // A = not transferred, C = cleared

      await c.env.DB.prepare(
        `INSERT INTO sap_vbrk (id, tenant_id, VBELN, FKART, VKORG, KUNAG, KUNRG, FKDAT, RFBSK, NETWR, MWSBK, WAERK, BUKRS, XBLNR, ERNAM)
         VALUES (?, ?, ?, 'F2', '1000', ?, ?, ?, ?, ?, ?, 'ZAR', '1000', ?, 'SAPSALES')`
      ).bind(
        crypto.randomUUID(), tenantId, billingVbeln,
        kunnr, kunnr, fkdat, rfbsk,
        netwr, Math.round(netwr * 0.15 * 100) / 100,
        `INV-${(100000 + i).toString()}`,
      ).run();
    }

    // SAP-SEED-16: VBRP — Billing Document Items
    for (let i = 1; i <= 72; i++) {
      const billingVbeln = vbrkVbelns[i - 1];
      const prodIdx = i % SA_PRODUCTS.length;
      const p = SA_PRODUCTS[prodIdx];
      let netwr = invoiceAmounts[i - 1] || Math.round((10000 + (i * 1847.63) % 80000) * 100) / 100;
      if (i >= 56 && i <= 65) {
        const variancePct = 0.02 + ((i - 56) * 0.007);
        netwr = Math.round(netwr * (1 + variancePct * (i % 2 === 0 ? 1 : -1)) * 100) / 100;
      }
      const qty = Math.max(1, Math.floor(netwr / p.sell));

      await c.env.DB.prepare(
        `INSERT INTO sap_vbrp (id, tenant_id, VBELN, POSNR, FKIMG, VRKME, NETWR, MWSBP, MATNR, ARKTX, AUBEL, AUPOS, WERKS)
         VALUES (?, ?, ?, '000010', ?, ?, ?, ?, ?, ?, ?, '000010', 'JHB1')`
      ).bind(
        crypto.randomUUID(), tenantId, billingVbeln,
        qty, p.uom, netwr, Math.round(netwr * 0.15 * 100) / 100,
        p.sku, p.name,
        vbakVbelns[i - 1],
      ).run();
    }

    // SAP-SEED-17: BSID — Customer Open Items
    // Quality gaps: items 12-14 over credit limit, items 66-72 overdue
    for (let i = 1; i <= 72; i++) {
      const custIdx = i % SA_CUSTOMERS.length;
      const kunnr = (20000 + custIdx).toString().padStart(10, '0');
      const belnr = (6100000000 + i).toString();
      const daysAgo = 3 + Math.floor((i * 29) % 60);
      const budat = new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];
      const total = invoiceAmounts[i - 1] || Math.round((10000 + (i * 1847.63) % 80000) * 100) / 100;
      const statusMap = ['', '', '', 'C', 'C', 'C', '', '', ''];
      const augbl = statusMap[i % statusMap.length] === 'C' ? belnr : null;

      await c.env.DB.prepare(
        `INSERT INTO sap_bsid (id, tenant_id, BUKRS, KUNNR, AUGDT, AUGBL, GJAHR, BELNR, BUZEI, BUDAT, BLDAT, WAERS, SHKZG, DMBTR, WRBTR, SGTXT, ZFBDT, ZBD1T, XBLNR)
         VALUES (?, ?, '1000', ?, ?, ?, '2026', ?, '001', ?, ?, 'ZAR', 'S', ?, ?, ?, ?, 30, ?)`
      ).bind(
        crypto.randomUUID(), tenantId, kunnr,
        augbl ? new Date(Date.now() - (daysAgo - 15) * 86400000).toISOString().split('T')[0] : null,
        augbl, belnr,
        budat, budat,
        total, total,
        `Customer invoice - ${SA_CUSTOMERS[custIdx].name}`,
        new Date(Date.now() - (daysAgo - 30) * 86400000).toISOString().split('T')[0],
        `INV-${(100000 + i).toString()}`,
      ).run();
    }

    // SAP-SEED-18: FEBEP — Bank Statement Line Items
    // Quality gaps: items 56-65 bank charges (no matching FI doc), items 66-80 unmatched
    for (let i = 1; i <= 80; i++) {
      const daysAgo = 1 + Math.floor((i * 29) % 60);
      const valut = new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];
      let kwbtr = 0;
      let vwezw = '';
      let xblnr = '';
      let sgtxt = '';

      if (i <= 55) {
        kwbtr = -(invoiceAmounts[i - 1] || 0);  // negative = outgoing payment
        vwezw = '0010';  // bank transfer
        // Use PO reference format so FEBEP.XBLNR matches BSIK.EBELN for bank reconciliation
        xblnr = `PO-${(50000 + i).toString()}`;
        sgtxt = `Payment: ${xblnr} - ${SA_SUPPLIERS[i % SA_SUPPLIERS.length].name}`;
      } else if (i <= 65) {
        kwbtr = Math.round((150 + (i * 317.23) % 3500) * 100) / 100;  // positive = bank charge
        vwezw = '0020';  // bank charge
        xblnr = `BNK-FEE-${(90000 + i).toString()}`;
        sgtxt = ['Monthly service fee', 'SWIFT charge', 'Card processing fee', 'Cash handling', 'Statement fee'][(i - 56) % 5];
      } else {
        kwbtr = -(Math.round((5000 + (i * 2187.49) % 40000) * 100) / 100);
        vwezw = '0010';
        xblnr = `EFT-${(80000 + i).toString()}`;
        sgtxt = `EFT Payment - ${SA_SUPPLIERS[(i + 3) % SA_SUPPLIERS.length].name}`;
      }

      await c.env.DB.prepare(
        `INSERT INTO sap_febep (id, tenant_id, BUKRS, HESSION, AESSION, VALUT, KWBTR, WRBTR, WAERS, VWEZW, XBLNR, SGTXT)
         VALUES (?, ?, '1000', ?, ?, ?, ?, ?, 'ZAR', ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), tenantId,
        (7000000 + i).toString(),  // HESSION = bank statement number
        (i).toString().padStart(5, '0'),  // AESSION = line item
        valut, kwbtr, Math.abs(kwbtr),
        vwezw, xblnr, sgtxt,
      ).run();
    }

    console.log('[VantaX Seeder] SAP native tables seeded');

    // STEP 10: Create Catalyst Clusters with CONFIGURED sub-catalysts
    // Each sub-catalyst has data_sources and field_mappings for real execution

    // -- FINANCE CLUSTER --
    const financeClusterId = crypto.randomUUID();
    const financeSubCatalysts = [
      {
        name: 'GR/IR Reconciliation',
        enabled: true,
        description: 'Goods Receipt vs Invoice Receipt matching - SAP EKKO/EKPO vs EKBE (VGABE 1 vs 2)',
        data_sources: [
          { type: 'erp', config: { erp_type: 'sap', module: 'sap_ekbe_gr', label: 'SAP EKBE — Goods Receipts (VGABE=1)' } },
          { type: 'erp', config: { erp_type: 'sap', module: 'sap_ekbe_ir', label: 'SAP EKBE — Invoice Receipts (VGABE=2)' } },
        ],
        field_mappings: [
          { source_field: 'EBELN', target_field: 'EBELN', source_index: 0, target_index: 1, match_type: 'exact', label: 'PO Number (EKBE GR to EKBE IR)' },
          { source_field: 'WRBTR', target_field: 'WRBTR', source_index: 0, target_index: 1, match_type: 'numeric_tolerance', tolerance: 0.01, label: 'GR Amount vs IR Amount' },
        ],
        execution_config: { mode: 'reconciliation', parameters: { exception_discrepancy_threshold: 10, exception_match_rate_threshold: 50 } },
      },
      {
        name: 'AP Invoice Validation',
        enabled: true,
        description: 'Accounts Payable validation — SAP BKPF/BSEG vendor postings (KOART=K) completeness and accuracy',
        data_sources: [
          { type: 'erp', config: { erp_type: 'sap', module: 'sap_bseg_vendor', label: 'SAP BSEG — Vendor Line Items (KOART=K)' } },
        ],
        execution_config: { mode: 'validation' },
      },
      {
        name: 'Bank Reconciliation',
        enabled: true,
        description: 'Bank statement (FEBEP) vs SAP FI vendor payments (BSIK) — FNB Corporate',
        data_sources: [
          { type: 'erp', config: { erp_type: 'sap', module: 'sap_febep', label: 'SAP FEBEP — Bank Statement Items' } },
          { type: 'erp', config: { erp_type: 'sap', module: 'sap_bsik', label: 'SAP BSIK — Vendor Open Items' } },
        ],
        field_mappings: [
          { source_field: 'XBLNR', target_field: 'EBELN', source_index: 0, target_index: 1, match_type: 'contains', label: 'Bank Reference to PO Number' },
          { source_field: 'WRBTR', target_field: 'WRBTR', source_index: 0, target_index: 1, match_type: 'numeric_tolerance', tolerance: 0.50, label: 'Bank Amount vs Vendor Amount' },
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
        description: 'SAP MARD (system stock) vs ISEG (physical count) — warehouse JHB1/0001',
        data_sources: [
          { type: 'erp', config: { erp_type: 'sap', module: 'sap_mard', label: 'SAP MARD — Material Warehouse Stock' } },
          { type: 'erp', config: { erp_type: 'sap', module: 'sap_iseg', label: 'SAP ISEG — Physical Inventory Count' } },
        ],
        field_mappings: [
          { source_field: 'MATNR', target_field: 'MATNR', source_index: 0, target_index: 1, match_type: 'exact', label: 'Material Number (MARD to ISEG)' },
          { source_field: 'LABST', target_field: 'MENGE', source_index: 0, target_index: 1, match_type: 'numeric_tolerance', tolerance: 1, label: 'System Stock vs Physical Count' },
        ],
        execution_config: { mode: 'reconciliation' },
      },
      {
        name: 'PO-to-GR Matching',
        enabled: true,
        description: 'SAP EKPO (PO items) vs EKBE (GR history VGABE=1) — delivery verification',
        data_sources: [
          { type: 'erp', config: { erp_type: 'sap', module: 'sap_ekpo', label: 'SAP EKPO — Purchase Order Items' } },
          { type: 'erp', config: { erp_type: 'sap', module: 'sap_ekbe_gr', label: 'SAP EKBE — Goods Receipts (VGABE=1)' } },
        ],
        field_mappings: [
          { source_field: 'EBELN', target_field: 'EBELN', source_index: 0, target_index: 1, match_type: 'exact', label: 'PO Number (EKPO to EKBE)' },
          { source_field: 'NETWR', target_field: 'WRBTR', source_index: 0, target_index: 1, match_type: 'numeric_tolerance', tolerance: 0.01, label: 'PO Amount vs GR Amount' },
        ],
        execution_config: { mode: 'reconciliation' },
      },
      {
        name: 'Supplier Validation',
        enabled: true,
        description: 'SAP LFA1/LFB1 vendor master data quality — STCD1, ZTERM, AKONT, SPERR checks',
        data_sources: [
          { type: 'erp', config: { erp_type: 'sap', module: 'sap_lfa1', label: 'SAP LFA1 — Vendor Master General' } },
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
        description: 'IFRS 15 revenue recognition — SAP VBRK/VBRP billing document validation',
        data_sources: [
          { type: 'erp', config: { erp_type: 'sap', module: 'sap_vbrk', label: 'SAP VBRK — Billing Document Headers' } },
        ],
        execution_config: { mode: 'validation' },
      },
      {
        name: 'Customer Receivables',
        enabled: true,
        description: 'SAP KNA1/KNB1 + BSID — customer credit monitoring, aging analysis, collection tracking',
        data_sources: [
          { type: 'erp', config: { erp_type: 'sap', module: 'sap_kna1', label: 'SAP KNA1 — Customer Master General' } },
        ],
        execution_config: { mode: 'validation' },
      },
      {
        name: 'Sales Order Matching',
        enabled: true,
        description: 'SAP VBAK/VBAP (sales orders) vs VBRK/VBRP (billing docs) — order-to-bill reconciliation',
        data_sources: [
          { type: 'erp', config: { erp_type: 'sap', module: 'sap_vbak', label: 'SAP VBAK — Sales Order Headers' } },
          { type: 'erp', config: { erp_type: 'sap', module: 'sap_vbrk', label: 'SAP VBRK — Billing Document Headers' } },
        ],
        field_mappings: [
          { source_field: 'VBELN', target_field: 'AUBEL', source_index: 0, target_index: 1, match_type: 'exact', label: 'Sales Order to Billing Reference' },
          { source_field: 'NETWR', target_field: 'NETWR', source_index: 0, target_index: 1, match_type: 'numeric_tolerance', tolerance: 0.01, label: 'Order Amount vs Billing Amount' },
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

    // Step 10: Create Executive Briefing
    await c.env.DB.prepare(`
      INSERT INTO executive_briefings (id, tenant_id, title, summary, risks, opportunities, kpi_movements, decisions_needed, generated_at, health_delta, red_metric_count, anomaly_count, active_risk_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(), tenantId,
      'Daily Executive Briefing - ' + new Date().toLocaleDateString(),
      'VantaX SAP operations showing mixed performance. Critical attention needed in Supply Chain (inventory variance 21.7%) and Revenue Recognition (26.3% timing differences).',
      JSON.stringify([
        'High GR/IR Discrepancy Rate — 17% exceeds 10% threshold (Financial)',
        'Inventory Shrinkage Detected — 21.7% variance indicates potential issues (Operational)',
        'Revenue Recognition Delay — 26.3% not recognized in correct period (Compliance)',
        'Duplicate Payment Risk — AP validation detected duplicates (Financial)',
      ]),
      JSON.stringify([
        'Process Automation — estimated R 2.5M savings by Q2 2025',
        'System Integration — estimated R 1.8M savings by Q3 2025',
      ]),
      JSON.stringify([
        { kpi: 'Match Rate', movement: '-5.2%', period: 'vs last month' },
        { kpi: 'Exception Rate', movement: '+3.1%', period: 'vs last month' },
        { kpi: 'Processing Time', movement: '-12s', period: 'vs last month' },
      ]),
      JSON.stringify([
        'Approve inventory audit budget (R 500K)',
        'Review revenue recognition policy with CFO',
        'Prioritize GR/IR process improvement',
      ]),
      now,
      -1.2,  // health_delta
      2,     // red_metric_count
      1,     // anomaly_count
      4      // active_risk_count
    ).run();

    // ── STEP: Seed Apex Radar signals + impacts ──
    console.log('[VantaX Seeder] Seeding Apex Radar signals...');

    const radarSignals = [
      { source: 'SARB', type: 'regulatory', title: 'SARB Interest Rate Hike – 50bps', description: 'The South African Reserve Bank raised the repo rate by 50 basis points to combat inflation. This will increase borrowing costs across all credit facilities and may impact capital expenditure plans.', severity: 'high', relevance: 85 },
      { source: 'Reuters', type: 'market', title: 'Rand Weakens Past R19/USD', description: 'The South African Rand breached the R19/USD mark amid global risk-off sentiment and load-shedding concerns. Import costs for raw materials will increase significantly.', severity: 'critical', relevance: 92 },
      { source: 'BusinessDay', type: 'competitor', title: 'Competitor Acquires Local Distributor', description: 'Major competitor has acquired a key logistics partner in the Gauteng region, potentially disrupting our supply chain relationships and distribution network.', severity: 'medium', relevance: 70 },
      { source: 'DTIC', type: 'regulatory', title: 'New BBBEE Scorecard Requirements', description: 'Department of Trade, Industry and Competition published updated BBBEE scorecard requirements effective Q2 2026. Procurement scoring thresholds have been raised.', severity: 'high', relevance: 78 },
      { source: 'Eskom', type: 'economic', title: 'Stage 4 Load Shedding Extended', description: 'Eskom announced extended Stage 4 load shedding for the next 3 weeks due to unplanned breakdowns. Production capacity will be impacted by 15-20%.', severity: 'critical', relevance: 95 },
      { source: 'TechCrunch', type: 'technology', title: 'SAP S/4HANA Cloud Migration Wave', description: 'SAP announced accelerated migration timeline for S/4HANA Cloud. Current on-premise licences will require transition planning within 18 months.', severity: 'medium', relevance: 65 },
    ];

    const signalIds: string[] = [];
    for (const sig of radarSignals) {
      const sigId = crypto.randomUUID();
      signalIds.push(sigId);
      await c.env.DB.prepare(
        `INSERT INTO radar_signals (id, tenant_id, source, signal_type, title, description, url, raw_data, severity, relevance_score, status, detected_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, '{}', ?, ?, 'analysed', ?, ?)`
      ).bind(sigId, tenantId, sig.source, sig.type, sig.title, sig.description, sig.severity, sig.relevance, now, now).run();
    }

    // Seed signal impacts
    const impactData = [
      { sigIdx: 0, dimension: 'financial', direction: 'negative', magnitude: 72, metrics: ['Interest Coverage Ratio', 'Debt Service Cost'], actions: ['Review variable-rate facilities', 'Accelerate fixed-rate hedging'] },
      { sigIdx: 0, dimension: 'operational', direction: 'negative', magnitude: 45, metrics: ['CapEx Budget Utilisation'], actions: ['Defer non-critical capital projects'] },
      { sigIdx: 1, dimension: 'financial', direction: 'negative', magnitude: 88, metrics: ['Import Cost Index', 'Gross Margin'], actions: ['Activate FX hedging program', 'Renegotiate supplier contracts with ZAR escalation clauses'] },
      { sigIdx: 1, dimension: 'risk', direction: 'negative', magnitude: 75, metrics: ['Currency Risk Exposure'], actions: ['Increase ZAR cash reserves'] },
      { sigIdx: 2, dimension: 'strategic', direction: 'negative', magnitude: 55, metrics: ['Market Share', 'Distribution Coverage'], actions: ['Strengthen existing distributor relationships', 'Explore alternative logistics partners'] },
      { sigIdx: 3, dimension: 'compliance', direction: 'negative', magnitude: 60, metrics: ['BBBEE Score', 'Procurement Spend Compliance'], actions: ['Audit current BBBEE procurement spend', 'Identify additional qualifying suppliers'] },
      { sigIdx: 4, dimension: 'operational', direction: 'negative', magnitude: 90, metrics: ['Production Output', 'OEE', 'Energy Cost per Unit'], actions: ['Activate backup generator capacity', 'Shift production to off-peak hours', 'Review diesel fuel reserves'] },
      { sigIdx: 4, dimension: 'financial', direction: 'negative', magnitude: 68, metrics: ['Energy Cost Ratio', 'Unit Production Cost'], actions: ['Accelerate solar installation project'] },
      { sigIdx: 5, dimension: 'technology', direction: 'neutral', magnitude: 40, metrics: ['System Migration Readiness'], actions: ['Begin S/4HANA Cloud readiness assessment', 'Budget for migration project'] },
    ];

    for (const imp of impactData) {
      const impId = crypto.randomUUID();
      await c.env.DB.prepare(
        `INSERT INTO radar_signal_impacts (id, tenant_id, signal_id, dimension, impact_direction, impact_magnitude, affected_metrics, recommended_actions, llm_reasoning, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Analysis generated by Atheon Intelligence based on signal context and current health dimensions.', ?)`
      ).bind(impId, tenantId, signalIds[imp.sigIdx], imp.dimension, imp.direction, imp.magnitude, JSON.stringify(imp.metrics), JSON.stringify(imp.actions), now).run();
    }

    // Seed strategic context
    const ctxId = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO radar_strategic_context (id, tenant_id, context_type, title, summary, factors, sentiment, confidence, source_signal_ids, valid_from, created_at)
       VALUES (?, ?, 'macro', 'Q2 2026 Strategic Context: Headwinds Intensifying', ?, ?, 'negative', 72, ?, ?, ?)`
    ).bind(
      ctxId, tenantId,
      'The South African operating environment faces significant headwinds in Q2 2026. A combination of monetary tightening (50bps repo rate increase), rand depreciation past R19/USD, and extended Stage 4 load shedding creates a challenging landscape for industrial operations. Import-dependent supply chains face margin compression, while energy-intensive production lines will see reduced output capacity. New BBBEE scorecard requirements add compliance complexity. On the positive side, the SAP S/4HANA Cloud transition, while requiring investment, presents an opportunity to modernise operations. Strategic focus should prioritise cost containment, FX risk management, and energy resilience.',
      JSON.stringify([
        { name: 'Interest Rate Environment', direction: 'negative', magnitude: 72 },
        { name: 'Currency Depreciation', direction: 'negative', magnitude: 88 },
        { name: 'Energy Supply (Load Shedding)', direction: 'negative', magnitude: 90 },
        { name: 'Regulatory Compliance (BBBEE)', direction: 'negative', magnitude: 60 },
        { name: 'Technology Modernisation', direction: 'positive', magnitude: 40 },
      ]),
      JSON.stringify(signalIds),
      now, now,
    ).run();

    console.log(`[VantaX Seeder] Seeded ${radarSignals.length} radar signals, ${impactData.length} impacts, 1 strategic context`);

    // ── STEP: Seed Pulse Diagnostics ──
    console.log('[VantaX Seeder] Seeding Pulse Diagnostics...');

    const diagMetrics = [
      { name: 'GR/IR Match Rate', value: 81.25, status: 'amber', category: 'reconciliation' },
      { name: 'Bank Reconciliation Rate', value: 68.75, status: 'red', category: 'reconciliation' },
      { name: 'Inventory Accuracy', value: 55.6, status: 'red', category: 'inventory' },
    ];

    for (const dm of diagMetrics) {
      const analysisId = crypto.randomUUID();
      await c.env.DB.prepare(
        `INSERT INTO diagnostic_analyses (id, tenant_id, metric_id, metric_name, metric_value, metric_status, trigger_type, status, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, 'auto', 'completed', ?, ?)`
      ).bind(analysisId, tenantId, crypto.randomUUID(), dm.name, dm.value, dm.status, now, now).run();

      // L0-L3 causal chain for each
      const chains = [
        { level: 0, type: 'direct', title: `${dm.name} at ${dm.value}%`, desc: `Metric ${dm.name} is in ${dm.status} status at ${dm.value}%, below target thresholds.`, confidence: 95, priority: dm.status === 'red' ? 'critical' : 'high', effort: 'low' },
        { level: 1, type: 'direct', title: `Data quality issues in source systems`, desc: `Inconsistent data entry and delayed postings in SAP S/4HANA are causing reconciliation mismatches. Manual data entry errors account for approximately 15% of discrepancies.`, confidence: 80, priority: 'high', effort: 'medium' },
        { level: 2, type: 'contributing', title: `Process timing gaps between systems`, desc: `Cut-off timing differences between sub-systems create temporary reconciliation breaks. Month-end close procedures do not adequately address inter-system timing gaps.`, confidence: 70, priority: 'medium', effort: 'medium' },
        { level: 3, type: 'systemic', title: `Lack of real-time integration layer`, desc: `Batch processing architecture means reconciliation data is always stale by 4-8 hours. A real-time event-driven integration would eliminate most timing-related discrepancies.`, confidence: 60, priority: 'medium', effort: 'high' },
      ];

      for (const ch of chains) {
        const chainId = crypto.randomUUID();
        await c.env.DB.prepare(
          `INSERT INTO diagnostic_causal_chains (id, tenant_id, analysis_id, level, cause_type, title, description, confidence, evidence, related_metrics, recommended_fix, fix_priority, fix_effort, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?, ?, ?)`
        ).bind(chainId, tenantId, analysisId, ch.level, ch.type, ch.title, ch.desc, ch.confidence, `Review and address: ${ch.title}`, ch.priority, ch.effort, now).run();
      }
    }

    console.log(`[VantaX Seeder] Seeded ${diagMetrics.length} diagnostic analyses with causal chains`);

    // ── STEP: Seed Catalyst Intelligence patterns ──
    console.log('[VantaX Seeder] Seeding Catalyst Intelligence patterns...');

    const patterns = [
      { type: 'recurring_failure', title: 'Recurring GR/IR Mismatch on Chemicals Suppliers', desc: 'Pattern detected: 4 out of 5 recent GR/IR reconciliation runs show mismatches exceeding 5% for chemical raw material suppliers (Sasol, Omnia, AECI). Root cause appears to be inconsistent unit-of-measure conversion between PO and goods receipt.', freq: 4, severity: 'high', clusters: ['Finance'], subs: ['GR/IR Reconciliation'] },
      { type: 'degradation_trend', title: 'Declining Bank Reconciliation Accuracy', desc: 'Bank reconciliation accuracy has declined from 85% to 69% over the last 6 runs. Unmatched EFT transactions are increasing, particularly for smaller supplier payments under R10,000. This correlates with the recent switch to batch payment processing.', freq: 6, severity: 'critical', clusters: ['Finance'], subs: ['Bank Reconciliation'] },
      { type: 'cross_catalyst_correlation', title: 'Inventory Discrepancy Correlates with PO Timing', desc: 'Inventory count variances are 3x higher for items with purchase orders processed in the last 48 hours. The goods receipt timing gap between warehouse scanning and SAP posting is creating a systematic bias in physical count reconciliation.', freq: 3, severity: 'medium', clusters: ['Supply Chain', 'Finance'], subs: ['Inventory Reconciliation', 'GR/IR Reconciliation'] },
    ];

    for (const pat of patterns) {
      const patId = crypto.randomUUID();
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
      await c.env.DB.prepare(
        `INSERT INTO catalyst_patterns (id, tenant_id, pattern_type, title, description, frequency, first_seen, last_seen, affected_clusters, affected_sub_catalysts, severity, status, recommended_actions, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', '[]', ?)`
      ).bind(patId, tenantId, pat.type, pat.title, pat.desc, pat.freq, thirtyDaysAgo, now, JSON.stringify(pat.clusters), JSON.stringify(pat.subs), pat.severity, now).run();
    }

    console.log(`[VantaX Seeder] Seeded ${patterns.length} catalyst patterns`);

    // Summary
    // Products: SAP (18) + PHYSICAL_COUNT (18) = 36; Invoices: SAP (80) + SAP-AR (72) = 152
    const totalErpRecords = SA_SUPPLIERS.length + SA_CUSTOMERS.length + (SA_PRODUCTS.length * 2) + 80 + 72 + 80 + 80 + GL_ACCOUNTS.length + 40;

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
          products_system: SA_PRODUCTS.length,
          products_physical_count: SA_PRODUCTS.length,
          invoices_sap: 80,
          invoices_ar: 72,
          purchaseOrders: 80,
          bankTransactions: 80,
          glAccounts: GL_ACCOUNTS.length,
          journalEntries: 40,
        },
        dataQuality: {
          grir: '65 of 80 POs match invoices exactly (81.25%), 7 price variances (8.75%), 8 unmatched (10%)',
          bank: '55 of 80 bank transactions reconciled (68.75%), 10 bank fees, 15 unmatched EFTs',
          inventory: '10 of 18 products match exactly (55.6%), 4 shortage (shrinkage), 4 surplus (receiving errors)',
          salesOrder: '55 of 80 SD invoices match AR postings exactly (68.75%), 10 amount variances, 7 status mismatches, 8 unmatched',
        },
        catalysts: {
          clusters: 3,
          clusterNames: ['Finance', 'Supply Chain', 'Revenue'],
          subCatalysts: allSubCatalysts.length,
          withDataSources: allSubCatalysts.filter(s => s.data_sources && s.data_sources.length > 0).length,
          reconciliationReady: allSubCatalysts.filter(s => s.data_sources && s.data_sources.length >= 2).length,
        },
        healthScore: { overall: 0, note: 'Baseline - will be calculated on first catalyst run' },
        newEngines: {
          radarSignals: radarSignals.length,
          radarImpacts: impactData.length,
          strategicContexts: 1,
          diagnosticAnalyses: diagMetrics.length,
          catalystPatterns: patterns.length,
        },
      },
      nextSteps: [
        'Go to Catalysts page and execute any sub-catalyst',
        'GR/IR Reconciliation: ~81% match, ~9% price variances, ~10% unmatched POs',
        'Bank Reconciliation: ~69% reconciled, 10 bank fees, 15 unmatched EFTs',
        'Inventory Reconciliation: ~56% exact match, 4 shrinkage, 4 surplus items',
        'Sales Order Matching: ~69% SD-to-AR match, 10 amount variances, 8 unmatched',
        'AP Invoice Validation: validates 80 invoices for field completeness',
        'All modes (reconciliation, validation, comparison, extraction) do real field-level work',
        'Visit Apex → Strategic Context to see radar signals and impact analysis',
        'Visit Pulse → Diagnostics to see root-cause analyses for degraded metrics',
        'Visit Catalysts → Intelligence to see discovered patterns and trends',
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
      // New engine tables
      ['radarSignals', 'radar_signals'],
      ['radarImpacts', 'radar_signal_impacts'],
      ['radarContext', 'radar_strategic_context'],
      ['diagnosticAnalyses', 'diagnostic_analyses'],
      ['diagnosticChains', 'diagnostic_causal_chains'],
      ['diagnosticFixes', 'diagnostic_fix_tracking'],
      ['catalystPatterns', 'catalyst_patterns'],
      ['catalystEffectiveness', 'catalyst_effectiveness'],
      ['catalystDependencies', 'catalyst_dependencies'],
      // SAP native tables
      ['sap_bkpf', 'sap_bkpf'],
      ['sap_bseg', 'sap_bseg'],
      ['sap_bsid', 'sap_bsid'],
      ['sap_bsik', 'sap_bsik'],
      ['sap_febep', 'sap_febep'],
      ['sap_ekko', 'sap_ekko'],
      ['sap_ekpo', 'sap_ekpo'],
      ['sap_ekbe', 'sap_ekbe'],
      ['sap_mard', 'sap_mard'],
      ['sap_iseg', 'sap_iseg'],
      ['sap_vbak', 'sap_vbak'],
      ['sap_vbap', 'sap_vbap'],
      ['sap_vbrk', 'sap_vbrk'],
      ['sap_vbrp', 'sap_vbrp'],
      ['sap_lfa1', 'sap_lfa1'],
      ['sap_lfb1', 'sap_lfb1'],
      ['sap_kna1', 'sap_kna1'],
      ['sap_knb1', 'sap_knb1'],
    ];

    for (const [key, table] of tables) {
      if (!ALLOWED_TABLES.has(table)) continue;
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
