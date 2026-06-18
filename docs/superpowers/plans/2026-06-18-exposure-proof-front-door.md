# Exposure-Proof Front Door Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A prospect (public `/trial`) or first-run logged-in user uploads ERP CSVs, the real 39-detector engine runs on the actually-ingested rows, and a shared money-first results view shows detected exposure in Rand — every figure drillable to ERP records, with an honest `insufficient_data` state and never a fabricated number — closing with a book-a-call CTA that persists a lead.

**Architecture:** Reuse the authenticated ingest spine. Extract the validate→write loop from `POST /api/assessments/:id/dataset` into a shared `ingestDomains()` helper. The public trial `/upload` calls it (real ingest, not simulation). The trial `/run` derives exposure from `summariseFindings().total_value_at_risk_zar` over real gate-passing findings and the `Math.random` fallback is deleted. A shared `ExposureResults` React component (composing the existing `AssessmentFindingsPanel`) renders the money-first view in both the trial flow and the logged-in dashboard first-run state.

**Tech Stack:** Cloudflare Workers + Hono + D1 (worker API, `workers/api`); React 18 + Vite + TypeScript (`src`); Vitest with `@cloudflare/vitest-pool-workers` (worker tests) and jsdom + Testing Library (frontend tests); papaparse (`parseCsv`).

**Reference spec:** `docs/superpowers/specs/2026-06-18-exposure-proof-front-door-design.md`

---

## Spec correction baked into this plan

The spec §3.3 proposed `estimatedExposure = Σ(immediate_value + ongoing_monthly_value×12)`. Grounding the real `Finding` type (`workers/api/src/services/assessment-findings.ts:143-196`) shows findings carry **`value_at_risk_zar`** and no `immediate_value`/`ongoing_monthly_value` fields. The authoritative aggregate is `summariseFindings().total_value_at_risk_zar`, which already counts **gate-passing (confirmed) value only** (gate-failed value lands in `potential_unverified_zar`). This plan therefore uses `summariseFindings()` totals as the exposure source. This preserves the spec's intent (exposure = sum of detected finding value, confirmed only, fully traceable) with the real data shape.

The trial `/run` also drops the legacy `runValueAssessment` (quick-mode DQ engine) call: its outputs (`healthScore`, `projectedRoi`) are fabricated/recovery-multiplier numbers that `ExposureResults` does not display and the spec forbids. The 39-detector engine is the sole, traceable source.

---

## File Structure

**Worker API (`workers/api/`)**
- Create: `src/lib/ingest-write.ts` — shared `ingestDomains()` validate→write helper (Task 1)
- Create: `src/lib/trial-outcome.ts` — pure `computeTrialOutcome()` exposure/status gate (Task 3)
- Modify: `src/routes/assessments.ts:140-216` — refactor dataset route to call `ingestDomains()` (Task 1)
- Modify: `src/routes/trial-assessment.ts:70-101` — real `/upload` ingest (Task 2)
- Modify: `src/routes/trial-assessment.ts:103-278` — real `/run` + `/results` exposes `insufficient_data` (Task 3)
- Modify: `src/routes/trial-assessment.ts` — add `POST /:id/request-call` (Task 4)
- Modify: `src/services/migrate.ts` — add `call_requested_at`, `call_note` self-heal columns (Task 4)
- Modify: `src/types.ts` — add optional `LEAD_NOTIFY_EMAIL` binding (Task 4)
- Create tests: `src/__tests__/ingest-write.test.ts`, `src/__tests__/trial-outcome.test.ts`, `src/__tests__/trial-ingest.test.ts`, `src/__tests__/trial-request-call.test.ts`

**Frontend (`src/`)**
- Create: `src/components/ExposureResults.tsx` — shared money-first results component (Task 5)
- Create: `src/lib/trial-automap.ts` — pure CSV header → manifest domain auto-map (Task 7)
- Modify: `src/lib/api.ts` — `trial.upload` sends domains, add `trial.requestCall`, extend `TrialResultsResponse` (Task 6)
- Modify: `src/pages/TrialPage.tsx:54-95,258-284` — real upload step (Task 8) + results step (Task 9)
- Modify: `src/pages/Dashboard.tsx:265-283` — first-run exposure entry (Task 10)
- Create tests: `src/components/__tests__/ExposureResults.test.tsx`, `src/lib/__tests__/trial-automap.test.ts`

---

## Task 1: Extract `ingestDomains()` shared helper + refactor dataset route

**Files:**
- Create: `workers/api/src/lib/ingest-write.ts`
- Test: `workers/api/src/__tests__/ingest-write.test.ts`
- Modify: `workers/api/src/routes/assessments.ts:160-215`

The existing `dataset-ingest.test.ts` is the behavior-preserving guard for the refactor — it must stay green.

- [ ] **Step 1: Write the failing unit test for `ingestDomains`**

Create `workers/api/src/__tests__/ingest-write.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { ensureMigrated } from './setup';
import { ingestDomains } from '../lib/ingest-write';

const TENANT = 'ingest-write-tenant';
const DATASET = 'ds_ingest_write_test';

describe('ingestDomains', () => {
  beforeEach(async () => {
    await ensureMigrated();
    await env.DB.prepare('DELETE FROM erp_invoices WHERE tenant_id = ?').bind(TENANT).run();
  });

  it('writes valid rows tagged with tenant_id + dataset_id and returns row_counts', async () => {
    const result = await ingestDomains(env.DB, TENANT, DATASET, {
      invoices: {
        header: ['invoice_number', 'invoice_date', 'total'],
        rows: [
          { invoice_number: 'INV-1', invoice_date: '2026-01-10', total: '500' },
          { invoice_number: 'INV-2', invoice_date: '2026-01-11', total: '750' },
        ],
      },
    });
    expect(result.errors).toEqual([]);
    expect(result.row_counts.invoices).toBe(2);

    const cnt = await env.DB.prepare(
      'SELECT COUNT(*) c FROM erp_invoices WHERE tenant_id = ? AND dataset_id = ?',
    ).bind(TENANT, DATASET).first<{ c: number }>();
    expect(cnt?.c).toBe(2);
  });

  it('rejects the whole payload on an unknown column — nothing written (strong inference)', async () => {
    const result = await ingestDomains(env.DB, TENANT, DATASET, {
      invoices: {
        header: ['invoice_number', 'invoice_date', 'total', 'evil'],
        rows: [{ invoice_number: 'X', invoice_date: '2026-01-10', total: '1', evil: 'y' }],
      },
    });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.row_counts).toEqual({});

    const cnt = await env.DB.prepare('SELECT COUNT(*) c FROM erp_invoices WHERE tenant_id = ?')
      .bind(TENANT).first<{ c: number }>();
    expect(cnt?.c).toBe(0);
  });

  it('rejects an unknown domain', async () => {
    const result = await ingestDomains(env.DB, TENANT, DATASET, {
      not_a_domain: { header: ['a'], rows: [{ a: '1' }] },
    });
    expect(result.errors[0].message).toMatch(/unknown domain/);
    expect(result.row_counts).toEqual({});
  });

  it('enforces maxRowsPerDomain', async () => {
    const result = await ingestDomains(env.DB, TENANT, DATASET, {
      invoices: {
        header: ['invoice_number', 'invoice_date', 'total'],
        rows: [
          { invoice_number: 'A', invoice_date: '2026-01-10', total: '1' },
          { invoice_number: 'B', invoice_date: '2026-01-10', total: '1' },
        ],
      },
    }, { maxRowsPerDomain: 1 });
    expect(result.errors[0].message).toMatch(/too many rows/);
    expect(result.row_counts).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd workers/api && npx vitest run src/__tests__/ingest-write.test.ts`
Expected: FAIL — `Cannot find module '../lib/ingest-write'`.

- [ ] **Step 3: Implement `ingestDomains`**

Create `workers/api/src/lib/ingest-write.ts`:

```typescript
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { INGEST_MANIFEST } from './ingest-manifest';
import { validateDomainRows } from './ingest-validate';

export interface IngestError {
  domain: string;
  row: number;
  column: string;
  message: string;
}

export interface IngestResult {
  row_counts: Record<string, number>;
  errors: IngestError[];
}

export interface IngestOptions {
  /** Per-domain row ceiling. Public callers (trial) pass a cap; authenticated callers may omit. */
  maxRowsPerDomain?: number;
}

/**
 * Validate + write ERP domain rows into the erp_* tables, tagged with
 * (tenant_id, dataset_id). Strong inference: if ANY domain has a validation
 * error (unknown domain / unknown column / type mismatch / over the row cap),
 * NOTHING is written and the errors are returned — the caller owns the HTTP
 * response. Extracted from POST /api/assessments/:id/dataset so the public
 * trial upload runs the identical validated ingest (no simulation).
 */
export async function ingestDomains(
  db: D1Database,
  tenantId: string,
  datasetId: string,
  domains: Record<string, { header: string[]; rows: Array<Record<string, unknown>> }>,
  opts: IngestOptions = {},
): Promise<IngestResult> {
  const maxRows = opts.maxRowsPerDomain ?? Infinity;
  const validated: Record<string, Array<Record<string, unknown>>> = {};
  const errors: IngestError[] = [];

  for (const [domain, payload] of Object.entries(domains)) {
    const def = INGEST_MANIFEST.find((d) => d.domain === domain);
    if (!def) {
      errors.push({ domain, row: 0, column: '', message: `unknown domain ${domain}` });
      continue;
    }
    const rawRows = payload.rows || [];
    if (rawRows.length > maxRows) {
      errors.push({ domain, row: 0, column: '', message: `too many rows: ${rawRows.length} exceeds limit ${maxRows}` });
      continue;
    }
    const { rows, errors: vErrors } = validateDomainRows(domain, payload.header || [], rawRows);
    if (vErrors.length) {
      for (const e of vErrors) errors.push({ domain, ...e });
    } else {
      validated[domain] = rows;
    }
  }

  // Strong inference: any error anywhere → write nothing.
  if (errors.length) return { row_counts: {}, errors };

  const rowCounts: Record<string, number> = {};
  const stmts: D1PreparedStatement[] = [];
  for (const [domain, rows] of Object.entries(validated)) {
    const def = INGEST_MANIFEST.find((d) => d.domain === domain)!;
    stmts.push(db.prepare(`DELETE FROM ${def.table} WHERE tenant_id = ? AND dataset_id = ?`).bind(tenantId, datasetId));
    let n = 0;
    for (const row of rows) {
      // Only emit columns we actually have a value for. erp_* tables carry
      // NOT NULL DEFAULT constraints on several numeric/status fields, so
      // inserting an explicit NULL for an absent optional column violates the
      // constraint — omit it and let the DB default apply instead.
      const dataCols = def.columns.filter((col) => row[col.name] != null);
      const cols = ['id', 'tenant_id', 'dataset_id', 'source_system', ...dataCols.map((col) => col.name)];
      const vals = [`${datasetId}_${domain}_${n}`, tenantId, datasetId, 'upload', ...dataCols.map((col) => row[col.name])];
      const placeholders = cols.map(() => '?').join(', ');
      stmts.push(db.prepare(`INSERT INTO ${def.table} (${cols.join(', ')}) VALUES (${placeholders})`).bind(...vals));
      n++;
    }
    rowCounts[domain] = n;
  }

  for (let i = 0; i < stmts.length; i += 50) {
    await db.batch(stmts.slice(i, i + 50));
  }

  return { row_counts: rowCounts, errors: [] };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd workers/api && npx vitest run src/__tests__/ingest-write.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Refactor the dataset route to use `ingestDomains` (behavior-preserving)**

In `workers/api/src/routes/assessments.ts`, replace the block from line 163 (`const validated: ...`) through line 213 (the `ready` upsert `.bind(...).run();`) with the following. The `datasetId` computation and the final `c.json(...)` return remain. Add the import at the top of the file: `import { ingestDomains } from '../lib/ingest-write';`

```typescript
  const datasetId = `ds_${assessmentId}_${tenantId}`.replace(/[^a-zA-Z0-9_]/g, '_');

  const result = await ingestDomains(c.env.DB, tenantId, datasetId, body.domains);

  if (result.errors.length) {
    await c.env.DB.prepare(
      `INSERT INTO assessment_datasets (id, assessment_id, tenant_id, status, row_counts, error)
       VALUES (?, ?, ?, 'failed', '{}', ?)
       ON CONFLICT(assessment_id) DO UPDATE SET status='failed', error=excluded.error`,
    ).bind(datasetId, assessmentId, tenantId, JSON.stringify(result.errors.slice(0, 200))).run();
    return c.json({ error: 'validation failed', errors: result.errors.slice(0, 200) }, 422);
  }

  await c.env.DB.prepare(
    `INSERT INTO assessment_datasets (id, assessment_id, tenant_id, status, row_counts, error)
     VALUES (?, ?, ?, 'ready', ?, NULL)
     ON CONFLICT(assessment_id) DO UPDATE SET status='ready', row_counts=excluded.row_counts, error=NULL`,
  ).bind(datasetId, assessmentId, tenantId, JSON.stringify(result.row_counts)).run();

  return c.json({ dataset_id: datasetId, status: 'ready', row_counts: result.row_counts });
```

Remove the now-dead imports if `validateDomainRows` / `INGEST_MANIFEST` are no longer referenced elsewhere in `assessments.ts` (check first with a search; leave them if still used).

- [ ] **Step 6: Run the existing dataset test + new test + typecheck**

Run: `cd workers/api && npx vitest run src/__tests__/dataset-ingest.test.ts src/__tests__/ingest-write.test.ts`
Expected: PASS (both files green — refactor preserved behavior).

Run: `cd workers/api && npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add workers/api/src/lib/ingest-write.ts workers/api/src/__tests__/ingest-write.test.ts workers/api/src/routes/assessments.ts
git commit -m "$(cat <<'EOF'
refactor(ingest): extract ingestDomains helper from dataset route

Lifts the validate->write loop out of POST /assessments/:id/dataset into a
reusable lib so the public trial upload can run the identical validated
ingest. Behavior-preserving — dataset-ingest.test.ts stays green.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Trial `/upload` runs real validated ingest

**Files:**
- Modify: `workers/api/src/routes/trial-assessment.ts:70-101`
- Test: `workers/api/src/__tests__/trial-ingest.test.ts` (created here, extended in Task 3)

- [ ] **Step 1: Write the failing integration test for real upload ingest**

Create `workers/api/src/__tests__/trial-ingest.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { ensureMigrated } from './setup';

const TRIAL_ID = 'trial-ingest-1';
const TENANT = 'trial-ingest-tenant';

async function seedTrial() {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, 'Trial Co', ?, 'enterprise', 'active')`,
  ).bind(TENANT, TENANT).run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO trial_assessments (id, tenant_id, company_name, industry, contact_name, contact_email, status)
     VALUES (?, ?, 'Trial Co', 'manufacturing', 'Sam Trial', 'sam@trial.co', 'pending')`,
  ).bind(TRIAL_ID, TENANT).run();
}

describe('POST /api/trial/:id/upload — real ingest', () => {
  beforeEach(async () => {
    await ensureMigrated();
    await env.DB.prepare('DELETE FROM erp_invoices WHERE tenant_id = ?').bind(TENANT).run();
    await seedTrial();
  });

  it('ingests a valid CSV payload into erp_* tagged with the trial dataset', async () => {
    const res = await SELF.fetch(`http://localhost/api/trial/${TRIAL_ID}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domains: {
          invoices: {
            header: ['invoice_number', 'invoice_date', 'total'],
            rows: [
              { invoice_number: 'INV-1', invoice_date: '2026-01-10', total: '500' },
              { invoice_number: 'INV-2', invoice_date: '2026-01-11', total: '750' },
            ],
          },
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { received: boolean; dataset_id: string; row_counts: Record<string, number> };
    expect(body.received).toBe(true);
    expect(body.row_counts.invoices).toBe(2);

    const cnt = await env.DB.prepare(
      'SELECT COUNT(*) c FROM erp_invoices WHERE tenant_id = ? AND dataset_id = ?',
    ).bind(TENANT, body.dataset_id).first<{ c: number }>();
    expect(cnt?.c).toBe(2);

    const row = await env.DB.prepare(
      "SELECT status FROM trial_assessments WHERE id = ?",
    ).bind(TRIAL_ID).first<{ status: string }>();
    expect(row?.status).toBe('uploaded');
  });

  it('rejects an unknown-column payload (422) and writes nothing', async () => {
    const res = await SELF.fetch(`http://localhost/api/trial/${TRIAL_ID}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domains: { invoices: { header: ['invoice_number', 'invoice_date', 'total', 'evil'], rows: [{ invoice_number: 'X', invoice_date: '2026-01-10', total: '1', evil: 'y' }] } },
      }),
    });
    expect(res.status).toBe(422);
    const cnt = await env.DB.prepare('SELECT COUNT(*) c FROM erp_invoices WHERE tenant_id = ?')
      .bind(TENANT).first<{ c: number }>();
    expect(cnt?.c).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd workers/api && npx vitest run src/__tests__/trial-ingest.test.ts`
Expected: FAIL — the current `/upload` ignores `domains`, returns `{ fileName, ... }` (no `received`/`row_counts`), and writes nothing to `erp_invoices`.

- [ ] **Step 3: Replace the `/upload` handler with real ingest**

In `workers/api/src/routes/trial-assessment.ts`, replace the entire handler at lines 70-101 (`app.post('/:id/upload', ...)`) with:

```typescript
// POST /:id/upload — Ingest the prospect's CSV rows through the SAME validated
// ingest the authenticated assessment path uses. No simulation, no fabricated
// rows. Strong inference: any unknown column / type mismatch rejects the whole
// upload (422) and nothing is written.
app.post('/:id/upload', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  const assessment = await db.prepare('SELECT tenant_id FROM trial_assessments WHERE id = ?')
    .bind(id).first<{ tenant_id: string }>();
  if (!assessment) return c.json({ error: 'Assessment not found' }, 404);

  const body = await c.req
    .json<{ domains?: Record<string, { header: string[]; rows: Array<Record<string, unknown>> }> }>()
    .catch(() => null);
  if (!body?.domains || typeof body.domains !== 'object') {
    return c.json({ error: 'domains required' }, 400);
  }

  const tenantId = assessment.tenant_id;
  const datasetId = `ds_trial_${id}`.replace(/[^a-zA-Z0-9_]/g, '_');

  const { ingestDomains } = await import('../lib/ingest-write');
  // Public endpoint: cap rows per domain to bound abuse (spec §6).
  const result = await ingestDomains(db, tenantId, datasetId, body.domains, { maxRowsPerDomain: 50000 });

  if (result.errors.length) {
    return c.json({ error: 'validation failed', errors: result.errors.slice(0, 200) }, 422);
  }

  await db.prepare(
    "UPDATE trial_assessments SET status = 'uploaded', current_step = 'Data uploaded' WHERE id = ?",
  ).bind(id).run();

  return c.json({ received: true, dataset_id: datasetId, row_counts: result.row_counts });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd workers/api && npx vitest run src/__tests__/trial-ingest.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add workers/api/src/routes/trial-assessment.ts workers/api/src/__tests__/trial-ingest.test.ts
git commit -m "$(cat <<'EOF'
feat(trial): ingest real CSV rows on upload via shared ingestDomains

Trial /upload was simulated (stored metadata only) so detectors ran on an
empty tenant. Now runs the identical validated ingest into erp_* tagged with
ds_trial_<id>, with a 50k/domain cap for the public path.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Trial `/run` — exposure from real findings, delete `Math.random`, honest `insufficient_data`

**Files:**
- Create: `workers/api/src/lib/trial-outcome.ts`
- Test: `workers/api/src/__tests__/trial-outcome.test.ts`
- Modify: `workers/api/src/routes/trial-assessment.ts:103-230` (the `/run` handler) and `:249-278` (the `/results` handler)
- Test: `workers/api/src/__tests__/trial-ingest.test.ts` (extend)

- [ ] **Step 1: Write the failing unit test for `computeTrialOutcome`**

Create `workers/api/src/__tests__/trial-outcome.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeTrialOutcome } from '../lib/trial-outcome';

const base = {
  total_count: 0,
  total_value_at_risk_zar: 0,
  potential_unverified_zar: 0,
  unverified_count: 0,
  by_severity: { critical: 0, high: 0, medium: 0, low: 0 },
  by_category: {} as never,
  recommended_catalysts: [] as string[],
};

describe('computeTrialOutcome', () => {
  it('returns complete + rounded exposure when there is confirmed value', () => {
    expect(computeTrialOutcome({ ...base, total_count: 3, unverified_count: 1, total_value_at_risk_zar: 1234567.8 }))
      .toEqual({ status: 'complete', exposure: 1234568 });
  });

  it('returns insufficient_data when every finding failed the confidence gate', () => {
    expect(computeTrialOutcome({ ...base, total_count: 2, unverified_count: 2, total_value_at_risk_zar: 0 }))
      .toEqual({ status: 'insufficient_data', exposure: null });
  });

  it('returns insufficient_data when there are no findings at all', () => {
    expect(computeTrialOutcome(base)).toEqual({ status: 'insufficient_data', exposure: null });
  });

  it('returns insufficient_data when confirmed count is zero even if value > 0', () => {
    expect(computeTrialOutcome({ ...base, total_count: 1, unverified_count: 1, total_value_at_risk_zar: 5000 }))
      .toEqual({ status: 'insufficient_data', exposure: null });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd workers/api && npx vitest run src/__tests__/trial-outcome.test.ts`
Expected: FAIL — `Cannot find module '../lib/trial-outcome'`.

- [ ] **Step 3: Implement `computeTrialOutcome`**

Create `workers/api/src/lib/trial-outcome.ts`:

```typescript
import type { summariseFindings } from '../services/assessment-findings';

type FindingsSummary = ReturnType<typeof summariseFindings>;

/**
 * Map a findings summary to the trial outcome. Exposure is the CONFIRMED
 * (gate-passing) value only — summariseFindings already excludes gate-failed
 * value from total_value_at_risk_zar (it lands in potential_unverified_zar).
 * Honest false-negative: if no finding cleared the confidence gate, report
 * insufficient_data with a null exposure rather than a fabricated number.
 */
export function computeTrialOutcome(
  summary: FindingsSummary,
): { status: 'complete' | 'insufficient_data'; exposure: number | null } {
  const confirmedCount = summary.total_count - (summary.unverified_count || 0);
  const exposure = summary.total_value_at_risk_zar;
  if (confirmedCount > 0 && exposure > 0) {
    return { status: 'complete', exposure: Math.round(exposure) };
  }
  return { status: 'insufficient_data', exposure: null };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd workers/api && npx vitest run src/__tests__/trial-outcome.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Replace the `/run` handler**

In `workers/api/src/routes/trial-assessment.ts`, replace the entire handler spanning lines 103-230 (from `// POST /:id/run ...` and `app.post('/:id/run', async (c) => {` through the closing `});` of the fallback block that ends with `return c.json({ status: 'complete', mode: 'estimation' });`) with:

```typescript
// POST /:id/run — Detect exposure on the trial's ingested dataset. Exposure
// comes ONLY from gate-passing structured findings (no Math.random fallback,
// no legacy DQ-engine health score). Empty/garbage data -> insufficient_data.
app.post('/:id/run', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  const assessment = await db.prepare('SELECT tenant_id FROM trial_assessments WHERE id = ?')
    .bind(id).first<{ tenant_id: string }>();
  if (!assessment) return c.json({ error: 'Assessment not found' }, 404);

  await db.prepare(
    "UPDATE trial_assessments SET status = 'running', progress = 10, current_step = 'Detecting exposure...' WHERE id = ?",
  ).bind(id).run();

  const tenantId = assessment.tenant_id;
  const datasetId = `ds_trial_${id}`.replace(/[^a-zA-Z0-9_]/g, '_');

  const { detectAllFindings, summariseFindings } = await import('../services/assessment-findings');
  const { computeTrialOutcome } = await import('../lib/trial-outcome');

  // Detection failure is honest insufficient_data, never a fabricated number.
  let findings: Awaited<ReturnType<typeof detectAllFindings>> = [];
  try {
    findings = await detectAllFindings(db, tenantId, {
      baseCurrency: 'ZAR',
      exchangeRates: { ZAR: 1, USD: 18.5, EUR: 20, GBP: 23 },
      monthsOfData: 6, // trial = <= 6 months of CSV data typically
      datasetId,
    });
  } catch (err) {
    console.error('detectAllFindings failed for trial (-> insufficient_data):', err);
    findings = [];
  }

  const summary = summariseFindings(findings);
  const { status, exposure } = computeTrialOutcome(summary);

  // Honest top risks/opportunities for the PDF report, derived from the real
  // gate-passing findings (empty when no exposure was detected).
  const confirmed = findings
    .filter((f) => f.confidence_gate_passed !== false)
    .sort((a, b) => b.value_at_risk_zar - a.value_at_risk_zar);
  const topRisks = confirmed.slice(0, 3).map((f) => ({
    title: f.title,
    description: f.narrative,
    impact: Math.round(f.value_at_risk_zar),
  }));
  const topOpportunities = confirmed.slice(0, 3).map((f) => ({
    title: f.recommended_catalyst.catalyst,
    description: f.recommended_catalyst.sub_catalyst,
    value: Math.round(f.value_at_risk_zar),
  }));

  await db.prepare(
    `UPDATE trial_assessments SET status = ?, progress = 100,
       current_step = ?, issues_found = ?, estimated_exposure = ?,
       health_score = NULL, projected_roi = NULL,
       top_risks = ?, top_opportunities = ?,
       findings_json = ?, findings_summary_json = ?,
       completed_at = datetime('now') WHERE id = ?`,
  ).bind(
    status,
    status === 'complete' ? 'Assessment complete' : 'Insufficient data to quantify exposure',
    summary.total_count,
    exposure,
    JSON.stringify(topRisks),
    JSON.stringify(topOpportunities),
    JSON.stringify(findings),
    JSON.stringify(summary),
    id,
  ).run();

  return c.json({ status, mode: 'findings', exposure });
});
```

- [ ] **Step 6: Update `/results` to expose `insufficient_data` + return `status`**

In the `GET /:id/results` handler (lines ~249-278), make two edits:

Change the guard (line ~256) from:

```typescript
  if (assessment.status !== 'complete') return c.json({ error: 'Assessment not yet complete', status: assessment.status }, 400);
```

to:

```typescript
  if (assessment.status !== 'complete' && assessment.status !== 'insufficient_data') {
    return c.json({ error: 'Assessment not yet complete', status: assessment.status }, 400);
  }
```

And in the returned `c.json({ ... })` object, add a `status` field (place it first):

```typescript
  return c.json({
    status: assessment.status,
    companyName: assessment.company_name,
    industry: assessment.industry,
    healthScore: assessment.health_score,
    issuesFound: assessment.issues_found,
    estimatedExposure: assessment.estimated_exposure,
    topRisks: JSON.parse((assessment.top_risks as string) || '[]'),
    topOpportunities: JSON.parse((assessment.top_opportunities as string) || '[]'),
    projectedRoi: assessment.projected_roi,
    completedAt: assessment.completed_at,
    findings,
    findingsSummary,
  });
```

- [ ] **Step 7: Extend the integration test — exposure is real + deterministic (no fabrication)**

Append to `workers/api/src/__tests__/trial-ingest.test.ts`:

```typescript
describe('POST /api/trial/:id/run — exposure from real findings only', () => {
  beforeEach(async () => {
    await ensureMigrated();
    await env.DB.prepare('DELETE FROM erp_invoices WHERE tenant_id = ?').bind(TENANT).run();
    await seedTrial();
  });

  async function upload(rows: Array<Record<string, unknown>>) {
    const res = await SELF.fetch(`http://localhost/api/trial/${TRIAL_ID}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: { invoices: { header: ['invoice_number', 'invoice_date', 'total'], rows } } }),
    });
    expect(res.status).toBe(200);
  }
  async function run() {
    const res = await SELF.fetch(`http://localhost/api/trial/${TRIAL_ID}/run`, { method: 'POST' });
    expect(res.status).toBe(200);
    return (await res.json()) as { status: string; exposure: number | null };
  }
  async function results() {
    const res = await SELF.fetch(`http://localhost/api/trial/${TRIAL_ID}/results`);
    expect(res.status).toBe(200);
    return (await res.json()) as { status: string; estimatedExposure: number | null; findingsSummary: { total_value_at_risk_zar?: number } };
  }

  it('a thin dataset yields insufficient_data + null exposure (no fabricated number)', async () => {
    await upload([
      { invoice_number: 'INV-1', invoice_date: '2026-01-10', total: '500' },
      { invoice_number: 'INV-2', invoice_date: '2026-01-11', total: '750' },
    ]);
    const ran = await run();
    expect(ran.status).toBe('insufficient_data');
    expect(ran.exposure).toBeNull();

    const r = await results();
    expect(r.status).toBe('insufficient_data');
    expect(r.estimatedExposure).toBeNull();
  });

  it('is deterministic — same data ingested twice yields the identical exposure (Math.random is gone)', async () => {
    const rows = [
      { invoice_number: 'INV-1', invoice_date: '2026-01-10', total: '500' },
      { invoice_number: 'INV-2', invoice_date: '2026-01-11', total: '750' },
    ];
    await upload(rows);
    const first = await run();
    await upload(rows);
    const second = await run();
    expect(second.exposure).toBe(first.exposure);
    expect(second.status).toBe(first.status);
  });

  it('when exposure is reported it equals the findings summary total (traceable)', async () => {
    await upload([{ invoice_number: 'INV-1', invoice_date: '2026-01-10', total: '500' }]);
    await run();
    const r = await results();
    if (r.status === 'complete') {
      expect(r.estimatedExposure).toBe(Math.round(r.findingsSummary.total_value_at_risk_zar || 0));
    } else {
      expect(r.estimatedExposure).toBeNull();
    }
  });
});
```

- [ ] **Step 8: Run the tests + typecheck**

Run: `cd workers/api && npx vitest run src/__tests__/trial-ingest.test.ts src/__tests__/trial-outcome.test.ts`
Expected: PASS.

Run: `cd workers/api && npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add workers/api/src/lib/trial-outcome.ts workers/api/src/__tests__/trial-outcome.test.ts workers/api/src/routes/trial-assessment.ts workers/api/src/__tests__/trial-ingest.test.ts
git commit -m "$(cat <<'EOF'
fix(trial): derive exposure from real findings; delete Math.random fallback

Trial /run now runs the 39-detector engine scoped to ds_trial_<id> and sets
estimated_exposure = confirmed total_value_at_risk_zar. Zero gate-passing
findings -> status 'insufficient_data' + null exposure (honest false-negative).
Removes the fabricated R100k-R1M random fallback and the legacy DQ health
score. /results now serves insufficient_data and returns status.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Lead capture — migration columns + `POST /:id/request-call` + best-effort notify

**Files:**
- Modify: `workers/api/src/services/migrate.ts` (self-heal columns)
- Modify: `workers/api/src/types.ts` (optional `LEAD_NOTIFY_EMAIL`)
- Modify: `workers/api/src/routes/trial-assessment.ts` (new route)
- Test: `workers/api/src/__tests__/trial-request-call.test.ts`

- [ ] **Step 1: Add the self-heal columns**

In `workers/api/src/services/migrate.ts`, find the `selfHealColumns` array (entries look like `{ table: 'catalyst_actions', column: 'assigned_to', definition: 'TEXT' }`, around line 1021-1026). Add these two entries to the array:

```typescript
    { table: 'trial_assessments', column: 'call_requested_at', definition: 'TEXT' },
    { table: 'trial_assessments', column: 'call_note', definition: 'TEXT' },
```

- [ ] **Step 2: Add the optional notify binding**

In `workers/api/src/types.ts`, inside the `Env` interface, add (near the other optional string bindings):

```typescript
  /** Optional. When set, trial call-requests are emailed here (best-effort). */
  LEAD_NOTIFY_EMAIL?: string;
```

- [ ] **Step 3: Write the failing integration test**

Create `workers/api/src/__tests__/trial-request-call.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { ensureMigrated } from './setup';

const TRIAL_ID = 'trial-call-1';
const TENANT = 'trial-call-tenant';

describe('POST /api/trial/:id/request-call', () => {
  beforeEach(async () => {
    await ensureMigrated();
    await env.DB.prepare(
      `INSERT OR REPLACE INTO trial_assessments (id, tenant_id, company_name, industry, contact_name, contact_email, status)
       VALUES (?, ?, 'Trial Co', 'manufacturing', 'Sam Trial', 'sam@trial.co', 'complete')`,
    ).bind(TRIAL_ID, TENANT).run();
  });

  it('sets the call_requested_at flag + note and returns requested:true', async () => {
    const res = await SELF.fetch(`http://localhost/api/trial/${TRIAL_ID}/request-call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'Please call Tuesday' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json() as { requested: boolean }).requested).toBe(true);

    const row = await env.DB.prepare(
      'SELECT call_requested_at, call_note FROM trial_assessments WHERE id = ?',
    ).bind(TRIAL_ID).first<{ call_requested_at: string | null; call_note: string | null }>();
    expect(row?.call_requested_at).not.toBeNull();
    expect(row?.call_note).toBe('Please call Tuesday');
  });

  it('works without a note (flag still set)', async () => {
    const res = await SELF.fetch(`http://localhost/api/trial/${TRIAL_ID}/request-call`, { method: 'POST' });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare(
      'SELECT call_requested_at FROM trial_assessments WHERE id = ?',
    ).bind(TRIAL_ID).first<{ call_requested_at: string | null }>();
    expect(row?.call_requested_at).not.toBeNull();
  });

  it('404s for an unknown trial', async () => {
    const res = await SELF.fetch('http://localhost/api/trial/nope/request-call', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd workers/api && npx vitest run src/__tests__/trial-request-call.test.ts`
Expected: FAIL — route returns 404 for all (handler not defined) / columns missing.

- [ ] **Step 5: Implement the route**

In `workers/api/src/routes/trial-assessment.ts`, add this handler immediately after the `GET /:id/report` handler (after line ~302, before the final `export default app;` / router export):

```typescript
// POST /:id/request-call — Prospect requests a sales call. The DB flag is the
// source of truth (set first, request fails if it can't be set). The team
// notification is best-effort and never fails the request. No auth.
app.post('/:id/request-call', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  const assessment = await db.prepare(
    'SELECT company_name, contact_name, contact_email FROM trial_assessments WHERE id = ?',
  ).bind(id).first<{ company_name: string; contact_name: string; contact_email: string }>();
  if (!assessment) return c.json({ error: 'Assessment not found' }, 404);

  let note: string | null = null;
  try {
    const body = await c.req.json<{ note?: string }>();
    note = (body?.note || '').slice(0, 2000) || null;
  } catch { /* no body is fine */ }

  await db.prepare(
    "UPDATE trial_assessments SET call_requested_at = datetime('now'), call_note = ? WHERE id = ?",
  ).bind(note, id).run();

  // Best-effort notify — never throw out of here.
  try {
    const to = c.env.LEAD_NOTIFY_EMAIL;
    if (to) {
      const { sendOrQueueEmail } = await import('../services/email');
      await sendOrQueueEmail(db, {
        to: [to],
        subject: `Atheon trial: call requested — ${assessment.company_name}`,
        htmlBody:
          `<p><strong>${assessment.contact_name}</strong> (${assessment.contact_email}) ` +
          `from <strong>${assessment.company_name}</strong> requested a call.</p>` +
          `<p>Trial: ${id}</p>` +
          (note ? `<p>Note: ${note}</p>` : ''),
        tenantId: 'platform',
      }, c.env);
    }
  } catch (notifyErr) {
    console.error('request-call notify failed (non-fatal):', notifyErr);
  }

  return c.json({ requested: true });
});
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd workers/api && npx vitest run src/__tests__/trial-request-call.test.ts`
Expected: PASS (3 tests). The notify path is skipped in tests (no `LEAD_NOTIFY_EMAIL` binding), proving it is non-blocking.

Run: `cd workers/api && npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add workers/api/src/services/migrate.ts workers/api/src/types.ts workers/api/src/routes/trial-assessment.ts workers/api/src/__tests__/trial-request-call.test.ts
git commit -m "$(cat <<'EOF'
feat(trial): lead capture — request-call route + flag columns + best-effort notify

Adds call_requested_at/call_note self-heal columns and a public
POST /trial/:id/request-call. The DB flag is the source of truth; the team
email (gated on optional LEAD_NOTIFY_EMAIL) is best-effort and never fails
the request.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `ExposureResults` shared component

**Files:**
- Create: `src/components/ExposureResults.tsx`
- Test: `src/components/__tests__/ExposureResults.test.tsx`

Composes the existing `AssessmentFindingsPanel` (which already renders the money-first confirmed-value banner + per-finding ERP drill-down + the confirmed/indicative split). `ExposureResults` adds: an `insufficient_data` empty state (never a number), and a conversion CTA. It deliberately omits `onDeployCatalyst` so the panel renders no "Deploy" buttons (exposure-only, no recovery action). No ROI/recovery multiplier anywhere.

- [ ] **Step 1: Write the failing component test**

Create `src/components/__tests__/ExposureResults.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { ExposureResults } from '../ExposureResults';
import type { AssessmentFinding, AssessmentFindingsSummary } from '@/lib/api';

const finding: AssessmentFinding = {
  id: 'f1', code: 'FIN-CONF', category: 'finance', severity: 'high',
  title: 'Confirmed leakage', narrative: 'Across 480 invoices.',
  affected_count: 480, value_at_risk_zar: 2_000_000, value_components: [],
  currency_breakdown: { ZAR: 2_000_000 }, sample_records: [],
  recommended_catalyst: { catalyst: 'AR Recovery', sub_catalyst: 'Dunning' },
  metric_signature: 'sig', evidence_quality: 'high', confidence: 0.95,
  confidence_explanation: 'Direct observation.', confidence_gate_passed: true,
  erp_record_id: 'INV-99812', detected_at: '2026-06-18T00:00:00Z',
};

const summary: AssessmentFindingsSummary = {
  total_count: 1, total_value_at_risk_zar: 2_000_000,
  potential_unverified_zar: 0, unverified_count: 0,
  by_severity: { critical: 0, high: 1, medium: 0, low: 0 },
  by_category: {
    finance: { count: 1, value_at_risk_zar: 2_000_000 },
    procurement: { count: 0, value_at_risk_zar: 0 },
    supply_chain: { count: 0, value_at_risk_zar: 0 },
    sales: { count: 0, value_at_risk_zar: 0 },
    workforce: { count: 0, value_at_risk_zar: 0 },
    compliance: { count: 0, value_at_risk_zar: 0 },
    cross_cutting: { count: 0, value_at_risk_zar: 0 },
    service_delivery: { count: 0, value_at_risk_zar: 0 },
  },
  recommended_catalysts: ['AR Recovery'],
};

describe('ExposureResults', () => {
  it('renders the findings panel and a working CTA when complete', () => {
    const onClick = vi.fn();
    render(
      <ExposureResults
        data={{ status: 'complete', exposure: 2_000_000, findings: [finding], summary }}
        cta={{ label: 'Book a call', onClick }}
      />,
    );
    expect(screen.getByText('Confirmed leakage')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Book a call' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders an honest empty state with NO currency figure when insufficient_data', () => {
    render(
      <ExposureResults
        data={{ status: 'insufficient_data', exposure: null, findings: [] }}
        cta={{ label: 'Book a call', onClick: vi.fn() }}
      />,
    );
    expect(screen.getByTestId('exposure-insufficient')).toBeInTheDocument();
    // The fabrication guard: no rand figure anywhere in the rendered output.
    expect(document.body.textContent).not.toMatch(/R\s?\d/);
    expect(screen.queryByText('Confirmed leakage')).toBeNull();
  });

  it('does not render Deploy buttons (exposure-only, no recovery action)', () => {
    render(
      <ExposureResults
        data={{ status: 'complete', exposure: 2_000_000, findings: [finding], summary }}
        cta={{ label: 'Book a call', onClick: vi.fn() }}
      />,
    );
    expect(screen.queryByRole('button', { name: /deploy/i })).toBeNull();
  });

  it('shows the done state on the CTA when callRequested', () => {
    render(
      <ExposureResults
        data={{ status: 'complete', exposure: 2_000_000, findings: [finding], summary }}
        cta={{ label: 'Book a call', onClick: vi.fn(), done: true, doneLabel: "We'll be in touch" }}
      />,
    );
    expect(screen.getByText("We'll be in touch")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/__tests__/ExposureResults.test.tsx`
Expected: FAIL — `Cannot find module '../ExposureResults'`.

- [ ] **Step 3: Implement `ExposureResults`**

Create `src/components/ExposureResults.tsx`:

```typescript
/**
 * ExposureResults — the shared money-first results view used by both the public
 * trial flow and the logged-in dashboard first-run state.
 *
 * It composes AssessmentFindingsPanel (which already renders the confirmed
 * value-at-risk banner + per-finding ERP drill-down + the confirmed/indicative
 * split) and adds two things the panel does not: an honest insufficient_data
 * empty state (never a fabricated figure) and a conversion CTA. We deliberately
 * pass NO onDeployCatalyst so the panel shows no Deploy buttons — this surface
 * proves detected EXPOSURE only, never recovery/ROI.
 */
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { AssessmentFindingsPanel } from '@/components/AssessmentFindingsPanel';
import type { AssessmentFinding, AssessmentFindingsSummary } from '@/lib/api';

export interface ExposureResultsData {
  status: 'complete' | 'insufficient_data';
  exposure: number | null;
  findings: AssessmentFinding[];
  summary?: AssessmentFindingsSummary;
}

interface CtaConfig {
  label: string;
  onClick: () => void;
  pending?: boolean;
  done?: boolean;
  doneLabel?: string;
}

interface ExposureResultsProps {
  data: ExposureResultsData;
  cta: CtaConfig;
  secondaryCta?: { label: string; onClick: () => void };
  emptyTitle?: string;
  emptyBody?: string;
}

function CtaBar({ cta, secondaryCta }: { cta: CtaConfig; secondaryCta?: { label: string; onClick: () => void } }) {
  return (
    <div
      className="rounded-lg border p-6 flex flex-col sm:flex-row items-center justify-between gap-4"
      style={{ background: 'var(--bg-card-solid)', borderColor: 'var(--border-card)', boxShadow: 'var(--shadow-card)' }}
    >
      <div>
        <div className="text-sm font-semibold t-primary">Want help recovering this?</div>
        <div className="text-xs t-secondary mt-0.5">Talk to our team about turning detected exposure into recovered cash.</div>
      </div>
      <div className="flex items-center gap-3">
        {secondaryCta && (
          <button
            onClick={secondaryCta.onClick}
            className="px-4 py-2.5 rounded-sm border text-sm font-medium t-primary transition-colors"
            style={{ borderColor: 'var(--border-card)', background: 'var(--bg-secondary)' }}
          >
            {secondaryCta.label}
          </button>
        )}
        {cta.done ? (
          <span className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium" style={{ color: 'var(--positive)' }}>
            <CheckCircle2 size={16} aria-hidden="true" />
            {cta.doneLabel || 'Requested'}
          </span>
        ) : (
          <button
            onClick={cta.onClick}
            disabled={cta.pending}
            className="px-5 py-2.5 rounded-sm bg-accent hover:bg-[var(--accent-hover)] text-[var(--text-on-accent)] text-sm font-medium transition-colors disabled:opacity-50 active:scale-[0.97]"
          >
            {cta.pending ? 'Sending…' : cta.label}
          </button>
        )}
      </div>
    </div>
  );
}

export function ExposureResults({ data, cta, secondaryCta, emptyTitle, emptyBody }: ExposureResultsProps) {
  if (data.status === 'insufficient_data' || data.exposure == null) {
    return (
      <div className="space-y-6">
        <div
          data-testid="exposure-insufficient"
          className="rounded-lg border p-8 text-center"
          style={{ background: 'var(--bg-card-solid)', borderColor: 'var(--border-card)', boxShadow: 'var(--shadow-card)' }}
        >
          <AlertTriangle size={32} className="mx-auto mb-4 t-muted" aria-hidden="true" />
          <h2 className="text-xl font-bold t-primary mb-2">{emptyTitle || 'Not enough data to quantify exposure yet'}</h2>
          <p className="t-secondary text-sm max-w-md mx-auto">
            {emptyBody ||
              'We will not show a figure we cannot stand behind. We did not find enough clean, matching ERP records to confirm exposure. Share a more complete extract and we will detect what is recoverable.'}
          </p>
        </div>
        <CtaBar cta={cta} secondaryCta={secondaryCta} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-label" style={{ color: 'var(--text-secondary)' }}>
        Detected exposure across your ERP data — every figure below traces to the underlying records.
      </p>
      <AssessmentFindingsPanel findings={data.findings} summary={data.summary} />
      <CtaBar cta={cta} secondaryCta={secondaryCta} />
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/__tests__/ExposureResults.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ExposureResults.tsx src/components/__tests__/ExposureResults.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): ExposureResults shared money-first results component

Composes AssessmentFindingsPanel (no Deploy buttons -> exposure-only) and adds
an honest insufficient_data empty state (never a fabricated figure) plus a
conversion CTA. Reused by the trial flow and the dashboard first-run state.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Client API — `trial.upload` sends domains, `trial.requestCall`, extend `TrialResultsResponse`

**Files:**
- Modify: `src/lib/api.ts` (trial block ~1965-1970, `TrialResultsResponse` ~4579-4591)

- [ ] **Step 1: Update the `trial.upload` signature + add `requestCall`**

In `src/lib/api.ts`, replace the `upload:` line (currently line ~1968-1969) inside the `trial:` block:

```typescript
    upload: (id: string, data: { filename: string; row_count: number; columns: string[] }) =>
      request<{ received: boolean }>(`/api/trial/${id}/upload`, { method: 'POST', body: JSON.stringify(data) }),
```

with:

```typescript
    upload: (id: string, domains: Record<string, { header: string[]; rows: Array<Record<string, unknown>> }>) =>
      request<{ received: boolean; dataset_id: string; row_counts: Record<string, number> }>(
        `/api/trial/${id}/upload`,
        { method: 'POST', body: JSON.stringify({ domains }) },
      ),
    requestCall: (id: string, note?: string) =>
      request<{ requested: boolean }>(`/api/trial/${id}/request-call`, { method: 'POST', body: JSON.stringify({ note }) }),
```

- [ ] **Step 2: Extend `TrialResultsResponse`**

In `src/lib/api.ts`, find `export interface TrialResultsResponse` (~line 4579). Change its `status` field type and add the findings fields. Replace:

```typescript
  status: string;
```

(within `TrialResultsResponse`) with:

```typescript
  status: 'complete' | 'insufficient_data' | string;
  findings: AssessmentFinding[];
  findingsSummary: AssessmentFindingsSummary;
```

`AssessmentFinding` and `AssessmentFindingsSummary` are already declared in this file (~3520-3573), so no new import is needed.

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b --noEmit` (or `npm run build` if `tsc -b` alone is not wired)
Expected: errors ONLY in `src/pages/TrialPage.tsx` at the existing `api.trial.upload(...)` call site (the old signature) — those are fixed in Task 8. If errors appear anywhere else, fix them before continuing.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api.ts
git commit -m "$(cat <<'EOF'
feat(api-client): trial.upload sends domains, add trial.requestCall, findings in results

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `mapCsvToDomain` — pure CSV header → manifest auto-map

**Files:**
- Create: `src/lib/trial-automap.ts`
- Test: `src/lib/__tests__/trial-automap.test.ts`

The server validator rejects the whole domain on any unknown column, so the client must project each CSV to ONLY the manifest columns it recognises and report the rest as ignored.

- [ ] **Step 1: Write the failing unit test**

Create `src/lib/__tests__/trial-automap.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mapCsvToDomain } from '../trial-automap';

describe('mapCsvToDomain', () => {
  it('maps an invoices CSV, projecting to manifest columns and listing ignored ones', () => {
    const result = mapCsvToDomain(
      ['Invoice Number', 'invoice_date', 'Total', 'random_extra'],
      [{ 'Invoice Number': 'INV-1', invoice_date: '2026-01-10', Total: '500', random_extra: 'x' }],
    );
    expect(result).not.toBeNull();
    expect(result!.domain).toBe('invoices');
    // header is the manifest column names that matched
    expect(result!.header).toEqual(expect.arrayContaining(['invoice_number', 'invoice_date', 'total']));
    expect(result!.header).not.toContain('random_extra');
    // row keys are renamed to manifest column names; unknown columns dropped
    expect(result!.rows[0]).toEqual({ invoice_number: 'INV-1', invoice_date: '2026-01-10', total: '500' });
    expect(result!.unmapped).toEqual(['random_extra']);
  });

  it('returns null when no required column of any domain matches', () => {
    expect(mapCsvToDomain(['foo', 'bar', 'baz'], [{ foo: '1', bar: '2', baz: '3' }])).toBeNull();
  });

  it('normalises header casing/spacing/punctuation when matching', () => {
    const result = mapCsvToDomain(['  INVOICE-NUMBER ', 'Invoice Date', 'TOTAL'], [{ '  INVOICE-NUMBER ': 'A', 'Invoice Date': '2026-01-01', TOTAL: '9' }]);
    expect(result!.domain).toBe('invoices');
    expect(result!.rows[0]).toEqual({ invoice_number: 'A', invoice_date: '2026-01-01', total: '9' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/trial-automap.test.ts`
Expected: FAIL — `Cannot find module '../trial-automap'`.

- [ ] **Step 3: Implement `mapCsvToDomain`**

Create `src/lib/trial-automap.ts`:

```typescript
import { INGEST_MANIFEST } from './ingest-manifest';
import type { DomainDef } from './ingest-manifest';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export interface DomainMapping {
  /** manifest domain key (e.g. 'invoices') */
  domain: string;
  /** manifest column names that the CSV header matched */
  header: string[];
  /** rows projected to ONLY the matched manifest columns (renamed to canonical names) */
  rows: Array<Record<string, unknown>>;
  /** source headers that matched no manifest column (ignored on upload) */
  unmapped: string[];
}

/**
 * Lightweight header -> manifest auto-map for the trial upload. Picks the
 * manifest domain whose columns best overlap the CSV header (by normalised
 * name) and that matches at least one REQUIRED column, then projects each row
 * to only the mapped manifest columns. Unknown columns are dropped and listed
 * in `unmapped`, because the server validator rejects the whole domain on any
 * unknown column (strong inference). Returns null when nothing matches.
 */
export function mapCsvToDomain(
  header: string[],
  rows: Array<Record<string, unknown>>,
): DomainMapping | null {
  const normHeader = header.map((h) => ({ raw: h, n: norm(h) }));

  let best: { def: DomainDef; map: Map<string, string>; score: number } | null = null;

  for (const def of INGEST_MANIFEST) {
    const map = new Map<string, string>(); // sourceHeader -> manifest column name
    let reqHits = 0;
    let score = 0;
    for (const col of def.columns) {
      const cn = norm(col.name);
      const hit = normHeader.find((h) => h.n === cn);
      if (hit && !map.has(hit.raw)) {
        map.set(hit.raw, col.name);
        score++;
        if (col.required) reqHits++;
      }
    }
    if (reqHits > 0 && (!best || score > best.score)) {
      best = { def, map, score };
    }
  }

  if (!best) return null;

  const mappedSources = new Set(best.map.keys());
  const mappedHeader = Array.from(best.map.values());
  const mappedRows = rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [src, target] of best!.map.entries()) out[target] = r[src];
    return out;
  });
  const unmapped = header.filter((h) => !mappedSources.has(h));

  return { domain: best.def.domain, header: mappedHeader, rows: mappedRows, unmapped };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/__tests__/trial-automap.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/trial-automap.ts src/lib/__tests__/trial-automap.test.ts
git commit -m "$(cat <<'EOF'
feat(trial): mapCsvToDomain — lightweight CSV header to manifest auto-map

Projects each CSV to only the recognised manifest columns (renamed to
canonical names) and lists ignored columns, so the strong-inference server
validator never rejects the upload on stray columns.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: TrialPage upload step — real CSV parse + auto-map + POST domains

**Files:**
- Modify: `src/pages/TrialPage.tsx:54-69` (`handleUpload`) and `:258-284` (Step 2 upload UI)

- [ ] **Step 1: Add imports + file/mapping state**

In `src/pages/TrialPage.tsx`, add to the imports at the top:

```typescript
import { parseCsv } from '@/lib/ingest-client';
import { mapCsvToDomain } from '@/lib/trial-automap';
```

Inside the `TrialPage` component, next to the other `useState` declarations (after line 35), add:

```typescript
  const [mappings, setMappings] = useState<
    Array<{ fileName: string; domain: string; rowCount: number; mappedColumns: string[]; unmapped: string[] }>
  >([]);
  const [domains, setDomains] = useState<Record<string, { header: string[]; rows: Array<Record<string, unknown>> }>>({});
  const [parsing, setParsing] = useState(false);
```

- [ ] **Step 2: Add the file-handling logic + rewrite `handleUpload`**

Replace the existing `handleUpload` (lines 54-69) with the following two functions:

```typescript
  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setParsing(true);
    setError(null);
    const nextMappings: typeof mappings = [];
    const nextDomains: typeof domains = {};
    try {
      for (const file of Array.from(fileList)) {
        const { header, rows } = await parseCsv(file);
        const mapped = mapCsvToDomain(header, rows);
        if (!mapped) {
          nextMappings.push({ fileName: file.name, domain: '(unrecognised)', rowCount: rows.length, mappedColumns: [], unmapped: header });
          continue;
        }
        // Merge rows if two files map to the same domain.
        const existing = nextDomains[mapped.domain];
        nextDomains[mapped.domain] = existing
          ? { header: existing.header, rows: [...existing.rows, ...mapped.rows] }
          : { header: mapped.header, rows: mapped.rows };
        nextMappings.push({ fileName: file.name, domain: mapped.domain, rowCount: mapped.rows.length, mappedColumns: mapped.header, unmapped: mapped.unmapped });
      }
      setMappings(nextMappings);
      setDomains(nextDomains);
      if (Object.keys(nextDomains).length === 0) {
        setError('None of the uploaded files matched a known data type. Check the column headers and try again.');
      }
    } catch (err) {
      setError((err as Error).message);
    }
    setParsing(false);
  };

  const handleUpload = async () => {
    if (!trialId) return;
    if (Object.keys(domains).length === 0) {
      setError('Upload at least one recognised CSV file first.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.trial.upload(trialId, domains);
      await api.trial.run(trialId);
      setStep('processing');
      pollStatus(trialId);
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  };
```

- [ ] **Step 3: Replace the Step 2 upload UI**

Replace the Step 2 block (lines 258-284, the whole `{step === 'upload' && (...)}` JSX) with:

```typescript
        {/* Step 2: Upload Data */}
        {step === 'upload' && (
          <div className="rounded-lg border p-8 max-w-2xl mx-auto" style={{ background: 'var(--bg-card-solid)', borderColor: 'var(--border-card)', boxShadow: 'var(--shadow-card)' }}>
            <p className="text-label mb-2">Step 02</p>
            <h2 className="text-2xl font-bold t-primary mb-1">Upload Your Data</h2>
            <p className="t-secondary text-sm mb-6">Upload one or more CSV exports (invoices, purchase orders, etc.). We match each file to a known data type automatically and analyse it in your browser-isolated trial workspace.</p>

            <label
              className="block border-2 border-dashed rounded-sm p-12 cursor-pointer active:scale-[0.99] text-center transition-colors hover:border-[var(--accent)]"
              style={{ borderColor: 'var(--border-card)', background: 'var(--bg-secondary)' }}
            >
              <input
                type="file"
                accept=".csv,text/csv"
                multiple
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />
              {parsing ? <Loader2 size={40} className="mx-auto mb-4 text-accent animate-spin" aria-hidden="true" /> : <Upload size={40} className="mx-auto mb-4 t-muted" aria-hidden="true" />}
              <p className="text-sm t-primary font-medium mb-1">{parsing ? 'Reading files…' : 'Click to upload CSV files'}</p>
              <p className="text-xs t-muted">Or drag and drop. Files are deleted after 7 days.</p>
            </label>

            {mappings.length > 0 && (
              <div className="mt-6 space-y-2" aria-label="Detected files">
                {mappings.map((m, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 rounded-sm border px-4 py-3 text-sm" style={{ borderColor: 'var(--border-card)', background: 'var(--bg-secondary)' }}>
                    <div className="min-w-0">
                      <div className="t-primary font-medium truncate">{m.fileName}</div>
                      <div className="text-xs t-muted">
                        {m.domain === '(unrecognised)'
                          ? 'No matching data type — will be skipped'
                          : `Matched: ${m.domain} · ${m.rowCount} rows${m.unmapped.length ? ` · ignored: ${m.unmapped.join(', ')}` : ''}`}
                      </div>
                    </div>
                    {m.domain === '(unrecognised)'
                      ? <AlertTriangle size={16} style={{ color: 'var(--warning)' }} aria-hidden="true" />
                      : <CheckCircle2 size={16} className="text-accent" aria-hidden="true" />}
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={handleUpload}
              disabled={loading || parsing || Object.keys(domains).length === 0}
              className="mt-6 w-full py-3 rounded-sm bg-accent hover:bg-[var(--accent-hover)] text-[var(--text-on-accent)] font-medium text-sm transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.97]"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <BarChart3 size={16} />}
              {loading ? 'Processing...' : 'Run Assessment'}
            </button>
          </div>
        )}
```

- [ ] **Step 4: Update the poll to treat `insufficient_data` as terminal**

In `pollStatus` (lines 71-95), change the completion check. Replace:

```typescript
        if (status.status === 'complete') {
          const res = await api.trial.results(id);
          setResults(res);
          setStep('results');
          setLoading(false);
          return;
        }
```

with:

```typescript
        if (status.status === 'complete' || status.status === 'insufficient_data') {
          const res = await api.trial.results(id);
          setResults(res);
          setStep('results');
          setLoading(false);
          return;
        }
```

- [ ] **Step 5: Typecheck the build**

Run: `npx tsc -b --noEmit`
Expected: no errors in `TrialPage.tsx` for the upload path. (Results-step errors are expected here and fixed in Task 9 — the old results JSX still references fields; if `tsc` blocks, proceed to Task 9 and run the combined typecheck there. Note this in the commit if so.)

- [ ] **Step 6: Commit**

```bash
git add src/pages/TrialPage.tsx
git commit -m "$(cat <<'EOF'
feat(trial): real CSV upload — parse + auto-map + POST domains

Replaces the simulated upload with a real file input that parses each CSV,
auto-maps it to a manifest domain, shows matched/ignored columns, and POSTs the
domains payload. Poll now treats insufficient_data as terminal.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: TrialPage results step → `ExposureResults`

**Files:**
- Modify: `src/pages/TrialPage.tsx` (Step 4 results block starting line 316) + add request-call handler/state

- [ ] **Step 1: Add the request-call handler + state + import**

Add to the imports in `src/pages/TrialPage.tsx`:

```typescript
import { ExposureResults } from '@/components/ExposureResults';
```

Add state next to the others (after line 35):

```typescript
  const [callRequested, setCallRequested] = useState(false);
  const [callPending, setCallPending] = useState(false);
```

Add this handler next to `handleUpload`:

```typescript
  const handleRequestCall = async () => {
    if (!trialId) return;
    setCallPending(true);
    try {
      await api.trial.requestCall(trialId);
      setCallRequested(true);
    } catch (err) {
      setError((err as Error).message);
    }
    setCallPending(false);
  };

  const handleDownloadReport = async () => {
    if (!trialId) return;
    try {
      await api.trial.report(trialId);
    } catch (err) {
      setError((err as Error).message);
    }
  };
```

- [ ] **Step 2: Replace the Step 4 results block**

Replace the entire `{step === 'results' && results && ( ... )}` JSX block (starts at line 316, runs to its matching close near line 444) with:

```typescript
        {/* Step 4: Results */}
        {step === 'results' && results && (
          <ExposureResults
            data={{
              status: results.status === 'insufficient_data' ? 'insufficient_data' : 'complete',
              exposure: results.estimatedExposure,
              findings: results.findings,
              summary: results.findingsSummary,
            }}
            cta={{
              label: 'Book a call',
              onClick: handleRequestCall,
              pending: callPending,
              done: callRequested,
              doneLabel: "Thanks — we'll be in touch",
            }}
            secondaryCta={{ label: 'Download report', onClick: handleDownloadReport }}
          />
        )}
```

If `currency`, `formatCompactCurrency`, or icon imports become unused after removing the old results JSX, delete them to keep the build clean (the typecheck/lint in Step 3 will flag them).

- [ ] **Step 3: Typecheck + run frontend tests**

Run: `npx tsc -b --noEmit`
Expected: no errors.

Run: `npx vitest run src/components/__tests__/ExposureResults.test.tsx src/lib/__tests__/trial-automap.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/pages/TrialPage.tsx
git commit -m "$(cat <<'EOF'
feat(trial): results step renders ExposureResults + book-a-call CTA

Replaces the fabricated health-score/ROI results view with the shared
money-first ExposureResults (real detected exposure or honest insufficient
state) and wires the book-a-call lead capture.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Dashboard first-run exposure entry

**Files:**
- Modify: `src/pages/Dashboard.tsx:265-283`

When a logged-in tenant has no verified recovery yet (`valueRecovered === 0` — the pre-recovery first-run state), surface the money-first entry above the executive spine: an `ExposureResults` insufficient-state card that routes the user into an assessment, rather than leading with a zeroed verified-savings hero. `FindingsReviewTable` below still shows real findings when they exist.

- [ ] **Step 1: Add imports**

In `src/pages/Dashboard.tsx`, add:

```typescript
import { useNavigate } from 'react-router-dom';
import { ExposureResults } from '@/components/ExposureResults';
```

If `useNavigate` is already imported, skip it. Inside the component body (near the top, with other hooks), add:

```typescript
  const navigate = useNavigate();
```

(Skip if a `navigate` is already in scope.)

- [ ] **Step 2: Render the first-run entry above `ExecutiveOverview`**

In the returned JSX, immediately after `<div className="space-y-6 animate-fadeIn">` (line 266) and before the `<ExecutiveOverview ... />` block, insert:

```typescript
      {valueRecovered === 0 && (
        <ExposureResults
          data={{ status: 'insufficient_data', exposure: null, findings: [] }}
          emptyTitle="See your detected exposure"
          emptyBody="Run an assessment on your ERP data to surface, in Rand, what you are losing — every figure traced to its underlying records. No fabricated numbers."
          cta={{ label: 'Run your first assessment', onClick: () => navigate('/assessments') }}
        />
      )}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: no errors. Confirm `valueRecovered` is in scope at this point in `Dashboard.tsx` (it is referenced at line 277 in the existing `<ExecutiveOverview valueRecovered={valueRecovered} />`).

- [ ] **Step 4: Manual smoke check (no automated test for this wiring)**

Run: `npm run build`
Expected: build succeeds. (This task is presentational wiring gated on existing state; the shared component itself is covered by Task 5's tests.)

- [ ] **Step 5: Commit**

```bash
git add src/pages/Dashboard.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): first-run exposure entry above the executive spine

When a tenant has no verified recovery yet (valueRecovered === 0), lead with a
money-first ExposureResults card that routes into an assessment, instead of a
zeroed verified-savings hero.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Final verification (after all tasks)

- [ ] **Worker suite green**

Run: `cd workers/api && npm test`
Expected: all worker tests pass (including the pre-existing `dataset-ingest.test.ts`).

- [ ] **Worker typecheck**

Run: `cd workers/api && npm run typecheck`
Expected: no errors.

- [ ] **Frontend suite + build green**

Run: `npm run test:coverage` (or `npx vitest run src`)
Expected: all frontend tests pass; coverage floor not regressed.

Run: `npm run build`
Expected: `tsc -b && vite build` succeeds.

- [ ] **End-to-end intent check (manual reasoning against the spec)**

Confirm the HARD invariant holds: there is no remaining `Math.random()` in `workers/api/src/routes/trial-assessment.ts`, the trial exposure equals `summariseFindings().total_value_at_risk_zar`, and the `insufficient_data` path renders no currency figure. Then proceed to `superpowers:finishing-a-development-branch`.

---

## Self-Review

**1. Spec coverage:**
- §3.1 extract `ingestDomains` + refactor → Task 1. ✓
- §3.2 trial `/upload` real ingest → Task 2. ✓
- §3.3 trial `/run` datasetId + delete `Math.random` + exposure-from-findings + `insufficient_data` → Task 3 (with the documented spec correction: exposure = `total_value_at_risk_zar`, not `immediate_value+ongoing×12`). ✓
- §3.4 migration columns + `/request-call` + best-effort notify → Task 4. ✓
- §4.1 `ExposureResults` shared component (hero via panel banner, ERP drill-down via panel, honest empty state, CTA, no ROI/Deploy) → Task 5. ✓
- §4.2 trial upload step parseCsv + auto-map + surface unmapped → Tasks 7 + 8. ✓
- §4.3 trial results renders `ExposureResults` → Task 9. ✓
- §4.4 logged-in first-run empty-state → `ExposureResults` → Task 10 (scoped to the `valueRecovered === 0` entry; honest no-number CTA. Rendering a tenant's *existing* findings on the dashboard depends on a dashboard-findings-summary endpoint and is out of scope — `FindingsReviewTable` already shows findings when present). ✓
- §5 honest-state / prefer false-negative → Task 3 `computeTrialOutcome` + Task 5 empty state. ✓
- §6 security (50k row cap, validate rejects unknown cols, trial-tenant + dataset isolation) → Task 1 `maxRowsPerDomain`, Task 2 cap, reuse of `validateDomainRows`, `ds_trial_<id>` tagging. ✓
- §7 testing → unit (`ingestDomains`, `computeTrialOutcome`, `mapCsvToDomain`, `ExposureResults`) + integration (`trial-ingest`, `trial-request-call`) + refactor guard (`dataset-ingest`). ✓
- §8 out-of-scope (Feature B) → untouched. ✓

**2. Placeholder scan:** No TBD/TODO/"add error handling" — every code step is complete. ✓

**3. Type consistency:** `ingestDomains(db, tenantId, datasetId, domains, opts)` → `{row_counts, errors}` used identically in Tasks 1/2. `IngestError {domain,row,column,message}` matches the dataset route's prior `allErrors` shape. `computeTrialOutcome(summary) → {status, exposure}` consumed in Task 3's `/run`. `ExposureResultsData {status, exposure, findings, summary?}` + `cta`/`secondaryCta` consumed identically in Tasks 9/10. `mapCsvToDomain → DomainMapping {domain, header, rows, unmapped} | null` consumed in Task 8. `api.trial.upload(id, domains)` (Task 6) matches Task 8's call. `TrialResultsResponse.status/findings/findingsSummary` (Task 6) matches Task 9's usage. `datasetId = ds_trial_<id>` sanitised identically in `/upload` and `/run`. ✓
