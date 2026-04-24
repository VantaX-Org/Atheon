import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';
import { cleanupTenantData } from '../services/tenant-cleanup';
import { encrypt, decrypt, isEncrypted } from '../services/encryption';

const tenants = new Hono<AppBindings>();

// GET /api/tenants - List all tenants (admin only)
tenants.get('/', async (c) => {
  const results = await c.env.DB.prepare(
    'SELECT t.*, te.layers, te.catalyst_clusters, te.max_agents, te.max_users, te.autonomy_tiers, te.llm_tiers, te.features, te.sso_enabled, te.api_access, te.custom_branding, te.data_retention_days FROM tenants t LEFT JOIN tenant_entitlements te ON t.id = te.tenant_id ORDER BY t.created_at DESC'
  ).all();

  const formatted = results.results.map((t: Record<string, unknown>) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    industry: t.industry,
    plan: t.plan,
    status: t.status,
    deploymentModel: t.deployment_model,
    region: t.region,
    createdAt: t.created_at,
    entitlements: {
      layers: JSON.parse(t.layers as string || '[]'),
      catalystClusters: JSON.parse(t.catalyst_clusters as string || '[]'),
      maxAgents: t.max_agents,
      maxUsers: t.max_users,
      autonomyTiers: JSON.parse(t.autonomy_tiers as string || '[]'),
      llmTiers: JSON.parse(t.llm_tiers as string || '[]'),
      features: JSON.parse(t.features as string || '[]'),
      ssoEnabled: !!t.sso_enabled,
      apiAccess: !!t.api_access,
      customBranding: !!t.custom_branding,
      dataRetentionDays: t.data_retention_days,
    },
  }));

  return c.json({ tenants: formatted, total: formatted.length });
});

// ── POPIA-1: GET /api/tenants/data-export — Data Subject Access Request (DSAR) ──
// Returns JSON of all PII tables for the authenticated user's tenant.
// NOTE: Must be registered BEFORE /:id route to avoid being captured by the param.
tenants.get('/data-export', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  const tenantId = auth?.tenantId || '';
  if (!tenantId) return c.json({ error: 'No tenant context' }, 400);

  const piiTables: Record<string, unknown[]> = {};

  const queries: { key: string; sql: string }[] = [
    { key: 'users', sql: 'SELECT id, name, email, role, created_at FROM users WHERE tenant_id = ?' },
    { key: 'erp_customers', sql: 'SELECT * FROM erp_customers WHERE tenant_id = ?' },
    { key: 'erp_suppliers', sql: 'SELECT * FROM erp_suppliers WHERE tenant_id = ?' },
    { key: 'erp_employees', sql: 'SELECT * FROM erp_employees WHERE tenant_id = ?' },
    { key: 'erp_invoices', sql: 'SELECT * FROM erp_invoices WHERE tenant_id = ?' },
    { key: 'audit_log', sql: 'SELECT * FROM audit_log WHERE tenant_id = ?' },
    { key: 'catalyst_actions', sql: 'SELECT * FROM catalyst_actions WHERE tenant_id = ?' },
    { key: 'sub_catalyst_runs', sql: 'SELECT id, tenant_id, cluster_id, sub_catalyst_name, run_number, status, started_at, completed_at FROM sub_catalyst_runs WHERE tenant_id = ?' },
    { key: 'mind_queries', sql: 'SELECT * FROM mind_queries WHERE tenant_id = ?' },
  ];

  for (const q of queries) {
    try {
      const result = await c.env.DB.prepare(q.sql).bind(tenantId).all();
      piiTables[q.key] = result.results;
    } catch {
      piiTables[q.key] = [];
    }
  }

  // Store export in R2 if available, otherwise return inline
  const exportPayload = JSON.stringify({
    tenant_id: tenantId,
    exported_at: new Date().toISOString(),
    exported_by: auth?.email || 'unknown',
    data: piiTables,
  }, null, 2);

  try {
    const key = `popia-export/${tenantId}/${Date.now()}.json`;

    // §1.3: Encrypt DSAR payload at rest in R2. The R2 body must be ciphertext so
    // that a leaked bucket or misconfigured ACL does not expose PII. The caller
    // still receives the plaintext inline — they're authenticated as the data
    // subject's tenant and this is their own data.
    const encryptionKey = c.env.ENCRYPTION_KEY;
    let r2Body: string = exportPayload;
    let encrypted = false;
    let encryptionSkippedReason: string | undefined;

    if (encryptionKey && encryptionKey.length >= 16) {
      try {
        r2Body = await encrypt(exportPayload, encryptionKey);
        encrypted = true;
      } catch (encErr) {
        console.error('DSAR export encryption failed, falling back to plaintext:', encErr);
        encryptionSkippedReason = 'encryption_error';
      }
    } else {
      encryptionSkippedReason = 'no_encryption_key';
      console.warn('DSAR export: ENCRYPTION_KEY not configured — storing plaintext (non-production safe only)');
    }

    await c.env.STORAGE.put(key, r2Body, {
      httpMetadata: { contentType: encrypted ? 'application/octet-stream' : 'application/json' },
      customMetadata: {
        tenantId,
        exportedBy: auth?.email || '',
        encrypted: encrypted ? 'true' : 'false',
        encryption: encrypted ? 'aes-256-gcm:v1' : 'none',
      },
    });

    // Audit log — record encryption status so auditors can verify POPIA §19 compliance
    await c.env.DB.prepare(
      'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), tenantId, 'popia.data_export.completed', 'compliance', 'data-export',
      JSON.stringify({
        exportedBy: auth?.email,
        r2Key: key,
        tableCount: Object.keys(piiTables).length,
        encrypted,
        encryptionSkippedReason,
      }),
      'success'
    ).run();

    return c.json({
      success: true,
      exportedAt: new Date().toISOString(),
      r2Key: key,
      encrypted,
      tableCount: Object.keys(piiTables).length,
      totalRecords: Object.values(piiTables).reduce((sum, arr) => sum + arr.length, 0),
      data: piiTables,
    });
  } catch {
    // Fallback: return inline if R2 write fails
    return c.json({
      success: true,
      exportedAt: new Date().toISOString(),
      tableCount: Object.keys(piiTables).length,
      totalRecords: Object.values(piiTables).reduce((sum, arr) => sum + arr.length, 0),
      data: piiTables,
    });
  }
});

// ── POPIA-1b: GET /api/tenants/data-export/:key — Retrieve a previously-exported DSAR ──
// The :key here is the R2 object key (URL-encoded). Superadmins can retrieve any tenant's
// export; tenant users can only retrieve their own tenant's exports.
// NOTE: Must be registered BEFORE /:id route to avoid being captured by the param.
tenants.get('/data-export/:key{.+}', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth) return c.json({ error: 'Unauthenticated' }, 401);

  const rawKey = c.req.param('key');
  const key = decodeURIComponent(rawKey);

  // R2 keys have the shape `popia-export/<tenantId>/<timestamp>.json` — enforce that
  // the requesting user's tenant matches the export's tenant unless they're superadmin.
  if (!key.startsWith('popia-export/')) {
    return c.json({ error: 'Invalid export key' }, 400);
  }
  const parts = key.split('/');
  if (parts.length < 3) return c.json({ error: 'Invalid export key' }, 400);
  const exportTenantId = parts[1];

  const isSuperadmin = auth.role === 'superadmin' || auth.role === 'support_admin';
  if (!isSuperadmin && auth.tenantId !== exportTenantId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const obj = await c.env.STORAGE.get(key);
  if (!obj) return c.json({ error: 'Export not found' }, 404);

  const body = await obj.text();
  const wasEncrypted = obj.customMetadata?.encrypted === 'true';

  let payload = body;
  if (wasEncrypted || isEncrypted(body)) {
    const decrypted = await decrypt(body, c.env.ENCRYPTION_KEY);
    if (decrypted === null) {
      return c.json({ error: 'Decryption failed — encryption key may have been rotated' }, 500);
    }
    payload = decrypted;
  }

  // Audit log the retrieval
  try {
    await c.env.DB.prepare(
      'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(), auth.tenantId, 'popia.data_export.retrieved', 'compliance', 'data-export',
      JSON.stringify({ retrievedBy: auth.email, r2Key: key, wasEncrypted, crossTenant: auth.tenantId !== exportTenantId }),
      'success',
    ).run();
  } catch { /* non-fatal */ }

  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return c.json({ success: true, r2Key: key, wasEncrypted, export: parsed });
  } catch {
    // If it doesn't parse as JSON, return it raw (shouldn't normally happen)
    return c.json({ success: true, r2Key: key, wasEncrypted, raw: payload });
  }
});

// ── POPIA-2: DELETE /api/tenants/data-export — Right to Erasure ──
// Purges PII while preserving anonymised operational data.
// NOTE: Must be registered BEFORE /:id route to avoid being captured by the param.
tenants.delete('/data-export', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  const tenantId = auth?.tenantId || '';
  if (!tenantId) return c.json({ error: 'No tenant context' }, 400);

  const erasureLog: { table: string; action: string; affected: number }[] = [];

  // DELETE: erp_employees, erp_customers, mind_queries
  for (const table of ['erp_employees', 'erp_customers', 'mind_queries']) {
    try {
      const del = await c.env.DB.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).bind(tenantId).run();
      erasureLog.push({ table, action: 'deleted', affected: del.meta?.changes || 0 });
    } catch {
      erasureLog.push({ table, action: 'skipped', affected: 0 });
    }
  }

  // ANONYMISE: erp_invoices (customer_name = 'REDACTED', customer_id = NULL)
  try {
    const upd = await c.env.DB.prepare(
      "UPDATE erp_invoices SET customer_name = 'REDACTED', customer_id = NULL WHERE tenant_id = ?"
    ).bind(tenantId).run();
    erasureLog.push({ table: 'erp_invoices', action: 'anonymised', affected: upd.meta?.changes || 0 });
  } catch {
    erasureLog.push({ table: 'erp_invoices', action: 'skipped', affected: 0 });
  }

  // ANONYMISE: audit_log (user_id = 'REDACTED')
  try {
    const upd = await c.env.DB.prepare(
      "UPDATE audit_log SET user_id = 'REDACTED' WHERE tenant_id = ? AND user_id IS NOT NULL"
    ).bind(tenantId).run();
    erasureLog.push({ table: 'audit_log', action: 'anonymised', affected: upd.meta?.changes || 0 });
  } catch {
    erasureLog.push({ table: 'audit_log', action: 'skipped', affected: 0 });
  }

  // ANONYMISE: users (name = 'Redacted User', email = '{userId}@redacted.local')
  try {
    const users = await c.env.DB.prepare(
      "SELECT id FROM users WHERE tenant_id = ? AND role NOT IN ('superadmin', 'support_admin')"
    ).bind(tenantId).all();
    let affected = 0;
    for (const u of users.results) {
      const userId = u.id as string;
      await c.env.DB.prepare(
        "UPDATE users SET name = 'Redacted User', email = ? WHERE id = ?"
      ).bind(`${userId}@redacted.local`, userId).run();
      affected++;
    }
    erasureLog.push({ table: 'users', action: 'anonymised', affected });
  } catch {
    erasureLog.push({ table: 'users', action: 'skipped', affected: 0 });
  }

  // Compliance evidence — audit log entry
  try {
    await c.env.DB.prepare(
      'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), tenantId, 'popia.erasure.completed', 'compliance', 'data-export',
      JSON.stringify({ requestedBy: auth?.email, erasureLog, completedAt: new Date().toISOString() }),
      'success'
    ).run();
  } catch { /* non-fatal */ }

  return c.json({
    success: true,
    erasedAt: new Date().toISOString(),
    erasureLog,
    preservedTables: ['catalyst_clusters', 'process_metrics', 'health_scores', 'sub_catalyst_runs'],
  });
});

// GET /api/tenants/:id
tenants.get('/:id', async (c) => {
  const id = c.req.param('id');
  const t = await c.env.DB.prepare(
    'SELECT t.*, te.layers, te.catalyst_clusters, te.max_agents, te.max_users, te.autonomy_tiers, te.llm_tiers, te.features, te.sso_enabled, te.api_access, te.custom_branding, te.data_retention_days FROM tenants t LEFT JOIN tenant_entitlements te ON t.id = te.tenant_id WHERE t.id = ?'
  ).bind(id).first();

  if (!t) return c.json({ error: 'Tenant not found' }, 404);

  // Get user count
  const userCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM users WHERE tenant_id = ?').bind(id).first<{ count: number }>();
  // Get agent count
  const agentCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM agent_deployments WHERE tenant_id = ?').bind(id).first<{ count: number }>();
  // Get cluster count
  const clusterCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM catalyst_clusters WHERE tenant_id = ?').bind(id).first<{ count: number }>();

  return c.json({
    id: t.id,
    name: t.name,
    slug: t.slug,
    industry: t.industry,
    plan: t.plan,
    status: t.status,
    deploymentModel: t.deployment_model,
    region: t.region,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    stats: {
      users: userCount?.count || 0,
      agents: agentCount?.count || 0,
      clusters: clusterCount?.count || 0,
    },
    entitlements: {
      layers: JSON.parse(t.layers as string || '[]'),
      catalystClusters: JSON.parse(t.catalyst_clusters as string || '[]'),
      maxAgents: t.max_agents,
      maxUsers: t.max_users,
      autonomyTiers: JSON.parse(t.autonomy_tiers as string || '[]'),
      llmTiers: JSON.parse(t.llm_tiers as string || '[]'),
      features: JSON.parse(t.features as string || '[]'),
      ssoEnabled: !!t.sso_enabled,
      apiAccess: !!t.api_access,
      customBranding: !!t.custom_branding,
      dataRetentionDays: t.data_retention_days,
    },
  });
});

// POST /api/tenants
tenants.post('/', async (c) => {
  const { data: body, errors } = await getValidatedJsonBody<{
    name: string; slug: string; industry?: string; plan?: string;
    deploymentModel?: string; region?: string; entitlements?: Record<string, unknown>;
  }>(c, [
    { field: 'name', type: 'string', required: true, minLength: 1, maxLength: 200 },
    { field: 'slug', type: 'string', required: true, minLength: 1, maxLength: 64, pattern: /^[a-z0-9-]+$/ },
    { field: 'industry', type: 'string', required: false, maxLength: 64 },
    { field: 'plan', type: 'string', required: false, maxLength: 32 },
    { field: 'region', type: 'string', required: false, maxLength: 32 },
  ]);
  if (!body || errors.length > 0) {
    return c.json({ error: 'Invalid input', details: errors }, 400);
  }

  // Use slug as tenant id — the entire codebase (JWT tenant_id, FK references,
  // getTenantId helpers, frontend localStorage) identifies tenants by slug.
  // Using a UUID here would break FK constraints when other tables reference
  // tenants(id) via the slug stored in the JWT.
  const id = body.slug;
  await c.env.DB.prepare(
    'INSERT INTO tenants (id, name, slug, industry, plan, deployment_model, region) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, body.name, body.slug, body.industry || 'general', body.plan || 'starter', body.deploymentModel || 'saas', body.region || 'af-south-1').run();

  // Create default entitlements
  await c.env.DB.prepare(
    'INSERT INTO tenant_entitlements (tenant_id) VALUES (?)'
  ).bind(id).run();

  return c.json({ id, name: body.name, slug: body.slug, status: 'active' }, 201);
});

// PUT /api/tenants/:id
tenants.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>();

  const existing = await c.env.DB.prepare('SELECT id FROM tenants WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'Tenant not found' }, 404);

  if (body.name || body.plan || body.status || body.deploymentModel) {
    const updates: string[] = [];
    const values: unknown[] = [];
    if (body.name) { updates.push('name = ?'); values.push(body.name); }
    if (body.plan) { updates.push('plan = ?'); values.push(body.plan); }
    if (body.status) { updates.push('status = ?'); values.push(body.status); }
    if (body.deploymentModel) { updates.push('deployment_model = ?'); values.push(body.deploymentModel); }
    updates.push('updated_at = datetime(\'now\')');
    values.push(id);

    await c.env.DB.prepare(`UPDATE tenants SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  }

  return c.json({ success: true });
});

// PUT /api/tenants/:id/entitlements
tenants.put('/:id/entitlements', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>();

  const existing = await c.env.DB.prepare('SELECT tenant_id FROM tenant_entitlements WHERE tenant_id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'Tenant not found' }, 404);

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.layers) { updates.push('layers = ?'); values.push(JSON.stringify(body.layers)); }
  if (body.catalystClusters) { updates.push('catalyst_clusters = ?'); values.push(JSON.stringify(body.catalystClusters)); }
  if (body.maxAgents !== undefined) { updates.push('max_agents = ?'); values.push(body.maxAgents); }
  if (body.maxUsers !== undefined) { updates.push('max_users = ?'); values.push(body.maxUsers); }
  if (body.autonomyTiers) { updates.push('autonomy_tiers = ?'); values.push(JSON.stringify(body.autonomyTiers)); }
  if (body.llmTiers) { updates.push('llm_tiers = ?'); values.push(JSON.stringify(body.llmTiers)); }
  if (body.features) { updates.push('features = ?'); values.push(JSON.stringify(body.features)); }
  if (body.ssoEnabled !== undefined) { updates.push('sso_enabled = ?'); values.push(body.ssoEnabled ? 1 : 0); }
  if (body.apiAccess !== undefined) { updates.push('api_access = ?'); values.push(body.apiAccess ? 1 : 0); }

  if (updates.length > 0) {
    values.push(id);
    await c.env.DB.prepare(`UPDATE tenant_entitlements SET ${updates.join(', ')} WHERE tenant_id = ?`).bind(...values).run();
  }

  // Cascade entitlement changes to catalyst_clusters
  try {
    // If autonomy_tiers changed, downgrade clusters with tiers no longer allowed
    if (body.autonomyTiers && Array.isArray(body.autonomyTiers)) {
      const allowedTiers = body.autonomyTiers as string[];
      if (allowedTiers.length > 0) {
        const placeholders = allowedTiers.map(() => '?').join(', ');
        await c.env.DB.prepare(
          `UPDATE catalyst_clusters SET autonomy_tier = 'read-only', status = 'inactive' WHERE tenant_id = ? AND autonomy_tier NOT IN (${placeholders})`
        ).bind(id, ...allowedTiers).run();
      } else {
        // No tiers allowed — deactivate all clusters
        await c.env.DB.prepare(
          `UPDATE catalyst_clusters SET autonomy_tier = 'read-only', status = 'inactive' WHERE tenant_id = ?`
        ).bind(id).run();
      }
    }

    // If layers changed and 'catalysts' layer was removed, deactivate all clusters
    if (body.layers && Array.isArray(body.layers)) {
      const allowedLayers = body.layers as string[];
      if (!allowedLayers.includes('catalysts')) {
        await c.env.DB.prepare(
          `UPDATE catalyst_clusters SET status = 'inactive' WHERE tenant_id = ? AND status = 'active'`
        ).bind(id).run();
      }
    }

    // If max_agents changed, enforce cap by suspending excess agent deployments
    if (body.maxAgents !== undefined && typeof body.maxAgents === 'number') {
      const activeCount = await c.env.DB.prepare(
        `SELECT COUNT(*) as count FROM agent_deployments WHERE tenant_id = ? AND status = 'active'`
      ).bind(id).first<{ count: number }>();
      if (activeCount && activeCount.count > body.maxAgents) {
        const excess = activeCount.count - body.maxAgents;
        await c.env.DB.prepare(
          `UPDATE agent_deployments SET status = 'suspended' WHERE id IN (SELECT id FROM agent_deployments WHERE tenant_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT ?)`
        ).bind(id, excess).run();
      }
    }
  } catch (err) {
    console.error('Entitlement cascade to catalyst_clusters failed:', err);
  }

  return c.json({ success: true });
});

// POST /api/tenants/:id/reset- Reset company (delete all insights, start fresh)
tenants.post('/:id/reset', async (c) => {
  const id = c.req.param('id');

  // Verify tenant exists
  const tenant = await c.env.DB.prepare('SELECT id, name FROM tenants WHERE id = ?').bind(id).first();
  if (!tenant) return c.json({ error: 'Tenant not found' }, 404);

  // Use comprehensive tenant-cleanup service (handles 30+ tables in dependency order)
  const result = await cleanupTenantData(c.env.DB, id, true); // preserveUsers=true

  // Re-seed all ERP adapters after reset (global table, not deleted by cleanup,
  // but may be missing on DBs that were seeded before newer adapters were added)
  try {
    const adapters = [
      { id: 'erp-sap-s4', name: 'SAP S/4HANA', system: 'SAP', version: '2025 FPS01', protocol: 'OData V4', operations: '["RFC","BAPI","OData V4","CDS Views","IDoc"]', auth_methods: '["OAuth 2.0","X.509 Certificate","Basic Auth"]' },
      { id: 'erp-sap-ecc', name: 'SAP ECC 6.0', system: 'SAP', version: 'EHP8', protocol: 'RFC/BAPI', operations: '["RFC","BAPI","IDoc","ALE"]', auth_methods: '["SNC","Basic Auth"]' },
      { id: 'erp-oracle', name: 'Oracle Fusion Cloud', system: 'Oracle', version: '26A', protocol: 'REST', operations: '["REST API","SOAP","BI Publisher","OTBI"]', auth_methods: '["OAuth 2.0","JWT Bearer"]' },
      { id: 'erp-d365', name: 'Microsoft Dynamics 365', system: 'Dynamics365', version: '10.0.42', protocol: 'OData v4', operations: '["OData","Custom API","Power Automate","Dataverse"]', auth_methods: '["Azure AD OAuth","Service Principal"]' },
      { id: 'erp-sf', name: 'Salesforce', system: 'Salesforce', version: 'Spring 26', protocol: 'REST/SOAP', operations: '["REST API v66.0","Bulk API 2.0","Pub/Sub API","Metadata API"]', auth_methods: '["OAuth 2.0","JWT Bearer","SAML"]' },
      { id: 'erp-wd', name: 'Workday', system: 'Workday', version: '2025R2', protocol: 'REST/SOAP', operations: '["REST API","SOAP API v45.2","RaaS","EIB","WQL"]', auth_methods: '["OAuth 2.0","X.509","API Key"]' },
      { id: 'erp-ns', name: 'NetSuite', system: 'NetSuite', version: '2026.1', protocol: 'REST/SuiteTalk', operations: '["REST API","SuiteTalk SOAP","SuiteQL","RESTlets"]', auth_methods: '["OAuth 2.0","Token-Based Auth"]' },
      { id: 'erp-sage', name: 'Sage Intacct', system: 'Sage', version: 'R1 2026', protocol: 'REST/XML', operations: '["REST API","XML Gateway","Web Services"]', auth_methods: '["API Key","Session Auth"]' },
      { id: 'erp-xero', name: 'Xero', system: 'Xero', version: '2.0', protocol: 'REST', operations: '["REST API","Webhooks","Bank Feeds","Payroll API"]', auth_methods: '["OAuth 2.0"]' },
      { id: 'erp-sage-bc', name: 'Sage Business Cloud Accounting', system: 'Sage', version: 'v3.1', protocol: 'REST', operations: '["REST API","Webhooks","Banking","Reporting"]', auth_methods: '["OAuth 2.0"]' },
      { id: 'erp-sage-pastel', name: 'Sage Pastel Partner', system: 'Pastel', version: '2026.1', protocol: 'REST/SDK', operations: '["REST API v2","SDK Integration","DDE","ODBC"]', auth_methods: '["API Key","Session Auth","Username/Password"]' },
      { id: 'erp-sage-50', name: 'Sage 50cloud Pastel', system: 'Pastel', version: '2026', protocol: 'REST/SDK', operations: '["REST API v2","SDK","Pastel Connector","CSV Import"]', auth_methods: '["API Key","OAuth 2.0"]' },
      { id: 'erp-sage-intacct', name: 'Sage Intacct', system: 'Sage', version: 'R1 2026', protocol: 'REST/XML', operations: '["REST API","XML Gateway","Web Services","Smart Events"]', auth_methods: '["API Key","Session Auth","OAuth 2.0"]' },
      { id: 'erp-sage-300', name: 'Sage 300 (Accpac)', system: 'Sage', version: '2026', protocol: 'REST/SOAP', operations: '["REST API","SOAP","Views API","Macros"]', auth_methods: '["API Key","Session Auth"]' },
      { id: 'erp-sage-x3', name: 'Sage X3', system: 'Sage', version: 'V12', protocol: 'REST/SOAP', operations: '["REST API","SOAP Web Services","Syracuse","Batch Server"]', auth_methods: '["OAuth 2.0","Basic Auth"]' },
      { id: 'erp-odoo', name: 'Odoo ERP', system: 'Odoo', version: '18.0', protocol: 'JSON-RPC/REST', operations: '["JSON-RPC 2.0","REST API v2","XML-RPC","ORM API"]', auth_methods: '["OAuth 2.0","API Key","Session Auth"]' },
    ];
    for (const a of adapters) {
      await c.env.DB.prepare(
        "INSERT OR IGNORE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods) VALUES (?, ?, ?, ?, ?, 'available', ?, ?)"
      ).bind(a.id, a.name, a.system, a.version, a.protocol, a.operations, a.auth_methods).run();
    }
  } catch { /* non-fatal */ }

  // Log the reset action in audit
  try {
    await c.env.DB.prepare(
      'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(), id, 'company.reset', 'admin', 'tenant',
      JSON.stringify({ tenantName: tenant.name, tablesCleared: result.tablesCleared.length, rowsDeleted: result.totalRowsDeleted, durationMs: result.durationMs }),
      'success'
    ).run();
  } catch (err) { console.error('Reset: audit log write failed:', err); }

  return c.json({ success: true, deletedRows: result.totalRowsDeleted, tablesCleared: result.tablesCleared.length });
});

// POST /api/tenants/:id/archive - Archive a company (keep data, mark inactive)
tenants.post('/:id/archive', async (c) => {
  const id = c.req.param('id');

  const tenant = await c.env.DB.prepare('SELECT id, name, status FROM tenants WHERE id = ?').bind(id).first();
  if (!tenant) return c.json({ error: 'Tenant not found' }, 404);
  if (tenant.status === 'archived') return c.json({ error: 'Tenant is already archived' }, 400);

  // Mark tenant as archived
  await c.env.DB.prepare(
    "UPDATE tenants SET status = 'archived', updated_at = datetime('now') WHERE id = ?"
  ).bind(id).run();

  // Deactivate all catalyst clusters
  const clusterResult = await c.env.DB.prepare(
    "UPDATE catalyst_clusters SET status = 'inactive' WHERE tenant_id = ? AND status = 'active'"
  ).bind(id).run();
  const clustersDeactivated = clusterResult.meta?.changes || 0;

  // Suspend all agent deployments
  const agentResult = await c.env.DB.prepare(
    "UPDATE agent_deployments SET status = 'suspended' WHERE tenant_id = ? AND status IN ('running', 'active', 'deploying')"
  ).bind(id).run();
  const agentsDeactivated = agentResult.meta?.changes || 0;

  // Audit log
  try {
    await c.env.DB.prepare(
      'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(), id, 'company.archived', 'admin', 'tenant',
      JSON.stringify({ tenantName: tenant.name, clustersDeactivated, agentsDeactivated }),
      'success'
    ).run();
  } catch { /* non-fatal */ }

  return c.json({ success: true, clustersDeactivated, agentsDeactivated });
});

// POST /api/tenants/:id/unarchive - Restore an archived company
tenants.post('/:id/unarchive', async (c) => {
  const id = c.req.param('id');

  const tenant = await c.env.DB.prepare('SELECT id, name, status FROM tenants WHERE id = ?').bind(id).first();
  if (!tenant) return c.json({ error: 'Tenant not found' }, 404);
  if (tenant.status !== 'archived') return c.json({ error: 'Tenant is not archived' }, 400);

  // Restore tenant to active
  await c.env.DB.prepare(
    "UPDATE tenants SET status = 'active', updated_at = datetime('now') WHERE id = ?"
  ).bind(id).run();

  // Audit log
  try {
    await c.env.DB.prepare(
      'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(), id, 'company.unarchived', 'admin', 'tenant',
      JSON.stringify({ tenantName: tenant.name }),
      'success'
    ).run();
  } catch { /* non-fatal */ }

  return c.json({ success: true });
});

// DELETE /api/tenants/:id - Permanently delete a company and ALL its data
tenants.delete('/:id', async (c) => {
  const id = c.req.param('id');

  const tenant = await c.env.DB.prepare('SELECT id, name FROM tenants WHERE id = ?').bind(id).first();
  if (!tenant) return c.json({ error: 'Tenant not found' }, 404);

  // Record deletion so seed functions don't re-create this tenant
  try {
    await c.env.DB.prepare(
      'INSERT OR IGNORE INTO deleted_tenants (tenant_id) VALUES (?)'
    ).bind(id).run();
  } catch { /* table may not exist pre-v29 — non-fatal */ }

  // Delete all tenant data from all tables (same as reset but also deletes users)
  const result = await cleanupTenantData(c.env.DB, id, false); // preserveUsers=false

  // Delete users (including admins)
  try {
    const del = await c.env.DB.prepare('DELETE FROM users WHERE tenant_id = ?').bind(id).run();
    result.totalRowsDeleted += del.meta?.changes || 0;
  } catch { /* non-fatal */ }

  // Delete tenant entitlements
  try {
    const del = await c.env.DB.prepare('DELETE FROM tenant_entitlements WHERE tenant_id = ?').bind(id).run();
    result.totalRowsDeleted += del.meta?.changes || 0;
  } catch { /* non-fatal */ }

  // Delete the tenant record itself
  try {
    await c.env.DB.prepare('DELETE FROM tenants WHERE id = ?').bind(id).run();
    result.totalRowsDeleted += 1;
  } catch { /* non-fatal */ }

  return c.json({
    success: true,
    deletedRows: result.totalRowsDeleted,
    tablesCleared: result.tablesCleared.length + 2, // +2 for tenant_entitlements and tenants
  });
});

export default tenants;
