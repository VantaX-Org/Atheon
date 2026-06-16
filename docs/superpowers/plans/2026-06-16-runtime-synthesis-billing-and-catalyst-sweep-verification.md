# Runtime Synthesis → Billing & Catalyst-Sweep Verification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the verify harness to prove the system's own runtime RCA synthesis is well-formed (A1) and that billing correctly refuses an un-ERP-anchored synthesized RCA (A2-boundary), plus sweep every enabled sub-catalyst through the live execute endpoint (B).

**Architecture:** A new SETUP_SECRET-gated admin-ops route group (`/api/v1/admin/verify-ops/*`) exposes four deploy-tooling operations that call the *same* runtime functions the cron/app call (`runPhase10ChainForTenant`, an RCA resolve UPDATE mirroring `markResolved`, a prescription-linked completed-action insert, `verifyCompletedActions`). New verification matrices orchestrate these over HTTP and assert synthesis traceability + the billing ERP-anchor boundary. The catalyst sweep is flag-gated so it does not bloat the default matrix set.

**Tech Stack:** Cloudflare Workers (Hono), D1 (SQLite), vitest (`cloudflare:test` miniflare for worker units; `vitest.verification.config.ts` for live matrices), TypeScript.

---

## Background facts (verified in code — do not re-derive)

- **Synthesis trigger:** `runPhase10ChainForTenant(db, tenantId)` — [phase-10-analytics-runner.ts:53](../../../workers/api/src/services/phase-10-analytics-runner.ts#L53). Best-effort per step. Synthesizer `cross-catalyst-rca-synthesizer.ts` inserts `root_cause_analyses` with **`status='active'`**, `confidence` 0–100 (avg of factor confidences), and `causal_factors` (factor_type symptom/external_driver/transitive_external; impact_value may be null for symptom, >0 for drivers).
- **Billing** (`billing-engine.ts`): `computeBillablePeriod` bills RCAs with `status='resolved'` + `confidence/100 >= 0.70` ([:225](../../../workers/api/src/services/billing-engine.ts#L225)) JOIN `causal_factors` (impact_value>0, MAX→attributed_savings) AND a prescription-linked `catalyst_actions` with `verification_status='verified'`. `BillableLineItem = { rca_id, attributed_savings, verified_action_ids }`. Line items are absent unless ALL gates pass.
- **Verification** (`erp-action-verification.ts`): `verifyCompletedActions(db, tenantId)` selects `catalyst_actions` with `status='completed' AND verification_status IS NULL AND completed_at > now-lookback`, calls `verifyAction`. `'verified'` only via `verifyXeroAction`; SAP/unknown vendor → `'deferred'`; stub/preview output_data → `'skipped'`. vantax is SAP ⇒ never `'verified'` over the real chain. **This is why A2 is a negative control.**
- **Read endpoints (HTTP, tenant-auth):** `GET /api/diagnostics/?status=active&limit=100` → `{ analyses: [{ id, metricId, confidence, status, generatedAt }] }`; `GET /api/diagnostics/rca/:rcaId/chain` → `{ rca:{...}, factors:[{ factorType, impactValue, impactUnit, confidence, evidence, ... }] }`; `GET /api/billing/period?from=YYYY-MM-DD&to=YYYY-MM-DD` → `{ period: { line_items: [{ rca_id, attributed_savings, verified_action_ids }] , total_realised_savings, ... } }` (persist:false preview — non-destructive).
- **SETUP_SECRET routes** self-gate on `X-Setup-Secret === env.SETUP_SECRET`, no JWT (see `demo-seed.ts:31-34`). Mounted under `/api/v1/admin` ([index.ts:601](../../../workers/api/src/index.ts#L601)).
- **Worker test harness:** `cloudflare:test` exports `env` (with `env.DB` + bound `SETUP_SECRET: 'test-setup-secret-for-testing123'` from `workers/api/vitest.config.ts:28`) and `SELF.fetch('http://localhost<path>', ...)`. Run units: `cd workers/api && npx vitest run`.
- **Verify client** (`verification/lib/client.ts`): `ApiClient` with `authedFetch(path, init)` (Bearer), `reseed()`, `executeSubCatalyst(subName) → { runId, status }`, `getRun(runId)`. `CONFIG` in `verification/config.ts`.

---

## File Structure

- **Create** `workers/api/src/routes/admin-ops.ts` — the four verify-ops endpoints. One responsibility: SETUP_SECRET deploy-tooling that drives the synthesis→billing chain for a named tenant.
- **Modify** `workers/api/src/index.ts` — mount the new router.
- **Create** `workers/api/src/__tests__/admin-ops.test.ts` — miniflare unit tests (gate + each op).
- **Modify** `verification/config.ts` — add `setupSecret`.
- **Modify** `verification/lib/client.ts` — add the verify-ops + read client methods.
- **Create** `verification/matrices/runtime-synthesis.matrix.test.ts` — A1 + A2.
- **Create** `verification/matrices/catalyst-execute-sweep.matrix.test.ts` — B (flag-gated).

---

## Task 1: admin-ops router skeleton + `run-phase10-chain` op + mount

**Files:**
- Create: `workers/api/src/routes/admin-ops.ts`
- Modify: `workers/api/src/index.ts` (imports near line 42; mount near line 601)
- Test: `workers/api/src/__tests__/admin-ops.test.ts`

- [ ] **Step 1: Write the failing test**

Create `workers/api/src/__tests__/admin-ops.test.ts`:

```ts
/**
 * admin-ops verify-ops route suite.
 * SETUP_SECRET-gated deploy-tooling that drives the synthesis→billing chain.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT_ID = 'ao-tenant-1';
const SLUG = 'ao-verify';

async function ops(path: string, body: Record<string, unknown>, secret = SETUP_SECRET): Promise<Response> {
  return SELF.fetch(`http://localhost/api/v1/admin/verify-ops${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Setup-Secret': secret },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, 'AO Verify', ?, 'enterprise', 'active')`
  ).bind(TENANT_ID, SLUG).run();
});

describe('admin-ops gate', () => {
  it('rejects a missing/wrong setup secret with 401', async () => {
    const resp = await ops('/run-phase10-chain', { tenant_slug: SLUG }, 'wrong');
    expect(resp.status).toBe(401);
  });

  it('rejects an unknown tenant_slug with 404', async () => {
    const resp = await ops('/run-phase10-chain', { tenant_slug: 'no-such-tenant' });
    expect(resp.status).toBe(404);
  });

  it('runs the phase-10 chain for a known tenant and returns a result', async () => {
    const resp = await ops('/run-phase10-chain', { tenant_slug: SLUG });
    expect(resp.status).toBe(200);
    const json = await resp.json() as { ok: boolean; chain_result: unknown };
    expect(json.ok).toBe(true);
    expect(json.chain_result).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd workers/api && npx vitest run src/__tests__/admin-ops.test.ts`
Expected: FAIL — all 404 (route not mounted yet).

- [ ] **Step 3: Create the router with the gate + first op**

Create `workers/api/src/routes/admin-ops.ts`:

```ts
/**
 * Verify-ops routes — SETUP_SECRET deploy-tooling for the verify harness.
 *
 * These drive the live synthesis→billing chain for a NAMED tenant so the
 * verification matrices can assert runtime synthesis traceability (A1) and
 * the billing ERP-anchor boundary (A2). They call the SAME runtime functions
 * the cron/app call — they do not fabricate billable state.
 *
 * Auth: X-Setup-Secret shared secret only (same gate as /admin/migrate and
 * demo-seed). Intentionally NOT behind tenant auth — deploy-time tooling.
 * Never weakens the user-facing MFA control.
 */
import { Hono } from 'hono';
import type { Env, AppBindings } from '../types';
import { runPhase10ChainForTenant } from '../services/phase-10-analytics-runner';
import { verifyCompletedActions } from '../services/erp-action-verification';

const adminOps = new Hono<AppBindings>();

/** Resolve an internal tenant id from a slug. Returns null if unknown. */
async function tenantIdForSlug(db: D1Database, slug: string): Promise<string | null> {
  const row = await db.prepare('SELECT id FROM tenants WHERE slug = ?').bind(slug).first<{ id: string }>();
  return row?.id ?? null;
}

/** Shared secret gate. Returns the resolved tenant id, or a Response to short-circuit. */
async function gate(c: { env: AppBindings['Bindings']; req: { header: (k: string) => string | undefined; json: <T>() => Promise<T> } }): Promise<{ tenantId: string; body: Record<string, unknown> } | Response> {
  const env = c.env as Env;
  const secret = c.req.header('X-Setup-Secret');
  if (!env.SETUP_SECRET || !secret || secret !== env.SETUP_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  let body: Record<string, unknown> = {};
  try { body = await c.req.json<Record<string, unknown>>(); } catch { /* empty ok */ }
  const slug = typeof body.tenant_slug === 'string' ? body.tenant_slug : '';
  const tenantId = await tenantIdForSlug(env.DB, slug);
  if (!tenantId) {
    return new Response(JSON.stringify({ error: 'tenant_not_found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  return { tenantId, body };
}

// POST /run-phase10-chain { tenant_slug } — live synthesis trigger.
adminOps.post('/run-phase10-chain', async (c) => {
  const g = await gate(c);
  if (g instanceof Response) return g;
  const chainResult = await runPhase10ChainForTenant((c.env as Env).DB, g.tenantId);
  return c.json({ ok: true, chain_result: chainResult });
});

export default adminOps;
```

- [ ] **Step 4: Mount the router in index.ts**

In `workers/api/src/index.ts`, add the import beside the other route imports (near line 42):

```ts
import adminOps from './routes/admin-ops';
```

And mount it beside the demo-seed mount (near line 601), BEFORE the broader `/api/v1/admin` mounts so the specific prefix resolves cleanly:

```ts
app.route('/api/v1/admin/verify-ops', adminOps);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd workers/api && npx vitest run src/__tests__/admin-ops.test.ts`
Expected: PASS (3 tests). The chain runs best-effort against the empty tenant and returns a result object.

- [ ] **Step 6: Typecheck**

Run: `cd workers/api && npm run typecheck`
Expected: clean (exit 0).

- [ ] **Step 7: Commit**

```bash
git add workers/api/src/routes/admin-ops.ts workers/api/src/index.ts workers/api/src/__tests__/admin-ops.test.ts
git commit -m "feat(verify-ops): SETUP_SECRET admin route + run-phase10-chain op

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `resolve-rca` op

Resolves a synthesized RCA (`status='active'` → `'resolved'`) via the same UPDATE `markResolved` performs, so A2 can exercise the *verified-action* gate in isolation (an active RCA would be excluded on the status gate before verification matters).

**Files:**
- Modify: `workers/api/src/routes/admin-ops.ts`
- Test: `workers/api/src/__tests__/admin-ops.test.ts`

- [ ] **Step 1: Write the failing test** (append inside the file, new `describe`)

```ts
describe('resolve-rca', () => {
  const RCA_ID = 'ao-rca-resolve-1';
  beforeAll(async () => {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO root_cause_analyses
         (id, tenant_id, metric_id, metric_name, trigger_status, causal_chain, confidence, status, generated_at)
       VALUES (?, ?, 'm1', 'Test Metric', 'red', '[]', 88, 'active', datetime('now'))`
    ).bind(RCA_ID, TENANT_ID).run();
  });

  it('marks an active RCA resolved', async () => {
    const resp = await ops('/resolve-rca', { tenant_slug: SLUG, rca_id: RCA_ID });
    expect(resp.status).toBe(200);
    const json = await resp.json() as { ok: boolean; resolved: boolean };
    expect(json.resolved).toBe(true);
    const row = await env.DB.prepare('SELECT status, resolved_at FROM root_cause_analyses WHERE id = ?')
      .bind(RCA_ID).first<{ status: string; resolved_at: string | null }>();
    expect(row?.status).toBe('resolved');
    expect(row?.resolved_at).toBeTruthy();
  });

  it('returns resolved=false for an rca_id that does not belong to the tenant', async () => {
    const resp = await ops('/resolve-rca', { tenant_slug: SLUG, rca_id: 'nonexistent' });
    expect(resp.status).toBe(200);
    const json = await resp.json() as { resolved: boolean };
    expect(json.resolved).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd workers/api && npx vitest run src/__tests__/admin-ops.test.ts -t resolve-rca`
Expected: FAIL — 404 (op not defined).

- [ ] **Step 3: Add the op** (in `admin-ops.ts`, before `export default`)

```ts
// POST /resolve-rca { tenant_slug, rca_id } — mirror markResolved's UPDATE.
adminOps.post('/resolve-rca', async (c) => {
  const g = await gate(c);
  if (g instanceof Response) return g;
  const rcaId = typeof g.body.rca_id === 'string' ? g.body.rca_id : '';
  if (!rcaId) return c.json({ error: 'rca_id required' }, 400);
  const res = await (c.env as Env).DB.prepare(
    `UPDATE root_cause_analyses
        SET status = 'resolved', resolved_at = datetime('now')
      WHERE id = ? AND tenant_id = ? AND status != 'resolved'`
  ).bind(rcaId, g.tenantId).run();
  return c.json({ ok: true, resolved: (res.meta.changes ?? 0) > 0 });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd workers/api && npx vitest run src/__tests__/admin-ops.test.ts -t resolve-rca`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add workers/api/src/routes/admin-ops.ts workers/api/src/__tests__/admin-ops.test.ts
git commit -m "feat(verify-ops): resolve-rca op (mirrors markResolved UPDATE)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `create-completed-action` op

Creates a real prescription-linked `catalyst_actions` row at `status='completed'`, `verification_status=NULL`, with **non-stub** `output_data` (so `verifyAction` attempts verification rather than skipping). It does NOT set `verification_status` — that is left to the real verifier.

**Files:**
- Modify: `workers/api/src/routes/admin-ops.ts`
- Test: `workers/api/src/__tests__/admin-ops.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('create-completed-action', () => {
  const RCA_ID = 'ao-rca-action-1';
  beforeAll(async () => {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO root_cause_analyses
         (id, tenant_id, metric_id, metric_name, trigger_status, causal_chain, confidence, status, generated_at)
       VALUES (?, ?, 'm2', 'Action Metric', 'red', '[]', 82, 'resolved', datetime('now'))`
    ).bind(RCA_ID, TENANT_ID).run();
  });

  it('creates a prescription-linked completed action with no verification status', async () => {
    const resp = await ops('/create-completed-action', { tenant_slug: SLUG, rca_id: RCA_ID });
    expect(resp.status).toBe(200);
    const json = await resp.json() as { ok: boolean; action_id: string; prescription_id: string };
    expect(json.action_id).toBeTruthy();
    expect(json.prescription_id).toBeTruthy();

    const action = await env.DB.prepare(
      'SELECT status, verification_status, source_finding_id, output_data FROM catalyst_actions WHERE id = ?'
    ).bind(json.action_id).first<{ status: string; verification_status: string | null; source_finding_id: string; output_data: string }>();
    expect(action?.status).toBe('completed');
    expect(action?.verification_status).toBeNull();
    expect(action?.source_finding_id).toBe(json.prescription_id);
    // non-stub output so verifyAction will attempt (not skip)
    const out = JSON.parse(action!.output_data) as { mode?: string };
    expect(out.mode).not.toBe('stub');

    const presc = await env.DB.prepare('SELECT rca_id FROM diagnostic_prescriptions WHERE id = ?')
      .bind(json.prescription_id).first<{ rca_id: string }>();
    expect(presc?.rca_id).toBe(RCA_ID);
  });

  it('returns 404 when the rca_id does not belong to the tenant', async () => {
    const resp = await ops('/create-completed-action', { tenant_slug: SLUG, rca_id: 'nope' });
    expect(resp.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd workers/api && npx vitest run src/__tests__/admin-ops.test.ts -t create-completed-action`
Expected: FAIL — 404 (op not defined).

- [ ] **Step 3: Add the op**

```ts
// POST /create-completed-action { tenant_slug, rca_id } — real prescription-
// linked completed action. Does NOT set verification_status (the verifier does).
adminOps.post('/create-completed-action', async (c) => {
  const g = await gate(c);
  if (g instanceof Response) return g;
  const db = (c.env as Env).DB;
  const rcaId = typeof g.body.rca_id === 'string' ? g.body.rca_id : '';
  if (!rcaId) return c.json({ error: 'rca_id required' }, 400);

  const rca = await db.prepare('SELECT id, metric_name FROM root_cause_analyses WHERE id = ? AND tenant_id = ?')
    .bind(rcaId, g.tenantId).first<{ id: string; metric_name: string }>();
  if (!rca) return c.json({ error: 'rca_not_found' }, 404);

  const prescriptionId = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO diagnostic_prescriptions
       (id, rca_id, tenant_id, priority, title, description, expected_impact, effort_level, status, created_at)
     VALUES (?, ?, ?, 'immediate', ?, ?, 'verify-harness', 'low', 'completed', datetime('now'))`
  ).bind(
    prescriptionId, rcaId, g.tenantId,
    `Verify-harness remediation for ${rca.metric_name}`,
    'Synthetic prescription created by the verify harness to exercise the billing ERP-anchor gate.',
  ).run();

  // A real connection for the tenant so verifyAction proceeds to the vendor
  // verifier (SAP → deferred). Null connection also yields deferred — fine.
  const conn = await db.prepare('SELECT id, vendor FROM erp_connections WHERE tenant_id = ? LIMIT 1')
    .bind(g.tenantId).first<{ id: string; vendor: string }>();

  const actionId = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO catalyst_actions (
       id, tenant_id, cluster_id, catalyst_name, action, status, confidence, reasoning,
       connection_id, action_type, value_zar, source_finding_id, idempotency_key, vendor, output_data,
       created_at, completed_at
     ) VALUES (?, ?, NULL, 'Verify Harness', 'remediate', 'completed', 90, ?, ?, 'update', 0, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  ).bind(
    actionId, g.tenantId,
    'Synthetic completed action for billing ERP-anchor verification.',
    conn?.id ?? null, prescriptionId, crypto.randomUUID(),
    conn?.vendor ?? 'sap',
    JSON.stringify({ mode: 'live', result: 'applied', records: 1 }),
  ).run();

  return c.json({ ok: true, action_id: actionId, prescription_id: prescriptionId });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd workers/api && npx vitest run src/__tests__/admin-ops.test.ts -t create-completed-action`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add workers/api/src/routes/admin-ops.ts workers/api/src/__tests__/admin-ops.test.ts
git commit -m "feat(verify-ops): create-completed-action op (prescription-linked, unverified)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `run-action-verification` op

Calls the same `verifyCompletedActions` the cron calls, returning its counts. For a SAP tenant the created action resolves to `deferred`/`skipped` — never `verified` — which the A2 matrix asserts.

**Files:**
- Modify: `workers/api/src/routes/admin-ops.ts`
- Test: `workers/api/src/__tests__/admin-ops.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('run-action-verification', () => {
  it('runs verification and never marks a SAP/no-Xero action verified', async () => {
    const RCA_ID = 'ao-rca-verify-1';
    await env.DB.prepare(
      `INSERT OR REPLACE INTO root_cause_analyses
         (id, tenant_id, metric_id, metric_name, trigger_status, causal_chain, confidence, status, generated_at)
       VALUES (?, ?, 'm3', 'Verify Metric', 'red', '[]', 80, 'resolved', datetime('now'))`
    ).bind(RCA_ID, TENANT_ID).run();
    const created = await (await ops('/create-completed-action', { tenant_slug: SLUG, rca_id: RCA_ID })).json() as { action_id: string };

    const resp = await ops('/run-action-verification', { tenant_slug: SLUG });
    expect(resp.status).toBe(200);
    const json = await resp.json() as { ok: boolean; counts: { verified: number } };
    expect(json.ok).toBe(true);

    const action = await env.DB.prepare('SELECT verification_status FROM catalyst_actions WHERE id = ?')
      .bind(created.action_id).first<{ verification_status: string | null }>();
    expect(action?.verification_status).not.toBe('verified');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd workers/api && npx vitest run src/__tests__/admin-ops.test.ts -t run-action-verification`
Expected: FAIL — 404 (op not defined).

- [ ] **Step 3: Add the op**

```ts
// POST /run-action-verification { tenant_slug } — same fn the cron calls.
adminOps.post('/run-action-verification', async (c) => {
  const g = await gate(c);
  if (g instanceof Response) return g;
  const counts = await verifyCompletedActions((c.env as Env).DB, g.tenantId);
  return c.json({ ok: true, counts });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd workers/api && npx vitest run src/__tests__/admin-ops.test.ts -t run-action-verification`
Expected: PASS.

- [ ] **Step 5: Run the whole admin-ops suite + typecheck**

Run: `cd workers/api && npx vitest run src/__tests__/admin-ops.test.ts && npm run typecheck`
Expected: all pass, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add workers/api/src/routes/admin-ops.ts workers/api/src/__tests__/admin-ops.test.ts
git commit -m "feat(verify-ops): run-action-verification op (cron parity, SAP→deferred)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Deploy the API so the verify-ops endpoints are live

The verification matrices hit the deployed API. Deploy before writing them so the run steps are real.

**Files:** none (CI deploy).

- [ ] **Step 1: Confirm on a clean main and push**

```bash
git checkout main && git merge --ff-only <feature-branch> && git push origin main
```

- [ ] **Step 2: Confirm the API deploy succeeded**

Run: `gh run list --branch main --limit 3 --json workflowName,status,conclusion,headSha`
Expected: `Deploy Workers API` `completed`/`success` for the new head SHA.

- [ ] **Step 3: Smoke-test the gate against staging**

Run (staging API):
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://atheon-api-staging.vantax.co.za/api/v1/admin/verify-ops/run-phase10-chain \
  -H 'Content-Type: application/json' -H 'X-Setup-Secret: wrong' -d '{"tenant_slug":"vantax"}'
```
Expected: `401`.

---

## Task 6: verification config + client methods

**Files:**
- Modify: `verification/config.ts`
- Modify: `verification/lib/client.ts`

- [ ] **Step 1: Add `setupSecret` to CONFIG**

In `verification/config.ts`, add to the CONFIG object (beside `demoSecret`):

```ts
  // SETUP_SECRET for the verify-ops admin endpoints (synthesis/billing chain).
  setupSecret: optionalEnv('VERIFY_SETUP_SECRET', ''),
```

- [ ] **Step 2: Add the verify-ops + read methods to ApiClient**

In `verification/lib/client.ts`, add these methods to the `ApiClient` class (use the existing `authedFetch` for tenant-auth reads, and a secret-header `fetchRetry` for the ops):

```ts
  /** Verify-ops: run the live phase-10 synthesis chain for the configured tenant. */
  async runPhase10Chain(): Promise<{ ok: boolean; chain_result: unknown }> {
    const resp = await fetchRetry(`${this.baseUrl}/api/v1/admin/verify-ops/run-phase10-chain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Setup-Secret': CONFIG.setupSecret },
      body: JSON.stringify({ tenant_slug: CONFIG.tenantSlug }),
    });
    if (!resp.ok) throw new Error(`run-phase10-chain failed: ${resp.status}`);
    return resp.json();
  }

  /** Verify-ops: resolve a synthesized RCA so it clears billing's status gate. */
  async resolveRca(rcaId: string): Promise<{ ok: boolean; resolved: boolean }> {
    const resp = await fetchRetry(`${this.baseUrl}/api/v1/admin/verify-ops/resolve-rca`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Setup-Secret': CONFIG.setupSecret },
      body: JSON.stringify({ tenant_slug: CONFIG.tenantSlug, rca_id: rcaId }),
    });
    if (!resp.ok) throw new Error(`resolve-rca failed: ${resp.status}`);
    return resp.json();
  }

  /** Verify-ops: create a prescription-linked completed (unverified) action for an RCA. */
  async createCompletedAction(rcaId: string): Promise<{ ok: boolean; action_id: string; prescription_id: string }> {
    const resp = await fetchRetry(`${this.baseUrl}/api/v1/admin/verify-ops/create-completed-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Setup-Secret': CONFIG.setupSecret },
      body: JSON.stringify({ tenant_slug: CONFIG.tenantSlug, rca_id: rcaId }),
    });
    if (!resp.ok) throw new Error(`create-completed-action failed: ${resp.status}`);
    return resp.json();
  }

  /** Verify-ops: run action verification (cron parity). */
  async runActionVerification(): Promise<{ ok: boolean; counts: { checked: number; verified: number; deferred: number; skipped: number; failed: number } }> {
    const resp = await fetchRetry(`${this.baseUrl}/api/v1/admin/verify-ops/run-action-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Setup-Secret': CONFIG.setupSecret },
      body: JSON.stringify({ tenant_slug: CONFIG.tenantSlug }),
    });
    if (!resp.ok) throw new Error(`run-action-verification failed: ${resp.status}`);
    return resp.json();
  }

  /** Read: active (synthesized) RCAs. */
  async listActiveRcas(): Promise<Array<{ id: string; metricId: string; confidence: number; status: string; generatedAt: string }>> {
    const resp = await this.authedFetch('/api/diagnostics/?status=active&limit=100');
    if (!resp.ok) throw new Error(`list active rcas failed: ${resp.status}`);
    const json = await resp.json() as { analyses: Array<{ id: string; metricId: string; confidence: number; status: string; generatedAt: string }> };
    return json.analyses;
  }

  /** Read: full RCA + causal-factor chain. */
  async getRcaChain(rcaId: string): Promise<{ rca: { id: string; metricId: string; confidence: number; status: string }; factors: Array<{ factorType: string; impactValue: number | null; confidence: number; evidence: Record<string, unknown> }> }> {
    const resp = await this.authedFetch(`/api/diagnostics/rca/${rcaId}/chain`);
    if (!resp.ok) throw new Error(`rca chain failed: ${resp.status}`);
    return resp.json();
  }

  /** Read: non-destructive billing preview for a period. */
  async getBillingPreview(from: string, to: string): Promise<{ line_items: Array<{ rca_id: string; attributed_savings: number; verified_action_ids: string[] }>; total_realised_savings: number }> {
    const resp = await this.authedFetch(`/api/billing/period?from=${from}&to=${to}`);
    if (!resp.ok) throw new Error(`billing preview failed: ${resp.status}`);
    const json = await resp.json() as { period: { line_items: Array<{ rca_id: string; attributed_savings: number; verified_action_ids: string[] }>; total_realised_savings: number } };
    return json.period;
  }
```

- [ ] **Step 3: Typecheck the verify project**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean (exit 0).

- [ ] **Step 4: Commit**

```bash
git add verification/config.ts verification/lib/client.ts
git commit -m "feat(verify): client methods for verify-ops + synthesis/billing reads

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: A1 — runtime synthesis traceability matrix

**Files:**
- Create: `verification/matrices/runtime-synthesis.matrix.test.ts`

Discriminator: capture the active-RCA id set before the chain, run the chain, diff after — the new active RCAs are the freshly synthesized ones. Robust regardless of any seed-created active RCAs.

- [ ] **Step 1: Write the matrix (A1 section)**

Create `verification/matrices/runtime-synthesis.matrix.test.ts`:

```ts
/**
 * Runtime synthesis → billing verification (A1 + A2).
 *
 * A1: the system's own RCA synthesis (runPhase10ChainForTenant) produces
 *     well-formed, billable-shaped RCAs + causal_factors, and does NOT emit a
 *     billable (impact>0) factor from a sub-0.70-confidence RCA.
 * A2: a synthesized RCA, even once resolved and given a completed action, is
 *     NOT billed because the SAP action never reaches verification_status=
 *     'verified' — proving the ERP-anchor gate. Seeded verified RCAs still bill.
 *
 * Requires VERIFY_SETUP_SECRET. Runs against the configured apiUrl/tenant.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { ApiClient } from '../lib/client';
import { CONFIG } from '../config';

const client = new ApiClient();
let synthesizedRcaIds: string[] = [];

beforeAll(async () => {
  await client.login();
  const before = new Set((await client.listActiveRcas()).map(r => r.id));
  await client.runPhase10Chain();
  const after = await client.listActiveRcas();
  synthesizedRcaIds = after.filter(r => !before.has(r.id)).map(r => r.id);
}, 120_000);

describe('A1: runtime synthesis traceability', () => {
  it('synthesizes at least one new RCA from the live chain', () => {
    expect(synthesizedRcaIds.length).toBeGreaterThan(0);
  });

  it('every synthesized billable factor is well-formed and ERP-traceable', async () => {
    let billableFactorCount = 0;
    for (const rcaId of synthesizedRcaIds) {
      const chain = await client.getRcaChain(rcaId);
      const billable = chain.factors.filter(f => (f.impactValue ?? 0) > 0);
      for (const f of billable) {
        billableFactorCount++;
        // confidence on a 0-100 scale; billing floor is /100 >= 0.70
        expect(chain.rca.confidence).toBeGreaterThanOrEqual(70);
        expect(f.confidence).toBeGreaterThanOrEqual(70);
        expect(f.evidence).toBeTruthy();
        // metric_id present in evidence and matches the RCA's metric
        expect(chain.rca.metricId).toBeTruthy();
      }
    }
    expect(billableFactorCount).toBeGreaterThan(0);
  });

  it('NEGATIVE: no synthesized RCA below the 0.70 floor carries a billable factor', async () => {
    for (const rcaId of synthesizedRcaIds) {
      const chain = await client.getRcaChain(rcaId);
      if (chain.rca.confidence < 70) {
        const billable = chain.factors.filter(f => (f.impactValue ?? 0) > 0);
        expect(billable.length).toBe(0);
      }
    }
  });
});
```

- [ ] **Step 2: Run against staging**

Run:
```bash
VERIFY_D1_DB=atheon-db-staging VERIFY_API_URL=https://atheon-api-staging.vantax.co.za \
VERIFY_SETUP_SECRET=$STAGING_SETUP_SECRET \
npx vitest run --config vitest.verification.config.ts verification/matrices/runtime-synthesis.matrix.test.ts -t "A1"
```
Expected: PASS (3 tests). If "synthesizes at least one new RCA" is 0, the staging tenant lacks red metrics / radar signals — reseed first (`npm run verify:matrices` reseeds) or run the existing global-setup.

- [ ] **Step 3: Commit**

```bash
git add verification/matrices/runtime-synthesis.matrix.test.ts
git commit -m "test(verify): A1 runtime synthesis traceability matrix

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: A2 — synthesized → billing boundary (negative control)

**Files:**
- Modify: `verification/matrices/runtime-synthesis.matrix.test.ts` (append A2 describe)

- [ ] **Step 1: Write the A2 section**

Append to `verification/matrices/runtime-synthesis.matrix.test.ts`:

```ts
describe('A2: synthesized → billing ERP-anchor boundary', () => {
  // A wide period guaranteed to include "now" so both seeded and synthesized
  // resolved RCAs fall in range.
  const FROM = '2026-01-01';
  const TO = '2026-12-31';

  it('billing EXCLUDES a synthesized RCA whose action never reaches verified', async () => {
    expect(synthesizedRcaIds.length).toBeGreaterThan(0);
    const target = synthesizedRcaIds[0];

    // Resolve it so it clears the status gate — isolating the verified-action gate.
    const resolved = await client.resolveRca(target);
    expect(resolved.resolved).toBe(true);

    // Give it a completed, prescription-linked action, then run verification.
    await client.createCompletedAction(target);
    const verif = await client.runActionVerification();
    // SAP tenant: the action must NOT have been verified.
    expect(verif.counts.verified).toBe(0);

    // Billing preview must NOT contain the synthesized RCA (no verified anchor).
    const period = await client.getBillingPreview(FROM, TO);
    const billedIds = new Set(period.line_items.map(li => li.rca_id));
    expect(billedIds.has(target)).toBe(false);
  }, 120_000);

  it('seeded verified RCAs ARE billed and carry verified action ids (sum reconciles)', async () => {
    const period = await client.getBillingPreview(FROM, TO);
    expect(period.line_items.length).toBeGreaterThan(0);
    for (const li of period.line_items) {
      expect(li.verified_action_ids.length).toBeGreaterThan(0);
      expect(li.attributed_savings).toBeGreaterThan(0);
    }
    const sum = period.line_items.reduce((s, li) => s + li.attributed_savings, 0);
    // total_realised_savings is the SUM of attributed_savings across line items.
    expect(Math.abs(sum - period.total_realised_savings)).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Run against staging**

Run:
```bash
VERIFY_D1_DB=atheon-db-staging VERIFY_API_URL=https://atheon-api-staging.vantax.co.za \
VERIFY_SETUP_SECRET=$STAGING_SETUP_SECRET \
npx vitest run --config vitest.verification.config.ts verification/matrices/runtime-synthesis.matrix.test.ts
```
Expected: PASS (A1 + A2, 5 tests). If "seeded verified RCAs ARE billed" finds 0 line items, the staging tenant was not reseeded — run the reseed first.

- [ ] **Step 3: Commit**

```bash
git add verification/matrices/runtime-synthesis.matrix.test.ts
git commit -m "test(verify): A2 synthesized→billing ERP-anchor boundary negative control

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: B — execute-path catalyst sweep (flag-gated)

**Files:**
- Create: `verification/matrices/catalyst-execute-sweep.matrix.test.ts`

Gated behind `VERIFY_CATALYST_SWEEP=1` so it does not run in the default matrix set. Enumerates every enabled sub-catalyst via `client.listClusters()` and executes each through the live endpoint, asserting HTTP 200 + non-failed + typed payload, and explicitly logging skips (no silent caps).

- [ ] **Step 1: Write the sweep matrix**

Create `verification/matrices/catalyst-execute-sweep.matrix.test.ts`:

```ts
/**
 * B: execute-path catalyst sweep.
 *
 * For every ENABLED sub-catalyst, POST the live execute endpoint and assert:
 *   - the run was created (200 → runId)
 *   - final run status !== 'failed'
 *   - the run produced typed items (not 'generic_result')
 * Sub-catalysts with no data sources configured return 400 and are recorded as
 * skipped (logged, not silently dropped).
 *
 * Flag-gated: only runs when VERIFY_CATALYST_SWEEP=1.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { ApiClient } from '../lib/client';

const ENABLED = process.env.VERIFY_CATALYST_SWEEP === '1';
const d = ENABLED ? describe : describe.skip;

const client = new ApiClient();
let subNames: string[] = [];

beforeAll(async () => {
  if (!ENABLED) return;
  await client.login();
  const clusters = await client.listClusters();
  subNames = clusters.flatMap(cl => (cl.subCatalysts ?? [])
    .filter(s => s.enabled)
    .map(s => s.name));
}, 60_000);

d('B: every enabled sub-catalyst executes through the live endpoint', () => {
  it('discovers enabled sub-catalysts', () => {
    expect(subNames.length).toBeGreaterThan(0);
  });

  it('executes each enabled sub-catalyst with a typed, non-failed result', async () => {
    const skipped: string[] = [];
    const failed: string[] = [];
    let executed = 0;

    for (const name of subNames) {
      let runId: string;
      try {
        const res = await client.executeSubCatalyst(name);
        runId = res.runId;
      } catch (e) {
        // 400 "No data sources configured" and similar setup gaps → skip, log.
        skipped.push(`${name}: ${(e as Error).message}`);
        continue;
      }
      executed++;
      const run = await client.getRun(runId);
      if (run.totals.status === 'failed') { failed.push(name); continue; }
      const hasTyped = run.items.some(i => i.resultType && i.resultType !== 'generic_result');
      if (!hasTyped) failed.push(`${name}: untyped/generic_result only`);
    }

    // Explicit coverage reporting — no silent caps.
    console.log(`[B-sweep] enabled=${subNames.length} executed=${executed} skipped=${skipped.length} failed=${failed.length}`);
    if (skipped.length) console.log(`[B-sweep] skipped:\n  ${skipped.join('\n  ')}`);
    if (failed.length) console.log(`[B-sweep] FAILED:\n  ${failed.join('\n  ')}`);

    expect(failed).toEqual([]);
  }, 600_000);
});
```

- [ ] **Step 2: Verify the client shapes the matrix relies on exist**

Confirm `Cluster` has `subCatalysts: Array<{ name: string; enabled: boolean }>` and `RunItem` has `resultType`, and `RunItemTotals` has `status`. Open `verification/lib/client.ts` and check the `Cluster`, `RunItem`, `RunItemTotals` interfaces.
- If `subCatalysts`/`enabled` are named differently, adjust the `.filter`/`.map` in Step 1 to match.
- If `RunItem` exposes the type under a different key (e.g. `type` or `result_type`), adjust `i.resultType`.
- If `RunItemTotals` exposes status under a different key, adjust `run.totals.status`.

(These are the only shape couplings; the existing `executeSubCatalyst`/`getRun` already return these objects.)

- [ ] **Step 3: Run the sweep against staging**

Run:
```bash
VERIFY_CATALYST_SWEEP=1 VERIFY_D1_DB=atheon-db-staging \
VERIFY_API_URL=https://atheon-api-staging.vantax.co.za \
npx vitest run --config vitest.verification.config.ts verification/matrices/catalyst-execute-sweep.matrix.test.ts
```
Expected: PASS. Review the `[B-sweep]` log line for executed/skipped/failed counts. Skips are acceptable (data-source gaps); failures are not.

- [ ] **Step 4: Confirm it is skipped without the flag**

Run:
```bash
npx vitest run --config vitest.verification.config.ts verification/matrices/catalyst-execute-sweep.matrix.test.ts
```
Expected: suite skipped (0 tests run, no reseed cost).

- [ ] **Step 5: Commit**

```bash
git add verification/matrices/catalyst-execute-sweep.matrix.test.ts
git commit -m "test(verify): B execute-path catalyst sweep (flag-gated)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Full verify pass + prod re-certify

**Files:** none.

- [ ] **Step 1: Run the default matrix set against staging (A1+A2 included, B excluded)**

Run: `VERIFY_D1_DB=atheon-db-staging VERIFY_API_URL=https://atheon-api-staging.vantax.co.za VERIFY_SETUP_SECRET=$STAGING_SETUP_SECRET npm run verify:matrices`
Expected: all matrices pass, including the new runtime-synthesis A1+A2.

- [ ] **Step 2: Run against prod to re-certify**

Run: `VERIFY_SETUP_SECRET=$PROD_SETUP_SECRET npm run verify:matrices`
(Defaults target prod API + `atheon-db`.)
Expected: all pass. A2's negative control confirms billing still refuses un-anchored synthesized RCAs in prod.

- [ ] **Step 3: Run the B sweep once against prod (manual, flag-gated)**

Run: `VERIFY_CATALYST_SWEEP=1 npm run verify:matrices`
Expected: PASS; review `[B-sweep]` counts.

---

## Self-Review

**1. Spec coverage:**
- New SETUP_SECRET admin-ops route (spec §"New product surface") → Tasks 1–4 (note: 4 ops, not 3 — `resolve-rca` added because the synthesizer writes `status='active'`, so resolving is required to isolate the verified-action gate; spec's "Open items" explicitly delegated this decision to the plan).
- A1 synthesis traceability positive + negative (spec §A1) → Task 7.
- A2-boundary negative control + seeded-positive reconciliation (spec §A2) → Task 8.
- B flag-gated execute sweep with explicit skip reporting (spec §B) → Task 9.
- Client + config plumbing (spec §"Verification client + gate") → Task 6.
- Deploy/verify/re-certify → Tasks 5, 10.
- No-fabrication + no-MFA-weakening constraints → admin-ops is SETUP_SECRET-only, sets no `verification_status`; A2 asserts `verified === 0`.

**2. Placeholder scan:** No TBD/TODO/"handle edge cases". Task 9 Step 2 is a deliberate shape-confirmation against existing client interfaces (the only couplings), with explicit fallback instructions — not a placeholder.

**3. Type consistency:** Client method names/return shapes used in Tasks 7–9 match their definitions in Task 6 (`runPhase10Chain`, `resolveRca`, `createCompletedAction`, `runActionVerification`, `listActiveRcas`, `getRcaChain`, `getBillingPreview`). Endpoint paths consistent (`/api/v1/admin/verify-ops/*`). Billing line-item fields (`rca_id`, `attributed_savings`, `verified_action_ids`) match `billing-engine.ts` `BillableLineItem`. Confidence on 0–100 scale used consistently against the `/100 >= 0.70` floor.

**Resolved spec open items:**
- Synthesized-vs-seeded discriminator → before/after active-RCA id diff (Task 7).
- Whether A2 drives resolution → yes, via `resolve-rca` op (Task 8).
- `create-completed-action` output_data shape → `{ mode:'live', result:'applied', records:1 }` (non-stub so `verifyAction` attempts).
