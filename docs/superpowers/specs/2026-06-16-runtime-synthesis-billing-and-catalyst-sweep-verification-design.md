# Runtime Synthesis → Billing & Catalyst-Sweep Verification — Design

**Date:** 2026-06-16
**Status:** Approved scope (A1 + A2-boundary + B), pending spec review.

## Problem

The production verify gate (`verify:matrices`, 60/60) asserts the billing
chain over **hand-seeded** RCAs: `seed-vantax` direct-inserts
`root_cause_analyses` (status='resolved', confidence 85), `causal_factors`
(impact_value>0), and `catalyst_actions` (`verification_status='verified'`).
It never exercises the path where the **system itself synthesizes** an RCA at
runtime, nor does it prove the ERP-anchor verification gate actually blocks
billing of an un-anchored claim. "Have we tested every catalyst all the way
through" exposed three gaps:

- **A1** — Runtime synthesis is cron-only (`runPhase10ChainForTenant`) and
  never asserted live: do synthesized RCAs + causal_factors come out
  well-formed and billable-shaped?
- **A2** — Synthesized → billed line item is never driven live, and the
  ERP-anchor gate (billing requires `verification_status='verified'`) is
  never proven to *exclude* an unverified claim.
- **B** — Only ~unit-level `dispatchAction` coverage exists; the live
  `execute` endpoint is never swept across every enabled sub-catalyst.

## Hard constraints (carried from standing rules)

- **No fabricated ERP anchor.** Every billed Rand traces to a real
  `verification_status='verified'` set by a real vendor verifier. The gate
  must not write `'verified'` by hand. (This is *why* A2 is boundary-shaped —
  see below.)
- **Never weaken the production MFA control.** The gate must not enroll a
  known TOTP seed on a real admin account, nor re-enable prod demo-login, nor
  bypass `stepUpMFA` on the user-facing approve route. The admin-ops endpoints
  below are SETUP_SECRET deploy-tooling that never touch the user MFA path.
- **D1 target safety.** Staging runs MUST set `VERIFY_D1_DB=atheon-db-staging`
  (default is prod). The new admin-ops endpoints are tenant-scoped by slug.

## Key architectural facts (verified in code)

- `runPhase10ChainForTenant` ([phase-10-analytics-runner.ts:53]) is the single
  live trigger for synthesis (metric_correlation → signal_attribution →
  cross_rca_synthesis → rca_closure → narrative → …). Best-effort per step.
- `seed-vantax` route does **not** run the chain; vantax carries the synthesis
  inputs (46 radar/signal/red-metric seeds) but has no HTTP trigger for it.
- Billing ([billing-engine.ts]) bills `root_cause_analyses` (status='resolved',
  confidence ≥ 0.70) JOIN `causal_factors` (impact_value>0) AND requires a
  prescription-linked `catalyst_actions` with `verification_status='verified'`.
- `verifyCompletedActions` ([erp-action-verification.ts:151]) reaches
  `'verified'` **only** via `verifyXeroAction` (real Xero invoice/payment
  lookup). Unknown/SAP vendor → `'deferred'`; stub/preview → `'skipped'`.
  vantax is a SAP connector → it cannot honestly reach `'verified'` over the
  real chain. The seed's `'verified'` is a direct-insert shortcut.

**Consequence:** A synthesized RCA on vantax/SAP can be driven live up to a
*completed, prescription-linked* action, but never to a real `'verified'`
state without a live Xero round-trip. So A2 proves the **integrity boundary**:
the chain is real up to verification, and billing correctly **excludes** the
synthesized RCA while its action is unverified. The positive billed path stays
covered by the existing seeded verified matrices. Nothing is fabricated.

## Design

### New product surface: SETUP_SECRET admin-ops route group

`workers/api/src/routes/admin-ops.ts`, mounted under `/api/v1/admin`, gated on
`X-Setup-Secret === env.SETUP_SECRET` (same gate as `demo-seed`,
`admin/migrate`). Three operations, each `{ tenant_slug }`-scoped:

1. `POST /api/v1/admin/run-phase10-chain` `{ tenant_slug }`
   → resolves tenant id by slug, calls `runPhase10ChainForTenant(env.DB, id)`,
   returns the `Phase10RunResult`. Live synthesis trigger for any tenant.

2. `POST /api/v1/admin/create-completed-action`
   `{ tenant_slug, rca_id }`
   → creates a real `diagnostic_prescriptions` row for the RCA (if none) and a
   `catalyst_actions` row linked via `source_finding_id = prescription.id`,
   `status='completed'`, `verification_status=NULL`, a non-stub `output_data`
   so verification will actually attempt (not skip). Returns the action id.
   This is test scaffolding for the dispatch step; it does **not** set
   `verification_status`.

3. `POST /api/v1/admin/run-action-verification` `{ tenant_slug }`
   → calls `verifyCompletedActions(env.DB, id)` (the same function the cron
   calls) and returns its counts. For SAP this yields `deferred`, proving the
   gate honestly does not verify.

Rationale for an endpoint over D1-direct: keeps the chain real (calls the same
runtime functions the cron/app call), is tenant-scoped, and mirrors the
existing deploy-tooling pattern. No MFA weakening (server-side, SETUP_SECRET).

### Verification client + gate (verification/)

- `verification/lib/client.ts`: add `runPhase10Chain()`,
  `createCompletedAction(rcaId)`, `runActionVerification()` — thin POSTs to the
  three endpoints, passing `CONFIG.tenantSlug` and `CONFIG.demoSecret`
  (SETUP_SECRET). Reuse existing retry/5xx handling.
- New matrix file `verification/matrices/runtime-synthesis.matrix.test.ts`.

### A1 — runtime synthesis traceability

After reseed (existing global-setup), the matrix:
1. `runPhase10Chain()`.
2. Fetch synthesized RCAs (those not present in the seed's known fixed set —
   identify by `created_at` ≥ chain run, or by `source='synthesis'`/synthesizer
   marker; plan resolves the exact discriminator from the synthesizer writer).
3. **Positive:** assert ≥1 synthesized RCA exists; each has
   `confidence ≥ 70`, ≥1 `causal_factors` with `impact_value>0`, evidence
   present, and `metric_id` resolves to a real metric.
4. **Negative:** assert no `causal_factors` row with `impact_value>0` exists for
   a metric below the 0.70 confidence floor / without an ERP anchor (proves the
   synthesizer does not emit billable factors from weak inference — aligns with
   the strong-inference rule: sample ≥25, mode share ≥70%).

### A2 — synthesized → billing boundary (negative control)

1. `runPhase10Chain()` → pick a synthesized, resolved RCA (or resolve one via
   the recovered-metric path if the chain leaves it open — plan decides whether
   to assert on already-resolved synthesized RCAs only).
2. `createCompletedAction(rcaId)` → real prescription-linked completed action.
3. `runActionVerification()` → assert the action's `verification_status` is
   `deferred`/`skipped` (NOT `verified`) for the SAP tenant.
4. `POST /api/billing/period` → assert the synthesized `rca_id` is **absent**
   from `line_items` (billing correctly refuses the un-anchored claim).
5. Assert the existing seeded verified RCAs **are** billed in the same run and
   `SUM(attributed_savings)` still reconciles — i.e. the negative control
   excludes only the un-anchored synthesized RCA, not everything.

This proves: synthesis is real, and the ERP-anchor gate is load-bearing.

### B — execute-path catalyst sweep

`verification/matrices/catalyst-execute-sweep.matrix.test.ts`, gated behind
`VERIFY_CATALYST_SWEEP=1` so it does not bloat default `verify:matrices`.

- Enumerate every **enabled** sub-catalyst from `CATALYST_CATALOG`
  ([catalyst-templates.ts]).
- For each: `client.executeSubCatalyst(subName)` (POST execute), assert:
  HTTP 200, run `status !== 'failed'`, payload is typed (not
  `generic_result`) and carries a timestamp.
- Report (not silently cap): log the count swept and any skipped (disabled /
  no-impl) so coverage is explicit.

## Components / files

- Create: `workers/api/src/routes/admin-ops.ts` (3 SETUP_SECRET ops)
- Modify: `workers/api/src/index.ts` (mount `/api/v1/admin` admin-ops)
- Create: `workers/api/src/__tests__/admin-ops.test.ts` (unit: gate + each op)
- Modify: `verification/lib/client.ts` (3 client methods)
- Create: `verification/matrices/runtime-synthesis.matrix.test.ts` (A1 + A2)
- Create: `verification/matrices/catalyst-execute-sweep.matrix.test.ts` (B,
  flag-gated)

## Testing

- Worker unit (`cd workers/api && npx vitest run`): admin-ops gate (401 without
  secret), each op happy-path against miniflare D1.
- Prod/staging verify (`verify:matrices`): A1 + A2 matrices run in default set;
  B runs only when `VERIFY_CATALYST_SWEEP=1`.
- Negative controls are first-class assertions, not afterthoughts (A1 step 4,
  A2 step 4).

## Out of scope / deferred

- **A2 positive (synthesized → real-verified → billed):** requires a live Xero
  sandbox connection + real invoice/payment round-trip. Documented limitation;
  revisit if Xero sandbox creds become available.
- Higgsfield full-UI redesign (separate queued track).

## Open items for the plan

- Exact discriminator for "synthesized vs seeded" RCA (synthesizer writer
  field vs `created_at` window).
- Whether A2 asserts only on already-resolved synthesized RCAs or also drives
  rca_closure via a recovered-metric nudge.
- Exact non-stub `output_data` shape for `create-completed-action` so
  `verifyAction` attempts (not skips) for the SAP vendor.
