/**
 * Encryption-at-Rest Test Suite
 *
 * Covers audit gaps §1.3 (DSAR exports encrypted in R2) and §8.3 (ERP
 * credentials encrypted in D1):
 *  1. DSAR export writes an encrypted blob to R2
 *  2. DSAR retrieve endpoint decrypts and returns the original payload
 *  3. POST /api/v1/erp/connections with credentials -> encrypted_config set, config = '{}'
 *  4. GET /api/v1/erp/connections round-trips the decrypted config (with secrets redacted)
 *  5. Rotation helper re-encrypts ERP rows with a new key
 *  6. Rotation with a wrong old key fails cleanly (no row overwritten)
 *  7. Rotation endpoint is superadmin-gated
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';
import { encrypt, isEncrypted, decrypt } from '../services/encryption';
import { rotateErpConnectionEncryption } from '../services/encryption-rotation';

// ── Test Fixtures ──
const TEST_PASSWORD = 'SecurePass1!';
const TENANT_ID = 'enc-test-tenant';
const OTHER_TENANT_ID = 'enc-test-other';
const SUPERADMIN_EMAIL = 'enc-super@test.local';
const ADMIN_EMAIL = 'enc-admin@test.local';
const OTHER_ADMIN_EMAIL = 'enc-other@test.local';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const ENCRYPTION_KEY = 'test-encryption-key-32chars-min!';

/** POST JSON */
async function postJSON(path: string, body: Record<string, unknown>, token?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return SELF.fetch(`http://localhost${path}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
}

async function authedGet(path: string, token: string): Promise<Response> {
  return SELF.fetch(`http://localhost${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function seedTenant(id: string, slug: string, name: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, industry, plan, status) VALUES (?, ?, ?, 'technology', 'enterprise', 'active')`
  ).bind(id, name, slug).run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenant_entitlements (tenant_id, layers, catalyst_clusters, max_agents, max_users) VALUES (?, '["apex","pulse","mind","memory"]', '["finance"]', 50, 100)`
  ).bind(id).run();
}

async function seedUser(id: string, tenantId: string, email: string, role: string): Promise<void> {
  const hash = await hashPassword(TEST_PASSWORD);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`
  ).bind(id, tenantId, email, email, role, hash, JSON.stringify(['*'])).run();
}

async function login(email: string, tenantSlug: string): Promise<string> {
  const res = await postJSON('/api/v1/auth/login', { email, password: TEST_PASSWORD, tenant_slug: tenantSlug });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  const data = await res.json() as { token: string };
  return data.token;
}

/** Ensure an adapter row exists so POST /connections has a valid adapter_id */
async function seedAdapter(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods)
     VALUES (?, 'Test Adapter', 'Test', '1.0', 'REST', 'available', '[]', '[]')`
  ).bind(id).run();
}

// ──────────────────────────────────────────────

describe('Encryption at Rest', () => {
  beforeAll(async () => {
    // Ensure schema is migrated and the KV migrated flag is set
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST',
      headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);

    await seedTenant(TENANT_ID, TENANT_ID, 'Enc Test Tenant');
    await seedTenant(OTHER_TENANT_ID, OTHER_TENANT_ID, 'Other Enc Tenant');
    await seedUser('enc-super', TENANT_ID, SUPERADMIN_EMAIL, 'superadmin');
    await seedUser('enc-admin', TENANT_ID, ADMIN_EMAIL, 'admin');
    await seedUser('enc-other-admin', OTHER_TENANT_ID, OTHER_ADMIN_EMAIL, 'admin');
    await seedAdapter('enc-test-adapter');
  });

  beforeEach(async () => {
    // Clear erp connections so each test starts clean
    await env.DB.prepare('DELETE FROM erp_connections WHERE tenant_id = ? OR tenant_id = ?')
      .bind(TENANT_ID, OTHER_TENANT_ID).run();
  });

  // ── §1.3: DSAR export encryption ──

  describe('DSAR export (audit 1.3)', () => {
    it('writes an encrypted blob to R2 (body is ciphertext, not plaintext JSON)', async () => {
      const token = await login(SUPERADMIN_EMAIL, TENANT_ID);
      const res = await authedGet('/api/v1/tenants/data-export', token);
      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean; r2Key: string; encrypted: boolean; data: Record<string, unknown> };
      expect(body.success).toBe(true);
      expect(body.encrypted).toBe(true);
      expect(body.r2Key).toMatch(/^popia-export\//);
      // Plaintext response still includes PII (user is authenticated data subject)
      expect(body.data).toHaveProperty('users');

      // Fetch the R2 object directly and verify it is ciphertext, not JSON
      const obj = await env.STORAGE.get(body.r2Key);
      expect(obj).not.toBeNull();
      const r2Body = await obj!.text();
      expect(isEncrypted(r2Body)).toBe(true);
      expect(r2Body.startsWith('enc:v1:')).toBe(true);
      // Crucially: the raw R2 body must NOT contain our PII markers
      expect(r2Body.includes(SUPERADMIN_EMAIL)).toBe(false);
      expect(r2Body.includes(TENANT_ID)).toBe(false);
      // And the customMetadata flag should be set for future retrievers
      expect(obj!.customMetadata?.encrypted).toBe('true');

      // The audit log entry should record encrypted: true
      const audit = await env.DB.prepare(
        `SELECT details FROM audit_log WHERE tenant_id = ? AND action = 'popia.data_export.completed' ORDER BY created_at DESC LIMIT 1`
      ).bind(TENANT_ID).first<{ details: string }>();
      expect(audit).not.toBeNull();
      const details = JSON.parse(audit!.details) as { encrypted?: boolean };
      expect(details.encrypted).toBe(true);
    });

    it('retrieves and decrypts a previously-exported DSAR via GET /tenants/data-export/:key', async () => {
      const token = await login(SUPERADMIN_EMAIL, TENANT_ID);
      // First export
      const exportRes = await authedGet('/api/v1/tenants/data-export', token);
      const exportBody = await exportRes.json() as { r2Key: string };
      expect(exportBody.r2Key).toBeTruthy();

      // Then retrieve — :key is the full R2 key, URL-encoded
      const encodedKey = encodeURIComponent(exportBody.r2Key);
      const retrieveRes = await authedGet(`/api/v1/tenants/data-export/${encodedKey}`, token);
      expect(retrieveRes.status).toBe(200);
      const retrieveBody = await retrieveRes.json() as { success: boolean; wasEncrypted: boolean; export: Record<string, unknown> };
      expect(retrieveBody.success).toBe(true);
      expect(retrieveBody.wasEncrypted).toBe(true);
      expect(retrieveBody.export).toHaveProperty('tenant_id', TENANT_ID);
      expect(retrieveBody.export).toHaveProperty('data');
    });

    it('blocks cross-tenant DSAR retrieve for non-superadmin', async () => {
      // Superadmin creates an export for TENANT_ID
      const superToken = await login(SUPERADMIN_EMAIL, TENANT_ID);
      const exportRes = await authedGet('/api/v1/tenants/data-export', superToken);
      const exportBody = await exportRes.json() as { r2Key: string };

      // Admin from OTHER_TENANT_ID should NOT be able to retrieve it.
      // The /tenants routes are gated to superadmin-only by the router (requireRole('superadmin')),
      // so even attempting cross-tenant access is blocked before the tenantId check.
      const otherToken = await login(OTHER_ADMIN_EMAIL, OTHER_TENANT_ID);
      const encodedKey = encodeURIComponent(exportBody.r2Key);
      const res = await authedGet(`/api/v1/tenants/data-export/${encodedKey}`, otherToken);
      expect(res.status).toBe(403);
    });
  });

  // ── §8.3: ERP credentials encrypted on write paths ──

  describe('ERP credentials (audit 8.3)', () => {
    it('encrypts config on POST /erp/connections and leaves config column empty', async () => {
      const token = await login(ADMIN_EMAIL, TENANT_ID);
      const res = await postJSON('/api/v1/erp/connections', {
        adapter_id: 'enc-test-adapter',
        name: 'Encryption Test Connection',
        config: {
          client_id: 'pub-client-id',
          client_secret: 'SECRET_VALUE_DO_NOT_LEAK',
          base_url: 'https://erp.example.com',
          api_key: 'APIKEY_SUPER_SECRET',
        },
      }, token);
      expect(res.status).toBe(201);
      const created = await res.json() as { id: string; encrypted?: boolean };
      expect(created.id).toBeTruthy();
      expect(created.encrypted).toBe(true);

      // Read raw D1 row directly — config column must be empty, encrypted_config must be ciphertext
      const row = await env.DB.prepare(
        'SELECT config, encrypted_config FROM erp_connections WHERE id = ?'
      ).bind(created.id).first<{ config: string; encrypted_config: string }>();
      expect(row).not.toBeNull();
      expect(row!.config).toBe('{}');
      expect(row!.encrypted_config).toBeTruthy();
      expect(isEncrypted(row!.encrypted_config)).toBe(true);
      // The raw blob must not contain our secrets
      expect(row!.encrypted_config.includes('SECRET_VALUE_DO_NOT_LEAK')).toBe(false);
      expect(row!.encrypted_config.includes('APIKEY_SUPER_SECRET')).toBe(false);

      // Sanity: decrypting with the test key recovers the original config
      const plaintext = await decrypt(row!.encrypted_config, ENCRYPTION_KEY);
      expect(plaintext).not.toBeNull();
      const parsed = JSON.parse(plaintext!) as Record<string, unknown>;
      expect(parsed.client_secret).toBe('SECRET_VALUE_DO_NOT_LEAK');
      expect(parsed.api_key).toBe('APIKEY_SUPER_SECRET');
    });

    it('GET /erp/connections decrypts and returns redacted secrets', async () => {
      const token = await login(ADMIN_EMAIL, TENANT_ID);
      // Seed a connection directly with an encrypted blob to exercise the read path
      const encryptedBlob = await encrypt(JSON.stringify({
        client_id: 'my-client',
        client_secret: 'TOP_SECRET',
        base_url: 'https://erp.example.com',
      }), ENCRYPTION_KEY);
      const connId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO erp_connections (id, tenant_id, adapter_id, name, config, encrypted_config, status, sync_frequency, records_synced)
         VALUES (?, ?, 'enc-test-adapter', 'Seeded Conn', '{}', ?, 'connected', 'realtime', 0)`
      ).bind(connId, TENANT_ID, encryptedBlob).run();

      const res = await authedGet('/api/v1/erp/connections', token);
      expect(res.status).toBe(200);
      const body = await res.json() as { connections: Array<{ id: string; config: Record<string, unknown> }> };
      const conn = body.connections.find((x) => x.id === connId);
      expect(conn).toBeTruthy();
      // Non-secret fields pass through decrypted
      expect(conn!.config.client_id).toBe('my-client');
      expect(conn!.config.base_url).toBe('https://erp.example.com');
      // Secrets must be redacted to '***' in the response
      expect(conn!.config.client_secret).toBe('***');
    });

    it('PUT /erp/connections/:id re-encrypts the merged config', async () => {
      const token = await login(ADMIN_EMAIL, TENANT_ID);
      // Seed an initial encrypted connection
      const seedBlob = await encrypt(JSON.stringify({ client_id: 'abc', client_secret: 'old-secret' }), ENCRYPTION_KEY);
      const connId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO erp_connections (id, tenant_id, adapter_id, name, config, encrypted_config, status, sync_frequency, records_synced)
         VALUES (?, ?, 'enc-test-adapter', 'Upd Conn', '{}', ?, 'connected', 'realtime', 0)`
      ).bind(connId, TENANT_ID, seedBlob).run();

      // PUT: update client_secret + add api_key
      const putRes = await SELF.fetch(`http://localhost/api/v1/erp/connections/${connId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ config: { client_secret: 'NEW_SECRET', api_key: 'NEW_APIKEY' } }),
      });
      expect(putRes.status).toBe(200);

      const row = await env.DB.prepare(
        'SELECT config, encrypted_config FROM erp_connections WHERE id = ?'
      ).bind(connId).first<{ config: string; encrypted_config: string }>();
      expect(row!.config).toBe('{}');
      expect(isEncrypted(row!.encrypted_config)).toBe(true);
      expect(row!.encrypted_config.includes('NEW_SECRET')).toBe(false);

      const plaintext = await decrypt(row!.encrypted_config, ENCRYPTION_KEY);
      const parsed = JSON.parse(plaintext!) as Record<string, unknown>;
      expect(parsed.client_id).toBe('abc');
      expect(parsed.client_secret).toBe('NEW_SECRET');
      expect(parsed.api_key).toBe('NEW_APIKEY');
    });
  });

  // ── Key rotation ──

  describe('Key rotation', () => {
    it('re-encrypts all rows under a new key (round-trip: key1 -> key2)', async () => {
      const key1 = ENCRYPTION_KEY; // current key
      const key2 = 'rotation-target-key-32-chars!!!!';

      // Seed 3 encrypted rows under key1
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const blob = await encrypt(JSON.stringify({ client_secret: `secret-${i}`, iter: i }), key1);
        const id = crypto.randomUUID();
        ids.push(id);
        await env.DB.prepare(
          `INSERT INTO erp_connections (id, tenant_id, adapter_id, name, config, encrypted_config, status, sync_frequency, records_synced)
           VALUES (?, ?, 'enc-test-adapter', ?, '{}', ?, 'connected', 'realtime', 0)`
        ).bind(id, TENANT_ID, `rot-conn-${i}`, blob).run();
      }

      const result = await rotateErpConnectionEncryption(env.DB, key1, key2);
      expect(result.rotated).toBeGreaterThanOrEqual(3);
      expect(result.failed).toBe(0);

      // Every rotated row should now decrypt under key2 but NOT under key1
      for (const id of ids) {
        const row = await env.DB.prepare('SELECT encrypted_config FROM erp_connections WHERE id = ?')
          .bind(id).first<{ encrypted_config: string }>();
        expect(isEncrypted(row!.encrypted_config)).toBe(true);
        const underNewKey = await decrypt(row!.encrypted_config, key2);
        expect(underNewKey).not.toBeNull();
        expect(underNewKey!.includes('secret-')).toBe(true);
        const underOldKey = await decrypt(row!.encrypted_config, key1);
        expect(underOldKey).toBeNull();
      }
    });

    it('fails cleanly when the old key is wrong (no rows mutated)', async () => {
      const realKey = ENCRYPTION_KEY;
      const fakeOldKey = 'wrong-key-of-sufficient-len!!!';
      const newKey = 'whatever-new-key-32chars-min!!';

      // Seed under the REAL key
      const blob = await encrypt(JSON.stringify({ client_secret: 'preserved' }), realKey);
      const id = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO erp_connections (id, tenant_id, adapter_id, name, config, encrypted_config, status, sync_frequency, records_synced)
         VALUES (?, ?, 'enc-test-adapter', 'wrongkey', '{}', ?, 'connected', 'realtime', 0)`
      ).bind(id, TENANT_ID, blob).run();

      const result = await rotateErpConnectionEncryption(env.DB, fakeOldKey, newKey);
      // All rows encrypted under realKey should fail to decrypt under fakeOldKey.
      expect(result.rotated).toBe(0);
      expect(result.failed).toBeGreaterThanOrEqual(1);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);

      // Row is unchanged — still decrypts under the real key
      const row = await env.DB.prepare('SELECT encrypted_config FROM erp_connections WHERE id = ?')
        .bind(id).first<{ encrypted_config: string }>();
      expect(row!.encrypted_config).toBe(blob);
      const stillDecrypts = await decrypt(row!.encrypted_config, realKey);
      expect(stillDecrypts).not.toBeNull();
      expect(stillDecrypts!.includes('preserved')).toBe(true);
    });

    it('rejects rotation with matching old_key and new_key', async () => {
      await expect(rotateErpConnectionEncryption(env.DB, 'same-key-16chars!', 'same-key-16chars!'))
        .rejects.toThrow(/must differ/);
    });

    it('POST /api/v1/admin/rotate-encryption is superadmin-gated', async () => {
      // Non-superadmin attempt
      const adminToken = await login(ADMIN_EMAIL, TENANT_ID);
      const res = await postJSON('/api/v1/admin/rotate-encryption', {
        old_key: ENCRYPTION_KEY, new_key: 'another-valid-key-32-chars!!!!',
      }, adminToken);
      expect(res.status).toBe(403);

      // Superadmin succeeds (even if there are no rows to rotate)
      const superToken = await login(SUPERADMIN_EMAIL, TENANT_ID);
      const okRes = await postJSON('/api/v1/admin/rotate-encryption', {
        old_key: ENCRYPTION_KEY, new_key: 'another-valid-key-32-chars!!!!',
      }, superToken);
      expect(okRes.status).toBe(200);
      const body = await okRes.json() as { rotated: number; failed: number };
      expect(typeof body.rotated).toBe('number');
      expect(typeof body.failed).toBe('number');
    });
  });
});
