# Wave G — Spec-Gap Sprint Scope

Last updated: 2026-06-08

This document scopes the 23 remaining spec gaps surfaced by **PART 1 (Build Integrity & Audience-Fit)** of the production-go-live master playbook into discrete sprint tickets. Compiled from [FEATURE_AUDIT.md](FEATURE_AUDIT.md), [GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md), [GO_LIVE_SPRINT.md](GO_LIVE_SPRINT.md), and the `personas_and_roles` memory entry.

**Status mapping:**
- **MISSING** — the requirement has no implementation at all.
- **PARTIAL** — implementation exists but is wired only partially (orphan engines, UI without backend, schema without consumer, etc.).

Waves A–F (security + a11y + design tokens + 5-tier elevation) shipped on `main` at commits `b5c0625` and `271c1c3`. The deploy + VantaX reseed verification runs in parallel and is tracked separately.

---

## MISSING (5)

### G-M1 — JWT refresh tokens + short access TTL
**Source:** FEATURE_AUDIT §1.3, §3.4; Top-20 #3.
**Why:** Access tokens live 24h with no refresh/rotation; a stolen JWT is valid for a full day. Enterprise table-stakes is ≤15m access + a server-side refresh table.
**Scope:**
- Migration: `auth_refresh_tokens (id, user_id, tenant_id, hashed_token, expires_at, revoked_at, ip_first_seen, ua_first_seen)`.
- Auth route: `POST /api/v1/auth/refresh` rotates refresh + issues a new 15m access.
- Middleware: short-circuit expired access tokens and instruct the frontend to call refresh.
- Frontend: silent-refresh in fetch wrapper; logout on refresh failure.
- Tests: rotation, reuse-detection (revoke chain), revoke-on-password-change.
**Effort:** M (3–4 days).
**Owner:** backend + frontend pair.

### G-M2 — `catalyst_dependencies` DAG orchestration
**Source:** FEATURE_AUDIT §3.3 (schema exists, never populated).
**Why:** Some catalysts must run *after* others (recon then variance, GR/IR then AP-validation). Today every run is treated as a standalone island, which forces customers to manually order things and re-run on failures.
**Scope:**
- Engine: topological-sort the dependency graph at scheduling time; mark downstream runs `blocked` while upstream is pending.
- Seed: populate `catalyst_dependencies` for the 14 real-handler domains (finance/recon/inventory/spend etc.).
- Queue consumer: respect `blocked` status; release on upstream `succeeded`.
- UI: lightweight DAG view on `CatalystRunDetailPage` showing what this run is waiting on / blocking.
- Tests: cycle detection, partial-failure containment, idempotent re-runs.
**Effort:** M (4–5 days).
**Owner:** backend.

### G-M3 — DLQ consumer for `catalyst-dlq`
**Source:** FEATURE_AUDIT Top-20 #13; GO_LIVE_CHECKLIST Tier-2.
**Why:** The DLQ is configured in `wrangler.toml` but nothing consumes it — failed catalyst tasks vanish silently. Customers need either retry-with-backoff or a "stuck task" surface in the admin UI.
**Scope:**
- Consumer: new Queue handler that re-enqueues with exponential backoff (max 3 retries), then writes to `catalyst_runs.status = 'permanently_failed'` with the last error envelope.
- Admin UI: "Stuck tasks" panel on `SystemAlertsPage` (also closes G-P9).
- Alert: trigger an executive briefing item when DLQ rate > 1%/hour.
- Tests: backoff curve, max-retry hardstop, re-queue idempotency.
**Effort:** S (2 days).
**Owner:** backend.

### G-M4 — Audit-log export endpoint
**Source:** FEATURE_AUDIT Top-20 #17 (retention purge shipped 2026-05-11, export still missing).
**Why:** POPIA / GDPR audits require time-bounded export of all audit events for a tenant. We retain 365d in D1 but provide no way to extract.
**Scope:**
- Route: `POST /api/v1/audit/export` with `from`, `to`, optional `subject_user_id`; returns AES-256-GCM-wrapped envelope (same pattern as DSAR access export).
- Storage: stream to R2 keyed by `tenant_id/audit-YYYYMMDD-YYYYMMDD.jsonl.enc`.
- Decrypt route: `POST /api/v1/audit/export/:id/decrypt` requires fresh admin auth, mirror of DSAR pattern.
- Admin UI: button on `AuditPage` (`Export…`) → opens a date-range modal.
- Tests: tenant scoping, encryption envelope, large-tenant chunking.
**Effort:** S (1.5 days).
**Owner:** backend + small frontend.

### G-M5 — `auditor` + `board_member` IAM roles
**Source:** `personas_and_roles` memory entry; biggest sales-blocker for enterprise pitches.
**Why:** External auditors and board members are present in 11 of 11 enterprise personas. We currently force them to share `admin` (privileged) or `viewer` (no audit access). Auditors need read-all-audit-events + read-all-provenance + no-write. Board members need exec-briefings + board-reports + risk-alerts and nothing else.
**Scope:**
- Seed: extend `iam_custom_roles` defaults with `auditor` and `board_member` plus their permission sets.
- Middleware: enforce the new permission scopes on the existing routes (no new routes needed; just gate existing ones).
- Frontend: hide nav items based on role-permission matrix; ensure both roles see the persistent CFO shared-savings strip (see G-P6).
- Tests: permission matrix coverage; both roles cannot mutate.
**Effort:** S (1.5 days).
**Owner:** backend + frontend.

---

## PARTIAL (18)

### G-P1 — Board report scheduling + distribution + template selection
**Source:** FEATURE_AUDIT §3.1.
**Why:** Engine ships; cadence/recipients/templates do not. Board members never receive the report we generate.
**Scope:** Migration `board_report_schedules`, weekly/monthly cron, MS Graph send-as, three templates (annual / quarterly / monthly), template picker on `BoardReportPage`.
**Effort:** M (3 days).

### G-P2 — Assessments engine wired from the assessments route
**Source:** FEATURE_AUDIT §3.1 (`assessment-engine.ts` only called from `scheduled.ts`).
**Why:** The 40-detector engine is the lead-magnet billing artefact. The HTTP route should drive it the same way cron does.
**Scope:** Route `POST /api/v1/assessments/run` → engine; persist `assessment_id` + `business_report_key`; surface in the AssessmentsPage Findings tab. Confirm cron and route share the same code path.
**Effort:** S (1.5 days).

### G-P3 — Anomaly detection filtering + threshold tuning
**Source:** FEATURE_AUDIT §3.2.
**Why:** UI shows anomalies but offers no filter, no tenant-level confidence threshold, no per-metric mute.
**Scope:** Filter by metric / severity / time range; per-tenant `confidence_threshold` (default 0.7) settable on Settings → Pulse; mute action persisted to `metric_mutes`.
**Effort:** M (3 days).

### G-P4 — Process-mining correlation graph in UI
**Source:** FEATURE_AUDIT §3.2; FRONTEND_ENHANCEMENTS.md §2.2.3.
**Why:** Backend produces `correlation_events`; frontend has no visualisation.
**Scope:** Force-directed graph on `PulsePage` (`react-force-graph-2d`); click a node to drill to the metric; export PNG for board reports.
**Effort:** M (3 days).

### G-P5 — Realtime streaming hardening
**Source:** FEATURE_AUDIT §3.2.
**Why:** Durable Object `DashboardRoom` ships but accepts any WS with no role check or handshake validation.
**Scope:** JWT verification on `WebSocket` upgrade; channel ACL keyed off role (auditor/board_member see read-only); ping/pong heartbeat; reconnect with exponential backoff on the client.
**Effort:** M (3 days).

### G-P6 — Persistent CFO shared-savings strip
**Source:** `personas_and_roles` + `business_model_shared_savings` memory; missing in current exec dashboard.
**Why:** Shared-savings is the revenue model. The CFO persona should always see the rolling 30/90/QTD/YTD claimed-dollar number with drill-through to ERP records.
**Scope:** New `<SharedSavingsStrip>` component pinned above `ApexPage` + `Dashboard` for CFO / board_member / auditor; clicking opens the `BillablePeriodDetailPage` (already exists).
**Effort:** S (1.5 days).

### G-P7 — Stub admin pages: wire or delete
**Source:** FEATURE_AUDIT §1.2.
**Why:** 7 admin pages still render mock data: `BulkUserManagementPage`, `CompanyHealthPage`, `CustomRoleBuilderPage`, `FeatureFlagsPage`, `IntegrationHealthPage`, `RevenueUsagePage`, `SystemAlertsPage`.
**Scope:** Per-page decision in this sprint. Tentative: wire `BulkUserManagement`, `CustomRoleBuilder`, `IntegrationHealth`, `SystemAlerts` (real value); delete `CompanyHealth`, `FeatureFlags`, `RevenueUsage` (out-of-scope for v1). Update routing + nav.
**Effort:** L (5–6 days across the four to wire).

### G-P8 — Dashboard consolidation
**Source:** FEATURE_AUDIT §1.2.
**Why:** `Dashboard.tsx` + `ApexPage.tsx` + `ExecutiveMobilePage.tsx` overlap with drifting health scoring.
**Scope:** Make `ApexPage` the single source of truth. `Dashboard` becomes a thin index that redirects authenticated users to `Apex`. `ExecutiveMobile` collapsed into a responsive `Apex` layout (no separate route).
**Effort:** M (3 days).

### G-P9 — MFA enforcement for privileged roles
**Source:** FEATURE_AUDIT Top-20 #4.
**Why:** MFA is optional for `superadmin` / `system_admin` / `admin`. Platform-takeover risk.
**Scope:** Server-side `mfa_required_roles` env var (default `superadmin,system_admin,admin`); login flow refuses session issuance without MFA for those roles; grace-period banner for existing admins to enroll within 7d, then hard-block.
**Effort:** S (1.5 days).

### G-P10 — Per-tenant LLM token budget + spend caps
**Source:** FEATURE_AUDIT Top-20 #15.
**Why:** A single misbehaving tenant can run up unbounded Claude/OpenAI spend. We already track `tenant_llm_usage`; we don't gate on it.
**Scope:** Migration: `tenant_llm_budgets (tenant_id, plan, monthly_token_cap, hard_cap)`. Middleware checks remaining budget before LLM call; soft-warning at 80%, hard-block at 100% (return cached narrative or "budget exhausted" status). Admin UI page to view + edit per-tenant caps.
**Effort:** M (3 days).

### G-P11 — ERP adapter retry / backoff / circuit-breaker
**Source:** FEATURE_AUDIT §1.4, Top-20 #6.
**Why:** Today a single network blip mid-sync silently drops an entity and the loop continues.
**Scope:** Wrap `erp-connector.ts` `fetchEntities` in retry-with-jitter (max 3 attempts, base 500ms × 2^n); circuit-breaker opens after 5 consecutive failures with 60s cooldown; failures recorded to `erp_sync_failures` for the SystemAlertsPage.
**Effort:** M (3 days).

### G-P12 — ERP adapter test suite (SAP / Odoo / Xero / Sage / Pastel mocks)
**Source:** FEATURE_AUDIT Top-20 #16.
**Why:** Zero adapter test coverage on the most production-sensitive code.
**Scope:** MSW mock servers per adapter; one happy-path + three failure-mode tests per adapter (timeout / 401 / malformed payload). Wire into `vitest-pool-workers`.
**Effort:** L (5 days).

### G-P13 — Pagination + input validation on the remaining ~16 routes
**Source:** FEATURE_AUDIT Top-20 #8.
**Why:** Memory-exhaustion risk on large tenants; silent data corruption on unvalidated POSTs.
**Scope:** Audit `workers/api/src/routes/*` for routes returning unbounded arrays or accepting arbitrary JSON; add `paginate({limit, cursor})` helper + `zod` schemas. Block oversize payloads at the middleware.
**Effort:** M (4 days).

### G-P14 — Webhook signature verification + retry + DLQ
**Source:** FEATURE_AUDIT Top-20 #18.
**Why:** `webhooks.ts` has no signing, no retry, no DLQ. Customers cannot trust outbound events.
**Scope:** HMAC-SHA256 signature header keyed off per-tenant `webhook_secret`; retry-with-backoff (5 attempts over 15min); failures → `webhook_dlq` consumed by G-M3.
**Effort:** M (3 days).

### G-P15 — Real SSO: OIDC discovery + nonce + PKCE
**Source:** FEATURE_AUDIT Top-20 #19.
**Why:** Current SSO has a hardcoded issuer and is replay-vulnerable.
**Scope:** OIDC `.well-known/openid-configuration` discovery; nonce validation; PKCE for the Auth Code flow; per-tenant `oidc_provider_config` row.
**Effort:** M (4 days).

### G-P16 — Deduplicate cluster templates → `domain` parameter
**Source:** FEATURE_AUDIT Top-20 #20.
**Why:** 65 hand-rolled cluster definitions could be ~20 with a `domain` parameter. Today adding a domain means editing the central file.
**Scope:** Refactor `catalyst-templates.ts` to be `{ template, domain }` × N; engine routes by `(template, domain)`. Backward-compat migration that maps existing rows.
**Effort:** M (4 days).

### G-P17 — Request-ID middleware + log propagation
**Source:** FEATURE_AUDIT Top-20 #12.
**Why:** Support and incident investigation are impossible without a correlation id.
**Scope:** Generate `request_id` on every inbound request; propagate through `c.set('requestId')`; include in every `console.log` / Sentry breadcrumb / response header (`X-Request-Id`).
**Effort:** S (1 day).

### G-P18 — Real catalyst handlers for HR / mining / healthcare / FMCG / retail / logistics / tech / manufacturing
**Source:** FEATURE_AUDIT §1.1, §3.3, Top-20 #2.
**Why:** This is the biggest single product-vs-marketing gap. 119 sub-catalysts return structured "not implemented" today. Pick the top-2 by tenant signal (likely HR + mining).
**Scope (Phase 1, this sprint):** Wire 8 real handlers — 4 HR (payroll-variance, leave-accrual-recon, contractor-flag, comp-band-drift), 4 mining (assay-drift, fleet-utilization-gap, blast-pattern-variance, grade-control-recon). Schema: each handler returns `findings` keyed to `value_at_risk_zar` derived from real ERP rows (no fixed percentages). Test: 4 × 4 fixture tenants, snapshot-validated.
**Effort:** L (8+ days) — track as its own sprint; this ticket scopes Phase 1 only.

---

## Severity + ordering

| Tier | Tickets | Rationale |
|---|---|---|
| **Tier 1 (week 1)** | G-M1, G-M3, G-P9, G-P17 | Security + observability table-stakes; cannot announce without them. |
| **Tier 2 (week 2–3)** | G-M4, G-M5, G-P6, G-P7, G-P11, G-P13 | Enterprise persona + reliability + admin-page cleanup. |
| **Tier 3 (week 4+)** | G-M2, G-P1, G-P2, G-P3, G-P4, G-P5, G-P8, G-P10, G-P12, G-P14, G-P15, G-P16, G-P18 | Depth + polish; sequence after Tier 1+2 close. |

## Out of scope for Wave G

- Deletion of v1 engines + orphan services (already tracked separately as dead-code sweep).
- POPIA §3 work beyond audit export (already shipped).
- New marketing surfaces (e.g. /trust page is shipped; further marketing is not engineering-gated).
- Anything in PART 2 (layout/spacing) — that's a separate sweep.

## Tracking

When each ticket lands, mark the corresponding line in [GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md) and remove from this list. The list is closed when all 23 are either shipped or explicitly deferred with a one-line reason here.
