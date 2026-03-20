/**
 * ERP Connector Service
 * Real OAuth flows, connection testing, and data sync for SAP, Salesforce, Workday, Oracle, Xero, Sage, Pastel, Dynamics 365, NetSuite, QuickBooks, Odoo
 * All adapters updated to target the latest API versions as of 2026.
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

// ── SAP S/4HANA Adapter (OData V4 — 2025 FPS01) ──
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
      const resp = await fetch(`${credentials.baseUrl}/sap/opu/odata4/sap/api_business_partner/srvd_a2x/sap/a_businesspartner/0001/$metadata`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/xml' },
      });
      return {
        connected: resp.ok,
        version: resp.headers.get('sap-metadata-version') || '4.0',
        message: resp.ok ? 'Connected to SAP S/4HANA OData V4 API (2025)' : `Connection failed: ${resp.status}`,
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
          'business_partners': '/sap/opu/odata4/sap/api_business_partner/srvd_a2x/sap/a_businesspartner/0001/A_BusinessPartner?$top=1000',
          'sales_orders': '/sap/opu/odata4/sap/api_salesorder/srvd_a2x/sap/salesorder/0001/A_SalesOrder?$top=1000',
          'purchase_orders': '/sap/opu/odata4/sap/api_purchaseorder/srvd_a2x/sap/purchaseorder/0001/A_PurchaseOrder?$top=1000',
          'materials': '/sap/opu/odata4/sap/api_product/srvd_a2x/sap/product/0001/A_Product?$top=1000',
          'gl_accounts': '/sap/opu/odata4/sap/api_journalentryitembasic/srvd_a2x/sap/journalentryitembasic/0001/A_JournalEntryItemBasic?$top=1000',
        };
        const path = apiMap[entity] || `/sap/opu/odata4/sap/${entity}?$top=1000`;
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

// ── Salesforce Adapter (REST API v66.0 — Spring '26) ──
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
      const resp = await fetch(`${credentials.baseUrl}/services/data/v66.0/`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (resp.ok) {
        const data = await resp.json() as { version?: string };
        return { connected: true, version: data.version || 'v66.0', message: 'Connected to Salesforce REST API (Spring \'26)' };
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
          `${credentials.baseUrl}/services/data/v66.0/query?q=${encodeURIComponent(soql)}`,
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

// ── Workday Adapter (REST v1 / WWS v45.2 — 2025R2) ──
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
        version: 'v45.2',
        message: resp.ok ? 'Connected to Workday REST API (2025R2)' : `Connection failed: ${resp.status}`,
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

// ── Oracle Fusion Cloud Adapter (26A) ──
const oracleAdapter: ERPAdapter = {
  name: 'Oracle Fusion Cloud',

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
      const resp = await fetch(`${credentials.baseUrl}/fscmRestApi/resources/11.13.18.05`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      return {
        connected: resp.ok,
        version: '26A',
        message: resp.ok ? 'Connected to Oracle Fusion Cloud REST API (26A)' : `Connection failed: ${resp.status}`,
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
          'suppliers': '/fscmRestApi/resources/11.13.18.05/suppliers?limit=1000',
          'invoices': '/fscmRestApi/resources/11.13.18.05/invoices?limit=1000',
          'purchase_orders': '/fscmRestApi/resources/11.13.18.05/purchaseOrders?limit=1000',
          'gl_journals': '/fscmRestApi/resources/11.13.18.05/journals?limit=1000',
          'items': '/fscmRestApi/resources/11.13.18.05/items?limit=1000',
        };
        const path = apiMap[entity] || `/fscmRestApi/resources/11.13.18.05/${entity}?limit=1000`;
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

// ── Xero Adapter (API 2.0 — current) ──
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
          message: `Connected to Xero API 2.0. ${connections.length} organisation(s) linked.`,
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

// ── Sage Business Cloud Accounting Adapter (v3.1 — current) ──
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

// ── Sage Pastel (Sage 50cloud / Pastel Partner/Xpress) Adapter (v2 — 2026) ──
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
      const resp = await fetch(`${credentials.baseUrl}/api/v2/company`, {
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
          version: data.Version || '2026',
          message: `Connected to Pastel (2026): ${data.CompanyName || 'OK'}`,
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
          'customers': '/api/v2/customers?limit=500',
          'suppliers': '/api/v2/suppliers?limit=500',
          'invoices': '/api/v2/invoices?limit=500',
          'purchase_orders': '/api/v2/purchase-orders?limit=500',
          'inventory': '/api/v2/inventory-items?limit=500',
          'gl_accounts': '/api/v2/general-ledger/accounts?limit=500',
          'gl_transactions': '/api/v2/general-ledger/transactions?limit=500',
          'bank_accounts': '/api/v2/bank-accounts',
          'employees': '/api/v2/employees?limit=500',
          'tax_types': '/api/v2/tax-types',
          'quotes': '/api/v2/quotes?limit=500',
          'credit_notes': '/api/v2/credit-notes?limit=500',
        };
        const path = apiMap[entity] || `/api/v2/${entity}?limit=500`;
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

// ── Microsoft Dynamics 365 Business Central Adapter (API v2.0 — 2026 Wave 1) ──
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

// ── Oracle NetSuite (SuiteTalk REST — 2026.1) Adapter ──
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
        version: '2026.1',
        message: resp.ok ? 'Connected to NetSuite SuiteTalk REST API (2026.1)' : `Connection failed: ${resp.status}`,
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

// ── Intuit QuickBooks Online Adapter (v3 — minor version 75) ──
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
        `https://quickbooks.api.intuit.com/v3/company/${realmId}/companyinfo/${realmId}?minorversion=75`,
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
          version: 'v3-minor75',
          message: `Connected to QuickBooks Online (v3, minor 75): ${data.CompanyInfo?.CompanyName || 'OK'}`,
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
    const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json', 'Content-Type': 'application/json' };

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

// ── Odoo Adapter (v18 — JSON-RPC / REST API) ──
const odooAdapter: ERPAdapter = {
  name: 'Odoo',

  getAuthUrl(credentials: ERPCredentials, state: string): string {
    const authUrl = credentials.authUrl || `${credentials.baseUrl}/api/v2/authentication/oauth2/authorize`;
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: credentials.clientId,
      redirect_uri: `${credentials.baseUrl}/oauth/callback`,
      scope: credentials.scope || 'openid profile email',
      state,
    });
    return `${authUrl}?${params}`;
  },

  async exchangeToken(credentials: ERPCredentials, code: string): Promise<ERPTokenResponse> {
    const tokenUrl = credentials.tokenUrl || `${credentials.baseUrl}/api/v2/authentication/oauth2/token`;
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
    if (!resp.ok) throw new Error(`Odoo token exchange failed: ${resp.status}`);
    return resp.json();
  },

  async testConnection(credentials: ERPCredentials, token: string) {
    try {
      // Odoo 18 JSON-RPC version info endpoint
      const resp = await fetch(`${credentials.baseUrl}/web/webclient/version_info`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: {}, id: 1 }),
      });
      if (resp.ok) {
        const data = await resp.json() as { result?: { server_version?: string; server_version_info?: number[] } };
        const version = data.result?.server_version || '18.0';
        return {
          connected: true,
          version,
          message: `Connected to Odoo ${version} (JSON-RPC)`,
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
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };

    for (const entity of entities) {
      try {
        const modelMap: Record<string, string> = {
          'customers': 'res.partner',
          'contacts': 'res.partner',
          'suppliers': 'res.partner',
          'vendors': 'res.partner',
          'invoices': 'account.move',
          'sales_orders': 'sale.order',
          'purchase_orders': 'purchase.order',
          'products': 'product.product',
          'items': 'product.template',
          'employees': 'hr.employee',
          'gl_accounts': 'account.account',
        };
        const model = modelMap[entity] || entity;

        // Build domain filters for Odoo 18 search_read
        const domainFilters: [string, string, unknown][] = [];
        if (entity === 'customers') domainFilters.push(['customer_rank', '>', 0]);
        if (entity === 'suppliers' || entity === 'vendors') domainFilters.push(['supplier_rank', '>', 0]);
        if (entity === 'invoices') domainFilters.push(['move_type', 'in', ['out_invoice', 'in_invoice']]);

        // Use Odoo 18 /web/dataset/call_kw endpoint with Bearer token auth
        // This is compatible with OAuth2 tokens, unlike raw /jsonrpc execute_kw
        // which requires session-based (db, uid, password) authentication
        const rpcPayload = {
          jsonrpc: '2.0',
          method: 'call',
          params: {
            model,
            method: 'search_read',
            args: [domainFilters],
            kwargs: { limit: 1000 },
          },
          id: Date.now(),
        };

        const resp = await fetch(`${credentials.baseUrl}/web/dataset/call_kw/${model}/search_read`, {
          method: 'POST',
          headers,
          body: JSON.stringify(rpcPayload),
        });

        if (resp.ok) {
          const data = await resp.json() as { result?: { records?: Record<string, unknown>[]; length?: number } | Record<string, unknown>[]; error?: { message?: string; data?: { message?: string } } };
          if (data.error) {
            result.recordsFailed++;
            result.errors.push(`${entity}: ${data.error.data?.message || data.error.message || 'RPC error'}`);
          } else {
            const records = Array.isArray(data.result) ? data.result : (data.result?.records || []);
            const count = records.length;
            result.recordsSynced += count;
            result.entities.push({ type: entity, count, records: records as Record<string, unknown>[] });
          }
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
