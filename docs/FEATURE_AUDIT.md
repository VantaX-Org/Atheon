# Atheon Platform — Feature Audit

**Phase 1 of the system-wide review.** Read-only inventory; no code changes made. Compiled from four parallel audits (frontend, backend, catalysts, cross-cutting infra). Date: 2026-04-23.

This document exists to answer one question: *given a claim to be "world-class", where are we actually?*

---

## 1. Headline findings

The audit surfaced four findings that should shape Phase 2/3 priorities more than anything else:

### 1.1 The catalyst claim is materially misleading
Marketing says "60+ catalysts across finance, procurement, HR, mining, healthcare, FMCG, etc." The codebase has **65 cluster definitions** in [workers/api/src/services/catalyst-templates.ts](../workers/api/src/services/catalyst-templates.ts) — but only **finance/reconciliation and inventory** have real end-to-end execution logic. The other 60+ are toggleable template entries that, when executed, fall through to a generic read/count handler in [catalyst-engine.ts:328-339](../workers/api/src/services/catalyst-engine.ts). LLM post-processing gives the *appearance* of domain awareness without the substance. This is the single biggest gap between promise and product.

### 1.2 Significant dead code and duplication
- **~300KB of orphan services** never imported by any route: [assessment-engine.ts](../workers/api/src/services/assessment-engine.ts) (86KB), [value-assessment-engine.ts](../workers/api/src/services/value-assessment-engine.ts) (81KB), [compliance.ts](../workers/api/src/services/compliance.ts), [retention.ts](../workers/api/src/services/retention.ts), [logger.ts](../workers/api/src/services/logger.ts), [agent-hardening.ts](../workers/api/src/services/agent-hardening.ts), [onboarding.ts](../workers/api/src/services/onboarding.ts) (duplicate of routes/onboarding.ts), [erp-xero.ts](../workers/api/src/services/erp-xero.ts), [sentry.ts](../workers/api/src/services/sentry.ts) (barely wired).
- **Three v1/v2 duplicate engines**: [pattern-engine.ts](../workers/api/src/services/pattern-engine.ts) vs `-v2`, [radar-engine.ts](../workers/api/src/services/radar-engine.ts) vs `-v2`, [diagnostics-engine.ts](../workers/api/src/services/diagnostics-engine.ts) vs `-v2`. Only v2 imported; v1 is dead.
- **9 stub pages** with hardcoded mock data and no backend wiring: [BulkUserManagementPage](../src/pages/BulkUserManagementPage.tsx), [CompanyHealthPage](../src/pages/CompanyHealthPage.tsx), [CustomRoleBuilderPage](../src/pages/CustomRoleBuilderPage.tsx), [FeatureFlagsPage](../src/pages/FeatureFlagsPage.tsx), [IntegrationHealthPage](../src/pages/IntegrationHealthPage.tsx), [RevenueUsagePage](../src/pages/RevenueUsagePage.tsx), [SystemAlertsPage](../src/pages/SystemAlertsPage.tsx), [DataGovernancePage](../src/pages/DataGovernancePage.tsx) (partial), [MarketingPage](../src/pages/MarketingPage.tsx) (static).
- **3 overlapping dashboards**: [Dashboard.tsx](../src/pages/Dashboard.tsx), [ApexPage.tsx](../src/pages/ApexPage.tsx), [ExecutiveMobilePage.tsx](../src/pages/ExecutiveMobilePage.tsx).

### 1.3 Security posture is mid-tier, not enterprise
- JWT expiry 24h with no refresh/rotation ([middleware/auth.ts:81](../workers/api/src/middleware/auth.ts))
- MFA is optional, even for `superadmin` role
- ERP credentials: no visible encryption layer before DB insert in [erp-connector.ts:6-16](../workers/api/src/services/erp-connector.ts)
- DSAR exports written to R2 **unencrypted** ([tenants.ts:82-86](../workers/api/src/routes/tenants.ts))
- No PII redaction / prompt-injection hardening before LLM calls
- Login error messages leak account existence

### 1.4 ERP adapter reliability is weaker than the name suggests
Despite the file being called `erp-connector.ts` and circuit breakers being referenced elsewhere, the adapter has **no retries, no exponential backoff, no circuit breaker, no timeout** — a single entity fetch failure silently skips and the loop continues ([erp-connector.ts:91-126](../workers/api/src/services/erp-connector.ts)). Zero test coverage on any adapter.

---

## 2. Top 20 prioritized fixes (cross-cutting)

Ranked by (customer impact × risk) ÷ effort. The first eight are the ones I'd recommend for Phase 3 PRs.

| # | Fix | Area | Effort | Why it matters |
|---|-----|------|--------|---|
| 1 | Delete dead code (orphan services, v1 engines, onboarding duplicate) | Backend | S | -300KB deploy, clarifies active paths, removes confusion about which engine is live |
| 2 | Domain-specific catalyst handlers (at least healthcare, mining, HR, FMCG) replacing generic keyword routing | Catalysts | L | Closes the biggest product-vs-marketing gap. Converts 60+ "named only" catalysts into real value. |
| 3 | JWT refresh tokens + drop access-token TTL to 15m | Security | M | Reduces stolen-token window from 24h to 15m. Table-stakes for enterprise. |
| 4 | Enforce MFA for `admin`/`superadmin`/`system_admin` roles | Security | S | Platform takeover risk today if any admin account is compromised. |
| 5 | Encrypt ERP credentials at rest + add encryption helper | Security | M | Compliance + obvious breach vector |
| 6 | Add retry/backoff/circuit breaker to ERP adapters | Reliability | M | Today one network blip mid-sync = silent data loss |
| 7 | Global error boundary, toast system, skeleton loaders, confirmation dialogs on destructive actions | Frontend | M | 27 pages currently have no feedback on any mutation; blank screens on network errors |
| 8 | Add pagination + input validation to the ~16 routes missing it | Backend | M | Memory exhaustion risk on large tenants; silent data corruption on unvalidated POSTs |
| 9 | Wire up or delete the 9 stub admin pages | Frontend | M | Admin nav bloat; users see "working" UI that persists nothing |
| 10 | Consolidate 3 overlapping dashboards → single source of truth for health scoring | Frontend | M | Reduces maintenance, removes drift between Dashboard/Apex/Executive |
| 11 | Encrypt DSAR/PII exports before R2 write | Compliance | S | POPIA §3 breach vector |
| 12 | Request-ID middleware + propagate through logs & response headers | Observability | S | Support / incident investigation currently impossible |
| 13 | DLQ consumer for `catalyst-dlq` queue | Reliability | S | DLQ configured, nothing consumes it → failed tasks vanish |
| 14 | Prompt-injection hardening + PII redaction layer before LLM | Security | M | Unbounded data going to 3rd-party LLMs |
| 15 | Per-tenant LLM token budget + spend caps | Cost | M | Single malicious/buggy tenant can run up unbounded Claude/OpenAI spend |
| 16 | ERP adapter test suite (mock servers for SAP/Odoo/Xero/Sage/Pastel) | Tests | L | Currently 0% coverage on the most production-sensitive code |
| 17 | Audit-log export + retention policy | Compliance | S | Grows unbounded; no export for GDPR/POPIA audits |
| 18 | Webhook signature verification + retry w/ backoff | Integrations | M | Current `webhooks.ts` has no signing, no retry, no DLQ |
| 19 | Real SSO: OIDC discovery (`.well-known`), nonce validation, PKCE | Security | M | Current SSO is hardcoded-issuer, replay-vulnerable |
| 20 | Deduplicate cluster templates — make domain parameterizable | Catalysts | M | 65 hand-rolled cluster definitions could be ~20 with a `domain` parameter |

**Legend:** S = ≤1 day, M = 2–5 days, L = 1+ week per PR (of focused work)

---

## 3. State by product pillar

### 3.1 APEX (executive intelligence)

| Feature | State | Notes |
|---|---|---|
| Health scores (overall + dimensions) | solid | [ApexPage.tsx](../src/pages/ApexPage.tsx), [apex.ts](../workers/api/src/routes/apex.ts), [insights-engine.ts](../workers/api/src/services/insights-engine.ts); weights hardcoded, no tenant-level dimension customisation |
| Risk alerts | solid | Real data, but no search/filter/bulk-ops; "suggest causes" endpoint exists but UI not wired (see [FRONTEND_ENHANCEMENTS.md](../FRONTEND_ENHANCEMENTS.md) §2.1) |
| Executive briefing (LLM narrative) | solid | Generated nightly via cron; stored in `executive_briefings` |
| Scenarios / peer benchmarks | solid | Endpoints and UI both present |
| Board report generation | partial | [board-report-engine.ts](../workers/api/src/services/board-report-engine.ts), [board-report.ts](../workers/api/src/routes/board-report.ts); no scheduling, no distribution list, no template selection |
| Assessments | partial | [assessments.ts](../workers/api/src/routes/assessments.ts) imports orphan [assessment-engine.ts](../workers/api/src/services/assessment-engine.ts) (86KB) — but the orphan is only called from `scheduled.ts`, not from the route |

**Verdict**: APEX is the most finished pillar. The main gaps are UX polish (dashboard overlap, no loading states) and the orphaned-but-large assessment-engine that needs a decision — wire it up properly or delete.

### 3.2 PULSE (operational intelligence)

| Feature | State | Notes |
|---|---|---|
| Real-time metrics | solid | [pulse.ts](../workers/api/src/routes/pulse.ts), [PulsePage.tsx](../src/pages/PulsePage.tsx) |
| Anomaly detection | partial | UI exists but no filtering, no confidence-threshold tuning |
| Process mining / correlations | partial | Endpoints present, correlation graph missing in UI ([FRONTEND_ENHANCEMENTS.md](../FRONTEND_ENHANCEMENTS.md) §2.2.3) |
| Insights (LLM narratives per run) | solid | `run_insights` table populated |
| Realtime streaming (Durable Object `DashboardRoom`) | stub | [realtime.ts](../workers/api/src/routes/realtime.ts) has WS URL but no handshake validation, no role-based channels |

### 3.3 CATALYSTS

This is the pillar with the biggest gap. See §1.1 above for the headline. Detailed per-domain status:

| Domain | # Clusters | Real logic? | E2E viable against real ERP? |
|---|---|---|---|
| Finance | 6 | ✅ Full (recon, AP validation, bank rec, GR/IR) | **Yes** |
| Procurement | 1 | ⚠️ Partial (spend analytics) | Maybe |
| Supply chain | 3 | ⚠️ Partial (inventory query only) | Maybe |
| HR | 7 | ❌ Template only | No |
| Mining | 8 | ❌ Template only (uses generic handler + LLM wrap) | No |
| Healthcare | 8 | ❌ Template only | No |
| FMCG | 4 | ❌ Template only | No |
| Retail | 5 | ❌ Template only | No |
| Logistics | 3 | ❌ Template only | No |
| Tech / Manufacturing | 12 | ❌ Template only | No |

**Execution loop**: [catalysts.ts:1501](../workers/api/src/routes/catalysts.ts) routes to `performReconciliation/performValidation/performComparison`, all of which actually work end-to-end for finance data. Queue consumer in [scheduled.ts:54](../workers/api/src/services/scheduled.ts) is active. Task queue, DLQ, run analytics, exception raising, HITL approval — all wired and functional.

**Architectural issue**: `catalyst-engine.ts` routes actions by **keyword sniffing** (`if (actionLower.includes('invoice'))…`). No plugin/handler pattern. Adding a new domain requires editing this central file. That's why the other 55+ catalysts are stubs — there's no extension point.

**The `catalyst_dependencies` table exists but is never populated.** There's no DAG/orchestration despite the schema supporting it.

### 3.4 IAM / Auth

| Feature | State | Notes |
|---|---|---|
| Password auth + PBKDF2 hashing | solid | [auth.ts](../workers/api/src/routes/auth.ts) |
| JWT issuance | solid | HS256, 24h (too long) |
| JWT refresh | **missing** | Critical gap |
| MFA (TOTP) | partial | Implemented but optional — no backup codes, no SMS fallback, not enforced for admins |
| SSO (Microsoft Graph/Azure AD) | partial | Real HTTP calls; no OIDC discovery, no nonce, no PKCE |
| RBAC enforcement | solid | `requireRole` middleware consistently applied |
| Custom role builder | stub | [CustomRoleBuilderPage](../src/pages/CustomRoleBuilderPage.tsx) has no save handler |
| Multi-tenant isolation | solid with caveats | Tenant_id in WHERE clauses; [tenant.ts:57-58](../workers/api/src/middleware/tenant.ts) query-param override path needs hardening |
| Bulk user management | stub | [BulkUserManagementPage](../src/pages/BulkUserManagementPage.tsx) — no upload handler |
| API keys | solid | Generate, list, revoke all wired |

### 3.5 ERP integrations

| Adapter | Auth | Read ops | Write | Webhooks | Retry/CB | Tests |
|---|---|---|---|---|---|---|
| SAP S/4HANA | OAuth2 + Basic | ✅ partners/orders/materials/GL/invoices | ❌ | ❌ | ❌ | ❌ |
| Odoo | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Xero | OAuth2 | ✅ (+ orphan [erp-xero.ts](../workers/api/src/services/erp-xero.ts) duplicate) | ❌ | ❌ | ❌ | ❌ |
| Sage Business Cloud | OAuth2 | ✅ | ❌ | ❌ | ❌ | ❌ |
| Sage Pastel | API Key + session | ✅ | ❌ | ❌ | ❌ | ❌ |
| Salesforce | OAuth2 | ✅ | ❌ | ❌ | ❌ | ❌ |
| Workday | OAuth2 + Basic | ✅ | ❌ | ❌ | ❌ | ❌ |
| Oracle Fusion / NetSuite | OAuth2 + Basic | ✅ | ❌ | ❌ | ❌ | ❌ |
| MS Dynamics 365 | OAuth2 | ✅ | ❌ | ❌ | ❌ | ❌ |

**Pattern**: good breadth of adapters, all read-only, all fragile. No test for any of them.

### 3.6 Compliance (GDPR / POPIA)

| Capability | Implemented | Gap |
|---|---|---|
| DSAR export | ✅ [tenants.ts](../workers/api/src/routes/tenants.ts) | Written unencrypted to R2 |
| Right to erasure | ✅ (partial) | `erp_invoices` anonymised not deleted; `audit_log` rows remain with patterns intact |
| Audit logging | ✅ | No retention policy, grows forever |
| Consent management | ❌ | No `user_consent` table or opt-in flow |
| Privacy policy acceptance | ❌ | Not captured at signup |
| Data residency enforcement | ❌ | Region defaults to `af-south-1` but not locked down |
| DPA artifact generation | ❌ | No auto-generated DPA |
| Incident response runbook | ❌ | No documented plan |

Compliance messaging in marketing is **ahead of actual implementation.**

### 3.7 Observability / Ops

- **Logging**: [logger.ts](../workers/api/src/services/logger.ts) exists but isn't imported anywhere → all logging is via `console.log`
- **Sentry**: [sentry.ts](../workers/api/src/services/sentry.ts) (8KB) wired only into global handler in index.ts, not into route error handlers
- **Request IDs**: Logger supports them; no middleware generates them
- **Metrics**: None. No P50/P95/P99 latency, no error rates by endpoint, no LLM token accounting
- **Rollback**: No automated detection of broken deploys, no SOP
- **Migrations**: [migrate.ts](../workers/api/src/services/migrate.ts) uses `MIGRATION_VERSION = 'v39'` hardcoded; no schema_version table, no dry-run, no down-migrations

### 3.8 Tests

| Area | LOC | Coverage |
|---|---|---|
| Backend auth | 27KB | Good — password hashing, lockout, MFA challenge, token blacklist |
| Backend catalysts | 19KB | Moderate — submission, analytics, HITL |
| Backend integration (spec7) | 14KB | Moderate — E2E assessment → import → agent |
| Backend smoke | ~400 LOC | Basic |
| Backend email | 2.9KB | HTML sanitisation |
| **ERP adapters** | **0** | **None** |
| **LLM provider fallback** | **0** | **None** |
| **Webhook delivery** | **0** | **None** |
| **POPIA/GDPR erasure** | **0** | **None** |
| **Rate limiting middleware** | **0 (direct)** | Indirect only |
| Frontend | ~100 LOC | Minimal (3 util tests + 5 Playwright E2Es, not gated in CI) |

**Ratio**: ~1,663 test LOC for ~37,000 backend LOC ≈ 4.5%. Playwright exists but is not gated on merge.

---

## 4. Missing to be "world-class"

Framed against where comparable enterprise platforms (Celonis, UiPath Process Mining, Workday Adaptive) actually sit:

### 4.1 Platform gaps
- **No observability stack**: no metrics, no tracing, no SLOs/SLIs
- **No feature flag service** with persistence (the page is stub, backend doesn't exist)
- **No A/B / canary deploy** (referenced in [DeploymentsPage](../src/pages/DeploymentsPage.tsx) but not implemented)
- **No plugin/extension API** for customer-specific catalysts
- **No catalyst marketplace** (even internal)
- **No workflow designer** — catalyst dependencies table exists but no UI to build chains
- **No scenario/simulation** for catalysts ("what would this have caught last quarter?")

### 4.2 Security gaps
- SOC2 / ISO27001 posture: no audit-ready access reviews, no quarterly credential rotation, no documented SDLC
- No SIEM export (audit logs are local-only)
- No fine-grained object-level permissions (RBAC is role→resource, not role→instance)
- No IP allowlist per tenant
- No session management UI (users can't see/revoke own sessions)

### 4.3 Intelligence / product gaps
- **Forecasting**: current KPIs are point-in-time. No trending, forecasting, or "expected vs actual"
- **Causal analysis**: "suggest causes" endpoint exists, UI doesn't wire it
- **Comparative benchmarking**: peer benchmarks UI exists, data source unclear
- **Natural-language query**: [ChatPage](../src/pages/ChatPage.tsx) exists but no context injection, no action approval workflow
- **Mobile**: [ExecutiveMobilePage](../src/pages/ExecutiveMobilePage.tsx) is responsive-web, not a real mobile app
- **Embedded analytics / white-label**: no customer-branded reports beyond VantaX template
- **Real-time alerting to Slack/Teams/PagerDuty**: notifications are in-app only ([notifications.ts](../workers/api/src/services/notifications.ts))

### 4.4 ERP / integration gaps
- **Bidirectional write-back** to any ERP (all adapters are read-only today)
- **Incremental sync** (today each run is full fetch)
- **Webhook ingress** from ERPs for near-real-time updates
- **Field-level lineage / data quality scoring** on synced data
- **Schema drift detection** when ERP vendor changes their API shape

---

## 5. Duplication & dead-code inventory (safe-to-delete / consolidate)

Estimated cleanup in a single PR, low risk:

**Delete outright** (grep-verified unreferenced in Phase 2):
- [workers/api/src/services/compliance.ts](../workers/api/src/services/compliance.ts) — 9KB
- [workers/api/src/services/retention.ts](../workers/api/src/services/retention.ts) — 2.6KB
- [workers/api/src/services/logger.ts](../workers/api/src/services/logger.ts) — 2.9KB (**or** wire it up everywhere; currently nobody logs through it)
- [workers/api/src/services/onboarding.ts](../workers/api/src/services/onboarding.ts) — 8.4KB (duplicate of routes/onboarding.ts)
- [workers/api/src/services/erp-xero.ts](../workers/api/src/services/erp-xero.ts) — 6.2KB (logic already in main erp-connector.ts)
- [workers/api/src/services/pattern-engine.ts](../workers/api/src/services/pattern-engine.ts) — 21KB (v1; v2 is active)
- [workers/api/src/services/radar-engine.ts](../workers/api/src/services/radar-engine.ts) — 14KB (v1; v2 is active)
- [workers/api/src/services/diagnostics-engine.ts](../workers/api/src/services/diagnostics-engine.ts) — 17KB (v1; v2 is active)

**~82KB** of verifiably dead code. The earlier estimate of ~300KB was wrong (see §8 for corrections).

**Do NOT delete** — these looked unused but are imported (Phase 2 correction):
- `assessment-engine.ts` (86KB) — imported by [routes/assessments.ts:9](../workers/api/src/routes/assessments.ts)
- `value-assessment-engine.ts` (81KB) — imported by [routes/assessments.ts:14](../workers/api/src/routes/assessments.ts) and [routes/trial-assessment.ts:120](../workers/api/src/routes/trial-assessment.ts)
- `realtime.ts` (6KB) — imported by [index.ts:9](../workers/api/src/index.ts) (exports `DashboardRoom` Durable Object class)
- `agent-hardening.ts` (6KB) — imported by [services/agent.ts:19](../workers/api/src/services/agent.ts)
- `sentry.ts` (8KB) — imported by [index.ts:11](../workers/api/src/index.ts)

**Consolidate** (harder, should be deliberate):
- Admin tooling pages (12 separate) → 3 pages max (`/admin/platform`, `/admin/tenants`, `/admin/billing`)
- Dashboard / Apex / ExecutiveMobile → one Apex with responsive tiers
- 65 cluster templates → ~20 with `industry` parameter

---

## 6. Recommended Phase 3 plan

A set of discrete PRs, sequenced so each is reviewable on its own. Numbered in dependency order.

**Week 1 — stabilise**
1. PR: **Dead code purge** (~82KB, not 300KB — see §8). Low risk, opens up refactors.
2. PR: **Request-ID middleware + structured logging rollout** (wire up `logger.ts`). Prereq for everything else observable.
3. PR: **Delete/fix the 9 stub frontend pages**. Decision required up-front on which ones we keep.

**Week 2 — security must-haves**
4. PR: **Drop access-token TTL to 15m** (refresh tokens already exist — see §8.3). Enforce rotation, add blacklist-on-logout for access tokens.
5. PR: **Mandatory MFA for admin roles + backup codes**
6. PR: **ERP credential encryption at rest + DSAR export encryption**

**Week 3 — reliability**
7. PR: **ERP adapter resilience** (retry, backoff, circuit breaker, timeout) + first adapter test suite (SAP)
8. PR: **DLQ consumer for catalyst-dlq**, webhook retry/signing, pagination on 6 list endpoints

**Week 4+ — product**
9. PR: **Catalyst handler plugin system** — refactor `catalyst-engine.ts` from keyword-sniffing to a handler registry. No new domains yet, just the extension point.
10. PR: **First real non-finance domain** (recommend Healthcare or Mining — both have real customer demand and schema support).
11. PR: **Cluster template dedup** — parameterise by industry.
12. PR: **UX primitives pack** (toast, skeletons, error boundary, confirmation dialogs).

**Weeks 5–8 — world-class gaps**
13. Forecasting + trend UI on KPIs
14. Slack/Teams/PagerDuty notification sinks
15. Workflow/DAG designer for catalyst dependencies
16. Tenant-level LLM budget caps + PII redaction layer

---

## 7. What Phase 2 (validation sweep) should focus on

Before touching code:
- Run `npm run typecheck` and `npm test` in both `/` and `/workers/api/` — establish the baseline (pass/fail).
- Spin up `wrangler dev` and hit the top 10 suspect endpoints in §3 to confirm the audit is right (vs. dead grep hits).
- Click through the 9 stub pages in a local UI to confirm they really don't persist anything.
- Exercise catalyst execution against seeded VantaX data end-to-end and capture the run artifacts.

This confirms the audit before we start deleting and refactoring.

---

*Generated as Phase 1 deliverable. Source audits: frontend (35 pages), backend (39 routes / 37 services / 250+ endpoints), catalysts (65 clusters / 10 industries — later revised to 85 / 10 in Phase 2), infra (auth, ERP, tests, CI, deploy, LLM, compliance).*

---

## 8. Phase 2 validation results

Run on 2026-04-23 against commit `fac60c5` (main). This section records what the validation sweep **confirmed, contradicted, or refined** from §1–§7 above. Where Phase 1 and Phase 2 disagree, Phase 2 is authoritative.

### 8.1 Baseline: build + test health

| Check | Result | Notes |
|---|---|---|
| `tsc -b` (frontend) | ✅ pass, exit 0 | Clean typecheck |
| `tsc -b --noEmit` (workers/api) | ✅ pass, exit 0 | Clean typecheck |
| `vitest run` (frontend) | ✅ **57/57 pass**, 8 files, ~2s | — |
| `vitest run` (workers/api) | ✅ **113/113 pass**, 5 files, ~7.5s | — |
| CI gating | Typecheck + tests gated; Playwright E2E NOT gated | Matches §3.8 |

**Caveat**: auth tests spam real Azure AD calls (`getMsGraphToken` 400 errors in stderr) because email isn't mocked. Tests still pass — `sendOrQueueEmail` swallows the error — but this is a flakiness risk if CI loses network, and a cost risk (hitting Microsoft on every test run). *Added to Phase 3 backlog.*

### 8.2 Dead-code claim — audit overstated by ~3.6×

Phase 1 claimed "~300KB of orphan services, ~300KB deletable in one PR." Phase 2 grep verification shows the true deletable total is **~82KB**:

| File | Phase 1 verdict | Phase 2 verdict | Evidence |
|---|---|---|---|
| `assessment-engine.ts` (86KB) | orphan | **NOT orphan** | imported by `routes/assessments.ts:9` |
| `value-assessment-engine.ts` (81KB) | orphan | **NOT orphan** | imported by `routes/assessments.ts:14`, `routes/trial-assessment.ts:120` |
| `realtime.ts` (6KB) | orphan | **NOT orphan** | `index.ts:9` imports `DashboardRoom` Durable Object class |
| `agent-hardening.ts` (6KB) | orphan | **NOT orphan** | imported by `services/agent.ts:19` |
| `sentry.ts` (8KB) | "barely wired" | Wired for global error capture in `index.ts:11` | Present but not used in route handlers — accurate to call under-used, not dead |
| `compliance.ts` (9KB) | orphan | ✅ confirmed orphan | 0 imports |
| `retention.ts` (2.6KB) | orphan | ✅ confirmed orphan | 0 imports |
| `logger.ts` (2.9KB) | orphan | ✅ confirmed orphan | 0 imports — audit was right: nobody logs through it |
| `erp-xero.ts` (6KB) | orphan | ✅ confirmed orphan | 0 imports |
| `onboarding.ts` services (8KB) | orphan | ✅ confirmed orphan | 0 imports (dupe of `routes/onboarding.ts`) |
| `pattern-engine.ts` v1 (21KB) | dead (v2 active) | ✅ confirmed orphan | 0 imports |
| `radar-engine.ts` v1 (14KB) | dead (v2 active) | ✅ confirmed orphan | 0 imports |
| `diagnostics-engine.ts` v1 (17KB) | dead (v2 active) | ✅ confirmed orphan | 0 imports |

**Impact**: if we'd run PR #1 on the Phase 1 list verbatim, we'd have broken 3 routes and 1 service (assessment flows, trial assessment, realtime dashboard, agent registration). Phase 2 saved that outage. The corrected list in §5 is now accurate.

### 8.3 Security claims — mostly confirmed, one important correction

| Claim | Status | Evidence |
|---|---|---|
| JWT access token 24h (86400s) | ✅ **confirmed** | `middleware/auth.ts:81` (`exp: now + 86400`) + 6 other sites in `routes/auth.ts` |
| No refresh token mechanism | ❌ **WRONG** — refresh tokens exist | `routes/auth.ts:265-325`: UUID refresh tokens stored in KV with 7-day TTL, full rotation-on-use |
| Access token TTL still too long | ✅ **confirmed** — the 24h TTL is the real problem, not "no refresh" | Refresh works; access window is what needs shortening |
| MFA optional even for superadmins | ✅ **confirmed** | No `requireMfa` middleware anywhere; `mfa_enabled` is a per-user flag only |
| ERP credentials not encrypted before DB insert | ✅ **confirmed** | Zero `encrypt`/`decrypt`/`ENCRYPTION_KEY` references in `services/erp-connector.ts` |
| DSAR exports written unencrypted to R2 | ✅ **confirmed** | `routes/tenants.ts:82`: `STORAGE.put(key, exportPayload, { httpMetadata, customMetadata })` — no encryption wrapper |
| Tenant isolation query-param bypass risk | ⚠️ **overstated** | `middleware/tenant.ts:58` *does* reject mismatched `tenant_id` unless role ∈ {system_admin, superadmin, support_admin}. Check is correct; risk is theoretical (role-claim corruption) |
| Login error leaks account existence | ✅ **confirmed** | Auth tests show distinct error paths per cause |
| ERP adapters have no retry/backoff/circuit breaker | ✅ **confirmed** | `grep -E 'retry\|backoff\|circuitBreaker\|AbortSignal'` on `erp-connector.ts` returns 0 matches |

**Net**: Phase 3 plan's "JWT refresh tokens" PR should be re-scoped to "shorten access-token TTL + ensure refresh rotation is mandatory." The refresh infrastructure is there; the policy isn't.

### 8.4 Catalyst claim — Phase 1 understated the scale, didn't understate the gap

| Metric | Phase 1 claim | Phase 2 actual |
|---|---|---|
| Industries | 10 | **10** ✅ |
| Clusters | 65 | **85** — 30% more than reported |
| Sub-catalysts | "300+" | **406** total (310 enabled by default, 96 disabled) |
| Real action handlers in engine | "finance only" | **4 generic handlers** (`performReadAction`, `performNotifyAction`, `performInvestigateAction`, `performMutationAction`) — all keyword-routed, not domain-specific |
| Keyword routing pattern | claimed | ✅ **confirmed** — `actionLower.includes(...)` at 5+ sites in `services/catalyst-engine.ts` |

**Structural confirmation**: the engine has zero domain awareness. Every one of the 406 sub-catalysts falls through the same 4 handlers based on string matching the action name. So the gap from §1.1 stands — *the denominator is just larger than the audit claimed*: 85 clusters advertised, 2 real, 83 stubs.

### 8.5 Frontend stub pages — 100% confirmed

All 9 stub pages claimed in §1.2 have **zero `api.` calls and zero `fetch(` calls**. Verified by grep. Total LOC of UI-only mock code across these pages: **3,547 lines**. [MarketingPage](../src/pages/MarketingPage.tsx) alone is 1,517 lines of inline static content.

### 8.6 DLQ claim — confirmed

`wrangler.toml` declares `catalyst-dlq` as the dead-letter target for `catalyst-tasks`, but grep across the entire codebase shows **no queue consumer for `catalyst-dlq`**. Failed tasks accumulate with no handler.

### 8.7 Updated priority recommendations

Given Phase 2's findings, two items in the Phase 3 plan need resequencing:

1. **PR #1 (dead code purge)** — safe to proceed, but use the corrected §5 list (82KB, 8 files, not 300KB / 13 files).
2. **PR #4 (JWT refresh tokens)** — re-scope to "drop access-token TTL to 15m and make access-token reuse detectable" — refresh infrastructure is already in place.

Everything else in §6 holds.

### 8.8 What Phase 2 did NOT validate (deferred)

- **Live `wrangler dev` boot** — requires D1 + KV + R2 + Vectorize setup that isn't documented for local dev; skipped to avoid rabbit-holing. Recommend making this a Phase 3 "dev onboarding" side-quest.
- **Catalyst end-to-end run against seeded data** — same reason; code inspection + test pass (catalysts.test.ts 29 tests green) is sufficient signal for now.
- **Actual wire-level ERP adapter behaviour** — unreachable without real ERP credentials. The finding "no retry/CB/backoff" is structurally verified; runtime behaviour is untested (that's the point).

**Phase 2 verdict**: the audit is directionally right, three claims needed correction, and the Phase 3 plan stands with the two re-scopes noted above.
