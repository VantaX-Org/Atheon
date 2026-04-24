# Sprint completion summary

Single extended engineering cycle — 25 PRs shipped end-to-end (dead-code → catalyst platform rebuild → multicompany → security → frontend). Companion to [FEATURE_AUDIT.md](FEATURE_AUDIT.md).

Completed: 2026-04-24.

---

## What shipped

### Backend — Infra & catalyst platform (10 PRs)

| PR | Scope |
|---|---|
| [#213](https://github.com/VantaX-Org/Atheon/pull/213) | Dead-code purge — 8 orphan service files, ~82KB |
| [#214](https://github.com/VantaX-Org/Atheon/pull/214) | JWT access-token TTL 24h → 15m (refresh mechanism already existed) |
| [#215](https://github.com/VantaX-Org/Atheon/pull/215) | Flatten catalyst catalog (10 industries → 1 flat `CATALYST_CATALOG`); drop `tenants.industry` column |
| [#216](https://github.com/VantaX-Org/Atheon/pull/216) | Catalog polish — 10 outcome-focused renames, 3-dimension tag taxonomy, starter bundle refresh, SAP-jargon cleanup |
| [#217](https://github.com/VantaX-Org/Atheon/pull/217) | Expose `implementation: real/generic/stub` per sub-catalyst in `/templates` API |
| [#218](https://github.com/VantaX-Org/Atheon/pull/218) | +11 missing capability clusters (Tax, Audit, Treasury, GL Close, Recruitment, Engagement, Lean/CI, DQ/MDM, ESG, CDP, Compliance) |
| [#219](https://github.com/VantaX-Org/Atheon/pull/219) | `erp_companies` table + nullable `company_id` FK on 9 canonical tables + primary-company backfill |
| [#220](https://github.com/VantaX-Org/Atheon/pull/220) | Per-vendor company-identifier extraction (SAP BUKRS, Odoo company_id, Xero TenantId, NetSuite subsidiary, Dynamics companyId, Workday Company_Reference) + wire through sync path |
| [#227-#230](https://github.com/VantaX-Org/Atheon/pulls?q=227+228+229+230) | Catalyst handler stack — registry pattern, 10 domain handler groups (mining, manufacturing, logistics, retail, fmcg, agriculture, healthcare, technology, finserv, general), DAG orchestration with downstream triggers + cycle detection + depth cap |
| [#232](https://github.com/VantaX-Org/Atheon/pull/232) | Optional `?company_id=` scoping across all 50+ domain handlers; tenant-scoped tables intentionally ignore the filter; DAG propagates company through downstream triggers |

### Backend — Security, reliability, cost (6 PRs)

| PR | Scope |
|---|---|
| [#221](https://github.com/VantaX-Org/Atheon/pull/221) | Mandatory MFA for admin-tier roles + 14-day grace period + 8 backup codes per user + regenerate endpoint |
| [#222](https://github.com/VantaX-Org/Atheon/pull/222) | Request-ID middleware (accepts `X-Request-ID`, generates if absent, echoes in response, exposed via CORS) + structured JSON logger wired into 10 sites |
| [#223](https://github.com/VantaX-Org/Atheon/pull/223) | Encrypt DSAR exports in R2 + audit ERP credentials encryption on all write paths + `POST /admin/rotate-encryption` for key rotation |
| [#224](https://github.com/VantaX-Org/Atheon/pull/224) | `fetchWithRetry` helper wrapping all 35 adapter fetch sites: per-request timeout (20s data / 10s OAuth), exponential backoff with jitter, respects Retry-After, never retries 4xx |
| [#225](https://github.com/VantaX-Org/Atheon/pull/225) | Webhook HMAC-SHA256 signing + per-webhook secret (shown once) + `webhook_delivery_queue` table + exponential-backoff retry (30s/60s/120s/240s/480s) + dead-letter after 5 attempts |
| [#226](https://github.com/VantaX-Org/Atheon/pull/226) | Per-tenant LLM token budget (`tenant_llm_budget`) + usage audit (`tenant_llm_usage`) + 7-rule PII redaction layer (email, phone, SA-ID, credit card, SSN, IP, IBAN) before LLM calls |

### Frontend — UI parity (6 PRs)

| PR | Scope |
|---|---|
| [#233](https://github.com/VantaX-Org/Atheon/pull/233) | `ApiError` class carries `requestId`; every API call sends a `fe-<16hex>` X-Request-ID; error toasts display ID with copy-to-clipboard |
| [#234](https://github.com/VantaX-Org/Atheon/pull/234) | `/settings/mfa` wizard with QR code, backup codes show-once component, login supports both TOTP + `xxxx-xxxx` backup codes, Dashboard grace-period banner |
| [#235](https://github.com/VantaX-Org/Atheon/pull/235) | `/webhooks` list + create + detail drawer; secret-show-once reveal with copy/download/ack-checkbox/hard-confirm; deliveries table with 30s polling; receiver-side Node/Python verification docs |
| [#236](https://github.com/VantaX-Org/Atheon/pull/236) | `/admin/tenants/:id/llm` — superadmin budget + redaction admin with progress bar, Unlimited checkbox, audit note |
| [#237](https://github.com/VantaX-Org/Atheon/pull/237) | Company switcher in top nav; hides for single-company tenants; localStorage-persisted; threads `?company_id=` through Dashboard + Apex + Pulse + Catalysts |
| [#238](https://github.com/VantaX-Org/Atheon/pull/238) | Production/Partial/Planned maturity badges on industry cards and cluster rows; green/amber/grey dots per sub-catalyst; maturity filter; production-first sort |

### Housekeeping (3 PRs)

| PR | Scope |
|---|---|
| [#231](https://github.com/VantaX-Org/Atheon/pull/231) | Drop unused `_industry` param from `seedTenant` test helper (unblocked CI lint after rebase residue) |
| [#239](https://github.com/VantaX-Org/Atheon/pull/239) | This PR — `.claude/worktrees/` untracked and `.gitignore`-ed; completion summary |

---

## Architecture deltas

### Catalyst platform (biggest rebuild)

**Before**: 85 cluster templates defined under 10 hardcoded industry arrays. Single `catalyst-engine.ts::performAction` keyword-sniffed into four generic handlers. Only ~2 sub-catalysts (finance reconciliation, inventory query) had domain-specific logic. Tenants locked into one "industry" on signup that gated their template picker.

**After**:
- One flat `CATALYST_CATALOG` (75 clusters, 445 sub-catalysts) with 3-dimension tag taxonomy (`function:*` / `vertical:*` / `criticality:*` / `maturity:*`).
- `tenants.industry` column removed entirely. Templates no longer gated by industry.
- `catalyst-handler-registry` pattern: `registerHandler({ match, execute })` lets domain plugins win over generic defaults. Built-in defaults cover read/notify/investigate/mutation.
- **~70 sub-catalysts** now carry `implementation: 'real'` (domain handler), annotated on the catalog so API clients can tell real from generic from stub.
- DAG orchestration: `catalyst_dependencies` table (which existed but was unused) now drives downstream triggering — `triggerDownstream` runs after every successful sub-catalyst execution, chain depth capped at 5, cycle detection on dependency creation (`POST /dependencies` rejects cycles with 409).
- Every dispatch output carries a `_handler` field so `audit_log.details` traces which handler served the run.

### Multi-company ERP

New concept for the platform. `erp_companies(id, tenant_id, external_id, code, name, currency, country, is_primary, status)` with a `__primary__` row backfilled per tenant. Every canonical `erp_*` table gained nullable `company_id`. Adapters extract the vendor-specific company key (BUKRS for SAP, `company_id` for Odoo, `TenantId` for Xero, `subsidiary.id` for NetSuite, `companyid` for Dynamics, `Company_Reference.ID` for Workday) via `extractCompanyKey(sourceSystem, record)` and resolve via `resolveCompanyId` which upserts a stub company row on first sight. Catalyst queries optionally filter `WHERE tenant_id = ? AND company_id = ?`; default behaviour (no filter) aggregates across all companies.

### Security posture

| Area | Before | After |
|---|---|---|
| Access-token TTL | 24h | 15min (refresh rotation every 15m) |
| MFA for admins | Optional | Required with 14d grace |
| Backup codes | None | 8 per user, show-once, one-time-use |
| DSAR exports in R2 | Plaintext | AES-GCM encrypted + retrieve endpoint |
| ERP credentials | Plaintext risk | Encrypted on every write path + key-rotation helper |
| Webhooks | No signing, no retry | HMAC-SHA256 + replay window + 5-attempt backoff + DLQ |
| Error traceability | None | Request-ID threaded through every call + structured JSON logs |
| LLM budget | Unlimited per tenant | Per-tenant monthly cap + usage log + redaction opt-out |
| PII → LLM | Raw | 7-rule redaction before every call (per-tenant opt-out) |

### ERP adapter resilience

Every one of the 35 `fetch()` sites across the 11 vendor adapters now routes through `fetchWithRetry` with:
- Per-request timeout (default 20s for data, 10s for OAuth)
- Exponential backoff with jitter on 429/500/502/503/504 and network errors
- Respects `Retry-After` headers (capped at 60s)
- Never retries client errors (400/401/403/404/409)
- Circuit breaker (pre-existing) continues to wrap whole-connection failures

---

## Test coverage progression

| | Backend | Frontend |
|---|---|---|
| Start of sprint | 113 | ~70 |
| End of sprint | **269** | **91+** |
| Net new | +156 tests | +21 tests |

Every PR included its own test additions; all merges were green on CI lint + typecheck + test once the one stale `_industry` unused-param was fixed (PR #231).

---

## Production verification

Confirmed post-deploy on `atheon-api.vantax.co.za`:
- Healthz 200 in <1s with full security headers (X-Frame-Options, CSP, etc.)
- CORS properly scoped to `atheon.vantax.co.za`
- Auth gating correctly returns 401 on protected endpoints
- **Request-ID middleware working**: echoes client-sent `X-Request-ID`, auto-generates UUID when absent, exposes via `Access-Control-Expose-Headers`
- Login validation returns 400 on bad input, 401 on invalid credentials (all sub-second)
- 24 `Deploy Workers API` actions succeeded during the merge wave

---

## Known outstanding / follow-ups

Noted but deliberately deferred:

- **Docker GHCR push** — pre-existing `permission_denied: The requested installation does not exist` on `ghcr.io/reshigan/atheon-api`. Infrastructure fix (GitHub App install or PAT with `write:packages`), not code.
- **Tests for ERP adapter write-back** — adapters are read-only today; when write-back lands (PUT invoice, POST PO, etc.), they'll need dedicated tests.
- **Observability destination** — structured logger + request-ID emit JSON to `console.log`; Cloudflare captures it but there's no Logpush → Datadog/Honeycomb configured yet.
- **Catalyst stub implementations** — the catalog has 119 `implementation: 'stub'` sub-catalysts (e.g. Clinical Readmission, Thermal Imaging, Carbon Credit). They return generic dispatch output until real handlers are built.
- **Frontend test coverage** — grew from ~70 to 91; still minimal vs backend's 269. Playwright E2E still not gated in CI.
- **Auth tests make real Azure AD calls** — test suite still hits `login.microsoftonline.com` for `getMsGraphToken`; flakiness + cost risk. Email should be mocked in tests.

---

## Roadmap from here (if continuing)

Sketched, not scoped:

1. **Catalyst LLM-reasoning layer** — feed each domain handler's structured output into the LLM for narrative recommendations. Infrastructure is there (`llm-provider.ts` + budget enforcement + PII redaction); just needs wiring per handler.
2. **Per-company catalyst fan-out** — scheduled.ts cron could automatically fan a catalyst run across all companies in a tenant when `catalyst.run_mode = 'all_companies'`. Today you run per-company or consolidated by explicit selection.
3. **DAG chain UI** — backend supports chains via `catalyst_dependencies` and propagated `chainDepth`; UI could render "this run was triggered by ..." and "triggered N downstream runs" in the action detail drawer.
4. **Multicompany invite flow** — today `__primary__` auto-created. Tenants with real multicompany want to explicitly register their 2nd/3rd company with the correct vendor external_id.
5. **Close the remaining 119 stub sub-catalysts** — each one becomes a handler file addition against real data. Track in a spreadsheet or issue list.

---

*Generated 2026-04-24 as the close-out doc for this sprint. Source audits: [FEATURE_AUDIT.md](FEATURE_AUDIT.md) §1–§8.*
