import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ApiClient } from '../lib/client';
import { CONFIG } from '../config';

/**
 * Role-based access control matrix against the live API. For each role we mint a
 * fresh user (admin → POST /iam/users returns a tempPassword), log in as them,
 * and probe the role boundaries that gate the product:
 *
 *   - every role can READ apex/health (dashboards are universally visible);
 *   - only an executive may EXECUTE a catalyst (others get 403 before lookup);
 *   - a viewer cannot create users (admin-only write);
 *   - an auditor CAN read the raw audit log (seeded with the "audit.read"
 *     permission) while a viewer (no audit grant) is denied — access is gated
 *     by the granted permission, not by the role name.
 *
 * Minting real users is destructive-ish but the vantax tenant is a disposable
 * demo, and the emails are randomised so reruns never collide.
 */

const ROLES = ['executive', 'manager', 'analyst', 'operator', 'auditor', 'viewer'] as const;
type Role = (typeof ROLES)[number];

/**
 * Permissions each minted persona carries — mirrors the production seed
 * (migrate.ts). The API gates on the granted permission, not the role name, so
 * these decide outcomes: only `auditor` holds `audit.read`.
 */
const ROLE_PERMISSIONS: Record<Role, string[]> = {
  executive: ['apex.read', 'pulse.read', 'catalysts.read', 'catalysts.execute', 'mind.query'],
  manager: ['pulse.read', 'pulse.write', 'catalysts.read', 'catalysts.execute', 'mind.query', 'memory.read'],
  analyst: ['pulse.read', 'mind.query'],
  operator: ['apex.read', 'pulse.read', 'catalysts.read', 'catalysts.execute', 'mind.query'],
  auditor: ['compliance.read', 'audit.read'],
  viewer: ['dashboard.read'],
};

/** A non-existent cluster id — executive passes the role gate then 404s on lookup. */
const EXECUTE_PATH = '/api/v1/catalysts/clusters/__none__/sub-catalysts/x/execute';

describe('RBAC role matrix (live API)', () => {
  const clients = new Map<Role, ApiClient>();

  beforeAll(async () => {
    const admin = new ApiClient();
    await admin.login();

    for (const role of ROLES) {
      const email = `verify-${role}-${randomUUID().slice(0, 8)}@vantax.co.za`;
      const mint = await admin.authedFetch('/api/v1/iam/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name: `Verify ${role}`, role, permissions: ROLE_PERMISSIONS[role] }),
      });
      if (mint.status !== 201) {
        throw new Error(`mint ${role} failed (${mint.status}): ${await mint.text()}`);
      }
      const { tempPassword } = await mint.json() as { tempPassword: string };
      const client = new ApiClient(email, tempPassword, CONFIG.apiUrl);
      await client.login();
      clients.set(role, client);
    }
  }, 120_000);

  it.each(ROLES)('%s can read apex/health', async (role) => {
    const resp = await clients.get(role)!.authedFetch('/api/v1/apex/health');
    expect(resp.status).toBe(200);
  });

  it('only executive may execute a catalyst; every other role is 403', async () => {
    const exec = await clients.get('executive')!.authedFetch(EXECUTE_PATH, { method: 'POST' });
    // Executive must clear the role gate (not 401/403) AND actually reach cluster
    // lookup — a 5xx would mean the gate errored out, not that it passed, so reject
    // it explicitly rather than letting "not 403" mask a server failure.
    expect(exec.status, 'executive should not be denied at the role gate').not.toBe(403);
    expect(exec.status, 'executive should be authenticated').not.toBe(401);
    expect(exec.status, 'executive should reach lookup, not hit a server error').toBeLessThan(500);

    for (const role of ROLES) {
      if (role === 'executive') continue;
      const resp = await clients.get(role)!.authedFetch(EXECUTE_PATH, { method: 'POST' });
      expect(resp.status, `${role} should be denied catalyst execute`).toBe(403);
    }
  });

  it('viewer cannot create users (admin-only write)', async () => {
    const resp = await clients.get('viewer')!.authedFetch('/api/v1/iam/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `x-${randomUUID().slice(0, 6)}@vantax.co.za`, name: 'x', role: 'viewer' }),
    });
    expect(resp.status).toBe(403);
  });

  it('auditor (audit.read) reads the audit log; viewer (no grant) is denied', async () => {
    const auditorResp = await clients.get('auditor')!.authedFetch('/api/v1/audit/log');
    expect(auditorResp.status, 'auditor holds audit.read → allowed').toBe(200);

    const viewerResp = await clients.get('viewer')!.authedFetch('/api/v1/audit/log');
    expect(viewerResp.status, 'viewer lacks audit.read → denied').toBe(403);
  });
});
