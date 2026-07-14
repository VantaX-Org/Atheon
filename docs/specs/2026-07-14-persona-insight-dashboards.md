# Persona Insight Dashboards — Detailed Spec

**Date:** 2026-07-14
**Status:** Draft for owner review
**Scope:** Role-customized executive insights (CEO, CFO, COO, CPO, CMO, CHRO, CIO) with internal (ERP detector) and external (market/regulatory/competitor) signals; full catalyst catalog activation; full internal + external variable activation.

---

## 1. Goal

Every executive opens Atheon and sees *their* money view in under 5 seconds:

- **CFO** sees cash: AR aging, unreconciled bank, GL control health, tax deadlines, FX exposure vs live rates.
- **CPO** sees supply: supplier risk, contract leakage (maverick spend, 3-way mismatch), supply-in (overdue POs), inventory/manufacturing stock health, customer-demand pull-through — with Brent/FX/commodity context on input costs.
- **CMO** sees demand: customer concentration, margin erosion, pricing, retention — with competitor intel context.
- **CEO** sees the whole loop: gated confirmed exposure, recovered-to-date, ROI multiple, top-3 concentration risks, and the one decision that needs them today.

Insights are **not** a new number factory. Every Rand shown obeys the existing traceability law: it comes from the gated assessment findings (`confidence_gate_passed`), traces to `erp_*` rows, and confirmed vs `potential_unverified` stay separate. External signals **annotate** internal findings (context, direction, urgency); they never mint billable ZAR.

---

## 2. Current state (verified 2026-07-14)

| Asset | State |
|---|---|
| Roles | 10 built-in (`src/types/index.ts:31`, `workers/api/src/routes/iam.ts:10-16`) + `custom:<id>`. `executive` (level 90) is the C-suite tier. **No** per-persona CEO/CFO/CPO/CMO roles exist. |
| Detectors | 40 `FindingCode`s in `workers/api/src/services/assessment-findings.ts` (23 direct / 17 inferred), + process-timing detectors (O2C, P2P, approval cycle, month-end close) in `value-assessment-engine.ts`. All read tenant `erp_*` only. |
| ERP domains | 13 data tables: invoices, purchase_orders, journal_entries, bank_transactions, employees, customers, suppliers, products (8 uploadable via `INGEST_MANIFEST`) + gl_accounts, tax_entries, projects, time_entries, companies. |
| Catalysts | `CATALYST_CATALOG` in `catalyst-templates.ts`: **76 clusters, 365 sub-catalysts** (110 `implementation:'real'`). Engine: `catalyst-engine.ts` (`executeTask` → confidence → autonomy-tier gate → approve/auto), DAG chaining, simulator + Welford calibration, per-sub effectiveness KPIs. Only `STARTER_CLUSTER_NAMES` deploy today. |
| External signals | **Built but not wired to dashboards/assessment:** `external-signals-feed.ts` (live FX via frankfurter.app + Brent crude via EIA → `external_signals` table), `regulatory-feed.ts`, `competitor-intel-source.ts`, `erp-vendor-baselines.ts`. Assessment FX uses a hardcoded rate table (`assessment-engine.ts:2460`). |
| Home UI | `JourneyHome.tsx` — journey spine (Connect/Detect/Fix/Recover/Report) + `ActionQueuePanel variant="executive"`. No persona switching; personalization is route-access only (`ScopedRoleRedirect`: auditor→/compliance, board_member→/board-digest). |
| Known drift (fix in this work) | `catalyst-recommendation.ts` frontend mapper references stale cluster names ("Operations Catalyst", "Sales Intelligence Catalyst", …) that don't exist in `CATALYST_CATALOG`. `ImpersonationPage.tsx:50-59` role-level scale disagrees with `iam.ts` `ROLE_LEVELS`. |

---

## 3. Persona model

### 3.1 Persona ≠ role

Adding `ceo`/`cfo`/… as RBAC roles would bloat the role hierarchy (already two drifted numeric scales) and conflate *access* with *lens*. Instead:

- **Role** keeps gating access (unchanged). Persona dashboards render for `EXECUTIVE_ROLES` (executive, board_member view-only, admin+, manager).
- **Persona** is a new orthogonal user attribute selecting the insight lens.

```sql
-- migration: add persona to users
ALTER TABLE users ADD COLUMN persona TEXT; -- 'ceo'|'cfo'|'coo'|'cpo'|'cmo'|'chro'|'cio'|NULL
```

```ts
// src/types/index.ts
export type Persona = 'ceo' | 'cfo' | 'coo' | 'cpo' | 'cmo' | 'chro' | 'cio';
```

- Set at: signup role step (optional), Settings → Profile, IAM admin edit. Returned in `/auth/me` and JWT is **not** required (lens, not privilege — read from DB/user object).
- Default when NULL: role-derived — `executive`/`board_member` → `ceo` lens; `manager` → `coo`; everyone else → no persona rail (current JourneyHome unchanged).
- A persona picker on the dashboard lets any permitted user switch lenses ad hoc (view-state only; saved persona is the default). CFO can peek at the CPO lens; data shown is still gated by their role's data access, which for executive tier is full-tenant anyway.

### 3.2 The seven personas

| Persona | Mandate (one line) | Primary journey stage |
|---|---|---|
| CEO | Whole value loop, concentration risk, the one decision needed today | Report |
| CFO | Cash in, cash out, control integrity, statutory exposure | Detect/Recover |
| COO | Operations throughput, service delivery, process cycle times | Fix |
| CPO | Suppliers, contracts, supply-in, manufacturing/inventory, supply chain, customer pull-through | Detect/Fix |
| CMO | Customers, revenue quality, pricing, retention, market position | Detect |
| CHRO | Workforce cost integrity, payroll leakage, utilisation | Detect |
| CIO | Data quality, integration health, security/automation posture | Connect |

---

## 4. Signal matrix — all 40 detectors + process detectors + external feeds, mapped

Every internal variable (all 40 finding codes + 4 process-timing detectors) is owned by at least one persona. Overlap is intentional (3-way mismatch is both a CFO control and a CPO contract-leakage signal).

### 4.1 CFO — 18 internal, 3 external

| Internal signals (finding codes) | Why |
|---|---|
| ar_aging_overdue_30_60 / 60_90 / 90_plus | Collections runway; inferred uplift shown as *potential*, gated total as *confirmed* |
| ar_credit_limit_breach, ar_top_debtor_concentration | Credit control + debtor concentration |
| ap_three_way_mismatch, ap_unreconciled_bank | Payment control integrity |
| gl_suspense_balance, gl_journal_off_hours, gl_round_amount_journals, gl_high_manual_volume | GL control health / manipulation signals |
| tax_overdue_submission, tax_missing_vat_numbers, tax_vat_rate_anomaly | Statutory exposure |
| fx_currency_exposure, fx_dual_use_currency | FX book risk |
| svc_revenue_recognition_lag | Rev-rec policy compliance |
| process: month-end close days, approval cycle days | Close discipline |

External: **FX rates** (frankfurter feed — live ZAR/USD/EUR/GBP vs the exposure book; flags when live rate moved >2% against booked hardcoded rate), **regulatory feed** (tax/financial-reporting changes → annotate tax findings), **SARB repo rate** (new source, phase 2 — cost-of-capital context on AR aging: "R4.2m 90+ days at 11.75% prime ≈ R41k/month carry").

Catalyst domains surfaced: finance, finance-treasury, finance-close, compliance-tax, compliance-audit.

### 4.2 CPO — 13 internal, 4 external

The user-stated mandate: suppliers, contracts, supply in, manufacturing, supply chain, customer.

| Facet | Internal signals |
|---|---|
| Suppliers | proc_duplicate_suppliers, proc_supplier_concentration, proc_inactive_with_open_pos, tax_missing_vat_numbers (supplier master hygiene) |
| Contracts | proc_maverick_spend (off-contract leakage), ap_three_way_mismatch (contract-vs-invoice) |
| Supply in | ap_overdue_delivery (POs past expected date), process: P2P cycle days vs 45-day benchmark |
| Manufacturing / inventory | inv_stale_stock, inv_dead_stock, inv_negative_stock, inv_below_reorder, inv_inactive_with_value |
| Supply chain | proc_supplier_concentration (single-source risk) + inventory set above |
| Customer (pull-through) | sales_customer_concentration, inv_margin_erosion (input-cost squeeze reaching customer margin) |

External: **Brent crude** (EIA feed — logistics/input cost direction; annotates inventory + PO findings), **FX** (import cost on foreign-currency POs), **vendor baselines** (`erp-vendor-baselines.ts` — supplier norms), **commodity indices** (new source, phase 2 — per-tenant configurable commodity relevant to their inputs).

Catalyst domains: procurement, supply-chain, logistics-*, mfg-*, retail-supply-chain, operations-data-quality (supplier master dedup).

### 4.3 CMO — 6 internal, 2 external

| Internal | Why |
|---|---|
| sales_customer_concentration | Revenue dependency risk |
| sales_inactive_with_ar, sales_credit_no_check | Revenue quality / channel hygiene |
| inv_margin_erosion | Pricing power decay |
| ar_top_debtor_concentration | Key-account payment risk |
| process: O2C cycle days | Quote-to-cash friction |

External: **competitor intel** (`competitor-intel-source.ts` — pricing/product moves annotate margin + concentration findings), **market intelligence** (fmcg-market/agri-market feeds where tenant industry matches).

Catalyst domains: sales, customer-cdp, fmcg-*, retail-pricing, retail-pos, retail-ecommerce, tech-customer-success.

### 4.4 COO — 14 internal, 1 external

| Internal | Why |
|---|---|
| svc_low_billable_utilisation, svc_unbilled_time_aging, svc_project_overrun, svc_project_margin_negative, svc_unapproved_time_entries, svc_zero_hours_active_project, svc_inactive_employee_billed_time | Service delivery integrity (all 8 svc_* minus rev-rec which is CFO-primary) |
| inv_below_reorder, inv_negative_stock, inv_stale_stock | Operational stock health |
| ap_overdue_delivery | Inbound operations |
| process: O2C, P2P, approval cycle | Throughput benchmarks |

External: **Brent** (fuel/energy cost direction for logistics-heavy tenants).

Catalyst domains: service-operations, operations-ci, mining-*, agri-*, health-patient/staffing/supply, logistics-*, mfg-production/maintenance/energy.

### 4.5 CHRO — 4 internal, 1 external (phase 2)

Internal: hr_terminated_in_payroll (payroll leakage — hard Rand), hr_high_payroll_concentration, svc_unapproved_time_entries, svc_inactive_employee_billed_time.
External: wage-inflation index (new source, phase 2, optional).
Catalyst domains: hr, hr-recruitment, hr-engagement, health-staffing.

### 4.6 CIO — internal = platform posture, not findings

CIO lens is built from existing operational data rather than finding codes: ERP connection health (`/api/erp/connections` error count), ingest dataset failure rate, `ctx.unknownCurrencies` flags, data-quality catalyst results, integration-health + system-alerts state, catalyst automation rate (auto-executed vs manual).
Catalyst domains: tech-devops, tech-security, operations-data-quality, tech-product.

### 4.7 CEO — rollup of all, compressed to 5 cards

1. **Headline:** gated confirmed exposure (`total_value_at_risk_zar`) + recovered-to-date + ROI multiple — same numbers as journey spine, one row.
2. **Concentration trio:** top debtor / top supplier / top customer concentration (findings 5, 15, 23) — existential risks.
3. **Biggest single finding** by confirmed ZAR, whoever owns it, with "assign to CFO/CPO/…" action.
4. **Decision needed:** highest-value `requires_approval` catalyst action (executive-escalated items from `determineEscalation()` surface here first).
5. **External pulse:** one-line macro strip — ZAR/USD move, Brent move, newest regulatory item. Context only, no ZAR attached.

---

## 5. Insight engine (backend)

### 5.1 New service: `workers/api/src/services/persona-insights.ts`

Pure function over data that already exists — **no new detector logic, no new numbers**:

```ts
export interface PersonaInsight {
  id: string;                     // deterministic: `${persona}:${finding_code}:${assessment_id}`
  persona: Persona;
  severity: 'critical' | 'high' | 'medium' | 'low';   // inherited from finding
  headline: string;               // "R1.24m sitting in invoices 90+ days overdue"
  detail: string;                 // finding narrative, persona-phrased
  value_zar: number | null;       // ONLY gate-passed confirmed value; null if context-only
  value_kind: 'confirmed' | 'potential_unverified' | 'context';
  source: { finding_code?: string; external_signal_id?: string; assessment_id: string };
  external_context?: { signal: string; value: string; direction: 'up'|'down'|'flat'; note: string };
  recommended_catalyst?: { cluster: string; sub_catalyst: string };
  cta: { label: string; route: string };   // deep link: /findings?code=…, /catalysts?cluster=…
}
```

Assembly per persona:
1. Load latest complete assessment (`latestCompleteAssessment` semantics, server-side equivalent).
2. Filter `findings[]` to the persona's finding-code set (§4 matrix, a static `PERSONA_SIGNAL_MAP` in this file — same pattern as `FINDING_INFERENCE_KIND`).
3. Rank: severity desc, then confirmed `value_at_risk_zar` desc. Cap 8 insights per persona (CEO capped 5, fixed card set).
4. Join external context: read latest `external_signals` rows; attach to matching findings via a static `EXTERNAL_RELEVANCE_MAP` (e.g. `fx_currency_exposure` ← FX signal, `inv_*` ← Brent). External values render in the `external_context` strip of the card — never summed into `value_zar`.
5. Join catalyst state: pending approvals from `catalyst_actions`, per-cluster `success_rate`/`trust_score`, recovered value from `catalyst_effectiveness.total_value_processed` — for "Fix it" CTAs and the CEO decision card.

### 5.2 API

```
GET /api/insights?persona=cfo
→ { persona, generated_from_assessment_id, insights: PersonaInsight[],
    external_pulse: { fx: {...}, brent: {...}, regulatory_latest: {...} } | null }
```

- Auth: `requireRole` — EXECUTIVE_ROLES + manager. Tenant-scoped like every other route.
- No caching layer initially (`ponytail:` reads are cheap D1 queries over one assessment + one signals table; add KV cache if p95 > 500ms).
- `persona` param validated against the Persona union; 400 otherwise.

### 5.3 Honesty rules (law, restated for this feature)

1. `value_zar` on an insight = the finding's gate-passed confirmed value only. Potential/inferred shows as `potential_unverified` with the existing "unverified" label treatment.
2. External signals are `value_kind:'context'`, `value_zar:null`, always. No "FX moved 3% so exposure is now R X" arithmetic — we show the booked exposure and the rate move side by side, reader draws the conclusion.
3. Every insight's CTA deep-links to the finding (which traces to `erp_record_id`) — two clicks from headline to source rows.
4. Insufficient data ≠ zero. Persona with no gate-passed findings in its set renders the honest empty state ("No confirmed findings in your area — R X unverified pending more data"), not a green dashboard.

---

## 6. External signal activation

### 6.1 Wire what exists (phase 1)

- **Schedule** `external-signals-feed.ts` (FX + Brent) via Workers cron (daily; frankfurter and EIA are daily-granularity sources). Currently built for Phase-10 KPI attribution but not scheduled for dashboard use — add cron trigger in `wrangler.toml`, idempotent upsert into `external_signals`.
- **Regulatory feed** (`regulatory-feed.ts`): same cron cadence; latest 3 items exposed in `external_pulse`.
- **Competitor intel** (`competitor-intel-source.ts`): wire to CMO lens where tenant has it configured; absent = section hidden, not empty.
- **Vendor baselines** (`erp-vendor-baselines.ts`): CPO supplier cards get "vs baseline" annotations.
- Failure mode: feed fetch fails → last-known signal shown with its `fetched_at` timestamp ("as of 12 Jul"); never blocks the internal insights. Feed rows carry source + fetched_at for the traceability drawer.

### 6.2 Replace the hardcoded FX table (phase 1, assessment-adjacent)

`assessment-engine.ts:2460` hardcodes `{ ZAR:1, USD:18.5, EUR:20, GBP:23 }`. Change `toZAR` to read the latest `external_signals` FX row, falling back to the hardcoded table (and flagging `ctx.staleRates`) when the feed is empty. **This changes billable numbers** (FX-denominated findings revalue at live rates) → same Tier-B treatment as before: separate PR, explicit owner sign-off, called out in release notes.

### 6.3 New sources (phase 2, each optional per tenant)

- SARB repo/prime rate (CFO carry-cost context) — statsSA/SARB public endpoint.
- Commodity index per tenant config (CPO).
- Wage inflation index (CHRO).
All phase-2 sources follow the same contract: rows in `external_signals`, context-only, never billable.

---

## 7. Full catalyst activation

Today only `STARTER_CLUSTER_NAMES` deploy. Change:

1. **Catalog-wide availability:** all 76 clusters visible/deployable per tenant. Deploy view groups by domain, industry-tagged clusters (mining-*, agri-*, health-*, …) sorted by tenant industry match first (industry from tenant profile; `getClustersByTag` already exists).
2. **Activation ≠ auto-execution.** Autonomy tiers and the approval flow are untouched: read-only clusters run freely, assisted requires conf ≥ 0.85, transactional ≥ 0.7 else `requires_approval` with step-up MFA — exactly the current `canAutoExecute()`/`determineEscalation()` path. "Activate all catalysts" means the full catalog is live and schedulable, not that 365 sub-catalysts fire blind.
3. **Default-on set per tenant:** starter clusters + every cluster referenced by the tenant's gate-passed findings (`FINDING_CATALYST_MAP`) + industry-tag matches. Everything else: one-click enable from the persona dashboard's "Fix it" CTA.
4. **Fix the drift:** reconcile `src/lib/catalyst-recommendation.ts` cluster names against canonical `CATALYST_CATALOG` names (add a build-time test that every mapper target exists in the catalog — same pattern as the classification-lock test).
5. **Persona surfacing:** each persona card's `recommended_catalyst` resolves through `FINDING_CATALYST_MAP`; persona dashboard shows its domain clusters' health (trust_score, success_rate via the existing `pct()` normalization, recovered value).

Rollout guard: enabling 76 clusters on existing tenants must not spawn a burst of scheduled tasks — new enablements start `status:'paused'` for non-starter clusters until first manual run or explicit schedule opt-in.

---

## 8. UI spec

### 8.1 Persona rail on JourneyHome (not a new page)

Journey spine stays the spine. Persona insights slot directly beneath it, replacing nothing:

```
┌ PageHeader (greeting + locator line) ─────────────────────┐
┌ JourneySpine (5 stage cards, unchanged) ──────────────────┐
┌ PERSONA RAIL ─────────────────────────────────────────────┐
│ [Your view: CFO ▾]                    external pulse strip │
│ ┌ insight card ┐ ┌ insight card ┐ ┌ insight card ┐        │
│ │ CRITICAL     │ │ HIGH         │ │ HIGH         │  → more│
│ │ R1.24m 90d+  │ │ R840k unrec. │ │ VAT overdue  │        │
│ │ AR overdue   │ │ bank items   │ │ 3 periods    │        │
│ │ [Fix it →]   │ │ [View →]     │ │ [View →]     │        │
│ └──────────────┘ └──────────────┘ └──────────────┘        │
└───────────────────────────────────────────────────────────┘
┌ Needs you now (ActionQueuePanel, unchanged) ──────────────┐
```

- **Component:** `src/components/journey/PersonaRail.tsx` + `PersonaInsightCard.tsx`. Design system primitives only (card, status-pill, metric styling from journey cards). RAG severity dot matches spine language.
- **Card anatomy:** severity pill · headline ZAR (confirmed, R format) · one-line detail · external-context line (small, muted, only when present: "↑ ZAR/USD 18.9, +2.1% this week") · single CTA. Unverified values get the existing dashed/`unverified` treatment.
- **Persona picker:** compact select in the rail header. Shows saved persona by default; switching is instant (refetch `/api/insights`); "Set as my default" persists to profile.
- **Visibility:** rail renders only for EXECUTIVE_ROLES + manager with a resolvable persona; others see current JourneyHome exactly as-is. Board members (redirected to /board-digest) get a read-only CEO rail embedded at the top of BoardDigestPage.
- **Empty/error states:** fetch fail → rail collapses to one quiet line ("Insights unavailable — data connection issue"), never fake-empty. No assessment yet → onboarding nudge card.
- **CEO variant:** fixed 5-card layout (§4.7) instead of ranked list.

### 8.2 Settings

Settings → Profile gains "Your role focus" persona select (the word "persona" never appears in UI copy; label is **"Your view"**). IAM user editor gains the same field for admins.

### 8.3 Reports

`/executive-summary` gains a persona filter chip row (All · CFO · CPO · …) that filters the findings section by the same `PERSONA_SIGNAL_MAP` — zero new numbers, pure grouping. PDF/Excel exports keep the unified gated headline (#483 invariant).

---

## 9. Data & migration summary

| Change | Where |
|---|---|
| `users.persona TEXT NULL` | new migration |
| `PERSONA_SIGNAL_MAP`, `EXTERNAL_RELEVANCE_MAP` | `persona-insights.ts` (static maps, lock-tested like FINDING_INFERENCE_KIND) |
| Cron: external-signals-feed daily | `wrangler.toml` + scheduled handler |
| `GET /api/insights` | new route file `workers/api/src/routes/insights.ts` |
| No changes to | detectors, confidence gate, findings_summary shape, billing math (except §6.2 Tier-B FX PR, separately approved) |

---

## 10. Phasing

**Phase 1 — ship the lens (1 PR each):**
1. Persona field + picker + `/api/insights` + PersonaRail with **internal signals only** (all 40 detectors mapped, all 7 personas). Immediately valuable, zero external dependencies, zero billable-number risk.
2. External feed cron + external_pulse strip + context annotations (FX, Brent, regulatory). Context-only.
3. Full catalyst catalog activation + recommendation-mapper drift fix + paused-by-default guard.

**Phase 2 (after owner review of phase 1 in production):**
4. Tier-B FX revaluation PR (owner sign-off — changes billable numbers).
5. New external sources (SARB rate, commodity index, wage index).
6. Executive-summary persona filter; board-digest CEO rail.

**Out of scope (explicitly):** per-persona RBAC roles; external-signal-driven ZAR arithmetic; push/email digests (existing board-digest covers it); ML-ranked insights (severity+value ranking is deterministic and explainable — revisit only if users say ranking is wrong).

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| External feed flakiness pollutes dashboard trust | Last-known + timestamp; internal insights never blocked; context-only framing |
| 76-cluster activation causes task storms | Non-starter clusters enable paused; autonomy tiers unchanged |
| Persona lens implies numbers differ per person | Same gated totals everywhere; personas filter/annotate, never recompute — assert in tests that sum of persona views ⊆ findings_summary |
| FX revaluation shifts billable value | Isolated Tier-B PR, owner sign-off, release note |
| Scope creep to 7 bespoke dashboards | One rail component + one static map; persona differences are data, not code paths |
