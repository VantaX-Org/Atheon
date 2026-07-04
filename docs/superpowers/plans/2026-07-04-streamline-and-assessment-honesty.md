# Fix-All: Streamlining + Assessment Honesty

**Date:** 2026-07-04
**Driver:** "evaluate the entire system, streamline features for ease of use, make the assessment perfect / better than world-class" → "fix all".
**Source of truth:** two system audits (feature-surface streamlining map + assessment-pipeline honesty audit), 2026-07-04.

Executed in waves; each wave is independently verifiable and shippable. Correctness-critical assessment fixes first.

## Global constraints

- **Honesty / traceability rule is law**: every displayed/exported Rand traces to a real `erp_*` row; prefer false negatives; no fabricated numbers; confirmed (gate-passed) value and potential-unverified value stay separate and the headline is confirmed-only.
- No re-theme; existing tokens. No new deps. Labels-only renames keep code identifiers.
- Every non-trivial logic change ships a test. Full `npx vitest run` + `npx tsc -b` green before each commit. Backend worker tests: `cd workers/api && npm test` (or the repo's worker test command).
- Never `git add -A` (untracked cruft in tree). Commit by explicit path.

---

## WAVE 1 — Assessment honesty (backend, correctness-critical)

### 1.1 Trial funnel runs real detectors on real data (audit gaps 1-3)
- `workers/api/src/routes/trial-assessment.ts:70-101` `POST /:id/upload` is a metadata stub — replace with the real spine: `parseCsv`/domains → `validateDomainRows` → insert into `erp_*` under a `ds_trial_<id>` dataset (reuse `ingestDomains` from `workers/api/src/lib/ingest-write.ts` if present, else the `assessments.ts:160-206` path).
- `trial-assessment.ts:208-227` — DELETE the `Math.random()` fabrication branch. No data → honest "no findings / connect data", never a random figure.
- `trial-assessment.ts:155-166` — replace invented `healthScore` and 40/30/30 `topRisks` allocation with values derived from `summariseFindings().by_category`.
- Aligns with the approved `docs/superpowers/specs/2026-06-18-exposure-proof-front-door-design.md`.

### 1.2 Headline = gated confirmed total, not max() heuristic (gap 4)
- `workers/api/src/services/assessment-engine.ts:2500` — `totalSaving = Math.max(baselineSaving, findings_summary.total_value_at_risk_zar)` reintroduces the untraceable volume heuristic into the headline. The headline must be the gated confirmed total; expose the volume heuristic separately as a clearly-labeled "modelled potential", never `max()`-merged.

### 1.3 Export parity — one source of truth (gap 5)
- `workers/api/src/services/report-generators.ts:75,461,1173` — business PDF, technical PDF, Excel all headline the heuristic `estimated_annual_saving_zar`. Repoint every export headline to `findings_summary.total_value_at_risk_zar`.
- Findings sheet/table (`:939-961`, `buildFindingsSheetRows:1141`) must carry the confirmed-vs-indicative (`confidence_gate_passed`) column so an exported Rand is never shown as confirmed when it wasn't.

### 1.4 AR aging: observed vs projected split (gap 6)
- `assessment-findings.ts:743-744` — AR aging is classified `direct` (0.95, never gated) but `value_at_risk_zar = totalZar * 8-12%` is a projected recovery. Split into two value components: observed exposure (direct = outstanding balance) and projected recovery (inferred, gated/labeled). Fix the `directObservationConfidence` explanation so it doesn't claim "no inference applied" for a projected value. Audit any other direct-classified detector that multiplies observed balances.

### 1.5 Traceback ids resolve to real rows (gap 7)
- `assessment-findings.ts:875,1488,1951` set `ref`→`erp_record_id` to a customer/supplier name; `:2388` (FX) to a currency code. Carry a real row id (or a deterministic aggregate key resolving to member rows); names/currencies go in `description`, not `erp_record_id`.

### 1.6 Honesty-invariant tests (gap 8)
- New accuracy test: run `detectAllFindings` on a seeded oracle tenant; assert (a) every gate-passed finding's `erp_record_id` and each `sample_records[].ref` resolves to a live `erp_*` row; (b) `summariseFindings().total_value_at_risk_zar` == sum of resolvable confirmed values (excludes the heuristic); (c) export headline totals == on-screen `total_value_at_risk_zar`.

### 1.7 Robustness
- `assessments.ts:~205` — wrap dataset delete+insert+status flip so a mid-batch failure can't leave a half-loaded dataset marked neither `ready` nor `failed`.
- `assessment-findings.ts:713` aging `LIMIT 200` — label as "top 200 by value" and count affected separately from the sampled rows.
- `toZAR` unknown-currency 1:1 (`:483`) — raise a data-quality flag instead of silent face-value pass-through.

---

## WAVE 2 — Streamlining, low-risk (frontend)

### 2.1 Wire onboarding into the front door + re-point to journey (streamline #1)
- `src/pages/OnboardingWizardPage.tsx:32-40` STEP_TARGETS → `/data`, `/findings`, `/catalysts`, `/roi-dashboard`, `/executive-summary` (not `/pulse`,`/apex`,`/iam`).
- `src/pages/JourneyHome.tsx` — when `connections.total === 0`, show a primary "Get started" CTA linking to `/onboarding` (or straight to connect for admins).

### 2.2 Fix non-admin connect dead-end (streamline #2)
- `src/pages/DataPage.tsx:84` — admins get a direct "Connect ERP or upload CSV" action, not the 3-tab `/integrations` page; non-admins keep a clear "ask your admin" but not as the only content.

### 2.3 Page titles match nav labels (streamline #5)
- `CatalystsPage` title → "Fixes"; `ROIDashboardPage` → "Savings"; `ExecutiveSummaryPage` → "Reports" (keep technical subtitles). Labels only.

### 2.4 De-jargon Findings headline (streamline #6)
- `src/pages/FindingsPage.tsx:61-69` — "confidence-gated finding / fell below the confidence gate" → "verified finding / N more need review".

### 2.5 Delete dead code (streamline #7)
- Remove `src/components/common/OnboardingChecklist.tsx` (rendered nowhere) and the stale `App.tsx:183` comment.

### 2.6 Settings defaults instead of choices (streamline #8, #9)
- `src/pages/SettingsPage.tsx` — move the superadmin "Platform" infra tab out of user Settings; merge "API Key"+"Two-Factor" into one "Security" tab; default theme = Ink with the palette picker under "Advanced"; default notifications on.

---

## WAVE 3 — Streamlining, larger (frontend, higher-effort)

### 3.1 Slim CatalystsPage 12 tabs → 2 for ordinary users (streamline #4)
- `src/pages/CatalystsPage.tsx:992+` — surface Approvals + Value Ledger by default; role-gate the other 10 (Execution Logs, Run Analytics, Confidence, Governance, Review Assignments, Exceptions, Intelligence, Peer Insights, Action Log, Catalyst Clusters) behind operator/analyst roles.

### 3.2 Consolidate exec surfaces 5 → 2 (streamline #3)
- Fold Apex "Leadership Summary"/briefing + Board Digest PDF into `/executive-summary` as an "Export board PDF" action; keep `/roi-dashboard` for billing proof; keep Apex as the deep analytics/scenario workspace only. Retire the duplicate `api.boardReport` generator (`BoardDigestPage.tsx:89-105`) in favour of one.

### 3.3 Pre-fill connector config (streamline #10)
- `src/pages/IntegrationsPage.tsx` adapter forms — pre-fill Base/Auth/Token URLs + Scope per adapter (constant); ask only for credentials.

### 3.4 Cleanup (streamline: fossils, assets)
- Once confirmed no inbound links, retire the 7 redirect fossils in `App.tsx`; move ~30 committed root screenshots out of repo root.

---

## Sequencing note
Wave 1 ships as its own PR (backend, correctness — needs careful review + the honesty tests green). Waves 2-3 ship as a frontend PR (or two). Each item is independently revertible.
