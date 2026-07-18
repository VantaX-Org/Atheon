/**
 * SCIM 2.0 surface tests — middleware/scim-auth.ts + routes/scim.ts.
 *
 * Oracles here are INDEPENDENT of the source: SCIM error/envelope shapes are
 * re-derived from RFC 7644, and the token hash is recomputed with a local
 * SHA-256 hex implementation rather than importing the module's private hasher.
 * The HTTP routes are exercised for real via SELF.fetch with a token whose
 * hash we insert into scim_tokens, mirroring how an IdP would authenticate.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { scimError, generateScimToken } from '../middleware/scim-auth';

const TENANT_ID = 'scim-test-tenant';
const OTHER_TENANT = 'scim-other-tenant';
const SCIM_BASE = 'http://localhost/scim/v2';

/** Independent SHA-256 hex oracle — reimplemented, not imported. */
async function sha256hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

let validToken = '';

async function migrateViaEndpoint(): Promise<void> {
  const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
    method: 'POST',
    headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
  });
  expect(res.status).toBeLessThan(500);
}

async function seedTenant(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status)
     VALUES (?, ?, ?, 'enterprise', 'active')`,
  ).bind(id, `Tenant ${id}`, id).run();
}

async function insertScimToken(
  tenantId: string,
  opts: { revoked?: boolean } = {},
): Promise<string> {
  const { clear, hash, prefix } = await generateScimToken();
  await env.DB.prepare(
    `INSERT INTO scim_tokens (id, tenant_id, name, token_hash, key_prefix, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    tenantId,
    'test-idp',
    hash,
    prefix,
    opts.revoked ? new Date().toISOString() : null,
  ).run();
  return clear;
}

function scimHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

beforeAll(async () => {
  await migrateViaEndpoint();
  await seedTenant(TENANT_ID);
  await seedTenant(OTHER_TENANT);
  validToken = await insertScimToken(TENANT_ID);
});

// ─── generateScimToken() ─────────────────────────────────────────────
describe('generateScimToken()', () => {
  it('returns clear/hash/prefix where prefix is a prefix of clear', async () => {
    const { clear, hash, prefix } = await generateScimToken();
    expect(clear.startsWith('atscim_')).toBe(true);
    expect(clear.startsWith(prefix)).toBe(true);
    expect(prefix.length).toBe(14); // "atscim_" + 7 visible chars
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hash equals an independent SHA-256 hex of the clear token', async () => {
    const { clear, hash } = await generateScimToken();
    expect(hash).toBe(await sha256hex(clear));
  });

  it('produces unique tokens across calls', async () => {
    const a = await generateScimToken();
    const b = await generateScimToken();
    expect(a.clear).not.toBe(b.clear);
    expect(a.hash).not.toBe(b.hash);
  });
});

// ─── scimError() envelope ────────────────────────────────────────────
describe('scimError()', () => {
  it('produces the RFC 7644 §3.12 error envelope with stringified status', () => {
    const e = scimError(404, 'nope');
    expect(e).toEqual({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '404',
      detail: 'nope',
    });
    expect(typeof e.status).toBe('string');
  });

  it('includes scimType only when provided', () => {
    expect(scimError(400, 'bad', 'invalidValue')).toMatchObject({ scimType: 'invalidValue' });
    expect('scimType' in scimError(400, 'bad')).toBe(false);
  });
});

// ─── Auth rejection ──────────────────────────────────────────────────
describe('scimAuth() rejection', () => {
  it('401 + SCIM error envelope when Authorization header is missing', async () => {
    const res = await SELF.fetch(`${SCIM_BASE}/Users`);
    expect(res.status).toBe(401);
    const body = await res.json() as { schemas: string[]; status: string };
    expect(body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
    expect(body.status).toBe('401');
  });

  it('401 when token does not carry the atscim_ prefix', async () => {
    const res = await SELF.fetch(`${SCIM_BASE}/Users`, {
      headers: { Authorization: 'Bearer not-a-scim-token' },
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { detail: string };
    expect(body.detail).toBe('Invalid token format');
  });

  it('401 when a well-formed token is not in the table', async () => {
    const res = await SELF.fetch(`${SCIM_BASE}/Users`, {
      headers: { Authorization: 'Bearer atscim_deadbeefdeadbeefdeadbeefdeadbeef' },
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { detail: string };
    expect(body.detail).toBe('Invalid token');
  });

  it('401 when the token has been revoked', async () => {
    const revoked = await insertScimToken(TENANT_ID, { revoked: true });
    const res = await SELF.fetch(`${SCIM_BASE}/Users`, {
      headers: { Authorization: `Bearer ${revoked}` },
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { detail: string };
    expect(body.detail).toBe('Token has been revoked');
  });
});

// ─── Discovery endpoints ─────────────────────────────────────────────
describe('discovery endpoints', () => {
  it('GET /ServiceProviderConfig advertises patch + filter support', async () => {
    const res = await SELF.fetch(`${SCIM_BASE}/ServiceProviderConfig`, {
      headers: scimHeaders(validToken),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { schemas: string[]; patch: { supported: boolean } };
    expect(body.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig');
    expect(body.patch.supported).toBe(true);
  });

  it('GET /ResourceTypes and /Schemas return ListResponse envelopes', async () => {
    for (const path of ['/ResourceTypes', '/Schemas']) {
      const res = await SELF.fetch(`${SCIM_BASE}${path}`, { headers: scimHeaders(validToken) });
      expect(res.status).toBe(200);
      const body = await res.json() as { schemas: string[]; totalResults: number };
      expect(body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:ListResponse']);
      expect(body.totalResults).toBe(1);
    }
  });
});

// ─── Users CRUD ──────────────────────────────────────────────────────
// Per-test isolated storage (singleWorker + isolatedStorage) rolls back writes
// made inside each `it`, so beforeAll's tenant+token persist as the baseline but
// user rows do NOT survive between tests. Every user-dependent test therefore
// provisions its own user in-line via this helper.
async function createUser(userName: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await SELF.fetch(`${SCIM_BASE}/Users`, {
    method: 'POST',
    headers: scimHeaders(validToken),
    body: JSON.stringify({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName,
      emails: [{ value: userName, type: 'work', primary: true }],
      active: true,
      ...extra,
    }),
  });
  if (res.status !== 201) throw new Error(`createUser failed: ${res.status}`);
  return (await res.json() as { id: string }).id;
}

describe('/Users lifecycle', () => {
  const userName = 'jane.provisioned@example.com';

  it('POST creates a user with SCIM 201 + core:User schema', async () => {
    const res = await SELF.fetch(`${SCIM_BASE}/Users`, {
      method: 'POST',
      headers: scimHeaders(validToken),
      body: JSON.stringify({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName,
        externalId: 'ext-jane-1',
        name: { givenName: 'Jane', familyName: 'Provisioned' },
        emails: [{ value: userName, type: 'work', primary: true }],
        active: true,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as {
      id: string; schemas: string[]; userName: string; active: boolean;
      externalId: string; name: { formatted: string }; meta: { resourceType: string; location: string };
    };
    expect(body.schemas).toEqual(['urn:ietf:params:scim:schemas:core:2.0:User']);
    expect(body.userName).toBe(userName);
    expect(body.active).toBe(true);
    expect(body.externalId).toBe('ext-jane-1');
    expect(body.meta.resourceType).toBe('User');
    expect(body.meta.location).toContain(`/scim/v2/Users/${body.id}`);
  });

  it('POST a duplicate userName returns 409 uniqueness', async () => {
    await createUser(userName);
    const res = await SELF.fetch(`${SCIM_BASE}/Users`, {
      method: 'POST',
      headers: scimHeaders(validToken),
      body: JSON.stringify({ userName, emails: [{ value: userName, primary: true }] }),
    });
    expect(res.status).toBe(409);
    const body = await res.json() as { scimType: string };
    expect(body.scimType).toBe('uniqueness');
  });

  it('POST with neither userName nor email returns 400 invalidValue', async () => {
    const res = await SELF.fetch(`${SCIM_BASE}/Users`, {
      method: 'POST',
      headers: scimHeaders(validToken),
      body: JSON.stringify({ name: { givenName: 'Nobody' } }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { scimType: string };
    expect(body.scimType).toBe('invalidValue');
  });

  it('GET /Users/:id reads the created user back', async () => {
    const createdId = await createUser(userName);
    const res = await SELF.fetch(`${SCIM_BASE}/Users/${createdId}`, {
      headers: scimHeaders(validToken),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; userName: string };
    expect(body.id).toBe(createdId);
    expect(body.userName).toBe(userName);
  });

  it('GET /Users/:id for an unknown id returns 404 SCIM error', async () => {
    const res = await SELF.fetch(`${SCIM_BASE}/Users/does-not-exist`, {
      headers: scimHeaders(validToken),
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { schemas: string[]; status: string };
    expect(body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
    expect(body.status).toBe('404');
  });

  it('GET /Users returns a ListResponse containing the user', async () => {
    const createdId = await createUser(userName);
    const res = await SELF.fetch(`${SCIM_BASE}/Users`, { headers: scimHeaders(validToken) });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      schemas: string[]; totalResults: number; startIndex: number;
      itemsPerPage: number; Resources: Array<{ id: string }>;
    };
    expect(body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:ListResponse']);
    expect(body.startIndex).toBe(1);
    expect(body.totalResults).toBeGreaterThanOrEqual(1);
    expect(body.Resources.some((r) => r.id === createdId)).toBe(true);
  });

  it('filter userName eq (exact stored value) narrows the list', async () => {
    await createUser(userName);
    const res = await SELF.fetch(
      `${SCIM_BASE}/Users?filter=${encodeURIComponent(`userName eq "${userName}"`)}`,
      { headers: scimHeaders(validToken) },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { totalResults: number; Resources: Array<{ userName: string }> };
    expect(body.totalResults).toBe(1);
    expect(body.Resources[0].userName).toBe(userName);
  });

  it('filter externalId sw matches by prefix', async () => {
    await createUser(userName, { externalId: 'ext-jane-1' });
    const res = await SELF.fetch(
      `${SCIM_BASE}/Users?filter=${encodeURIComponent('externalId sw "ext-jane"')}`,
      { headers: scimHeaders(validToken) },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { totalResults: number };
    expect(body.totalResults).toBe(1);
  });

  it('filter userName eq is case-insensitive (RFC 7644 caseExact=false)', async () => {
    // Emails are lowercased on write (payloadToColumns); parseScimFilter now
    // folds the userName filter value to match, so an IdP probing with the
    // original-case userName it sent finds the existing user instead of 0.
    const mixed = 'Jane.Provisioned@Example.com';
    await createUser(mixed); // stored lowercased as jane.provisioned@example.com

    // Findable by its lowercased userName.
    const lower = await SELF.fetch(
      `${SCIM_BASE}/Users?filter=${encodeURIComponent(`userName eq "${mixed.toLowerCase()}"`)}`,
      { headers: scimHeaders(validToken) },
    );
    expect(((await lower.json()) as { totalResults: number }).totalResults).toBe(1);

    // And by the SAME userName in its original case (what Okta/Azure send).
    const res = await SELF.fetch(
      `${SCIM_BASE}/Users?filter=${encodeURIComponent(`userName eq "${mixed}"`)}`,
      { headers: scimHeaders(validToken) },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { totalResults: number };
    expect(body.totalResults).toBe(1);
  });

  it('PUT /Users/:id full-replaces attributes', async () => {
    const createdId = await createUser(userName);
    const res = await SELF.fetch(`${SCIM_BASE}/Users/${createdId}`, {
      method: 'PUT',
      headers: scimHeaders(validToken),
      body: JSON.stringify({
        userName,
        name: { givenName: 'Janet', familyName: 'Replaced', formatted: 'Janet Replaced' },
        emails: [{ value: userName, primary: true }],
        active: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { name: { givenName: string; formatted: string } };
    expect(body.name.givenName).toBe('Janet');
    expect(body.name.formatted).toBe('Janet Replaced');
  });

  it('PATCH replace active=false deactivates the user (active -> false)', async () => {
    const createdId = await createUser(userName);
    const res = await SELF.fetch(`${SCIM_BASE}/Users/${createdId}`, {
      method: 'PATCH',
      headers: scimHeaders(validToken),
      body: JSON.stringify({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: false }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { active: boolean };
    expect(body.active).toBe(false);
  });

  it('PATCH whole-object replace (Azure AD shape) reactivates a deactivated user', async () => {
    // Start deactivated, then reactivate via the Azure AD whole-object op shape.
    const createdId = await createUser(userName, { active: false });
    const res = await SELF.fetch(`${SCIM_BASE}/Users/${createdId}`, {
      method: 'PATCH',
      headers: scimHeaders(validToken),
      body: JSON.stringify({
        Operations: [{ op: 'replace', value: { active: true, userName } }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { active: boolean };
    expect(body.active).toBe(true);
  });

  it('DELETE /Users/:id soft-deletes (204) and leaves an inactive row', async () => {
    const createdId = await createUser(userName);
    const del = await SELF.fetch(`${SCIM_BASE}/Users/${createdId}`, {
      method: 'DELETE',
      headers: scimHeaders(validToken),
    });
    expect(del.status).toBe(204);

    // Row is retained for audit, now inactive.
    const read = await SELF.fetch(`${SCIM_BASE}/Users/${createdId}`, {
      headers: scimHeaders(validToken),
    });
    expect(read.status).toBe(200);
    const body = await read.json() as { active: boolean };
    expect(body.active).toBe(false);
  });

  it('PUT/PATCH/DELETE on an unknown id return 404', async () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const res = await SELF.fetch(`${SCIM_BASE}/Users/ghost-id`, {
        method,
        headers: scimHeaders(validToken),
        body: method === 'DELETE' ? undefined : JSON.stringify({ userName: 'x@y.com', Operations: [] }),
      });
      expect(res.status).toBe(404);
    }
  });
});

// ─── Tenant isolation ────────────────────────────────────────────────
describe('tenant scoping', () => {
  it('a token cannot read another tenant\'s user', async () => {
    // Seed a user directly under OTHER_TENANT.
    const otherId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, tenant_id, email, name, role, permissions, status)
       VALUES (?, ?, 'foreign@other.com', 'Foreign', 'analyst', '["read"]', 'active')`,
    ).bind(otherId, OTHER_TENANT).run();

    const res = await SELF.fetch(`${SCIM_BASE}/Users/${otherId}`, {
      headers: scimHeaders(validToken), // token bound to TENANT_ID
    });
    expect(res.status).toBe(404);
  });
});

// ─── Groups (deliberately unimplemented) ─────────────────────────────
describe('/Groups', () => {
  it('is not implemented — routed request 404s after auth passes', async () => {
    const res = await SELF.fetch(`${SCIM_BASE}/Groups`, { headers: scimHeaders(validToken) });
    expect(res.status).toBe(404); // Groups is out of scope in v1 (see routes/scim.ts header)
  });
});
