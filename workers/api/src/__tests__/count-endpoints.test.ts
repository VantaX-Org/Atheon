// Coverage for the uncapped count endpoints.
//
// Why they exist: the board digest PDF counts risks/anomalies with an uncapped
// COUNT(*), but the list endpoints page their rows (pulse /anomalies defaults
// to LIMIT 50). With >50 rows the on-screen "total" derived from a list page
// diverged from the digest. These endpoints give the page an authoritative,
// pagination-independent total that reconciles with the digest's COUNT(*).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { env } from 'cloudflare:test';
import { createTestUser, loginUser, authedRequest, request, cleanupTenant } from './helpers';
import { ensureMigrated } from './setup';

const TENANT = 'tenant-count';
const OTHER = 'tenant-count-other';

const RISK_TOTAL = 55;   // > the pulse list LIMIT of 50, so divergence is visible
const RISK_CRITICAL = 12;
const ANOMALY_TOTAL = 55;
const ANOMALY_CRITICAL = 9;

async function createTenant(id: string, name: string) {
  await ensureMigrated();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(id, name, id).run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenant_entitlements (tenant_id, layers, catalyst_clusters, max_agents, max_users)
     VALUES (?, '["apex","pulse","mind","memory"]', '["finance","hr","operations"]', 50, 100)`
  ).bind(id).run();
}

async function seedRisks(tenantId: string, total: number, critical: number) {
  for (let i = 0; i < total; i++) {
    const severity = i < critical ? 'critical' : 'medium';
    await env.DB.prepare(
      `INSERT OR REPLACE INTO risk_alerts (id, tenant_id, title, description, severity, category)
       VALUES (?, ?, ?, ?, ?, 'finance')`
    ).bind(`${tenantId}-risk-${i}`, tenantId, `Risk ${i}`, 'desc', severity).run();
  }
}

async function seedAnomalies(tenantId: string, total: number, critical: number) {
  for (let i = 0; i < total; i++) {
    const severity = i < critical ? 'critical' : 'medium';
    await env.DB.prepare(
      `INSERT OR REPLACE INTO anomalies (id, tenant_id, metric, severity, expected_value, actual_value, deviation)
       VALUES (?, ?, ?, ?, 100, 140, 0.4)`
    ).bind(`${tenantId}-anom-${i}`, tenantId, `metric-${i}`, severity).run();
  }
}

describe('uncapped count endpoints', () => {
  let token = '';

  beforeAll(async () => {
    await createTenant(TENANT, 'VantaX Count Co');
    await createTenant(OTHER, 'Other Co');
    await createTestUser({ email: 'u@count.test', password: 'Passw0rd!23', name: 'U', role: 'manager', tenantId: TENANT });
    await seedRisks(TENANT, RISK_TOTAL, RISK_CRITICAL);
    await seedAnomalies(TENANT, ANOMALY_TOTAL, ANOMALY_CRITICAL);
    // Cross-tenant noise that must NOT be counted.
    await seedRisks(OTHER, 7, 0);
    await seedAnomalies(OTHER, 7, 0);
    token = (await loginUser('u@count.test', 'Passw0rd!23')) ?? '';
  });

  afterAll(async () => {
    await cleanupTenant(TENANT);
    await cleanupTenant(OTHER);
  });

  it('rejects unauthenticated risks/count with 401', async () => {
    const res = await request('/api/v1/apex/risks/count');
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated anomalies/count with 401', async () => {
    const res = await request('/api/v1/pulse/anomalies/count');
    expect(res.status).toBe(401);
  });

  it('GET /apex/risks/count returns the uncapped tenant total', async () => {
    const res = await authedRequest('/api/v1/apex/risks/count', token);
    expect(res.status).toBe(200);
    const body = await res.json() as { count: number };
    expect(body.count).toBe(RISK_TOTAL);
  });

  it('GET /apex/risks/count honours the severity filter', async () => {
    const res = await authedRequest('/api/v1/apex/risks/count?severity=critical', token);
    expect(res.status).toBe(200);
    const body = await res.json() as { count: number };
    expect(body.count).toBe(RISK_CRITICAL);
  });

  it('GET /pulse/anomalies/count exceeds the capped list page (divergence fixed)', async () => {
    const list = await authedRequest('/api/v1/pulse/anomalies', token);
    const listBody = await list.json() as { anomalies: unknown[]; total: number; returned: number; truncated: boolean };
    // The list page caps the returned rows at LIMIT 50, but now exposes the
    // true tenant total (uncapped) so the badge no longer undercounts.
    expect(listBody.returned).toBe(50);
    expect(listBody.anomalies.length).toBe(50);
    expect(listBody.total).toBe(ANOMALY_TOTAL);
    expect(listBody.truncated).toBe(true);

    const res = await authedRequest('/api/v1/pulse/anomalies/count', token);
    expect(res.status).toBe(200);
    const body = await res.json() as { count: number };
    // The count endpoint agrees with the list's uncapped total and exceeds the page.
    expect(body.count).toBe(ANOMALY_TOTAL);
    expect(body.count).toBe(listBody.total);
    expect(body.count).toBeGreaterThan(listBody.returned);
  });

  it('GET /pulse/anomalies/count honours the severity filter', async () => {
    const res = await authedRequest('/api/v1/pulse/anomalies/count?severity=critical', token);
    expect(res.status).toBe(200);
    const body = await res.json() as { count: number };
    expect(body.count).toBe(ANOMALY_CRITICAL);
  });

  it('count endpoints are tenant-scoped (cross-tenant rows excluded)', async () => {
    const risks = await authedRequest('/api/v1/apex/risks/count', token);
    const anomalies = await authedRequest('/api/v1/pulse/anomalies/count', token);
    expect((await risks.json() as { count: number }).count).toBe(RISK_TOTAL);
    expect((await anomalies.json() as { count: number }).count).toBe(ANOMALY_TOTAL);
  });
});
