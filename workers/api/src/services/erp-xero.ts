// TASK-020: Xero ERP Real Data Pipeline with OAuth2
// Implements the Xero integration for real financial data sync

interface XeroTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  tenant_id: string;
}

interface XeroConfig {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
}

const XERO_AUTH_URL = 'https://login.xero.com/identity/connect/authorize';
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0';

/**
 * Generate Xero OAuth2 authorization URL
 */
export function getXeroAuthUrl(config: XeroConfig, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.client_id,
    redirect_uri: config.redirect_uri,
    scope: 'openid profile email accounting.transactions accounting.contacts accounting.settings offline_access',
    state,
  });
  return `${XERO_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeXeroCode(config: XeroConfig, code: string): Promise<XeroTokens> {
  const response = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${btoa(`${config.client_id}:${config.client_secret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirect_uri,
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`Xero token exchange failed: ${response.status}`);
  }

  const data = await response.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    xero_userid: string;
  };

  // Get tenant connections
  const connectionsRes = await fetch('https://api.xero.com/connections', {
    headers: { 'Authorization': `Bearer ${data.access_token}` },
  });
  const connections = await connectionsRes.json() as Array<{ tenantId: string }>;

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    tenant_id: connections[0]?.tenantId || '',
  };
}

/**
 * Refresh Xero access token
 */
export async function refreshXeroToken(config: XeroConfig, refreshToken: string): Promise<XeroTokens> {
  const response = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${btoa(`${config.client_id}:${config.client_secret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`Xero token refresh failed: ${response.status}`);
  }

  const data = await response.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const connectionsRes = await fetch('https://api.xero.com/connections', {
    headers: { 'Authorization': `Bearer ${data.access_token}` },
  });
  const connections = await connectionsRes.json() as Array<{ tenantId: string }>;

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    tenant_id: connections[0]?.tenantId || '',
  };
}

/**
 * Fetch data from Xero API
 */
async function xeroApiCall<T>(tokens: XeroTokens, endpoint: string): Promise<T> {
  const response = await fetch(`${XERO_API_BASE}/${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${tokens.access_token}`,
      'Xero-Tenant-Id': tokens.tenant_id,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Xero API call failed: ${response.status} ${endpoint}`);
  }

  return await response.json() as T;
}

/**
 * Sync invoices from Xero
 */
export async function syncXeroInvoices(tokens: XeroTokens): Promise<{
  invoices: Array<{ id: string; number: string; contact: string; total: number; status: string; date: string }>;
  count: number;
}> {
  const data = await xeroApiCall<{
    Invoices: Array<{
      InvoiceID: string;
      InvoiceNumber: string;
      Contact: { Name: string };
      Total: number;
      Status: string;
      Date: string;
    }>;
  }>(tokens, 'Invoices?where=Status!="DELETED"&order=Date DESC&page=1');

  const invoices = (data.Invoices || []).map(inv => ({
    id: inv.InvoiceID,
    number: inv.InvoiceNumber,
    contact: inv.Contact?.Name || 'Unknown',
    total: inv.Total,
    status: inv.Status,
    date: inv.Date,
  }));

  return { invoices, count: invoices.length };
}

/**
 * Sync contacts from Xero
 */
export async function syncXeroContacts(tokens: XeroTokens): Promise<{
  contacts: Array<{ id: string; name: string; email: string; phone: string; type: string }>;
  count: number;
}> {
  const data = await xeroApiCall<{
    Contacts: Array<{
      ContactID: string;
      Name: string;
      EmailAddress: string;
      Phones: Array<{ PhoneNumber: string }>;
      IsSupplier: boolean;
      IsCustomer: boolean;
    }>;
  }>(tokens, 'Contacts?page=1');

  const contacts = (data.Contacts || []).map(c => ({
    id: c.ContactID,
    name: c.Name,
    email: c.EmailAddress || '',
    phone: c.Phones?.[0]?.PhoneNumber || '',
    type: c.IsSupplier ? 'supplier' : c.IsCustomer ? 'customer' : 'other',
  }));

  return { contacts, count: contacts.length };
}

/**
 * Sync bank transactions from Xero
 */
export async function syncXeroBankTransactions(tokens: XeroTokens): Promise<{
  transactions: Array<{ id: string; date: string; amount: number; reference: string; type: string }>;
  count: number;
}> {
  const data = await xeroApiCall<{
    BankTransactions: Array<{
      BankTransactionID: string;
      Date: string;
      Total: number;
      Reference: string;
      Type: string;
    }>;
  }>(tokens, 'BankTransactions?page=1&order=Date DESC');

  const transactions = (data.BankTransactions || []).map(t => ({
    id: t.BankTransactionID,
    date: t.Date,
    amount: t.Total,
    reference: t.Reference || '',
    type: t.Type,
  }));

  return { transactions, count: transactions.length };
}
