// src/lib/ingest-manifest.ts
// Single source of truth for upload-driven ingest. Columns map 1:1 to erp_*
// schema (workers/api/src/services/migrate.ts). MIRROR: an identical copy lives
// at workers/api/src/lib/ingest-manifest.ts (the worker cannot import src/).
// Any edit here MUST be copied there — ingest-manifest-parity.test.ts enforces it.

export type ColType = 'string' | 'number' | 'integer' | 'date' | 'boolean';

export interface ColumnDef {
  /** canonical erp_* column name */
  name: string;
  type: ColType;
  required: boolean;
}

export interface DomainDef {
  /** dataset domain key + the erp_* table it ingests into */
  domain: string;
  table: string;
  label: string;
  columns: ColumnDef[];
}

export const INGEST_MANIFEST: DomainDef[] = [
  {
    domain: 'invoices', table: 'erp_invoices', label: 'Sales Invoices (AR)',
    columns: [
      { name: 'invoice_number', type: 'string', required: true },
      { name: 'customer_name', type: 'string', required: false },
      { name: 'invoice_date', type: 'date', required: true },
      { name: 'due_date', type: 'date', required: false },
      { name: 'subtotal', type: 'number', required: false },
      { name: 'vat_amount', type: 'number', required: false },
      { name: 'total', type: 'number', required: true },
      { name: 'amount_paid', type: 'number', required: false },
      { name: 'amount_due', type: 'number', required: false },
      { name: 'currency', type: 'string', required: false },
      { name: 'status', type: 'string', required: false },
      { name: 'payment_status', type: 'string', required: false },
    ],
  },
  {
    domain: 'purchase_orders', table: 'erp_purchase_orders', label: 'Purchase Orders (AP)',
    columns: [
      { name: 'po_number', type: 'string', required: true },
      { name: 'supplier_name', type: 'string', required: false },
      { name: 'order_date', type: 'date', required: true },
      { name: 'delivery_date', type: 'date', required: false },
      { name: 'subtotal', type: 'number', required: false },
      { name: 'vat_amount', type: 'number', required: false },
      { name: 'total', type: 'number', required: true },
      { name: 'currency', type: 'string', required: false },
      { name: 'status', type: 'string', required: false },
      { name: 'delivery_status', type: 'string', required: false },
    ],
  },
  {
    domain: 'journal_entries', table: 'erp_journal_entries', label: 'GL Journal Entries',
    columns: [
      { name: 'journal_number', type: 'string', required: true },
      { name: 'journal_date', type: 'date', required: true },
      { name: 'description', type: 'string', required: false },
      { name: 'total_debit', type: 'number', required: true },
      { name: 'total_credit', type: 'number', required: true },
      { name: 'status', type: 'string', required: false },
    ],
  },
  {
    domain: 'bank_transactions', table: 'erp_bank_transactions', label: 'Bank Transactions',
    columns: [
      { name: 'bank_account', type: 'string', required: true },
      { name: 'transaction_date', type: 'date', required: true },
      { name: 'description', type: 'string', required: false },
      { name: 'reference', type: 'string', required: false },
      { name: 'debit', type: 'number', required: false },
      { name: 'credit', type: 'number', required: false },
      { name: 'balance', type: 'number', required: false },
      { name: 'reconciled', type: 'integer', required: false },
    ],
  },
  {
    domain: 'employees', table: 'erp_employees', label: 'Employees / Payroll',
    columns: [
      { name: 'employee_number', type: 'string', required: true },
      { name: 'first_name', type: 'string', required: true },
      { name: 'last_name', type: 'string', required: true },
      { name: 'email', type: 'string', required: false },
      { name: 'department', type: 'string', required: false },
      { name: 'position', type: 'string', required: false },
      { name: 'salary_frequency', type: 'string', required: false },
      { name: 'gross_salary', type: 'number', required: false },
      { name: 'status', type: 'string', required: false },
    ],
  },
  {
    domain: 'customers', table: 'erp_customers', label: 'Customers',
    columns: [
      { name: 'name', type: 'string', required: true },
      { name: 'registration_number', type: 'string', required: false },
      { name: 'vat_number', type: 'string', required: false },
      { name: 'payment_terms', type: 'string', required: false },
      { name: 'currency', type: 'string', required: false },
      { name: 'credit_limit', type: 'number', required: false },
      { name: 'status', type: 'string', required: false },
    ],
  },
  {
    domain: 'suppliers', table: 'erp_suppliers', label: 'Suppliers',
    columns: [
      { name: 'name', type: 'string', required: true },
      { name: 'registration_number', type: 'string', required: false },
      { name: 'vat_number', type: 'string', required: false },
      { name: 'payment_terms', type: 'string', required: false },
      { name: 'currency', type: 'string', required: false },
      { name: 'status', type: 'string', required: false },
    ],
  },
  {
    domain: 'products', table: 'erp_products', label: 'Products / Inventory',
    columns: [
      { name: 'sku', type: 'string', required: true },
      { name: 'name', type: 'string', required: true },
      { name: 'category', type: 'string', required: false },
      { name: 'uom', type: 'string', required: false },
      { name: 'cost_price', type: 'number', required: false },
      { name: 'selling_price', type: 'number', required: false },
      { name: 'stock_on_hand', type: 'number', required: false },
      { name: 'is_active', type: 'integer', required: false },
    ],
  },
];

/** CSV header row for a domain's downloadable template. */
export function templateHeader(domain: string): string {
  const d = INGEST_MANIFEST.find(x => x.domain === domain);
  if (!d) throw new Error(`unknown domain ${domain}`);
  return d.columns.map(c => c.name).join(',');
}

export function domainDef(domain: string): DomainDef | undefined {
  return INGEST_MANIFEST.find(x => x.domain === domain);
}
