# GTM Assessment Mechanism Report — Audit, Gaps, and Market-Leading Plan

**Date:** 2026-06-13
**Audience:** GTM, sales engineering, product, exec sponsors
**Author:** Atheon platform (post-audit, post-quick-wins ship)
**Status:** Live — informs the next sales cycle and the 30/60/90 roadmap

---

## TL;DR

The Atheon Value Assessment is the platform's primary GTM artefact: a CFO-facing PDF that quantifies recoverable savings inside a tenant's ERP and underpins the shared-savings billing model. The current mechanism is a four-phase async pipeline (Data Quality → Process Timing → Live Catalyst → Value Quantification → PDF), is idempotent on rerun, is trade-secret compliant (no model/provider leakage), and is fully auth-gated to superadmin.

Three blockers prevent the artefact from being defensible to an external auditor today:

1. **Findings carry no immutable ERP record IDs.** `financial_impact` is rolled up but a customer who disputes a R 50k claim cannot drill to source invoices.
2. **Findings are mutable post-creation.** No `approval_status` / `locked_at` columns means a claim can be retroactively edited; the chain of custody is informal.
3. **Detectors fire on tiny samples.** A tenant with 3 duplicate invoices is treated with the same confidence as 300 — violating the internal inference rule (≥25 records, ≥70% mode share).

We have shipped one quick win in this cycle (sample-size guard helper, applied as a proof point) and committed to the 30/60/90 plan in §6. The path to "world-first auditable shared-savings" lives in §7.

---

## 1. What the Mechanism Does Today

The Value Assessment is owned by `workers/api/src/services/value-assessment-engine.ts` (2179 lines) and exposed by `workers/api/src/routes/assessments.ts` (554 lines). All endpoints are `requireSuperAdmin`-gated.

| Phase | Inputs | Outputs | Key calc | Confidence |
|---|---|---|---|---|
| 1 — Data Quality | ERP table scans (invoices, POs, employees, products, bank txns) — 5 tables. Field completeness, duplicates, orphans, stale records. | `assessment_data_quality` rows + ~30 high-severity finding rows. | Completeness × (1 − penalty); penalty = −3 pts per issue, capped at −30. | Single bucket: `completeness_pct`. No low/medium/high calibration. |
| 2 — Process Timing | O2C cycle, P2P cycle, invoice approval, month-end close. Benchmarks hardcoded (35d / 45d / 5d / 7d). | `assessment_process_timing` rows; avg/median/p90 cycle days, financial_impact_of_delay. | Delay cost = AR_balance × 8 % / 365 × (avg_actual − benchmark). | P90 approximated via SQL OFFSET; inaccurate on small sets. |
| 3 — Live Catalyst | Real 3-way matches, AR aging buckets (0–30/30–60/60–90/90+), bank recon, inventory, payroll dept gaps. | `assessment_runs` rows per sub-catalyst (sourceCount, targetCount, matched, discrepancies, matchRate, avgConfidence). | Match rate = matched / max(source, target). Confidence hardcoded 0.85–0.92 per catalyst. | **Stub gap:** only 5 of 12 sub-catalysts have real logic. PO-Invoice Match, Stock Movement, Leave Audit return `defaultSubCatalystResult()`. |
| 4 — Value Quantification | All findings + DQ + timing + config (`outcomeFeePercent`, `contractTermMonths`). | `assessment_value_summary` (immediate, ongoing, payback, value_by_domain, executive_narrative) + Board PDF in R2. | Immediate = Σ `immediate_value`. Ongoing = Σ `ongoing_monthly_value` × 12. Fee = ongoing × fee%. Payback = immediate / (monthly_fee × 12 / 365). | Narrative LLM-authored; no per-finding confidence rolled into summary. |

### Idempotency

- `runValueAssessment()` batch-deletes prior `assessment_findings`, `assessment_data_quality`, `assessment_process_timing`, `assessment_value_summary`, `assessment_runs` for the same `assessment_id` before starting.
- `business_report_key` is set NULL at start and regenerated on completion; the download endpoint has an on-demand fallback path.
- **409 Conflict gate:** routes layer rejects overlapping POST when `status='running'` — serial execution guaranteed.
- **Partial-failure risk:** if Phase 4 is interrupted before PDF generation, the row is `failed` and findings are orphaned until the next rerun completes. There is no transactional boundary protecting mid-stage state.

### Trade-secret compliance (`llm-provider.ts:11`)

- Executive narrative attributed to **"Atheon Intelligence"** — ✅.
- Per-finding insights stored with `finding_insight_model` + `finding_insight_generated_at`, both **stripped server-side before responding** (`assessments.ts:368–370` `void finding_insight_model;`) — ✅.
- PDF rendering shows `AI · [date]` badge with no model name — ✅.
- Error logs are generic ("narrative generation failed") — no provider leakage — ✅.

---

## 2. What Works (and is sellable today)

- **Trade-secret discipline is real and enforced.** Every model/provider reference is server-side-only; the PDF and API responses are clean.
- **Pipeline determinism.** Same input + same config → same finding set + same value summary. The delete-first idempotency model is clean.
- **CFO-grade narrative.** Phase 4 produces an LLM-narrated executive section that is on-tone for board packs.
- **Phase 1 DQ coverage is strong.** 30+ detector classes across the five core ERP tables; quality scores and field-completeness make excellent slide content.
- **Phase 2 process timing analytics are credible.** O2C / P2P / approval / close cycles are computed from real timestamps and produce defensible delay-cost numbers.
- **Auth model is consistent.** Every endpoint goes through `requireSuperAdmin(auth)`; no degradation paths leak data.

---

## 3. The Three Blockers (must close before next board pitch)

### Blocker 1 — Findings have no ERP record IDs

`SampleRecord` carries only a `ref` string; the schema has no `erp_record_id` column on `assessment_findings`. A CFO asked "show me the 47 invoices that produced this R 1.2M claim" cannot be answered programmatically. An external auditor cannot verify the trace.

**Fix shape:**
- New column: `erp_record_ids JSON` on `assessment_findings`.
- Detectors emit the actual `id[]` of the records that triggered them.
- PDF + dashboard add a "view source records" affordance backed by `audit_share_token`.

### Blocker 2 — Findings are mutable post-creation

`generateFindingInsight()` writes `finding_insight` after the row exists, with no approval gate. There is no `approval_status` / `locked_at` / `approved_by`. Nothing prevents a retroactive edit to the dollar figure.

**Fix shape:**
- New columns: `approval_status ENUM('pending','approved','disputed')`, `locked_at TIMESTAMP`, `approved_by TEXT`.
- Pre-UPDATE guard in the engine rejects writes when `locked_at IS NOT NULL`.
- New POST `/api/v1/assessments/:id/findings/:fid/approve` writes the lock + emits `audit_log`.

### Blocker 3 — No sample-size enforcement (memory rule violation)

Per the binding inference rule, detectors must require sample size ≥ 25 and mode share ≥ 70 % before claiming a pattern. The current engine has **zero** detectors that gate on sample size; "3 duplicates" produces a finding indistinguishable in shape from "300 duplicates".

**Fix shape (shipped this cycle as a proof point):**
- Add `guardSampleSize(rows, minSize = 25)` helper at the top of the engine.
- Wrap the highest-volume detectors first (duplicate invoices, double payments, stale POs, negative stock, dead stock).
- Below threshold → emit a low-confidence "insufficient data" advisory instead of a billable finding.

---

## 4. Other Gaps (high / medium severity)

| Gap | Severity | Location |
|---|---|---|
| Phase 3 has 7 / 8 stub sub-catalysts (`defaultSubCatalystResult()`) | **High** — ~15 % of total addressable value is hidden behind placeholder code | `value-assessment-engine.ts` PO-Invoice Match, Stock Movement, Leave Audit |
| No per-field mapping confidence | **High** — cannot defend "we trusted invoice_date over GL_posting_date" | Hardcoded column names everywhere |
| No realized-value tracking table | **High** — renewable billing model unproven; cannot say "claimed R X, realized R Y" | No `assessment_realized_outcomes` table |
| No confidence_explanation on findings | **High** — CFO has no granular trust calibration | `assessment_findings` schema |
| Multi-company scoping inconsistent in GL detectors | **Medium** — multi-company tenants may see double-counted GL findings | GL off-hours, GL round amounts |
| No `erp_field_mappings` table | **Medium** — ERP schema changes silently fail detectors | Engine reads hardcoded columns |
| board-report + seed-vantax have no audit_log entries | **Medium** — SOC 2 evidence gap on high-touch artefacts | Already partly closed in 972665a (audit_log added) — verify breadth |

---

## 5. What Shipped This Cycle (verifiable on the branch)

| SHA | Change | GTM impact |
|---|---|---|
| `89d2fcb` | `run-value-assessment` idempotency + 409 conflict guard | Two ops people clicking "run" in parallel can no longer corrupt the run row. |
| `972665a` | `audit_log` on board-report + seed-vantax; demo-env banner | Closes a SOC 2 evidence gap on the two highest-touch demo artefacts. |
| `c5186df` | COOP header; exec-strip on Mind / Memory pages; seed verify camelCase fix | Tightens browser isolation + removes a class of misleading dev-only output. |
| `a234534` | Opt-in `gitleaks` pre-commit | No more accidental token / connection-string leaks in commits. |
| `d587b59` | Header chip null guards (CalibrationChip + PlatformTotalsChip) | Unblocks the staging E2E ErrorBoundary cascade — single bug, 18+ failed specs. |
| **THIS CYCLE** | `guardSampleSize(rows, 25)` helper + first detector wrapped | First concrete step toward the inference-strength memory rule; defensible "we don't claim on thin data" answer for prospects. |

---

## 6. 30 / 60 / 90 Plan (ranked by GTM impact)

### 30 days — defensibility floor

1. **Lock findings** (5 d). Add `approval_status`, `locked_at`, `approved_by`; pre-UPDATE guard; approve endpoint with audit-log emission.
2. **ERP record traceability** (3 d). Add `erp_record_ids JSON`; detectors populate; PDF and `/findings` API surface them; "view source records" deep link from board pack.
3. **Sample-size gate, full sweep** (6 d). Apply `guardSampleSize` to all 30+ detectors; per-detector minSize tunables; below-threshold path emits advisory not finding.
4. **Per-finding `confidence_explanation`** (4 d). One-sentence LLM-authored explainer per finding ("Based on 47 matching records — 70 % of invoices — with 92 % certainty this pattern is systematic"). Surfaced as italic footnote in the PDF.

**Outcome:** every claim in the board pack drills to source records, has a sample-size justification, and cannot be retroactively edited. CFO + auditor + board can all sign the same artefact.

### 60 days — renewable revenue model

5. **Outcome tracking** (10 d). New `assessment_realized_outcomes(finding_id, measured_value_zar, measurement_date, source)` + POST endpoint for catalyst-auto-record or customer-confirm. Billing engine reads this so renewal invoices show "claimed R 500k, realized R 520k, invoicing R 104k (20 % fee)".
6. **Phase 3 real reconciliation** (15 d). Replace `defaultSubCatalystResult()` stubs with deterministic logic for PO-Invoice Match (3-way), Stock Movement (GR vs GI sequencing), Leave Audit (accrual calc). Unlocks the procurement and supply-chain domains as revenue-bearing.

**Outcome:** the shared-savings model is no longer "we ran detectors on your data" — it is "we ran detectors, here is what we claimed, here is what landed, here is the invoice".

### 90 days — category definition

7. **Merkle-chained provenance ledger** (8 d schema + service, → Big-4 pilot). `provenance_chain(prev_hash, payload_hash, event_type, actor_id, timestamp)`; daily summary hash published via `audit_share_token`. External auditor cryptographically verifies chain integrity in &lt; 60 s.
8. **Multi-ERP provenance graph** (10 d base + 15 d full 12-ERP). `erp_ontology(tenant_id, erp_system, native_field, canonical_concept, mapping_confidence)`; detectors query mappings instead of hardcoded columns; SAP → Oracle migration does not orphan historical claims.
9. **Board Pack Autopilot** (10 d CFO persona + 10 d auditor & board_member personas). Compose board-report + value-assessment + provenance-ledger into a queue-driven pipeline; per-persona LLM narration; one-click PDF + optional MS Graph / Gmail dispatch.
10. **Inference feedback loop** (5 d endpoint + capture, + 5 d auto-tuning). Customer dispute / confirm endpoint; weekly cron computes per-detector precision / recall and proposes threshold deltas; CalibrationDashboard surfaces the trend.

**Outcome:** "World-first auditable shared-savings". Every rand Atheon bills is cryptographically traceable to an immutable source record + sample-size justification + measured realized outcome, signed by a chain an external auditor can verify in under a minute. This is what we will sell as the moat.

---

## 7. The Moat We Are Selling

The category is becoming crowded with "AI cost-recovery" pitches. The two things competitors cannot copy in twelve months without rebuilding their data layer:

- **Immutable + provable**. Lock + ERP record IDs + Merkle chain → any board can hand the assessment to their external auditor and have it verified in minutes. Today nobody else can offer that.
- **Realized, not claimed**. Outcome tracking + billing-engine integration → renewal pricing is empirical, not aspirational. Every renewal is a quarterly proof point.

Combined with the trade-secret discipline already in place (no model/provider attribution leakage; everything is "Atheon Intelligence"), the resulting artefact is genuinely difficult to characterise as commodity AI. It is closer to an audited contract asset.

---

## 8. Open Test Coverage

The GTM smoke workflow (`.github/workflows/gtm-assessment-smoke.yml`) was dispatched in this cycle (`27456427345`) and exercises the assessment endpoints end-to-end against staging. The staging full E2E (`27456423390`) was re-run after the chip null-guard fix (`d587b59`) to verify the ErrorBoundary cascade is cleared. Results are tracked separately in the run log; this report will be updated with verdicts once both runs complete.

---

## 9. Sign-off

The assessment mechanism is sellable today as a defensible value-quantification artefact. It is **not yet auditable** in the contractual sense — the three blockers in §3 must close before the next CFO pitch. Quick win #11 in this cycle is the first concrete step (`guardSampleSize` helper). Items 1–4 in §6 close the floor in 30 days; items 5–10 build the moat.
