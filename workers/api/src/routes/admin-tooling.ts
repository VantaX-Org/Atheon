/**
 * Admin Tooling API (ADMIN-001 to ADMIN-012)
 * Backend endpoints for platform health, support console, company health,
 * impersonation, bulk users, custom roles, revenue, feature flags,
 * data governance, integration health, tenant read access, and system alerts.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AuthContext, AppBindings } from '../types';

const adminTooling = new Hono<AppBindings>();
// CORS is handled by the parent app's middleware — no sub-router override needed

// ── Role hierarchy (mirrored from iam.ts) ───────────────

const ROLE_LEVELS: Record<string, number> = {
  superadmin: 120, support_admin: 110, admin: 100, executive: 90,
  manager: 70, analyst: 50, operator: 40, viewer: 10,
};
const VALID_ROLES = new Set(Object.keys(ROLE_LEVELS));

// ── Helpers ──────────────────────────────────────────────

function getAuth(c: Context<AppBindings>): AuthContext | undefined {
  return c.get('auth') as AuthContext | undefined;
}

function isSuperadmin(c: Context<AppBindings>): boolean {
  const auth = getAuth(c);
  return auth?.role === 'superadmin';
}

function isSupportOrAbove(c: Context<AppBindings>): boolean {
  const auth = getAuth(c);
  return auth?.role === 'superadmin' || auth?.role === 'support_admin';
}

function isPlatformAdmin(c: Context<AppBindings>): boolean {
  const auth = getAuth(c);
  return auth?.role === 'superadmin' || auth?.role === 'support_admin' || auth?.role === 'admin';
}

// ══════════════════════════════════════════════════════════
// ADMIN-001: Platform Health Dashboard (superadmin only)
// ══════════════════════════════════════════════════════════

adminTooling.get('/platform-health', async (c) => {
  if (!isSuperadmin(c)) return c.json({ error: 'Forbidden: Superadmin only' }, 403);

  try {
    const [tenantCount, userCount, dbCheck] = await Promise.all([
      c.env.DB.prepare('SELECT COUNT(*) as count FROM tenants WHERE status != ?').bind('deleted').first(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM users').first(),
      c.env.DB.prepare('SELECT 1 as ok').first(),
    ]);

    // Gather KV performance metrics (last hour)
    let avgResponseMs = 0;
    let totalRequests = 0;
    try {
      const now = Date.now();
      const currentMinute = Math.floor(now / 60000);
      let totalMs = 0;
      for (let m = currentMinute - 60; m <= currentMinute; m++) {
        const raw = await c.env.CACHE.get(`perf:/api:${m}`);
        if (raw) {
          const parsed = JSON.parse(raw) as { count: number; totalMs: number };
          totalRequests += parsed.count;
          totalMs += parsed.totalMs;
        }
      }
      avgResponseMs = totalRequests > 0 ? Math.round(totalMs / totalRequests) : 0;
    } catch { /* non-fatal */ }

    return c.json({
      success: true,
      infrastructure: {
        apiResponseMs: avgResponseMs,
        totalRequestsLastHour: totalRequests,
        dbStatus: dbCheck ? 'healthy' : 'degraded',
        workerStatus: 'healthy',
      },
      tenants: {
        total: (tenantCount as Record<string, unknown>)?.count || 0,
      },
      users: {
        total: (userCount as Record<string, unknown>)?.count || 0,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Platform health failed:', err);
    return c.json({ error: 'Failed to get platform health', details: (err as Error).message }, 500);
  }
});

// ══════════════════════════════════════════════════════════
// ADMIN-002: Support Console (superadmin + support_admin)
// ══════════════════════════════════════════════════════════

adminTooling.get('/support/tenants', async (c) => {
  if (!isSupportOrAbove(c)) return c.json({ error: 'Forbidden' }, 403);

  const q = c.req.query('q') || '';
  try {
    let query = 'SELECT id, name, slug, industry, plan, status, created_at FROM tenants WHERE status != ?';
    const binds: string[] = ['deleted'];
    if (q) {
      query += ' AND (name LIKE ? OR slug LIKE ? OR id LIKE ?)';
      binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    query += ' ORDER BY name ASC LIMIT 50';
    const stmt = c.env.DB.prepare(query);
    const result = await stmt.bind(...binds).all();
    return c.json({ success: true, tenants: result.results || [] });
  } catch (err) {
    return c.json({ error: 'Search failed', details: (err as Error).message }, 500);
  }
});

adminTooling.get('/support/tenant/:id', async (c) => {
  if (!isSupportOrAbove(c)) return c.json({ error: 'Forbidden' }, 403);
  const tenantId = c.req.param('id');
  try {
    const tenant = await c.env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first();
    if (!tenant) return c.json({ error: 'Tenant not found' }, 404);
    const userCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM users WHERE tenant_id = ?').bind(tenantId).first();
    return c.json({ success: true, tenant, userCount: (userCount as Record<string, unknown>)?.count || 0 });
  } catch (err) {
    return c.json({ error: 'Failed', details: (err as Error).message }, 500);
  }
});

// ══════════════════════════════════════════════════════════
// ADMIN-003: Company Health Dashboard (admin + support_admin + superadmin)
// ══════════════════════════════════════════════════════════

adminTooling.get('/company-health', async (c) => {
  if (!isPlatformAdmin(c)) return c.json({ error: 'Forbidden' }, 403);
  const auth = getAuth(c);
  const tenantId = auth?.tenantId;

  try {
    const [users, catalystRuns, recentLogins] = await Promise.all([
      c.env.DB.prepare('SELECT COUNT(*) as count FROM users WHERE tenant_id = ?').bind(tenantId).first(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM sub_catalyst_runs WHERE tenant_id = ?').bind(tenantId).first(),
      c.env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE tenant_id = ? AND last_login_at > datetime('now', '-7 days')").bind(tenantId).first(),
    ]);

    return c.json({
      success: true,
      adoption: {
        totalUsers: (users as Record<string, unknown>)?.count || 0,
        activeUsersLast7d: (recentLogins as Record<string, unknown>)?.count || 0,
      },
      catalysts: {
        totalRuns: (catalystRuns as Record<string, unknown>)?.count || 0,
      },
      tenantId,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return c.json({ error: 'Failed', details: (err as Error).message }, 500);
  }
});

// ══════════════════════════════════════════════════════════
// ADMIN-004: User Impersonation (superadmin + support_admin)
// ══════════════════════════════════════════════════════════

adminTooling.get('/impersonate/users', async (c) => {
  if (!isSupportOrAbove(c)) return c.json({ error: 'Forbidden' }, 403);
  const q = c.req.query('q') || '';
  try {
    let query = 'SELECT id, name, email, role, tenant_id FROM users WHERE 1=1';
    const binds: string[] = [];
    if (q) {
      query += ' AND (name LIKE ? OR email LIKE ?)';
      binds.push(`%${q}%`, `%${q}%`);
    }
    query += ' ORDER BY name ASC LIMIT 50';
    const stmt = c.env.DB.prepare(query);
    const result = binds.length > 0 ? await stmt.bind(...binds).all() : await stmt.all();
    return c.json({ success: true, users: result.results || [] });
  } catch (err) {
    return c.json({ error: 'Search failed', details: (err as Error).message }, 500);
  }
});

adminTooling.post('/impersonate/start', async (c) => {
  if (!isSupportOrAbove(c)) return c.json({ error: 'Forbidden' }, 403);
  const auth = getAuth(c);
  try {
    const { userId } = await c.req.json<{ userId: string }>();
    const user = await c.env.DB.prepare('SELECT id, name, email, role, tenant_id FROM users WHERE id = ?').bind(userId).first();
    if (!user) return c.json({ error: 'User not found' }, 404);

    // Prevent impersonating users with equal or higher privilege than caller
    const callerLevel = ROLE_LEVELS[auth?.role || ''] ?? 0;
    const targetLevel = ROLE_LEVELS[(user as Record<string, unknown>).role as string] ?? 0;
    if (targetLevel >= callerLevel) {
      return c.json({ error: 'Forbidden', message: 'Cannot impersonate a user with equal or higher privilege than your own' }, 403);
    }

    // Log impersonation start
    await c.env.DB.prepare(
      'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(),
      (user as Record<string, unknown>).tenant_id as string,
      auth?.userId || 'system',
      'impersonation_start',
      'admin-tooling',
      `user:${userId}`,
      JSON.stringify({ targetUserId: userId, targetEmail: (user as Record<string, unknown>).email, actorRole: auth?.role }),
      'success',
      new Date().toISOString()
    ).run();

    return c.json({
      success: true,
      impersonation: {
        userId: (user as Record<string, unknown>).id,
        name: (user as Record<string, unknown>).name,
        email: (user as Record<string, unknown>).email,
        role: (user as Record<string, unknown>).role,
        tenantId: (user as Record<string, unknown>).tenant_id,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 min
      },
    });
  } catch (err) {
    return c.json({ error: 'Impersonation failed', details: (err as Error).message }, 500);
  }
});

adminTooling.post('/impersonate/end', async (c) => {
  if (!isSupportOrAbove(c)) return c.json({ error: 'Forbidden' }, 403);
  const auth = getAuth(c);
  try {
    await c.env.DB.prepare(
      'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(), auth?.tenantId || '',
      auth?.userId || 'system', 'impersonation_end',
      'admin-tooling', 'impersonation',
      JSON.stringify({ action: 'impersonation_ended', actorRole: auth?.role }),
      'success', new Date().toISOString()
    ).run();
    return c.json({ success: true, message: 'Impersonation ended' });
  } catch (err) {
    return c.json({ error: 'Failed', details: (err as Error).message }, 500);
  }
});

// ══════════════════════════════════════════════════════════
// ADMIN-005: Bulk User Management (admin + support_admin + superadmin)
// ══════════════════════════════════════════════════════════

adminTooling.get('/bulk-users/export', async (c) => {
  if (!isPlatformAdmin(c)) return c.json({ error: 'Forbidden' }, 403);
  const auth = getAuth(c);

  try {
    // Admin scoped to own tenant, support/superadmin can specify tenant
    const tenantId = isSupportOrAbove(c) ? (c.req.query('tenantId') || auth?.tenantId) : auth?.tenantId;
    const result = await c.env.DB.prepare(
      'SELECT name, email, role, status, created_at FROM users WHERE tenant_id = ? ORDER BY name'
    ).bind(tenantId).all();

    return c.json({ success: true, users: result.results || [], count: result.results?.length || 0 });
  } catch (err) {
    return c.json({ error: 'Export failed', details: (err as Error).message }, 500);
  }
});

adminTooling.post('/bulk-users/import', async (c) => {
  if (!isPlatformAdmin(c)) return c.json({ error: 'Forbidden' }, 403);
  const auth = getAuth(c);
  try {
    const { users } = await c.req.json<{ users: Array<{ name: string; email: string; role: string; department?: string }> }>();
    if (!Array.isArray(users) || users.length === 0) {
      return c.json({ error: 'No users provided' }, 400);
    }

    const tenantId = auth?.tenantId;
    const callerLevel = ROLE_LEVELS[auth?.role || ''] ?? 0;
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const u of users) {
      const role = u.role || 'viewer';
      // Validate role
      if (!VALID_ROLES.has(role)) { errors.push(`Invalid role "${role}" for ${u.email}`); skipped++; continue; }
      // Prevent privilege escalation
      if ((ROLE_LEVELS[role] ?? 0) > callerLevel) { errors.push(`Cannot assign role "${role}" to ${u.email} — exceeds your privilege level`); skipped++; continue; }

      // Check if user already exists
      const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ? AND tenant_id = ?').bind(u.email, tenantId).first();
      if (existing) { skipped++; continue; }

      const permissions = (role === 'superadmin' || role === 'support_admin' || role === 'admin') ? '["*"]' : '["read"]';
      await c.env.DB.prepare(
        'INSERT INTO users (id, tenant_id, name, email, role, permissions, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), tenantId, u.name, u.email, role, permissions, 'active', new Date().toISOString()).run();
      imported++;
    }

    return c.json({ success: true, imported, skipped, total: users.length, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    return c.json({ error: 'Import failed', details: (err as Error).message }, 500);
  }
});

adminTooling.post('/bulk-users/action', async (c) => {
  if (!isPlatformAdmin(c)) return c.json({ error: 'Forbidden' }, 403);
  const auth = getAuth(c);
  const tenantId = isSupportOrAbove(c) ? (c.req.query('tenantId') || auth?.tenantId) : auth?.tenantId;
  const callerLevel = ROLE_LEVELS[auth?.role || ''] ?? 0;
  try {
    const { userIds, action, value } = await c.req.json<{ userIds: string[]; action: string; value?: string }>();
    if (!Array.isArray(userIds) || userIds.length === 0) return c.json({ error: 'No user IDs provided' }, 400);

    // Validate role for change_role action
    if (action === 'change_role' && value) {
      if (!VALID_ROLES.has(value)) return c.json({ error: 'Invalid role', message: `Role "${value}" is not valid. Valid roles: ${[...VALID_ROLES].join(', ')}` }, 400);
      if ((ROLE_LEVELS[value] ?? 0) > callerLevel) return c.json({ error: 'Forbidden', message: `Cannot assign role "${value}" — exceeds your own privilege level` }, 403);
    }

    let affected = 0;
    const skipped: string[] = [];
    for (const id of userIds) {
      // Prevent self-modification
      if (id === auth?.userId) { skipped.push(`${id}: cannot modify yourself`); continue; }

      // Fetch target user's current role for privilege checks
      const target = await c.env.DB.prepare('SELECT id, role FROM users WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first();
      if (!target) { skipped.push(`${id}: user not found`); continue; }
      const targetLevel = ROLE_LEVELS[(target as Record<string, unknown>).role as string] ?? 0;

      // Block operations on users with higher privilege than caller
      if (targetLevel > callerLevel) { skipped.push(`${id}: target has higher privilege`); continue; }
      // For admin callers, also block operations on same-level peers (mirrors iam.ts pattern)
      if (auth?.role === 'admin' && targetLevel >= callerLevel) { skipped.push(`${id}: cannot modify peer admin`); continue; }

      if (action === 'change_role' && value) {
        await c.env.DB.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ? AND tenant_id = ?').bind(value, new Date().toISOString(), id, tenantId).run();
        affected++;
      } else if (action === 'suspend') {
        await c.env.DB.prepare("UPDATE users SET status = 'inactive', updated_at = ? WHERE id = ? AND tenant_id = ?").bind(new Date().toISOString(), id, tenantId).run();
        affected++;
      } else if (action === 'activate') {
        await c.env.DB.prepare("UPDATE users SET status = 'active', updated_at = ? WHERE id = ? AND tenant_id = ?").bind(new Date().toISOString(), id, tenantId).run();
        affected++;
      }
    }

    return c.json({ success: true, action, affected, total: userIds.length, skipped: skipped.length > 0 ? skipped : undefined });
  } catch (err) {
    return c.json({ error: 'Bulk action failed', details: (err as Error).message }, 500);
  }
});

// ══════════════════════════════════════════════════════════
// ADMIN-006: Custom Role Builder (admin + support_admin + superadmin)
// ══════════════════════════════════════════════════════════

adminTooling.get('/custom-roles', async (c) => {
  if (!isPlatformAdmin(c)) return c.json({ error: 'Forbidden' }, 403);
  const auth = getAuth(c);
  const tenantId = auth?.tenantId;

  try {
    const result = await c.env.DB.prepare(
      'SELECT * FROM iam_roles WHERE tenant_id = ? AND is_custom = 1 ORDER BY name'
    ).bind(tenantId).all();

    return c.json({ success: true, roles: result.results || [], count: result.results?.length || 0 });
  } catch {
    // Table may not exist yet — return empty array
    return c.json({ success: true, roles: [], count: 0 });
  }
});

adminTooling.post('/custom-roles', async (c) => {
  if (!isPlatformAdmin(c)) return c.json({ error: 'Forbidden' }, 403);
  const auth = getAuth(c);
  const tenantId = auth?.tenantId;

  try {
    const { name, description, permissions } = await c.req.json<{ name: string; description: string; permissions: string[] }>();

    // Check max 10 custom roles
    const countResult = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM iam_roles WHERE tenant_id = ? AND is_custom = 1'
    ).bind(tenantId).first();
    const currentCount = (countResult as Record<string, unknown>)?.count as number || 0;
    if (currentCount >= 10) return c.json({ error: 'Maximum 10 custom roles per tenant' }, 400);

    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      'INSERT INTO iam_roles (id, tenant_id, name, description, permissions, is_custom, level, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, tenantId, name, description, JSON.stringify(permissions), 1, 50, new Date().toISOString()).run();

    return c.json({ success: true, id, name });
  } catch (err) {
    return c.json({ error: 'Failed to create role', details: (err as Error).message }, 500);
  }
});

adminTooling.delete('/custom-roles/:id', async (c) => {
  if (!isPlatformAdmin(c)) return c.json({ error: 'Forbidden' }, 403);
  const auth = getAuth(c);
  const tenantId = auth?.tenantId;
  const roleId = c.req.param('id');
  try {
    // Look up role name first (users.role stores role names, not UUIDs)
    const role = await c.env.DB.prepare(
      'SELECT name FROM iam_roles WHERE id = ? AND tenant_id = ? AND is_custom = 1'
    ).bind(roleId, tenantId).first();
    if (!role) return c.json({ error: 'Role not found' }, 404);

    // Check no users assigned by role name within same tenant
    const usersAssigned = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM users WHERE role = ? AND tenant_id = ?'
    ).bind((role as Record<string, unknown>).name, tenantId).first();
    if (((usersAssigned as Record<string, unknown>)?.count as number || 0) > 0) {
      return c.json({ error: 'Cannot delete role with assigned users' }, 400);
    }
    await c.env.DB.prepare('DELETE FROM iam_roles WHERE id = ? AND tenant_id = ? AND is_custom = 1').bind(roleId, tenantId).run();
    return c.json({ success: true, message: 'Role deleted' });
  } catch (err) {
    return c.json({ error: 'Failed', details: (err as Error).message }, 500);
  }
});

// ══════════════════════════════════════════════════════════
// ADMIN-007: Revenue & Usage Dashboard (superadmin only)
// ══════════════════════════════════════════════════════════

adminTooling.get('/revenue', async (c) => {
  if (!isSuperadmin(c)) return c.json({ error: 'Forbidden: Superadmin only' }, 403);

  try {
    const [tenants, users] = await Promise.all([
      c.env.DB.prepare("SELECT plan, COUNT(*) as count FROM tenants WHERE status != 'deleted' GROUP BY plan").all(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM users').first(),
    ]);

    // Calculate revenue metrics from tenant plans
    const planPricing: Record<string, number> = { starter: 499, professional: 1499, enterprise: 4999 };
    let mrr = 0;
    const planDistribution: Array<{ plan: string; count: number; revenue: number }> = [];
    for (const row of (tenants.results || []) as Array<Record<string, unknown>>) {
      const plan = row.plan as string;
      const count = row.count as number;
      const revenue = (planPricing[plan] || 0) * count;
      mrr += revenue;
      planDistribution.push({ plan, count, revenue });
    }

    return c.json({
      success: true,
      revenue: {
        mrr,
        arr: mrr * 12,
        arpu: (users as Record<string, unknown>)?.count ? Math.round(mrr / ((users as Record<string, unknown>).count as number)) : 0,
        churnRate: 2.1, // Mock — would need historical tracking
      },
      planDistribution,
      totalUsers: (users as Record<string, unknown>)?.count || 0,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return c.json({ error: 'Failed', details: (err as Error).message }, 500);
  }
});

// ══════════════════════════════════════════════════════════
// ADMIN-008: Feature Flags System (superadmin only)
// ══════════════════════════════════════════════════════════

adminTooling.get('/feature-flags', async (c) => {
  if (!isSuperadmin(c)) return c.json({ error: 'Forbidden: Superadmin only' }, 403);

  try {
    // Try reading from KV first
    const flagsRaw = await c.env.CACHE.get('feature_flags');
    const flags = flagsRaw ? JSON.parse(flagsRaw) : [];
    return c.json({ success: true, flags });
  } catch {
    return c.json({ success: true, flags: [] });
  }
});

adminTooling.post('/feature-flags', async (c) => {
  if (!isSuperadmin(c)) return c.json({ error: 'Forbidden: Superadmin only' }, 403);

  try {
    const flag = await c.req.json<{ key: string; name: string; type: string; enabled: boolean; value?: unknown; environment?: string }>();
    // Read existing flags
    const flagsRaw = await c.env.CACHE.get('feature_flags');
    const flags = flagsRaw ? JSON.parse(flagsRaw) as Array<Record<string, unknown>> : [];

    // Check duplicate
    if (flags.find((f: Record<string, unknown>) => f.key === flag.key)) {
      return c.json({ error: 'Flag key already exists' }, 400);
    }

    flags.push({ ...flag, id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await c.env.CACHE.put('feature_flags', JSON.stringify(flags));

    return c.json({ success: true, message: 'Flag created', flag });
  } catch (err) {
    return c.json({ error: 'Failed', details: (err as Error).message }, 500);
  }
});

adminTooling.put('/feature-flags/:key', async (c) => {
  if (!isSuperadmin(c)) return c.json({ error: 'Forbidden: Superadmin only' }, 403);
  const key = c.req.param('key');

  try {
    const update = await c.req.json<{ enabled?: boolean; value?: unknown }>();
    const flagsRaw = await c.env.CACHE.get('feature_flags');
    const flags = flagsRaw ? JSON.parse(flagsRaw) as Array<Record<string, unknown>> : [];

    const idx = flags.findIndex((f: Record<string, unknown>) => f.key === key);
    if (idx === -1) return c.json({ error: 'Flag not found' }, 404);

    if (update.enabled !== undefined) flags[idx].enabled = update.enabled;
    if (update.value !== undefined) flags[idx].value = update.value;
    flags[idx].updatedAt = new Date().toISOString();

    await c.env.CACHE.put('feature_flags', JSON.stringify(flags));
    return c.json({ success: true, flag: flags[idx] });
  } catch (err) {
    return c.json({ error: 'Failed', details: (err as Error).message }, 500);
  }
});

adminTooling.delete('/feature-flags/:key', async (c) => {
  if (!isSuperadmin(c)) return c.json({ error: 'Forbidden: Superadmin only' }, 403);
  const key = c.req.param('key');

  try {
    const flagsRaw = await c.env.CACHE.get('feature_flags');
    const flags = flagsRaw ? JSON.parse(flagsRaw) as Array<Record<string, unknown>> : [];
    const filtered = flags.filter((f: Record<string, unknown>) => f.key !== key);

    if (filtered.length === flags.length) return c.json({ error: 'Flag not found' }, 404);

    await c.env.CACHE.put('feature_flags', JSON.stringify(filtered));
    return c.json({ success: true, message: 'Flag deleted' });
  } catch (err) {
    return c.json({ error: 'Failed', details: (err as Error).message }, 500);
  }
});

// ══════════════════════════════════════════════════════════
// ADMIN-009: Data Governance Dashboard (admin + support_admin + superadmin)
// ══════════════════════════════════════════════════════════

adminTooling.get('/data-governance', async (c) => {
  if (!isPlatformAdmin(c)) return c.json({ error: 'Forbidden' }, 403);
  const auth = getAuth(c);
  const tenantId = auth?.tenantId;

  try {
    // Return governance status for tenant
    const govRaw = await c.env.CACHE.get(`governance:${tenantId}`);
    const governance = govRaw ? JSON.parse(govRaw) : {
      retention: { catalystRuns: 365, auditLogs: 730, metrics: 180, alerts: 90 },
      encryption: { atRest: 'AES-256', inTransit: 'TLS 1.3', database: true, jwt: true },
      compliance: { gdpr: true, popia: true, lastAudit: null },
    };
    return c.json({ success: true, governance, tenantId });
  } catch (err) {
    return c.json({ error: 'Failed', details: (err as Error).message }, 500);
  }
});

adminTooling.post('/data-governance/dsar', async (c) => {
  if (!isPlatformAdmin(c)) return c.json({ error: 'Forbidden' }, 403);
  const auth = getAuth(c);
  try {
    const { type, subjectEmail, notes } = await c.req.json<{ type: string; subjectEmail: string; notes?: string }>();

    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, auth?.tenantId || '', auth?.userId || 'system', `dsar_${type}`,
      'admin-tooling', `dsar:${subjectEmail}`,
      JSON.stringify({ subjectEmail, notes, dsarType: type, actorRole: auth?.role }),
      'success', new Date().toISOString()
    ).run();

    return c.json({ success: true, dsarId: id, type, subjectEmail, status: 'pending' });
  } catch (err) {
    return c.json({ error: 'Failed', details: (err as Error).message }, 500);
  }
});

// ══════════════════════════════════════════════════════════
// ADMIN-010: Integration Health Monitoring (admin + support_admin + superadmin)
// ══════════════════════════════════════════════════════════

adminTooling.get('/integration-health', async (c) => {
  if (!isPlatformAdmin(c)) return c.json({ error: 'Forbidden' }, 403);
  const auth = getAuth(c);
  const tenantId = auth?.tenantId;

  try {
    // Get ERP connections for tenant
    const connections = await c.env.DB.prepare(
      'SELECT * FROM erp_connections WHERE tenant_id = ? ORDER BY display_name'
    ).bind(tenantId).all();

    return c.json({ success: true, connections: connections.results || [] });
  } catch {
    // Table may not exist
    return c.json({ success: true, connections: [] });
  }
});

// ══════════════════════════════════════════════════════════
// ADMIN-011: Support Tenant Read Access (support_admin read-only)
// ══════════════════════════════════════════════════════════

adminTooling.get('/tenants-read', async (c) => {
  if (!isSupportOrAbove(c)) return c.json({ error: 'Forbidden' }, 403);

  try {
    const result = await c.env.DB.prepare(
      "SELECT id, name, slug, industry, plan, status, region, created_at FROM tenants WHERE status != 'deleted' ORDER BY name ASC"
    ).all();

    return c.json({ success: true, tenants: result.results || [], count: result.results?.length || 0 });
  } catch (err) {
    return c.json({ error: 'Failed', details: (err as Error).message }, 500);
  }
});

adminTooling.get('/tenants-read/:id', async (c) => {
  if (!isSupportOrAbove(c)) return c.json({ error: 'Forbidden' }, 403);
  const tenantId = c.req.param('id');

  try {
    const tenant = await c.env.DB.prepare(
      'SELECT id, name, slug, industry, plan, status, region, created_at, updated_at FROM tenants WHERE id = ?'
    ).bind(tenantId).first();
    if (!tenant) return c.json({ error: 'Tenant not found' }, 404);

    const [userCount, runCount] = await Promise.all([
      c.env.DB.prepare('SELECT COUNT(*) as count FROM users WHERE tenant_id = ?').bind(tenantId).first(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM sub_catalyst_runs WHERE tenant_id = ?').bind(tenantId).first(),
    ]);

    return c.json({
      success: true,
      tenant,
      stats: {
        users: (userCount as Record<string, unknown>)?.count || 0,
        runs: (runCount as Record<string, unknown>)?.count || 0,
      },
    });
  } catch (err) {
    return c.json({ error: 'Failed', details: (err as Error).message }, 500);
  }
});

// ══════════════════════════════════════════════════════════
// ADMIN-012: System Alerts & Notification Rules (admin + support_admin + superadmin)
// ══════════════════════════════════════════════════════════

adminTooling.get('/system-alerts', async (c) => {
  if (!isPlatformAdmin(c)) return c.json({ error: 'Forbidden' }, 403);
  const auth = getAuth(c);
  const tenantId = auth?.tenantId;

  try {
    const alertsRaw = await c.env.CACHE.get(`alerts:${tenantId}`);
    const alerts = alertsRaw ? JSON.parse(alertsRaw) : [];
    return c.json({ success: true, alerts });
  } catch {
    return c.json({ success: true, alerts: [] });
  }
});

adminTooling.get('/system-alerts/rules', async (c) => {
  if (!isPlatformAdmin(c)) return c.json({ error: 'Forbidden' }, 403);
  const auth = getAuth(c);
  const tenantId = auth?.tenantId;

  try {
    const rulesRaw = await c.env.CACHE.get(`alert_rules:${tenantId}`);
    const rules = rulesRaw ? JSON.parse(rulesRaw) : [];
    return c.json({ success: true, rules });
  } catch {
    return c.json({ success: true, rules: [] });
  }
});

adminTooling.post('/system-alerts/rules', async (c) => {
  if (!isPlatformAdmin(c)) return c.json({ error: 'Forbidden' }, 403);
  const auth = getAuth(c);
  const tenantId = auth?.tenantId;

  try {
    const rule = await c.req.json<{ name: string; condition: string; severity: string; channels: string[]; cooldownMinutes?: number }>();

    const rulesRaw = await c.env.CACHE.get(`alert_rules:${tenantId}`);
    const rules = rulesRaw ? JSON.parse(rulesRaw) as Array<Record<string, unknown>> : [];

    rules.push({
      id: crypto.randomUUID(),
      ...rule,
      enabled: true,
      triggerCount: 0,
      createdAt: new Date().toISOString(),
    });

    await c.env.CACHE.put(`alert_rules:${tenantId}`, JSON.stringify(rules));
    return c.json({ success: true, message: 'Alert rule created', rule });
  } catch (err) {
    return c.json({ error: 'Failed', details: (err as Error).message }, 500);
  }
});

adminTooling.put('/system-alerts/rules/:id', async (c) => {
  if (!isPlatformAdmin(c)) return c.json({ error: 'Forbidden' }, 403);
  const auth = getAuth(c);
  const tenantId = auth?.tenantId;
  const ruleId = c.req.param('id');

  try {
    const update = await c.req.json<{ enabled?: boolean; name?: string; condition?: string; severity?: string }>();
    const rulesRaw = await c.env.CACHE.get(`alert_rules:${tenantId}`);
    const rules = rulesRaw ? JSON.parse(rulesRaw) as Array<Record<string, unknown>> : [];

    const idx = rules.findIndex((r: Record<string, unknown>) => r.id === ruleId);
    if (idx === -1) return c.json({ error: 'Rule not found' }, 404);

    if (update.enabled !== undefined) rules[idx].enabled = update.enabled;
    if (update.name !== undefined) rules[idx].name = update.name;
    if (update.condition !== undefined) rules[idx].condition = update.condition;
    if (update.severity !== undefined) rules[idx].severity = update.severity;
    rules[idx].updatedAt = new Date().toISOString();
    await c.env.CACHE.put(`alert_rules:${tenantId}`, JSON.stringify(rules));

    return c.json({ success: true, rule: rules[idx] });
  } catch (err) {
    return c.json({ error: 'Failed', details: (err as Error).message }, 500);
  }
});

export default adminTooling;
