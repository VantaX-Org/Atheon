import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, AppBindings } from './types';
import { apiRateLimiter, authRateLimiter, aiRateLimiter, demoAuthRateLimiter, contactRateLimiter } from './middleware/ratelimit';
import { hashPassword } from './middleware/auth';
import { auditEnrichment, requestSizeLimiter, getValidatedJsonBody } from './middleware/validation';
import { runMigrations, MIGRATION_VERSION } from './services/migrate';
import { tenantIsolation, requireRole } from './middleware/tenant';
import { DashboardRoom } from './services/realtime';
import { handleScheduled, handleQueueMessage } from './services/scheduled';
import { captureException } from './services/sentry';
import type { CatalystQueueMessage } from './services/scheduled';
import { sendOrQueueEmail } from './services/email';
import auth, { validatePasswordStrength } from './routes/auth';
import tenants from './routes/tenants';
import iam from './routes/iam';
import apex from './routes/apex';
import pulse from './routes/pulse';
import catalysts from './routes/catalysts';
import memory from './routes/memory';
import mind from './routes/mind';
import erp from './routes/erp';
import controlplane from './routes/controlplane';
import audit from './routes/audit';
import connectivity from './routes/connectivity';
import notifications from './routes/notifications';
import storage from './routes/storage';
import realtime from './routes/realtime';
import deployments from './routes/deployments';
import assessments from './routes/assessments';
import agentRoutes from './routes/agent-routes';
import aiCosts from './routes/ai-costs';
import seedVantaX from './routes/seed-vantax';
import tenantsAdmin from './routes/tenants-admin';
import radar from './routes/radar';
import diagnosticsRoutes from './routes/diagnostics';
import catalystIntelligence from './routes/catalyst-intelligence';
import roi from './routes/roi';
import boardReport from './routes/board-report';
import onboarding from './routes/onboarding';
import freshness from './routes/freshness';
import atheonScore from './routes/atheon-score';
import trialAssessment from './routes/trial-assessment';
import baselineRoutes from './routes/baseline';
import targetRoutes from './routes/targets';
import executiveSummary from './routes/executive-summary';
import adminTooling from './routes/admin-tooling';

// Export Durable Object class for Cloudflare runtime
export { DashboardRoom };

const app = new Hono<AppBindings>();

// CORS - restricted to production and preview domains
// Phase 1.6: Lock down localhost origins in production
const PRODUCTION_ORIGINS = [
  'https://atheon.vantax.co.za',
  'https://atheon-33b.pages.dev',
];
const DEV_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
];

app.use('*', cors({
  origin: (origin, c) => {
    if (!origin) return 'https://atheon.vantax.co.za';
    if (PRODUCTION_ORIGINS.includes(origin)) return origin;
    // Allow Cloudflare Pages preview deployments
    if (origin.endsWith('.atheon-33b.pages.dev')) return origin;
    // Allow localhost in non-production environments (includes on-premise and dev)
    const env = (c as unknown as { env: { ENVIRONMENT?: string } }).env;
    if (env?.ENVIRONMENT !== 'production' && DEV_ORIGINS.includes(origin)) return origin;
    return null as unknown as string;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID', 'X-Licence-Key'],
  exposeHeaders: ['Content-Length', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-Request-ID'],
  maxAge: 86400,
  credentials: true,
}));

// Security S8: X-Request-ID correlation header + H6: Security headers (CSRF protection)
app.use('*', async (c, next) => {
  const requestId = c.req.header('X-Request-ID') || crypto.randomUUID();
  c.set('requestId' as never, requestId as never);
  await next();
  c.header('X-Request-ID', requestId);
  // H6: CSRF protection — enforce SameSite=Strict on any Set-Cookie headers
  const existingCookie = c.res.headers.get('Set-Cookie');
  if (existingCookie && !existingCookie.includes('SameSite')) {
    c.res.headers.set('Set-Cookie', `${existingCookie}; SameSite=Strict; Secure`);
  }
  // Additional security headers
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
});

// Spec 7 PERF-1: Response time middleware with X-Response-Time header + slow request logging
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  c.header('X-Response-Time', `${duration}ms`);
  if (duration > 500) {
    console.warn(`[SLOW] ${c.req.method} ${c.req.path} took ${duration}ms`);
  }
  // Store metrics in KV (non-blocking, best-effort)
  try {
    const minute = Math.floor(Date.now() / 60000);
    const bucket = c.req.path.split('/').slice(0, 4).join('/');
    const key = `perf:${bucket}:${minute}`;
    const existing = await c.env.CACHE.get(key);
    const metrics = existing ? JSON.parse(existing) as { count: number; totalMs: number; slowCount: number } : { count: 0, totalMs: 0, slowCount: 0 };
    metrics.count++;
    metrics.totalMs += duration;
    if (duration > 500) metrics.slowCount++;
    c.executionCtx.waitUntil(c.env.CACHE.put(key, JSON.stringify(metrics), { expirationTtl: 3600 }));
  } catch { /* non-fatal */ }
});

// Request size limiter (1MB max)
app.use('/api/*', requestSizeLimiter(1048576));

// Audit enrichment middleware (captures IP, user-agent, logs mutations)
app.use('/api/*', auditEnrichment());

// Rate limiting
app.use('/api/auth/demo-login', demoAuthRateLimiter);
app.use('/api/auth/*', authRateLimiter);
app.use('/api/mind/*', aiRateLimiter);
app.use('/api/contact', contactRateLimiter);
app.use('/api/*', apiRateLimiter);

// 4.4: Database migrations — extracted to services/migrate.ts
// All DDL, indexes, self-heal columns, role upgrades, and seed orchestration
// now live in runMigrations(). POST /api/v1/admin/migrate is the canonical
// entry point; the legacy auto-migration middleware below provides backward compat.

// ── Auto-Migration + Guard Middleware ──
// On first request: runs migrations automatically (backward compat).
// Once KV flag is set, subsequent requests skip migration.
// Returns 503 only if migration was attempted and failed.
app.use('*', async (c, next) => {
  const path = c.req.path;
  if (path === '/healthz' || path === '/' || path.includes('/admin/migrate') || path.includes('/admin/setup')) {
    await next();
    return;
  }

  const migrationKey = `db:migrated:${MIGRATION_VERSION}`;
  const alreadyMigrated = await c.env.CACHE.get(migrationKey);

  if (alreadyMigrated === 'true') {
    // Already migrated — proceed
    await next();
    return;
  }

  if (alreadyMigrated === 'error') {
    // Previous migration attempt failed — return 503
    return c.json({
      error: 'Service unavailable',
      message: 'Database migration failed. Call POST /api/v1/admin/migrate to retry.',
      version: MIGRATION_VERSION,
    }, 503);
  }

  // No flag yet — attempt auto-migration (legacy backward compat)
  try {
    await runMigrations(c.env.DB);
    await c.env.CACHE.put(migrationKey, 'true', { expirationTtl: 86400 });
  } catch (e) {
    console.error('Auto-migration error:', e);
    await c.env.CACHE.put(migrationKey, 'error', { expirationTtl: 300 });
    return c.json({
      error: 'Service unavailable',
      message: 'Database migration failed on first request. Call POST /api/v1/admin/migrate to retry.',
      version: MIGRATION_VERSION,
    }, 503);
  }

  await next();
});

// Root endpoint — versioned
app.get('/', (c) => {
  return c.json({
    name: 'Atheon™ Enterprise Intelligence Platform API',
    version: '4.0.0',
    apiVersion: 'v1',
    status: 'operational',
    endpoints: {
      auth: '/api/v1/auth',
      tenants: '/api/v1/tenants',
      iam: '/api/v1/iam',
      apex: '/api/v1/apex',
      pulse: '/api/v1/pulse',
      catalysts: '/api/v1/catalysts',
      memory: '/api/v1/memory',
      mind: '/api/v1/mind',
      erp: '/api/v1/erp',
      controlplane: '/api/v1/controlplane',
      audit: '/api/v1/audit',
      connectivity: '/api/v1/connectivity',
      notifications: '/api/v1/notifications',
      storage: '/api/v1/storage',
      realtime: '/api/v1/realtime',
      assessments: '/api/v1/assessments',
      diagnostics: '/api/v1/diagnostics',
      'catalyst-intelligence': '/api/v1/catalyst-intelligence',
      radar: '/api/v1/radar',
      roi: '/api/v1/roi',
      'board-report': '/api/v1/board-report',
      'atheon-score': '/api/v1/atheon-score',
      trial: '/api/v1/trial',
      baseline: '/api/v1/baseline',
      targets: '/api/v1/targets',
      'executive-summary': '/api/v1/executive-summary',
    },
    protocols: {
      mcp: '/api/v1/connectivity/mcp',
      a2a: '/api/v1/connectivity/a2a',
      websocket: '/api/v1/realtime/ws',
    },
    documentation: 'https://atheon.vantax.co.za',
  });
});

// GAP-05: Enhanced health check with DB connectivity probe
app.get('/healthz', async (c) => {
  const t0 = Date.now();
  let dbStatus = 'ok';
  let dbLatencyMs = 0;
  try {
    const dbStart = Date.now();
    await c.env.DB.prepare('SELECT 1').first();
    dbLatencyMs = Date.now() - dbStart;
  } catch (err) {
    dbStatus = 'error';
    console.error('Healthz DB probe failed:', err);
  }

  let cacheStatus = 'ok';
  try {
    await c.env.CACHE.put('healthz:probe', '1', { expirationTtl: 60 });
    const val = await c.env.CACHE.get('healthz:probe');
    if (val !== '1') cacheStatus = 'degraded';
  } catch {
    cacheStatus = 'error';
  }

  // Spec 7 PERF-2: Aggregate performance metrics from KV
  let avgResponseMs = 0;
  let slowRequestsLastHour = 0;
  try {
    const now = Date.now();
    const currentMinute = Math.floor(now / 60000);
    let totalRequests = 0;
    let totalMs = 0;
    let totalSlow = 0;
    // Sample last 60 minutes from a known bucket
    for (let m = currentMinute - 60; m <= currentMinute; m++) {
      const raw = await c.env.CACHE.get(`perf:/api:${m}`);
      if (raw) {
        const parsed = JSON.parse(raw) as { count: number; totalMs: number; slowCount: number };
        totalRequests += parsed.count;
        totalMs += parsed.totalMs;
        totalSlow += parsed.slowCount;
      }
    }
    avgResponseMs = totalRequests > 0 ? Math.round(totalMs / totalRequests) : 0;
    slowRequestsLastHour = totalSlow;
  } catch { /* non-fatal */ }

  const overall = dbStatus === 'ok' && cacheStatus === 'ok' ? 'healthy' : 'degraded';
  const statusCode = overall === 'healthy' ? 200 : 503;

  return c.json({
    status: overall,
    timestamp: new Date().toISOString(),
    uptime: Date.now() - t0,
    checks: {
      database: { status: dbStatus, latencyMs: dbLatencyMs },
      cache: { status: cacheStatus },
    },
    performance: {
      avg_response_ms: avgResponseMs,
      slow_requests_last_hour: slowRequestsLastHour,
      d1_query_ms: dbLatencyMs,
    },
  }, statusCode);
});

// Tenant isolation middleware for protected routes (supports both /api/ and /api/v1/ prefixes)
// Auth routes are excluded (login/register don't have JWT yet)
const protectedPrefixes = ['tenants', 'iam', 'apex', 'pulse', 'catalysts', 'memory', 'mind', 'erp', 'controlplane', 'audit', 'connectivity', 'notifications', 'storage', 'realtime', 'assessments', 'deployments', 'ai-costs', 'radar', 'diagnostics', 'catalyst-intelligence', 'roi', 'board-report', 'onboarding', 'freshness', 'atheon-score', 'baseline', 'targets', 'executive-summary'];
for (const prefix of protectedPrefixes) {
  app.use(`/api/${prefix}/*`, tenantIsolation());
  app.use(`/api/v1/${prefix}/*`, tenantIsolation());
}
// Agent routes are mounted at /api/agent — outside tenantIsolation (they use X-Licence-Key, not JWT)

// Bug #3 fix: Server-side role enforcement for admin-only routes
// superadmin: full platform access (tenants, IAM, controlplane, etc.)
// support_admin: configure catalysts, manage users, IAM, ERP, connectivity
// admin: company admin with full tenant access
const platformAdminPrefixes = ['tenants'];
for (const prefix of platformAdminPrefixes) {
  app.use(`/api/${prefix}/*`, requireRole('superadmin'));
  app.use(`/api/v1/${prefix}/*`, requireRole('superadmin'));
}
const platformAdminRoutePrefixes = ['iam', 'controlplane', 'erp', 'audit', 'connectivity'];
for (const prefix of platformAdminRoutePrefixes) {
  app.use(`/api/${prefix}/*`, requireRole('superadmin', 'support_admin', 'admin'));
  app.use(`/api/v1/${prefix}/*`, requireRole('superadmin', 'support_admin', 'admin'));
}

// §9.6 Permission model for V3 routes
// board-report: admin+ (executive content)
for (const p of ['/api/board-report/*', '/api/v1/board-report/*']) {
  app.use(p, requireRole('superadmin', 'support_admin', 'admin'));
}
// radar, diagnostics, catalyst-intelligence, roi: all authenticated users (read via tenantIsolation)
// onboarding, freshness: all authenticated users (self-service)

// Mount route modules (both /api/ and /api/v1/ for backward compatibility)
const routeModules: [string, typeof auth][] = [
  ['auth', auth], ['tenants', tenants], ['iam', iam], ['apex', apex],
  ['pulse', pulse], ['catalysts', catalysts], ['memory', memory], ['mind', mind],
  ['erp', erp], ['controlplane', controlplane], ['audit', audit],
  ['connectivity', connectivity], ['notifications', notifications],
  ['storage', storage], ['realtime', realtime],
  ['deployments', deployments], ['assessments', assessments],
  ['ai-costs', aiCosts],
  ['radar', radar], ['diagnostics', diagnosticsRoutes],
  ['catalyst-intelligence', catalystIntelligence],
  ['roi', roi], ['board-report', boardReport],
  ['onboarding', onboarding], ['freshness', freshness],
  ['atheon-score', atheonScore], ['baseline', baselineRoutes],
  ['targets', targetRoutes], ['executive-summary', executiveSummary],
];
for (const [name, handler] of routeModules) {
  app.route(`/api/${name}`, handler);
  app.route(`/api/v1/${name}`, handler);
}

// §11.1 Trial Assessment — PUBLIC routes (no auth required)
app.route('/api/trial', trialAssessment);
app.route('/api/v1/trial', trialAssessment);

// VantaX demo seeder - restricted to VantaX tenant only (needs tenantIsolation for auth context)
app.use('/api/v1/seed-vantax/*', tenantIsolation());
app.route('/api/v1/seed-vantax', seedVantaX);

// Tenant admin routes need auth middleware (tenantIsolation sets c.get('auth'))
// Scoped to /tenants/* so /admin/setup and /admin/migrate (JWT-free) are not blocked
app.use('/api/v1/admin/tenants/*', tenantIsolation());
app.use('/api/v1/admin/tenants/*', requireRole('superadmin'));
app.route('/api/v1/admin', tenantsAdmin);

// Admin Tooling routes (ADMIN-001 to ADMIN-012)
app.use('/api/v1/admin-tooling/*', tenantIsolation());
app.use('/api/admin-tooling/*', tenantIsolation());
app.route('/api/v1/admin-tooling', adminTooling);
app.route('/api/admin-tooling', adminTooling);


// Agent routes mounted separately — no tenantIsolation middleware
app.route('/api/agent', agentRoutes);
app.route('/api/v1/agent', agentRoutes);

// ── Admin Setup Endpoint ──
// Secure one-time admin provisioning gated by SETUP_SECRET (replaces hardcoded password seeding)
// Usage: POST /api/v1/admin/setup with { "setup_secret": "...", "email": "...", "password": "..." }

/** Body shape for admin setup request */
interface AdminSetupBody extends Record<string, unknown> {
  setup_secret: string;
  email: string;
  password: string;
}

/**
 * POST /api/v1/admin/setup — Reset a superadmin account password securely.
 * Gated by the SETUP_SECRET environment variable (set via `wrangler secret put SETUP_SECRET`).
 * Returns 404 when SETUP_SECRET is not configured (endpoint disabled in production by default).
 * @param setup_secret - Must match env.SETUP_SECRET
 * @param email - Email of the superadmin account to reset
 * @param password - New password (min 8 chars)
 */
app.post('/api/v1/admin/setup', async (c) => {
  const env = c.env as Env;

  // Endpoint disabled when SETUP_SECRET is not configured
  if (!env.SETUP_SECRET) {
    return c.json({ error: 'Not found', path: c.req.path }, 404);
  }

  // Parse raw body first to get unsanitized setup_secret, then validate email/password separately
  let rawBody: AdminSetupBody;
  try {
    rawBody = await c.req.json<AdminSetupBody>();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!rawBody.setup_secret || typeof rawBody.setup_secret !== 'string' || rawBody.setup_secret.length < 8) {
    return c.json({ error: 'Validation failed', details: ['setup_secret must be a string with at least 8 characters'] }, 400);
  }

  // Validate email via getValidatedJsonBody (sanitization is fine for email)
  const { data, errors } = await getValidatedJsonBody<AdminSetupBody>(c, [
    { field: 'email', type: 'email', required: true },
  ]);

  if (errors.length > 0 || !data) {
    return c.json({ error: 'Validation failed', details: errors }, 400);
  }

  // Validate password from raw body (unsanitized) to avoid sanitizer stripping <>, on\w+= etc.
  const rawPassword = rawBody.password;
  if (!rawPassword || typeof rawPassword !== 'string' || rawPassword.length < 8 || rawPassword.length > 128) {
    return c.json({ error: 'Validation failed', details: ['password must be 8-128 characters'] }, 400);
  }

  // Security: enforce password strength for superadmin accounts (same rules as registration)
  const pwCheck = validatePasswordStrength(rawPassword);
  if (!pwCheck.valid) {
    return c.json({ error: 'Weak password', details: pwCheck.errors }, 400);
  }

  // Constant-time comparison to prevent timing attacks (no early return on length mismatch)
  // Use raw (unsanitized) setup_secret to avoid sanitizer stripping special chars
  // Iterate over max length so loop duration doesn't reveal secret length
  const secretBytes = new TextEncoder().encode(rawBody.setup_secret);
  const expectedBytes = new TextEncoder().encode(env.SETUP_SECRET);
  let mismatch = secretBytes.length !== expectedBytes.length ? 1 : 0;
  const len = Math.max(secretBytes.length, expectedBytes.length);
  for (let i = 0; i < len; i++) {
    mismatch |= (secretBytes[i] ?? 0) ^ (expectedBytes[i] ?? 0);
  }
  if (mismatch !== 0) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // Find the user — must be a superadmin
  const user = await env.DB.prepare(
    'SELECT id, role FROM users WHERE email = ?'
  ).bind(data.email).first<{ id: string; role: string }>();

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  if (user.role !== 'superadmin') {
    return c.json({ error: 'Only superadmin accounts can be provisioned via this endpoint' }, 403);
  }

  // Hash and set the new password (use raw unsanitized password)
  const newHash = await hashPassword(rawPassword);
  await env.DB.prepare(
    'UPDATE users SET password_hash = ? WHERE id = ?'
  ).bind(newHash, user.id).run();

  // Audit log
  try {
    await env.DB.prepare(
      'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(), 'system', 'admin.setup.password_reset', 'security', 'users',
      JSON.stringify({ email: data.email, userId: user.id }),
      'success'
    ).run();
  } catch (err) {
    console.error('Admin setup audit log failed:', err);
  }

  return c.json({ success: true, message: `Password updated for ${data.email}` });
});

// Also mount at /api/admin/setup for backward compat
app.post('/api/admin/setup', async (c) => {
  // Forward to v1 handler
  const url = new URL(c.req.url);
  url.pathname = '/api/v1/admin/setup';
  const newReq = new Request(url.toString(), c.req.raw);
  return app.fetch(newReq, c.env, c.executionCtx);
});

// ── Admin Migrate Endpoint ──
// Runs all database migrations on demand. Requires X-Setup-Secret header.
// CI/CD pipeline should call this after each deployment.

/**
 * POST /api/v1/admin/migrate — Apply database migrations.
 * Auth: X-Setup-Secret header (matches env.SETUP_SECRET). JWT auth is not available
 * because tenantIsolation middleware does not run on /admin/* routes.
 * Returns MigrationResult with stats on tables created, indexes, columns healed, seeds run.
 */
app.post('/api/v1/admin/migrate', async (c) => {
  const env = c.env as Env;

  // Auth: X-Setup-Secret header required (JWT auth is not available here since
  // tenantIsolation middleware does not run on /admin/* routes)
  const setupSecret = c.req.header('X-Setup-Secret');
  if (!setupSecret || !env.SETUP_SECRET) {
    return c.json({ error: 'Forbidden — X-Setup-Secret header required' }, 403);
  }

  // Iterate over max length so loop duration doesn't reveal secret length
  const a = new TextEncoder().encode(setupSecret);
  const b = new TextEncoder().encode(env.SETUP_SECRET);
  let mismatch = a.length !== b.length ? 1 : 0;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  if (mismatch !== 0) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  try {
    const migrationResult = await runMigrations(env.DB);

    // Cache migration status
    const migrationKey = `db:migrated:${MIGRATION_VERSION}`;
    await env.CACHE.put(migrationKey, 'true', { expirationTtl: 86400 });

    // Audit log
    try {
      await env.DB.prepare(
        'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        crypto.randomUUID(), 'system', 'admin.migrate', 'infrastructure', 'database',
        JSON.stringify(migrationResult),
        migrationResult.errors.length === 0 ? 'success' : 'partial'
      ).run();
    } catch (err) {
      console.error('Migration audit log failed:', err);
    }

    return c.json(migrationResult);
  } catch (err) {
    console.error('Migration failed:', err);
    return c.json({ error: 'Migration failed', message: (err as Error).message }, 500);
  }
});

// Backward compat for /api/admin/migrate
app.post('/api/admin/migrate', async (c) => {
  const url = new URL(c.req.url);
  url.pathname = '/api/v1/admin/migrate';
  const newReq = new Request(url.toString(), c.req.raw);
  return app.fetch(newReq, c.env, c.executionCtx);
});

// HTML escape helper to prevent injection in email bodies
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// POST /api/contact - Contact form submission (sends email to atheon@vantax.co.za)
app.post('/api/contact', async (c) => {
  try {
    const body = await c.req.json<{ name: string; email: string; company?: string; message: string }>();
    if (!body.name || !body.email || !body.message) {
      return c.json({ error: 'Name, email, and message are required' }, 400);
    }

    // Sanitize all user input for HTML email body
    const safeName = escapeHtml(body.name);
    const safeEmail = escapeHtml(body.email);
    const safeCompany = escapeHtml(body.company || 'Not provided');
    const safeMessage = escapeHtml(body.message).replace(/\n/g, '<br>');

    // Try to send via Microsoft Graph API if configured
    const env = c.env as Env;
    if (env.MS_GRAPH_CLIENT_ID && env.MS_GRAPH_CLIENT_SECRET && env.MS_GRAPH_TENANT_ID) {
      try {
        const tokenRes = await fetch(`https://login.microsoftonline.com/${env.MS_GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: env.MS_GRAPH_CLIENT_ID,
            client_secret: env.MS_GRAPH_CLIENT_SECRET,
            scope: 'https://graph.microsoft.com/.default',
            grant_type: 'client_credentials',
          }),
        });
        const tokenData = await tokenRes.json() as { access_token?: string };
        if (tokenData.access_token) {
          try {
            await fetch('https://graph.microsoft.com/v1.0/users/atheon@vantax.co.za/sendMail', {
              method: 'POST',
              headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: {
                  subject: `Atheon Contact: ${body.name} from ${body.company || 'Unknown'}`,
                  body: { contentType: 'HTML', content: `<h3>New Contact Form Submission</h3><p><strong>Name:</strong> ${safeName}</p><p><strong>Email:</strong> ${safeEmail}</p><p><strong>Company:</strong> ${safeCompany}</p><p><strong>Message:</strong></p><p>${safeMessage}</p>` },
                  toRecipients: [{ emailAddress: { address: 'atheon@vantax.co.za' } }],
                  replyTo: [{ emailAddress: { address: body.email, name: body.name } }],
                },
              }),
            });
            console.log('[Contact Form] Graph email sent successfully');
          } catch (graphErr) {
            console.error('[Contact Form] Graph email send failed, queuing for retry:', graphErr);
            // Queue email for retry as fallback
            try {
              await sendOrQueueEmail(c.env.DB, {
                to: ['atheon@vantax.co.za'],
                subject: `Atheon Contact: ${body.name} from ${body.company || 'Unknown'}`,
                htmlBody: `<h3>New Contact Form Submission</h3><p><strong>Name:</strong> ${safeName}</p><p><strong>Email:</strong> ${safeEmail}</p><p><strong>Company:</strong> ${safeCompany}</p><p><strong>Message:</strong></p><p>${safeMessage}</p>`,
                textBody: `New Contact Form Submission\nName: ${body.name}\nEmail: ${body.email}\nCompany: ${body.company || 'Unknown'}\nMessage: ${body.message}`,
                tenantId: 'system',
              }, c.env);
            } catch (queueErr) {
              console.error('[Contact Form] Fallback email queue also failed:', queueErr);
            }
          }
        }
      } catch (err) { console.error('[Contact Form] Graph token fetch failed:', err); }
    }

    // Always log to DB as a fallback for audit trail
    try {
      await c.env.DB.prepare(
        'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), 'system', 'contact_form.submitted', 'marketing', 'contact',
        JSON.stringify({ name: body.name, email: body.email, company: body.company, message: body.message }),
        'success'
      ).run();
    } catch (err) { console.error('[Contact Form] DB log failed:', err); }

    return c.json({ success: true, message: 'Your message has been received. We will be in touch shortly.' });
  } catch (err) {
    console.error('Contact form handler failed:', err);
    return c.json({ error: 'Failed to process contact form' }, 500);
  }
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found', path: c.req.path }, 404);
});

// Error handler — consistent format, no stack traces in production, reports to Sentry
app.onError((err, c) => {
  console.error('Unhandled error:', err);

  // Report to Sentry if configured
  const sentryDsn = c.env?.SENTRY_DSN;
  if (sentryDsn) {
    const auth = c.get('auth') as { userId?: string; email?: string } | undefined;
    captureException(err, {
      dsn: sentryDsn,
      environment: c.env?.ENVIRONMENT || 'production',
      tags: { url: c.req.url, method: c.req.method },
      extra: { userAgent: c.req.header('user-agent') || 'unknown' },
      request: { url: c.req.url, method: c.req.method },
      user: auth ? { id: auth.userId || 'unknown', email: auth.email } : undefined,
      ctx: c.executionCtx,
    });
  }

  const isDev = c.env?.ENVIRONMENT !== 'production';
  return c.json({
    error: 'Internal server error',
    message: isDev ? err.message : 'An unexpected error occurred',
    ...(isDev ? { stack: err.stack } : {}),
  }, 500);
});

// Export the app as the default fetch handler
// Also export scheduled handler (Cron Triggers) and queue consumer
export default {
  fetch: app.fetch,
  scheduled: handleScheduled,
  queue: handleQueueMessage,
} satisfies ExportedHandler<Env & { CATALYST_QUEUE?: Queue<CatalystQueueMessage> }>;
