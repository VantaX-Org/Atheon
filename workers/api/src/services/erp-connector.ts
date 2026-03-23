/**
 * ERP Connector Service
 * Real OAuth flows, connection testing, and data sync for SAP, Salesforce, Workday, Oracle, Xero, Sage, Pastel
 */

export interface ERPCredentials {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  authUrl?: string;
  tokenUrl?: string;
  scope?: string;
  apiKey?: string;
  username?: string;
  password?: string;
}

export interface ERPTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export interface SyncResult {
  recordsSynced: number;
  recordsFailed: number;
  duration: number;
  entities: { type: string; count: number; records: Record<string, unknown>[] }[];
  errors: string[];
}

interface ERPAdapter {
  name: string;
  getAuthUrl(credentials: ERPCredentials, state: string): string;
  exchangeToken(credentials: ERPCredentials, code: string): Promise<ERPTokenResponse>;
  testConnection(credentials: ERPCredentials, token: string): Promise<{ connected: boolean; version?: string; message: string }>;
  syncData(credentials: ERPCredentials, token: string, entities: string[]): Promise<SyncResult>;
}

// ── SAP S/4HANA Adapter ──
const sapAdapter: ERPAdapter = {
  name: 'SAP S/4HANA',

  getAuthUrl(credentials: ERPCredentials, state: string): string {
    const authUrl = credentials.authUrl || `${credentials.baseUrl}/sap/bc/sec/oauth2/authorize`;
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: credentials.clientId,
      redirect_uri: `${credentials.baseUrl}/oauth/callback`,
      scope: credentials.scope || 'API_BUSINESS_PARTNER_0001 API_SALES_ORDER_SRV',
      state,
    });
    return `${authUrl}?${params}`;
  },

  async exchangeToken(credentials: ERPCredentials, code: string): Promise<ERPTokenResponse> {
    const tokenUrl = credentials.tokenUrl || `${credentials.baseUrl}/sap/bc/sec/oauth2/token`;
    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${credentials.baseUrl}/oauth/callback`,
      }),
    });
    if (!resp.ok) throw new Error(`SAP token exchange failed: ${resp.status}`);
    return resp.json();
  },

  async testConnection(credentials: ERPCredentials, token: string) {
    try {
      const resp = await fetch(`${credentials.baseUrl}/sap/opu/odata/sap/API_BUSINESS_PARTNER/$metadata`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/xml' },
      });
      return {
        connected: resp.ok,
        version: resp.headers.get('sap-metadata-version') || '2.0',
        message: resp.ok ? 'Connected to SAP S/4HANA OData API' : `Connection failed: ${resp.status}`,
      };
    } catch (err) {
      return { connected: false, message: `Connection error: ${(err as Error).message}` };
    }
  },

  async syncData(credentials: ERPCredentials, token: string, entities: string[]): Promise<SyncResult> {
    const start = Date.now();
    const result: SyncResult = { recordsSynced: 0, recordsFailed: 0, duration: 0, entities: [], errors: [] };
    const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };

    for (const entity of entities) {
      try {
        const apiMap: Record<string, string> = {
          'business_partners': '/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartner?$top=1000',
          'sales_orders': '/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder?$top=1000',
          'purchase_orders': '/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrder?$top=1000',
          'materials': '/sap/opu/odata/sap/API_PRODUCT_SRV/A_Product?$top=1000',
          'gl_accounts': '/sap/opu/odata/sap/API_JOURNALENTRYITEMBASIC_SRV/A_JournalEntryItemBasic?$top=1000',
        };
        const path = apiMap[entity] || `/sap/opu/odata/sap/${entity}?$top=1000`;
        const resp = await fetch(`${credentials.baseUrl}${path}`, { headers });
        if (resp.ok) {
          const data = await resp.json() as { d?: { results?: Record<string, unknown>[] }; value?: Record<string, unknown>[] };
          const rawRecords = data.d?.results || data.value || [];
          const count = rawRecords.length;
          result.recordsSynced += count;
          result.entities.push({ type: entity, count, records: rawRecords as Record<string, unknown>[] });
        } else {
          result.recordsFailed++;
          result.errors.push(`${entity}: HTTP ${resp.status}`);
        }
      } catch (err) {
        result.recordsFailed++;
        result.errors.push(`${entity}: ${(err as Error).message}`);
      }
    }

    result.duration = Date.now() - start;
    return result;
  },
};

// ── Salesforce Adapter ──
const salesforceAdapter: ERPAdapter = {
  name: 'Salesforce',

  getAuthUrl(credentials: ERPCredentials, state: string): string {
    const authUrl = credentials.authUrl || 'https://login.salesforce.com/services/oauth2/authorize';
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: credentials.clientId,
      redirect_uri: `${credentials.baseUrl}/oauth/callback`,
      scope: credentials.scope || 'api refresh_token',
      state,
    });
    return `${authUrl}?${params}`;
  },

  async exchangeToken(credentials: ERPCredentials, code: string): Promise<ERPTokenResponse> {
    const tokenUrl = credentials.tokenUrl || 'https://login.salesforce.com/services/oauth2/token';
    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        code,
        redirect_uri: `${credentials.baseUrl}/oauth/callback`,
      }),
    });
    if (!resp.ok) throw new Error(`Salesforce token exchange failed: ${resp.status}`);
    return resp.json();
  },

  async testConnection(credentials: ERPCredentials, token: string) {
    try {
      const resp = await fetch(`${credentials.baseUrl}/services/data/v59.0/`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (resp.ok) {
        const data = await resp.json() as { version?: string };
        return { connected: true, version: data.version || 'v59.0', message: 'Connected to Salesforce REST API' };
      }
      return { connected: false, message: `Connection failed: ${resp.status}` };
    } catch (err) {
      return { connected: false, message: `Connection error: ${(err as Error).message}` };
    }
  },

  async syncData(credentials: ERPCredentials, token: string, entities: string[]): Promise<SyncResult> {
    const start = Date.now();
    const result: SyncResult = { recordsSynced: 0, recordsFailed: 0, duration: 0, entities: [], errors: [] };
    const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };

    for (const entity of entities) {
      try {
        const soqlMap: Record<string, string> = {
          'accounts': 'SELECT Id,Name,Industry,BillingCity FROM Account LIMIT 1000',
          'contacts': 'SELECT Id,Name,Email,Phone FROM Contact LIMIT 1000',
          'opportunities': 'SELECT Id,Name,Amount,StageName,CloseDate FROM Opportunity LIMIT 1000',
          'leads': 'SELECT Id,Name,Company,Status FROM Lead LIMIT 1000',
          'cases': 'SELECT Id,Subject,Status,Priority FROM Case LIMIT 1000',
        };
        const soql = soqlMap[entity] || `SELECT Id,Name FROM ${entity} LIMIT 1000`;
        const resp = await fetch(
          `${credentials.baseUrl}/services/data/v59.0/query?q=${encodeURIComponent(soql)}`,
          { headers },
        );
        if (resp.ok) {
          const data = await resp.json() as { totalSize?: number; records?: Record<string, unknown>[] };
          const rawRecords = data.records || [];
          const count = data.totalSize || rawRecords.length;
          result.recordsSynced += count;
          result.entities.push({ type: entity, count, records: rawRecords as Record<string, unknown>[] });
        } else {
          result.recordsFailed++;
          result.errors.push(`${entity}: HTTP ${resp.status}`);
        }
      } catch (err) {
        result.recordsFailed++;
        result.errors.push(`${entity}: ${(err as Error).message}`);
      }
    }

    result.duration = Date.now() - start;
    return result;
  },
};

// ── Workday Adapter ──
const workdayAdapter: ERPAdapter = {
  name: 'Workday',

  getAuthUrl(credentials: ERPCredentials, state: string): string {
    const authUrl = credentials.authUrl || `${credentials.baseUrl}/authorize`;
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: credentials.clientId,
      redirect_uri: `${credentials.baseUrl}/oauth/callback`,
      scope: credentials.scope || 'wd:soapapi',
      state,
    });
    return `${authUrl}?${params}`;
  },

  async exchangeToken(credentials: ERPCredentials, code: string): Promise<ERPTokenResponse> {
    const tokenUrl = credentials.tokenUrl || `${credentials.baseUrl}/token`;
    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`,
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code }),
    });
    if (!resp.ok) throw new Error(`Workday token exchange failed: ${resp.status}`);
    return resp.json();
  },

  async testConnection(credentials: ERPCredentials, token: string) {
    try {
      const resp = await fetch(`${credentials.baseUrl}/api/v1/workers?limit=1`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      return {
        connected: resp.ok,
        version: 'v40.1',
        message: resp.ok ? 'Connected to Workday REST API' : `Connection failed: ${resp.status}`,
      };
    } catch (err) {
      return { connected: false, message: `Connection error: ${(err as Error).message}` };
    }
  },

  async syncData(credentials: ERPCredentials, token: string, entities: string[]): Promise<SyncResult> {
    const start = Date.now();
    const result: SyncResult = { recordsSynced: 0, recordsFailed: 0, duration: 0, entities: [], errors: [] };

    for (const entity of entities) {
      try {
        const apiMap: Record<string, string> = {
          'workers': '/api/v1/workers?limit=1000',
          'positions': '/api/v1/positions?limit=1000',
          'organizations': '/api/v1/organizations?limit=1000',
          'time_off': '/api/v1/timeOffEntries?limit=1000',
          'payroll': '/api/v1/payrollResults?limit=1000',
        };
        const path = apiMap[entity] || `/api/v1/${entity}?limit=1000`;
        const resp = await fetch(`${credentials.baseUrl}${path}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (resp.ok) {
          const data = await resp.json() as { total?: number; data?: Record<string, unknown>[] };
          const rawRecords = data.data || [];
          const count = data.total || rawRecords.length;
          result.recordsSynced += count;
          result.entities.push({ type: entity, count, records: rawRecords as Record<string, unknown>[] });
        } else {
          result.recordsFailed++;
          result.errors.push(`${entity}: HTTP ${resp.status}`);
        }
      } catch (err) {
        result.recordsFailed++;
        result.errors.push(`${entity}: ${(err as Error).message}`);
      }
    }

    result.duration = Date.now() - start;
    return result;
  },
};

// ── Oracle Fusion Adapter ──
const oracleAdapter: ERPAdapter = {
  name: 'Oracle Fusion',

  getAuthUrl(credentials: ERPCredentials, state: string): string {
    const authUrl = credentials.authUrl || `${credentials.baseUrl}/oauth2/v1/authorize`;
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: credentials.clientId,
      redirect_uri: `${credentials.baseUrl}/oauth/callback`,
      scope: credentials.scope || 'urn:opc:resource:consumer::all',
      state,
    });
    return `${authUrl}?${params}`;
  },

  async exchangeToken(credentials: ERPCredentials, code: string): Promise<ERPTokenResponse> {
    const tokenUrl = credentials.tokenUrl || `${credentials.baseUrl}/oauth2/v1/token`;
    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`,
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code }),
    });
    if (!resp.ok) throw new Error(`Oracle token exchange failed: ${resp.status}`);
    return resp.json();
  },

  async testConnection(credentials: ERPCredentials, token: string) {
    try {
      const resp = await fetch(`${credentials.baseUrl}/fscmRestApi/resources/v1`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      return {
        connected: resp.ok,
        version: 'v1',
        message: resp.ok ? 'Connected to Oracle Fusion REST API' : `Connection failed: ${resp.status}`,
      };
    } catch (err) {
      return { connected: false, message: `Connection error: ${(err as Error).message}` };
    }
  },

  async syncData(credentials: ERPCredentials, token: string, entities: string[]): Promise<SyncResult> {
    const start = Date.now();
    const result: SyncResult = { recordsSynced: 0, recordsFailed: 0, duration: 0, entities: [], errors: [] };

    for (const entity of entities) {
      try {
        const apiMap: Record<string, string> = {
          'suppliers': '/fscmRestApi/resources/v1/suppliers?limit=1000',
          'invoices': '/fscmRestApi/resources/v1/invoices?limit=1000',
          'purchase_orders': '/fscmRestApi/resources/v1/purchaseOrders?limit=1000',
          'gl_journals': '/fscmRestApi/resources/v1/journals?limit=1000',
          'items': '/fscmRestApi/resources/v1/items?limit=1000',
        };
        const path = apiMap[entity] || `/fscmRestApi/resources/v1/${entity}?limit=1000`;
        const resp = await fetch(`${credentials.baseUrl}${path}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (resp.ok) {
          const data = await resp.json() as { count?: number; items?: Record<string, unknown>[] };
          const rawRecords = data.items || [];
          const count = data.count || rawRecords.length;
          result.recordsSynced += count;
          result.entities.push({ type: entity, count, records: rawRecords as Record<string, unknown>[] });
        } else {
          result.recordsFailed++;
          result.errors.push(`${entity}: HTTP ${resp.status}`);
        }
      } catch (err) {
        result.recordsFailed++;
        result.errors.push(`${entity}: ${(err as Error).message}`);
      }
    }

    result.duration = Date.now() - start;
    return result;
  },
};

// ── Xero Adapter ──
const xeroAdapter: ERPAdapter = {
  name: 'Xero',

  getAuthUrl(credentials: ERPCredentials, state: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: credentials.clientId,
      redirect_uri: `${credentials.baseUrl}/oauth/callback`,
      scope: credentials.scope || 'openid profile email accounting.transactions accounting.contacts accounting.settings offline_access',
      state,
    });
    return `https://login.xero.com/identity/connect/authorize?${params}`;
  },

  async exchangeToken(credentials: ERPCredentials, code: string): Promise<ERPTokenResponse> {
    const resp = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${credentials.baseUrl}/oauth/callback`,
      }),
    });
    if (!resp.ok) throw new Error(`Xero token exchange failed: ${resp.status}`);
    return resp.json();
  },

  async testConnection(credentials: ERPCredentials, token: string) {
    try {
      const resp = await fetch('https://api.xero.com/connections', {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (resp.ok) {
        const connections = await resp.json() as { tenantId?: string; tenantName?: string }[];
        return {
          connected: true,
          version: '2.0',
          message: `Connected to Xero. ${connections.length} organisation(s) linked.`,
        };
      }
      return { connected: false, message: `Connection failed: ${resp.status}` };
    } catch (err) {
      return { connected: false, message: `Connection error: ${(err as Error).message}` };
    }
  },

  async syncData(credentials: ERPCredentials, token: string, entities: string[]): Promise<SyncResult> {
    const start = Date.now();
    const result: SyncResult = { recordsSynced: 0, recordsFailed: 0, duration: 0, entities: [], errors: [] };
    const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json', 'Xero-Tenant-Id': credentials.apiKey || '' };

    for (const entity of entities) {
      try {
        const apiMap: Record<string, string> = {
          'invoices': '/api.xro/2.0/Invoices?page=1',
          'contacts': '/api.xro/2.0/Contacts?page=1',
          'accounts': '/api.xro/2.0/Accounts',
          'bank_transactions': '/api.xro/2.0/BankTransactions?page=1',
          'payments': '/api.xro/2.0/Payments?page=1',
          'purchase_orders': '/api.xro/2.0/PurchaseOrders?page=1',
          'credit_notes': '/api.xro/2.0/CreditNotes?page=1',
          'items': '/api.xro/2.0/Items?page=1',
          'journals': '/api.xro/2.0/Journals',
          'manual_journals': '/api.xro/2.0/ManualJournals?page=1',
          'employees': '/api.xro/2.0/Employees',
          'tax_rates': '/api.xro/2.0/TaxRates',
          'tracking_categories': '/api.xro/2.0/TrackingCategories',
        };
        const path = apiMap[entity] || `/api.xro/2.0/${entity}`;
        const resp = await fetch(`https://api.xero.com${path}`, { headers });
        if (resp.ok) {
          const data = await resp.json() as Record<string, unknown[]>;
          const key = Object.keys(data).find(k => Array.isArray(data[k]));
          const rawRecords = key ? (data[key] as Record<string, unknown>[]) : [];
          const count = rawRecords.length;
          result.recordsSynced += count;
          result.entities.push({ type: entity, count, records: rawRecords as Record<string, unknown>[] });
        } else {
          result.recordsFailed++;
          result.errors.push(`${entity}: HTTP ${resp.status}`);
        }
      } catch (err) {
        result.recordsFailed++;
        result.errors.push(`${entity}: ${(err as Error).message}`);
      }
    }

    result.duration = Date.now() - start;
    return result;
  },
};

// ── Sage Business Cloud Accounting Adapter ──
const sageAdapter: ERPAdapter = {
  name: 'Sage Business Cloud',

  getAuthUrl(credentials: ERPCredentials, state: string): string {
    const authUrl = credentials.authUrl || 'https://oauth.accounting.sage.com/authorize';
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: credentials.clientId,
      redirect_uri: `${credentials.baseUrl}/oauth/callback`,
      scope: credentials.scope || 'full_access',
      state,
    });
    return `${authUrl}?${params}`;
  },

  async exchangeToken(credentials: ERPCredentials, code: string): Promise<ERPTokenResponse> {
    const tokenUrl = credentials.tokenUrl || 'https://oauth.accounting.sage.com/token';
    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        code,
        redirect_uri: `${credentials.baseUrl}/oauth/callback`,
      }),
    });
    if (!resp.ok) throw new Error(`Sage token exchange failed: ${resp.status}`);
    return resp.json();
  },

  async testConnection(credentials: ERPCredentials, token: string) {
    try {
      const baseApi = credentials.baseUrl || 'https://api.accounting.sage.com/v3.1';
      const resp = await fetch(`${baseApi}/me`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
      });
      if (resp.ok) {
        const data = await resp.json() as { displayed_as?: string };
        return { connected: true, version: 'v3.1', message: `Connected to Sage: ${data.displayed_as || 'OK'}` };
      }
      return { connected: false, message: `Connection failed: ${resp.status}` };
    } catch (err) {
      return { connected: false, message: `Connection error: ${(err as Error).message}` };
    }
  },

  async syncData(credentials: ERPCredentials, token: string, entities: string[]): Promise<SyncResult> {
    const start = Date.now();
    const result: SyncResult = { recordsSynced: 0, recordsFailed: 0, duration: 0, entities: [], errors: [] };
    const baseApi = credentials.baseUrl || 'https://api.accounting.sage.com/v3.1';
    const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };

    for (const entity of entities) {
      try {
        const apiMap: Record<string, string> = {
          'contacts': '/contacts?items_per_page=200',
          'sales_invoices': '/sales_invoices?items_per_page=200',
          'purchase_invoices': '/purchase_invoices?items_per_page=200',
          'ledger_accounts': '/ledger_accounts?items_per_page=200',
          'bank_accounts': '/bank_accounts',
          'tax_rates': '/tax_rates',
          'products': '/products?items_per_page=200',
          'services': '/services?items_per_page=200',
          'journals': '/journals?items_per_page=200',
          'payments': '/contact_payments?items_per_page=200',
          'bank_transfers': '/bank_transfers?items_per_page=200',
          'stock_items': '/stock_items?items_per_page=200',
        };
        const path = apiMap[entity] || `/${entity}?items_per_page=200`;
        const resp = await fetch(`${baseApi}${path}`, { headers });
        if (resp.ok) {
          const data = await resp.json() as { $total?: number; $items?: Record<string, unknown>[] };
          const rawRecords = data.$items || [];
          const count = data.$total || rawRecords.length;
          result.recordsSynced += count;
          result.entities.push({ type: entity, count, records: rawRecords as Record<string, unknown>[] });
        } else {
          result.recordsFailed++;
          result.errors.push(`${entity}: HTTP ${resp.status}`);
        }
      } catch (err) {
        result.recordsFailed++;
        result.errors.push(`${entity}: ${(err as Error).message}`);
      }
    }

    result.duration = Date.now() - start;
    return result;
  },
};

// ── Sage Pastel (Sage 50cloud / Pastel Partner/Xpress) Adapter ──
const pastelAdapter: ERPAdapter = {
  name: 'Sage Pastel',

  getAuthUrl(credentials: ERPCredentials, state: string): string {
    // Pastel uses API key authentication, but for on-premise we generate a config URL
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: credentials.clientId,
      redirect_uri: `${credentials.baseUrl}/oauth/callback`,
      state,
    });
    const authUrl = credentials.authUrl || `${credentials.baseUrl}/auth`;
    return `${authUrl}?${params}`;
  },

  async exchangeToken(credentials: ERPCredentials, code: string): Promise<ERPTokenResponse> {
    // Pastel SDK uses API key; this returns a session-based token
    const resp = await fetch(`${credentials.baseUrl}/api/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: credentials.apiKey || credentials.clientSecret,
        username: credentials.username,
        password: credentials.password,
        code,
      }),
    });
    if (!resp.ok) throw new Error(`Pastel auth failed: ${resp.status}`);
    return resp.json();
  },

  async testConnection(credentials: ERPCredentials, token: string) {
    try {
      const resp = await fetch(`${credentials.baseUrl}/api/v1/company`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-API-Key': credentials.apiKey || '',
          'Accept': 'application/json',
        },
      });
      if (resp.ok) {
        const data = await resp.json() as { CompanyName?: string; Version?: string };
        return {
          connected: true,
          version: data.Version || '2024',
          message: `Connected to Pastel: ${data.CompanyName || 'OK'}`,
        };
      }
      return { connected: false, message: `Connection failed: ${resp.status}` };
    } catch (err) {
      return { connected: false, message: `Connection error: ${(err as Error).message}` };
    }
  },

  async syncData(credentials: ERPCredentials, token: string, entities: string[]): Promise<SyncResult> {
    const start = Date.now();
    const result: SyncResult = { recordsSynced: 0, recordsFailed: 0, duration: 0, entities: [], errors: [] };
    const headers = {
      'Authorization': `Bearer ${token}`,
      'X-API-Key': credentials.apiKey || '',
      'Accept': 'application/json',
    };

    for (const entity of entities) {
      try {
        const apiMap: Record<string, string> = {
          'customers': '/api/v1/customers?limit=500',
          'suppliers': '/api/v1/suppliers?limit=500',
          'invoices': '/api/v1/invoices?limit=500',
          'purchase_orders': '/api/v1/purchase-orders?limit=500',
          'inventory': '/api/v1/inventory-items?limit=500',
          'gl_accounts': '/api/v1/general-ledger/accounts?limit=500',
          'gl_transactions': '/api/v1/general-ledger/transactions?limit=500',
          'bank_accounts': '/api/v1/bank-accounts',
          'employees': '/api/v1/employees?limit=500',
          'tax_types': '/api/v1/tax-types',
          'quotes': '/api/v1/quotes?limit=500',
          'credit_notes': '/api/v1/credit-notes?limit=500',
        };
        const path = apiMap[entity] || `/api/v1/${entity}?limit=500`;
        const resp = await fetch(`${credentials.baseUrl}${path}`, { headers });
        if (resp.ok) {
          const data = await resp.json() as { TotalResults?: number; Results?: Record<string, unknown>[] };
          const rawRecords = data.Results || [];
          const count = data.TotalResults || rawRecords.length;
          result.recordsSynced += count;
          result.entities.push({ type: entity, count, records: rawRecords as Record<string, unknown>[] });
        } else {
          result.recordsFailed++;
          result.errors.push(`${entity}: HTTP ${resp.status}`);
        }
      } catch (err) {
        result.recordsFailed++;
        result.errors.push(`${entity}: ${(err as Error).message}`);
      }
    }

    result.duration = Date.now() - start;
    return result;
  },
};

// ── Microsoft Dynamics 365 Business Central Adapter ──
const dynamics365Adapter: ERPAdapter = {
  name: 'Microsoft Dynamics 365',

  getAuthUrl(credentials: ERPCredentials, state: string): string {
    const tenant = credentials.apiKey || 'common';
    const authUrl = credentials.authUrl || `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`;
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: credentials.clientId,
      redirect_uri: `${credentials.baseUrl}/oauth/callback`,
      scope: credentials.scope || 'https://api.businesscentral.dynamics.com/.default offline_access',
      state,
    });
    return `${authUrl}?${params}`;
  },

  async exchangeToken(credentials: ERPCredentials, code: string): Promise<ERPTokenResponse> {
    const tenant = credentials.apiKey || 'common';
    const tokenUrl = credentials.tokenUrl || `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        code,
        redirect_uri: `${credentials.baseUrl}/oauth/callback`,
        scope: credentials.scope || 'https://api.businesscentral.dynamics.com/.default offline_access',
      }),
    });
    if (!resp.ok) throw new Error(`Dynamics 365 token exchange failed: ${resp.status}`);
    return resp.json();
  },

  async testConnection(credentials: ERPCredentials, token: string) {
    try {
      const resp = await fetch(`${credentials.baseUrl}/api/v2.0/companies`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
      });
      if (resp.ok) {
        const data = await resp.json() as { value?: Array<{ displayName?: string }> };
        const companyCount = data.value?.length || 0;
        return {
          connected: true,
          version: 'v2.0',
          message: `Connected to Dynamics 365 Business Central. ${companyCount} company(ies) found.`,
        };
      }
      return { connected: false, message: `Connection failed: ${resp.status}` };
    } catch (err) {
      return { connected: false, message: `Connection error: ${(err as Error).message}` };
    }
  },

  async syncData(credentials: ERPCredentials, token: string, entities: string[]): Promise<SyncResult> {
    const start = Date.now();
    const result: SyncResult = { recordsSynced: 0, recordsFailed: 0, duration: 0, entities: [], errors: [] };
    const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };

    // Resolve companyId by fetching the first company from Business Central
    let companyId = '';
    try {
      const companiesResp = await fetch(`${credentials.baseUrl}/api/v2.0/companies`, { headers });
      if (companiesResp.ok) {
        const companiesData = await companiesResp.json() as { value?: Array<{ id?: string }> };
        companyId = companiesData.value?.[0]?.id || '';
      }
    } catch (err) {
      result.errors.push(`Failed to resolve companyId: ${(err as Error).message}`);
    }

    if (!companyId) {
      result.errors.push('No company found in Dynamics 365 Business Central — cannot sync entities');
      result.duration = Date.now() - start;
      return result;
    }

    for (const entity of entities) {
      try {
        const apiMap: Record<string, string> = {
          'customers': `/api/v2.0/companies(${companyId})/customers?$top=1000`,
          'vendors': `/api/v2.0/companies(${companyId})/vendors?$top=1000`,
          'items': `/api/v2.0/companies(${companyId})/items?$top=1000`,
          'sales_orders': `/api/v2.0/companies(${companyId})/salesOrders?$top=1000`,
          'purchase_orders': `/api/v2.0/companies(${companyId})/purchaseOrders?$top=1000`,
          'invoices': `/api/v2.0/companies(${companyId})/salesInvoices?$top=1000`,
          'gl_accounts': `/api/v2.0/companies(${companyId})/accounts?$top=1000`,
          'employees': `/api/v2.0/companies(${companyId})/employees?$top=1000`,
        };
        const path = apiMap[entity] || `/api/v2.0/companies(${companyId})/${entity}?$top=1000`;
        const resp = await fetch(`${credentials.baseUrl}${path}`, { headers });
        if (resp.ok) {
          const data = await resp.json() as { value?: Record<string, unknown>[] };
          const rawRecords = data.value || [];
          const count = rawRecords.length;
          result.recordsSynced += count;
          result.entities.push({ type: entity, count, records: rawRecords as Record<string, unknown>[] });
        } else {
          result.recordsFailed++;
          result.errors.push(`${entity}: HTTP ${resp.status}`);
        }
      } catch (err) {
        result.recordsFailed++;
        result.errors.push(`${entity}: ${(err as Error).message}`);
      }
    }

    result.duration = Date.now() - start;
    return result;
  },
};

// ── Oracle NetSuite (SuiteTalk REST) Adapter ──
const netsuiteAdapter: ERPAdapter = {
  name: 'Oracle NetSuite',

  getAuthUrl(credentials: ERPCredentials, state: string): string {
    const accountId = credentials.apiKey || '';
    const authUrl = credentials.authUrl || `https://${accountId}.app.netsuite.com/app/login/oauth2/authorize.nl`;
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: credentials.clientId,
      redirect_uri: `${credentials.baseUrl}/oauth/callback`,
      scope: credentials.scope || 'rest_webservices',
      state,
    });
    return `${authUrl}?${params}`;
  },

  async exchangeToken(credentials: ERPCredentials, code: string): Promise<ERPTokenResponse> {
    const accountId = credentials.apiKey || '';
    const tokenUrl = credentials.tokenUrl || `https://${accountId}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`;
    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${credentials.baseUrl}/oauth/callback`,
      }),
    });
    if (!resp.ok) throw new Error(`NetSuite token exchange failed: ${resp.status}`);
    return resp.json();
  },

  async testConnection(credentials: ERPCredentials, token: string) {
    try {
      const accountId = credentials.apiKey || '';
      const resp = await fetch(
        `https://${accountId}.suitetalk.api.netsuite.com/services/rest/record/v1/metadata-catalog/`,
        { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } },
      );
      return {
        connected: resp.ok,
        version: 'v1',
        message: resp.ok ? 'Connected to NetSuite SuiteTalk REST API' : `Connection failed: ${resp.status}`,
      };
    } catch (err) {
      return { connected: false, message: `Connection error: ${(err as Error).message}` };
    }
  },

  async syncData(credentials: ERPCredentials, token: string, entities: string[]): Promise<SyncResult> {
    const start = Date.now();
    const result: SyncResult = { recordsSynced: 0, recordsFailed: 0, duration: 0, entities: [], errors: [] };
    const accountId = credentials.apiKey || '';
    const baseApi = `https://${accountId}.suitetalk.api.netsuite.com/services/rest/record/v1`;
    const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };

    for (const entity of entities) {
      try {
        const apiMap: Record<string, string> = {
          'customers': '/customer?limit=1000',
          'vendors': '/vendor?limit=1000',
          'invoices': '/invoice?limit=1000',
          'sales_orders': '/salesOrder?limit=1000',
          'purchase_orders': '/purchaseOrder?limit=1000',
          'items': '/inventoryItem?limit=1000',
          'employees': '/employee?limit=1000',
          'gl_accounts': '/account?limit=1000',
          'contacts': '/contact?limit=1000',
        };
        const path = apiMap[entity] || `/${entity}?limit=1000`;
        const resp = await fetch(`${baseApi}${path}`, { headers });
        if (resp.ok) {
          const data = await resp.json() as { totalResults?: number; items?: Record<string, unknown>[] };
          const rawRecords = data.items || [];
          const count = data.totalResults || rawRecords.length;
          result.recordsSynced += count;
          result.entities.push({ type: entity, count, records: rawRecords as Record<string, unknown>[] });
        } else {
          result.recordsFailed++;
          result.errors.push(`${entity}: HTTP ${resp.status}`);
        }
      } catch (err) {
        result.recordsFailed++;
        result.errors.push(`${entity}: ${(err as Error).message}`);
      }
    }

    result.duration = Date.now() - start;
    return result;
  },
};

// ── Intuit QuickBooks Online Adapter ──
const quickbooksAdapter: ERPAdapter = {
  name: 'QuickBooks Online',

  getAuthUrl(credentials: ERPCredentials, state: string): string {
    const authUrl = credentials.authUrl || 'https://appcenter.intuit.com/connect/oauth2';
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: credentials.clientId,
      redirect_uri: `${credentials.baseUrl}/oauth/callback`,
      scope: credentials.scope || 'com.intuit.quickbooks.accounting',
      state,
    });
    return `${authUrl}?${params}`;
  },

  async exchangeToken(credentials: ERPCredentials, code: string): Promise<ERPTokenResponse> {
    const tokenUrl = credentials.tokenUrl || 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`,
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${credentials.baseUrl}/oauth/callback`,
      }),
    });
    if (!resp.ok) throw new Error(`QuickBooks token exchange failed: ${resp.status}`);
    return resp.json();
  },

  async testConnection(credentials: ERPCredentials, token: string) {
    try {
      const realmId = credentials.apiKey || '';
      const resp = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${realmId}/companyinfo/${realmId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
          },
        },
      );
      if (resp.ok) {
        const data = await resp.json() as { CompanyInfo?: { CompanyName?: string } };
        return {
          connected: true,
          version: 'v3',
          message: `Connected to QuickBooks: ${data.CompanyInfo?.CompanyName || 'OK'}`,
        };
      }
      return { connected: false, message: `Connection failed: ${resp.status}` };
    } catch (err) {
      return { connected: false, message: `Connection error: ${(err as Error).message}` };
    }
  },

  async syncData(credentials: ERPCredentials, token: string, entities: string[]): Promise<SyncResult> {
    const start = Date.now();
    const result: SyncResult = { recordsSynced: 0, recordsFailed: 0, duration: 0, entities: [], errors: [] };
    const realmId = credentials.apiKey || '';
    const baseApi = `https://quickbooks.api.intuit.com/v3/company/${realmId}`;
    const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };

    for (const entity of entities) {
      try {
        const queryMap: Record<string, string> = {
          'customers': 'SELECT * FROM Customer MAXRESULTS 1000',
          'vendors': 'SELECT * FROM Vendor MAXRESULTS 1000',
          'invoices': 'SELECT * FROM Invoice MAXRESULTS 1000',
          'items': 'SELECT * FROM Item MAXRESULTS 1000',
          'accounts': 'SELECT * FROM Account MAXRESULTS 1000',
          'employees': 'SELECT * FROM Employee MAXRESULTS 1000',
          'purchase_orders': 'SELECT * FROM PurchaseOrder MAXRESULTS 1000',
          'bills': 'SELECT * FROM Bill MAXRESULTS 1000',
          'payments': 'SELECT * FROM Payment MAXRESULTS 1000',
          'estimates': 'SELECT * FROM Estimate MAXRESULTS 1000',
        };
        const query = queryMap[entity] || `SELECT * FROM ${entity} MAXRESULTS 1000`;
        const resp = await fetch(
          `${baseApi}/query?query=${encodeURIComponent(query)}`,
          { headers },
        );
        if (resp.ok) {
          const data = await resp.json() as { QueryResponse?: { totalCount?: number; Customer?: Record<string, unknown>[]; Vendor?: Record<string, unknown>[]; Invoice?: Record<string, unknown>[]; Item?: Record<string, unknown>[]; Account?: Record<string, unknown>[]; Employee?: Record<string, unknown>[]; PurchaseOrder?: Record<string, unknown>[]; Bill?: Record<string, unknown>[]; Payment?: Record<string, unknown>[]; Estimate?: Record<string, unknown>[] } };
          const qr = data.QueryResponse || {};
          const rawRecords = (qr.Customer || qr.Vendor || qr.Invoice || qr.Item || qr.Account || qr.Employee || qr.PurchaseOrder || qr.Bill || qr.Payment || qr.Estimate || []) as Record<string, unknown>[];
          const count = data.QueryResponse?.totalCount || rawRecords.length;
          result.recordsSynced += count;
          result.entities.push({ type: entity, count, records: rawRecords });
        } else {
          result.recordsFailed++;
          result.errors.push(`${entity}: HTTP ${resp.status}`);
        }
      } catch (err) {
        result.recordsFailed++;
        result.errors.push(`${entity}: ${(err as Error).message}`);
      }
    }

    result.duration = Date.now() - start;
    return result;
  },
};

// ── TCP-based HTTP fetch for raw IP addresses ──
// Cloudflare Workers fetch() cannot reach raw IP addresses (error 1003).
// This helper uses the Workers TCP socket API (connect from cloudflare:sockets)
// to send a plain HTTP/1.1 request over a TCP connection, bypassing the CDN.
const IP_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;

function isRawIpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return IP_REGEX.test(parsed.hostname);
  } catch {
    return false;
  }
}

interface TcpFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

async function tcpFetch(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<TcpFetchResponse> {
  const parsed = new URL(url);
  const hostname = parsed.hostname;
  const port = parseInt(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80);
  const path = parsed.pathname + parsed.search;
  const method = init.method || 'GET';

  // Dynamically import cloudflare:sockets — only available in Workers runtime
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { connect } = await import('cloudflare:sockets' as any) as { connect: (addr: { hostname: string; port: number }, opts?: { allowHalfOpen?: boolean }) => { readable: ReadableStream; writable: WritableStream; closed: Promise<void> } };

  // allowHalfOpen: keep readable open after writable closes (TCP half-close)
  const socket = connect({ hostname, port }, { allowHalfOpen: true });
  const writer = socket.writable.getWriter();
  const encoder = new TextEncoder();

  // Build HTTP/1.0 request (Odoo's Werkzeug returns HTTP/1.0)
  const headers: Record<string, string> = {
    Host: hostname + (port !== 80 && port !== 443 ? `:${port}` : ''),
    Connection: 'close',
    ...init.headers,
  };
  const bodyBytes = init.body ? encoder.encode(init.body) : null;
  if (bodyBytes && !headers['Content-Length']) {
    headers['Content-Length'] = String(bodyBytes.byteLength);
  }

  let reqStr = `${method} ${path} HTTP/1.0\r\n`;
  for (const [k, v] of Object.entries(headers)) {
    reqStr += `${k}: ${v}\r\n`;
  }
  reqStr += '\r\n';

  // Send headers
  await writer.write(encoder.encode(reqStr));
  // Send body separately if present
  if (bodyBytes) {
    await writer.write(bodyBytes);
  }
  // Signal we're done writing (TCP half-close sends FIN)
  await writer.close();

  // Read full response — server will close connection after sending response
  const reader = socket.readable.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  const combined = concatUint8Arrays(chunks);
  if (combined.byteLength === 0) {
    return {
      ok: false, status: 0, statusText: '',
      headers: {},
      text: async () => 'TCP: empty response (connection closed without data)',
      json: async () => ({ error: 'empty response' }),
    };
  }

  const decoder = new TextDecoder();
  const raw = decoder.decode(combined);

  // Parse HTTP response
  const headerEnd = raw.indexOf('\r\n\r\n');
  const headerSection = headerEnd >= 0 ? raw.slice(0, headerEnd) : raw;
  const bodyRaw = headerEnd >= 0 ? raw.slice(headerEnd + 4) : '';

  const [statusLine, ...headerLines] = headerSection.split('\r\n');
  const statusMatch = statusLine.match(/HTTP\/[\d.]+ (\d+)\s*(.*)/);
  const status = statusMatch ? parseInt(statusMatch[1]) : 0;
  const statusText = statusMatch ? statusMatch[2] : '';

  if (status === 0) {
    // Failed to parse — return raw response for debugging
    return {
      ok: false, status: 0, statusText: '',
      headers: {},
      text: async () => `TCP: unparseable response (${combined.byteLength} bytes): ${raw.slice(0, 300)}`,
      json: async () => ({ error: 'unparseable', raw: raw.slice(0, 300) }),
    };
  }

  const respHeaders: Record<string, string> = {};
  for (const line of headerLines) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      respHeaders[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    }
  }

  // Handle chunked transfer encoding
  let bodyText = bodyRaw;
  if (respHeaders['transfer-encoding']?.includes('chunked')) {
    bodyText = decodeChunked(bodyRaw);
  }

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: respHeaders,
    text: async () => bodyText,
    json: async () => JSON.parse(bodyText),
  };
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((sum, a) => sum + a.byteLength, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.byteLength;
  }
  return result;
}

function decodeChunked(raw: string): string {
  let result = '';
  let pos = 0;
  while (pos < raw.length) {
    const lineEnd = raw.indexOf('\r\n', pos);
    if (lineEnd < 0) break;
    const sizeStr = raw.slice(pos, lineEnd).trim();
    const size = parseInt(sizeStr, 16);
    if (isNaN(size) || size === 0) break;
    pos = lineEnd + 2;
    result += raw.slice(pos, pos + size);
    pos += size + 2; // skip chunk data + \r\n
  }
  return result;
}

/** Fetch wrapper that uses TCP sockets for raw IP URLs (CF Workers limitation) */
async function cfFetch(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<TcpFetchResponse> {
  if (isRawIpUrl(url)) {
    return tcpFetch(url, init);
  }
  // For domain-based URLs, use the standard fetch API
  const resp = await fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
  });
  const respText = await resp.text();
  const respHeaders: Record<string, string> = {};
  resp.headers.forEach((v, k) => { respHeaders[k] = v; });
  return {
    ok: resp.ok,
    status: resp.status,
    statusText: resp.statusText,
    headers: respHeaders,
    text: async () => respText,
    json: async () => JSON.parse(respText),
  };
}

// ── Odoo Adapter (Odoo 18 — JSON-RPC via /jsonrpc endpoint) ──
// Uses /jsonrpc which does NOT require session cookies, unlike /web/dataset/call_kw.
// Auth: service "common" → authenticate returns uid
// Data: service "object" → execute_kw with (db, uid, password, model, method, args, kwargs)
const odooAdapter: ERPAdapter = {
  name: 'Odoo',

  getAuthUrl(credentials: ERPCredentials, state: string): string {
    // Odoo JSON-RPC uses username/password — OAuth not required
    return `${credentials.baseUrl}/web/login?state=${state}`;
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async exchangeToken(credentials: ERPCredentials, code: string): Promise<ERPTokenResponse> {
    // Authenticate via /jsonrpc "common" service (no session cookie needed)
    // Uses cfFetch to support raw IP addresses (CF Workers error 1003 workaround)
    const resp = await cfFetch(`${credentials.baseUrl}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'call', id: 1,
        params: {
          service: 'common', method: 'authenticate',
          args: [credentials.apiKey, credentials.username, credentials.password, {}],
        },
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Odoo auth failed: HTTP ${resp.status} — ${body.slice(0, 200) || 'no response body'}`);
    }
    const data = await resp.json() as {
      result?: number | false; error?: { message: string; data?: { message: string } }
    };
    if (data.error) throw new Error(
      `Odoo auth failed: ${data.error.data?.message || data.error.message || 'RPC error'}`
    );
    if (!data.result) throw new Error('Odoo auth failed: Invalid credentials or database');
    return {
      access_token: String(data.result),  // Odoo uid
      token_type: 'odoo-jsonrpc',
      expires_in: 86400,
      refresh_token: credentials.apiKey,  // db_name stored for reuse
    };
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async testConnection(credentials: ERPCredentials, _token: string) {
    try {
      // Step 1: Check server reachability via version_info
      // Uses cfFetch to support raw IP addresses (CF Workers error 1003 workaround)
      const versionResp = await cfFetch(`${credentials.baseUrl}/web/webclient/version_info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: {} }),
      });
      if (!versionResp.ok) {
        const body = await versionResp.text().catch(() => '');
        return { connected: false, message: `Connection failed: HTTP ${versionResp.status} — ${body.slice(0, 200) || 'no response body'}` };
      }
      const versionData = await versionResp.json() as { result?: { server_version?: string } };
      const version = versionData.result?.server_version || 'unknown';

      // Step 2: Verify auth credentials via /jsonrpc common.authenticate
      const authResp = await cfFetch(`${credentials.baseUrl}/jsonrpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', method: 'call', id: 1,
          params: {
            service: 'common', method: 'authenticate',
            args: [credentials.apiKey, credentials.username, credentials.password, {}],
          },
        }),
      });
      if (!authResp.ok) {
        const body = await authResp.text().catch(() => '');
        return { connected: false, message: `Auth check failed: HTTP ${authResp.status} — ${body.slice(0, 200) || 'no response body'}` };
      }
      const authData = await authResp.json() as {
        result?: number | false; error?: { message: string; data?: { message: string } }
      };
      if (authData.error) {
        return { connected: false, message: `Odoo error: ${authData.error.data?.message || authData.error.message}` };
      }
      if (!authData.result) {
        return { connected: false, message: 'Authentication failed: invalid credentials or database name' };
      }

      return {
        connected: true,
        version,
        message: `Connected to Odoo ${version} (uid: ${authData.result})`,
      };
    } catch (err) {
      return { connected: false, message: `Connection error: ${(err as Error).message}` };
    }
  },

  async syncData(credentials: ERPCredentials, token: string, entities: string[]): Promise<SyncResult> {
    const start = Date.now();
    const result: SyncResult = { recordsSynced: 0, recordsFailed: 0, duration: 0, entities: [], errors: [] };
    const uid = parseInt(token);
    const dbName = credentials.apiKey || '';
    const password = credentials.password || '';
    if (!uid || !dbName) {
      result.errors.push('Missing uid or db_name — re-authenticate');
      result.duration = Date.now() - start;
      return result;
    }
    const modelMap: Record<string, { model: string; fields: string[]; domain: unknown[] }> = {
      customers: {
        model: 'res.partner',
        fields: ['id','name','email','phone','street','city','country_id','is_company'],
        domain: [['customer_rank','>',0]],
      },
      suppliers: {
        model: 'res.partner',
        fields: ['id','name','email','phone','street','city','supplier_rank'],
        domain: [['supplier_rank','>',0]],
      },
      invoices: {
        model: 'account.move',
        fields: ['id','name','amount_total','amount_residual','state',
                 'invoice_date','partner_id','move_type'],
        domain: [['move_type','in',['out_invoice','in_invoice']]],
      },
      sales_orders: {
        model: 'sale.order',
        fields: ['id','name','amount_total','state','date_order','partner_id'],
        domain: [],
      },
      purchase_orders: {
        model: 'purchase.order',
        fields: ['id','name','amount_total','state','date_order','partner_id'],
        domain: [],
      },
      products: {
        model: 'product.template',
        fields: ['id','name','list_price','standard_price','categ_id',
                 'qty_available','active'],
        domain: [['active','=',true]],
      },
      employees: {
        model: 'hr.employee',
        fields: ['id','name','department_id','job_title','work_email'],
        domain: [['active','=',true]],
      },
      gl_accounts: {
        model: 'account.account',
        fields: ['id','name','code','account_type'],
        domain: [],
      },
    };
    for (const entity of entities) {
      const cfg = modelMap[entity];
      if (!cfg) {
        result.errors.push(`${entity}: no model mapping defined`);
        continue;
      }
      try {
        // Use /jsonrpc with execute_kw (no session cookie needed)
        // Uses cfFetch to support raw IP addresses (CF Workers error 1003 workaround)
        const resp = await cfFetch(`${credentials.baseUrl}/jsonrpc`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', method: 'call', id: 1,
            params: {
              service: 'object', method: 'execute_kw',
              args: [
                dbName, uid, password,
                cfg.model, 'search_read',
                [cfg.domain],
                { fields: cfg.fields, limit: 1000 },
              ],
            },
          }),
        });
        if (resp.ok) {
          const data = await resp.json() as {
            result?: Record<string, unknown>[];
            error?: { message: string; data?: { message: string } };
          };
          if (data.error) {
            result.recordsFailed++;
            result.errors.push(`${entity}: ${data.error.data?.message || data.error.message}`);
            continue;
          }
          const records = data.result || [];
          result.recordsSynced += records.length;
          result.entities.push({ type: entity, count: records.length, records });
        } else {
          result.recordsFailed++;
          result.errors.push(`${entity}: HTTP ${resp.status}`);
        }
      } catch (err) {
        result.recordsFailed++;
        result.errors.push(`${entity}: ${(err as Error).message}`);
      }
    }
    result.duration = Date.now() - start;
    return result;
  },
};

// ── Adapter Registry ──
const adapters: Record<string, ERPAdapter> = {
  sap: sapAdapter,
  salesforce: salesforceAdapter,
  workday: workdayAdapter,
  oracle: oracleAdapter,
  xero: xeroAdapter,
  sage: sageAdapter,
  pastel: pastelAdapter,
  dynamics365: dynamics365Adapter,
  netsuite: netsuiteAdapter,
  quickbooks: quickbooksAdapter,
  odoo: odooAdapter,
};

/** Look up an ERP adapter by system key (case-insensitive) */
export function getERPAdapter(system: string): ERPAdapter | null {
  return adapters[system.toLowerCase()] || null;
}

/** List all registered ERP adapters with their system key and display name */
export function listERPAdapters(): { system: string; name: string }[] {
  return Object.entries(adapters).map(([system, adapter]) => ({
    system,
    name: adapter.name,
  }));
}
