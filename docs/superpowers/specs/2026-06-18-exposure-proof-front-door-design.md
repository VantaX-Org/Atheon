# Exposure-Proof Front Door (Feature A) — Design

**Date:** 2026-06-18
**Status:** Approved design, pending implementation plan
**Scope:** A now. Feature B (close the recovery loop) is a separate roadmap spec.

---

## 1. Goal & value frame

A prospect on the public `/trial` funnel — or a first-run logged-in user — uploads their own ERP CSV and, on one screen, sees **real detected exposure in Rand**: the sum of value-at-risk across confidence-gated detector findings, each finding drillable to the user's actual ERP rows.

**Hard invariant: no fabricated number is ever displayed.** Every Rand shown traces to a real `assessment_findings` row produced by the existing 39-detector engine running on the user's ingested data. When the data is too thin to clear the confidence gate, the screen shows an honest `insufficient_data` state — not a fabricated number.

The screen ends with a **book-a-call** CTA that persists a lead and notifies the Atheon team.

### What this fixes

Today the public trial **fabricates**. `POST /api/trial/:id/upload` is simulated — it stores `{filename, row_count, columns}` metadata and never parses or ingests the CSV ([trial-assessment.ts:71-101](../../../workers/api/src/routes/trial-assessment.ts#L71-L101)). So when `POST /api/trial/:id/run` calls the real engine it runs on empty data → zero findings → falls through to a `Math.random()` fallback that invents exposure between R100k and R1M with fake risks ([trial-assessment.ts:207-229](../../../workers/api/src/routes/trial-assessment.ts#L207-L229)). A prospect's "exposure" is a dice roll — a direct violation of the shared-savings traceability rule.

The detector spine is already wired into the trial run path ([trial-assessment.ts:123-202](../../../workers/api/src/routes/trial-assessment.ts#L123-L202)); it is simply starved of data. Feature A feeds it real data and removes the fabrication.

### Locked product decisions (from brainstorming)

- **Scope:** A now; B as roadmap.
- **Entry point:** both surfaces, one shared results view (public trial + logged-in first-run empty-state).
- **The claim:** detected exposure only — hero = Σ findings value-at-risk, drillable to ERP rows + confidence. **No recovery/ROI multiplier shown** (recovery numbers lean on fixed-percentage catalyst math, which is not findings-driven).
- **Conversion:** book-a-call + capture lead — persist a lead row + notify the team; lightweight, no new auth.

---

## 2. Architecture / data flow

```
CSV file(s) ──parseCsv()──▶ {domains:{invoices:{header,rows},…}}   [client, src/lib/ingest-client.ts — REUSED]
        │
        ▼  POST /api/trial/:id/upload   (now real; was metadata-only)
ingestDomains() → validateDomainRows() per domain
        → INSERT erp_* scoped (tenant_id, dataset_id=ds_trial_<id>)   [shared helper, extracted from assessments.ts]
        │
        ▼  POST /api/trial/:id/run
detectAllFindings(db, trialTenantId, {datasetId, baseCurrency:'ZAR', …})  ──▶  assessment_findings   [REUSED, 39 detectors]
        │
        ▼  estimatedExposure = Σ findings value-at-risk   (NO Math.random fallback)
GET /api/trial/:id/results  ──▶  ExposureResults component   [NEW, shared]
                                        ▲
        logged-in first-run empty-state ┘   (Dashboard → run assessment → same component)
```

The ingest → validate → detect spine already exists and is exercised on the authenticated assessment path. Feature A **reuses** it. It does not reimplement CSV parsing, validation, ingest, or detection.

### Reused assets (do not rebuild)

| Asset | Location | Role |
|---|---|---|
| `parseCsv()`, `INGEST_DOMAINS`, `downloadTemplate()` | [src/lib/ingest-client.ts](../../../src/lib/ingest-client.ts) | client CSV → `{header, rows}` per file |
| `INGEST_MANIFEST` (8 domains) | [workers/api/src/lib/ingest-manifest.ts](../../../workers/api/src/lib/ingest-manifest.ts) | domain → table + column schema |
| `validateDomainRows()` | [workers/api/src/lib/ingest-validate.ts:36](../../../workers/api/src/lib/ingest-validate.ts#L36) | strong-inference validation; whole-domain reject on any error |
| validate→write loop (to be extracted) | [workers/api/src/routes/assessments.ts:160-206](../../../workers/api/src/routes/assessments.ts#L160-L206) | DELETE+INSERT erp_* scoped (tenant_id, dataset_id), batched 50/call, error cap 200 |
| `detectAllFindings(db, tenantId, ctx)` | [workers/api/src/services/assessment-findings.ts:3048](../../../workers/api/src/services/assessment-findings.ts#L3048) | 39 detectors, `datasetFilter(ctx)` scopes all erp_* queries; writes `assessment_findings` |

**Manifest domains (8):** `invoices`→`erp_invoices`, `purchase_orders`→`erp_purchase_orders`, `journal_entries`→`erp_journal_entries`, `bank_transactions`→`erp_bank_transactions`, `employees`→`erp_employees`, `customers`→`erp_customers`, `suppliers`→`erp_suppliers`, `products`→`erp_products`.

---

## 3. Backend changes

### 3.1 Extract shared ingest helper — `workers/api/src/lib/ingest-write.ts` (new)

Lift the inline validate→write loop out of `assessments.ts` into one function both routes call:

```
ingestDomains(
  db: D1Database,
  tenantId: string,
  datasetId: string,
  domains: Record<string, { header: string[]; rows: Array<Record<string, unknown>> }>,
  opts: { maxRowsPerDomain: number }
): Promise<{ row_counts: Record<string, number>; errors: CellError[] }>
```

Behavior preserved exactly from the current authenticated path: iterate `INGEST_MANIFEST`; for each present domain call `validateDomainRows`; on any error, reject that whole domain (strong inference); `DELETE FROM <table> WHERE tenant_id=? AND dataset_id=?` then batched `INSERT` (50/call) with `id`, `tenant_id`, `dataset_id`, `source_system='upload'`; cap errors returned at 200. **New:** enforce `maxRowsPerDomain` (reject domains exceeding the cap before insert).

The authenticated route ([assessments.ts:160-206](../../../workers/api/src/routes/assessments.ts#L160-L206)) is refactored to call `ingestDomains(...)`. Its existing tests must stay green — behavior is unchanged for it (it passes a cap high enough to be a no-op for current usage).

### 3.2 `POST /api/trial/:id/upload` — real ingest

Replace the simulated metadata store ([trial-assessment.ts:71-101](../../../workers/api/src/routes/trial-assessment.ts#L71-L101)) with:

1. Read JSON body `{ domains }` (same shape the authenticated route accepts).
2. Resolve the trial's tenant id from the `trial_assessments` row.
3. Call `ingestDomains(db, trialTenantId, 'ds_trial_<id>', domains, { maxRowsPerDomain: 50000 })`.
4. Return `{ row_counts }`.

Keep the existing 3/IP/day rate limit on the trial router.

### 3.3 `POST /api/trial/:id/run` — real detectors only, no fabrication

In the existing run handler ([trial-assessment.ts:123-229](../../../workers/api/src/routes/trial-assessment.ts#L123-L229)):

1. Pass `datasetId: 'ds_trial_<id>'` into the `detectAllFindings` context so detectors scope to the trial's ingested rows.
2. **Delete the `Math.random()` fallback block** ([trial-assessment.ts:207-229](../../../workers/api/src/routes/trial-assessment.ts#L207-L229)) entirely.
3. Compute `estimatedExposure = Σ (immediate_value + ongoing_monthly_value × 12)` over the real findings only.
4. If zero findings clear the confidence gate, set trial status to `insufficient_data` and `estimatedExposure = null`. Persist findings + summary as today (the real branch already writes `findings_json` / `findings_summary_json`).

The confidence/sample gating is enforced upstream inside the detectors (sample ≥ 25, mode-share thresholds); sub-threshold findings are suppressed before they reach this handler, so the exposure sum is automatically gate-clean.

### 3.4 Lead capture — `request-call`

`trial_assessments` already stores `contact_name` / `contact_email` captured at `/start`; the row **is** the lead. No new table.

- **Migration:** add columns `call_requested_at` (timestamp, nullable) and `call_note` (text, nullable) to `trial_assessments`.
- **Route:** `POST /api/trial/:id/request-call` with optional `{ note }`. Sets `call_requested_at = now`, stores `call_note`, fires a team notification. No auth (public trial), rate-limited via the existing trial limiter.
- **Notify mechanism:** reuse the existing notification/email channel used elsewhere in the API (exact channel resolved during planning). If none is wired for this surface, the persisted `call_requested_at` flag is the fallback (the team queries pending lead rows). The flag write is the source of truth; the notification is best-effort.

---

## 4. Frontend changes

### 4.1 `ExposureResults` — new shared component

Money-first presentational component. Consumes a normalized shape `{ exposure: number | null, currency, findings: Finding[], status }`.

```
┌────────────────────────────────────────────────┐
│  DETECTED EXPOSURE                               │
│  R 4,820,000           ← Σ value-at-risk, hero   │
│  across 11 findings · ERP-evidenced              │
├────────────────────────────────────────────────┤
│  ▸ Duplicate supplier payments      R 1.2M  ~87% │ ← confidence badge
│      142 invoices · drill ▶ shows erp rows       │
│  ▸ AR aged >120d unactioned         R 0.9M  ~91% │
│  ▸ …                                             │
├────────────────────────────────────────────────┤
│  Want us to recover this? [ Book a call ]        │ ← CTA → request-call
└────────────────────────────────────────────────┘
```

- **Hero:** `exposure` formatted in tenant currency (ZAR for trial). Subhead = finding count + "ERP-evidenced".
- **Finding rows:** each shows title, value-at-risk, confidence badge. Expands to ERP evidence (`affected_records` count, sample `erp_record_id`s, field mapping) + `confidence_explanation`.
- **No ROI / recovery multiplier** (locked: detected exposure only).
- **Honest empty state** (`status === 'insufficient_data'`): "We couldn't confirm exposure from this data — here's what we'd need," listing missing or low-sample domains. No number.
- **CTA:** book-a-call → calls `request-call` on the trial surface; on the logged-in surface it routes to the existing contact path (no lead row needed when authenticated).

### 4.2 Trial upload step — real parse + auto-map

Replace the metadata-only submit ([TrialPage.tsx:54-69](../../../src/pages/TrialPage.tsx#L54-L69), [:258-284](../../../src/pages/TrialPage.tsx#L258-L284)) with:

1. For each uploaded file, `parseCsv(file)` → `{header, rows}` (reuses [ingest-client.ts](../../../src/lib/ingest-client.ts)).
2. **Auto-map** each file's header to a manifest domain by header-name matching against `INGEST_MANIFEST` columns (lightweight — no column-mapping wizard).
3. Build `{ domains }` and POST to the now-real upload route, then `run`.
4. Surface which columns mapped / didn't (honest); a file with no confident domain match is reported, not silently dropped.

**Design decision (recommended, approved):** lightweight header auto-mapping for the public trial rather than the authenticated path's heavier column-mapping wizard — lower friction for a prospect, and it honestly surfaces unmapped columns.

### 4.3 Trial results step — render `ExposureResults`

Replace the current `healthScore` / `issuesFound` / `projectedRoi` / random-risk blocks ([TrialPage.tsx:316-444](../../../src/pages/TrialPage.tsx#L316-L444)) with `ExposureResults` fed by `api.trial.results(id)`. The book-a-call CTA replaces / augments the existing "Unlock Everything" upgrade card.

### 4.4 Logged-in first-run empty-state

Dashboard first-run empty-state → "Run your first assessment" → the existing authenticated assessment flow (already ingests real CSV via `api.assessments.dataset`). Its results render through the **same** `ExposureResults` component, unifying the money moment across both surfaces.

---

## 5. Honest-state handling (traceability + prefer false-negative)

- Exposure is **only ever** the sum of real, confidence-gated findings. Detectors enforce sample ≥ 25 and mode-share gates; sub-threshold findings are suppressed upstream and never reach the hero.
- Zero qualifying findings → `insufficient_data` state, never a number.
- Every displayed Rand is drillable to ERP rows. No finding → no claim.
- This honors the standing rules: shared-savings traceability (every claimed Rand traces to real data) and strong inference (prefer a false negative + "insufficient data" over silently presenting a weak/fabricated number).

---

## 6. Security & abuse (public ingest)

The trial upload route now writes to `erp_*`. Guards:

- Existing 3/IP/day rate limit on the trial router (covers upload, run, request-call).
- `maxRowsPerDomain` cap (50,000) enforced in `ingestDomains`.
- `validateDomainRows` rejects unknown columns / bad types; whole-domain reject on any error.
- Trial tenant fully isolated; trial rows scoped to `dataset_id = ds_trial_<id>`; existing 7-day trial expiry.
- No PII captured beyond the contact already collected at `/start`.

---

## 7. Testing

**Unit**
- `ingestDomains`: valid domain → rows written scoped to (tenant, dataset); bad column → whole domain rejected, no rows; row count > cap → domain rejected.
- Exposure-from-findings: sum equals `Σ (immediate + ongoing×12)` over seeded findings.
- `insufficient_data`: empty findings → status set, exposure null.

**Integration**
- Seed a real sample invoices CSV → `upload` → `run` → `results` returns real findings + real exposure; assert the exposure traces to seeded rows.
- Garbage / empty CSV → `run` returns `insufficient_data`; **assert no random number is produced** (regression lock on the deleted fallback).
- Refactored authenticated `POST /api/assessments/:id/dataset` still green (behavior unchanged after extraction).

**Lead**
- `request-call` sets `call_requested_at` + `call_note` and triggers the notify path (or persists the flag when notify is unwired).

---

## 8. Out of scope (Feature B roadmap)

Closing the recovery loop — ERP read/sync ingest, findings → RCA → action auto-orchestration, and a SAP action verifier so verified recovery reaches billing — is a separate spec. Feature A demonstrates **exposure**; Feature B demonstrates **recovery**.
