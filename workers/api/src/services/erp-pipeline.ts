/**
 * SPEC-008: ERP Data Pipeline — Real Data Flow
 * End-to-end Xero connector with OAuth, sync dashboard, and data mapping.
 */

export interface ERPSyncStatus {
  connectionId: string;
  tenantId: string;
  system: string;
  status: 'idle' | 'syncing' | 'completed' | 'failed' | 'partial';
  lastSyncAt?: string;
  nextSyncAt?: string;
  recordsSynced: number;
  recordsFailed: number;
  entities: EntitySyncStatus[];
  errors: string[];
  duration?: number;
}

export interface EntitySyncStatus {
  type: string;
  count: number;
  synced: number;
  failed: number;
  lastSyncAt?: string;
}

/** Xero OAuth 2.0 configuration */
export interface XeroOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

/** Default Xero scopes for read access */
export const XERO_SCOPES = [
  'openid',
  'profile',
  'email',
  'accounting.transactions.read',
  'accounting.contacts.read',
  'accounting.settings.read',
  'accounting.reports.read',
  'accounting.journals.read',
  'accounting.attachments.read',
];

/** Xero entity types that can be synced */
export const XERO_ENTITY_TYPES = [
  'accounts',
  'contacts',
  'invoices',
  'credit_notes',
  'bank_transactions',
  'payments',
  'journals',
  'items',
  'purchase_orders',
  'quotes',
] as const;

/** Build Xero OAuth authorization URL */
export function buildXeroAuthUrl(config: XeroOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scopes.join(' '),
    state,
  });
  return `https://login.xero.com/identity/connect/authorize?${params.toString()}`;
}

/** Exchange Xero auth code for tokens */
export async function exchangeXeroCode(
  config: XeroOAuthConfig,
  code: string,
): Promise<{ access_token: string; refresh_token: string; expires_in: number; id_token?: string }> {
  const resp = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Xero token exchange failed: ${resp.status} ${err}`);
  }

  return resp.json();
}

/** Refresh Xero access token */
export async function refreshXeroToken(
  config: XeroOAuthConfig,
  refreshToken: string,
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const resp = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Xero token refresh failed: ${resp.status} ${err}`);
  }

  return resp.json();
}

/** Map Xero entity data to canonical Atheon format */
export function mapXeroEntity(entityType: string, data: Record<string, unknown>): Record<string, unknown> {
  switch (entityType) {
    case 'contacts':
      return {
        source_id: data.ContactID,
        name: data.Name,
        email: data.EmailAddress,
        phone: (data.Phones as Array<Record<string, string>>)?.[0]?.PhoneNumber,
        type: data.IsCustomer ? 'customer' : data.IsSupplier ? 'supplier' : 'other',
        tax_number: data.TaxNumber,
        status: data.ContactStatus,
        currency: data.DefaultCurrency,
        updated_at: data.UpdatedDateUTC,
      };

    case 'invoices':
      return {
        source_id: data.InvoiceID,
        number: data.InvoiceNumber,
        type: data.Type, // ACCREC or ACCPAY
        contact_id: (data.Contact as Record<string, unknown>)?.ContactID,
        contact_name: (data.Contact as Record<string, unknown>)?.Name,
        date: data.Date,
        due_date: data.DueDate,
        status: data.Status,
        currency: data.CurrencyCode,
        subtotal: data.SubTotal,
        tax_total: data.TotalTax,
        total: data.Total,
        amount_due: data.AmountDue,
        amount_paid: data.AmountPaid,
        line_items: data.LineItems,
        updated_at: data.UpdatedDateUTC,
      };

    case 'accounts':
      return {
        source_id: data.AccountID,
        code: data.Code,
        name: data.Name,
        type: data.Type,
        class: data.Class,
        status: data.Status,
        tax_type: data.TaxType,
        currency: data.CurrencyCode,
        description: data.Description,
        updated_at: data.UpdatedDateUTC,
      };

    case 'bank_transactions':
      return {
        source_id: data.BankTransactionID,
        type: data.Type,
        contact_id: (data.Contact as Record<string, unknown>)?.ContactID,
        date: data.Date,
        status: data.Status,
        subtotal: data.SubTotal,
        tax_total: data.TotalTax,
        total: data.Total,
        currency: data.CurrencyCode,
        reference: data.Reference,
        updated_at: data.UpdatedDateUTC,
      };

    case 'payments':
      return {
        source_id: data.PaymentID,
        date: data.Date,
        amount: data.Amount,
        currency: data.CurrencyCode,
        status: data.Status,
        payment_type: data.PaymentType,
        reference: data.Reference,
        invoice_id: (data.Invoice as Record<string, unknown>)?.InvoiceID,
        updated_at: data.UpdatedDateUTC,
      };

    default:
      return { source_id: (data as Record<string, unknown>)[`${entityType}ID`] || crypto.randomUUID(), ...data };
  }
}

/** Sync dashboard data aggregation */
export async function getSyncDashboard(db: D1Database, tenantId: string): Promise<{
  connections: ERPSyncStatus[];
  totalRecords: number;
  lastSyncAt?: string;
  healthScore: number;
}> {
  const connections = await db.prepare(
    'SELECT ec.*, ea.system as adapter_system FROM erp_connections ec JOIN erp_adapters ea ON ec.adapter_id = ea.id WHERE ec.tenant_id = ?'
  ).bind(tenantId).all();

  let totalRecords = 0;
  let latestSync: string | undefined;
  let healthyConnections = 0;

  const statuses: ERPSyncStatus[] = (connections.results || []).map((conn: Record<string, unknown>) => {
    const records = (conn.records_synced as number) || 0;
    totalRecords += records;
    const lastSync = conn.last_sync as string | undefined;
    if (lastSync && (!latestSync || lastSync > latestSync)) latestSync = lastSync;
    if (conn.status === 'connected') healthyConnections++;

    return {
      connectionId: conn.id as string,
      tenantId,
      system: conn.adapter_system as string,
      status: conn.status === 'connected' ? 'completed' : conn.status === 'error' ? 'failed' : 'idle',
      lastSyncAt: lastSync,
      recordsSynced: records,
      recordsFailed: 0,
      entities: [],
      errors: [],
    } as ERPSyncStatus;
  });

  const total = statuses.length || 1;
  const healthScore = Math.round((healthyConnections / total) * 100);

  return { connections: statuses, totalRecords, lastSyncAt: latestSync, healthScore };
}
