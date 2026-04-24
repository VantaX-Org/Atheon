/**
 * ERP Data Mapper Service
 *
 * Maps raw ERP API responses to canonical table rows.
 * Each ERP system returns data in its own schema — these mappers normalise
 * the output so that every record conforms to the canonical D1 tables
 * (erp_customers, erp_suppliers, erp_invoices, erp_products, etc.).
 */

// ═══ Canonical Interfaces ═══
//
// Every canonical record carries an optional `company_id` — the erp_companies.id
// that the source record maps to (see resolveCompanyId in erp-connector.ts).
// Callers should populate it via `mapRecord(..., { companyId })` so the generic
// writer in routes/erp.ts picks it up through Object.keys(mappedObj).

export interface CanonicalCustomer {
  id: string; tenant_id: string; source_system: string; source_id: string;
  company_id?: string;
  name: string; email: string; phone: string; address: string;
  city: string; country: string; tax_number: string;
  customer_group: string; credit_limit: number; outstanding_balance: number;
  payment_terms: string; currency: string; status: string;
  created_at: string; updated_at: string;
}

export interface CanonicalSupplier {
  id: string; tenant_id: string; source_system: string; source_id: string;
  company_id?: string;
  name: string; email: string; phone: string; address: string;
  city: string; country: string; tax_number: string;
  supplier_group: string; payment_terms: string; currency: string;
  status: string; created_at: string; updated_at: string;
}

export interface CanonicalInvoice {
  id: string; tenant_id: string; source_system: string; source_id: string;
  company_id?: string;
  invoice_number: string; customer_id: string; customer_name: string;
  invoice_date: string; due_date: string; currency: string;
  subtotal: number; tax: number; total: number;
  amount_paid: number; amount_due: number;
  status: string; line_items: string; // JSON
  created_at: string; updated_at: string;
}

export interface CanonicalProduct {
  id: string; tenant_id: string; source_system: string; source_id: string;
  company_id?: string;
  sku: string; name: string; description: string; category: string;
  unit_price: number; cost_price: number; currency: string;
  quantity_on_hand: number; reorder_level: number; warehouse: string;
  status: string; created_at: string; updated_at: string;
}

export interface CanonicalPurchaseOrder {
  id: string; tenant_id: string; source_system: string; source_id: string;
  company_id?: string;
  po_number: string; supplier_id: string; supplier_name: string;
  order_date: string; delivery_date: string; currency: string;
  subtotal: number; tax: number; total: number;
  status: string; line_items: string; // JSON
  created_at: string; updated_at: string;
}

export interface CanonicalGLAccount {
  id: string; tenant_id: string; source_system: string; source_id: string;
  company_id?: string;
  account_code: string; account_name: string; account_type: string;
  balance: number; currency: string;
  created_at: string; updated_at: string;
}

export interface CanonicalEmployee {
  id: string; tenant_id: string; source_system: string; source_id: string;
  company_id?: string;
  employee_number: string; first_name: string; last_name: string;
  email: string; department: string; job_title: string;
  hire_date: string; status: string;
  salary: number; currency: string;
  created_at: string; updated_at: string;
}

// ═══ Helper functions ═══

function s(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val);
}

function n(val: unknown): number {
  if (val === null || val === undefined) return 0;
  const num = Number(val);
  return isNaN(num) ? 0 : num;
}

function now(): string { return new Date().toISOString(); }

// ═══ SAP S/4HANA Mappers ═══

function mapSAPCustomer(raw: Record<string, unknown>, tenantId: string): CanonicalCustomer {
  return {
    id: crypto.randomUUID(), tenant_id: tenantId, source_system: 'sap',
    source_id: s(raw.Customer || raw.BusinessPartner),
    name: s(raw.CustomerName || raw.BusinessPartnerFullName || raw.OrganizationBPName1),
    email: s(raw.EmailAddress || raw.DefaultEmailAddress),
    phone: s(raw.PhoneNumber || raw.InternationalPhoneNumber),
    address: s(raw.StreetName || raw.AddressHouseNumber),
    city: s(raw.CityName), country: s(raw.Country),
    tax_number: s(raw.TaxNumber1 || raw.TaxNumber2),
    customer_group: s(raw.CustomerAccountGroup || raw.CustomerClassification),
    credit_limit: n(raw.CreditLimit), outstanding_balance: n(raw.ClearingAmount),
    payment_terms: s(raw.PaymentTerms || raw.CustomerPaymentTerms),
    currency: s(raw.Currency || raw.CustomerCurrency || 'ZAR'),
    status: raw.DeletionIndicator ? 'inactive' : 'active',
    created_at: s(raw.CreationDate) || now(), updated_at: now(),
  };
}

function mapSAPInvoice(raw: Record<string, unknown>, tenantId: string): CanonicalInvoice {
  return {
    id: crypto.randomUUID(), tenant_id: tenantId, source_system: 'sap',
    source_id: s(raw.BillingDocument || raw.AccountingDocument),
    invoice_number: s(raw.BillingDocument || raw.AccountingDocument),
    customer_id: s(raw.SoldToParty || raw.Customer),
    customer_name: s(raw.SoldToPartyName || raw.CustomerName),
    invoice_date: s(raw.BillingDocumentDate || raw.DocumentDate),
    due_date: s(raw.PaymentDueDate || raw.NetDueDate),
    currency: s(raw.TransactionCurrency || raw.DocumentCurrency || 'ZAR'),
    subtotal: n(raw.NetAmount), tax: n(raw.TaxAmount),
    total: n(raw.GrossAmount || raw.TotalNetAmount),
    amount_paid: n(raw.ClearedAmount), amount_due: n(raw.OpenAmount),
    status: raw.ClearingDocument ? 'paid' : raw.IsDisputed ? 'disputed' : 'sent',
    line_items: JSON.stringify(raw.to_Item || raw.BillingDocumentItem || []),
    created_at: s(raw.CreationDate) || now(), updated_at: now(),
  };
}

function mapSAPProduct(raw: Record<string, unknown>, tenantId: string): CanonicalProduct {
  return {
    id: crypto.randomUUID(), tenant_id: tenantId, source_system: 'sap',
    source_id: s(raw.Material || raw.Product),
    sku: s(raw.Material || raw.Product),
    name: s(raw.MaterialDescription || raw.ProductDescription || raw.MaterialName),
    description: s(raw.MaterialDescription || raw.ProductDescription),
    category: s(raw.MaterialGroup || raw.ProductGroup),
    unit_price: n(raw.StandardPrice || raw.MovingAveragePrice),
    cost_price: n(raw.StandardPrice),
    currency: s(raw.Currency || raw.ValuationCurrency || 'ZAR'),
    quantity_on_hand: n(raw.MatlWrhsStkQtyInMatlBaseUnit || raw.AvailableStock),
    reorder_level: n(raw.ReorderThreshold || raw.MinimumLotSizeQuantity),
    warehouse: s(raw.Plant || raw.StorageLocation),
    status: raw.IsMarkedForDeletion ? 'discontinued' : 'active',
    created_at: s(raw.CreationDate) || now(), updated_at: now(),
  };
}

function mapSAPSupplier(raw: Record<string, unknown>, tenantId: string): CanonicalSupplier {
  return {
    id: crypto.randomUUID(), tenant_id: tenantId, source_system: 'sap',
    source_id: s(raw.Supplier || raw.BusinessPartner),
    name: s(raw.SupplierName || raw.BusinessPartnerFullName || raw.OrganizationBPName1),
    email: s(raw.EmailAddress), phone: s(raw.PhoneNumber),
    address: s(raw.StreetName), city: s(raw.CityName), country: s(raw.Country),
    tax_number: s(raw.TaxNumber1),
    supplier_group: s(raw.SupplierAccountGroup || raw.PurchasingOrganization),
    payment_terms: s(raw.PaymentTerms),
    currency: s(raw.Currency || 'ZAR'),
    status: raw.DeletionIndicator ? 'inactive' : 'active',
    created_at: s(raw.CreationDate) || now(), updated_at: now(),
  };
}

function mapSAPPurchaseOrder(raw: Record<string, unknown>, tenantId: string): CanonicalPurchaseOrder {
  return {
    id: crypto.randomUUID(), tenant_id: tenantId, source_system: 'sap',
    source_id: s(raw.PurchaseOrder || raw.PurchasingDocument),
    po_number: s(raw.PurchaseOrder || raw.PurchasingDocument),
    supplier_id: s(raw.Supplier),
    supplier_name: s(raw.SupplierName || raw.SupplierAddressName),
    order_date: s(raw.PurchaseOrderDate || raw.DocumentDate),
    delivery_date: s(raw.DeliveryDate),
    currency: s(raw.DocumentCurrency || 'ZAR'),
    subtotal: n(raw.NetAmount), tax: n(raw.TaxAmount), total: n(raw.GrossAmount),
    status: s(raw.PurchasingDocumentDeletionCode ? 'cancelled' : (raw.Status || 'open')),
    line_items: JSON.stringify(raw.to_PurchaseOrderItem || []),
    created_at: s(raw.CreationDate) || now(), updated_at: now(),
  };
}

// ═══ Xero Mappers ═══

function mapXeroCustomer(raw: Record<string, unknown>, tenantId: string): CanonicalCustomer {
  const addresses = raw.Addresses as Array<Record<string, unknown>> | undefined;
  const addr = addresses?.[0] || {};
  const phones = raw.Phones as Array<Record<string, unknown>> | undefined;
  const phone = phones?.find((p: Record<string, unknown>) => p.PhoneType === 'DEFAULT') || phones?.[0] || {};
  return {
    id: crypto.randomUUID(), tenant_id: tenantId, source_system: 'xero',
    source_id: s(raw.ContactID),
    name: s(raw.Name),
    email: s(raw.EmailAddress),
    phone: `${s(phone.PhoneCountryCode)}${s(phone.PhoneAreaCode)}${s(phone.PhoneNumber)}`.trim(),
    address: `${s(addr.AddressLine1)} ${s(addr.AddressLine2)}`.trim(),
    city: s(addr.City), country: s(addr.Country),
    tax_number: s(raw.TaxNumber),
    customer_group: s(raw.ContactGroups ? 'grouped' : 'default'),
    credit_limit: 0, outstanding_balance: n(raw.AccountsReceivableOutstanding || raw.BalancesAccountsReceivableOutstanding),
    payment_terms: s((raw.PaymentTerms as Record<string, unknown>)?.Sales) || '',
    currency: s(raw.DefaultCurrency || 'ZAR'),
    status: s(raw.ContactStatus) === 'ARCHIVED' ? 'inactive' : 'active',
    created_at: s(raw.UpdatedDateUTC) || now(), updated_at: now(),
  };
}

function mapXeroInvoice(raw: Record<string, unknown>, tenantId: string): CanonicalInvoice {
  const contact = raw.Contact as Record<string, unknown> | undefined;
  return {
    id: crypto.randomUUID(), tenant_id: tenantId, source_system: 'xero',
    source_id: s(raw.InvoiceID),
    invoice_number: s(raw.InvoiceNumber),
    customer_id: s(contact?.ContactID),
    customer_name: s(contact?.Name),
    invoice_date: s(raw.DateString || raw.Date),
    due_date: s(raw.DueDateString || raw.DueDate),
    currency: s(raw.CurrencyCode || 'ZAR'),
    subtotal: n(raw.SubTotal), tax: n(raw.TotalTax), total: n(raw.Total),
    amount_paid: n(raw.AmountPaid), amount_due: n(raw.AmountDue),
    status: mapXeroInvoiceStatus(s(raw.Status)),
    line_items: JSON.stringify(raw.LineItems || []),
    created_at: s(raw.UpdatedDateUTC) || now(), updated_at: now(),
  };
}

function mapXeroInvoiceStatus(xeroStatus: string): string {
  const map: Record<string, string> = {
    DRAFT: 'draft', SUBMITTED: 'sent', AUTHORISED: 'sent',
    PAID: 'paid', VOIDED: 'cancelled', DELETED: 'cancelled',
  };
  return map[xeroStatus] || 'draft';
}

function mapXeroProduct(raw: Record<string, unknown>, tenantId: string): CanonicalProduct {
  return {
    id: crypto.randomUUID(), tenant_id: tenantId, source_system: 'xero',
    source_id: s(raw.ItemID),
    sku: s(raw.Code), name: s(raw.Name),
    description: s(raw.Description),
    category: '',
    unit_price: n((raw.SalesDetails as Record<string, unknown>)?.UnitPrice),
    cost_price: n((raw.PurchaseDetails as Record<string, unknown>)?.UnitPrice),
    currency: 'ZAR',
    quantity_on_hand: n(raw.QuantityOnHand),
    reorder_level: 0, warehouse: '',
    status: raw.IsTrackedAsInventory ? 'active' : 'active',
    created_at: s(raw.UpdatedDateUTC) || now(), updated_at: now(),
  };
}

// ═══ Sage Mappers ═══

function mapSageCustomer(raw: Record<string, unknown>, tenantId: string): CanonicalCustomer {
  const mainAddr = raw.main_address as Record<string, unknown> | undefined;
  return {
    id: crypto.randomUUID(), tenant_id: tenantId, source_system: 'sage',
    source_id: s(raw.id),
    name: s(raw.displayed_as || raw.name),
    email: s(raw.email),
    phone: s(raw.telephone || raw.mobile),
    address: `${s(mainAddr?.address_line_1)} ${s(mainAddr?.address_line_2)}`.trim(),
    city: s(mainAddr?.city), country: s((mainAddr?.country as Record<string, unknown> | undefined)?.displayed_as),
    tax_number: s(raw.tax_number),
    customer_group: s((raw.contact_type as Record<string, unknown> | undefined)?.displayed_as) || 'customer',
    credit_limit: n(raw.credit_limit), outstanding_balance: n(raw.balance),
    payment_terms: s(raw.credit_days) ? `Net ${raw.credit_days}` : '',
    currency: s((raw.currency as Record<string, unknown> | undefined)?.code || 'ZAR'),
    status: 'active',
    created_at: s(raw.created_at) || now(), updated_at: now(),
  };
}

function mapSageInvoice(raw: Record<string, unknown>, tenantId: string): CanonicalInvoice {
  const contact = raw.contact as Record<string, unknown> | undefined;
  return {
    id: crypto.randomUUID(), tenant_id: tenantId, source_system: 'sage',
    source_id: s(raw.id),
    invoice_number: s(raw.displayed_as || raw.reference),
    customer_id: s(contact?.id),
    customer_name: s(contact?.displayed_as),
    invoice_date: s(raw.date), due_date: s(raw.due_date),
    currency: s((raw.currency as Record<string, unknown> | undefined)?.code || 'ZAR'),
    subtotal: n(raw.net_amount), tax: n(raw.tax_amount), total: n(raw.total_amount),
    amount_paid: n(raw.total_paid), amount_due: n(raw.outstanding_amount),
    status: s(raw.status) === 'PAID' ? 'paid' : s(raw.status) === 'VOID' ? 'cancelled' : 'sent',
    line_items: JSON.stringify(raw.invoice_lines || []),
    created_at: s(raw.created_at) || now(), updated_at: now(),
  };
}

// ═══ Dynamics 365 Mapper ═══

function mapDynamicsCustomer(raw: Record<string, unknown>, tenantId: string): CanonicalCustomer {
  return {
    id: crypto.randomUUID(), tenant_id: tenantId, source_system: 'dynamics365',
    source_id: s(raw.id),
    name: s(raw.displayName),
    email: s(raw.email),
    phone: s(raw.phoneNumber),
    address: `${s(raw.addressLine1)} ${s(raw.addressLine2)}`.trim(),
    city: s(raw.city), country: s(raw.country),
    tax_number: s(raw.taxRegistrationNumber),
    customer_group: '',
    credit_limit: n(raw.creditLimit), outstanding_balance: n(raw.balance),
    payment_terms: s(raw.paymentTermsId),
    currency: s(raw.currencyCode || 'ZAR'),
    status: raw.blocked ? 'inactive' : 'active',
    created_at: s(raw.lastModifiedDateTime) || now(), updated_at: now(),
  };
}

// ═══ NetSuite Mapper ═══

function mapNetSuiteCustomer(raw: Record<string, unknown>, tenantId: string): CanonicalCustomer {
  return {
    id: crypto.randomUUID(), tenant_id: tenantId, source_system: 'netsuite',
    source_id: s(raw.id),
    name: s(raw.companyName || raw.entityId),
    email: s(raw.email),
    phone: s(raw.phone),
    address: s(raw.defaultAddress),
    city: '', country: '',
    tax_number: s(raw.taxIdNum),
    customer_group: s((raw.category as Record<string, unknown> | undefined)?.refName),
    credit_limit: n(raw.creditLimit), outstanding_balance: n(raw.balance),
    payment_terms: s((raw.terms as Record<string, unknown> | undefined)?.refName),
    currency: s((raw.currency as Record<string, unknown> | undefined)?.refName || 'ZAR'),
    status: raw.isInactive ? 'inactive' : 'active',
    created_at: s(raw.dateCreated) || now(), updated_at: now(),
  };
}

// ═══ QuickBooks Mappers ═══

function mapQuickBooksCustomer(raw: Record<string, unknown>, tenantId: string): CanonicalCustomer {
  const billAddr = raw.BillAddr as Record<string, unknown> | undefined;
  const primaryPhone = raw.PrimaryPhone as Record<string, unknown> | undefined;
  const primaryEmail = raw.PrimaryEmailAddr as Record<string, unknown> | undefined;
  return {
    id: crypto.randomUUID(), tenant_id: tenantId, source_system: 'quickbooks',
    source_id: s(raw.Id),
    name: s(raw.DisplayName || raw.CompanyName),
    email: s(primaryEmail?.Address || raw.PrimaryEmailAddr),
    phone: s(primaryPhone?.FreeFormNumber),
    address: `${s(billAddr?.Line1)} ${s(billAddr?.Line2)}`.trim(),
    city: s(billAddr?.City), country: s(billAddr?.Country),
    tax_number: s(raw.PrimaryTaxIdentifier),
    customer_group: s(raw.Job ? 'job' : 'customer'),
    credit_limit: 0, outstanding_balance: n(raw.Balance),
    payment_terms: s((raw.SalesTermRef as Record<string, unknown>)?.name),
    currency: s((raw.CurrencyRef as Record<string, unknown>)?.value || 'USD'),
    status: raw.Active === false ? 'inactive' : 'active',
    created_at: s(raw.MetaData && (raw.MetaData as Record<string, unknown>).CreateTime) || now(),
    updated_at: now(),
  };
}

function mapQuickBooksInvoice(raw: Record<string, unknown>, tenantId: string): CanonicalInvoice {
  const customerRef = raw.CustomerRef as Record<string, unknown> | undefined;
  return {
    id: crypto.randomUUID(), tenant_id: tenantId, source_system: 'quickbooks',
    source_id: s(raw.Id),
    invoice_number: s(raw.DocNumber),
    customer_id: s(customerRef?.value),
    customer_name: s(customerRef?.name),
    invoice_date: s(raw.TxnDate), due_date: s(raw.DueDate),
    currency: s((raw.CurrencyRef as Record<string, unknown>)?.value || 'USD'),
    subtotal: n(raw.TotalAmt) - n(raw.TxnTaxDetail && (raw.TxnTaxDetail as Record<string, unknown>).TotalTax),
    tax: n(raw.TxnTaxDetail && (raw.TxnTaxDetail as Record<string, unknown>).TotalTax),
    total: n(raw.TotalAmt),
    amount_paid: n(raw.TotalAmt) - n(raw.Balance),
    amount_due: n(raw.Balance),
    status: n(raw.Balance) === 0 ? 'paid' : 'sent',
    line_items: JSON.stringify(raw.Line || []),
    created_at: s(raw.MetaData && (raw.MetaData as Record<string, unknown>).CreateTime) || now(),
    updated_at: now(),
  };
}

// ═══ Salesforce Mapper ═══

function mapSalesforceCustomer(raw: Record<string, unknown>, tenantId: string): CanonicalCustomer {
  const billing = raw.BillingAddress as Record<string, unknown> | undefined;
  return {
    id: crypto.randomUUID(), tenant_id: tenantId, source_system: 'salesforce',
    source_id: s(raw.Id),
    name: s(raw.Name),
    email: s(raw.Email || raw.PersonEmail),
    phone: s(raw.Phone),
    address: `${s(billing?.street)}`.trim(),
    city: s(billing?.city), country: s(billing?.country),
    tax_number: '',
    customer_group: s(raw.Type || 'customer'),
    credit_limit: 0, outstanding_balance: 0,
    payment_terms: '', currency: s(raw.CurrencyIsoCode || 'USD'),
    status: raw.IsDeleted ? 'inactive' : 'active',
    created_at: s(raw.CreatedDate) || now(), updated_at: now(),
  };
}

// ═══ Oracle Fusion Mapper ═══

function mapOracleCustomer(raw: Record<string, unknown>, tenantId: string): CanonicalCustomer {
  return {
    id: crypto.randomUUID(), tenant_id: tenantId, source_system: 'oracle',
    source_id: s(raw.PartyId || raw.PartyNumber),
    name: s(raw.PartyName || raw.OrganizationName),
    email: s(raw.EmailAddress),
    phone: s(raw.PhoneNumber),
    address: s(raw.Address1 || raw.FormattedAddress),
    city: s(raw.City), country: s(raw.Country),
    tax_number: s(raw.TaxpayerIdentificationNumber),
    customer_group: s(raw.CustomerClassCode),
    credit_limit: n(raw.CreditLimit), outstanding_balance: n(raw.OpenBalance),
    payment_terms: s(raw.PaymentTerms),
    currency: s(raw.CurrencyCode || 'USD'),
    status: s(raw.Status) === 'I' ? 'inactive' : 'active',
    created_at: s(raw.CreationDate) || now(), updated_at: now(),
  };
}

// ═══ Workday Mapper ═══

function mapWorkdayCustomer(raw: Record<string, unknown>, tenantId: string): CanonicalCustomer {
  return {
    id: crypto.randomUUID(), tenant_id: tenantId, source_system: 'workday',
    source_id: s(raw.id || raw.descriptor),
    name: s(raw.customerName || raw.descriptor),
    email: s(raw.emailAddress),
    phone: s(raw.phoneNumber),
    address: s(raw.addressLine1),
    city: s(raw.city), country: s(raw.country),
    tax_number: s(raw.taxID),
    customer_group: s(raw.customerGroup),
    credit_limit: n(raw.creditLimit), outstanding_balance: n(raw.accountBalance),
    payment_terms: s(raw.paymentTerms),
    currency: s(raw.currency || 'USD'),
    status: raw.inactive ? 'inactive' : 'active',
    created_at: now(), updated_at: now(),
  };
}

// ═══ Pastel Mapper ═══

function mapPastelCustomer(raw: Record<string, unknown>, tenantId: string): CanonicalCustomer {
  return {
    id: crypto.randomUUID(), tenant_id: tenantId, source_system: 'pastel',
    source_id: s(raw.AccountCode || raw.Id),
    name: s(raw.Name || raw.Description),
    email: s(raw.Email || raw.EmailAddress),
    phone: s(raw.Telephone || raw.Phone),
    address: `${s(raw.Physical1)} ${s(raw.Physical2)}`.trim(),
    city: s(raw.Physical3 || raw.City), country: s(raw.Country || 'ZA'),
    tax_number: s(raw.TaxNumber || raw.VATNumber),
    customer_group: s(raw.Category || 'default'),
    credit_limit: n(raw.CreditLimit), outstanding_balance: n(raw.Balance || raw.CurrentBalance),
    payment_terms: s(raw.Terms || raw.PaymentTerms),
    currency: 'ZAR',
    status: raw.Inactive ? 'inactive' : 'active',
    created_at: now(), updated_at: now(),
  };
}

// ═══ Odoo Mappers ═══

function mapOdooCustomer(raw: Record<string, unknown>, tenantId: string): CanonicalCustomer {
  return {
    id: crypto.randomUUID(), tenant_id: tenantId, source_system: 'odoo',
    source_id: s(raw.id),
    name: s(raw.name || raw.display_name),
    email: s(raw.email),
    phone: s(raw.phone || raw.mobile),
    address: `${s(raw.street)} ${s(raw.street2)}`.trim(),
    city: s(raw.city), country: s(raw.country_id ? (raw.country_id as unknown[])[1] : ''),
    tax_number: s(raw.vat),
    customer_group: s(raw.category_id ? 'categorised' : 'default'),
    credit_limit: n(raw.credit_limit), outstanding_balance: n(raw.total_due),
    payment_terms: s(raw.property_payment_term_id ? (raw.property_payment_term_id as unknown[])[1] : ''),
    currency: s(raw.currency_id ? (raw.currency_id as unknown[])[1] : 'ZAR'),
    status: raw.active === false ? 'inactive' : 'active',
    created_at: s(raw.create_date) || now(), updated_at: s(raw.write_date) || now(),
  };
}

function mapOdooSupplier(raw: Record<string, unknown>, tenantId: string): CanonicalSupplier {
  return {
    id: crypto.randomUUID(), tenant_id: tenantId, source_system: 'odoo',
    source_id: s(raw.id),
    name: s(raw.name || raw.display_name),
    email: s(raw.email),
    phone: s(raw.phone || raw.mobile),
    address: `${s(raw.street)} ${s(raw.street2)}`.trim(),
    city: s(raw.city), country: s(raw.country_id ? (raw.country_id as unknown[])[1] : ''),
    tax_number: s(raw.vat),
    supplier_group: s(raw.category_id ? 'categorised' : 'default'),
    payment_terms: s(raw.property_supplier_payment_term_id ? (raw.property_supplier_payment_term_id as unknown[])[1] : ''),
    currency: s(raw.currency_id ? (raw.currency_id as unknown[])[1] : 'ZAR'),
    status: raw.active === false ? 'inactive' : 'active',
    created_at: s(raw.create_date) || now(), updated_at: s(raw.write_date) || now(),
  };
}

function mapOdooInvoice(raw: Record<string, unknown>, tenantId: string): CanonicalInvoice {
  const partner = raw.partner_id as unknown[] | undefined;
  const moveType = s(raw.move_type);
  const state = s(raw.state);
  let status = 'draft';
  if (state === 'posted') status = 'sent';
  if (state === 'cancel') status = 'cancelled';
  if (s(raw.payment_state) === 'paid' || s(raw.payment_state) === 'in_payment') status = 'paid';
  return {
    id: crypto.randomUUID(), tenant_id: tenantId, source_system: 'odoo',
    source_id: s(raw.id),
    invoice_number: s(raw.name || raw.ref),
    customer_id: s(partner ? partner[0] : ''),
    customer_name: s(partner ? partner[1] : ''),
    invoice_date: s(raw.invoice_date || raw.date),
    due_date: s(raw.invoice_date_due),
    currency: s(raw.currency_id ? (raw.currency_id as unknown[])[1] : 'ZAR'),
    subtotal: n(raw.amount_untaxed), tax: n(raw.amount_tax), total: n(raw.amount_total),
    amount_paid: n(raw.amount_total) - n(raw.amount_residual),
    amount_due: n(raw.amount_residual),
    status: moveType.includes('refund') ? 'cancelled' : status,
    line_items: JSON.stringify(raw.invoice_line_ids || []),
    created_at: s(raw.create_date) || now(), updated_at: s(raw.write_date) || now(),
  };
}

function mapOdooProduct(raw: Record<string, unknown>, tenantId: string): CanonicalProduct {
  return {
    id: crypto.randomUUID(), tenant_id: tenantId, source_system: 'odoo',
    source_id: s(raw.id),
    sku: s(raw.default_code || raw.barcode),
    name: s(raw.name || raw.display_name),
    description: s(raw.description_sale || raw.description),
    category: s(raw.categ_id ? (raw.categ_id as unknown[])[1] : ''),
    unit_price: n(raw.list_price), cost_price: n(raw.standard_price),
    currency: s(raw.currency_id ? (raw.currency_id as unknown[])[1] : 'ZAR'),
    quantity_on_hand: n(raw.qty_available),
    reorder_level: n(raw.reordering_min_qty),
    warehouse: s(raw.warehouse_id ? (raw.warehouse_id as unknown[])[1] : ''),
    status: raw.active === false ? 'discontinued' : 'active',
    created_at: s(raw.create_date) || now(), updated_at: s(raw.write_date) || now(),
  };
}

function mapOdooPurchaseOrder(raw: Record<string, unknown>, tenantId: string): CanonicalPurchaseOrder {
  const partner = raw.partner_id as unknown[] | undefined;
  return {
    id: crypto.randomUUID(), tenant_id: tenantId, source_system: 'odoo',
    source_id: s(raw.id),
    po_number: s(raw.name),
    supplier_id: s(partner ? partner[0] : ''),
    supplier_name: s(partner ? partner[1] : ''),
    order_date: s(raw.date_order),
    delivery_date: s(raw.date_planned),
    currency: s(raw.currency_id ? (raw.currency_id as unknown[])[1] : 'ZAR'),
    subtotal: n(raw.amount_untaxed), tax: n(raw.amount_tax), total: n(raw.amount_total),
    status: s(raw.state) === 'cancel' ? 'cancelled' : s(raw.state) || 'draft',
    line_items: JSON.stringify(raw.order_line || []),
    created_at: s(raw.create_date) || now(), updated_at: s(raw.write_date) || now(),
  };
}

// ═══ Unified mapRecord Function ═══

type CanonicalRecord = CanonicalCustomer | CanonicalSupplier | CanonicalInvoice
  | CanonicalProduct | CanonicalPurchaseOrder | CanonicalGLAccount | CanonicalEmployee;

type EntityType = 'customers' | 'contacts' | 'suppliers' | 'vendors'
  | 'invoices' | 'sales_invoices' | 'purchase_invoices'
  | 'products' | 'items' | 'stock_items' | 'inventory'
  | 'purchase_orders'
  | 'gl_accounts' | 'accounts' | 'ledger_accounts'
  | 'employees';

/**
 * Extract the vendor-specific "company" identifier from a raw source record.
 * Returns undefined when the record has no discernible company field, which
 * callers should treat as "map to the tenant's __primary__ company" (see
 * resolveCompanyId in erp-connector.ts).
 *
 * Per-vendor fields (matches PR spec):
 *   SAP S/4HANA        → BUKRS (company code)
 *   Odoo               → company_id (int or [id,name] tuple)
 *   Xero               → TenantId / OrganisationID
 *   Sage Business Cloud→ business_id / organisation_id
 *   Sage Pastel        → CompanyDatabase / CompanyName
 *   Salesforce         → (no native multi-company) → undefined
 *   Workday            → Company_Reference.ID
 *   Oracle Fusion      → BusinessUnitId / LedgerId
 *   Oracle NetSuite    → subsidiary.id / subsidiary (internal id)
 *   MS Dynamics 365    → companyid (GUID)
 *   QuickBooks Online  → realm id is connection-level → undefined
 */
export function extractCompanyKey(
  system: string,
  raw: Record<string, unknown>,
): string | undefined {
  const sys = system.toLowerCase().replace(/[\s_-]/g, '');

  const asKey = (v: unknown): string | undefined => {
    if (v === null || v === undefined) return undefined;
    const str = String(v).trim();
    return str === '' || str === 'false' ? undefined : str;
  };

  // ── SAP S/4HANA ── BUKRS is the 4-char company code.
  if (sys.includes('sap')) {
    return asKey(raw.BUKRS)
      ?? asKey(raw.CompanyCode)
      ?? asKey(raw.CompanyCodeID)
      ?? asKey((raw.CompanyCode as Record<string, unknown>)?.CompanyCode)
      ?? undefined;
  }

  // ── Odoo ── company_id may be an int or a [id, name] tuple.
  if (sys.includes('odoo')) {
    const c = raw.company_id;
    if (Array.isArray(c) && c.length > 0) return asKey(c[0]);
    return asKey(c);
  }

  // ── Xero ── Xero returns records scoped to a TenantId header; some
  // envelopes include it on the record itself.
  if (sys.includes('xero')) {
    return asKey(raw.TenantId)
      ?? asKey(raw.OrganisationID)
      ?? asKey(raw.OrganizationID)
      ?? undefined;
  }

  // ── Dynamics 365 ── Business Central scopes by companyid GUID.
  if (sys.includes('dynamics') || sys.includes('d365') || sys.includes('businesscentral')) {
    return asKey(raw.companyId)
      ?? asKey(raw.companyid)
      ?? asKey(raw.company_id)
      ?? asKey(raw.companyName)
      ?? undefined;
  }

  // ── NetSuite ── subsidiary is the multi-company handle.
  if (sys.includes('netsuite')) {
    const sub = raw.subsidiary as Record<string, unknown> | string | number | undefined;
    if (sub && typeof sub === 'object') {
      return asKey((sub as Record<string, unknown>).id)
        ?? asKey((sub as Record<string, unknown>).internalId)
        ?? asKey((sub as Record<string, unknown>).refName);
    }
    return asKey(sub);
  }

  // ── Oracle Fusion ── BusinessUnit or Ledger is the multi-entity boundary.
  if (sys.includes('oracle') && !sys.includes('netsuite')) {
    return asKey(raw.BusinessUnitId)
      ?? asKey(raw.BusinessUnit)
      ?? asKey(raw.LedgerId)
      ?? asKey(raw.Ledger)
      ?? undefined;
  }

  // ── Workday ── Company_Reference → ID (nested object in REST responses).
  if (sys.includes('workday')) {
    const ref = raw.Company_Reference as Record<string, unknown> | undefined;
    if (ref) return asKey(ref.ID) ?? asKey(ref.WID);
    return asKey(raw.companyID) ?? asKey(raw.company);
  }

  // ── Sage Business Cloud ──
  if (sys.includes('sage') && !sys.includes('pastel')) {
    return asKey(raw.business_id)
      ?? asKey(raw.organisation_id)
      ?? asKey(raw.organization_id)
      ?? asKey((raw.business as Record<string, unknown> | undefined)?.id)
      ?? undefined;
  }

  // ── Sage Pastel ── Company database name, typically under CompanyDatabase
  // or CompanyName on each record when the adapter queries a named company.
  if (sys.includes('pastel')) {
    return asKey(raw.CompanyDatabase)
      ?? asKey(raw.CompanyName)
      ?? asKey(raw.Company)
      ?? undefined;
  }

  // ── Salesforce ── No native multi-company. Callers should fall back to
  // the connection-level AccountId (if syncing a specific BU) or primary.
  // ── QuickBooks ── realm id lives on the connection, not the record.
  return undefined;
}

/**
 * Optional resolution context passed to mapRecord when the caller has
 * already resolved the canonical company_id (via resolveCompanyId).
 */
export interface MapRecordContext {
  /** erp_companies.id; written straight onto the canonical row. */
  companyId?: string;
}

/**
 * Map a single raw ERP record to a canonical record.
 * Returns null if the combination of system + entityType has no mapper.
 *
 * When `ctx.companyId` is provided it is stamped onto the output so the
 * generic INSERT writer in routes/erp.ts picks `company_id` up via
 * `Object.keys(mappedObj)`.
 */
export function mapRecord(
  system: string, entityType: string, raw: Record<string, unknown>, tenantId: string,
  ctx?: MapRecordContext,
): CanonicalRecord | null {
  const sys = system.toLowerCase().replace(/[\s_-]/g, '');
  const et = entityType.toLowerCase() as EntityType;

  let mapped: CanonicalRecord | null = null;

  // ── SAP ──
  if (!mapped && sys.includes('sap')) {
    if (['customers', 'contacts', 'business_partners', 'accounts'].includes(et)) mapped = mapSAPCustomer(raw, tenantId);
    else if (['suppliers', 'vendors'].includes(et)) mapped = mapSAPSupplier(raw, tenantId);
    else if (['invoices', 'sales_invoices', 'sales_orders'].includes(et)) mapped = mapSAPInvoice(raw, tenantId);
    else if (['products', 'items', 'materials'].includes(et)) mapped = mapSAPProduct(raw, tenantId);
    else if (['purchase_orders'].includes(et)) mapped = mapSAPPurchaseOrder(raw, tenantId);
  }

  // ── Xero ──
  if (!mapped && sys.includes('xero')) {
    if (['customers', 'contacts'].includes(et)) mapped = mapXeroCustomer(raw, tenantId);
    else if (['invoices', 'sales_invoices'].includes(et)) mapped = mapXeroInvoice(raw, tenantId);
    else if (['products', 'items'].includes(et)) mapped = mapXeroProduct(raw, tenantId);
  }

  // ── Sage ──
  if (!mapped && sys.includes('sage') && !sys.includes('pastel')) {
    if (['customers', 'contacts'].includes(et)) mapped = mapSageCustomer(raw, tenantId);
    else if (['invoices', 'sales_invoices', 'purchase_invoices'].includes(et)) mapped = mapSageInvoice(raw, tenantId);
  }

  // ── Dynamics 365 ──
  if (!mapped && (sys.includes('dynamics') || sys.includes('d365') || sys.includes('businesscentral'))) {
    if (['customers', 'contacts'].includes(et)) mapped = mapDynamicsCustomer(raw, tenantId);
  }

  // ── NetSuite ──
  if (!mapped && sys.includes('netsuite')) {
    if (['customers', 'contacts'].includes(et)) mapped = mapNetSuiteCustomer(raw, tenantId);
  }

  // ── QuickBooks ──
  if (!mapped && (sys.includes('quickbooks') || sys.includes('qbo'))) {
    if (['customers', 'contacts'].includes(et)) mapped = mapQuickBooksCustomer(raw, tenantId);
    else if (['invoices', 'sales_invoices'].includes(et)) mapped = mapQuickBooksInvoice(raw, tenantId);
  }

  // ── Salesforce ──
  if (!mapped && (sys.includes('salesforce') || sys.includes('sfdc'))) {
    if (['customers', 'contacts', 'accounts'].includes(et)) mapped = mapSalesforceCustomer(raw, tenantId);
  }

  // ── Oracle ──
  if (!mapped && sys.includes('oracle') && !sys.includes('netsuite')) {
    if (['customers', 'contacts'].includes(et)) mapped = mapOracleCustomer(raw, tenantId);
  }

  // ── Workday ──
  if (!mapped && sys.includes('workday')) {
    if (['customers', 'contacts'].includes(et)) mapped = mapWorkdayCustomer(raw, tenantId);
  }

  // ── Pastel ──
  if (!mapped && sys.includes('pastel')) {
    if (['customers', 'contacts'].includes(et)) mapped = mapPastelCustomer(raw, tenantId);
  }

  // ── Odoo ──
  if (!mapped && sys.includes('odoo')) {
    if (['customers', 'contacts'].includes(et)) mapped = mapOdooCustomer(raw, tenantId);
    else if (['suppliers', 'vendors'].includes(et)) mapped = mapOdooSupplier(raw, tenantId);
    else if (['invoices', 'sales_invoices'].includes(et)) mapped = mapOdooInvoice(raw, tenantId);
    else if (['products', 'items'].includes(et)) mapped = mapOdooProduct(raw, tenantId);
    else if (['purchase_orders'].includes(et)) mapped = mapOdooPurchaseOrder(raw, tenantId);
  }

  if (mapped && ctx?.companyId) {
    mapped.company_id = ctx.companyId;
  }
  return mapped;
}

/**
 * Determine the canonical table name for a given entity type.
 */
export function canonicalTableName(entityType: string): string | null {
  const et = entityType.toLowerCase();
  if (['customers', 'contacts', 'accounts', 'business_partners'].includes(et)) return 'erp_customers';
  if (['suppliers', 'vendors'].includes(et)) return 'erp_suppliers';
  if (['invoices', 'sales_invoices', 'purchase_invoices', 'sales_orders'].includes(et)) return 'erp_invoices';
  if (['products', 'items', 'stock_items', 'inventory', 'materials'].includes(et)) return 'erp_products';
  if (['purchase_orders'].includes(et)) return 'erp_purchase_orders';
  if (['gl_accounts', 'ledger_accounts', 'gl_journals'].includes(et)) return 'erp_gl_accounts';
  if (['employees', 'workers'].includes(et)) return 'erp_employees';
  return null;
}
