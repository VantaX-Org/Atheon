/**
 * Audit pack evidence tests — the compliance bundle customers hand to
 * auditors. Two things must hold or the pack lies to an auditor:
 *
 *   1. mfaCoveragePct is the real enabled/total ratio (rounded to 0.1),
 *      and an admin who never enrolled with no grace window is counted
 *      as adminsExpiredGrace (the high-risk number).
 *   2. On a tenant with no users / audit_log / tickets, the collectors
 *      return zeroed evidence — never NaN, never a divide-by-zero throw.
 *
 * These pin the two properties the existing compliance-evidence suite
 * leaves open: the coverage-percent maths and empty-tenant safety.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  collectMfaPosture,
  collectAccessReviews,
  collectConfigChanges,
  collectIncidentResponse,
  collectDeprovisioning,
  collectEncryption,
  collectAuditRetention,
} from '../services/compliance-evidence';

const TENANT = 'auditpack-test-tenant';
const EMPTY = 'auditpack-empty-tenant';

async function migrate(): Promise<void> {
  const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
    method: 'POST',
    headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
  });
  if (res.status !== 200) throw new Error(`Migration endpoint returned ${res.status}`);
}

async function seedTenant(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`,
  ).bind(id, `Audit Pack ${id}`, id).run();
}

beforeAll(async () => {
  await migrate();

  // Wipe both fixtures, then seed.
  for (const id of [TENANT, EMPTY]) {
    await env.DB.prepare(`DELETE FROM users WHERE tenant_id = ?`).bind(id).run();
    await env.DB.prepare(`DELETE FROM audit_log WHERE tenant_id = ?`).bind(id).run();
    await env.DB.prepare(`DELETE FROM support_tickets WHERE tenant_id = ?`).bind(id).run();
    await env.DB.prepare(`DELETE FROM erp_connections WHERE tenant_id = ?`).bind(id).run();
    await env.DB.prepare(`DELETE FROM provenance_chain WHERE tenant_id = ?`).bind(id).run();
    await seedTenant(id);
  }

  // TENANT: 3 ACTIVE users — 1 mfa on, 2 mfa off → 1/3 = 33.3%.
  //   admin mfa=1        → enabled, not at risk
  //   admin mfa=0 no grace → adminsExpiredGrace (never enrolled, grace absent)
  //   analyst mfa=0      → drags coverage down, not an admin
  // Plus one DISABLED user with mfa=1 that must NOT count toward coverage
  // (only status='active' users are in scope).
  await env.DB.prepare(
    `INSERT INTO users (id, tenant_id, email, name, role, permissions, status, mfa_enabled, mfa_grace_until) VALUES
     (?, ?, 'ap-admin-on@x.co',  'AdminOn',  'admin',   '[]', 'active',   1, NULL),
     (?, ?, 'ap-admin-off@x.co', 'AdminOff', 'admin',   '[]', 'active',   0, NULL),
     (?, ?, 'ap-analyst@x.co',   'Analyst',  'analyst', '[]', 'active',   0, NULL),
     (?, ?, 'ap-gone@x.co',      'Gone',     'admin',   '[]', 'disabled', 1, NULL)`,
  ).bind(
    'ap-u1', TENANT,
    'ap-u2', TENANT,
    'ap-u3', TENANT,
    'ap-u4', TENANT,
  ).run();
});

describe('collectMfaPosture', () => {
  it('computes mfaCoveragePct as enabled/total*100 over ACTIVE users, rounded to 0.1', async () => {
    const ev = await collectMfaPosture(env.DB, TENANT);
    expect(ev.totalUsers).toBe(3); // disabled user excluded
    expect(ev.mfaEnabled).toBe(1);
    expect(ev.mfaCoveragePct).toBe(33.3); // round(1/3 * 1000) / 10
  });

  it('counts an admin with mfa_enabled=0 and no grace as adminsExpiredGrace', async () => {
    const ev = await collectMfaPosture(env.DB, TENANT);
    expect(ev.adminsExpiredGrace).toBe(1);
    expect(ev.adminsInGracePeriod).toBe(0);
  });
});

describe('empty-tenant safety', () => {
  it('collectMfaPosture returns zeroed evidence, no NaN, no divide-by-zero', async () => {
    const ev = await collectMfaPosture(env.DB, EMPTY);
    expect(ev.totalUsers).toBe(0);
    expect(ev.mfaEnabled).toBe(0);
    expect(ev.mfaCoveragePct).toBe(0);
    expect(Number.isNaN(ev.mfaCoveragePct)).toBe(false);
    expect(ev.adminsInGracePeriod).toBe(0);
    expect(ev.adminsExpiredGrace).toBe(0);
  });

  it('every collector returns zeroed evidence for a tenant with no data', async () => {
    const [access, config, incident, deprov, encryption, retention] = await Promise.all([
      collectAccessReviews(env.DB, EMPTY),
      collectConfigChanges(env.DB, EMPTY),
      collectIncidentResponse(env.DB, EMPTY),
      collectDeprovisioning(env.DB, EMPTY),
      collectEncryption(env.DB, EMPTY),
      collectAuditRetention(env.DB, EMPTY),
    ]);

    expect(access).toMatchObject({
      activeAdminCount: 0,
      adminsAssignedLast90d: 0,
      roleChangesLast90d: 0,
      mfaEnabledCount: 0,
      activeUserCount: 0,
    });

    expect(config.changesLast30d).toBe(0);
    expect(config.changesLast90d).toBe(0);
    expect(config.topActions).toEqual([]);

    expect(incident.totalCriticalLast90d).toBe(0);
    expect(incident.resolvedCriticalLast90d).toBe(0);
    expect(incident.openCritical).toBe(0);
    expect(incident.medianResolutionHours).toBeNull(); // median of empty set, not NaN

    expect(deprov).toMatchObject({
      deprovisionedLast90d: 0,
      currentlyDisabled: 0,
      privilegedDisabled: 0,
    });

    expect(encryption).toMatchObject({
      erpEncrypted: 0,
      erpPlaintext: 0,
      totalConnections: 0,
    });

    expect(retention.totalRows).toBe(0);
    expect(retention.oldestEventAt).toBeNull();
    expect(retention.provenanceChainLength).toBe(0);
    expect(typeof retention.oneYearAgo).toBe('string');
  });
});
