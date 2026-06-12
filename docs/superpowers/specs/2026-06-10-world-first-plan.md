# Atheon — World-First Roadmap

## 1. Executive Summary

Atheon is solid as a regional Enterprise Intelligence Platform: 12 ERP connectors live (`workers/api/src/services/erp-*-live.ts`), Obsidian Authority design system shipped (`src/index.css:1-500`), comprehensive RBAC with 11 roles (`workers/api/src/routes/iam.ts:7-13`), automated DR drills (`verification/dr/restore-drill.ts`), and a shared-savings billing engine wired to verified outcomes (`workers/api/src/services/billing-engine.ts:1-200`). The gap to world-first is not feature breadth — it is *audit-grade defensibility* of the savings claim. Assessment findings are mutable post-creation (`value-assessment-engine.ts:2144-2156`), lack source ERP record IDs (`assessment-findings.ts:108-118`), fire below the 25-record threshold the memory rule requires, and board-report generation has no audit log (`routes/board-report.ts:22-33`). Until every claimed dollar is cryptographically traceable to an immutable ERP record + confidence score + approver signature, the shared-savings model is rhetoric, not contract-grade.

The strategic thesis: Atheon wins the category not by being a prettier dashboard but by being the first platform where the CFO can hand the auditor a signed PDF and say "every cent we paid Atheon is provable." Three world-first bets follow from this: (a) an **audit-grade savings ledger** with Merkle-chained provenance, (b) a **multi-ERP provenance graph** that maps SAP/Oracle/NetSuite/Sage/Xero into a single ontology so claims survive ERP migrations, and (c) a **board pack autopilot** that compiles persona-specific board-ready PDFs in one click. Everything else — partner SDK auto-gen, COOP/COEP, role-switcher widget — is table stakes that must be cleared so the three bets can be sold.

Headline plan: **Phase 1 (30d): defensibility & demo-day.** Lock findings, add provenance IDs, ship CFO strip everywhere, COOP/COEP, board-digest PDF, demo reskin UI. **Phase 2 (90d): provenance graph & ledger v1.** ERP ontology, Merkle audit chain, outcome tracking, per-finding confidence explainers, inference feedback loop. **Phase 3 (180–365d): category-defining.** Board pack autopilot per persona, partner SDK auto-gen, federation benchmarking, BYOK LLM, GraphQL bulk layer.

## 2. What's Solid Today

**Frontend / Design Bar**
- Obsidian Authority theme with 5-tier elevation + 7-scale typography — `src/index.css:1-500`
- Sidebar IA covers 11 roles incl. auditor + board_member — `src/components/layout/Sidebar.tsx:1-442`
- SharedSavingsStrip (banner + hero variants) — `src/components/SharedSavingsStrip.tsx:1-125`
- State primitives (loading/error/empty) via AsyncPageContent — `src/components/ui/state.tsx`, `async.tsx`
- Single Card primitive enforced, freelance text-[Npx] purged — `src/components/ui/card.tsx:1-82`, `src/index.css:258-274`
- Motion respects prefers-reduced-motion — `src/index.css:400-500`

**API / RBAC / Auth**
- 11-role hierarchy incl. auditor(30) + board_member(80) — `workers/api/src/routes/iam.ts:7-13`
- JWT + token-hashed KV lookup (Bug #13 fix) — `workers/api/src/middleware/tenant.ts:35-40`
- Setup/migrate endpoints gated by SETUP_SECRET with constant-time compare — `workers/api/src/index.ts:717-728`
- Rate limiters across 9 verticals (auth/AI/billing/DSAR/license) — `workers/api/src/middleware/ratelimit.ts:1-187`
- SCIM 2.0 with hashed bearer tokens — `workers/api/src/routes/scim.ts`, `middleware/scim-auth.ts`
- Audit-share public token (7d TTL, revocable) — `workers/api/src/routes/audit-share.ts:21-93`

**Detection / Billing**
- 30+ finding detectors with severity + financial impact — `workers/api/src/services/assessment-findings.ts:1-1076`
- 4-phase Value Assessment Engine — `workers/api/src/services/value-assessment-engine.ts:79-135`
- Inference calibration table (MIN_SAMPLE_SIZE=25 observed) — `workers/api/src/services/inference-calibration.ts:1-150`
- Billing engine gates on resolved + verified actions + impact>0 — `workers/api/src/services/billing-engine.ts:1-200`

**Ops / Security**
- HSTS preload + CSP + SameSite=Strict — `workers/api/src/index.ts:117-169`
- Sentry + APM + structured JSON logs with requestId — `workers/api/src/services/sentry.ts`, `apm.ts`, `logger.ts`
- Nightly D1 backups to R2 (30d/12mo retention) — `.github/workflows/backup-d1.yml`
- Automated DR restore drill — `verification/dr/restore-drill.ts`
- Go-live verification gate blocks promotion — `.github/workflows/go-live-gate.yml`
- 85 API unit tests + 11 Playwright E2E — `workers/api/src/__tests__/`

**Demo / GTM**
- Reskinnable VantaX seed (prospectName, industry, legal name) — `workers/api/src/routes/seed-vantax.ts:139-171`
- Reset + status + findings-seed endpoints — `workers/api/src/routes/seed-vantax.ts:3831-3943, 3946-4380`
- SA-realistic data (Sasol, Pick n Pay, Vodacom etc.) — `workers/api/src/routes/seed-vantax.ts:43-103`
- 1170-line Swiss-editorial marketing page — `src/pages/MarketingPage.tsx:1-1170`
- Impersonation for sales demos (15-min, audited) — `src/pages/ImpersonationPage.tsx`

**Integration / Extensibility**
- 12 ERP connectors with OAuth2 + rate-limit handling — `workers/api/src/services/erp-*-live.ts`
- HMAC-SHA256 signed webhooks + replay protection + DLQ — `workers/api/src/services/webhook-signer.ts:1-140`, `webhook-delivery.ts:1-274`
- TS + Python SDKs published — `sdks/typescript/`, `sdks/python/`
- LLM provider abstraction with trade-secret enforcement — `workers/api/src/services/llm-provider.ts:11-12`

## 3. Gap Analysis vs World-First Bar

### 3.1 Shared-Savings Data Model & Provenance (the core defensibility gap)

| # | Gap | Why It Matters | Evidence | Severity | Days |
|---|---|---|---|---|---|
| 1 | Findings lack persistent ERP record ID | Memory rule: every $ traces to specific ERP record(s). Customer dispute → no programmatic retrieval. | `assessment-findings.ts:108-118` (SampleRecord has `ref` string only, no `id`); `migrate.ts` assessment_findings has no `erp_record_id` | blocker | 5 |
| 2 | Findings mutable post-approval | `finding_insight` UPDATE-ed after creation; no `approval_status`, `locked_at`, `approved_by`. Cannot prove claim wasn't retroactively altered. | `value-assessment-engine.ts:2144-2156` | blocker | 3 |
| 3 | No per-field mapping confidence | Inference rule requires `evidence.source` (default/inferred/human/low-confidence). `evidence_quality` is one bucket from monthsOfData only. | `assessment-findings.ts:348-353`; no `erp_field_mappings` integration | high | 8 |
| 4 | Detectors fire below sample-size threshold | Memory: ≥25 records, ≥70% mode share. Detectors return makeFinding() on `rows.length > 0`. 3 invoices treated as 300. | `assessment-findings.ts:467-541, 676-734, 795-845` | high | 6 |
| 5 | No outcome tracking (claimed→realized→invoiced) | Cannot prove "claimed $500k, realized $520k, billed $104k" at renewal. catalyst_simulations isolated from billing. | `migrate.ts` (no `realized_value` on assessment_findings); `billing-engine.ts:39-66` | high | 10 |
| 6 | Confidence buckets too coarse, no customer explainer | Prospect can't calibrate trust without granular evidence statement. PDF has optional LLM narrative, no structured statement. | `value-assessment-engine.ts:1215`; no `explanation_of_confidence` field in Finding | high | 4 |
| 7 | Inference feedback loop not wired | One-way: emit findings, no signal back. Gate at 40% FP rate fires identically month 12 vs month 1. | `inference-calibration.ts:15-17` ("out of scope") | medium | 5 |
| 8 | Multi-company scoping missing in many detectors | Memory: SAP $320k + Odoo $180k attribution required. `gl_journal_off_hours`, `gl_round_amount_journals` lack `cf.clause`. | `assessment-findings.ts:905-955, 957-1004` | medium | 4 |
| 9 | Dynamic ERP field mapping discovery absent | Customer correction of mapping cannot trigger re-flow. Hardcoded column names. | No query of `erp_field_mappings` in detectors | medium | 7 |
| 10 | Phase 3 catalyst runs are stubs | `defaultSubCatalystResult` returned for PO-Invoice Matching, Stock Movement. Placeholder, not real. | `value-assessment-engine.ts:882-884, 959-961` | medium | 15 |
| 11 | Federation benchmarks unused | `federation_aggregates` exists but never queried during finding emission. No "85th percentile vs industry" framing. | No reads of federation tables in `assessment-findings.ts` | low | 6 |

### 3.2 API / RBAC / Auth

| # | Gap | Why | Evidence | Severity | Days |
|---|---|---|---|---|---|
| 1 | Board-report generation has no audit log | High-compliance executive artifact with no record of who/when/what. SOC 2 evidence gap. | `routes/board-report.ts:22-33`; no audit_log INSERT in handler or service | high | 1 |
| 2 | VantaX demo seed has no audit log | Thousands of records seeded; can't trace which run produced billing baseline. | `routes/seed-vantax.ts` — no audit_log INSERT on success | high | 2 |
| 3 | Admin error responses leak `(err as Error).message` in prod | Stack/exception types exposed. Global handler bypassed by explicit error returns. | `routes/admin-tenants.ts:60, 114, 179, 230` | medium | 2 |
| 4 | No idempotency keys on IAM/billing/seed mutations | Network retries → duplicate users/invoices/audit rows. Only ERP actions protected. | `routes/iam.ts:143`, `billing.ts:54`, demo-seed.ts | medium | 3 |
| 5 | Encryption rotation accepts plaintext keys in HTTP body | Logs/error messages could leak. No rate limit on path. Should use sidecar/vault. | `routes/tenants-admin.ts:464-469` | medium | 3 |
| 6 | No tight rate limit on board-report (LLM/PDF heavy) | Falls under general 120/min vs mind's 20/min. DoS / budget exhaustion risk. | `index.ts:4`, no dedicated limiter for board-report | medium | 2 |
| 7 | SCIM has no per-token rate limit | Compromised IdP token → spam user provisioning. | `routes/scim.ts`; no SCIM-specific limiter | medium | 2 |
| 8 | Personas memory marks auditor/board_member missing — both exist in code | Stale 28-day-old doc misleads roadmap planning. | `iam.ts:7-13` vs `personas_and_roles.md:19,30` | low | 1 |
| 9 | Trial endpoint missing X-RateLimit headers, raw IP stored | Standard headers absent on 429; PII without redaction strategy. | `routes/trial-assessment.ts:20-26, 65` | low | 1 |
| 10 | No global throttle on /api/contact email send | Distributed IPs bypass per-IP 5/hr → email infra DoS. | `index.ts:215-218` | low | 1 |
| 11 | Trial `industry` not enum-validated | Garbage values poison downstream radar filters. | `routes/trial-assessment.ts:28-29, 65` | low | 1 |

### 3.3 Frontend / Executive Design

| # | Gap | Why | Evidence | Severity | Days |
|---|---|---|---|---|---|
| 1 | No PDF export for executive briefings | Board prep is offline. Briefing page comment says "NOT YET IMPLEMENTED". The single most visible deliverable. | `ExecutiveSummaryPage.tsx:13`; `ApexPage.tsx:83` | high | 3 |
| 2 | CFO shared-savings strip only on 3 pages | Memory rule: persistent CFO strip. Mind/Memory/Catalysts surfaces lose framing → lose deal. | `SharedSavingsStrip.tsx:2-19` lists 6 pages, Sidebar has 9 Intelligence pages | high | 2 |
| 3 | No WCAG AA contrast audit on dark theme | `--text-muted #6c7068` on `--bg-card #141923` ~ borderline. Bloomberg/Apollo buyers expect documented compliance. | `src/index.css:66-69, 262-263` | medium | 5 |
| 4 | Mobile responsiveness untested on complex pages | CatalystsPage 3263L, PulsePage 4000L+, ApexPage 2274L not end-to-end mobile-audited. | `CatalystsPage.tsx:1-100`, `PulsePage.tsx:134` | medium | 8 |
| 5 | Provenance clickthrough incomplete on exec pages | Brief §4.1: "every clickable number" → MetricSource. Hero savings card has no popover, only "See the proof" link. | `SharedSavingsStrip.tsx:64-82`; Dashboard hero metrics | medium | 3 |
| 6 | No persona-locked onboarding for auditor/board_member | New users land blank. Bloomberg/Apollo both onboard scoped personas. | `AuditPage.tsx`, `BoardDigestPage.tsx`; `OnboardingWizardPage.tsx` targets ops users | low | 4 |
| 7 | Keyboard navigation undocumented/untested | Bloomberg Terminal users expect this; no kbd help modal. | `tabs.tsx:1-20` ("Roadmap C3"); no shortcut system | low | 4 |
| 8 | No "data as of [timestamp]" on all dashboards | Board decisions on possibly stale data. SectionFreshness not universal. | `ApexPage.tsx:1900+`; `BoardDigestPage.tsx:46` | low | 2 |
| 9 | Empty action queue shows silence not message | New customers/off-hours UX. | `CatalystsPage.tsx:1-100` ActionQueuePanel | low | 2 |
| 10 | No dark/light theme toggle in Settings | Brief §2 mentions light theme; no UI control. Accessibility/high-contrast use case. | `src/index.css:1-50`; `SettingsPage.tsx` | low | 3 |
| 11 | No persona-filtered contextual help | 7 roles, generic help. | `SettingsPage.tsx`; `Sidebar.tsx:58` | low | 5 |

### 3.4 Ops / Security / Observability

| # | Gap | Why | Evidence | Severity | Days |
|---|---|---|---|---|---|
| 1 | No COOP/COEP headers | Spectre-class isolation; SOC 2 / enterprise baseline. | `public/_headers`; `workers/api/src/index.ts` (no COOP/COEP) | high | 0.5 |
| 2 | No pre-commit secret scanning (gitleaks/husky) | Production-incident risk from leaked API keys. | `.git/hooks/` sample-only; no husky in package.json | high | 1 |
| 3 | No public SLO/SLI dashboard / external uptime | Enterprise expects published 99.9% + StatusPage. APM is internal-only. | `docs/FEATURE_AUDIT.md:142` | high | 3 |
| 4 | No automated backup verification in regular CI | DR test only runs at go-live gate; corrupt staging backup undetected. | `verification/dr/restore-drill.ts` only triggered by gate | high | 1 |
| 5 | CSP enforce-only, no report-only mode | Day-one breakage risk; no field-violation telemetry. | `public/_headers:1`; `index.ts:120` | medium | 1 |
| 6 | No commit signing enforcement | Supply-chain spoofing risk; audit trail gap. | `git config` no signing | medium | 0.5 |
| 7 | Staging E2E schedule commented out | Regressions caught only in prod. | `.github/workflows/staging-e2e.yml:46-48` | medium | 0.5 |
| 8 | Sentry DSN not wired to staging | Error paths unvalidated until first prod error. | `go-live-gate.yml` mentions confirm step only | medium | 1 |
| 9 | No rotation runbook for Cloudflare API key / GitHub token | JWT/ENCRYPTION rotation documented, externals not. | `docs/runbook.md:§15` | medium | 0.5 |
| 10 | Inference tests not isolated from critical path | Slow LLM call can fail go-live gate. | `__tests__/inference-*.test.ts` mixed in main suite | medium | 2 |
| 11 | Load gate doesn't verify query plans | Pathological O(n²) joins surface only under prod load. | `verification/load/load-gate.ts` | medium | 2 |
| 12 | No rate-limit bypass for health checks | High-freq monitors trigger limits, mask failures. | `middleware/ratelimit.ts` | low | 1 |
| 13 | HSTS not in browser preload list | Downgrade window if headers misconfigured. | `index.ts:167` emits preload, no submission | low | 0.25 |

### 3.5 Demo / GTM

| # | Gap | Why | Evidence | Severity | Days |
|---|---|---|---|---|---|
| 1 | No frontend UI to reskin demo — API only | Sales uses curl/Postman during prep. Loses minutes + credibility. | `SupportConsolePage.tsx:84-150` no reskin tile; `seed-vantax.ts:149-170` API only | high | 2 |
| 2 | No persona-scoped demo role switcher | "Try as CFO/Auditor/Board" requires 15-min impersonation context switch. | `BoardDigestPage.tsx` role-gated; `ImpersonationPage.tsx` 15-min session | high | 3 |
| 3 | No industry-specific win-story overlay | Mining board sees retail-looking data. Generic narrative kills stickiness. | `seed-vantax.ts` generic SA_CUSTOMERS; no industry routing | high | 5 |
| 4 | No demo-mode banner | Risk: real decision made on demo data → liability. | No `demo_flag` on tenants; no env badge in UI | medium | 1 |
| 5 | Board digest not exportable as PDF | Sales can't leave a 2-page leave-behind with prospect name. | `BoardDigestPage.tsx:1-150`; `board-report.ts:22-83` not connected to digest | medium | 2 |
| 6 | No marketing subdomain split | App + marketing on same domain; can't share link without exposing /login. | `App.tsx` routes `/` to MarketingPage | medium | 3 |
| 7 | No public ROI calculator on landing | 30% drop-off from "talk to sales" prospects. | `MarketingPage.tsx:1031` contact only | medium | 4 |
| 8 | Reseed synchronous 10-15s, no progress | Awkward silence in live demo. | `seed-vantax.ts:180-188` sync chunk flush | low | 2 ($\to$ 3 if SSE) |
| 9 | No guided demo tour / playbook | Sales improvises; inconsistent first impression. | No demo runbook in `docs/` | medium | 2 |
| 10 | No partner/channel program surface | SA SIs/consulting firms have no path to bundle/resell. | `grep partner` returns sub-processor refs only | low | 8 |

### 3.6 Enterprise Integration & Extensibility

| # | Gap | Why | Evidence | Severity | Days |
|---|---|---|---|---|---|
| 1 | OpenAPI spec is 60% placeholder | Codegen tools fail; partners hit raw HTTP wall. | `routes/openapi.ts:10-140` empty requestBody, no error schemas | high | 8 |
| 2 | SDK covers ~30% of API surface | Partners abandon SDK at first ERP/SCIM/compliance need. | `sdks/typescript/src/client.ts:1-231` 7 methods vs 40+ routes | high | 12 |
| 3 | No partner integration guide | No "build on us" docs; weeks of reverse engineering. | `sdks/*/README.md` cover quickstart only | high | 5 |
| 4 | No webhook event schema discovery endpoint | Hardcoded 14-event list; partners guess payload shape. | `routes/webhooks.ts:25-40` | medium | 3 |
| 5 | SDKs are read-only — no write actions | Catalyst approval / ERP write-back unreachable from SDK. | `sdks/typescript/src/client.ts:1-231` | medium | 4 |
| 6 | No partner API key tier / SLA | Unpredictable throttling damages partner trust. | `routes/auth.ts:1614-1673` flat keys; `ratelimit.ts` global only | medium | 4 |
| 7 | LLM provider config superadmin-only | Blocks enterprise BYOK deals (data residency, cost allocation). | `routes/admin.ts:450-496` `__global__` only | medium | 2 |
| 8 | External signals hardcoded to 3 sources | No plugin mechanism; industry-specific signals impossible. | `external-signals-feed.ts:354-358` `DEFAULT_SOURCES` const | medium | 6 |
| 9 | No GraphQL / bulk query layer | N+1 paginated REST cripples partner analytics. | OpenAPI is REST-only | low | 10 |
| 10 | No documented partner sandbox | Partners test against prod or nothing. | OpenAPI references localhost only | low | 2 |

## 4. Quick Wins (ship within 14 days)

Ranked impact/effort. Each row: scope + first-PR description.

1. **Add audit_log INSERT to /board-report/generate and /seed-vantax** (0.5d each, 1d total). PR: append `auditLog(c, 'board_report.generated', { report_id, generated_by })` after `generateBoardReport()` call in `routes/board-report.ts:33`; mirror in `routes/seed-vantax.ts` success path. Pattern lifted from `iam.ts:209`.
2. **COOP/COEP headers** (0.5d). PR: add `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` to `public/_headers` and security middleware at `workers/api/src/index.ts:117-169`. Validate Pages stays usable.
3. **DEMO ENVIRONMENT banner for demo tenants** (0.5d). PR: add `demo_mode` boolean to tenants table; in `AppLayout` render red top strip when set. Hidden in prod tenants. Gated on `tenant.slug === 'vantax'` initially.
4. **Extend SharedSavingsStrip to Mind/Memory/Catalysts** (1d). PR: amend `SharedSavingsStrip.tsx:2-19` docstring + import into `MindPage.tsx`, `MemoryPage.tsx`, `CatalystsPage.tsx`. Memory rule binding.
5. **Sample-size gate on detectors (≥25 records, ≥70% mode share)** (2d). PR: add `guardSampleSize(rows, 25)` helper in `assessment-findings.ts`; wrap all 30+ detectors. Returns null below threshold. Matches inference-strength memory.
6. **Lock approved findings (`approval_status`, `locked_at`)** (1d). PR: migration to add columns; pre-UPDATE guard in `value-assessment-engine.ts:2147` that rejects writes when `approval_status='approved'`. Non-breaking; existing rows `pending`.
7. **PDF export for Board Digest** (1d). PR: add "Download PDF" button to `BoardDigestPage.tsx`; route through existing `routes/board-report.ts:22-83` generator with `template=board_digest`. Reuses R2 storage.
8. **Reskin-as-prospect tile in SupportConsole** (1d). PR: add quick-action card to `SupportConsolePage.tsx:84-150` with company-name input + industry dropdown; calls `seed-vantax` with body, polls `/vantax-status`, shows spinner.
9. **Generic error in prod for admin routes** (1d). PR: wrap `routes/admin-tenants.ts:60, 114, 179, 230` returns with `prodSafeError(err, c.env.ENVIRONMENT)` — logs full message, returns generic to client.
10. **Husky + gitleaks pre-commit** (1d). PR: add `husky` + `lint-staged` + `gitleaks` config; block commits with detected secrets; runs in CI as defense-in-depth.

Cumulative: ~10 days for a two-person Phase-1 strike team.

## 5. Strategic Bets (90/180/365 day)

### Bet 1 — Audit-Grade Savings Ledger
**Thesis:** Every dollar Atheon bills is provable to an external auditor in <60 seconds, end-to-end, signed.

**World-first because:** No competitor (Celonis, Signavio, Apex, Cribl) ships a Merkle-chained provenance ledger that customers can cryptographically verify. They ship dashboards; we ship contracts.

**Architecture sketch:** New `provenance_chain` table appended on every finding mutation (create, approve, dispute, LLM-rewrite, lock). Each row stores `prev_hash`, `payload_hash`, `event_type`, `actor_id`, `timestamp`. Roots published daily to `audit_share_token` + optionally to an external Merkle anchor (e.g., OpenTimestamps). Service: `services/provenance-ledger.ts`. Reads via new `GET /api/v1/assessments/:id/provenance` returning chain + verification instructions. Wires into existing `assessment-findings.ts` create paths and the new `approval_status` lock from quick-win #6. Billing engine (`billing-engine.ts`) reads only `locked` findings and writes the billing artifact's provenance hash into invoice metadata.

**Success metric:** External auditor (Big-4 partner pilot) signs an opinion saying "Atheon's savings ledger meets ISAE 3402 Type II evidence standard" by Day 365.

**90d:** Schema + write-side instrumentation + audit-share extension; cryptographic verification CLI tool. **180d:** Customer-facing "Verify" button on Board Digest; per-line invoice provenance hash. **365d:** Big-4 pilot signed; SOC 2 Type II audit completed; "Audit-Grade Ledger" becomes lead marketing claim.

### Bet 2 — Multi-ERP Provenance Graph
**Thesis:** Customer migrates SAP → Oracle and their historical savings claims survive intact because Atheon mapped both into a single ontology.

**World-first because:** ERP vendors lock data in proprietary schemas; consulting firms hand-build mapping spreadsheets per project. No platform ships a live, queryable, customer-correctable ontology that spans 12 ERPs.

**Architecture sketch:** New `erp_ontology` + `erp_field_mappings` tables with `(tenant_id, erp_system, native_field, canonical_concept, mapping_confidence, source)`. Detectors in `assessment-findings.ts` query mappings instead of hardcoded column names — e.g., `resolveField(ctx, 'invoice.amount_due')` returns the right column per ERP. Multi-company `companyFilter()` becomes universal across all detectors (fixing gap 3.1#8). New service `services/erp-ontology.ts` exposes mapping CRUD + discovery (scans `erp_invoices` columns, suggests mappings). UI: `OntologyPage.tsx` lets customer override mappings; updates trigger background re-flow of affected assessments. Federation aggregates (`federation_aggregates`) keyed on canonical concept so "AR aging >60d" benchmarks compare apples-to-apples across SAP and NetSuite tenants.

**Success metric:** Customer with mixed SAP + Odoo deployment receives a single board pack with attribution by ERP and aggregate parity within 5%.

**90d:** Ontology table + 3 ERPs mapped (SAP, NetSuite, Sage Intacct) + detector refactor. **180d:** 12 ERPs mapped; customer mapping-override UI; re-flow worker. **365d:** Federation benchmarks live ("85th percentile vs industry"); ontology becomes the partner-extensibility seam for custom adapters (Bet 5 strategic plug-in).

### Bet 3 — Board Pack Autopilot
**Thesis:** CFO clicks "Generate Q3 Board Pack." 8 seconds later: 12-page PDF, prospect-branded, persona-narrated, provenance-signed, dispatched to board calendar.

**World-first because:** Today's "board reporting" tools are slide builders. Autopilot writes the narrative from live ERP data + locked findings + outcome history + LLM commentary attributed to "Atheon Intelligence" (memory rule). Persona variants (CFO/Auditor/Board Member) auto-generated from the same underlying ledger.

**Architecture sketch:** Compose existing `board-report.ts` + `value-assessment-engine.ts` PDF templates + `provenance-ledger.ts` signatures into a new pipeline `services/board-pack-autopilot.ts`. Queue-driven (Cloudflare Queue); accepts `{ tenant_id, period, persona, distribution }`. Pulls locked findings, realized outcomes (from outcome-tracking from gap 3.1#5), federation context. LLM provider abstraction (`llm-provider.ts`) generates narrative; trade-secret rule honored. Output: PDF in R2 + optional MS Graph/Gmail send + optional calendar invite. UI: single button on `BoardDigestPage`, `ExecutiveSummaryPage`, `ApexPage`. Audit log on every generation (closes gap 3.2#1).

**Success metric:** 80% of CFO/Board-Member sessions trigger an autopilot run; customer NPS on "board prep time saved" ≥ 50.

**90d:** Single-persona (CFO) autopilot + queue + PDF + audit log. **180d:** All 3 personas; calendar dispatch; "compare to last quarter" diff narrative. **365d:** Quarterly automatic generation with CFO-only approval-before-send; integration with Outlook/Google Workspace; reference customer demo at FinTech conference.

### Bet 4 — Partner SDK Auto-Generation + Webhook Versioning
**Thesis:** Atheon's API surface is always 100% covered by typed SDKs in 4 languages, and partner integrations survive breaking changes via versioned event contracts.

**World-first because:** Most B2B platforms ship hand-curated SDKs that drift. Auto-gen from OpenAPI + Zod + a webhook registry (`event_schemas` table with semver) is the durable answer.

**Architecture sketch:** Expand `routes/openapi.ts` to 100% coverage with Zod schemas as the source of truth. New CI workflow runs `openapi-typescript-codegen` + Python equivalent on every API change, publishes `@vantax/atheon-sdk` and `atheon-sdk` (PyPI) on tag. Add Go + Java for enterprise. New `webhook-registry.ts` exposes `GET /api/v1/webhooks/events` + `GET /api/v1/webhooks/events/:event@v1/schema`. Webhook payloads carry `event_version`. Partner-facing integration guide auto-published from spec.

**Success metric:** 5 partner integrations live by Day 365; SDK coverage ≥99% maintained by CI gate; zero partner-reported breaking changes uncaught.

**90d:** OpenAPI 100% coverage + TS/Python SDK auto-gen + integration guide v1. **180d:** Go + Java SDKs; webhook event versioning. **365d:** Public partner sandbox tenants; first 5 partner integrations live.

### Bet 5 — Closed-Loop Inference & Outcome Realization
**Thesis:** Findings get smarter every week because every customer dispute, every realized outcome, every ignored recommendation flows back into calibration.

**World-first because:** Inference platforms either ship static rules (legacy) or unbounded LLM hallucination (early-AI vendors). Atheon ships rule-based detectors that auto-tune from labeled outcomes, with the memory-mandated false-negative bias.

**Architecture sketch:** Wire the missing `/feedback` endpoint in `inference-calibration.ts` (currently "out of scope"). New `assessment_realized_outcomes` table links `(assessment_id, finding_code, measured_value_zar, measurement_date, source)`. Catalyst executions auto-record outcomes back to findings. Weekly cron (`scheduled.ts`) computes per-gate stats and posts "tighten/loosen/hold" recommendations to a `tuning_proposals` table requiring superadmin approval before applying. UI: `CalibrationDashboardPage` shows per-detector precision/recall trend.

**Success metric:** Average detector precision improves 15% from baseline by Day 365; false-positive rate on top-5 detectors <20%.

**90d:** `/feedback` endpoint + outcome-tracking table + UI capture. **180d:** Weekly auto-tuning proposals with approval gate. **365d:** Auto-application of high-confidence tunings; calibration trend on Board Pack as proof of compounding intelligence.

## 6. Ranked Roadmap

| # | Item | Dimension | Severity | Days | Phase | Owner |
|---|---|---|---|---|---|---|
| 1 | Add audit_log to /board-report/generate | API | high | 1 | 30 | Backend Eng |
| 2 | Add audit_log to /seed-vantax | API | high | 2 | 30 | Backend Eng |
| 3 | COOP/COEP headers | Ops | high | 0.5 | 30 | DevOps |
| 4 | Husky + gitleaks pre-commit | Ops | high | 1 | 30 | DevOps |
| 5 | Lock findings post-approval (`approval_status`) | Data | blocker | 3 | 30 | Backend Eng |
| 6 | Add `erp_record_id` to findings + backfill | Data | blocker | 5 | 30 | Backend Eng |
| 7 | Sample-size gate (≥25, ≥70% mode share) | Data | high | 6 | 30 | Backend Eng |
| 8 | Extend SharedSavingsStrip to all exec surfaces | FE | high | 2 | 30 | Frontend Eng |
| 9 | PDF export for Board Digest | FE/GTM | high | 2 | 30 | Frontend Eng |
| 10 | Reskin-as-prospect UI in Support Console | GTM | high | 2 | 30 | Frontend Eng |
| 11 | DEMO ENVIRONMENT banner | GTM | medium | 1 | 30 | Frontend Eng |
| 12 | Generic prod errors in admin routes | API | medium | 2 | 30 | Backend Eng |
| 13 | Idempotency keys on IAM/billing/seed | API | medium | 3 | 30 | Backend Eng |
| 14 | Confidence explainer per finding (PDF + UI) | Data | high | 4 | 90 | Backend Eng + FE |
| 15 | Per-field mapping confidence + erp_field_mappings | Data | high | 8 | 90 | Backend Eng |
| 16 | Outcome tracking (claimed→realized→invoiced) | Data | high | 10 | 90 | Backend Eng |
| 17 | Inference /feedback endpoint + capture UI | Data | medium | 5 | 90 | Full-stack |
| 18 | Multi-company `companyFilter()` universal | Data | medium | 4 | 90 | Backend Eng |
| 19 | Persona role-switcher widget (demo only) | GTM/FE | high | 3 | 90 | Frontend Eng |
| 20 | Public SLO/SLI dashboard + StatusPage | Ops | high | 3 | 90 | DevOps |
| 21 | OpenAPI 100% coverage + Zod source-of-truth | Ext | high | 8 | 90 | Backend Eng |
| 22 | Industry-specific demo overlays | GTM | high | 5 | 90 | Full-stack |
| 23 | WCAG AA contrast audit + remediation | FE | medium | 5 | 90 | Frontend Eng |
| 24 | Provenance chain (Merkle) v1 | Data | blocker | 8 | 90 | Backend Eng |
| 25 | Encryption rotation via vault/sidecar | API | medium | 3 | 90 | DevOps |
| 26 | Board Pack Autopilot (CFO persona) | Data/FE | high | 10 | 90 | Full-stack |
| 27 | Mobile responsiveness audit on complex pages | FE | medium | 8 | 180 | Frontend Eng |
| 28 | SDK auto-gen pipeline (TS + Python) | Ext | high | 12 | 180 | Backend Eng |
| 29 | Webhook event versioning + schema discovery | Ext | medium | 3 | 180 | Backend Eng |
| 30 | SDK write-action coverage | Ext | medium | 4 | 180 | Backend Eng |
| 31 | Per-tenant LLM BYOK | Ext | medium | 2 | 180 | Backend Eng |
| 32 | ERP ontology v1 (3 ERPs) | Data | high | 10 | 180 | Backend Eng |
| 33 | Federation benchmarks in findings | Data | low | 6 | 180 | Backend Eng |
| 34 | Persona-locked onboarding (auditor/board) | FE | low | 4 | 180 | Frontend Eng |
| 35 | Marketing subdomain split | GTM | medium | 3 | 180 | DevOps |
| 36 | Public ROI calculator | GTM | medium | 4 | 180 | Frontend Eng |
| 37 | Phase 3 catalyst real reconciliation | Data | medium | 15 | 180 | Backend Eng |
| 38 | Auto-tuning of inference gates (approval-gated) | Data | medium | 5 | 180 | Backend Eng |
| 39 | Board Pack Autopilot (all personas, dispatch) | Data/FE | high | 10 | 180 | Full-stack |
| 40 | ERP ontology — full 12 ERPs + customer override | Data | high | 15 | 365 | Backend Eng |
| 41 | Go + Java SDKs | Ext | low | 10 | 365 | Backend Eng |
| 42 | GraphQL bulk layer | Ext | low | 10 | 365 | Backend Eng |
| 43 | Big-4 audit pilot (ISAE 3402 / SOC 2 Type II) | Trust | high | 30 | 365 | CTO + External |
| 44 | Partner program (channel/SI enablement) | GTM | low | 8 | 365 | GTM Lead |
| 45 | Keyboard-first accessibility pass | FE | low | 12 | 365 | Frontend Eng |
| 46 | Dark/light theme toggle | FE | low | 3 | 365 | Frontend Eng |

## 7. Risks + Open Questions

- **Trade-secret LLM rule constrains marketing.** Memory binds us to "Atheon Intelligence" attribution. We cannot claim "powered by Claude Opus 4.7" as a buyer comfort signal — competitors will. Mitigation: lean on Audit-Grade Ledger as the trust artifact; the substrate is irrelevant if the output is signed. **Open:** can we say "powered by foundation models from leading providers, validated against Atheon's confidence engine" without breaching the spirit of the rule?
- **"Audit-grade" without SOC 2.** Until Big-4 pilot completes (Bet 1, 365d), "audit-grade" is a marketing claim, not a certified one. Risk: enterprise legal redlines the contract. Mitigation: ship the Merkle chain at 90d so technical sophisticates can verify before formal certification; publish self-audit methodology.
- **Shared-savings disputes.** What happens if a customer says "we never realized that $50k"? Current billing engine gates on `status='resolved' + verified_action_ids` but doesn't model dispute resolution. **Open:** do we credit-back, escrow, or arbitrate? Strongly recommend an `invoice_disputes` table + 30-day cooling-off SLA before any 90-day code freezes.
- **Sample-size gate may suppress findings on small tenants.** A 20-employee customer may have <25 invoices/month. Memory rule says prefer false-negative; but a tenant with no findings produces no billable revenue. **Open:** tiered thresholds by tenant volume, or hard rule with explicit "insufficient data" UI?
- **ERP ontology drift.** Customers customize ERPs heavily. Hardcoded mappings break weekly. **Open:** do we ship a fully-managed ontology (Atheon maintains) or customer-owned (they maintain)? Lean toward managed-with-override.
- **Provenance chain storage costs.** Append-only per-mutation rows on D1 can balloon. **Open:** archive >90d to R2 with index pointers; preserve verifiability via Merkle proof export.
- **Persona role-switcher in production tenants** is a vector for accidental privilege confusion. Must be hard-gated to demo tenants only and never expose admin-only data to a role-switched viewer. Code review must include explicit RBAC test.
- **Inference auto-tuning** is a regulatory grey area (EU AI Act tier). Auto-applying threshold changes without human review may breach "human-in-the-loop" requirements for high-impact systems. Keep proposal-and-approval gating through 365d.
- **Frontend mobile coverage** — Bloomberg-class buyers rarely use mobile, but board members do. Defer full audit to 180d; ship "view-only mobile" for Board Digest at 90d as compromise.
- **Trade-off: SDK auto-gen vs ergonomics.** Auto-generated SDKs are complete but feel raw. Hand-written wrappers feel premium but drift. Recommendation: auto-gen the floor, hand-write the top 10 ergonomic helpers per language.

## 8. Sequencing Notes for Implementation

**30-day phase — Defensibility & Demo Day.** Use `superpowers:dispatching-parallel-agents` to fan out the 13 quick-win items across 2 strike teams (backend + frontend). All items are independent (audit_log inserts, COOP/COEP, demo banner, strip extension, sample-size gate, finding lock, board PDF, reskin UI). Verification: every PR runs `superpowers:verification-before-completion` before claiming done. Test posture: extend `__tests__/auth.test.ts` pattern to new audit-log assertions; new test file `assessment-findings-gate.test.ts` for sample-size enforcement. Single-sequential dependency: finding lock (#5) must precede provenance chain v1 in next phase. Daily verification of `go-live-gate.yml` while changes land. **No force-push to main; no skipped hooks.**

**90-day phase — Provenance v1 + Confidence Surfaces.** Switch to `superpowers:executing-plans` model: each strategic bet gets its own implementation plan. Bet 1 (Ledger) is the critical path — must complete the Merkle write-side before Bet 3 (Board Pack) can sign output. Parallelizable: Bet 4 (OpenAPI/SDK) and Bet 5 (/feedback) by separate engineers. Outcome tracking (#16) blocks Bet 5 closure; sequence first. Customer-facing PDF confidence explainer (#14) requires UX research session — schedule week 1 of phase. Use `superpowers:test-driven-development` for billing engine + ledger; correctness here is reputational. Run a 2-day adversarial review (`superpowers:receiving-code-review`) on the provenance chain before exposing publicly.

**180-day phase — Ontology + Autopilot.** ERP ontology (#32) requires customer pilots — line up 3 design partners (SAP-heavy, NetSuite, mixed) at day 90 start. Refactor of 30+ detectors to use `resolveField()` is mechanical but risky; use a feature flag (`ENABLE_ONTOLOGY_RESOLUTION`) per detector with side-by-side comparison telemetry for 14 days before flip. SDK auto-gen (#28) is independent — assign to a single owner with CI infrastructure focus. Board Pack Autopilot full version (#39) depends on outcome tracking (90d) + ledger v1 (90d) + per-persona templates; this is the showcase deliverable for Day 180 demo. Mobile audit (#27) and accessibility (#23 carry-over) by frontend engineer, parallel.

**365-day phase — Certification + Category-Defining.** Big-4 pilot (#43) is the single highest-leverage item — engage by Day 270 to allow 90+ days for audit. Allocate executive time, not engineering time. Full 12-ERP ontology (#40) is the long tail; can be customer-led after 6 ERPs are in (Pareto). Go/Java SDKs (#41) only if 180-day partner traction justifies. GraphQL (#42) only if 3+ partner requests document the need. Run `superpowers:finishing-a-development-branch` discipline on every Bet completion. Public reference customer + Big-4 letter at Day 365 = lead-in to Series B / category-defining keynote.

**Cross-phase posture:** No bet is allowed to skip the verification gate, the audit log, or the trade-secret LLM attribution rule. Every PR that touches billing-engine, provenance, or findings requires two-engineer review. Production secrets rotation runbook updates land alongside any change to encryption key handling. Memory anchors are binding — re-read them on every plan kickoff.

## Appendix A: Audit Source Detail

### A.1 Frontend / Executive Design Bar (raw)
Inventory anchors: Design System `src/index.css:1-500+`, `src/components/ui/card.tsx`; Sidebar `src/components/layout/Sidebar.tsx:1-442`; Executive Pages `src/pages/ApexPage.tsx, Dashboard.tsx, ExecutiveSummaryPage.tsx, BoardDigestPage.tsx`; SharedSavingsStrip `src/components/SharedSavingsStrip.tsx:1-125`; State `src/components/ui/state.tsx, async.tsx`; Auditor role `src/pages/CompliancePage.tsx:66, Sidebar.tsx:42`; Board role `src/pages/BoardDigestPage.tsx, Sidebar.tsx:45`; Typography `src/index.css:258-274`; Button `src/components/ui/button.tsx:52-100`; PageHeader `src/components/ui/page-header.tsx:30-55`; MetricSource `src/components/ui/metric-source.tsx`; Skeleton `src/components/ui/skeleton.tsx:1-120`; bento `src/index.css:291-298`.
Gap anchors: ExecutiveSummaryPage.tsx:13 "NOT YET IMPLEMENTED"; SharedSavingsStrip.tsx:2-19 limited to 6 pages; src/index.css:66-69, 262-263 muted text contrast risk; CatalystsPage.tsx:1-100 / PulsePage.tsx:134 mobile untested; SharedSavingsStrip.tsx:64-82 no MetricSource on hero; AuditPage.tsx, BoardDigestPage.tsx no persona onboarding; tabs.tsx:1-20 WCAG roadmap C3; ApexPage.tsx:1900+ no explicit "as of"; SettingsPage.tsx no theme toggle.

### A.2 API / RBAC / Auth (raw)
Inventory: Routes `workers/api/src/index.ts:500-650`; Tenant middleware `middleware/tenant.ts:19-107` (Bug #13 fix 35-40); RBAC `routes/iam.ts:7-13`; Auth `routes/auth.ts:100-900+`; Setup `index.ts:675-762` (constant-time 717-728); Migrate `index.ts:783-858`; Demo seed `routes/demo-seed.ts:30-52`; VantaX seed `routes/seed-vantax.ts:27-50+`; Rate limit `middleware/ratelimit.ts:1-187`; IAM audit `routes/iam.ts:209`; SCIM `routes/scim.ts`, `middleware/scim-auth.ts`; Audit-share `routes/audit-share.ts:21-93`; Trial `routes/trial-assessment.ts:14-100`; Agent routes `routes/agent-routes.ts:15-200+`; OpenAPI `routes/openapi.ts`; Contact `index.ts:866-943`; Mind `routes/mind.ts:158-390`; Encryption rotation `routes/tenants-admin.ts:448-495`.
Gaps: board-report.ts:22-33 no audit log; admin-tenants.ts:60,114,179,230 leak err.message; erp.ts:892 sole idempotency; seed-vantax.ts no audit; iam.ts:7-13 vs personas_and_roles.md:19,30 mismatch; trial-assessment.ts:20-26 no rate headers; tenants-admin.ts:464-469 plaintext keys; scim.ts no per-token limit; index.ts:215-218 contact global throttle missing.

### A.3 Shared-Savings Data Model (raw)
Inventory: detector engine `services/assessment-findings.ts:1-1076` with SampleRecord 108-118; evidence_quality 348-353,442; value engine `services/value-assessment-engine.ts:79-135` with createFinding/finding_insight 2144-2156; schema `services/migrate.ts`; data quality 420-429; process timing 444-620; calibration `services/inference-calibration.ts:1-150` (MIN_SAMPLE_SIZE 33) + stub 15-17,73-96; billing `services/billing-engine.ts:1-200` BillableLineItem 39-66; outcome `services/catalyst-simulator.ts:27,376-419` + `routes/catalysts.ts:5545-5551`; companyFilter 164-170,372-386; PDF narrative 1081-1403; immutability mutation 2147-2151.
Gaps: assessment-findings.ts:108-118 (no ID); 348-353 (one bucket); 467-541 etc no sample-size gate; 905-955, 957-1004 missing cf.clause; value-assessment-engine.ts:882-884, 959-961 stubs; billing-engine.ts:49-50 no row-level traceability; federation_aggregates unread.

### A.4 Ops / Security (raw)
Inventory: runbook §12-15 rotation; `.github/workflows/deploy-api.yml`, `deploy-frontend.yml`, `go-live-gate.yml`, `backup-d1.yml`, `production-e2e.yml`, `staging-e2e.yml`, `ci.yml`; `verification/dr/restore-drill.ts`; `workers/api/src/index.ts:117-169` (security headers), `:79-110` (CORS), `:136-149` (encryption enforce), `:298-349` (migration lease), `:174-206` (APM), `:244-247` (license); `public/_headers`; `middleware/requestid.ts`, `services/logger.ts`, `services/sentry.ts`, `services/apm.ts`, `middleware/ratelimit.ts`, `services/license-enforcement.ts`; tests `__tests__/auth.test.ts`, `billing-engine.test.ts`, `inference-*.test.ts`, `audit-retention.test.ts`.
Gaps: no COOP/COEP in `public/_headers` or `index.ts`; CSP enforce-only `index.ts:120`; `.git/hooks/` sample-only; `docs/FEATURE_AUDIT.md:142`; `staging-e2e.yml:46-48` schedule commented; HSTS submit unverified at `index.ts:167`; `docs/runbook.md §15` external token rotation missing.

### A.5 Demo / GTM (raw)
Inventory: seed `routes/seed-vantax.ts:139-171`; reset 3831-3852; status 3858-3943; findings demo 3946-4380; data 43-103; landing `src/pages/MarketingPage.tsx:1-1170`; pricing `src/pages/PricingPage.tsx:1-162`; BoardDigest `src/pages/BoardDigestPage.tsx:1-150+`; ROI `src/pages/ROIDashboardPage.tsx:1-100+`; board report `routes/board-report.ts:22-83`; value PDF `services/value-assessment-engine.ts:1081`; CSV `services/csv-export.ts:1-37`; Support `src/pages/SupportConsolePage.tsx:84-150+`; Impersonation `src/pages/ImpersonationPage.tsx`; multi-company seed 1020-1032; oracle `services/vantax-demo.ts:30-35`.
Gaps: SupportConsolePage.tsx:84-150 no reskin tile; BoardDigest no role switcher; seed-vantax.ts industry not narrative-routed; 173-4384 silent sync; BoardDigest no PDF button; App.tsx routes / to MarketingPage (no subdomain); MarketingPage.tsx:1031 no ROI calc; no demo_flag; seed-vantax.ts:180-188 sync 10-15s; no demo runbook.

### A.6 Integration / Extensibility (raw)
Inventory: ERP connectors `workers/api/src/services/erp-*-live.ts` (12 systems); webhook signer `services/webhook-signer.ts:1-140`; webhook delivery `services/webhook-delivery.ts:1-274`; webhook routes `routes/webhooks.ts:1-272`; LLM provider `services/llm-provider.ts:1-599` (trade-secret 11-12); API keys `routes/auth.ts:1613-1673`; OpenAPI `routes/openapi.ts:1-160`; TS SDK `sdks/typescript/src/client.ts`; Python SDK `sdks/python/`; external signals `services/external-signals-feed.ts:1-479` (DEFAULT_SOURCES 354-358).
Gaps: openapi.ts:10-140 placeholder; client.ts:1-231 7 methods vs 40+ routes; webhook hardcoded 25-40; auth.ts:1614-1673 flat keys; admin.ts:450-496 global only; external-signals-feed.ts:354-358 const list; SDK read-only.