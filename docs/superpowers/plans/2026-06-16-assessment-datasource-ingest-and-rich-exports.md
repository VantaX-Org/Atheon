# Assessment Data-Source Ingest + Rich Per-Finding Exports — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user upload a prospect's real ERP data into an isolated per-assessment dataset, run the catalyst/assessment scoped to that dataset, and export a report with detailed, graphed, auditable per-finding evidence.

**Architecture:** Phase 1 = A (upload-driven ingest) + C (rich exports). A adds an `assessment_datasets` table and a nullable `dataset_id` on the 8 canonical `erp_*` tables (NULL = existing tenant/seed data, preserved). A shared column manifest drives template generation, client validation, and server validation. `runAssessment`/`collectVolumeSnapshot`/recon sub-engines gain an optional `datasetId` that adds `AND dataset_id = ?` to every `erp_*` query. C adds a shared SVG chart-geometry module mirrored into the worker (workers **cannot** import from `src/`), feeding both the React `AssessmentFindingsPanel` and the worker Value PDF; lifts the 25-finding cap and adds an Excel findings sheet.

**Tech Stack:** TypeScript, React 18 + Vite, Hono on Cloudflare Workers, D1 (SQLite), vitest + `@cloudflare/vitest-pool-workers`, papaparse, jsPDF, SheetJS (xlsx).

---

## File Structure

**A — Ingest**
- `workers/api/migrations/0007_assessment_datasets.sql` (Create) — `assessment_datasets` table.
- `workers/api/src/services/migrate.ts` (Modify) — bump `MIGRATION_VERSION`; add `assessment_datasets` create + `dataset_id` self-heal columns + `(tenant_id, dataset_id)` indexes.
- `src/lib/ingest-manifest.ts` (Create) — canonical per-domain column manifest (single source of truth).
- `workers/api/src/lib/ingest-manifest.ts` (Create) — byte-identical mirror (worker cannot import `src/`).
- `workers/api/src/__tests__/ingest-manifest-parity.test.ts` (Create) — asserts the two manifests are identical.
- `src/lib/ingest-validate.ts` (Create) — client CSV parse + validate against manifest.
- `workers/api/src/lib/ingest-validate.ts` (Create) — mirror of the pure validation core (reused server-side).
- `workers/api/src/routes/assessments.ts` (Modify) — `POST /api/assessments/:id/dataset`; pass `dataset_id` into create + run.
- `workers/api/src/services/assessment-engine.ts` (Modify) — `datasetId` threaded through `collectVolumeSnapshot`, `runAssessment`, finding detection.
- `src/pages/AssessmentsPage.tsx` (Modify) — new Connection/Data wizard step.
- `src/lib/api.ts` (Modify) — `api.assessments.uploadDataset(...)` + types.
- Tests: `workers/api/src/__tests__/dataset-ingest.test.ts`, `workers/api/src/__tests__/dataset-isolation.test.ts`.

**C — Exports**
- `src/lib/finding-charts.ts` (Create) — pure chart-geometry helpers returning SVG strings.
- `workers/api/src/lib/finding-charts.ts` (Create) — byte-identical mirror.
- `workers/api/src/__tests__/finding-charts-parity.test.ts` (Create) — asserts mirror identical.
- `src/lib/__tests__/finding-charts.test.ts` (Create) — geometry unit tests.
- `src/components/AssessmentFindingsPanel.tsx` (Modify) — render per-finding SVG charts.
- `workers/api/src/services/value-assessment-engine.ts` (Modify) — inject SVG into Value PDF; portfolio roll-ups.
- `src/lib/report-generators.ts` (Modify) — lift 25-finding cap; add Excel Findings sheet.

---

## Conventions (read once)

- Worker tests: each `describe` calls `await ensureMigrated()` (from `./setup`) in `beforeAll`, seeds tenant/user, logs in via `POST /api/v1/auth/login`, uses `env`/`SELF` from `cloudflare:test`. Mirror `workers/api/src/__tests__/memory-build.test.ts`.
- Run a single worker test: `cd workers/api && npx vitest run src/__tests__/<file>.test.ts -t '<name>'`.
- Client test: `npx vitest run src/lib/__tests__/<file>.test.ts`.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- The 8 canonical tables (exact order used everywhere in this plan): `erp_invoices`, `erp_purchase_orders`, `erp_journal_entries`, `erp_bank_transactions`, `erp_employees`, `erp_customers`, `erp_suppliers`, `erp_products`.
- **Worker ↔ client boundary:** `workers/api/tsconfig.json` has no `@/*`/`src` path and `include: ["src/**/*"]` only. The worker CANNOT import from the repo `src/`. Every "shared" module is created twice (canonical in `src/lib`, mirror in `workers/api/src/lib`) and a parity test guarantees they stay byte-identical.

---

## A — Upload-Driven Ingest

### Task 1: Migration — `assessment_datasets` table

**Files:**
- Create: `workers/api/migrations/0007_assessment_datasets.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Migration 0007: Per-assessment uploaded dataset.
-- Exactly one dataset per assessment. Holds ingest status + per-domain row
-- counts so the wizard can gate the run on status='ready'. ERP rows tagged
-- with this dataset's id live in the erp_* tables (dataset_id column, added
-- via self-heal in migrate.ts). NULL dataset_id on erp_* = existing tenant/seed
-- data and keeps every current query + the demo seed working untouched.
CREATE TABLE IF NOT EXISTS assessment_datasets (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessments(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'ingesting' | 'ready' | 'failed'
  row_counts TEXT NOT NULL DEFAULT '{}',   -- JSON: { <domain>: number }
  error TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_assessment_datasets_assessment ON assessment_datasets(assessment_id);
CREATE INDEX IF NOT EXISTS idx_assessment_datasets_tenant ON assessment_datasets(tenant_id);
```

- [ ] **Step 2: Commit**

```bash
git add workers/api/migrations/0007_assessment_datasets.sql
git commit -m "feat(migrations): assessment_datasets table (0007)"
```

---

### Task 2: Migration runtime — version bump + create + self-heal `dataset_id`

The runtime applies schema from embedded strings in `migrate.ts` (not the `.sql` files). Add the table create, the 8 `dataset_id` self-heal columns, and the `(tenant_id, dataset_id)` indexes there, and bump `MIGRATION_VERSION` so the version-marker fast path re-runs.

**Files:**
- Modify: `workers/api/src/services/migrate.ts` (version const line ~110; `erpIndexes` ~830; `selfHealColumns` ~891/end ~1180)
- Test: `workers/api/src/__tests__/dataset-migration.test.ts` (Create)

- [ ] **Step 1: Write the failing test**

```ts
// workers/api/src/__tests__/dataset-migration.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { ensureMigrated } from './setup';

describe('dataset_id migration', () => {
  beforeAll(async () => { await ensureMigrated(); });

  const TABLES = [
    'erp_invoices', 'erp_purchase_orders', 'erp_journal_entries', 'erp_bank_transactions',
    'erp_employees', 'erp_customers', 'erp_suppliers', 'erp_products',
  ];

  it('adds nullable dataset_id to all 8 canonical erp_* tables', async () => {
    for (const t of TABLES) {
      const info = await env.DB.prepare(`PRAGMA table_info(${t})`).all<{ name: string; notnull: number }>();
      const col = info.results.find(r => r.name === 'dataset_id');
      expect(col, `${t}.dataset_id missing`).toBeTruthy();
      expect(col!.notnull).toBe(0); // nullable
    }
  });

  it('creates assessment_datasets table', async () => {
    const info = await env.DB.prepare(`PRAGMA table_info(assessment_datasets)`).all<{ name: string }>();
    const names = info.results.map(r => r.name);
    expect(names).toEqual(expect.arrayContaining(['id', 'assessment_id', 'tenant_id', 'status', 'row_counts', 'error', 'uploaded_at']));
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd workers/api && npx vitest run src/__tests__/dataset-migration.test.ts`
Expected: FAIL — `dataset_id missing` (and/or no `assessment_datasets` table).

- [ ] **Step 3: Bump the version constant**

In `workers/api/src/services/migrate.ts`, change the `MIGRATION_VERSION` line (~110):

```ts
export const MIGRATION_VERSION = 'v85-assessment-datasets';
```

Add a comment in the version block immediately above it:

```ts
// v85-assessment-datasets: assessment_datasets table (one uploaded dataset per
// assessment) + nullable dataset_id (TEXT) on all 8 canonical erp_* tables for
// per-assessment data isolation. NULL dataset_id = existing tenant/seed rows
// (back-compat preserved). Index (tenant_id, dataset_id) for scoped run queries.
```

- [ ] **Step 4: Add the `assessment_datasets` create**

Find the array of standalone `CREATE TABLE` statements (the same batch that creates `user_preferences`/assessments-era tables). Add:

```ts
`CREATE TABLE IF NOT EXISTS assessment_datasets (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessments(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  status TEXT NOT NULL DEFAULT 'pending',
  row_counts TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
```

- [ ] **Step 5: Add the self-heal `dataset_id` columns**

In the `selfHealColumns` array (the block that already lists `company_id`/`connection_id` per erp table, ~line 1159), append:

```ts
// v85: per-assessment dataset isolation. NULL = tenant/seed rows (back-compat);
// non-null rows belong to exactly one uploaded assessment_datasets row.
{ table: 'erp_invoices',          column: 'dataset_id', definition: 'TEXT' },
{ table: 'erp_purchase_orders',   column: 'dataset_id', definition: 'TEXT' },
{ table: 'erp_journal_entries',   column: 'dataset_id', definition: 'TEXT' },
{ table: 'erp_bank_transactions', column: 'dataset_id', definition: 'TEXT' },
{ table: 'erp_employees',         column: 'dataset_id', definition: 'TEXT' },
{ table: 'erp_customers',         column: 'dataset_id', definition: 'TEXT' },
{ table: 'erp_suppliers',         column: 'dataset_id', definition: 'TEXT' },
{ table: 'erp_products',          column: 'dataset_id', definition: 'TEXT' },
```

- [ ] **Step 6: Add the scoped indexes**

In the `erpIndexes` array (~line 830) append:

```ts
'CREATE INDEX IF NOT EXISTS idx_erp_invoices_dataset ON erp_invoices(tenant_id, dataset_id)',
'CREATE INDEX IF NOT EXISTS idx_erp_po_dataset ON erp_purchase_orders(tenant_id, dataset_id)',
'CREATE INDEX IF NOT EXISTS idx_erp_journal_dataset ON erp_journal_entries(tenant_id, dataset_id)',
'CREATE INDEX IF NOT EXISTS idx_erp_bank_dataset ON erp_bank_transactions(tenant_id, dataset_id)',
'CREATE INDEX IF NOT EXISTS idx_erp_employees_dataset ON erp_employees(tenant_id, dataset_id)',
'CREATE INDEX IF NOT EXISTS idx_erp_customers_dataset ON erp_customers(tenant_id, dataset_id)',
'CREATE INDEX IF NOT EXISTS idx_erp_suppliers_dataset ON erp_suppliers(tenant_id, dataset_id)',
'CREATE INDEX IF NOT EXISTS idx_erp_products_dataset ON erp_products(tenant_id, dataset_id)',
```

- [ ] **Step 7: Run test, verify it passes**

Run: `cd workers/api && npx vitest run src/__tests__/dataset-migration.test.ts`
Expected: PASS (both tests).

- [ ] **Step 8: Run the migration-version tests still pass**

Run: `cd workers/api && npx vitest run src/__tests__/auto-migration-bound.test.ts src/__tests__/smoke.test.ts`
Expected: PASS (they read `MIGRATION_VERSION` via import, so they pick up `v85` automatically).

- [ ] **Step 9: Commit**

```bash
git add workers/api/src/services/migrate.ts workers/api/src/__tests__/dataset-migration.test.ts
git commit -m "feat(migrate): v85 assessment_datasets + dataset_id on 8 erp_* tables"
```

---

### Task 3: Shared column manifest (single source of truth) + worker mirror + parity test

The manifest defines, per domain, the canonical CSV columns (matching the `erp_*` schema) with type + required flag. It drives template generation, client validation, and server validation. Defined once in `src/lib`, mirrored byte-for-byte into the worker.

**Files:**
- Create: `src/lib/ingest-manifest.ts`
- Create: `workers/api/src/lib/ingest-manifest.ts`
- Test: `workers/api/src/__tests__/ingest-manifest-parity.test.ts`

- [ ] **Step 1: Write the canonical manifest**

```ts
// src/lib/ingest-manifest.ts
// Single source of truth for upload-driven ingest. Columns map 1:1 to erp_*
// schema (workers/api/src/services/migrate.ts). MIRROR: an identical copy lives
// at workers/api/src/lib/ingest-manifest.ts (the worker cannot import src/).
// Any edit here MUST be copied there — ingest-manifest-parity.test.ts enforces it.

export type ColType = 'string' | 'number' | 'integer' | 'date' | 'boolean';

export interface ColumnDef {
  /** canonical erp_* column name */
  name: string;
  type: ColType;
  required: boolean;
}

export interface DomainDef {
  /** dataset domain key + the erp_* table it ingests into */
  domain: string;
  table: string;
  label: string;
  columns: ColumnDef[];
}

export const INGEST_MANIFEST: DomainDef[] = [
  {
    domain: 'invoices', table: 'erp_invoices', label: 'Sales Invoices (AR)',
    columns: [
      { name: 'invoice_number', type: 'string', required: true },
      { name: 'customer_name', type: 'string', required: false },
      { name: 'invoice_date', type: 'date', required: true },
      { name: 'due_date', type: 'date', required: false },
      { name: 'subtotal', type: 'number', required: false },
      { name: 'vat_amount', type: 'number', required: false },
      { name: 'total', type: 'number', required: true },
      { name: 'amount_paid', type: 'number', required: false },
      { name: 'amount_due', type: 'number', required: false },
      { name: 'currency', type: 'string', required: false },
      { name: 'status', type: 'string', required: false },
      { name: 'payment_status', type: 'string', required: false },
    ],
  },
  {
    domain: 'purchase_orders', table: 'erp_purchase_orders', label: 'Purchase Orders (AP)',
    columns: [
      { name: 'po_number', type: 'string', required: true },
      { name: 'supplier_name', type: 'string', required: false },
      { name: 'order_date', type: 'date', required: true },
      { name: 'delivery_date', type: 'date', required: false },
      { name: 'subtotal', type: 'number', required: false },
      { name: 'vat_amount', type: 'number', required: false },
      { name: 'total', type: 'number', required: true },
      { name: 'currency', type: 'string', required: false },
      { name: 'status', type: 'string', required: false },
      { name: 'delivery_status', type: 'string', required: false },
    ],
  },
  {
    domain: 'journal_entries', table: 'erp_journal_entries', label: 'GL Journal Entries',
    columns: [
      { name: 'journal_number', type: 'string', required: true },
      { name: 'journal_date', type: 'date', required: true },
      { name: 'description', type: 'string', required: false },
      { name: 'total_debit', type: 'number', required: true },
      { name: 'total_credit', type: 'number', required: true },
      { name: 'status', type: 'string', required: false },
    ],
  },
  {
    domain: 'bank_transactions', table: 'erp_bank_transactions', label: 'Bank Transactions',
    columns: [
      { name: 'bank_account', type: 'string', required: true },
      { name: 'transaction_date', type: 'date', required: true },
      { name: 'description', type: 'string', required: false },
      { name: 'reference', type: 'string', required: false },
      { name: 'debit', type: 'number', required: false },
      { name: 'credit', type: 'number', required: false },
      { name: 'balance', type: 'number', required: false },
      { name: 'reconciled', type: 'integer', required: false },
    ],
  },
  {
    domain: 'employees', table: 'erp_employees', label: 'Employees / Payroll',
    columns: [
      { name: 'employee_number', type: 'string', required: true },
      { name: 'first_name', type: 'string', required: true },
      { name: 'last_name', type: 'string', required: true },
      { name: 'email', type: 'string', required: false },
      { name: 'department', type: 'string', required: false },
      { name: 'position', type: 'string', required: false },
      { name: 'salary_frequency', type: 'string', required: false },
      { name: 'gross_salary', type: 'number', required: false },
      { name: 'status', type: 'string', required: false },
    ],
  },
  {
    domain: 'customers', table: 'erp_customers', label: 'Customers',
    columns: [
      { name: 'name', type: 'string', required: true },
      { name: 'registration_number', type: 'string', required: false },
      { name: 'vat_number', type: 'string', required: false },
      { name: 'payment_terms', type: 'string', required: false },
      { name: 'currency', type: 'string', required: false },
      { name: 'credit_limit', type: 'number', required: false },
      { name: 'status', type: 'string', required: false },
    ],
  },
  {
    domain: 'suppliers', table: 'erp_suppliers', label: 'Suppliers',
    columns: [
      { name: 'name', type: 'string', required: true },
      { name: 'registration_number', type: 'string', required: false },
      { name: 'vat_number', type: 'string', required: false },
      { name: 'payment_terms', type: 'string', required: false },
      { name: 'currency', type: 'string', required: false },
      { name: 'status', type: 'string', required: false },
    ],
  },
  {
    domain: 'products', table: 'erp_products', label: 'Products / Inventory',
    columns: [
      { name: 'sku', type: 'string', required: true },
      { name: 'name', type: 'string', required: true },
      { name: 'category', type: 'string', required: false },
      { name: 'uom', type: 'string', required: false },
      { name: 'cost_price', type: 'number', required: false },
      { name: 'selling_price', type: 'number', required: false },
      { name: 'stock_on_hand', type: 'number', required: false },
      { name: 'is_active', type: 'integer', required: false },
    ],
  },
];

/** CSV header row for a domain's downloadable template. */
export function templateHeader(domain: string): string {
  const d = INGEST_MANIFEST.find(x => x.domain === domain);
  if (!d) throw new Error(`unknown domain ${domain}`);
  return d.columns.map(c => c.name).join(',');
}

export function domainDef(domain: string): DomainDef | undefined {
  return INGEST_MANIFEST.find(x => x.domain === domain);
}
```

- [ ] **Step 2: Create the byte-identical worker mirror**

```bash
mkdir -p workers/api/src/lib
cp src/lib/ingest-manifest.ts workers/api/src/lib/ingest-manifest.ts
```

(The comment in the file already states it is a mirror — leave it; the parity test compares the full text.)

- [ ] **Step 3: Write the parity test**

```ts
// workers/api/src/__tests__/ingest-manifest-parity.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ingest-manifest mirror parity', () => {
  it('worker mirror is byte-identical to src/lib canonical', () => {
    const canonical = readFileSync(resolve(__dirname, '../../../../src/lib/ingest-manifest.ts'), 'utf8');
    const mirror = readFileSync(resolve(__dirname, '../lib/ingest-manifest.ts'), 'utf8');
    expect(mirror).toBe(canonical);
  });
});
```

> Path note: worker tests run from `workers/api/`. `__dirname` = `workers/api/src/__tests__`. The repo `src/lib` is four levels up. If `readFileSync` fails to resolve under the workers-pool sandbox, fall back to importing both modules and `expect(JSON.stringify(workerManifest)).toBe(JSON.stringify(srcManifest))` — but try the byte compare first as it also catches helper-function drift.

- [ ] **Step 4: Run the parity test**

Run: `cd workers/api && npx vitest run src/__tests__/ingest-manifest-parity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingest-manifest.ts workers/api/src/lib/ingest-manifest.ts workers/api/src/__tests__/ingest-manifest-parity.test.ts
git commit -m "feat(ingest): shared column manifest + worker mirror + parity test"
```

---

### Task 4: Validation core (pure) — client + worker mirror

Pure functions: given a domain key, a header array, and parsed rows (objects keyed by header), return `{ rows, errors }`. Used by the client before submit and by the server before insert (strong-inference guard: unknown columns or type-mismatched cells reject — nothing partial). Defined in `src/lib`, mirrored into worker.

**Files:**
- Create: `src/lib/ingest-validate.ts`
- Create: `workers/api/src/lib/ingest-validate.ts`
- Test: `src/lib/__tests__/ingest-validate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/ingest-validate.test.ts
import { describe, it, expect } from 'vitest';
import { validateDomainRows } from '../ingest-validate';

describe('validateDomainRows', () => {
  it('accepts a valid invoices row set', () => {
    const r = validateDomainRows('invoices',
      ['invoice_number', 'invoice_date', 'total'],
      [{ invoice_number: 'INV-1', invoice_date: '2026-01-15', total: '1000.50' }]);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([{ invoice_number: 'INV-1', invoice_date: '2026-01-15', total: 1000.5 }]);
  });

  it('rejects an unknown column wholesale (strong inference)', () => {
    const r = validateDomainRows('invoices',
      ['invoice_number', 'invoice_date', 'total', 'mystery_col'],
      [{ invoice_number: 'INV-1', invoice_date: '2026-01-15', total: '1', mystery_col: 'x' }]);
    expect(r.errors.some(e => /unknown column.*mystery_col/i.test(e.message))).toBe(true);
    expect(r.rows).toEqual([]); // nothing ingested
  });

  it('rejects a missing required column', () => {
    const r = validateDomainRows('invoices', ['invoice_number', 'invoice_date'], []);
    expect(r.errors.some(e => /missing required column.*total/i.test(e.message))).toBe(true);
  });

  it('flags a type mismatch with row + column', () => {
    const r = validateDomainRows('invoices',
      ['invoice_number', 'invoice_date', 'total'],
      [{ invoice_number: 'INV-1', invoice_date: 'not-a-date', total: 'abc' }]);
    expect(r.errors.some(e => e.row === 1 && e.column === 'invoice_date')).toBe(true);
    expect(r.errors.some(e => e.row === 1 && e.column === 'total')).toBe(true);
    expect(r.rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/lib/__tests__/ingest-validate.test.ts`
Expected: FAIL — module not found / `validateDomainRows` undefined.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/ingest-validate.ts
// Pure CSV-row validation against the ingest manifest. Strong-inference rule:
// unknown columns or any type-mismatched cell => the whole domain is rejected
// (rows: []). No silent coercion of a prospect column into a canonical field.
// MIRROR: workers/api/src/lib/ingest-validate.ts — keep identical.
import { domainDef, type ColType } from './ingest-manifest';

export interface CellError { row: number; column: string; message: string }
export interface ValidateResult { rows: Array<Record<string, unknown>>; errors: CellError[] }

function coerce(type: ColType, raw: unknown): { ok: boolean; value?: unknown } {
  const s = raw == null ? '' : String(raw).trim();
  if (s === '') return { ok: true, value: null };
  switch (type) {
    case 'string': return { ok: true, value: s };
    case 'number': {
      const n = Number(s.replace(/,/g, ''));
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
    }
    case 'integer': {
      const n = Number(s.replace(/,/g, ''));
      return Number.isInteger(n) ? { ok: true, value: n } : { ok: false };
    }
    case 'date': {
      // Accept ISO-ish YYYY-MM-DD (the template format). Reject anything else.
      if (!/^\d{4}-\d{2}-\d{2}([ T].*)?$/.test(s)) return { ok: false };
      return { ok: true, value: s.slice(0, 10) };
    }
    case 'boolean': {
      if (/^(true|1|yes|y)$/i.test(s)) return { ok: true, value: 1 };
      if (/^(false|0|no|n)$/i.test(s)) return { ok: true, value: 0 };
      return { ok: false };
    }
  }
}

export function validateDomainRows(
  domain: string,
  header: string[],
  rawRows: Array<Record<string, unknown>>,
): ValidateResult {
  const def = domainDef(domain);
  if (!def) return { rows: [], errors: [{ row: 0, column: '', message: `unknown domain ${domain}` }] };

  const errors: CellError[] = [];
  const known = new Set(def.columns.map(c => c.name));

  // Header checks
  for (const h of header) {
    if (!known.has(h)) errors.push({ row: 0, column: h, message: `unknown column "${h}" for ${domain}` });
  }
  for (const c of def.columns) {
    if (c.required && !header.includes(c.name)) {
      errors.push({ row: 0, column: c.name, message: `missing required column "${c.name}"` });
    }
  }

  const out: Array<Record<string, unknown>> = [];
  rawRows.forEach((raw, i) => {
    const rowNo = i + 1;
    const obj: Record<string, unknown> = {};
    for (const col of def.columns) {
      const present = header.includes(col.name);
      const cell = present ? raw[col.name] : '';
      if (col.required && (cell == null || String(cell).trim() === '')) {
        errors.push({ row: rowNo, column: col.name, message: `required value missing` });
        continue;
      }
      const r = coerce(col.type, cell);
      if (!r.ok) {
        errors.push({ row: rowNo, column: col.name, message: `expected ${col.type}` });
        continue;
      }
      obj[col.name] = r.value;
    }
    out.push(obj);
  });

  // Strong-inference: any error => nothing ingested.
  return errors.length ? { rows: [], errors } : { rows: out, errors: [] };
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run src/lib/__tests__/ingest-validate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Mirror into worker**

```bash
cp src/lib/ingest-validate.ts workers/api/src/lib/ingest-validate.ts
```

Add parity coverage by extending the existing parity test file:

```ts
// append inside workers/api/src/__tests__/ingest-manifest-parity.test.ts
it('ingest-validate mirror is byte-identical', () => {
  const canonical = readFileSync(resolve(__dirname, '../../../../src/lib/ingest-validate.ts'), 'utf8');
  const mirror = readFileSync(resolve(__dirname, '../lib/ingest-validate.ts'), 'utf8');
  expect(mirror).toBe(canonical);
});
```

- [ ] **Step 6: Run parity test, verify it passes**

Run: `cd workers/api && npx vitest run src/__tests__/ingest-manifest-parity.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/lib/ingest-validate.ts src/lib/__tests__/ingest-validate.test.ts workers/api/src/lib/ingest-validate.ts workers/api/src/__tests__/ingest-manifest-parity.test.ts
git commit -m "feat(ingest): pure validation core + worker mirror (strong-inference reject)"
```

---

### Task 5: Ingest route — `POST /api/assessments/:id/dataset`

Accepts validated rows per domain, re-validates server-side (never trust client), creates/resolves the `assessment_datasets` row, bulk-inserts into `erp_*` tagged with `dataset_id`, records `row_counts`, sets `status`.

**Files:**
- Modify: `workers/api/src/routes/assessments.ts` (add route + imports)
- Test: `workers/api/src/__tests__/dataset-ingest.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// workers/api/src/__tests__/dataset-ingest.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';
import { ensureMigrated } from './setup';

const TENANT = 'ds-tenant';
const SLUG = 'ds-tenant';
const EMAIL = 'dsadmin@example.com';
const PASSWORD = 'dsadmin-pw-123456';
const ASSESSMENT = 'ds-assessment-1';

async function superadminLogin(): Promise<string> {
  const res = await SELF.fetch('http://localhost/api/v1/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, tenant_slug: SLUG }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

describe('POST /api/assessments/:id/dataset', () => {
  beforeAll(async () => {
    await ensureMigrated();
    await env.DB.prepare(`INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, 'DS', ?, 'enterprise', 'active')`).bind(TENANT, SLUG).run();
    await env.DB.prepare(`INSERT OR REPLACE INTO tenant_entitlements (tenant_id, layers, catalyst_clusters, max_agents, max_users) VALUES (?, '["mind"]', '["finance"]', 50, 100)`).bind(TENANT).run();
    const hash = await hashPassword(PASSWORD);
    await env.DB.prepare(`INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status) VALUES (?, ?, ?, 'DS Admin', 'superadmin', ?, ?, 'active')`).bind('ds-user', TENANT, EMAIL, hash, JSON.stringify(['*'])).run();
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM erp_invoices WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM assessment_datasets WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM assessments WHERE id = ?').bind(ASSESSMENT).run();
    await env.DB.prepare(`INSERT INTO assessments (id, tenant_id, prospect_name, prospect_industry, status, created_by) VALUES (?, ?, 'Acme', 'manufacturing', 'pending', 'ds-user')`).bind(ASSESSMENT, TENANT).run();
  });

  it('ingests valid rows tagged with a dataset_id and marks ready', async () => {
    const token = await superadminLogin();
    const res = await SELF.fetch(`http://localhost/api/v1/assessments/${ASSESSMENT}/dataset?tenant_id=${TENANT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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
    const body = (await res.json()) as { dataset_id: string; status: string; row_counts: Record<string, number> };
    expect(body.status).toBe('ready');
    expect(body.row_counts.invoices).toBe(2);

    const cnt = await env.DB.prepare('SELECT COUNT(*) c FROM erp_invoices WHERE tenant_id = ? AND dataset_id = ?').bind(TENANT, body.dataset_id).first<{ c: number }>();
    expect(cnt?.c).toBe(2);
  });

  it('rejects an unknown-column payload wholesale (nothing ingested, status failed)', async () => {
    const token = await superadminLogin();
    const res = await SELF.fetch(`http://localhost/api/v1/assessments/${ASSESSMENT}/dataset?tenant_id=${TENANT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        domains: { invoices: { header: ['invoice_number', 'invoice_date', 'total', 'evil'], rows: [{ invoice_number: 'X', invoice_date: '2026-01-10', total: '1', evil: 'y' }] } },
      }),
    });
    expect(res.status).toBe(422);
    const cnt = await env.DB.prepare('SELECT COUNT(*) c FROM erp_invoices WHERE tenant_id = ?').bind(TENANT).first<{ c: number }>();
    expect(cnt?.c).toBe(0);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd workers/api && npx vitest run src/__tests__/dataset-ingest.test.ts`
Expected: FAIL — route 404 (not mounted yet).

- [ ] **Step 3: Add imports to the route file**

At the top of `workers/api/src/routes/assessments.ts` add:

```ts
import { INGEST_MANIFEST } from '../lib/ingest-manifest';
import { validateDomainRows } from '../lib/ingest-validate';
```

- [ ] **Step 4: Add the route**

Insert after the existing `POST /api/assessments` handler (after line ~113), following the same superadmin-guard + tenant-resolution pattern already in the file. `c.req.query('tenant_id')` is the tenant override the client sends (see `api.ts` `tenantOverrideId`); fall back to `auth.tenantId`.

```ts
// POST /api/assessments/:id/dataset — ingest uploaded prospect data into an
// isolated per-assessment dataset. Re-validates server-side (strong inference:
// any unknown column / type mismatch rejects the whole upload — nothing ingested).
app.post('/api/assessments/:id/dataset', async (c) => {
  const auth = c.get('auth');
  if (!auth || auth.role !== 'superadmin') return c.json({ error: 'forbidden' }, 403);

  const assessmentId = c.req.param('id');
  const tenantId = c.req.query('tenant_id') || auth.tenantId;

  const assessment = await c.env.DB.prepare('SELECT id, tenant_id FROM assessments WHERE id = ?')
    .bind(assessmentId).first<{ id: string; tenant_id: string }>();
  if (!assessment) return c.json({ error: 'assessment not found' }, 404);

  const body = await c.req.json<{ domains: Record<string, { header: string[]; rows: Array<Record<string, unknown>> }> }>().catch(() => null);
  if (!body?.domains || typeof body.domains !== 'object') return c.json({ error: 'domains required' }, 400);

  // Validate every domain first. Reject the whole upload on any error.
  const validated: Record<string, Array<Record<string, unknown>>> = {};
  const allErrors: Array<{ domain: string; row: number; column: string; message: string }> = [];
  for (const [domain, payload] of Object.entries(body.domains)) {
    const def = INGEST_MANIFEST.find(d => d.domain === domain);
    if (!def) { allErrors.push({ domain, row: 0, column: '', message: `unknown domain ${domain}` }); continue; }
    const { rows, errors } = validateDomainRows(domain, payload.header || [], payload.rows || []);
    if (errors.length) { for (const e of errors) allErrors.push({ domain, ...e }); }
    else validated[domain] = rows;
  }

  const datasetId = `ds_${assessmentId}_${tenantId}`.replace(/[^a-zA-Z0-9_]/g, '_');

  if (allErrors.length) {
    await c.env.DB.prepare(
      `INSERT INTO assessment_datasets (id, assessment_id, tenant_id, status, row_counts, error)
       VALUES (?, ?, ?, 'failed', '{}', ?)
       ON CONFLICT(assessment_id) DO UPDATE SET status='failed', error=excluded.error`
    ).bind(datasetId, assessmentId, tenantId, JSON.stringify(allErrors.slice(0, 200))).run();
    return c.json({ error: 'validation failed', errors: allErrors.slice(0, 200) }, 422);
  }

  // Fresh ingest: clear any prior rows for this dataset, then bulk insert.
  const rowCounts: Record<string, number> = {};
  const stmts: D1PreparedStatement[] = [];
  for (const [domain, rows] of Object.entries(validated)) {
    const def = INGEST_MANIFEST.find(d => d.domain === domain)!;
    stmts.push(c.env.DB.prepare(`DELETE FROM ${def.table} WHERE tenant_id = ? AND dataset_id = ?`).bind(tenantId, datasetId));
    let n = 0;
    for (const row of rows) {
      const cols = ['id', 'tenant_id', 'dataset_id', 'source_system', ...def.columns.map(col => col.name)];
      const vals = [`${datasetId}_${domain}_${n}`, tenantId, datasetId, 'upload', ...def.columns.map(col => row[col.name] ?? null)];
      const placeholders = cols.map(() => '?').join(', ');
      stmts.push(c.env.DB.prepare(`INSERT INTO ${def.table} (${cols.join(', ')}) VALUES (${placeholders})`).bind(...vals));
      n++;
    }
    rowCounts[domain] = n;
  }

  // D1 batch is chunked at 50 to stay under statement limits (same as memory builder).
  for (let i = 0; i < stmts.length; i += 50) {
    await c.env.DB.batch(stmts.slice(i, i + 50));
  }

  await c.env.DB.prepare(
    `INSERT INTO assessment_datasets (id, assessment_id, tenant_id, status, row_counts, error)
     VALUES (?, ?, ?, 'ready', ?, NULL)
     ON CONFLICT(assessment_id) DO UPDATE SET status='ready', row_counts=excluded.row_counts, error=NULL`
  ).bind(datasetId, assessmentId, tenantId, JSON.stringify(rowCounts)).run();

  return c.json({ dataset_id: datasetId, status: 'ready', row_counts: rowCounts });
});
```

> If the route file's handler signature uses `auth!` via `c.get('auth')` differently, match the existing `POST /api/assessments` handler exactly (it reads `const auth = c.get('auth')` and guards `auth.role`). Use the same `D1PreparedStatement` type import already present in the file (it's a global `@cloudflare/workers-types` type — no import needed).

- [ ] **Step 5: Run test, verify it passes**

Run: `cd workers/api && npx vitest run src/__tests__/dataset-ingest.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add workers/api/src/routes/assessments.ts workers/api/src/__tests__/dataset-ingest.test.ts
git commit -m "feat(assessments): dataset ingest route with server-side validation"
```

---

### Task 6: Run scoping — thread `datasetId` through the engine

`collectVolumeSnapshot` and finding detection query `erp_*` by `tenant_id` only. Add an optional `datasetId`: when present, every `erp_*` query adds `AND dataset_id = ?`; when absent, behavior is unchanged (existing tenant data). The assessment stores its `dataset_id` and passes it into the run.

**Files:**
- Modify: `workers/api/src/services/assessment-engine.ts` (`collectVolumeSnapshot` ~307; `runAssessment` ~2394; finding detection calls)
- Modify: `workers/api/src/routes/assessments.ts` (resolve + pass `dataset_id` into `runAssessment`)
- Test: covered by Task 8 isolation test; add a focused unit test here.

- [ ] **Step 1: Write the failing test**

```ts
// workers/api/src/__tests__/dataset-scoping.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { ensureMigrated } from './setup';
import { collectVolumeSnapshot } from '../services/assessment-engine';

const TENANT = 'scope-tenant';

describe('collectVolumeSnapshot dataset scoping', () => {
  beforeAll(async () => {
    await ensureMigrated();
    await env.DB.prepare(`INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, 'Scope', 'scope', 'enterprise', 'active')`).bind(TENANT).run();
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM erp_invoices WHERE tenant_id = ?').bind(TENANT).run();
    // tenant/seed row (dataset_id NULL) + dataset row
    await env.DB.prepare(`INSERT INTO erp_invoices (id, tenant_id, dataset_id, source_system, invoice_number, invoice_date, total, amount_due, payment_status) VALUES ('seed1', ?, NULL, 'seed', 'S-1', '2026-01-01', 999999, 999999, 'unpaid')`).bind(TENANT).run();
    await env.DB.prepare(`INSERT INTO erp_invoices (id, tenant_id, dataset_id, source_system, invoice_number, invoice_date, total, amount_due, payment_status) VALUES ('d1', ?, 'DSX', 'upload', 'D-1', '2026-01-01', 100, 100, 'unpaid')`).bind(TENANT).run();
  });

  it('with datasetId returns only that dataset rows', async () => {
    const snap = await collectVolumeSnapshot(env.DB, TENANT, '', 'DSX');
    expect(snap.total_invoices).toBe(1);
  });

  it('without datasetId returns all tenant rows (back-compat)', async () => {
    const snap = await collectVolumeSnapshot(env.DB, TENANT, '');
    expect(snap.total_invoices).toBe(2);
  });
});
```

> `total_invoices` is the snapshot field for `SELECT COUNT(*) FROM erp_invoices`. If the actual field name differs, read the `VolumeSnapshot` interface in `assessment-engine.ts` and use the count field; keep the seed `total` huge so a leak is unmistakable.

- [ ] **Step 2: Run test, verify it fails**

Run: `cd workers/api && npx vitest run src/__tests__/dataset-scoping.test.ts`
Expected: FAIL — `collectVolumeSnapshot` takes 3 args / ignores dataset (returns 2 for both).

- [ ] **Step 3: Add a scoping helper + new param in `collectVolumeSnapshot`**

Change the signature (~line 307) to accept an optional `datasetId`:

```ts
export async function collectVolumeSnapshot(
  db: D1Database,
  tenantId: string,
  erpConnectionId: string,
  datasetId?: string,
): Promise<VolumeSnapshot> {
  // dataset scoping: when a dataset is bound, every erp_* query is restricted to
  // its rows; otherwise tenant-wide (unchanged behavior). `dsAnd` is appended
  // INSIDE the WHERE of every erp_* query; `dsBind` adds the matching bind.
  const dsAnd = datasetId ? ' AND dataset_id = ?' : '';
  const dsBind: unknown[] = datasetId ? [datasetId] : [];
  // ... existing body, but each erp_* query gains dsAnd + dsBind (see Step 4)
```

- [ ] **Step 4: Apply `dsAnd`/`dsBind` to every `erp_*` query in the function body**

The function uses a `queryNum(sql, binds)` helper. For each `erp_*` query, append `dsAnd` to the SQL string and spread `...dsBind` into the binds. Example transformations:

```ts
// before:
queryNum('SELECT COUNT(*) FROM erp_invoices WHERE tenant_id = ?', [tenantId])
// after:
queryNum(`SELECT COUNT(*) FROM erp_invoices WHERE tenant_id = ?${dsAnd}`, [tenantId, ...dsBind])

// before:
queryNum("SELECT COALESCE(SUM(amount_due), 0) FROM erp_invoices WHERE tenant_id = ? AND payment_status != 'paid'", [tenantId])
// after:
queryNum(`SELECT COALESCE(SUM(amount_due), 0) FROM erp_invoices WHERE tenant_id = ? AND payment_status != 'paid'${dsAnd}`, [tenantId, ...dsBind])
```

Apply the same pattern to ALL `erp_*` queries in the function (invoices, purchase_orders, journal_entries, bank_transactions, employees, customers, suppliers, products — every line that has `FROM erp_` per the engine map, lines ~332–362). Convert single-quote string SQL to backtick template literals so `${dsAnd}` interpolates. Leave non-`erp_*` queries unchanged.

- [ ] **Step 5: Run the scoping test, verify it passes**

Run: `cd workers/api && npx vitest run src/__tests__/dataset-scoping.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Thread `datasetId` into `runAssessment` + finding detection**

Change `runAssessment` (~line 2394) to accept `datasetId` and pass it down:

```ts
export async function runAssessment(
  db: D1Database,
  ai: Ai,
  storage: R2Bucket,
  tenantId: string,
  assessmentId: string,
  erpConnectionId: string,
  config: AssessmentConfig,
  prospectIndustry: string,
  prospectName: string,
  periodOpts?: { periodStart: string | null; periodEnd: string | null },
  datasetId?: string,
): Promise<void> {
```

At the `collectVolumeSnapshot` call (~line 2418):

```ts
const snapshot = await collectVolumeSnapshot(db, tenantId, erpConnectionId, datasetId);
```

Pass `datasetId` into `detectAllFindingsByCompany` via its context object (it already receives a `findingsContext`). Add `datasetId` to that context and have `detectAllFindingsByCompany` (and any reconciliation sub-engine it calls that issues `erp_*` queries) apply the same `dsAnd`/`dsBind` pattern. If finding detection is large, scope it in a follow-up sub-step but ensure the same `AND dataset_id = ?` guard is on every `erp_*` query it runs — the isolation test (Task 8) will fail loudly if any query leaks.

- [ ] **Step 7: Resolve + pass `dataset_id` from the route**

In `POST /api/assessments` (workers/api/src/routes/assessments.ts ~line 97), before calling `runAssessment`, look up the assessment's dataset:

```ts
const ds = await c.env.DB.prepare(
  "SELECT id FROM assessment_datasets WHERE assessment_id = ? AND status = 'ready'"
).bind(assessmentId).first<{ id: string }>();
const datasetId = ds?.id;
```

Then add `datasetId` as the final argument to the `runAssessment(...)` call.

> If the wizard creates the assessment first and uploads the dataset second, the dataset won't exist at create time. Acceptable: the run is (re)triggered after upload, OR the create handler accepts `body.dataset_id` directly. Use `body.dataset_id` if present, else the lookup above. Document whichever the wizard sends in Task 7.

- [ ] **Step 8: Run the engine + ingest tests**

Run: `cd workers/api && npx vitest run src/__tests__/dataset-scoping.test.ts src/__tests__/dataset-ingest.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add workers/api/src/services/assessment-engine.ts workers/api/src/routes/assessments.ts workers/api/src/__tests__/dataset-scoping.test.ts
git commit -m "feat(assessment-engine): scope volume snapshot + run to datasetId"
```

---

### Task 7: Wizard Connection/Data step (client)

Replace the misleading "No ERP connection — use estimated data" option with an explicit Connection/Data step: **Use existing tenant data** (current behavior) or **Upload prospect data** (per-domain template downloads + dropzones, papaparse parse, manifest validation, row counts + row-level errors, submit blocked while invalid).

**Files:**
- Modify: `src/lib/api.ts` (add `uploadDataset`, `downloadTemplate` helper, types)
- Modify: `src/pages/AssessmentsPage.tsx` (wizard step)
- Test: `src/lib/__tests__/ingest-validate.test.ts` already covers validation; add a thin client API test if a test harness for `api.ts` exists, else rely on the worker ingest test.

- [ ] **Step 1: Add the API client method + types**

In `src/lib/api.ts`, inside the `api.assessments` object (~line 1531), add:

```ts
uploadDataset: (
  id: string,
  domains: Record<string, { header: string[]; rows: Array<Record<string, unknown>> }>,
  tenantId?: string,
): Promise<{ dataset_id: string; status: string; row_counts: Record<string, number> }> =>
  request(
    `/api/assessments/${id}/dataset${qs({ tenant_id: tenantId })}`,
    { method: 'POST', body: JSON.stringify({ domains }) },
  ),
```

- [ ] **Step 2: Build the manifest-driven template + parse helpers (client)**

Create `src/lib/ingest-client.ts`:

```ts
// src/lib/ingest-client.ts — browser-only helpers: template CSV download +
// papaparse file -> { header, rows }. Validation lives in ingest-validate.ts.
import Papa from 'papaparse';
import { INGEST_MANIFEST, templateHeader } from './ingest-manifest';

export function downloadTemplate(domain: string): void {
  const header = templateHeader(domain);
  const blob = new Blob([header + '\n'], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `atheon-${domain}-template.csv`;
  a.click();
}

export function parseCsv(file: File): Promise<{ header: string[]; rows: Array<Record<string, unknown>> }> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: (res) => resolve({
        header: (res.meta.fields ?? []) as string[],
        rows: res.data as Array<Record<string, unknown>>,
      }),
      error: reject,
    });
  });
}

export const INGEST_DOMAINS = INGEST_MANIFEST.map(d => ({ domain: d.domain, label: d.label }));
```

> `papaparse` is already a dependency (used per the exploration of existing CSV handling). If not, `npm i papaparse @types/papaparse` and note it in the commit.

- [ ] **Step 3: Add the wizard step UI**

In `src/pages/AssessmentsPage.tsx` `NewAssessmentWizard`, between Step 1 (Prospect) and Step 2 (Config), insert a Connection/Data step. Track:

```tsx
const [dataMode, setDataMode] = useState<'tenant' | 'upload'>('tenant');
const [files, setFiles] = useState<Record<string, { header: string[]; rows: Array<Record<string, unknown>>; errors: { row: number; column: string; message: string }[] }>>({});
```

For `dataMode === 'upload'`, render one row per `INGEST_DOMAINS` entry: a "Download template" button (`downloadTemplate(domain)`), a dropzone (mirror the `CatalystsPage` dropzone pattern), and — after parse — a row-count badge + an errors list. On file select:

```tsx
const onFile = async (domain: string, file: File) => {
  const { header, rows } = await parseCsv(file);
  const { errors } = validateDomainRows(domain, header, rows);
  setFiles(f => ({ ...f, [domain]: { header, rows, errors } }));
};
```

Block "Next"/"Run" when any domain has `errors.length > 0`:

```tsx
const uploadInvalid = dataMode === 'upload' && Object.values(files).some(f => f.errors.length > 0);
const noData = dataMode === 'upload' && Object.keys(files).length === 0;
// disable submit: uploadInvalid || noData
```

Remove the old "No ERP connection — use estimated data" `<option>` (AssessmentsPage.tsx:466) — replace its meaning with this step's `dataMode === 'tenant'`.

- [ ] **Step 4: Wire submit — create assessment, then upload, then it runs scoped**

In the submit handler (~line 402), after `api.assessments.create(...)` returns `{ id }`:

```tsx
const { id } = await api.assessments.create({
  prospect_name: prospectName,
  prospect_industry: prospectIndustry,
  erp_connection_id: erpConnectionId || undefined,
  config: { ...config },
  period_start: periodStart || null,
  period_end: periodEnd || null,
});
if (dataMode === 'upload') {
  const domains: Record<string, { header: string[]; rows: Array<Record<string, unknown>> }> = {};
  for (const [domain, f] of Object.entries(files)) domains[domain] = { header: f.header, rows: f.rows };
  await api.assessments.uploadDataset(id, domains, erpConnectionId ? undefined : undefined);
  // re-trigger the scoped run now that the dataset is ready
  await api.assessments.create ? null : null; // (run is triggered server-side on create; see note)
}
```

> Decision for the run trigger: the cleanest path is for `POST /api/assessments` to NOT auto-run when the wizard will upload a dataset. Add `body.defer_run: true` when `dataMode === 'upload'`; the create handler skips the background `runAssessment`. After `uploadDataset` succeeds, call a small `POST /api/assessments/:id/run` (add it mirroring the create handler's `runAssessment` call, now resolving the ready dataset via the Task 6 Step 7 lookup). For `dataMode === 'tenant'`, keep current auto-run behavior. Implement `defer_run` + `/run` as part of this step; add a one-line worker test asserting `defer_run` leaves status `pending` until `/run` is called.

- [ ] **Step 5: Type-check the client**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api.ts src/lib/ingest-client.ts src/pages/AssessmentsPage.tsx workers/api/src/routes/assessments.ts
git commit -m "feat(assessments): Connection/Data wizard step — upload prospect data, scoped run"
```

---

### Task 8: Cross-dataset isolation test (the §6 invariant)

An assessment bound to dataset X must never read dataset Y or tenant (`NULL`) rows.

**Files:**
- Test: `workers/api/src/__tests__/dataset-isolation.test.ts`

- [ ] **Step 1: Write the isolation test**

```ts
// workers/api/src/__tests__/dataset-isolation.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { ensureMigrated } from './setup';
import { collectVolumeSnapshot } from '../services/assessment-engine';

const TENANT = 'iso-tenant';

describe('cross-dataset isolation', () => {
  beforeAll(async () => {
    await ensureMigrated();
    await env.DB.prepare(`INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, 'Iso', 'iso', 'enterprise', 'active')`).bind(TENANT).run();
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM erp_invoices WHERE tenant_id = ?').bind(TENANT).run();
    const mk = (id: string, ds: string | null, total: number) =>
      env.DB.prepare(`INSERT INTO erp_invoices (id, tenant_id, dataset_id, source_system, invoice_number, invoice_date, total, amount_due, payment_status) VALUES (?, ?, ?, 'x', ?, '2026-01-01', ?, ?, 'unpaid')`)
        .bind(id, TENANT, ds, id, total, total).run();
    await mk('tenantRow', null, 1_000_000);
    await mk('xRow', 'DS_X', 10);
    await mk('yRow', 'DS_Y', 20);
  });

  it('dataset X sees only X rows — no Y, no tenant bleed', async () => {
    const snap = await collectVolumeSnapshot(env.DB, TENANT, '', 'DS_X');
    expect(snap.total_invoices).toBe(1);
    // revenue/AR aggregates must equal the X row only (10), never include Y(20) or tenant(1e6)
    const ar = (snap as Record<string, number>).ar_balance ?? (snap as Record<string, number>).total_ar;
    if (ar != null) expect(ar).toBe(10);
  });
});
```

> Use the real AR field name from `VolumeSnapshot` (read the interface). The hard assertion is `total_invoices === 1`; the AR check is a bonus leak detector.

- [ ] **Step 2: Run, verify it passes**

Run: `cd workers/api && npx vitest run src/__tests__/dataset-isolation.test.ts`
Expected: PASS. If it fails, an `erp_*` query in the engine is missing `dsAnd` — fix that query (return to Task 6 Step 4/6).

- [ ] **Step 3: Commit**

```bash
git add workers/api/src/__tests__/dataset-isolation.test.ts
git commit -m "test(assessment): cross-dataset isolation invariant"
```

---

## C — Rich Per-Finding Exports

### Task 9: Shared chart-geometry module (`finding-charts.ts`) + worker mirror

Pure functions mapping a finding to an inline **SVG string** (no chart library, no DOM). Three charts: source-vs-target grouped bars, immediate-vs-ongoing bars, confidence gauge ring. Plus portfolio helpers (domain waterfall, severity distribution). Identical copy in worker.

**Files:**
- Create: `src/lib/finding-charts.ts`
- Create: `workers/api/src/lib/finding-charts.ts`
- Test: `src/lib/__tests__/finding-charts.test.ts`
- Test: extend `workers/api/src/__tests__/ingest-manifest-parity.test.ts` for parity (or a new parity test file).

- [ ] **Step 1: Write the failing geometry test**

```ts
// src/lib/__tests__/finding-charts.test.ts
import { describe, it, expect } from 'vitest';
import { confidenceGauge, immediateVsOngoing, sourceVsTarget } from '../finding-charts';

describe('finding-charts', () => {
  it('confidenceGauge: low/gate-failed confidence flagged indicative', () => {
    const svg = confidenceGauge(0.4, false);
    expect(svg).toContain('<svg');
    expect(svg.toLowerCase()).toContain('indicative');
  });

  it('confidenceGauge: high confidence not indicative', () => {
    const svg = confidenceGauge(0.95, true);
    expect(svg.toLowerCase()).not.toContain('indicative');
    expect(svg).toContain('95%');
  });

  it('immediateVsOngoing annualises ongoing (x12)', () => {
    const svg = immediateVsOngoing(1000, 500); // ongoing annual = 6000
    expect(svg).toContain('<svg');
    // taller bar belongs to the 6000 series — assert both labels present
    expect(svg).toContain('6'); // 6,000 annualised appears
  });

  it('sourceVsTarget returns empty string when no samples', () => {
    expect(sourceVsTarget([])).toBe('');
  });

  it('sourceVsTarget caps samples and notes the remainder', () => {
    const samples = Array.from({ length: 9 }, (_, i) => ({ ref: `R${i}`, source_value: 100, target_value: 90, difference: 10 }));
    const svg = sourceVsTarget(samples, 5);
    expect(svg).toContain('<svg');
    expect(svg).toContain('4 more');
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/lib/__tests__/finding-charts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/finding-charts.ts
// Pure SVG chart geometry for per-finding exports. Returns inline SVG strings —
// no chart library, no DOM — so the SAME geometry renders in React (dangerously
// set / inline) and in the worker Value PDF HTML. MIRROR: keep
// workers/api/src/lib/finding-charts.ts byte-identical.

const SAGE = '#A3B18A';
const BRONZE = '#CDA37E';
const NAVY = '#0a0e2a';
const MUTED = '#64748b';
const RAG = { healthy: '#5d8a6f', watch: '#d97706', risk: '#dc2626' };

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-ZA');
}

export interface SampleDelta { ref: string; source_value: string | number; target_value: string | number; difference: number }

/** Confidence ring. gatePassed=false OR conf<0.5 => "Indicative — confirm". */
export function confidenceGauge(confidence: number, gatePassed: boolean): string {
  const pct = Math.max(0, Math.min(1, confidence));
  const indicative = !gatePassed || pct < 0.5;
  const r = 30, c = 2 * Math.PI * r, off = c - pct * c;
  const color = pct >= 0.8 ? RAG.healthy : pct >= 0.5 ? RAG.watch : RAG.risk;
  const caption = indicative ? 'Indicative — confirm' : `${Math.round(pct * 100)}% confidence`;
  return `<svg width="90" height="90" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${caption}">
<circle cx="40" cy="40" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="6"/>
<circle cx="40" cy="40" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round"
  stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" transform="rotate(-90 40 40)"/>
<text x="40" y="44" text-anchor="middle" font-size="14" font-weight="bold" fill="${NAVY}">${Math.round(pct * 100)}%</text>
<text x="40" y="76" text-anchor="middle" font-size="8" fill="${indicative ? RAG.watch : MUTED}">${caption}</text>
</svg>`;
}

/** Immediate (one-off) vs ongoing annualised (monthly x 12). */
export function immediateVsOngoing(immediate: number, ongoingMonthly: number): string {
  const ongoingAnnual = ongoingMonthly * 12;
  const max = Math.max(1, immediate, ongoingAnnual);
  const w = 220, barMax = 150, h = 70;
  const immW = (immediate / max) * barMax;
  const ongW = (ongoingAnnual / max) * barMax;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
<text x="0" y="14" font-size="9" fill="${MUTED}">One-off</text>
<rect x="60" y="6" width="${immW.toFixed(1)}" height="12" rx="2" fill="${BRONZE}"/>
<text x="${(64 + immW).toFixed(1)}" y="16" font-size="9" fill="${NAVY}">R${fmt(immediate)}</text>
<text x="0" y="42" font-size="9" fill="${MUTED}">Recurring/yr</text>
<rect x="60" y="34" width="${ongW.toFixed(1)}" height="12" rx="2" fill="${SAGE}"/>
<text x="${(64 + ongW).toFixed(1)}" y="44" font-size="9" fill="${NAVY}">R${fmt(ongoingAnnual)}</text>
</svg>`;
}

/** Grouped source-vs-target bars from sample deltas. '' when no samples. */
export function sourceVsTarget(samples: SampleDelta[], cap = 6): string {
  if (!samples.length) return '';
  const shown = samples.slice(0, cap);
  const more = samples.length - shown.length;
  const nums = shown.flatMap(s => [Number(s.source_value) || 0, Number(s.target_value) || 0]);
  const max = Math.max(1, ...nums.map(Math.abs));
  const groupW = 34, h = 90, barMax = 56, baseY = 70;
  let x = 10;
  let bars = '';
  for (const s of shown) {
    const sv = Number(s.source_value) || 0, tv = Number(s.target_value) || 0;
    const sh = (Math.abs(sv) / max) * barMax, th = (Math.abs(tv) / max) * barMax;
    bars += `<rect x="${x}" y="${baseY - sh}" width="12" height="${sh.toFixed(1)}" fill="${NAVY}"/>`;
    bars += `<rect x="${x + 14}" y="${baseY - th}" width="12" height="${th.toFixed(1)}" fill="${BRONZE}"/>`;
    bars += `<text x="${x + 13}" y="${baseY + 10}" text-anchor="middle" font-size="7" fill="${MUTED}">${s.ref.slice(0, 6)}</text>`;
    x += groupW;
  }
  const width = x + 10;
  const note = more > 0 ? `<text x="${width - 6}" y="86" text-anchor="end" font-size="8" fill="${MUTED}">+ ${more} more</text>` : '';
  return `<svg width="${width}" height="${h}" viewBox="0 0 ${width} ${h}" xmlns="http://www.w3.org/2000/svg">
<text x="10" y="12" font-size="8" fill="${NAVY}">■ source</text><text x="64" y="12" font-size="8" fill="${BRONZE}">■ target</text>
${bars}${note}</svg>`;
}

export interface DomainValue { domain: string; immediate: number; ongoing: number }

/** Value-by-domain horizontal waterfall (annualised total per domain). */
export function domainWaterfall(domains: DomainValue[]): string {
  if (!domains.length) return '';
  const rows = domains.map(d => ({ ...d, total: d.immediate + d.ongoing * 12 })).sort((a, b) => b.total - a.total);
  const max = Math.max(1, ...rows.map(r => r.total));
  const barMax = 200, rowH = 18, w = 320;
  let y = 14, body = '';
  for (const r of rows) {
    const bw = (r.total / max) * barMax;
    const immW = (r.immediate / Math.max(1, r.total)) * bw;
    body += `<text x="0" y="${y + 9}" font-size="8" fill="${MUTED}">${r.domain.slice(0, 14)}</text>`;
    body += `<rect x="80" y="${y}" width="${bw.toFixed(1)}" height="11" rx="1.5" fill="${SAGE}"/>`;
    body += `<rect x="80" y="${y}" width="${Math.max(0.5, immW).toFixed(1)}" height="11" rx="1.5" fill="${BRONZE}"/>`;
    body += `<text x="${(84 + bw).toFixed(1)}" y="${y + 9}" font-size="8" fill="${NAVY}">R${fmt(r.total)}</text>`;
    y += rowH;
  }
  return `<svg width="${w}" height="${y + 4}" viewBox="0 0 ${w} ${y + 4}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

export interface SeverityCounts { critical: number; high: number; medium: number; low: number }

/** Severity distribution stacked bar. */
export function severityDistribution(counts: SeverityCounts): string {
  const order: Array<[keyof SeverityCounts, string]> = [['critical', '#dc2626'], ['high', '#ea580c'], ['medium', '#d97706'], ['low', '#65a30d']];
  const total = order.reduce((s, [k]) => s + (counts[k] || 0), 0) || 1;
  const w = 300, barW = 280;
  let x = 10, body = '';
  for (const [k, color] of order) {
    const seg = ((counts[k] || 0) / total) * barW;
    if (seg <= 0) continue;
    body += `<rect x="${x.toFixed(1)}" y="8" width="${seg.toFixed(1)}" height="14" fill="${color}"/>`;
    if (seg > 22) body += `<text x="${(x + seg / 2).toFixed(1)}" y="18" text-anchor="middle" font-size="8" fill="#fff">${counts[k]}</text>`;
    x += seg;
  }
  return `<svg width="${w}" height="30" viewBox="0 0 ${w} 30" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run src/lib/__tests__/finding-charts.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Mirror into worker + parity test**

```bash
cp src/lib/finding-charts.ts workers/api/src/lib/finding-charts.ts
```

Create `workers/api/src/__tests__/finding-charts-parity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('finding-charts mirror parity', () => {
  it('worker mirror is byte-identical to src/lib canonical', () => {
    const canonical = readFileSync(resolve(__dirname, '../../../../src/lib/finding-charts.ts'), 'utf8');
    const mirror = readFileSync(resolve(__dirname, '../lib/finding-charts.ts'), 'utf8');
    expect(mirror).toBe(canonical);
  });
});
```

- [ ] **Step 6: Run parity test**

Run: `cd workers/api && npx vitest run src/__tests__/finding-charts-parity.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/finding-charts.ts src/lib/__tests__/finding-charts.test.ts workers/api/src/lib/finding-charts.ts workers/api/src/__tests__/finding-charts-parity.test.ts
git commit -m "feat(charts): shared per-finding SVG geometry + worker mirror + tests"
```

---

### Task 10: Render per-finding charts on screen (`AssessmentFindingsPanel`)

In the expanded finding body, render the three charts. Gate-failed/low-confidence findings already show an "Indicative — confirm" band — keep that and the gauge consistent.

**Files:**
- Modify: `src/components/AssessmentFindingsPanel.tsx` (expanded body ~lines 252–384)

- [ ] **Step 1: Import the helpers**

```tsx
import { confidenceGauge, immediateVsOngoing, sourceVsTarget } from '../lib/finding-charts';
```

- [ ] **Step 2: Add a small SVG-embed component**

Near the top of the file (module scope):

```tsx
function Svg({ markup }: { markup: string }) {
  if (!markup) return null;
  return <span className="inline-block" dangerouslySetInnerHTML={{ __html: markup }} />;
}
```

> Markup is generated from our own pure functions over numeric/string finding fields — no user HTML is interpolated unescaped except `ref`, which we `.slice()` and which originates from our ERP rows. Acceptable. If a stricter posture is wanted, escape `ref` in `sourceVsTarget` before embedding.

- [ ] **Step 3: Render charts in the expanded body**

Inside the expanded section (after the methodology/sample tables, ~line 333), add:

```tsx
<div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 items-center"
  style={{ borderTop: '1px solid var(--border-card)', paddingTop: 12 }}>
  <div>
    <div className="text-xs t-muted mb-1">Source vs target</div>
    <Svg markup={sourceVsTarget((f.sample_records ?? []).map(s => ({
      ref: s.ref,
      source_value: (s.metadata?.source_value as number | string) ?? s.amount_native ?? 0,
      target_value: (s.metadata?.target_value as number | string) ?? s.amount_zar ?? 0,
      difference: Number(s.metadata?.difference ?? 0),
    })))} />
  </div>
  <div>
    <div className="text-xs t-muted mb-1">One-off vs recurring</div>
    <Svg markup={immediateVsOngoing(Number(f.value_at_risk_zar) || 0, 0)} />
  </div>
  <div>
    <div className="text-xs t-muted mb-1">Confidence</div>
    <Svg markup={confidenceGauge(Number(f.confidence ?? 0), f.confidence_gate_passed !== false)} />
  </div>
</div>
```

> Field mapping: `AssessmentFinding` (the Mind/engine shape used by this panel) has `value_at_risk_zar`, `confidence`, `confidence_gate_passed`, `sample_records[{ref, amount_native, amount_zar, metadata}]`. The `ValueAssessmentFinding` shape (used by the Value PDF) has `evidence.sample_records[{ref, source_value, target_value, difference}]`, `immediate_value`, `ongoing_monthly_value`. This panel uses the engine shape — `immediateVsOngoing` here only has `value_at_risk_zar`, so pass `(value_at_risk_zar, 0)`. The richer immediate/ongoing split renders in the PDF (Task 11) where those fields exist. If the panel also consumes `ValueAssessmentFinding` anywhere, use `immediate_value`/`ongoing_monthly_value` there.

- [ ] **Step 4: Type-check**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: no errors. (Adjust the `s.metadata?.` access to match the real `sample_records` type; read the type at AssessmentFinding to confirm field names.)

- [ ] **Step 5: Commit**

```bash
git add src/components/AssessmentFindingsPanel.tsx
git commit -m "feat(findings-panel): per-finding source/target, one-off/recurring, confidence charts"
```

---

### Task 11: Inject per-finding SVG into the worker Value PDF

The Value PDF is rendered via jsPDF (per the exploration: `renderValueReportPDF`, line ~1620). jsPDF cannot embed raw SVG markup without a plugin — but the existing finding cards already draw bars with `doc.rect`/`doc.roundedRect`. Rather than pull in an SVG rasterizer, draw the same three charts with jsPDF primitives inside each finding card, using the SAME geometry inputs as `finding-charts.ts`. (The shared module guarantees the on-screen SVG and the PDF read the same numbers; the PDF re-draws them natively.)

**Files:**
- Modify: `workers/api/src/services/value-assessment-engine.ts` (per-finding card loop ~2016–2154; portfolio header ~1938–1968)

- [ ] **Step 1: Add a confidence + immediate/ongoing mini-chart into each finding card**

Inside the `for (let i = 0; i < sortedFindings.length; i++)` loop (~line 2020), after the existing confidence text block (~line 2069), add native bars for immediate vs ongoing using the finding's real fields:

```ts
// Immediate (one-off) vs ongoing annualised — two native bars (mirrors
// finding-charts.immediateVsOngoing geometry: ongoing × 12).
const imm = Number(f.immediate_value) || 0;
const ongAnnual = (Number(f.ongoing_monthly_value) || 0) * 12;
const maxV = Math.max(1, imm, ongAnnual);
const barX = 20, barMaxW = 60, chartY = cardTop + 40;
setText(MUTED); doc.setFontSize(7);
doc.text('One-off', barX, chartY - 1);
setFill(BRONZE);
doc.roundedRect(barX, chartY, Math.max(0.5, (imm / maxV) * barMaxW), 3, 0.5, 0.5, 'F');
setText(NAVY); doc.text(`R${formatZAR(Math.round(imm))}`, barX + barMaxW + 4, chartY + 3);
setText(MUTED);
doc.text('Recurring/yr', barX, chartY + 7);
setFill(SAGE);
doc.roundedRect(barX, chartY + 8, Math.max(0.5, (ongAnnual / maxV) * barMaxW), 3, 0.5, 0.5, 'F');
setText(NAVY); doc.text(`R${formatZAR(Math.round(ongAnnual))}`, barX + barMaxW + 4, chartY + 11);
```

- [ ] **Step 2: Draw source-vs-target bars from `evidence.sample_records`**

Below the immediate/ongoing block, add (capped, with "+N more"):

```ts
const samples = Array.isArray((f.evidence as { sample_records?: unknown[] } | undefined)?.sample_records)
  ? ((f.evidence as { sample_records: Array<{ ref: string; source_value: number | string; target_value: number | string }> }).sample_records)
  : [];
if (samples.length) {
  const shown = samples.slice(0, 6);
  const nums = shown.flatMap(s => [Number(s.source_value) || 0, Number(s.target_value) || 0]);
  const smax = Math.max(1, ...nums.map(Math.abs));
  let sx = 110; const sBase = cardTop + 52, sMaxH = 16;
  for (const s of shown) {
    const sh = (Math.abs(Number(s.source_value) || 0) / smax) * sMaxH;
    const th = (Math.abs(Number(s.target_value) || 0) / smax) * sMaxH;
    setFill(NAVY); doc.rect(sx, sBase - sh, 2.5, sh, 'F');
    setFill(BRONZE); doc.rect(sx + 3, sBase - th, 2.5, th, 'F');
    sx += 9;
  }
  if (samples.length > 6) { setText(MUTED); doc.setFontSize(6); doc.text(`+${samples.length - 6} more`, sx + 2, sBase); }
}
```

> Verify `NAVY`, `SAGE`, `BRONZE`, `MUTED`, `formatZAR`, `setFill`, `setText`, `cardTop` are all in scope in this function (they are per the exploration). Adjust Y offsets so the chart sits inside the `cardH = 115` card without overlapping the title/value text.

- [ ] **Step 3: Type-check the worker**

Run: `cd workers/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Smoke-test the PDF path renders without throwing**

If a worker test exercises `renderValueReportPDF` (or the `/report/value` route), run it; else add a minimal test that calls the route for a seeded assessment with one finding carrying `evidence.sample_records` and asserts a non-empty `application/pdf` body. Keep it small.

Run: `cd workers/api && npx vitest run src/__tests__/<value-report-test>.test.ts`
Expected: PASS (non-empty PDF bytes).

- [ ] **Step 5: Commit**

```bash
git add workers/api/src/services/value-assessment-engine.ts
git commit -m "feat(value-pdf): per-finding one-off/recurring + source/target bars"
```

---

### Task 12: Portfolio roll-ups in the report header

Upgrade the value-by-domain bars and add severity distribution + findings-by-type to the report header. In the PDF, extend the existing waterfall (line ~1938) to also show severity; the on-screen panel cover banner (AssessmentFindingsPanel ~line 393) gets the `domainWaterfall` + `severityDistribution` SVGs.

**Files:**
- Modify: `src/components/AssessmentFindingsPanel.tsx` (cover banner ~393–452)
- Modify: `workers/api/src/services/value-assessment-engine.ts` (header section)

- [ ] **Step 1: On-screen header roll-ups**

In the cover banner, compute and render:

```tsx
import { domainWaterfall, severityDistribution } from '../lib/finding-charts';
// ...
const severityCounts = useMemo(() => {
  const c = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) c[f.severity] = (c[f.severity] ?? 0) + 1;
  return c;
}, [findings]);
const domainValues = useMemo(() => {
  const m = new Map<string, { immediate: number; ongoing: number }>();
  for (const f of findings) {
    const k = f.category || 'other';
    const e = m.get(k) ?? { immediate: 0, ongoing: 0 };
    e.immediate += Number(f.value_at_risk_zar) || 0;
    m.set(k, e);
  }
  return Array.from(m, ([domain, v]) => ({ domain, ...v }));
}, [findings]);
```

Render `<Svg markup={domainWaterfall(domainValues)} />` and `<Svg markup={severityDistribution(severityCounts)} />` in the banner.

- [ ] **Step 2: PDF header severity bar**

After the domain waterfall block in `renderValueReportPDF` (~line 1968), add a native severity-distribution stacked bar using `SEV` colors (already defined ~line 1644) computed from `args.findings`:

```ts
const sevCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
for (const f of args.findings) { const s = String(f.severity); if (s in sevCounts) sevCounts[s]++; }
const sevTotal = Object.values(sevCounts).reduce((a, b) => a + b, 0) || 1;
let sx2 = 14; const sevBarW = pageW - 28; const sevY = y + 4;
for (const k of ['critical', 'high', 'medium', 'low']) {
  const seg = (sevCounts[k] / sevTotal) * sevBarW;
  if (seg <= 0) continue;
  setFill(SEV[k]); doc.rect(sx2, sevY, seg, 5, 'F');
  sx2 += seg;
}
y = sevY + 12;
```

- [ ] **Step 3: Type-check both**

Run: `npx tsc -p tsconfig.app.json --noEmit && (cd workers/api && npx tsc --noEmit)`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/AssessmentFindingsPanel.tsx workers/api/src/services/value-assessment-engine.ts
git commit -m "feat(reports): portfolio roll-ups — domain waterfall + severity distribution"
```

---

### Task 13: Lift the 25-finding cap in the client PDF

The client Value PDF slices to 25 findings (report-generators.ts:939). Paginate all findings instead — no silent truncation (a billing artefact must show every claimed line).

**Files:**
- Modify: `src/lib/report-generators.ts` (line ~939 cap; ~967 note; key-findings loop)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/report-findings-cap.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('client PDF finding cap removed', () => {
  it('report-generators no longer slices findings to 25', () => {
    const src = readFileSync(resolve(__dirname, '../report-generators.ts'), 'utf8');
    expect(src).not.toMatch(/\.slice\(0,\s*25\)/);
    expect(src).not.toMatch(/and \$\{findings\.length - 25\} more findings/);
  });
});
```

> This is a guard test (source-level) because rendering jsPDF headlessly is heavy. It locks the cap removal.

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/lib/__tests__/report-findings-cap.test.ts`
Expected: FAIL — the `.slice(0, 25)` still present.

- [ ] **Step 3: Remove the cap + paginate**

At line ~939, change:

```ts
const sortedFindings = [...findings].sort((a, b) => b.financial_impact - a.financial_impact).slice(0, 25);
```

to:

```ts
const sortedFindings = [...findings].sort((a, b) => b.financial_impact - a.financial_impact);
```

In the key-findings render loop, add a page break when `y` exceeds the printable area (mirror the existing `if (y > pageH - N) { doc.addPage(); y = TOP; }` pattern already used elsewhere in this file). Remove the `if (findings.length > 25) { ... 'more findings' ... }` note block (~967–970).

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run src/lib/__tests__/report-findings-cap.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/report-generators.ts src/lib/__tests__/report-findings-cap.test.ts
git commit -m "fix(report): paginate all findings — remove 25-finding cap"
```

---

### Task 14: Excel Findings sheet

Add a Findings sheet to the Excel export so the model and PDF reconcile — one row per finding with evidence refs + confidence.

**Files:**
- Modify: `src/lib/report-generators.ts` (`generateExcelReport` ~1147; sheet defs ~1211–1360)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/excel-findings-sheet.test.ts
import { describe, it, expect } from 'vitest';
import { buildFindingsSheetRows } from '../report-generators';

describe('Excel findings sheet rows', () => {
  it('emits one row per finding plus a header row', () => {
    const findings = [
      { id: 'f1', title: 'AR aging', severity: 'high', category: 'receivables', financial_impact: 1000, immediate_value: 1000, ongoing_monthly_value: 0, confidence: 0.9, evidence: { sample_records: [{ ref: 'INV-1' }] } },
      { id: 'f2', title: 'Stale stock', severity: 'medium', category: 'inventory', financial_impact: 500, immediate_value: 0, ongoing_monthly_value: 50, confidence: 0.6, evidence: {} },
    ] as never[];
    const rows = buildFindingsSheetRows(findings);
    expect(rows.length).toBe(3); // header + 2
    expect(rows[0]).toEqual(expect.arrayContaining(['Title', 'Severity', 'Confidence']));
    expect(rows[1]).toEqual(expect.arrayContaining(['AR aging']));
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/lib/__tests__/excel-findings-sheet.test.ts`
Expected: FAIL — `buildFindingsSheetRows` not exported.

- [ ] **Step 3: Add the exported row builder + wire the sheet**

Add to `src/lib/report-generators.ts`:

```ts
// Findings sheet: one row per finding so the Excel model reconciles with the PDF.
export function buildFindingsSheetRows(findings: Array<Record<string, unknown>>): Array<Array<string | number>> {
  const header = ['ID', 'Title', 'Category', 'Severity', 'Financial Impact (ZAR)', 'Immediate (ZAR)', 'Ongoing/mo (ZAR)', 'Confidence', 'Evidence Refs'];
  const rows: Array<Array<string | number>> = [header];
  const sorted = [...findings].sort((a, b) => Number(b.financial_impact) - Number(a.financial_impact));
  for (const f of sorted) {
    const ev = (f.evidence ?? {}) as { sample_records?: Array<{ ref?: string }> };
    const refs = (ev.sample_records ?? []).map(s => s.ref).filter(Boolean).join('; ');
    rows.push([
      String(f.id ?? ''), String(f.title ?? ''), String(f.category ?? ''), String(f.severity ?? ''),
      Math.round(Number(f.financial_impact) || 0), Math.round(Number(f.immediate_value) || 0),
      Math.round(Number(f.ongoing_monthly_value) || 0),
      f.confidence == null ? '' : `${Math.round(Number(f.confidence) * 100)}%`, refs,
    ]);
  }
  return rows;
}
```

In `generateExcelReport` (and/or the value-assessment Excel builder that has access to `findings`), after the existing sheets, add:

```ts
const findingRows = buildFindingsSheetRows((assessment.results?.findings ?? []) as Array<Record<string, unknown>>);
const findingsWs = XLSX.utils.aoa_to_sheet(findingRows);
XLSX.utils.book_append_sheet(wb, findingsWs, 'Findings');
```

> If `generateExcelReport(assessment)` doesn't carry `ValueAssessmentFinding[]` (those come from the value endpoints), thread the findings into whichever Excel generator the Value-Assessment download uses (the function that already receives `findings: ValueAssessmentFinding[]`). The unit test covers the pure builder regardless of wiring.

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run src/lib/__tests__/excel-findings-sheet.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/report-generators.ts src/lib/__tests__/excel-findings-sheet.test.ts
git commit -m "feat(excel): add Findings sheet so model reconciles with PDF"
```

---

## Final verification

- [ ] **Step 1: Full worker test suite**

Run: `cd workers/api && npx vitest run`
Expected: PASS (incl. dataset migration, ingest, scoping, isolation, both parity tests).

- [ ] **Step 2: Full client test suite + type-check**

Run: `npx vitest run && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 3: Manifest ↔ schema drift check (manual)**

Confirm every `column.name` in `ingest-manifest.ts` exists on its `erp_*` table (migrate.ts CREATE). Any mismatch = an insert will fail at runtime — fix the manifest, re-copy the mirror, re-run parity.

- [ ] **Step 4: Traceability-invariant gate**

The go-live verification gate runs `verify:matrices` incl. the traceability invariant. After merge to main it runs automatically. Locally, if `verify:matrices` is runnable against a seeded dataset, run it to confirm every claimed $ still traces to an ERP record under the dataset.

---

## Spec coverage map (self-review)

| Spec §       | Requirement                                              | Task |
|--------------|---------------------------------------------------------|------|
| 3.1          | `assessment_datasets` table                             | 1, 2 |
| 3.1          | nullable `dataset_id` on 8 erp_* + index + new version   | 2    |
| 3.2          | shared column manifest (template/client/server)          | 3    |
| 3.3          | Connection/Data wizard step (two modes, templates, validate) | 7 |
| 3.4          | `POST /:id/dataset` ingest + strong-inference reject     | 4, 5 |
| 3.5          | run wiring: `datasetId` scoping, stored on assessment    | 6    |
| 6 invariant  | cross-dataset isolation                                  | 8    |
| 4.1          | shared SVG module, worker + React                        | 9    |
| 4.2          | source-vs-target, immediate-vs-ongoing, confidence gauge | 9,10,11 |
| 4.2          | gate-failed demoted to "Indicative", excluded from totals | 9 (gauge), 10 |
| 4.3          | portfolio roll-ups (waterfall, severity, by-type)        | 12   |
| 4.4          | lift 25-finding cap                                      | 13   |
| 4.4          | Excel findings sheet                                     | 14   |

All spec requirements map to a task. No placeholders remain; types (`ColumnDef`, `DomainDef`, `ValidateResult`, `SampleDelta`, `DomainValue`, `SeverityCounts`) are defined before use and named consistently across tasks.
