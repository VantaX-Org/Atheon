/**
 * Board Digest Routes — executive+ 2-page leave-behind PDF.
 *
 * Separate prefix from /api/board-report (admin+) so executives can export the
 * digest without unlocking the full board pack. report_type='board_digest'
 * isolates digest rows from full board reports.
 */
import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { collectDigestData, generateBoardDigestPDF } from '../services/board-digest-pdf';

const boardDigest = new Hono<AppBindings>();

const CROSS_TENANT_ROLES = new Set(['superadmin', 'support_admin']);
function getTenantId(c: { get: (key: string) => unknown; req: { query: (key: string) => string | undefined } }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  const defaultTenantId = auth?.tenantId || c.req.query('tenant_id') || '';
  if (CROSS_TENANT_ROLES.has(auth?.role || '')) {
    return c.req.query('tenant_id') || defaultTenantId;
  }
  return defaultTenantId;
}

// POST /api/board-digest/generate
boardDigest.post('/generate', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const auth = c.get('auth') as AuthContext | undefined;

  try {
    const data = await collectDigestData(c.env.DB, tenantId);
    const now = new Date().toISOString();
    const reportId = crypto.randomUUID();
    const title = `Board Digest — ${data.company} — ${now.substring(0, 10)}`;

    let r2Key: string | null = null;
    if (c.env.STORAGE) {
      const pdf = await generateBoardDigestPDF(data, now);
      r2Key = `reports/${tenantId}/digest-${reportId}.pdf`;
      await c.env.STORAGE.put(r2Key, pdf, { httpMetadata: { contentType: 'application/pdf' } });
    }

    await c.env.DB.prepare(
      `INSERT INTO board_reports (id, tenant_id, title, report_type, content, r2_key, generated_by, generated_at)
       VALUES (?, ?, ?, 'board_digest', ?, ?, ?, ?)`
    ).bind(reportId, tenantId, title, JSON.stringify(data), r2Key, auth?.email || null, now).run();

    try {
      await c.env.DB.prepare(
        'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        crypto.randomUUID(), tenantId, auth?.userId || null, 'board_report.digest', 'governance', 'board_reports',
        JSON.stringify({ reportId, actor: auth?.email || null }), 'success'
      ).run();
    } catch (auditErr) {
      console.error('board_digest audit log failed:', auditErr);
    }

    return c.json({ id: reportId, title, pdfUrl: r2Key ? `/api/board-digest/${reportId}/pdf` : undefined }, 201);
  } catch (err) {
    try {
      await c.env.DB.prepare(
        'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        crypto.randomUUID(), tenantId, auth?.userId || null, 'board_report.digest', 'governance', 'board_reports',
        JSON.stringify({ error: (err as Error).message, actor: auth?.email || null }), 'failure'
      ).run();
    } catch { /* swallow */ }
    return c.json({ error: 'Board digest generation failed', detail: (err as Error).message }, 500);
  }
});

// GET /api/board-digest/:id/pdf — only board_digest rows for this tenant
boardDigest.get('/:id/pdf', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const reportId = c.req.param('id');
  const report = await c.env.DB.prepare(
    "SELECT r2_key, title FROM board_reports WHERE id = ? AND tenant_id = ? AND report_type = 'board_digest'"
  ).bind(reportId, tenantId).first<{ r2_key: string | null; title: string }>();
  if (!report || !report.r2_key) return c.json({ error: 'Digest not available' }, 404);

  if (!c.env.STORAGE) return c.json({ error: 'Storage not configured' }, 500);
  const obj = await c.env.STORAGE.get(report.r2_key);
  if (!obj) return c.json({ error: 'Digest file not found in storage' }, 404);

  const safeName = (report.title || 'board-digest').replace(/["\r\n\\/:*?<>|]/g, '_').slice(0, 100);
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeName}.pdf"`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

export default boardDigest;
