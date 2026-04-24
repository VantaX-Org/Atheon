/**
 * Feature Flags API (v46-platform)
 * Superadmin-managed flag store with three evaluation strategies:
 *   - boolean: flip `default_enabled` on/off for everyone
 *   - percent: deterministic hash of (tenant_id + flag_name) modulo 100 < rollout_percent
 *   - tenant_allowlist: JSON array of tenant IDs that opt-in explicitly
 *
 * Every authenticated user can hit /evaluate to get the resolved flag map for
 * their own tenant; the admin CRUD endpoints are gated to role === 'superadmin'.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';

const featureFlags = new Hono<AppBindings>();

/** Shape of a persisted feature flag row. */
export interface FeatureFlagRow {
  id: string;
  name: string;
  description: string | null;
  type: 'boolean' | 'percent' | 'tenant_allowlist';
  default_enabled: number;
  rollout_percent: number;
  tenant_allowlist: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Valid flag types accepted by the create/update endpoints. */
const VALID_TYPES = new Set<FeatureFlagRow['type']>(['boolean', 'percent', 'tenant_allowlist']);

/** Require superadmin role. Returns 403 response or null if allowed. */
function requireSuperadmin(c: Context<AppBindings>): Response | null {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth) return c.json({ error: 'Unauthorized', message: 'Authentication required' }, 401);
  if (auth.role !== 'superadmin') {
    return c.json({ error: 'Forbidden', message: 'Superadmin role required' }, 403);
  }
  return null;
}

/** Format a flag row for the API response. */
function formatFlag(row: FeatureFlagRow): Record<string, unknown> {
  let allowlist: string[] = [];
  try {
    allowlist = JSON.parse(row.tenant_allowlist || '[]');
  } catch {
    allowlist = [];
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    type: row.type,
    defaultEnabled: !!row.default_enabled,
    rolloutPercent: row.rollout_percent,
    tenantAllowlist: Array.isArray(allowlist) ? allowlist : [],
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Deterministic hash of (tenant_id + flag_name) → 0..99.
 * Uses FNV-1a so it's stable across processes / restarts without pulling in
 * a crypto hash for every evaluate() call.
 */
export function hashTenantFlag(tenantId: string, flagName: string): number {
  const input = `${tenantId}:${flagName}`;
  // FNV-1a 32-bit
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash % 100;
}

/**
 * Evaluate whether a flag is ON for the given tenant.
 * Exported so other backend routes can gate features with a single call.
 */
export async function evaluateFeatureFlag(
  db: D1Database,
  flagName: string,
  tenantId: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT * FROM feature_flags WHERE name = ?')
    .bind(flagName)
    .first<FeatureFlagRow>();
  if (!row) return false;
  return evaluateFlagRow(row, tenantId);
}

/** Pure evaluator — exported so the /evaluate endpoint and callers share one code path. */
export function evaluateFlagRow(row: FeatureFlagRow, tenantId: string): boolean {
  if (row.type === 'boolean') {
    return !!row.default_enabled;
  }
  if (row.type === 'percent') {
    const pct = Math.max(0, Math.min(100, row.rollout_percent || 0));
    if (pct <= 0) return false;
    if (pct >= 100) return true;
    return hashTenantFlag(tenantId, row.name) < pct;
  }
  if (row.type === 'tenant_allowlist') {
    let allowlist: string[] = [];
    try { allowlist = JSON.parse(row.tenant_allowlist || '[]'); } catch { allowlist = []; }
    return Array.isArray(allowlist) && allowlist.includes(tenantId);
  }
  return false;
}

// ── Admin CRUD (superadmin only) ────────────────────────────────────────

/** GET /admin/feature-flags — list every flag. */
featureFlags.get('/admin/feature-flags', async (c) => {
  const forbidden = requireSuperadmin(c);
  if (forbidden) return forbidden;

  const results = await c.env.DB.prepare(
    'SELECT * FROM feature_flags ORDER BY created_at DESC'
  ).all<FeatureFlagRow>();

  const flags = (results.results || []).map(formatFlag);
  return c.json({ flags, total: flags.length });
});

/** POST /admin/feature-flags — create a new flag. */
featureFlags.post('/admin/feature-flags', async (c) => {
  const forbidden = requireSuperadmin(c);
  if (forbidden) return forbidden;
  const auth = c.get('auth') as AuthContext;

  const { data: body, errors } = await getValidatedJsonBody<{
    name: string;
    description?: string;
    type?: string;
    default_enabled?: boolean;
    rollout_percent?: number;
    tenant_allowlist?: string[];
  }>(c, [
    { field: 'name', type: 'string', required: true, minLength: 1, maxLength: 100 },
    { field: 'description', type: 'string', required: false, maxLength: 500 },
    { field: 'type', type: 'string', required: false, maxLength: 32 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const type = (body.type || 'boolean') as FeatureFlagRow['type'];
  if (!VALID_TYPES.has(type)) {
    return c.json({ error: 'Invalid type', message: `type must be one of: boolean, percent, tenant_allowlist` }, 400);
  }

  // Normalize name: lowercase + safe chars
  const name = body.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (!name) return c.json({ error: 'Invalid name' }, 400);

  // Reject duplicates explicitly so callers get 409, not a generic 500
  const existing = await c.env.DB.prepare('SELECT id FROM feature_flags WHERE name = ?').bind(name).first();
  if (existing) return c.json({ error: 'Flag already exists', message: `A flag named "${name}" already exists` }, 409);

  const rolloutPercent = Math.max(0, Math.min(100, Number(body.rollout_percent ?? 0) || 0));
  const allowlist = Array.isArray(body.tenant_allowlist) ? body.tenant_allowlist.filter(v => typeof v === 'string') : [];
  const id = crypto.randomUUID();

  await c.env.DB.prepare(
    `INSERT INTO feature_flags (id, name, description, type, default_enabled, rollout_percent, tenant_allowlist, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    name,
    body.description || '',
    type,
    body.default_enabled ? 1 : 0,
    rolloutPercent,
    JSON.stringify(allowlist),
    auth.userId,
  ).run();

  const row = await c.env.DB.prepare('SELECT * FROM feature_flags WHERE id = ?').bind(id).first<FeatureFlagRow>();
  return c.json({ flag: row ? formatFlag(row) : { id, name } }, 201);
});

/** PUT /admin/feature-flags/:id — update flag fields. */
featureFlags.put('/admin/feature-flags/:id', async (c) => {
  const forbidden = requireSuperadmin(c);
  if (forbidden) return forbidden;

  const id = c.req.param('id');
  const { data: body, errors } = await getValidatedJsonBody<{
    description?: string;
    type?: string;
    default_enabled?: boolean;
    rollout_percent?: number;
    tenant_allowlist?: string[];
  }>(c, [
    { field: 'description', type: 'string', required: false, maxLength: 500 },
    { field: 'type', type: 'string', required: false, maxLength: 32 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const existing = await c.env.DB.prepare('SELECT * FROM feature_flags WHERE id = ?').bind(id).first<FeatureFlagRow>();
  if (!existing) return c.json({ error: 'Flag not found' }, 404);

  const updates: string[] = [];
  const values: (string | number)[] = [];

  if (body.description !== undefined) { updates.push('description = ?'); values.push(body.description); }
  if (body.type !== undefined) {
    if (!VALID_TYPES.has(body.type as FeatureFlagRow['type'])) {
      return c.json({ error: 'Invalid type' }, 400);
    }
    updates.push('type = ?'); values.push(body.type);
  }
  if (body.default_enabled !== undefined) { updates.push('default_enabled = ?'); values.push(body.default_enabled ? 1 : 0); }
  if (body.rollout_percent !== undefined) {
    const pct = Math.max(0, Math.min(100, Number(body.rollout_percent) || 0));
    updates.push('rollout_percent = ?'); values.push(pct);
  }
  if (body.tenant_allowlist !== undefined) {
    const allowlist = Array.isArray(body.tenant_allowlist) ? body.tenant_allowlist.filter(v => typeof v === 'string') : [];
    updates.push('tenant_allowlist = ?'); values.push(JSON.stringify(allowlist));
  }

  if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400);
  updates.push("updated_at = datetime('now')");

  values.push(id);
  await c.env.DB.prepare(`UPDATE feature_flags SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

  const row = await c.env.DB.prepare('SELECT * FROM feature_flags WHERE id = ?').bind(id).first<FeatureFlagRow>();
  return c.json({ flag: row ? formatFlag(row) : null });
});

/** DELETE /admin/feature-flags/:id */
featureFlags.delete('/admin/feature-flags/:id', async (c) => {
  const forbidden = requireSuperadmin(c);
  if (forbidden) return forbidden;

  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT id FROM feature_flags WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'Flag not found' }, 404);
  await c.env.DB.prepare('DELETE FROM feature_flags WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

/** POST /admin/feature-flags/:id/toggle — flip default_enabled. */
featureFlags.post('/admin/feature-flags/:id/toggle', async (c) => {
  const forbidden = requireSuperadmin(c);
  if (forbidden) return forbidden;

  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT * FROM feature_flags WHERE id = ?').bind(id).first<FeatureFlagRow>();
  if (!row) return c.json({ error: 'Flag not found' }, 404);

  const next = row.default_enabled ? 0 : 1;
  await c.env.DB.prepare(
    "UPDATE feature_flags SET default_enabled = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(next, id).run();

  const updated = await c.env.DB.prepare('SELECT * FROM feature_flags WHERE id = ?').bind(id).first<FeatureFlagRow>();
  return c.json({ flag: updated ? formatFlag(updated) : null });
});

// ── Tenant-scoped evaluation (authenticated) ────────────────────────────

/** GET /feature-flags/evaluate — resolved flag map for the current tenant. */
featureFlags.get('/feature-flags/evaluate', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth) return c.json({ error: 'Unauthorized' }, 401);

  // Superadmin can pass ?tenant_id=... for the dev tool "evaluate as tenant"
  const requestedTenant = c.req.query('tenant_id');
  const tenantId =
    (auth.role === 'superadmin' || auth.role === 'support_admin') && requestedTenant
      ? requestedTenant
      : auth.tenantId;

  const results = await c.env.DB.prepare('SELECT * FROM feature_flags').all<FeatureFlagRow>();
  const flags: Record<string, boolean> = {};
  for (const row of results.results || []) {
    flags[row.name] = evaluateFlagRow(row, tenantId);
  }
  return c.json({ flags, tenantId });
});

export default featureFlags;
