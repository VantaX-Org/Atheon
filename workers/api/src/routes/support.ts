/**
 * Support Ticket System (v48)
 * Minimal in-app support desk: end users file tickets, reply on their own
 * threads; admins list everything for the tenant, assign, and update status.
 * Route: /api/v1/support | Role: all authenticated (admin gated on PATCH)
 */
import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';

const support = new Hono<AppBindings>();

const ROLE_LEVELS: Record<string, number> = {
  superadmin: 120, support_admin: 110, admin: 100, executive: 90,
  manager: 70, analyst: 50, operator: 40, viewer: 10,
};
const CROSS_TENANT_ROLES = new Set(['superadmin', 'support_admin']);

const ALLOWED_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const ALLOWED_CATEGORIES = new Set(['general', 'bug', 'billing', 'feature_request', 'access', 'other']);
const ALLOWED_STATUSES = new Set(['open', 'in_progress', 'waiting_customer', 'resolved', 'closed']);

const MAX_SUBJECT_LEN = 200;
const MAX_BODY_LEN = 10000;
const DEFAULT_PAGE_LIMIT = 25;
const MAX_PAGE_LIMIT = 100;

function getAuth(c: { get: (k: string) => unknown }): AuthContext | undefined {
  return c.get('auth') as AuthContext | undefined;
}

/**
 * Effective tenant id for support routes.
 * Cross-tenant roles (superadmin, support_admin) can use ?tenant_id= to
 * impersonate; everyone else is pinned to their JWT tenant.
 */
function getTenantId(c: { get: (k: string) => unknown; req: { query: (k: string) => string | undefined } }): string {
  const auth = getAuth(c);
  if (!auth?.tenantId) throw new Error('No tenant context');
  if (CROSS_TENANT_ROLES.has(auth.role || '')) {
    return c.req.query('tenant_id') || auth.tenantId;
  }
  return auth.tenantId;
}

function isAdminPlus(c: { get: (k: string) => unknown }): boolean {
  const auth = getAuth(c);
  return (ROLE_LEVELS[auth?.role || ''] ?? 0) >= ROLE_LEVELS['admin'];
}

interface TicketRow {
  id: string;
  tenant_id: string;
  user_id: string;
  assignee_user_id: string | null;
  subject: string;
  body: string;
  category: string;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface ReplyRow {
  id: string;
  ticket_id: string;
  tenant_id: string;
  user_id: string;
  body: string;
  created_at: string;
}

function formatTicket(row: TicketRow): Record<string, unknown> {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    user_id: row.user_id,
    assignee_user_id: row.assignee_user_id,
    subject: row.subject,
    body: row.body,
    category: row.category,
    priority: row.priority,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function formatReply(row: ReplyRow): Record<string, unknown> {
  return {
    id: row.id,
    ticket_id: row.ticket_id,
    user_id: row.user_id,
    body: row.body,
    created_at: row.created_at,
  };
}

/** GET /tickets — list tickets.
 *  Admins see all tickets for the tenant; others see only their own.
 *  Pagination via ?limit&cursor (cursor = last seen created_at ISO ts). */
support.get('/tickets', async (c) => {
  const auth = getAuth(c);
  if (!auth) return c.json({ error: 'Unauthorized' }, 401);
  const tenantId = getTenantId(c);

  const limitRaw = parseInt(c.req.query('limit') || String(DEFAULT_PAGE_LIMIT), 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(limitRaw, MAX_PAGE_LIMIT)
    : DEFAULT_PAGE_LIMIT;
  const cursor = c.req.query('cursor');
  const statusFilter = c.req.query('status');

  const where: string[] = ['tenant_id = ?'];
  const params: unknown[] = [tenantId];

  if (!isAdminPlus(c)) {
    where.push('user_id = ?');
    params.push(auth.userId);
  }
  if (cursor) {
    where.push('created_at < ?');
    params.push(cursor);
  }
  if (statusFilter && ALLOWED_STATUSES.has(statusFilter)) {
    where.push('status = ?');
    params.push(statusFilter);
  }

  // +1 to detect if there's another page
  const sql = `SELECT * FROM support_tickets WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`;
  const res = await c.env.DB.prepare(sql).bind(...params, limit + 1).all<TicketRow>();
  const rows = res.results || [];
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? pageRows[pageRows.length - 1].created_at : null;

  return c.json({
    tickets: pageRows.map(formatTicket),
    next_cursor: nextCursor,
  });
});

/** POST /tickets — create a new ticket for the caller. */
support.post('/tickets', async (c) => {
  const auth = getAuth(c);
  if (!auth) return c.json({ error: 'Unauthorized' }, 401);
  const tenantId = getTenantId(c);

  let body: {
    subject?: string;
    body?: string;
    category?: string;
    priority?: string;
  };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const text = typeof body.body === 'string' ? body.body : '';
  if (!subject) return c.json({ error: 'Invalid input', message: 'subject is required' }, 400);
  if (subject.length > MAX_SUBJECT_LEN) return c.json({ error: 'Invalid input', message: `subject must be ≤ ${MAX_SUBJECT_LEN} chars` }, 400);
  if (!text || !text.trim()) return c.json({ error: 'Invalid input', message: 'body is required' }, 400);
  if (text.length > MAX_BODY_LEN) return c.json({ error: 'Invalid input', message: `body must be ≤ ${MAX_BODY_LEN} chars` }, 400);

  const category = body.category && ALLOWED_CATEGORIES.has(body.category) ? body.category : 'general';
  const priority = body.priority && ALLOWED_PRIORITIES.has(body.priority) ? body.priority : 'normal';

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO support_tickets
     (id, tenant_id, user_id, subject, body, category, priority, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`,
  ).bind(id, tenantId, auth.userId, subject, text, category, priority).run();

  const row = await c.env.DB.prepare('SELECT * FROM support_tickets WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId).first<TicketRow>();
  return c.json({ ticket: row ? formatTicket(row) : { id } }, 201);
});

/** GET /tickets/:id — single ticket + replies.
 *  Non-admins can only see their own tickets. */
support.get('/tickets/:id', async (c) => {
  const auth = getAuth(c);
  if (!auth) return c.json({ error: 'Unauthorized' }, 401);
  const tenantId = getTenantId(c);
  const id = c.req.param('id');

  const ticket = await c.env.DB.prepare('SELECT * FROM support_tickets WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId).first<TicketRow>();
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404);

  if (!isAdminPlus(c) && ticket.user_id !== auth.userId) {
    return c.json({ error: 'Forbidden', message: 'You can only view your own tickets' }, 403);
  }

  const replies = await c.env.DB.prepare(
    'SELECT * FROM support_ticket_replies WHERE ticket_id = ? AND tenant_id = ? ORDER BY created_at ASC',
  ).bind(id, tenantId).all<ReplyRow>();

  return c.json({
    ticket: formatTicket(ticket),
    replies: (replies.results || []).map(formatReply),
  });
});

/** POST /tickets/:id/replies — add a reply to a ticket.
 *  Non-admins can only reply to their own tickets; closed tickets are locked. */
support.post('/tickets/:id/replies', async (c) => {
  const auth = getAuth(c);
  if (!auth) return c.json({ error: 'Unauthorized' }, 401);
  const tenantId = getTenantId(c);
  const id = c.req.param('id');

  const ticket = await c.env.DB.prepare('SELECT * FROM support_tickets WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId).first<TicketRow>();
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404);

  if (!isAdminPlus(c) && ticket.user_id !== auth.userId) {
    return c.json({ error: 'Forbidden', message: 'You can only reply to your own tickets' }, 403);
  }
  if (ticket.status === 'closed') {
    return c.json({ error: 'Ticket is closed', message: 'Re-open the ticket to add new replies' }, 409);
  }

  let body: { body?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }
  const text = typeof body.body === 'string' ? body.body : '';
  if (!text.trim()) return c.json({ error: 'Invalid input', message: 'body is required' }, 400);
  if (text.length > MAX_BODY_LEN) return c.json({ error: 'Invalid input', message: `body must be ≤ ${MAX_BODY_LEN} chars` }, 400);

  const replyId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO support_ticket_replies (id, ticket_id, tenant_id, user_id, body) VALUES (?, ?, ?, ?, ?)`,
  ).bind(replyId, id, tenantId, auth.userId, text).run();

  // Bump ticket.updated_at so list order reflects activity. If the replier
  // is the customer, nudge the status back to 'open' from 'waiting_customer'.
  const newStatus = !isAdminPlus(c) && ticket.status === 'waiting_customer'
    ? 'open'
    : ticket.status;
  await c.env.DB.prepare(
    "UPDATE support_tickets SET updated_at = datetime('now'), status = ? WHERE id = ? AND tenant_id = ?",
  ).bind(newStatus, id, tenantId).run();

  const row = await c.env.DB.prepare('SELECT * FROM support_ticket_replies WHERE id = ? AND tenant_id = ?')
    .bind(replyId, tenantId).first<ReplyRow>();
  return c.json({ reply: row ? formatReply(row) : { id: replyId } }, 201);
});

/** PATCH /tickets/:id — admin-only: change status, assignee, priority.
 *  Non-admin callers receive 403 even for their own tickets. */
support.patch('/tickets/:id', async (c) => {
  const auth = getAuth(c);
  if (!auth) return c.json({ error: 'Unauthorized' }, 401);
  if (!isAdminPlus(c)) return c.json({ error: 'Forbidden', message: 'Admin role required' }, 403);
  const tenantId = getTenantId(c);
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare('SELECT * FROM support_tickets WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId).first<TicketRow>();
  if (!existing) return c.json({ error: 'Ticket not found' }, 404);

  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (typeof body.status === 'string') {
    if (!ALLOWED_STATUSES.has(body.status)) {
      return c.json({ error: 'Invalid input', message: `status must be one of: ${Array.from(ALLOWED_STATUSES).join(', ')}` }, 400);
    }
    updates.push('status = ?');
    values.push(body.status);
  }
  if (typeof body.priority === 'string') {
    if (!ALLOWED_PRIORITIES.has(body.priority)) {
      return c.json({ error: 'Invalid input', message: `priority must be one of: ${Array.from(ALLOWED_PRIORITIES).join(', ')}` }, 400);
    }
    updates.push('priority = ?');
    values.push(body.priority);
  }
  if ('assignee_user_id' in body) {
    const v = body.assignee_user_id;
    if (v === null || v === '') {
      updates.push('assignee_user_id = ?');
      values.push(null);
    } else if (typeof v === 'string') {
      // Validate assignee is a user in the same tenant.
      const assignee = await c.env.DB.prepare('SELECT id FROM users WHERE id = ? AND tenant_id = ?')
        .bind(v, tenantId).first();
      if (!assignee) return c.json({ error: 'Invalid input', message: 'assignee_user_id must reference a user in this tenant' }, 400);
      updates.push('assignee_user_id = ?');
      values.push(v);
    } else {
      return c.json({ error: 'Invalid input', message: 'assignee_user_id must be a string or null' }, 400);
    }
  }

  if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400);
  updates.push("updated_at = datetime('now')");
  values.push(id, tenantId);

  await c.env.DB.prepare(
    `UPDATE support_tickets SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`,
  ).bind(...values).run();

  const updated = await c.env.DB.prepare('SELECT * FROM support_tickets WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId).first<TicketRow>();
  return c.json({ ticket: updated ? formatTicket(updated) : null });
});

export default support;
