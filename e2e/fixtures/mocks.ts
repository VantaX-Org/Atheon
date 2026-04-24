/**
 * Network-level mocks used by the golden-path specs.
 *
 * Why mock? The Atheon backend lives on Cloudflare Workers (wrangler dev) +
 * D1 + KV + R2 — wiring all of that up in CI is painful and makes tests
 * flaky. For UI tests we only care that the frontend renders the right
 * things for a given API response, so we intercept the network layer with
 * `page.route()`. Specs that need live-backend coverage can opt out by
 * calling `page.unroute()`.
 *
 * All intercepted URLs use the glob `**` prefix so they match both the
 * default origin (https://atheon-api.vantax.co.za) and any
 * `VITE_API_URL`-configured override.
 */
import type { Page, Route } from '@playwright/test';

type JsonBody = Record<string, unknown> | Array<Record<string, unknown>>;

function jsonFulfill(status: number, body: JsonBody | string | null) {
  return {
    status,
    contentType: 'application/json',
    headers: {
      'X-Request-ID': `e2e-req-${Math.random().toString(36).slice(2, 10)}`,
      'Access-Control-Allow-Origin': '*',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body ?? {}),
  };
}

/**
 * Register a baseline set of responses that keep the SPA from throwing on
 * any page: /me, companies list, health, tenants list, etc. Specs extend
 * these by calling `page.route()` AFTER this — the last-registered handler
 * wins in Playwright.
 */
export async function installBaselineMocks(page: Page): Promise<void> {
  // In Playwright, ROUTES ARE MATCHED IN REVERSE REGISTRATION ORDER — the
  // LAST-registered handler wins for any URL that several handlers match.
  // So we register the generic catch-all FIRST, then specific responders
  // on top. Spec files then register even-more-specific responders AFTER
  // calling this function, which again take precedence.

  // Generic "swallow any unknown API hit" guard — returns a shape that's
  // palatable to most UI consumers (empty collections + success:true). Any
  // key specific pages destructure will yield [] via the common spellings.
  await page.route('**/api/**', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill(jsonFulfill(200, {
      success: true,
      items: [],
      results: [],
      total: 0,
      // Common page-specific collection keys defaulted to [] so UIs that
      // destructure (e.g. `res.risks`, `res.metrics`) don't crash on
      // `undefined.filter(...)`.
      risks: [],
      metrics: [],
      anomalies: [],
      clusters: [],
      actions: [],
      webhooks: [],
      companies: [],
      tenants: [],
      users: [],
      deliveries: [],
      imports: [],
      comments: [],
      rules: [],
      keys: [],
    }));
  });

  // Dashboard-specific: apex health has a documented shape with dimensions
  await page.route('**/api/apex/health**', (route) =>
    route.fulfill(jsonFulfill(200, {
      overall: 72,
      trend: 'improving',
      dimensions: [
        { key: 'financial',   name: 'Financial',   score: 78, trend: 'up' },
        { key: 'operational', name: 'Operational', score: 65, trend: 'down' },
        { key: 'compliance',  name: 'Compliance',  score: 81, trend: 'stable' },
        { key: 'strategic',   name: 'Strategic',   score: 70, trend: 'up' },
        { key: 'technology',  name: 'Technology',  score: 68, trend: 'stable' },
      ],
    })),
  );
  await page.route('**/api/controlplane/health**', (route) =>
    route.fulfill(jsonFulfill(200, { status: 'healthy', services: [] })),
  );
  // Dashboard sub-widgets — return null-safe "empty" shapes. Missing these
  // causes the React tree to crash via ErrorBoundary (e.g. radarCtx.summary
  // dereferences into undefined).
  await page.route('**/api/radar/context**', (route) =>
    route.fulfill(jsonFulfill(200, {
      summary: { totalSignals: 0, criticalImpacts: 0, overallSentiment: 'neutral' },
      signals: [],
    })),
  );
  await page.route('**/api/apex/dashboard-intelligence**', (route) =>
    route.fulfill(jsonFulfill(200, { insights: [], summary: '', sections: [] })),
  );
  await page.route('**/api/apex/diagnostic-summary**', (route) =>
    route.fulfill(jsonFulfill(200, { summary: { issues: 0, warnings: 0 }, items: [] })),
  );
  await page.route('**/api/apex/roi**', (route) =>
    route.fulfill(jsonFulfill(200, { items: [], total: 0, totals: { saved: 0, projected: 0 } })),
  );
  await page.route('**/api/apex/baseline**', (route) =>
    route.fulfill(jsonFulfill(200, { baseline: null, comparison: null })),
  );

  // MFA status — default disabled
  await page.route('**/api/auth/mfa/status', (route) =>
    route.fulfill(jsonFulfill(200, { enabled: false })),
  );

  // Webhooks event-type catalog
  await page.route('**/api/v1/webhooks/event-types', (route) =>
    route.fulfill(jsonFulfill(200, {
      event_types: [
        'catalyst.action.completed',
        'catalyst.action.failed',
        'apex.briefing.generated',
        'pulse.anomaly.detected',
      ],
    })),
  );

  // Auth / me
  await page.route('**/api/auth/me', (route) =>
    route.fulfill(jsonFulfill(200, {
      id: 'e2e-superadmin',
      email: 'admin@vantax.co.za',
      name: 'E2E Superadmin',
      role: 'superadmin',
      tenantId: 'vantax',
      tenantSlug: 'vantax',
      tenantName: 'Vantax',
      permissions: ['*'],
    })),
  );

  // Companies — default to empty list (switcher hidden); multi-company
  // tests override with `mockMultiCompany`.
  await page.route('**/api/erp/companies', (route) =>
    route.fulfill(jsonFulfill(200, { companies: [], total: 0 })),
  );

  // Webhooks list — let spec-specific handlers for POST/detail take over
  await page.route('**/api/v1/webhooks', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill(jsonFulfill(200, { webhooks: [], total: 0 }));
    }
    return route.fallback();
  });
}

/**
 * Make a specific company list available so CompanySwitcher renders.
 * Call AFTER installBaselineMocks to override the empty default.
 */
export async function mockMultiCompany(page: Page, count = 2): Promise<void> {
  const companies = Array.from({ length: count }, (_, i) => ({
    id: `co-${i + 1}`,
    external_id: `ext-${i + 1}`,
    source_system: 'odoo',
    code: `CO${i + 1}`,
    name: `Company ${String.fromCharCode(65 + i)}`,
    legal_name: `Company ${String.fromCharCode(65 + i)} Ltd`,
    currency: i === 0 ? 'USD' : 'EUR',
    country: i === 0 ? 'US' : 'DE',
    is_primary: i === 0 ? 1 : 0,
    status: 'active',
  }));
  await page.route('**/api/erp/companies', (route) =>
    route.fulfill(jsonFulfill(200, { companies, total: companies.length })),
  );
}

/**
 * Convenience: pre-seed the MFA endpoints used during enrollment.
 */
export async function mockMfaEnrollment(page: Page): Promise<void> {
  await page.route('**/api/auth/mfa/setup', (route) =>
    route.fulfill(jsonFulfill(200, {
      secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
      qr_uri: 'otpauth://totp/Atheon:e2e@atheon.local?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Atheon',
      provisioning_uri: 'otpauth://totp/Atheon:e2e@atheon.local?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Atheon',
    })),
  );
  // Invalid code → 400; the spec will post once with a 6-digit string
  // and expect the "Invalid code" error to surface.
  await page.route('**/api/auth/mfa/verify', (route) => {
    const body = route.request().postDataJSON() as { code?: string } | null;
    if (body?.code === '000000') {
      return route.fulfill(jsonFulfill(200, {
        success: true,
        backupCodes: ['A1B2-C3D4', 'E5F6-G7H8', 'I9J0-K1L2', 'M3N4-O5P6',
                      'Q7R8-S9T0', 'U1V2-W3X4', 'Y5Z6-A7B8', 'C9D0-E1F2'],
      }));
    }
    return route.fulfill(jsonFulfill(400, { error: 'Invalid code. Please check your authenticator and try again.' }));
  });
}

/**
 * Helper: fulfill a POST /webhooks with a deterministic created payload.
 */
export async function mockWebhookCreate(page: Page): Promise<{ id: string; secret: string }> {
  const id = 'wh_e2e_test_01';
  const secret = 'whsec_e2e_super_secret_do_not_log_abc123';
  await page.route('**/api/v1/webhooks', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as {
        url?: string;
        event_types?: string[];
        description?: string;
      } | null;
      return route.fulfill(jsonFulfill(201, {
        id,
        url: body?.url ?? 'https://example.com/hook',
        event_types: body?.event_types ?? [],
        description: body?.description ?? null,
        secret,
        created_at: new Date().toISOString(),
      }));
    }
    // Fall through to the GET handler from installBaselineMocks
    return route.fallback();
  });

  // Once created, make the list + detail endpoints return the redacted form.
  const redacted = {
    id,
    tenant_id: 'vantax',
    url: 'https://example.com/hook',
    description: null,
    event_types: ['catalyst.action.completed'],
    secret: '***',
    created_at: new Date().toISOString(),
    success_rate: null,
    last_delivery_at: null,
    last_delivery_status: null,
    disabled: false,
  };
  await page.route(`**/api/v1/webhooks/${id}`, (route) =>
    route.fulfill(jsonFulfill(200, redacted)),
  );
  await page.route(`**/api/v1/webhooks/${id}/deliveries**`, (route) =>
    route.fulfill(jsonFulfill(200, { deliveries: [], total: 0 })),
  );

  return { id, secret };
}

/**
 * Helper: stub the tenant LLM budget endpoints for the admin spec.
 */
export async function mockLlmBudget(page: Page, tenantId: string) {
  type LlmBudgetSnapshot = {
    tenantId: string;
    monthlyTokenBudget: number | null;
    tokensUsedThisMonth: number;
    tokensResetAt: string | null;
    llmRedactionEnabled: boolean;
    updatedAt: string | null;
    exists: boolean;
  };
  let current: LlmBudgetSnapshot = {
    tenantId,
    monthlyTokenBudget: 1_000_000,
    tokensUsedThisMonth: 250_000,
    tokensResetAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    llmRedactionEnabled: true,
    updatedAt: new Date().toISOString(),
    exists: true,
  };
  await page.route(`**/api/v1/admin/tenants/${tenantId}/llm-budget`, async (route: Route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as { monthlyTokenBudget?: number | null; llmRedactionEnabled?: boolean } | null;
      if (body) {
        if ('monthlyTokenBudget' in body) current = { ...current, monthlyTokenBudget: body.monthlyTokenBudget ?? null };
        if (typeof body.llmRedactionEnabled === 'boolean') current = { ...current, llmRedactionEnabled: body.llmRedactionEnabled };
        current = { ...current, updatedAt: new Date().toISOString() };
      }
    }
    return route.fulfill(jsonFulfill(200, current));
  });
  await page.route(`**/api/v1/admin/tenants/${tenantId}`, (route) =>
    route.fulfill(jsonFulfill(200, { tenant: { id: tenantId, name: 'Acme Corp', slug: 'acme' } })),
  );
  await page.route('**/api/v1/admin/tenants', (route) =>
    route.fulfill(jsonFulfill(200, {
      tenants: [{
        id: tenantId,
        name: 'Acme Corp',
        slug: 'acme',
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_deleted: false,
        data: { runs: 12, metrics: 48, risks: 3, users: 7 },
      }],
    })),
  );
}

/**
 * Helper: mock the catalyst run detail + items + comments endpoints.
 *
 * The CatalystRunDetailPage has a useEffect dep-chain bug where `toast`
 * returned from useToast is a fresh object every render, which re-creates
 * the memoized callbacks and re-fires the effect that loads data. This
 * causes an infinite render loop when data load succeeds. We work around
 * it by fulfilling the FIRST request deterministically and then ABORTING
 * subsequent ones — the React state settles with the valid data on first
 * load and subsequent calls fail silently (caught by try/catch in loader).
 */
export async function mockCatalystRun(page: Page, runId: string) {
  const fulfilled = { detail: 0, items: 0, comments: 0 };

  const detailPayload = {
    id: runId,
    subCatalystName: 'Invoice Matching',
    clusterName: 'Finance',
    clusterDomain: 'finance',
    status: 'success',
    matched: 1240,
    discrepancies: 42,
    exceptions: 7,
    totalValue: 4_800_000,
    startedAt: new Date(Date.now() - 3_600_000).toISOString(),
    completedAt: new Date().toISOString(),
    kpis: [
      { name: 'Match Rate', value: 96.5, status: 'green', unit: '%', target: 95 },
    ],
    metrics: [],
    sourceData: [],
  };
  const itemsPayload = {
    items: [
      {
        id: 'item-1',
        item_number: 1,
        item_status: 'discrepancy',
        source_ref: 'INV-001',
        source_entity: 'Acme Corp',
        source_amount: 1250.5,
        target_ref: 'PO-001',
        target_entity: 'Acme Corp',
        target_amount: 1200.0,
        discrepancy_amount: 50.5,
        discrepancy_pct: 4.2,
        review_status: 'pending',
        reviewed_by: null,
      },
      {
        id: 'item-2',
        item_number: 2,
        item_status: 'matched',
        source_ref: 'INV-002',
        source_amount: 500,
        target_ref: 'PO-002',
        target_amount: 500,
        review_status: 'pending',
        reviewed_by: null,
      },
    ],
    total: 2,
    review_progress: { approved: 0, rejected: 0, deferred: 0, pending: 2 },
  };

  await page.route(`**/api/catalysts/runs/${runId}/detail`, (route) => {
    fulfilled.detail += 1;
    if (fulfilled.detail > 1) return route.abort('failed');
    return route.fulfill(jsonFulfill(200, detailPayload));
  });

  await page.route(`**/api/catalysts/runs/${runId}/items**`, (route) => {
    if (route.request().method() === 'PUT') {
      return route.fulfill(jsonFulfill(200, { success: true, updated: 1, review_complete: false }));
    }
    fulfilled.items += 1;
    if (fulfilled.items > 1) return route.abort('failed');
    return route.fulfill(jsonFulfill(200, itemsPayload));
  });

  await page.route(`**/api/catalysts/runs/${runId}/comments`, (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill(jsonFulfill(200, { id: 'cmt-new', success: true }));
    }
    fulfilled.comments += 1;
    if (fulfilled.comments > 1) return route.abort('failed');
    return route.fulfill(jsonFulfill(200, { comments: [] }));
  });
}

/**
 * Helper: mock the /bulk-users endpoints.
 */
export async function mockBulkUsers(page: Page) {
  await page.route('**/api/iam/users**', (route) =>
    route.fulfill(jsonFulfill(200, { users: [], total: 0 })),
  );
  await page.route('**/api/v1/iam/users/import-history', (route) =>
    route.fulfill(jsonFulfill(200, { imports: [] })),
  );
  await page.route('**/api/v1/iam/users/bulk-import', (route) => {
    const body = route.request().postDataJSON() as { csv?: string; dryRun?: boolean } | null;
    const rows = (body?.csv ?? '').split(/\r?\n/).filter((l) => l.trim().length > 0);
    const dataRows = Math.max(0, rows.length - 1);
    return route.fulfill(jsonFulfill(200, {
      importId: `imp-${Date.now()}`,
      total: dataRows,
      created: dataRows,
      createdUsers: Array.from({ length: dataRows }, (_, i) => ({
        row: i + 2, id: `u${i}`, email: `user${i}@ex.com`, name: `User ${i}`, role: 'analyst',
        tempPassword: body?.dryRun ? '(dry-run)' : `Tmp-${Math.random().toString(36).slice(2, 8)}`,
      })),
      skipped: [],
      errors: [],
      dryRun: !!body?.dryRun,
    }));
  });
}
