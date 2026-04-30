/**
 * Auto-migration bounding contract — locks the behaviour added after the
 * 2026-04-30 production incident where the v56-stripe-checkout migration
 * hung on every /api/* request because the KV `db:migrated:<version>`
 * flag was never set.
 *
 * What this test pins:
 *   1. KV='true'    → request passes through (200 / 4xx, never 503)
 *   2. KV='error'   → request returns 503 with reason='error'
 *   3. KV='timeout' → request returns 503 with reason='timeout'
 *   4. KV missing + KV lease present → 503 reason='migration_in_progress'
 *
 * The actual hard-timeout race against runMigrations is exercised
 * implicitly by the existing smoke test (which boots a fresh DB and
 * succeeds); reproducing a hang in CI without slowing the whole suite
 * isn't worth the flake risk.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { MIGRATION_VERSION } from '../services/migrate';

const FLAG_KEY = `db:migrated:${MIGRATION_VERSION}`;
const LEASE_KEY = `db:migrating:${MIGRATION_VERSION}`;

async function setFlag(value: string | null): Promise<void> {
  if (value === null) {
    await env.CACHE.delete(FLAG_KEY);
  } else {
    await env.CACHE.put(FLAG_KEY, value, { expirationTtl: 60 });
  }
}
async function setLease(value: string | null): Promise<void> {
  if (value === null) {
    await env.CACHE.delete(LEASE_KEY);
  } else {
    await env.CACHE.put(LEASE_KEY, value, { expirationTtl: 60 });
  }
}

async function migrateViaEndpoint(): Promise<void> {
  const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
    method: 'POST',
    headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
  });
  if (res.status !== 200) throw new Error(`Migration returned ${res.status}`);
}

describe('Auto-migration bounding contract', () => {
  beforeAll(async () => {
    await migrateViaEndpoint();
  });

  beforeEach(async () => {
    await setLease(null);
  });

  it("passes through when KV flag = 'true'", async () => {
    await setFlag('true');
    const res = await SELF.fetch('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    // login with empty body should be 4xx (validation), never 503
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("returns 503 with reason='error' when KV flag = 'error'", async () => {
    await setFlag('error');
    const res = await SELF.fetch('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(503);
    const body = await res.json() as { reason?: string; version?: string };
    expect(body.reason).toBe('error');
    expect(body.version).toBe(MIGRATION_VERSION);
    // Restore so subsequent tests don't break.
    await setFlag('true');
  });

  it("returns 503 with reason='timeout' when KV flag = 'timeout'", async () => {
    await setFlag('timeout');
    const res = await SELF.fetch('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(503);
    const body = await res.json() as { reason?: string; message?: string };
    expect(body.reason).toBe('timeout');
    expect(body.message).toMatch(/auto-migration timeout/);
    await setFlag('true');
  });

  it("returns 503 with reason='migration_in_progress' when a lease is held", async () => {
    await setFlag(null);
    await setLease('1');
    const res = await SELF.fetch('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(503);
    const body = await res.json() as { reason?: string };
    expect(body.reason).toBe('migration_in_progress');
    await setFlag('true');
    await setLease(null);
  });

  it('/healthz remains accessible regardless of migration KV state', async () => {
    await setFlag('error');
    const res = await SELF.fetch('http://localhost/healthz');
    expect(res.status).toBe(200);
    await setFlag('true');
  });
});
