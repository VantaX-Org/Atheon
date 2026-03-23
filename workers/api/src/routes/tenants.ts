import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';
import { cleanupTenantData } from '../services/tenant-cleanup';

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
