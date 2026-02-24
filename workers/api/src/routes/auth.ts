import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { generateToken, verifyToken, hashPassword, verifyPassword } from '../middleware/auth';

const auth = new Hono<AppBindings>();

// POST /api/auth/register
auth.post('/register', async (c) => {
  const body = await c.req.json<{
    email: string; password: string; name: string; tenant_slug?: string;
  }>();

  if (!body.email || !body.password || !body.name) {
    return c.json({ error: 'Email, password and name are required' }, 400);
  }

  if (body.password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400);
  }

  const slug = body.tenant_slug || 'vantax';
  const tenant = await c.env.DB.prepare('SELECT * FROM tenants WHERE slug = ?').bind(slug).first();
  if (!tenant) {
    return c.json({ error: 'Tenant not found' }, 404);
  }

  // Check if user already exists
  const existing = await c.env.DB.prepare(
    'SELECT id FROM users WHERE email = ? AND tenant_id = ?'
  ).bind(body.email, tenant.id).first();

  if (existing) {
    return c.json({ error: 'User with this email already exists' }, 409);
  }

  const passwordHash = await hashPassword(body.password);
  const userId = crypto.randomUUID();

  await c.env.DB.prepare(
    'INSERT INTO users (id, tenant_id, email, name, role, password_hash, permissions) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(userId, tenant.id, body.email, body.name, 'analyst', passwordHash, '["read"]').run();

  const token = await generateToken({
    sub: userId,
    email: body.email,
    name: body.name,
    role: 'analyst',
    tenant_id: tenant.id as string,
    permissions: ['read'],
  }, c.env.JWT_SECRET);

  // Log audit
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), tenant.id, userId, 'register', 'auth', 'user', JSON.stringify({ email: body.email }), 'success').run();

  return c.json({
    token,
    user: {
      id: userId,
      email: body.email,
      name: body.name,
      role: 'analyst',
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      permissions: ['read'],
    },
  }, 201);
});

// POST /api/auth/login
auth.post('/login', async (c) => {
  const body = await c.req.json<{ email: string; password: string; tenant_slug?: string }>();

  if (!body.email || !body.password) {
    return c.json({ error: 'Email and password are required' }, 400);
  }

  // Find user by email
  const user = await c.env.DB.prepare(
    'SELECT u.*, t.slug as tenant_slug, t.name as tenant_name FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.email = ? AND u.status = ?'
  ).bind(body.email, 'active').first();

  if (!user) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  // Verify password if hash exists
  if (user.password_hash) {
    const valid = await verifyPassword(body.password, user.password_hash as string);
    if (!valid) {
      // Log failed attempt
      await c.env.DB.prepare(
        'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), user.tenant_id, user.id, 'login_failed', 'auth', 'session', JSON.stringify({ email: body.email, reason: 'invalid_password' }), 'failure').run();
      return c.json({ error: 'Invalid credentials' }, 401);
    }
  }

  const token = await generateToken({
    sub: user.id as string,
    email: user.email as string,
    name: user.name as string,
    role: user.role as string,
    tenant_id: user.tenant_id as string,
    permissions: JSON.parse(user.permissions as string || '[]'),
  }, c.env.JWT_SECRET);

  // Log audit
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), user.tenant_id, user.id, 'login', 'auth', 'session', JSON.stringify({ email: body.email }), 'success').run();

  // Update last login
  await c.env.DB.prepare('UPDATE users SET last_login = datetime(\'now\') WHERE id = ?').bind(user.id).run();

  return c.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenant_id,
      tenantName: user.tenant_name,
      tenantSlug: user.tenant_slug,
      permissions: JSON.parse(user.permissions as string || '[]'),
    },
  });
});

// POST /api/auth/demo-login (for demo access without password)
auth.post('/demo-login', async (c) => {
  const body = await c.req.json<{ tenant_slug?: string; role?: string }>();
  const slug = body.tenant_slug || 'vantax';
  const requestedRole = body.role || 'admin';

  const tenant = await c.env.DB.prepare('SELECT * FROM tenants WHERE slug = ?').bind(slug).first();
  if (!tenant) {
    return c.json({ error: 'Tenant not found' }, 404);
  }

  // Find or use first user for this tenant
  let user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE tenant_id = ? AND role = ? LIMIT 1'
  ).bind(tenant.id, requestedRole).first();

  if (!user) {
    user = await c.env.DB.prepare(
      'SELECT * FROM users WHERE tenant_id = ? LIMIT 1'
    ).bind(tenant.id).first();
  }

  if (!user) {
    return c.json({ error: 'No users found for tenant' }, 404);
  }

  const token = await generateToken({
    sub: user.id as string,
    email: user.email as string,
    name: user.name as string,
    role: user.role as string,
    tenant_id: user.tenant_id as string,
    permissions: JSON.parse(user.permissions as string || '[]'),
  }, c.env.JWT_SECRET);

  return c.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenant_id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      permissions: JSON.parse(user.permissions as string || '[]'),
    },
  });
});

// POST /api/auth/change-password
auth.post('/change-password', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const payload = await verifyToken(authHeader.replace('Bearer ', ''), c.env.JWT_SECRET);
  if (!payload) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  const body = await c.req.json<{ current_password?: string; new_password: string }>();

  if (!body.new_password || body.new_password.length < 8) {
    return c.json({ error: 'New password must be at least 8 characters' }, 400);
  }

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(payload.sub).first();
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  // Verify current password if it exists
  if (user.password_hash && body.current_password) {
    const valid = await verifyPassword(body.current_password, user.password_hash as string);
    if (!valid) {
      return c.json({ error: 'Current password is incorrect' }, 401);
    }
  }

  const newHash = await hashPassword(body.new_password);
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(newHash, payload.sub).run();

  // Log audit
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), payload.tenant_id, payload.sub, 'change_password', 'auth', 'user', '{}', 'success').run();

  return c.json({ success: true, message: 'Password changed successfully' });
});

// GET /api/auth/me
auth.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const payload = await verifyToken(authHeader.replace('Bearer ', ''), c.env.JWT_SECRET);
    if (!payload) {
      return c.json({ error: 'Invalid token' }, 401);
    }

    const user = await c.env.DB.prepare(
      'SELECT u.*, t.name as tenant_name, t.slug as tenant_slug FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.id = ?'
    ).bind(payload.sub).first();

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    return c.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenant_id,
      tenantName: user.tenant_name,
      tenantSlug: user.tenant_slug,
      permissions: JSON.parse(user.permissions as string || '[]'),
    });
  } catch {
    return c.json({ error: 'Invalid token' }, 401);
  }
});

// GET /api/auth/sso/:tenant_slug (SSO config for tenant)
auth.get('/sso/:tenant_slug', async (c) => {
  const slug = c.req.param('tenant_slug');
  const tenant = await c.env.DB.prepare('SELECT id FROM tenants WHERE slug = ?').bind(slug).first();
  if (!tenant) {
    return c.json({ error: 'Tenant not found' }, 404);
  }

  const sso = await c.env.DB.prepare(
    'SELECT provider, issuer_url, domain_hint FROM sso_configs WHERE tenant_id = ? AND enabled = 1'
  ).bind(tenant.id).first();

  if (!sso) {
    return c.json({ sso_enabled: false });
  }

  return c.json({
    sso_enabled: true,
    provider: sso.provider,
    issuer_url: sso.issuer_url,
    domain_hint: sso.domain_hint,
  });
});

// POST /api/auth/sso (legacy: attempt SSO login)
auth.post('/sso', async (c) => {
  const body = await c.req.json<{ provider: string; tenant_slug?: string }>();
  const slug = body.tenant_slug || 'vantax';

  const tenant = await c.env.DB.prepare('SELECT * FROM tenants WHERE slug = ?').bind(slug).first();
  if (!tenant) {
    return c.json({ error: 'Tenant not found' }, 404);
  }

  const sso = await c.env.DB.prepare(
    'SELECT * FROM sso_configs WHERE tenant_id = ? AND provider = ? AND enabled = 1'
  ).bind(tenant.id, body.provider).first();

  if (!sso) {
    return c.json({ error: 'SSO not configured for this provider' }, 404);
  }

  // Return the authorize URL for the frontend to redirect to
  const redirectUri = 'https://atheon.vantax.co.za/login';
  const state = btoa(JSON.stringify({ tenant_slug: slug, provider: body.provider }));

  if (body.provider === 'azure_ad') {
    const clientId = sso.client_id as string;
    // Extract directory tenant ID from issuer URL
    const issuerUrl = sso.issuer_url as string;
    const directoryTenantId = issuerUrl.split('/')[3] || 'common';

    const authorizeUrl = `https://login.microsoftonline.com/${directoryTenantId}/oauth2/v2.0/authorize?` +
      `client_id=${encodeURIComponent(clientId)}` +
      `&response_type=code` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent('openid profile email')}` +
      `&state=${encodeURIComponent(state)}` +
      `&response_mode=query` +
      (sso.domain_hint ? `&domain_hint=${encodeURIComponent(sso.domain_hint as string)}` : '');

    return c.json({ redirect_url: authorizeUrl });
  }

  return c.json({ error: 'Unsupported SSO provider' }, 400);
});

// POST /api/auth/sso/callback (Azure AD OAuth callback - exchange code for token)
auth.post('/sso/callback', async (c) => {
  const body = await c.req.json<{ code: string; state: string }>();

  if (!body.code || !body.state) {
    return c.json({ error: 'Authorization code and state are required' }, 400);
  }

  let stateData: { tenant_slug: string; provider: string };
  try {
    stateData = JSON.parse(atob(body.state));
  } catch {
    return c.json({ error: 'Invalid state parameter' }, 400);
  }

  const tenant = await c.env.DB.prepare('SELECT * FROM tenants WHERE slug = ?').bind(stateData.tenant_slug).first();
  if (!tenant) {
    return c.json({ error: 'Tenant not found' }, 404);
  }

  const sso = await c.env.DB.prepare(
    'SELECT * FROM sso_configs WHERE tenant_id = ? AND provider = ? AND enabled = 1'
  ).bind(tenant.id, stateData.provider).first();

  if (!sso) {
    return c.json({ error: 'SSO configuration not found' }, 404);
  }

  const clientId = sso.client_id as string;
  const issuerUrl = sso.issuer_url as string;
  const directoryTenantId = issuerUrl.split('/')[3] || 'common';
  const redirectUri = 'https://atheon.vantax.co.za/login';

  // Exchange authorization code for tokens with Azure AD
  const tokenUrl = `https://login.microsoftonline.com/${directoryTenantId}/oauth2/v2.0/token`;
  const tokenResponse = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: c.env.AZURE_AD_CLIENT_SECRET,
      code: body.code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      scope: 'openid profile email',
    }).toString(),
  });

  if (!tokenResponse.ok) {
    const err = await tokenResponse.text();
    console.error('Azure AD token exchange failed:', err);
    return c.json({ error: 'SSO authentication failed' }, 401);
  }

  const tokenData = await tokenResponse.json() as { id_token?: string; access_token?: string };

  if (!tokenData.id_token) {
    return c.json({ error: 'No ID token returned from Azure AD' }, 401);
  }

  // Decode the ID token to get user info (JWT payload is base64url-encoded)
  const idTokenParts = tokenData.id_token.split('.');
  if (idTokenParts.length !== 3) {
    return c.json({ error: 'Invalid ID token format' }, 401);
  }

  let idPayload: { email?: string; preferred_username?: string; name?: string; sub?: string; oid?: string };
  try {
    const padded = idTokenParts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(padded + '='.repeat((4 - padded.length % 4) % 4));
    idPayload = JSON.parse(decoded);
  } catch {
    return c.json({ error: 'Failed to decode ID token' }, 401);
  }

  const ssoEmail = (idPayload.email || idPayload.preferred_username || '').toLowerCase();
  const ssoName = idPayload.name || ssoEmail.split('@')[0];

  if (!ssoEmail) {
    return c.json({ error: 'No email found in SSO token' }, 401);
  }

  // Find or auto-provision user
  let user = await c.env.DB.prepare(
    'SELECT u.*, t.name as tenant_name, t.slug as tenant_slug FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.email = ? AND u.tenant_id = ?'
  ).bind(ssoEmail, tenant.id).first();

  if (!user && sso.auto_provision) {
    // Auto-provision new user
    const userId = crypto.randomUUID();
    const defaultRole = (sso.default_role as string) || 'analyst';
    const defaultPerms = defaultRole === 'admin' ? '["*"]' : '["read"]';

    await c.env.DB.prepare(
      'INSERT INTO users (id, tenant_id, email, name, role, permissions, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(userId, tenant.id, ssoEmail, ssoName, defaultRole, defaultPerms, 'active').run();

    user = await c.env.DB.prepare(
      'SELECT u.*, t.name as tenant_name, t.slug as tenant_slug FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.id = ?'
    ).bind(userId).first();

    // Log auto-provision
    await c.env.DB.prepare(
      'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), tenant.id, userId, 'sso_auto_provision', 'auth', 'user', JSON.stringify({ email: ssoEmail, provider: stateData.provider }), 'success').run();
  }

  if (!user) {
    return c.json({ error: 'User not found. Contact your administrator to provision access.' }, 403);
  }

  if (user.status !== 'active') {
    return c.json({ error: 'Account is disabled' }, 403);
  }

  // Generate Atheon JWT
  const jwtToken = await generateToken({
    sub: user.id as string,
    email: user.email as string,
    name: user.name as string,
    role: user.role as string,
    tenant_id: user.tenant_id as string,
    permissions: JSON.parse(user.permissions as string || '[]'),
  }, c.env.JWT_SECRET);

  // Update last login
  await c.env.DB.prepare('UPDATE users SET last_login = datetime(\'now\') WHERE id = ?').bind(user.id).run();

  // Log SSO login
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), user.tenant_id, user.id, 'sso_login', 'auth', 'session', JSON.stringify({ email: ssoEmail, provider: stateData.provider }), 'success').run();

  return c.json({
    token: jwtToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenant_id,
      tenantName: user.tenant_name,
      tenantSlug: user.tenant_slug,
      permissions: JSON.parse(user.permissions as string || '[]'),
    },
  });
});

export default auth;
