/**
 * Compliance / SOC 2 evidence pack
 * ═══
 * Read-only aggregation over existing tables. No new schema.
 *
 *   GET /api/v1/compliance/evidence-pack
 *     - Admin+ may read their own tenant.
 *     - Superadmin / support_admin may read any tenant via ?tenant_id=.
 *
 * Frontend renders the response on /compliance as one card per control.
 * Procurement teams typically ask for a JSON dump; the page also offers a
 * "Download" button that just stringifies the same response.
 */

import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { buildEvidencePack } from '../services/compliance-evidence';

const compliance = new Hono<AppBindings>();

function getAuth(c: { get: (key: string) => unknown }): AuthContext | undefined {
  return c.get('auth') as AuthContext | undefined;
}
function isSupportOrAbove(role: string | undefined): boolean {
  return role === 'superadmin' || role === 'support_admin';
}
function isPlatformAdmin(role: string | undefined): boolean {
  return role === 'superadmin' || role === 'support_admin' || role === 'admin';
}

compliance.get('/evidence-pack', async (c) => {
  const auth = getAuth(c);
  if (!auth) return c.json({ error: 'Unauthorized' }, 401);
  if (!isPlatformAdmin(auth.role)) {
    return c.json({ error: 'Forbidden: admin role required' }, 403);
  }

  // Admin: own tenant only. Support+/superadmin: cross-tenant via ?tenant_id=.
  const queryTenantId = c.req.query('tenant_id');
  let tenantId = auth.tenantId;
  if (queryTenantId && queryTenantId !== auth.tenantId) {
    if (!isSupportOrAbove(auth.role)) {
      return c.json({ error: 'Forbidden: cannot view other tenants' }, 403);
    }
    tenantId = queryTenantId;
  }

  try {
    const pack = await buildEvidencePack(c.env.DB, tenantId, auth.userId);

    // Audit-log the access — SOC 2 itself wants evidence of who pulled
    // evidence packs and when.
    try {
      await c.env.DB.prepare(
        'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        crypto.randomUUID(),
        tenantId,
        auth.userId,
        'compliance.evidence_pack.read',
        'platform',
        'compliance',
        'success',
      ).run();
    } catch (auditErr) {
      console.error('Compliance evidence audit log failed (non-fatal):', auditErr);
    }

    return c.json(pack);
  } catch (err) {
    console.error('Evidence pack build failed:', err);
    return c.json({ error: 'Failed to build evidence pack', details: (err as Error).message }, 500);
  }
});

export default compliance;
