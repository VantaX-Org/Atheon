/**
 * SPEC-011: OpenAPI 3.1 specification endpoint
 * Serves the auto-generated OpenAPI spec for the Atheon API.
 */
import { Hono } from 'hono';
import type { AppBindings } from '../types';

const openapi = new Hono<AppBindings>();

const OPENAPI_SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'Atheon Enterprise Intelligence Platform API',
    version: '1.0.0',
    description: 'REST API for the Atheon business health intelligence platform. Provides endpoints for authentication, tenant management, business health analytics, catalyst automation, ERP integration, and more.',
    contact: { name: 'Atheon Support', url: 'https://atheon.vantax.co.za' },
    license: { name: 'Proprietary' },
  },
  servers: [
    { url: 'https://atheon-api.vantax.co.za', description: 'Production' },
    { url: 'http://localhost:8787', description: 'Local Development' },
  ],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-Licence-Key' },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          details: { type: 'array', items: { type: 'string' } },
        },
        required: ['error'],
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          name: { type: 'string' },
          role: { type: 'string', enum: ['superadmin', 'support_admin', 'admin', 'executive', 'manager', 'analyst', 'operator', 'viewer'] },
          tenantId: { type: 'string', format: 'uuid' },
          permissions: { type: 'array', items: { type: 'string' } },
        },
      },
      HealthScore: {
        type: 'object',
        properties: {
          overall_score: { type: 'number', minimum: 0, maximum: 100 },
          dimensions: { type: 'object', additionalProperties: { type: 'object', properties: { score: { type: 'number' }, trend: { type: 'string' }, delta: { type: 'number' } } } },
          calculated_at: { type: 'string', format: 'date-time' },
        },
      },
      CatalystCluster: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          domain: { type: 'string' },
          status: { type: 'string', enum: ['active', 'paused', 'error'] },
          sub_catalysts: { type: 'array', items: { type: 'object' } },
        },
      },
      Tenant: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          slug: { type: 'string' },
          industry: { type: 'string' },
          status: { type: 'string' },
        },
      },
    },
    parameters: {
      tenantId: { name: 'tenant_id', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Tenant ID for cross-tenant access (superadmin/support_admin only)' },
      industry: { name: 'industry', in: 'query', schema: { type: 'string' }, description: 'Industry vertical filter' },
    },
  },
  paths: {
    '/api/v1/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'User login',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string' }, password: { type: 'string' }, tenant_slug: { type: 'string' } }, required: ['email', 'password'] } } } },
        responses: { '200': { description: 'Login successful' }, '401': { description: 'Invalid credentials' }, '429': { description: 'Account locked' } },
      },
    },
    '/api/v1/auth/register': {
      post: {
        tags: ['Authentication'],
        summary: 'User registration',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string' }, password: { type: 'string' }, name: { type: 'string' }, tenant_slug: { type: 'string' } }, required: ['email', 'password', 'name'] } } } },
        responses: { '201': { description: 'User created' }, '409': { description: 'User exists' } },
      },
    },
    '/api/v1/apex/health': {
      get: {
        tags: ['Apex - Executive Intelligence'],
        summary: 'Get business health score',
        parameters: [{ $ref: '#/components/parameters/tenantId' }, { $ref: '#/components/parameters/industry' }],
        responses: { '200': { description: 'Health score data', content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthScore' } } } } },
      },
    },
    '/api/v1/apex/briefing': { get: { tags: ['Apex - Executive Intelligence'], summary: 'Get executive briefing', responses: { '200': { description: 'Briefing data' } } } },
    '/api/v1/apex/risks': { get: { tags: ['Apex - Executive Intelligence'], summary: 'List business risks', responses: { '200': { description: 'Risk list' } } } },
    '/api/v1/pulse/metrics': { get: { tags: ['Pulse - Operational Metrics'], summary: 'List operational metrics', responses: { '200': { description: 'Metrics list' } } } },
    '/api/v1/pulse/anomalies': { get: { tags: ['Pulse - Operational Metrics'], summary: 'List detected anomalies', responses: { '200': { description: 'Anomalies list' } } } },
    '/api/v1/catalysts/clusters': { get: { tags: ['Catalysts - Automation'], summary: 'List catalyst clusters', responses: { '200': { description: 'Clusters list' } } } },
    '/api/v1/mind/query': { post: { tags: ['Mind - AI Assistant'], summary: 'Query the AI assistant', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } } }, responses: { '200': { description: 'AI response' } } } },
    '/api/v1/memory/entities': { get: { tags: ['Memory - Knowledge Graph'], summary: 'List knowledge entities', responses: { '200': { description: 'Entities list' } } } },
    '/api/v1/erp/connections': { get: { tags: ['ERP Integration'], summary: 'List ERP connections', responses: { '200': { description: 'Connections list' } } } },
    '/api/v1/erp/sync/{connection_id}': { post: { tags: ['ERP Integration'], summary: 'Trigger ERP sync', parameters: [{ name: 'connection_id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Sync result' } } } },
    '/api/v1/tenants': { get: { tags: ['Tenant Management'], summary: 'List tenants (superadmin)', responses: { '200': { description: 'Tenants list' } } } },
    '/api/v1/iam/users': { get: { tags: ['IAM'], summary: 'List users', responses: { '200': { description: 'Users list' } } } },
    '/api/v1/audit': { get: { tags: ['Audit'], summary: 'Query audit log', responses: { '200': { description: 'Audit entries' } } } },
    '/api/v1/notifications': { get: { tags: ['Notifications'], summary: 'List notifications', responses: { '200': { description: 'Notifications list' } } } },
    '/api/v1/billing/plans': { get: { tags: ['Billing'], summary: 'List available plans', responses: { '200': { description: 'Plans list' } } } },
    '/api/v1/billing/subscription': { get: { tags: ['Billing'], summary: 'Get current subscription', responses: { '200': { description: 'Subscription data' } } } },
    '/healthz': { get: { tags: ['System'], summary: 'Health check', security: [], responses: { '200': { description: 'System healthy' }, '503': { description: 'System degraded' } } } },
  },
  tags: [
    { name: 'Authentication', description: 'User authentication and session management' },
    { name: 'Apex - Executive Intelligence', description: 'Executive-level business health analytics' },
    { name: 'Pulse - Operational Metrics', description: 'Operational metrics and anomaly detection' },
    { name: 'Catalysts - Automation', description: 'Automated business process catalysts' },
    { name: 'Mind - AI Assistant', description: 'AI-powered query and analysis' },
    { name: 'Memory - Knowledge Graph', description: 'Knowledge graph and entity management' },
    { name: 'ERP Integration', description: 'ERP system connections and data sync' },
    { name: 'Tenant Management', description: 'Multi-tenant administration' },
    { name: 'IAM', description: 'Identity and access management' },
    { name: 'Audit', description: 'Audit logging and compliance' },
    { name: 'Notifications', description: 'User notifications' },
    { name: 'Billing', description: 'Subscription and billing management' },
    { name: 'System', description: 'System health and diagnostics' },
  ],
};

// GET /api/v1/openapi.json
openapi.get('/openapi.json', (c) => {
  return c.json(OPENAPI_SPEC);
});

// GET /api/v1/docs — Swagger UI redirect
openapi.get('/docs', (c) => {
  const html = `<!DOCTYPE html>
<html><head><title>Atheon API Docs</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
</head><body>
<div id="swagger-ui"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: '/api/v1/openapi.json', dom_id: '#swagger-ui' });</script>
</body></html>`;
  return c.html(html);
});

export default openapi;
