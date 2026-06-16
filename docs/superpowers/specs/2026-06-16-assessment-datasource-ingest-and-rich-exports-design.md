# Assessment Data-Source Ingest + Rich Per-Finding Exports — Design

**Status:** Approved (verbal, 2026-06-16). Awaiting written-spec review.
**Date:** 2026-06-16
**Owner:** Reshigan

---

## 1. Problem

Two real defects in the value-assessment flow:

1. **A new assessment does not run on a prospect's real data.** The wizard has an
   ERP-connection selector, but it is decorative: at run time
   [`collectVolumeSnapshot`](../../../workers/api/src/services/assessment-engine.ts#L307)
   queries the `erp_*` tables **by `tenantId` only**. The chosen connection is
   used solely to look up a system *name* — never to scope or pull that
   connection's data ([assessments.ts:71-79](../../../workers/api/src/routes/assessments.ts#L71)).
   For a fresh prospect with no ingested rows, the run reads whatever already
   sits in the tenant's tables (the demo seed). The "No ERP connection — use
   estimated data" option ([AssessmentsPage.tsx:466](../../../src/pages/AssessmentsPage.tsx#L466))
   is misleading — no estimated data is generated.

2. **Report exports are thin.** PDFs are text/table; the backend adds a few CSS
   bars (data-quality, timing, waterfall) but **no per-finding graphs**. The
   client PDF caps at 25 findings; the Excel model has no findings sheet. Rich
   finding fields (`evidence.sample_records`, `confidence`, `pattern`,
   `finding_insight`) are underused.

**Goal:** a user can **add a data source, run the catalyst, and get the
assessment** against that data; and the resulting report carries detailed,
graphed, auditable per-finding evidence. Every figure still traces ERP record →
field mapping → confidence → $ ([[business_model_shared_savings]]).

## 2. Scope

**This cycle (Phase 1):**
- **A — Upload-driven ingest:** templated-CSV upload → isolated per-assessment
  dataset → catalyst/assessment run scoped to that dataset.
- **C — Rich exports:** per-finding graphs (source-vs-target, immediate-vs-
  ongoing, confidence gauge) + portfolio roll-ups; lift export caps; Excel
  findings sheet.

**Deferred (separate spec, Phase 2):**
- **B — Live connector sync** (Xero/QBO GA, SAP/Oracle beta): a connector syncs
  the prospect's ERP into the **same** dataset rows, reusing the Phase-1
  `datasetId` ingest + run path. No rework — B is "swap the CSV ingest for a
  sync writing the same tagged rows."

**Out of scope:** connector OAuth, new chart libraries inside the PDF, dark mode.

## 3. A — Upload-driven ingest

### 3.1 Data model
- **New `assessment_datasets`**: `id`, `assessment_id`, `tenant_id`,
  `status` (`pending|ingesting|ready|failed`), `row_counts` (JSON per domain),
  `error` (nullable), `uploaded_at`. Exactly one dataset per assessment.
- **Add nullable `dataset_id`** to the 8 canonical tables: `erp_invoices`,
  `erp_purchase_orders`, `erp_journal_entries`, `erp_bank_transactions`,
  `erp_employees`, `erp_customers`, `erp_suppliers`, `erp_products`.
  - **`NULL` = existing tenant/seed data** (back-compat; every current query and
    the demo seed keep working untouched).
  - **non-null = belongs to one uploaded dataset.**
  - Index `(tenant_id, dataset_id)`. New canonical schema version (`vNN`).

### 3.2 Column manifest (single source of truth)
A shared manifest (`src/lib/ingest-manifest.ts` + mirrored in worker) defines, per
domain, the canonical column names + types matching the `erp_*` schema. It drives
**three** things: template generation, client-side validation, and server-side
validation. One definition, no drift.

### 3.3 Upload flow (UI)
The new-assessment wizard gains a real **Connection / Data** step with two modes:
- **Use existing tenant data** — current behavior (demo / already-ingested tenant).
- **Upload prospect data** — per-domain template downloads (canonical CSVs
  generated from the manifest) + dropzones. The client parses each file
  (papaparse), validates headers + types against the manifest, and shows row
  counts + **row-level errors before submit**. Submit is blocked while any file
  fails validation.

This replaces the misleading "use estimated data" option with an explicit,
honest choice.

### 3.4 Ingest (worker)
- **New route** `POST /api/assessments/:id/dataset` (superadmin, tenant-scoped):
  accepts validated rows per domain, creates/resolves the `assessment_datasets`
  row, bulk-inserts into `erp_*` with the `dataset_id`, records `row_counts`,
  sets `status=ready` (or `failed` + `error`).
- **Strong-inference guard:** unknown columns or type-mismatched cells are
  **rejected — nothing is ingested**. We never silently coerce a prospect's
  column into a canonical field ([[feedback_inference_strength]]).

### 3.5 Run wiring (the end-to-end: add source → run catalyst → get assessment)
- `runAssessment`, `collectVolumeSnapshot`, and the reconciliation sub-engines
  gain an optional `datasetId`:
  - present → every `erp_*` query adds `AND dataset_id = ?`;
  - absent → tenant data (current behavior).
- The assessment record stores its `dataset_id`; the catalyst runs it spawns
  inherit the same scope, so reconciliation, findings, and billing all derive
  from the uploaded rows only.
- **Invariant:** no cross-dataset bleed — an assessment sees only its dataset's
  rows (covered by the cross-dataset isolation test, §6).

## 4. C — Rich exports + per-finding graphs

### 4.1 Where
The **backend Value Assessment PDF**
([`value-assessment-engine.ts` `buildPDF`](../../../workers/api/src/services/value-assessment-engine.ts#L1621))
already renders HTML → headless-Chrome → PDF and draws CSS bars. We add inline
**SVG** charts there and mirror them on screen in
[`AssessmentFindingsPanel`](../../../src/components/AssessmentFindingsPanel.tsx).

A shared SVG-helper module (`src/lib/finding-charts.ts`, importable by the worker
HTML builder and React) emits the same chart geometry for both surfaces — one
source, no chart library in the PDF, no divergence between screen and export.

### 4.2 Per-finding graphs (all real fields — never fabricated)
1. **Source vs target deltas** — grouped SVG bars from
   `evidence.sample_records` (`source_value`, `target_value`, with the
   `difference` highlighted). Cap to N samples, label "+ M more". Skipped when a
   finding has no `sample_records` (value + confidence still shown).
2. **Immediate vs ongoing** — two bars: `immediate_value` vs
   `ongoing_monthly_value × 12` (annualised), labelled one-off vs recurring.
3. **Confidence gauge** — ring on `confidence` with `confidence_explanation` as
   the auditable caption. Gate-failed / low-confidence findings are demoted to
   **"Indicative — confirm"** and excluded from any headline total (Option-B
   contract, consistent with `FindingsReviewTable`).

### 4.3 Portfolio roll-ups (report header)
Value-by-domain **waterfall** (upgrade existing CSS bars to SVG), **severity
distribution**, **findings-by-type** — assessment-level context around the
per-finding detail.

### 4.4 Export-completeness fixes
- **Lift the 25-finding cap** in the client PDF (paginate all findings) or route
  the full list to the enriched backend PDF — no silent truncation
  ([[business_model_shared_savings]]: a billing artefact must show every claimed
  line).
- **Excel:** add a **Findings sheet** — full per-finding rows incl. evidence
  refs + confidence, so the model and the PDF reconcile.

## 5. Data flow

```
templates (manifest) ─┐
prospect CSVs ─→ client validate(manifest) ─→ POST /assessments/:id/dataset
   ─→ erp_* rows tagged dataset_id  +  assessment_datasets.status=ready
   ─→ runAssessment(datasetId) ─→ catalyst recon (scoped) ─→ findings (real)
   ─→ FindingsReviewTable / Value PDF / Excel
        ├─ per-finding SVG: source-vs-target · immediate-vs-ongoing · confidence
        └─ portfolio: domain waterfall · severity · by-type
```

## 6. Error handling, states, testing

**States**
- Upload header/type mismatch → blocked with row-level errors, nothing ingested.
- Empty domain file → 0 rows allowed; the corresponding finding is simply absent
  (never fabricated).
- Finding without `sample_records` → skip the delta chart, keep value + gauge.
- Gate-failed finding → charts shown but flagged "Indicative", excluded from totals.
- Ingest in progress → `assessment_datasets.status` drives a wizard progress state;
  run is gated on `status=ready`.

**Testing**
- **Ingest round-trip:** templated CSV → correct `erp_*` row counts under the
  `dataset_id`; malformed CSV rejected wholesale.
- **Cross-dataset isolation:** extend `verification/isolation` — an assessment
  with dataset X never reads dataset Y or tenant (`NULL`) rows.
- **Run scoping:** `collectVolumeSnapshot(datasetId)` returns only that dataset's
  aggregates (unit + an accuracy run on a seeded dataset).
- **Traceability-invariant still passes** on uploaded data (every $ → an ERP
  record in the dataset).
- **Charts:** `finding-charts` maps a `ValueAssessmentFinding` to correct bar/
  gauge geometry; gate-failed finding renders "Indicative" and is excluded from
  the headline total; Excel findings-sheet row count == findings count.

## 7. Risks
- **Migration:** nullable `dataset_id` on 8 tables is additive; `NULL` preserves
  all current behavior and the demo seed. Low risk.
- **Chrome-PDF chart cost:** bounded by the per-chart sample cap.
- **Column ambiguity:** sidestepped entirely by templated CSVs (no column
  guessing) — aligns with the strong-inference rule.

## 8. Phasing
- **Phase 1 (this cycle):** A + C.
- **Phase 2 (separate spec):** B — live connectors write the same `dataset_id`
  rows and reuse the `datasetId` run path; only the ingest source changes.
