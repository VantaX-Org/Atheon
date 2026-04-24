/**
 * Support Ticket System Test Suite (v49-support)
 * Covers:
 *  - create → list → get → reply → admin-update happy path
 *  - authentication required on every endpoint
 *  - non-admin users cannot read/modify other users' tickets in the same tenant
 *  - tenant isolation: a user in tenant A cannot read/modify tenant B's tickets
 *  - PATCH is admin-only
 *  - validation (subject/body length, enum values)
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';

// ── Fixture IDs ───────────────────────────────────────────────────────
const TENANT_A_ID = 'support-tenant-a';
const TENANT_A_SLUG = 'support-tenant-a';
const TENANT_B_ID = 'support-tenant-b';
const TENANT_B_SLUG = 'support-tenant-b';

const ADMIN_A_ID = 'support-admin-a';
const ADMIN_A_EMAIL = 'admin@support-a.co.za';
const USER_A_ID = 'support-user-a';
const USER_A_EMAIL = 'user@support-a.co.za';
const OTHER_USER_A_ID = 'support-user-a2';
const OTHER_USER_A_EMAIL = 'other@support-a.co.za';
const USER_B_ID = 'support-user-b';
const USER_B_EMAIL = 'user@support-b.co.za';
const ADMIN_B_ID = 'support-admin-b';
const ADMIN_B_EMAIL = 'admin@support-b.co.za';

const PASSWORD = 'SupportTest1!';

async function migrateViaEndpoint(): Promise<void> {
  const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
    method: 'POST',
    headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
  });
  if (res.status !== 200) throw new Error(`Migration failed: ${res.status}`);
}

async function seedTenant(id: string, slug: string, name: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`,
  ).bind(id, name, slug).run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenant_entitlements (tenant_id, layers, catalyst_clusters, max_agents, max_users)
     VALUES (?, '["apex","pulse"]', '["finance"]', 50, 100)`,
  ).bind(id).run();
}

async function seedUser(id: string, tenantId: string, email: string, role: string): Promise<void> {
  const hash = await hashPassword(PASSWORD);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status)
     VALUES (?, ?, ?, 'Test User', ?, ?, ?, 'active')`,
  ).bind(id, tenantId, email, role, hash, JSON.stringify(['*'])).run();
}

async function login(email: string, tenantSlug: string): Promise<string> {
  const res = await SELF.fetch('http://localhost/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, tenant_slug: tenantSlug }),
  });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status} ${await res.text()}`);
  const body = await res.json() as { token: string };
  return body.token;
}

async function cleanup(): Promise<void> {
  for (const tenant of [TENANT_A_ID, TENANT_B_ID]) {
    await env.DB.prepare('DELETE FROM support_ticket_replies WHERE tenant_id = ?').bind(tenant).run();
    await env.DB.prepare('DELETE FROM support_tickets WHERE tenant_id = ?').bind(tenant).run();
  }
}

async function authedFetch(path: string, token: string, init?: RequestInit): Promise<Response> {
  return SELF.fetch(`http://localhost${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
}

async function createTicket(
  token: string,
  overrides: Partial<Record<string, unknown>> = {},
): Promise<Record<string, unknown>> {
  const body = {
    subject: 'Cannot log in after password reset',
    body: 'I reset my password but the new one is rejected at the login screen.',
    category: 'access',
    priority: 'high',
    ...overrides,
  };
  const res = await authedFetch('/api/v1/support/tickets', token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (res.status !== 201) throw new Error(`Create failed: ${res.status} ${await res.text()}`);
  const parsed = await res.json() as { ticket: Record<string, unknown> };
  return parsed.ticket;
}

let adminAToken: string;
let userAToken: string;
let otherUserAToken: string;
let userBToken: string;
let adminBToken: string;

describe('Support Tickets (v49-support)', () => {
  beforeAll(async () => {
    await migrateViaEndpoint();
    await seedTenant(TENANT_A_ID, TENANT_A_SLUG, 'Support Tenant A');
    await seedTenant(TENANT_B_ID, TENANT_B_SLUG, 'Support Tenant B');
    await seedUser(ADMIN_A_ID, TENANT_A_ID, ADMIN_A_EMAIL, 'admin');
    await seedUser(USER_A_ID, TENANT_A_ID, USER_A_EMAIL, 'analyst');
    await seedUser(OTHER_USER_A_ID, TENANT_A_ID, OTHER_USER_A_EMAIL, 'analyst');
    await seedUser(USER_B_ID, TENANT_B_ID, USER_B_EMAIL, 'analyst');
    await seedUser(ADMIN_B_ID, TENANT_B_ID, ADMIN_B_EMAIL, 'admin');

    adminAToken = await login(ADMIN_A_EMAIL, TENANT_A_SLUG);
    userAToken = await login(USER_A_EMAIL, TENANT_A_SLUG);
    otherUserAToken = await login(OTHER_USER_A_EMAIL, TENANT_A_SLUG);
    userBToken = await login(USER_B_EMAIL, TENANT_B_SLUG);
    adminBToken = await login(ADMIN_B_EMAIL, TENANT_B_SLUG);
  });

  beforeEach(async () => {
    await cleanup();
  });

  describe('Happy path: create - list - get - reply - admin-update', () => {
    it('walks the full ticket lifecycle', async () => {
      // CREATE
      const ticket = await createTicket(userAToken, { subject: 'Invoice not loading' });
      expect(ticket.id).toBeTruthy();
      expect(ticket.subject).toBe('Invoice not loading');
      expect(ticket.user_id).toBe(USER_A_ID);
      expect(ticket.tenant_id).toBe(TENANT_A_ID);
      expect(ticket.status).toBe('open');
      expect(ticket.priority).toBe('high');

      // LIST as ticket owner
      const listOwnerRes = await authedFetch('/api/v1/support/tickets', userAToken);
      expect(listOwnerRes.status).toBe(200);
      const listOwner = await listOwnerRes.json() as { tickets: Array<{ id: string }>; next_cursor: string | null };
      expect(listOwner.tickets).toHaveLength(1);
      expect(listOwner.tickets[0].id).toBe(ticket.id);

      // LIST as admin: sees all tenant tickets
      const listAdminRes = await authedFetch('/api/v1/support/tickets', adminAToken);
      const listAdmin = await listAdminRes.json() as { tickets: Array<{ id: string }> };
      expect(listAdmin.tickets.some(t => t.id === ticket.id)).toBe(true);

      // GET single + replies (empty)
      const getRes = await authedFetch(`/api/v1/support/tickets/${ticket.id}`, userAToken);
      expect(getRes.status).toBe(200);
      const getBody = await getRes.json() as { ticket: Record<string, unknown>; replies: unknown[] };
      expect(getBody.ticket.id).toBe(ticket.id);
      expect(getBody.replies).toHaveLength(0);

      // REPLY as owner
      const replyRes = await authedFetch(`/api/v1/support/tickets/${ticket.id}/replies`, userAToken, {
        method: 'POST',
        body: JSON.stringify({ body: 'Still broken — any update?' }),
      });
      expect(replyRes.status).toBe(201);
      const replyBody = await replyRes.json() as { reply: { id: string; body: string; user_id: string } };
      expect(replyBody.reply.body).toBe('Still broken — any update?');
      expect(replyBody.reply.user_id).toBe(USER_A_ID);

      // REPLY as admin
      const adminReplyRes = await authedFetch(`/api/v1/support/tickets/${ticket.id}/replies`, adminAToken, {
        method: 'POST',
        body: JSON.stringify({ body: 'Looking into this now.' }),
      });
      expect(adminReplyRes.status).toBe(201);

      // GET shows both replies in order
      const getAfter = await authedFetch(`/api/v1/support/tickets/${ticket.id}`, userAToken);
      const getAfterBody = await getAfter.json() as { replies: Array<{ body: string }> };
      expect(getAfterBody.replies).toHaveLength(2);
      expect(getAfterBody.replies[0].body).toBe('Still broken — any update?');
      expect(getAfterBody.replies[1].body).toBe('Looking into this now.');

      // ADMIN PATCH: assign + change status
      const patchRes = await authedFetch(`/api/v1/support/tickets/${ticket.id}`, adminAToken, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'in_progress', assignee_user_id: ADMIN_A_ID, priority: 'urgent' }),
      });
      expect(patchRes.status).toBe(200);
      const patchBody = await patchRes.json() as { ticket: { status: string; assignee_user_id: string; priority: string } };
      expect(patchBody.ticket.status).toBe('in_progress');
      expect(patchBody.ticket.assignee_user_id).toBe(ADMIN_A_ID);
      expect(patchBody.ticket.priority).toBe('urgent');
    });
  });

  describe('Auth', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await SELF.fetch('http://localhost/api/v1/support/tickets');
      expect(res.status).toBe(401);
    });

    it('rejects unauthenticated POST with 401', async () => {
      const res = await SELF.fetch('http://localhost/api/v1/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: 'hi', body: 'hi' }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('Validation', () => {
    it('rejects create with missing subject', async () => {
      const res = await authedFetch('/api/v1/support/tickets', userAToken, {
        method: 'POST',
        body: JSON.stringify({ body: 'no subject here' }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects create with missing body', async () => {
      const res = await authedFetch('/api/v1/support/tickets', userAToken, {
        method: 'POST',
        body: JSON.stringify({ subject: 'A', body: '' }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects create with oversized subject', async () => {
      const res = await authedFetch('/api/v1/support/tickets', userAToken, {
        method: 'POST',
        body: JSON.stringify({ subject: 'x'.repeat(201), body: 'ok' }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects create with oversized body', async () => {
      const res = await authedFetch('/api/v1/support/tickets', userAToken, {
        method: 'POST',
        body: JSON.stringify({ subject: 'ok', body: 'x'.repeat(10001) }),
      });
      expect(res.status).toBe(400);
    });

    it('coerces unknown category/priority to defaults', async () => {
      const ticket = await createTicket(userAToken, { category: 'made-up', priority: 'critical' });
      expect(ticket.category).toBe('general');
      expect(ticket.priority).toBe('normal');
    });

    it('PATCH rejects invalid status', async () => {
      const ticket = await createTicket(userAToken);
      const res = await authedFetch(`/api/v1/support/tickets/${ticket.id}`, adminAToken, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'exploded' }),
      });
      expect(res.status).toBe(400);
    });

    it('PATCH rejects assignee from another tenant', async () => {
      const ticket = await createTicket(userAToken);
      const res = await authedFetch(`/api/v1/support/tickets/${ticket.id}`, adminAToken, {
        method: 'PATCH',
        body: JSON.stringify({ assignee_user_id: USER_B_ID }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('Role/Tenant isolation', () => {
    it('non-admin users cannot see another user\'s ticket in same tenant via GET', async () => {
      const ticket = await createTicket(userAToken);
      const res = await authedFetch(`/api/v1/support/tickets/${ticket.id}`, otherUserAToken);
      expect(res.status).toBe(403);
    });

    it('non-admin users cannot reply to another user\'s ticket in same tenant', async () => {
      const ticket = await createTicket(userAToken);
      const res = await authedFetch(`/api/v1/support/tickets/${ticket.id}/replies`, otherUserAToken, {
        method: 'POST',
        body: JSON.stringify({ body: 'sneaky reply' }),
      });
      expect(res.status).toBe(403);
    });

    it('non-admin users see only their own tickets in list', async () => {
      await createTicket(userAToken, { subject: 'mine' });
      await createTicket(otherUserAToken, { subject: 'theirs' });

      const res = await authedFetch('/api/v1/support/tickets', userAToken);
      const body = await res.json() as { tickets: Array<{ subject: string }> };
      expect(body.tickets).toHaveLength(1);
      expect(body.tickets[0].subject).toBe('mine');
    });

    it('PATCH is forbidden for non-admin callers even on their own ticket', async () => {
      const ticket = await createTicket(userAToken);
      const res = await authedFetch(`/api/v1/support/tickets/${ticket.id}`, userAToken, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'closed' }),
      });
      expect(res.status).toBe(403);
    });

    it('tenant A user cannot read tenant B ticket (404 - not found in A scope)', async () => {
      const tenantBTicket = await createTicket(userBToken);
      const res = await authedFetch(`/api/v1/support/tickets/${tenantBTicket.id}`, userAToken);
      expect(res.status).toBe(404);
    });

    it('tenant A admin cannot PATCH tenant B ticket', async () => {
      const tenantBTicket = await createTicket(userBToken);
      const res = await authedFetch(`/api/v1/support/tickets/${tenantBTicket.id}`, adminAToken, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'closed' }),
      });
      expect(res.status).toBe(404);
    });

    it('tenant A admin cannot reply to tenant B ticket', async () => {
      const tenantBTicket = await createTicket(userBToken);
      const res = await authedFetch(`/api/v1/support/tickets/${tenantBTicket.id}/replies`, adminAToken, {
        method: 'POST',
        body: JSON.stringify({ body: 'cross-tenant reply' }),
      });
      expect(res.status).toBe(404);
    });

    it('tenant A admin list only returns tenant A tickets', async () => {
      await createTicket(userAToken, { subject: 'A-ticket' });
      await createTicket(userBToken, { subject: 'B-ticket' });

      const res = await authedFetch('/api/v1/support/tickets', adminAToken);
      const body = await res.json() as { tickets: Array<{ subject: string; tenant_id: string }> };
      for (const t of body.tickets) {
        expect(t.tenant_id).toBe(TENANT_A_ID);
      }
      expect(body.tickets.some(t => t.subject === 'A-ticket')).toBe(true);
      expect(body.tickets.some(t => t.subject === 'B-ticket')).toBe(false);

      // Mirror check from tenant B admin's side
      const resB = await authedFetch('/api/v1/support/tickets', adminBToken);
      const bodyB = await resB.json() as { tickets: Array<{ subject: string; tenant_id: string }> };
      for (const t of bodyB.tickets) {
        expect(t.tenant_id).toBe(TENANT_B_ID);
      }
      expect(bodyB.tickets.some(t => t.subject === 'B-ticket')).toBe(true);
      expect(bodyB.tickets.some(t => t.subject === 'A-ticket')).toBe(false);
    });
  });

  describe('Closed ticket', () => {
    it('rejects replies to a closed ticket', async () => {
      const ticket = await createTicket(userAToken);
      await authedFetch(`/api/v1/support/tickets/${ticket.id}`, adminAToken, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'closed' }),
      });
      const res = await authedFetch(`/api/v1/support/tickets/${ticket.id}/replies`, userAToken, {
        method: 'POST',
        body: JSON.stringify({ body: 'still here' }),
      });
      expect(res.status).toBe(409);
    });
  });

  describe('Pagination', () => {
    it('paginates via cursor', async () => {
      // Seed 3 tickets; insert directly so created_at values are distinct/ordered
      const now = Date.now();
      for (let i = 0; i < 3; i++) {
        const ts = new Date(now - i * 60_000).toISOString();
        await env.DB.prepare(
          `INSERT INTO support_tickets (id, tenant_id, user_id, subject, body, category, priority, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'general', 'normal', 'open', ?, ?)`,
        ).bind(`seed-${i}`, TENANT_A_ID, USER_A_ID, `Ticket ${i}`, 'body', ts, ts).run();
      }

      const page1Res = await authedFetch('/api/v1/support/tickets?limit=2', userAToken);
      const page1 = await page1Res.json() as { tickets: Array<{ id: string }>; next_cursor: string | null };
      expect(page1.tickets).toHaveLength(2);
      expect(page1.next_cursor).toBeTruthy();

      const page2Res = await authedFetch(`/api/v1/support/tickets?limit=2&cursor=${encodeURIComponent(page1.next_cursor || '')}`, userAToken);
      const page2 = await page2Res.json() as { tickets: Array<{ id: string }>; next_cursor: string | null };
      expect(page2.tickets.length).toBeGreaterThanOrEqual(1);
      // No overlap
      const idsP1 = new Set(page1.tickets.map(t => t.id));
      for (const t of page2.tickets) {
        expect(idsP1.has(t.id)).toBe(false);
      }
    });
  });
});
