/**
 * Real-Time Routes - WebSocket connections and dashboard broadcasting
 * Uses Durable Objects for persistent WebSocket connections per tenant.
 */

import { Hono } from 'hono';
import type { AppBindings } from '../types';

const realtime = new Hono<AppBindings>();

// GET /api/realtime/ws?tenant_id=&user_id=&channels= - WebSocket upgrade
realtime.get('/ws', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (!upgradeHeader || upgradeHeader !== 'websocket') {
    return c.json({ error: 'Expected WebSocket upgrade' }, 426);
  }

  const tenantId = c.req.query('tenant_id') || 'vantax';
  const userId = c.req.query('user_id') || 'anonymous';
  const channels = c.req.query('channels') || 'dashboard';

  // Get or create the Durable Object for this tenant
  const roomId = c.env.DASHBOARD_ROOM.idFromName(`tenant:${tenantId}`);
  const room = c.env.DASHBOARD_ROOM.get(roomId);

  // Forward the WebSocket upgrade request to the Durable Object
  const url = new URL(c.req.url);
  url.pathname = '/';
  url.searchParams.set('tenant_id', tenantId);
  url.searchParams.set('user_id', userId);
  url.searchParams.set('channels', channels);

  return room.fetch(url.toString(), {
    headers: c.req.raw.headers,
  });
});

// POST /api/realtime/broadcast - Broadcast event to connected clients
realtime.post('/broadcast', async (c) => {
  const body = await c.req.json<{
    tenant_id: string;
    channel: string;
    event: string;
    data: Record<string, unknown>;
  }>();

  if (!body.tenant_id || !body.channel || !body.event) {
    return c.json({ error: 'tenant_id, channel, and event are required' }, 400);
  }

  const roomId = c.env.DASHBOARD_ROOM.idFromName(`tenant:${body.tenant_id}`);
  const room = c.env.DASHBOARD_ROOM.get(roomId);

  const resp = await room.fetch('https://internal/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: body.channel,
      event: body.event,
      data: body.data,
      tenantId: body.tenant_id,
    }),
  });

  const result = await resp.json();
  return c.json(result);
});

// GET /api/realtime/stats?tenant_id= - Get connection stats for a tenant
realtime.get('/stats', async (c) => {
  const tenantId = c.req.query('tenant_id') || 'vantax';

  const roomId = c.env.DASHBOARD_ROOM.idFromName(`tenant:${tenantId}`);
  const room = c.env.DASHBOARD_ROOM.get(roomId);

  const resp = await room.fetch('https://internal/stats');
  const stats = await resp.json();
  return c.json(stats);
});

export default realtime;
