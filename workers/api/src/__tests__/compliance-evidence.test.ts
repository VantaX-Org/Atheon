/**
 * Compliance evidence pack tests — exercise the aggregation logic against
 * a real D1 instance. Each test seeds a small fixture and asserts the
 * specific evidence numbers.
 *
 * These tests pin the contract that procurement teams care about: are
 * the access-review counts honest, does MFA posture distinguish "in
 * grace" from "expired", does the incident response median work on a
 * mixed set of resolved + open tickets.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  collectAccessReviews,
  collectMfaPosture,
  collectConfigChanges,
  collectIncidentResponse,
  collectDeprovisioning,
  collectEncryption,
  collectAuditRetention,
  buildEvidencePack,
} from '../services/compliance-evidence';

const TENANT = 'compliance-evidence-test';

async function migrateViaEndpoint(): Promise<void> {
  const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
    method: 'POST',
    headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
  });
  if (res.status !== 200) throw new Error(`Migration endpoint returned ${res.status}`);
}

async function clearTenant(): Promise<void> {
  // Clean fixtures across the tables this test writes to. Order matters
  // for FKs but D1 uses non-strict FK enforcement here.
  await env.DB.prepare(`DELETE FROM audit_log WHERE tenant_id = ?`).bind(TENANT).run();
  await env.DB.prepare(`DELETE FROM users WHERE tenant_id = ?`).bind(TENANT).run();
  await env.DB.prepare(`DELETE FROM support_tickets WHERE tenant_id = ?`).bind(TENANT).run();
  await env.DB.prepare(`DELETE FROM erp_connections WHERE tenant_id = ?`).bind(TENANT).run();
  await env.DB.prepare(`DELETE FROM provenance_chain WHERE tenant_id = ?`).bind(TENANT).run();
  await env.DB.prepare(`DELETE FROM tenants WHERE id = ?`).bind(TENANT).run();
}

beforeAll(async () => {
  await migrateViaEndpoint();
});

beforeEach(async () => {
  await clearTenant();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`,
  ).bind(TENANT, 'Compliance Test', TENANT).run();
});

describe('collectAccessReviews', () => {
  it('counts active admins, MFA-enabled users, and recent role changes', async () => {
    // 2 active admins, 1 with MFA, 1 admin assigned in last 90d.
    await env.DB.prepare(
      `INSERT INTO users (id, tenant_id, email, name, role, permissions, status, mfa_enabled, created_at) VALUES
       (?, ?, 'a1@x.co', 'A1', 'admin',     '[]', 'active', 1, datetime('now', '-200 days')),
       (?, ?, 'a2@x.co', 'A2', 'admin',     '[]', 'active', 0, datetime('now', '-30 days')),
       (?, ?, 'm1@x.co', 'M1', 'analyst',   '[]', 'active', 1, datetime('now', '-100 days'))`,
    ).bind('cu-a1', TENANT, 'cu-a2', TENANT, 'cu-m1', TENANT).run();
    await env.DB.prepare(
      `INSERT INTO audit_log (id, tenant_id, action, layer, resource, outcome, created_at) VALUES
       (?, ?, 'iam.user.role_changed', 'security', 'user', 'success', datetime('now', '-10 days')),
       (?, ?, 'iam.user.invite',       'security', 'user', 'success', datetime('now', '-5 days'))`,
    ).bind('al-1', TENANT, 'al-2', TENANT).run();

    const ev = await collectAccessReviews(env.DB, TENANT);
    expect(ev.activeAdminCount).toBe(2);
    expect(ev.adminsAssignedLast90d).toBe(1);
    expect(ev.roleChangesLast90d).toBe(2);
    expect(ev.mfaEnabledCount).toBe(2);
    expect(ev.activeUserCount).toBe(3);
  });
});

describe('collectMfaPosture', () => {
  it('separates admins in grace from admins with expired grace', async () => {
    await env.DB.prepare(
      `INSERT INTO users (id, tenant_id, email, name, role, permissions, status, mfa_enabled, mfa_grace_until) VALUES
       (?, ?, 'g1@x.co', 'G1', 'admin', '[]', 'active', 0, datetime('now', '+5 days')),
       (?, ?, 'g2@x.co', 'G2', 'admin', '[]', 'active', 0, datetime('now', '-5 days')),
       (?, ?, 'g3@x.co', 'G3', 'admin', '[]', 'active', 1, NULL),
       (?, ?, 'g4@x.co', 'G4', 'analyst', '[]', 'active', 0, NULL)`,
    ).bind('cm-g1', TENANT, 'cm-g2', TENANT, 'cm-g3', TENANT, 'cm-g4', TENANT).run();

    const ev = await collectMfaPosture(env.DB, TENANT);
    expect(ev.totalUsers).toBe(4);
    expect(ev.mfaEnabled).toBe(1);
    expect(ev.adminsInGracePeriod).toBe(1);
    expect(ev.adminsExpiredGrace).toBe(1);
  });
});

describe('collectConfigChanges', () => {
  it('counts admin-pattern audit_log entries and surfaces the top actions', async () => {
    const inserts = [
      ['cc-1', 'admin.brand.update'],
      ['cc-2', 'admin.brand.update'],
      ['cc-3', 'iam.role.created'],
      ['cc-4', 'sso_login'],
      ['cc-5', 'login'], // not an admin pattern — should be excluded
    ];
    for (const [id, action] of inserts) {
      await env.DB.prepare(
        `INSERT INTO audit_log (id, tenant_id, action, layer, resource, outcome, created_at) VALUES (?, ?, ?, 'platform', 'r', 'success', datetime('now', '-2 days'))`,
      ).bind(id, TENANT, action).run();
    }

    const ev = await collectConfigChanges(env.DB, TENANT);
    expect(ev.changesLast30d).toBe(4);
    expect(ev.changesLast90d).toBe(4);
    expect(ev.topActions[0].action).toBe('admin.brand.update');
    expect(ev.topActions[0].count).toBe(2);
  });
});

describe('collectIncidentResponse', () => {
  it('computes resolution stats for critical/high tickets', async () => {
    // We need a tickets table with a user_id FK to users; seed one.
    await env.DB.prepare(
      `INSERT INTO users (id, tenant_id, email, name, role, permissions, status) VALUES (?, ?, 'tu@x.co', 'Tester', 'admin', '[]', 'active')`,
    ).bind('cu-tu', TENANT).run();
    await env.DB.prepare(
      `INSERT INTO support_tickets (id, tenant_id, user_id, subject, body, category, priority, status, created_at, updated_at) VALUES
       (?, ?, ?, 'Outage', 'b', 'general', 'critical', 'resolved', datetime('now', '-2 days'), datetime('now', '-2 days', '+3 hours')),
       (?, ?, ?, 'Slow',   'b', 'general', 'high',     'resolved', datetime('now', '-3 days'), datetime('now', '-3 days', '+9 hours')),
       (?, ?, ?, 'P1 open','b', 'general', 'critical', 'open',     datetime('now', '-1 day'),  datetime('now', '-1 day'))`,
    ).bind('ci-1', TENANT, 'cu-tu', 'ci-2', TENANT, 'cu-tu', 'ci-3', TENANT, 'cu-tu').run();

    const ev = await collectIncidentResponse(env.DB, TENANT);
    expect(ev.totalCriticalLast90d).toBe(3);
    expect(ev.resolvedCriticalLast90d).toBe(2);
    expect(ev.openCritical).toBe(1);
    expect(ev.medianResolutionHours).toBeGreaterThan(0);
  });
});

describe('collectDeprovisioning', () => {
  it('counts disabled users and flags privileged disabled accounts', async () => {
    await env.DB.prepare(
      `INSERT INTO users (id, tenant_id, email, name, role, permissions, status) VALUES
       (?, ?, 'd1@x.co', 'D1', 'analyst', '[]', 'disabled'),
       (?, ?, 'd2@x.co', 'D2', 'admin',   '[]', 'terminated'),
       (?, ?, 'a1@x.co', 'A1', 'admin',   '[]', 'active')`,
    ).bind('cd-d1', TENANT, 'cd-d2', TENANT, 'cd-a1', TENANT).run();
    await env.DB.prepare(
      `INSERT INTO audit_log (id, tenant_id, action, layer, resource, outcome, created_at) VALUES
       (?, ?, 'iam.user.disabled', 'security', 'user', 'success', datetime('now', '-10 days'))`,
    ).bind('cd-al-1', TENANT).run();

    const ev = await collectDeprovisioning(env.DB, TENANT);
    expect(ev.deprovisionedLast90d).toBe(1);
    expect(ev.currentlyDisabled).toBe(2);
    expect(ev.privilegedDisabled).toBe(1);
  });
});

describe('collectEncryption', () => {
  it('separates encrypted from plaintext ERP connections', async () => {
    // Seed adapters first (FK requirement on erp_connections.adapter_id).
    await env.DB.prepare(
      `INSERT OR IGNORE INTO erp_adapters (id, name, system) VALUES ('ce-adapter-sap', 'SAP', 'sap'), ('ce-adapter-odoo', 'Odoo', 'odoo'), ('ce-adapter-xero', 'Xero', 'xero')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO erp_connections (id, tenant_id, adapter_id, name, status, encrypted_config) VALUES
       (?, ?, 'ce-adapter-sap',  'SAP Prod', 'connected', 'enc:abc'),
       (?, ?, 'ce-adapter-odoo', 'Odoo',     'connected', NULL),
       (?, ?, 'ce-adapter-xero', 'Xero',     'connected', '')`,
    ).bind('ce-1', TENANT, 'ce-2', TENANT, 'ce-3', TENANT).run();

    const ev = await collectEncryption(env.DB, TENANT);
    expect(ev.totalConnections).toBe(3);
    expect(ev.erpEncrypted).toBe(1);
    expect(ev.erpPlaintext).toBe(2);
  });
});

describe('collectAuditRetention', () => {
  it('reports total volume + oldest event + provenance chain length', async () => {
    await env.DB.prepare(
      `INSERT INTO audit_log (id, tenant_id, action, layer, resource, outcome, created_at) VALUES
       (?, ?, 'login', 'auth', 's', 'success', datetime('now', '-400 days')),
       (?, ?, 'login', 'auth', 's', 'success', datetime('now', '-1 day'))`,
    ).bind('cr-1', TENANT, 'cr-2', TENANT).run();
    await env.DB.prepare(
      `INSERT INTO provenance_chain (id, tenant_id, seq, payload_type, payload_hash, payload_json, merkle_root_after) VALUES
       (?, ?, 1, 'catalyst_run.completed', 'h', '{}', 'r1')`,
    ).bind('cp-1', TENANT).run();

    const ev = await collectAuditRetention(env.DB, TENANT);
    expect(ev.totalRows).toBe(2);
    expect(ev.oldestEventAt).toBeTruthy();
    expect(ev.provenanceChainLength).toBe(1);
  });
});

describe('buildEvidencePack', () => {
  it('composes all categories and includes generation metadata', async () => {
    const pack = await buildEvidencePack(env.DB, TENANT, 'test-user-id');
    expect(pack.tenantId).toBe(TENANT);
    expect(pack.generatedBy).toBe('test-user-id');
    expect(typeof pack.generatedAt).toBe('string');
    expect(pack.accessReviews).toBeDefined();
    expect(pack.mfa).toBeDefined();
    expect(pack.configChanges).toBeDefined();
    expect(pack.incidentResponse).toBeDefined();
    expect(pack.deprovisioning).toBeDefined();
    expect(pack.encryption).toBeDefined();
    expect(pack.auditRetention).toBeDefined();
  });
});
