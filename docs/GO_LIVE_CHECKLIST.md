# Atheon Go-Live Checklist

Last updated: 2026-04-27 (assessment overhaul + frontend-findings + demo seeder shipped)

This document tracks the gating items between the current production state and a clean go-live announcement. Items are grouped by tier: **Tier 1 (blockers)** must be resolved before the announcement; **Tier 2 (should-fix)** should be closed within the first week; **Tier 3 (deferred)** are known follow-ups tracked in the backlog.

## Assessment engine — go-live ready

The assessment engine is the lead-magnet that drives revenue. As of this update:

- [x] **40 detectors** across product (32) + service (8) domains, each with `value_at_risk_zar` derived from the prospect's actual ERP rows — never a fixed percentage. PRs #272, #274.
- [x] **Multi-currency normalisation** (USD / EUR / GBP / ZAR) — native amounts preserved on `currency_breakdown`, headline value normalised to ZAR via configurable rate table. PR #272.
- [x] **Multi-company / multinational** per-entity findings via `detectAllFindingsByCompany()`. Concentration findings stay at the consolidated level so they don't fragment across entities. PR #273.
- [x] **Service vs product detection** classifies tenants as product / service / mixed / unknown. Service detectors no-op cleanly for product-only tenants. PR #274.
- [x] **Catalyst gap closure** — every entry in `FINDING_CATALYST_MAP` resolves to a real-implementation sub-catalyst in `CATALYST_CATALOG`. New "Service Operations Catalyst" cluster. Round-trip enforced by test. PR #275.
- [x] **Business PDF report** renders one card per finding with severity ribbon, narrative, value-at-risk callout, sample records, and a "CURE: catalyst → sub-catalyst" footer. Per-entity summary page for multinationals. PR #276.
- [x] **Pulse + Apex wire-up** — every finding becomes a `process_metric`; high+critical findings additionally become `risk_alerts` with the resolving catalyst in `recommended_actions`. Idempotent across re-runs. PR #277.
- [x] **Frontend Findings tab** in AssessmentsPage — interactive list with severity filters, search, category filter, per-entity tabs, sample-record drill-down, and a Deploy button on each finding's recommended catalyst. PR #278.
- [x] **Trial flow** runs `detectAllFindings` alongside the legacy value-assessment engine; trial `/results` exposes `findings` + `findingsSummary`. Migration v51-trial-findings. PR #279.
- [x] **VantaX demo seeder** — `POST /api/v1/seed-vantax/seed-findings-demo` lights up all 40 detectors with ~280 deterministic fixture records so any sales demo runs against a fully-populated Findings tab. PR #280.

## Tier 1 — Blockers

- [ ] **MS_GRAPH_TENANT_ID is real**
  The production secret was observed set to the placeholder `test`, which causes `/forgot-password` to hang for ~45s on every request. PR #255 bounds the fetch at 5s and moves sends to `waitUntil`, so UX is no longer blocked, but **email delivery is still broken until the secret is corrected**. See [runbook §11](runbook.md#11-email--ms-graph-diagnostics).

- [ ] **Rotate `JWT_SECRET` and `ENCRYPTION_KEY` after the 2026-04 credential paste**
  A GitHub PAT and Cloudflare Global API Key were pasted into chat. They have been flagged for rotation. Until `JWT_SECRET` and `ENCRYPTION_KEY` are rotated (per [runbook §15](runbook.md#15-secret-rotation-drill-after-credential-leak)), treat all sessions and all encrypted ERP credentials as potentially compromised.

- [ ] **Re-login drill rehearsed**
  After `JWT_SECRET` rotation, every user must re-authenticate. Confirm the login page, forgot-password, and MFA challenge paths are all healthy on production before rotating. Validate via `e2e/tests/traceability.spec.ts` run against production or the staging mirror.

## Tier 2 — Should-fix in week 1

- [x] **CI flake: `@cloudflare/vitest-pool-workers` isolated storage** — fixed in PR #263. Set `poolOptions.workers.singleWorker = true` in `workers/api/vitest.config.ts`. CI fully green for the first time this sprint (12 / 12 checks); 341 / 341 tests pass in ~50s.

- [ ] **119 catalyst stubs**
  Post-sprint, the catalyst catalog has ~70 real handlers across 14 domains. 119 remain as registered stubs that return structured "not implemented" payloads. Prioritize by domain based on the first week of tenant activity; signal comes from `catalyst_runs` grouped by `catalyst_key`.

- [x] **LLM narrative reasoning layer** — shipped in PR #259 (`GET /catalysts/runs/:runId/narrative`, budget-aware, PII-redacted, KV-cached 24h, migration v48-narrative).

- [x] **Support ticket system** — shipped in PR #261 (schema v49-support, API routes, user list + detail pages, admin triage page, 20 integration tests).

- [ ] **Observability: Logpush destination**
  `wrangler tail` is the current story. Configure a Logpush destination (R2 or a log aggregator) so incident response has retention past the live tail window.

- [x] **CatalystRunDetailPage re-render loop** — fixed in PR #258. Root cause: `useToast()` returned a new object each render, polluting the `useCallback` deps of the data loaders, which invalidated the callbacks on every render and re-fired the boot `useEffect`. Fix: read `toast` through a `useRef` that is refreshed each render, drop `toast` from the loader deps. E2E regression assertion added — network calls to the run endpoint are now bounded.

## Tier 3 — Deferred (tracked, not gating)

- Real billing MRR surface in the admin UI (stubbed; tenant plans are the source of truth).
- Docker GHCR push permission fix for the self-hosted image pipeline.
- Deeper permission matrix tests for `iam_custom_roles` (unit-tested; no E2E yet).
- Playwright coverage for MFA enrollment + recovery codes beyond LoginPage assertions added in PR #256.

## Verifications completed during this sprint

- [x] **34+ PRs merged to `main`** — catalyst platform, multicompany ERP, security hardening, audit fixes, and ops docs.
- [x] **316 unit + integration tests passing** on `main`.
- [x] **Production Worker deployed** — `atheon-api.vantax.co.za` on the post-sprint build.
- [x] **Migration v47-platform applied** in production (`erp_companies`, `tenant_llm_usage`, `tenant_llm_budget`, `system_alert_rules`, `feature_flags`, `iam_custom_roles`, `support_tickets`).
- [x] **MFA enforcement with 14-day grace** — gated behind tenant flag, rollback-safe.
- [x] **Webhook HMAC signing + delivery log** — per-webhook secret, show-once, retries with backoff.
- [x] **LLM budget enforcement + PII redaction (7 rules)** — per-tenant daily caps in `tenant_llm_budget`.
- [x] **Request-ID middleware** — every response carries `X-Request-ID`; frontend propagates a correlated `fe-<16hex>` ID.
- [x] **ERP adapter timeouts** — `AbortSignal.timeout()` on every outbound ERP fetch; bounded retries.
- [x] **Catalyst DAG with cycle detection** — `MAX_CHAIN_DEPTH=5`, `wouldCreateCycle()` on dependency writes.
- [x] **Operator runbook** — [runbook.md](runbook.md) covers deploy, rollback, DB, KV, secret rotation, password-reset bypass, MS Graph diagnostics, LLM budget, webhook delivery.
- [x] **Feature audit + sprint record** — [FEATURE_AUDIT.md](FEATURE_AUDIT.md), [SPRINT_COMPLETE.md](SPRINT_COMPLETE.md).

## Day-of go-live steps

1. Confirm every Tier-1 box is checked.
2. Freeze merges to `main` 1 hour before the announcement.
3. Run the E2E suite against production: `npm run test:e2e -- --project=production`.
4. Tail the Worker during the first 30 minutes post-announcement:
   ```bash
   cd workers/api && npx wrangler tail --format pretty
   ```
5. Watch the `X-Request-ID` correlated error count; page oncall at >1% error rate over 5 minutes.
6. Capture a snapshot of `tenant_llm_usage`, `webhook_deliveries`, and `audit_log` at T+24h for post-launch review.
