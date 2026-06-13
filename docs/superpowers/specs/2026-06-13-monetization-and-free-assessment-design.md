# Atheon — Monetization & Free Assessment Design

**Date:** 2026-06-13
**Owner:** Reshigan Govender (CEO/CTO)
**Author:** Spec produced under directive from Luke Templeman
**Status:** DRAFT — awaiting Reshigan sign-off on outcome-model legals + cost-of-serve floor
**Currency convention:** ZAR primary, USD secondary (FX assumption R18.00/$1 for all bands below; bands are list-price anchors, not contractual)

---

## 0. TL;DR

Atheon goes to market with a **Free Assessment** wedge: a fully-automated 30-90 day run of the 4-phase Value Assessment Engine (DataQuality → ProcessTiming → LiveCatalyst → ValueQuantification → PDF) against a prospect's ERP, producing a board-ready PDF that quantifies the recoverable rand value sitting in their P&L today. Prospects convert into one of three commercial models:

1. **Fixed Subscription** — predictable monthly fee, all catalysts on
2. **Base + Catalyst** — lower platform fee, per-catalyst activation
3. **Shared Savings (Outcome)** — % of proven, ERP-traceable realised savings, with floor + cap

**Lead model on website + first sales conversation: Shared Savings.** It removes buyer risk on the wedge of "does it work for *us*", inverts the procurement objection from "spend approval" to "no-brainer", and is consistent with the binding business-model memory rule that every claimed rand is an ERP-traceable artefact. Fixed and Base+Catalyst are positioned as the **conversion path after value is proven** — typically Year 2 — once the customer wants predictable opex over share-of-outcome.

All AI in customer-visible artefacts is attributed only to **"Atheon Intelligence"**. No model, vendor, or provider name appears in any PDF, contract, pricing page, or sales deck (binding trade-secret rule).

---

## 1. Free Assessment Offer (the wedge)

### 1.1 Positioning (one line)

> *"We'll run our full catalyst suite against 90 days of your ERP, free, and hand you a board-ready report showing exactly which rand you're losing — and where."*

### 1.2 What the prospect gets

- A board-ready PDF (the existing Phase-5 ValueQuantification → PDF output)
- A live read-only walkthrough call (45 min) with an Atheon analyst
- A signed NDA + data-handling addendum before any credential exchange
- A `va-demo-<slug>` assessment slot provisioned in the platform (existing convention)
- 7-business-day SLA from credentials-received to PDF-delivered

### 1.3 Eligibility filters (gate at intake form)

| Filter | Pass criteria | Why |
|---|---|---|
| Annual revenue | ≥ R250m (≈$14m) | Below this, recoverable value rarely covers Atheon cost-of-serve |
| ERP | SAP (ECC/S4), Oracle (EBS/Fusion), NetSuite, Sage X3/300/Intacct | Coverage of existing catalyst connectors |
| Geography | South Africa, broader SADC, EU, UK, ANZ, North America | Where we can sign DPAs without bespoke legal |
| Decision-maker on intake | CFO, FD, Head of Finance, Head of Procurement, CIO+CFO joint | Avoids analyst-tier prospects who can't convert |
| Industry exclusions | Financial services with prudential reporting overlap (Tier-1 banks, insurers), defence, gambling | Compliance complexity > deal size; gate manually |
| Net-new prospect | Has not run an Atheon assessment in the last 18 months | Prevents free-loop abuse |

Intake form lives at `app.atheon.io/assessment` and writes to `prospect_assessment_requests` (new table — see §7.1).

### 1.4 ERP scope

- **Read-only** database credentials OR read-only API token (preferred where ERP supports it — NetSuite, Fusion)
- **No DDL, no DML, no triggers, no stored-proc execution rights** — Atheon connector verifies the cred grant on first connect and refuses to proceed if write privileges are detected
- **Network posture:** customer-side allow-list of Atheon ingress IPs; egress-only outbound from the customer's ERP host where customer prefers a reverse tunnel
- **Data lands** in a tenant-isolated assessment workspace in Atheon's environment; the workspace TTL is 90 days post-PDF-delivery unless the prospect signs a paid contract, in which case it converts to a production tenant

### 1.5 Data period default

- **Default:** trailing 90 days of transactional data + trailing 24 months of master data (vendors, GLs, chart of accounts, payment terms)
- **Minimum:** 30 days (smaller windows produce too few duplicate-payment / discount-leak candidates to meet the n≥25 mode-share rule)
- **Maximum on free tier:** 180 days (anything beyond this is a paid "Deep Look-Back" SKU — see §2.4)

### 1.6 What gets shown in the PDF (free tier)

1. **Executive cover** — total recoverable value (band, not point estimate), confidence colour-coded, 90-day vs annualised
2. **DataQuality phase** — counts of master-data anomalies (vendor duplicates, GL miscoding) with **redacted exemplars** (vendor name → "Vendor #4471")
3. **ProcessTiming phase** — PO → GRN → invoice → payment cycle-time breakages, charted but not drilled
4. **LiveCatalyst phase** — top 5 catalysts that fired, each with: count of candidate transactions, estimated recoverable rand, confidence band, sample of 3 redacted exemplars per catalyst
5. **ValueQuantification phase** — recoverable-value waterfall by catalyst, annualised
6. **Call-to-action panel** — "Unlock the full ERP-keyed line items, your commercial model, and ongoing monitoring" + the three commercial models

### 1.7 What stays gated until paid conversion

- **Un-redacted ERP record identifiers** (vendor IDs, invoice numbers, PO numbers, GL line refs) — this is the binding "every rand = ERP record + field mapping + confidence" rule; we show the value, not the rows, on the free tier
- **The remediation workflow** — Atheon's prescriptive playbooks for closing each catalyst
- **Ongoing monitoring** — only point-in-time on the free tier; continuous monitoring is a paid feature
- **Calibration loop** — predicted-vs-realised tracking is paid only
- **Bulk export / API access** to findings
- **Catalysts beyond the top 5** (free shows the top 5 by recoverable value; rest are named but not quantified)

### 1.8 Security & compliance posture

- Read-only creds only; connector self-aborts on detected write privilege
- ISO 27001-aligned controls (control mapping documented in customer-facing trust pack)
- POPIA + GDPR data-processing addendum signed before credentials issued
- Data residency: SA-region by default for SADC customers; EU-region for EU/UK; US-region for North America (cell-based isolation)
- All assessment data encrypted at rest (AES-256) and in transit (TLS 1.3)
- 90-day post-delivery data destruction with signed certificate of destruction (CoD) emailed to prospect if they don't convert

### 1.9 Max effort cap

- **Atheon-side max effort per free assessment: 8 person-hours** (analyst delivery + sales handoff)
- **Compute cost cap: R3,500 / $200** (governed by assessment-workspace resource quotas)
- **Hard timeout: 30 calendar days** from credentials-received to either PDF-delivered or assessment-cancelled — beyond this, the slot is reaped

### 1.10 Time-to-deliver SLA

- **7 business days** from credentials-received → PDF emailed
- **2 business days** for the walkthrough call to be scheduled after PDF delivery
- **Breach remediation:** 10% discount on first paid month if SLA missed for Atheon-controlled reasons

### 1.11 Who delivers

- **Self-serve tier:** intake form → automated provisioning → automated 90-day catalyst run → PDF auto-generated → analyst signs off in a 30-minute QA pass → email delivery
- **Assisted tier:** for prospects > R5bn revenue, an analyst owns the engagement end-to-end (still 7-day SLA)
- **Initial state:** all assessments are assisted until we have 20 completed free assessments under our belt (calibration burn-in)

### 1.12 Intake → conversion mechanics

```
[Prospect lands on /assessment]
    ↓
[Intake form: company, revenue band, ERP, role, contact]
    ↓ (passes eligibility filters in §1.3)
[Auto-email: NDA + data-handling addendum DocuSign]
    ↓
[NDA signed]
    ↓
[Atheon SE schedules creds-exchange call (30 min)]
    ↓
[va-demo-<slug> slot provisioned, connector configured]
    ↓
[Catalyst suite runs — 4 phases — 5-7 business days]
    ↓
[Analyst QA pass]
    ↓
[PDF emailed + walkthrough call scheduled]
    ↓
[Walkthrough: 45 min — present findings, propose one of 3 models]
    ↓ branch
[Convert → MSA + chosen-model order form]   [Decline → 90-day data destruction + CoD]
```

### 1.13 Call-to-action copy (in the PDF)

> **You have between R[low] and R[high] of recoverable value sitting in your ERP today.**
> The line items, vendor IDs, and remediation playbooks are ready in your Atheon tenant.
> **Three ways to unlock them:**
> • **Pay only when we save you money.** Shared-savings outcome model — Atheon takes a share of the rand we prove we recovered, traced to your ERP records. *Recommended for first-time partners.*
> • **Predictable monthly platform fee.** All catalysts on, unlimited monitoring.
> • **Base + per-catalyst.** Lower platform fee, pay per active catalyst.
> **Book your commercial walkthrough:** atheon.io/convert

---

## 2. The three commercial models

### 2.1 Model A — Fixed Subscription

**Positioning (one-liner):** *"A predictable monthly platform fee. All catalysts on. Cancel any time after 12 months."*

**Pricing levers:** annual revenue band of the customer; number of ERP entities/companies/ledgers; number of seats with write access to the remediation workflow.

**Target ICP:** Mid-market and enterprise CFOs who **prioritise opex predictability** over capturing the absolute maximum upside. Often required by procurement teams who need a fixed line-item in budget. Industries: regulated financial services (post-prudential-screen), large manufacturing, regulated utilities.

**Example pricing bands:**

| Revenue band | Monthly (ZAR) | Monthly (USD) | Notes |
|---|---|---|---|
| R250m–R500m | R45 000 | $2 500 | 1 ERP, ≤3 entities, ≤10 seats |
| R500m–R2bn | R85 000 | $4 700 | 1 ERP, ≤10 entities, ≤25 seats |
| R2bn–R10bn | R165 000 | $9 200 | up to 2 ERPs, ≤30 entities, ≤75 seats |
| R10bn–R50bn | R310 000 | $17 200 | up to 3 ERPs, ≤100 entities, unlimited seats |
| > R50bn | Custom | Custom | reference quote starts at R600 000 / $33 000 |

Annual prepay = 2 months free (16.7% discount).

**Technical billing path:**
- `billing_contracts` table: `model='fixed'`, `monthly_fee_zar`, `term_months`, `entity_cap`, `seat_cap`
- `billing_invoices` table: generated on the 1st of each month, fixed amount, sent to AR system (initially manual, automated in 90-day roadmap)
- ERP traceability requirement: **none** for billing itself (this is the model's value-prop — billing is decoupled from outcomes), BUT the catalyst findings still carry their ERP traceability metadata (binding business-model rule applies to the *platform*, not just the billing model)

**Sales-cycle implications:**
- Procurement: moderate friction — annual budget line item required
- Legal: standard SaaS MSA + DPA; 3–6 weeks legal review on first deal
- Finance approval: CFO sign-off + procurement; sometimes board for > R200k/month

**Margin shape:** highest gross margin (75-85%) because compute cost is amortised across all paid months. Cash-flow shape: best — monthly recurring with prepay incentive.

**Risk of abuse:** **Customer turns off catalysts they don't trust** — they still pay full freight but stop providing the data plumbing for some catalysts, then claim Atheon "isn't delivering value". Mitigation: quarterly business reviews with realised-value reporting + a 12-month minimum term with a 60-day exit window only if Atheon misses the value-delivered floor (defined per deal).

---

### 2.2 Model B — Base + Per-Catalyst

**Positioning (one-liner):** *"Lower platform fee. Activate the catalysts you want. Scale up or down monthly."*

**Pricing levers:** base platform fee (covers ingestion, monitoring, support); per-catalyst monthly activation fee; number of active catalysts.

**Target ICP:** Mid-market CFOs who want **modular adoption** — start with 2-3 catalysts they know hurt (e.g. duplicate-payments + early-pay-discount-leak) and add more once trust is built. Often where finance team has limited bandwidth to act on more than a few catalysts at once.

**Example pricing bands:**

| Component | ZAR | USD |
|---|---|---|
| Base platform fee (R250m–R2bn rev) | R18 000/mo | $1 000/mo |
| Base platform fee (R2bn–R10bn) | R45 000/mo | $2 500/mo |
| Base platform fee (>R10bn) | R90 000/mo | $5 000/mo |
| Per active catalyst | R6 500/mo each | $360/mo each |
| Volume break: 6+ catalysts active | -15% on per-catalyst rate | same |
| Volume break: 10+ catalysts active | -25% on per-catalyst rate | same |
| All-catalysts-on cap | = the Fixed Subscription tier for that band | same |

Floor: minimum 2 active catalysts at all times (no base-only configurations).

**Technical billing path:**
- `billing_contracts` table: `model='base_plus_catalyst'`, `base_monthly_zar`, `per_catalyst_monthly_zar`
- `billing_catalyst_activations` table: `(contract_id, catalyst_id, active_from, active_to)` — supports mid-month proration
- Invoice generation: `base + (active_catalyst_days / month_days) * per_catalyst_rate` summed across all activations
- ERP traceability: same as Model A — billing is decoupled, platform findings retain traceability

**Sales-cycle implications:**
- Procurement: lower friction (smaller base fee = lower approval threshold to start)
- Legal: same as Model A
- Finance approval: easier — often FD-level sign-off for base + 2 catalysts; CFO approval added when scaling past 5

**Margin shape:** middle (65-75%). Per-catalyst compute cost is a known variable but customer churn-down (deactivating catalysts) creates revenue volatility. Cash-flow shape: monthly recurring but variable.

**Risk of abuse:** **Catalyst-cycling** — customer activates a catalyst for one month, harvests findings, deactivates next month, reactivates 6 months later. Mitigation: minimum 3-month activation per catalyst, plus a "data freshness" clause — findings older than 60 days from an inactive catalyst expire from the remediation workflow.

---

### 2.3 Model C — Shared Savings (Outcome-based)

**Positioning (one-liner):** *"Pay only when we save you money. We take a share of the rand we prove we recovered, traced to your ERP."*

**Pricing levers:** share-percentage of proven realised savings; monthly floor; quarterly cap; verification cadence.

**Target ICP:** First-time Atheon partners; CFOs who have been burned by a vendor over-promising; private-equity-owned portfolio companies where the PE wants zero-risk on opex; companies where procurement is the gating stakeholder and won't approve a fixed fee without precedent.

**Example pricing bands:**

| Component | ZAR | USD |
|---|---|---|
| Atheon share of proven realised savings | 22% (default) | 22% (default) |
| Negotiation band | 15-30% | 15-30% |
| Monthly floor (R250m–R2bn rev) | R20 000/mo | $1 100/mo |
| Monthly floor (R2bn–R10bn rev) | R50 000/mo | $2 800/mo |
| Monthly floor (>R10bn rev) | R100 000/mo | $5 600/mo |
| Quarterly cap | 2x the equivalent Fixed Subscription tier for that revenue band | same |
| Term | 24 months minimum | same |
| Calibration grace period | First 90 days = floor only; share-of-savings starts month 4 | same |

The floor exists because Atheon's cost-of-serve (compute + analyst + connector maintenance) does not go to zero if a customer happens to have no savings that month. The cap exists because a one-time massive recovery (e.g. a single R40m duplicate-payment caught in month 7) would otherwise produce a R8.8m Atheon invoice that no CFO will pay without a fight.

**Technical billing path:**
- `billing_contracts` table: `model='shared_savings'`, `share_pct`, `floor_zar`, `cap_zar_per_quarter`, `term_months`, `calibration_months`
- `assessment_realized_outcomes` table (NEW — see §6.7): tracks every claimed rand → ERP record → verified outcome event
- Monthly invoice = `max(floor, share_pct * sum(realised_savings where verified_at in month))`, capped per quarter
- ERP traceability: **mandatory and load-bearing**. Every line on the invoice traces to a row in `assessment_realized_outcomes` which traces to (a) an ERP record ID, (b) a field mapping showing where the saving was captured, (c) a verified outcome event (e.g. credit note posted, payment recovered, discount captured), (d) a confidence value, (e) the originating catalyst run.

**Sales-cycle implications:**
- Procurement: lowest friction at point-of-entry ("no spend until we save you money")
- Legal: **highest** friction — bespoke commercial terms, dispute clauses, audit rights for the customer over our `assessment_realized_outcomes` records. Expect 6-10 weeks legal review on the first deal of this shape.
- Finance approval: easiest to get initial CFO buy-in; hardest to get accounting treatment agreed (see §8 — open questions)

**Margin shape:** lowest in early months (floor barely covers cost-of-serve), widens dramatically in months 6-18 as catalyst calibration improves and realised-savings rate climbs. Long-term gross margin 60-80% but with much higher variance than A or B. Cash-flow shape: lumpy — quarterly true-ups create cash spikes; floor keeps the baseline stable.

**Risk of abuse / arbitrage:**

1. **Customer disputes every claim to drive share-pct down.** Mitigation: dispute window is 30 days from invoice; un-disputed claims auto-finalise. Material disputes (>5% of a month's invoice) trigger joint review with named CFO + Atheon delivery lead.
2. **Customer terminates after realising savings on year 1, denies Atheon year-2 revenue.** Mitigation: 24-month minimum term; ETL (early termination liability) = remaining floor × 60%.
3. **Customer attributes Atheon-discovered savings to internal initiative** ("we would've caught it anyway"). Mitigation: the binding rule — every claimed rand must trace to an Atheon catalyst run that pre-dates the customer's remediation action. The audit log on the catalyst-run is immutable and timestamped before the ERP correction event.
4. **Customer leaks the model and our share-pct floor to competitors.** Mitigation: MSA confidentiality clause + liquidated damages.
5. **One-time recovery distortion** (the R40m duplicate-payment case). Mitigation: the quarterly cap.

---

### 2.4 Adjacent SKUs (not the three core models, but mentioned for completeness)

- **Deep Look-Back assessment** — paid one-time, 24 months of historical data run through catalyst suite. R175 000 / $9 700 per ERP per look-back. Cannibalises free-assessment but only when prospect explicitly wants > 180 days history.
- **Catalyst Co-Build** — bespoke catalyst tailored to a specific customer process. Time & materials at R3 200/hr / $180/hr. Outputs feed the standard catalyst library if generalisable (with customer's permission and an attribution fee).
- **Quarterly Board Pack** — a hardened version of the assessment PDF run quarterly for the board, R25 000/qtr / $1 400/qtr.

---

## 3. Decision rubric — which model for which prospect

| Signal | Lean toward |
|---|---|
| CFO/FD says "I need budget predictability" | **Fixed (A)** |
| Procurement is the bottleneck | **Shared Savings (C)** |
| Customer has been burned by a vendor over-promising | **Shared Savings (C)** |
| Customer wants to start with 2-3 catalysts and expand | **Base + Catalyst (B)** |
| Private equity portfolio company | **Shared Savings (C)** (the PE thesis is zero-opex-risk) |
| Listed company with strict accounting policy on contingent fees | **Fixed (A)** or **Base + Catalyst (B)** — shared-savings has accounting complexity (§8) |
| Highly seasonal business (retail, agri) | **Base + Catalyst (B)** — can dial catalysts down off-season |
| Manufacturing / heavy industry | **Fixed (A)** — long cycle times, predictable workflow, opex-budget culture |
| Financial services (post-prudential screen) | **Fixed (A)** — contingent-fee accounting concerns + audit committee scrutiny |
| Retail / FMCG | **Shared Savings (C)** — high transaction volumes → high catalyst hit rate → high realised savings → both parties win |
| Customer ERP is in poor data-quality state | **Shared Savings (C)** with extended calibration grace — protects customer from paying floor while DataQuality phase cleans up |
| First-time Atheon customer | **Shared Savings (C)** — proves the thesis before they commit to a fixed fee |
| Renewal / second-year customer | **Fixed (A)** — value is proven, customer wants opex predictability |
| Customer wants to give Atheon scope across 5+ ERPs | **Fixed (A)** with custom band — easier to price the breadth |
| Customer hates % deals philosophically (some CFOs do) | **Fixed (A)** |

**Industry signals at a glance:**
- Retail / FMCG / hospitality / distribution → C
- Manufacturing / heavy industry / utilities → A
- Financial services → A (B as fallback)
- Healthcare → B (catalyst-by-catalyst rollout matches risk culture)
- Mining / resources → A or C (depending on whether procurement leakage is a known problem)

**Prospect-readiness signals:**
- Has someone owning "leakage" or "controls" already → C (they'll track outcomes well)
- No finance transformation in flight → A (they need a packaged solution)
- Active ERP migration → defer assessment 6 months OR scope to legacy-system only

---

## 4. Default recommendation — lead with Shared Savings

Atheon should lead with **Shared Savings (Model C)** on the website hero, in the first sales conversation, and in the Free Assessment PDF call-to-action.

**Justification:** First, it collapses the buyer's risk to zero, which is the single biggest objection a CFO has to a new vendor making bold value claims. Second, it is structurally consistent with the binding business-model rule that every claimed rand must trace to an ERP record + field mapping + confidence + verified outcome event — leading with the model that operationalises this rule keeps Atheon honest and gives the sales conversation a credibility anchor competitors cannot copy without rebuilding the platform. Third, the Free Assessment already gives the prospect a quantified opportunity number; the natural next sentence is "and we'll take a share of it once we prove it" — Fixed and Base+Catalyst require the prospect to do a value-vs-fee mental conversion that adds friction. Fourth, Shared Savings makes the Free Assessment self-financing: the assessment itself is a sunk cost we recover from a single quarter of shared savings once the prospect converts. Fifth, year-2 conversion to Fixed (predictability) is a natural up-sell with very high retention, so leading with C does not trap us in low-margin revenue. Sixth, this aligns the sales motion with how procurement actually approves: "no spend until proven" gets through faster than "R85k/month please".

**The website hero stays:** "Pay only when we save you money. Start with a free assessment."

Fixed and Base+Catalyst remain prominently available on the pricing page — for the procurement-driven and modular-adoption ICPs identified in §3 — but they are not the lead.

---

## 5. Conversion funnel + metrics

### 5.1 Funnel stages

```
[Visit /assessment]
    ↓ (form_started, form_submitted)
[Eligibility pass]
    ↓ (eligibility_passed, eligibility_failed_<reason>)
[NDA sent → signed]
    ↓ (nda_sent, nda_signed)
[Creds exchanged]
    ↓ (creds_received, connector_validated)
[Assessment running]
    ↓ (assessment_phase_<n>_started, assessment_phase_<n>_completed)
[PDF delivered]
    ↓ (pdf_delivered)
[Walkthrough call held]
    ↓ (walkthrough_held)
[Opportunity qualified]
    ↓ (opportunity_qualified, model_proposed_<a|b|c>)
[Contract signed]
    ↓ (contract_signed, tenant_provisioned)
[First catalyst remediation actioned by customer]
    ↓ (first_realised_outcome) ← critical "activation" event
```

### 5.2 Instrumentation events (write to `funnel_events` table)

`event_name`, `prospect_id`, `assessment_id` (nullable), `contract_id` (nullable), `ts`, `payload` (jsonb), `source` (`web`|`platform`|`sales`)

### 5.3 Target conversion benchmarks (year-1 hypothesis, to be calibrated)

| Stage transition | Target rate | Why |
|---|---|---|
| Visit → form_submitted | 6-10% | typical B2B enterprise |
| form_submitted → eligibility_passed | 40-55% | tight ICP filters |
| eligibility_passed → nda_signed | 60-75% | sales lift required |
| nda_signed → creds_received | 70-85% | IT-side friction |
| creds_received → pdf_delivered | 90%+ | Atheon-controlled |
| pdf_delivered → walkthrough_held | 85%+ | sales discipline |
| walkthrough_held → contract_signed | 30-45% | the moment of truth |
| **Top-of-funnel → contract** | **~3-7%** | conservative |

### 5.4 What kills conversion (watch for these)

- **NDA legal cycle > 14 days** — kills momentum; offer a pre-approved short-form NDA
- **IT can't issue read-only creds in < 7 days** — pair with an Atheon SE to run the cred-creation session live
- **Top recoverable-value < R3m annualised** on the PDF — prospect won't justify any model; either qualify out or offer the Catalyst Co-Build SKU
- **CFO not on the walkthrough** — single biggest predictor of stall; require CFO attendance as a precondition for booking the walkthrough
- **Procurement gets involved before walkthrough** — collapses pricing power; sequence the conversation so commercials are agreed in principle before procurement is looped in

### 5.5 North-star + leading indicators

- **North-star:** contracted ARR (Fixed + Base) + trailing-3-month annualised shared-savings revenue
- **Leading:** PDF-delivered → walkthrough-held rate, walkthrough → contract rate, time-to-first-realised-outcome (Model C only)

---

## 6. Shared-savings (outcome) model deep-dive

### 6.1 Definition of "proven realised savings"

A realised saving is a rand value claimed by Atheon that satisfies **all four** of:

1. **ERP record trace** — there exists a row (or set of rows) in the customer's ERP that *changed state* in a way consistent with the catalyst's predicted remediation. Example: a duplicate-payment catalyst flagged invoice INV-44781; the realised outcome event is the credit note CRN-9921 posted against the original supplier that recovers the duplicate amount.
2. **Field mapping** — the specific field(s) on the ERP record that evidence the recovery are mapped and stored at the time of the claim. For credit notes: `vendor_master.vendor_id`, `credit_notes.original_invoice_ref`, `credit_notes.amount`, `credit_notes.posted_at`.
3. **Verified outcome event** — the recovery is verified by either (a) a customer-acknowledged event (signed verification in the remediation workflow), OR (b) an ERP-detected event (the credit note appears in the ERP feed and matches expected fingerprint), OR (c) both.
4. **Confidence ≥ 0.85** at the time of claim (calibrated, see §6.2).

Claims that fail any of these go to the **provisional** bucket and do not bill until they pass or are written off after 90 days.

### 6.2 Calibration loop (predicted vs realised)

Per the binding inference-strength memory rule:

- **Sample size ≥ 25** outcomes per catalyst per tenant before that catalyst's confidence scores are trusted for billing
- **Mode share ≥ 70%** of outcomes must fall in the predicted range (i.e. for 25 sampled claims with predicted range R10k-R50k each, ≥18 must realise within that range)
- Catalysts not meeting both bars revert to **assisted-claim mode** — every claim requires a human Atheon analyst sign-off before it bills

Calibration runs nightly. Per-catalyst-per-tenant calibration metrics are exposed in a `calibration_dashboard` view (paid feature; not on free tier).

False-negative bias is preferred over silent false-positives (memory rule). When unsure, the platform asks the customer ("we believe this credit note recovers the flagged duplicate-payment, please confirm") rather than auto-billing.

### 6.3 Billing cadence

- **Monthly retrospective** — on the 5th of each month, generate an invoice for the prior month's realised outcomes that crossed all four bars in §6.1 during that month
- **Quarterly true-up** — on the 5th of the month following quarter-end, run a true-up: any provisional claims from the quarter that *just* crossed the bar in the final days of the quarter are added; any claims that were billed but now fail re-verification are credited
- **Annual reconciliation** — 12-month review with the customer's internal audit team if requested in the MSA

### 6.4 Floor + cap mechanics

- **Floor:** `max(invoice, floor_zar)` — if a month produces zero qualifying realised outcomes, the customer pays the floor. This protects Atheon cost-of-serve.
- **Cap:** monthly invoices over the quarter sum to ≤ `cap_zar_per_quarter`. Excess realised savings credited toward the next quarter's invoice (carry-forward), up to a maximum of 2 quarters carry. After 2 quarters, excess is written off (this is the negotiated price of the cap protection from the customer's side).
- **Floor grace period:** months 1-3 of the contract (the calibration burn-in) bill the floor only — no share-percentage applied. This avoids billing the customer based on un-calibrated catalysts.

### 6.5 Disputes process

1. **Dispute window:** 30 days from invoice issue. After 30 days, claims auto-finalise.
2. **Dispute granularity:** per-claim. Customer flags claim `claim_id` with a reason code (`disputed_record`, `disputed_attribution`, `disputed_amount`, `disputed_timing`).
3. **Tier-1 review:** Atheon delivery lead responds within 5 business days with either (a) supporting evidence (ERP record + field mapping + outcome event audit log), (b) withdrawal of the claim, or (c) partial adjustment.
4. **Tier-2 review:** if unresolved after tier-1, customer CFO + Atheon delivery lead joint review meeting within 10 business days.
5. **Tier-3 arbitration:** if unresolved after tier-2, independent forensic accountant nominated by the customer reviews the disputed claims at the customer's expense if Atheon's position is upheld, Atheon's expense if not. Binding outcome.
6. **Material disputes** (>5% of a month's invoice) automatically escalate to tier-2.
7. **Dispute outcomes feed calibration** — withdrawn claims tighten the catalyst's confidence threshold for that tenant.

### 6.6 The `assessment_realized_outcomes` table sketch

```sql
CREATE TABLE assessment_realized_outcomes (
    outcome_id              UUID PRIMARY KEY,
    tenant_id               UUID NOT NULL,
    contract_id             UUID NOT NULL REFERENCES billing_contracts(contract_id),
    catalyst_id             TEXT NOT NULL,              -- which catalyst fired
    catalyst_run_id         UUID NOT NULL,              -- the run that produced the prediction
    candidate_id            UUID NOT NULL,              -- the specific candidate in that run
    erp_record_ref          JSONB NOT NULL,             -- {erp: 'sap', table: 'BSEG', keys: {...}} — the record being recovered
    field_mapping           JSONB NOT NULL,             -- {field: meaning} — which ERP fields evidence the recovery
    predicted_amount_zar    NUMERIC(18,2) NOT NULL,
    predicted_confidence    NUMERIC(4,3) NOT NULL,      -- 0.000 to 1.000
    predicted_at            TIMESTAMPTZ NOT NULL,       -- when catalyst-run made the prediction
    realised_amount_zar     NUMERIC(18,2),              -- nullable until verified
    realisation_event       JSONB,                      -- {event_type: 'credit_note_posted', event_id: 'CRN-9921', ...}
    realised_at             TIMESTAMPTZ,                -- when the verified event landed
    verification_method     TEXT,                       -- 'erp_detected' | 'customer_acknowledged' | 'both'
    verified_by             TEXT,                       -- 'system' | <customer_user_id> | <atheon_analyst_id>
    status                  TEXT NOT NULL,              -- 'provisional' | 'verified' | 'disputed' | 'finalised' | 'written_off'
    billed_invoice_id       UUID,                       -- nullable until billed
    dispute_id              UUID,                       -- nullable
    written_off_reason      TEXT,                       -- nullable
    audit_log               JSONB NOT NULL,             -- append-only state-transition log
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_aro_tenant_status ON assessment_realized_outcomes (tenant_id, status);
CREATE INDEX idx_aro_contract_realised_at ON assessment_realized_outcomes (contract_id, realised_at);
CREATE INDEX idx_aro_catalyst_run ON assessment_realized_outcomes (catalyst_run_id);
```

**Lifecycle state machine:**

```
provisional ──(verification passes)──→ verified ──(invoice issued)──→ finalised
    │                                       │
    │                                       ├──(customer disputes)──→ disputed ──(resolved)──→ finalised | written_off
    │
    └──(90 days no verification)──→ written_off
```

This table is the single source of truth for shared-savings billing. The `audit_log` JSONB is append-only and contains every state transition with timestamp + actor — this is what the customer's internal audit team gets read access to under the MSA.

### 6.7 Connection to existing 30-day quick-win roadmap

The `assessment_realized_outcomes` table is the structural enabler for:
- Per-catalyst calibration dashboards (paid feature)
- The CFO shared-savings strip identified as a sales blocker in [[personas_and_roles]]
- The `auditor` and `board_member` persona views (they query this table read-only)
- The board-report quarterly pack (aggregates this table for the period)

---

## 7. Roadmap to ship

### 7.1 Day 0-30 — "Free Assessment goes live"

**Goal:** First 5 free assessments delivered end-to-end with assisted delivery.

| Item | Owner | Output |
|---|---|---|
| `prospect_assessment_requests` table + intake form at `/assessment` | Eng | Form live, eligibility gating, writes to DB |
| Automated NDA dispatch (DocuSign or PandaDoc) | Ops | NDA round-trip < 3 days p50 |
| `va-demo-<slug>` provisioning script wired to intake form | Eng | One-click slot provisioning |
| Free-assessment terms of use (legal) | Reshigan + legal | Published at `/assessment/terms` |
| PDF email delivery template + branded cover with CTA panel | Design + Eng | Templated, hands-off |
| Sales handoff doc (one-pager per assessment for the walkthrough) | Sales + Eng | Auto-generated from assessment metadata |
| Data destruction job + CoD email on T+90 if no conversion | Eng | Cron + signed PDF email |
| Funnel events instrumentation (§5.2) | Eng | `funnel_events` table populated |
| Connector cred-validation guard (refuses on write privilege detected) | Eng | Self-abort on detected DDL/DML grant |

### 7.2 Day 31-60 — "Commercial models selectable"

**Goal:** Convert a free assessment into a signed contract in < 14 days from PDF-delivery.

| Item | Owner | Output |
|---|---|---|
| `billing_contracts` table + admin UI to configure model A/B/C per tenant | Eng | CRUD + audit log |
| `billing_catalyst_activations` table + per-catalyst on/off toggle | Eng | Mid-month proration supported |
| `assessment_realized_outcomes` table + write path from catalyst run | Eng | Provisional outcomes land on each run |
| Contract templates per model (MSA + order form for A, B, C) | Reshigan + legal | DocuSign-ready |
| Outcome-tracking API endpoint (read for customer, write for system/analyst) | Eng | OpenAPI documented |
| Walkthrough deck templated from PDF + recommended model based on rubric (§3) | Sales + Eng | One-click deck generation |
| Pricing page rebuild — Shared Savings as hero, A and B below | Web + Design | Live on atheon.io/pricing |

### 7.3 Day 61-90 — "Outcome model production-grade"

**Goal:** Bill the first Shared-Savings month-end with a fully automated true-up.

| Item | Owner | Output |
|---|---|---|
| Calibration dashboard per tenant per catalyst (paid feature) | Eng | `calibration_dashboard` view + UI |
| Disputes workflow (customer flag → tier-1 → tier-2 → tier-3) | Eng | UI + state machine |
| Monthly retrospective invoice generator | Eng | Cron on the 5th, emails CFO + AR |
| Quarterly true-up job | Eng | Cron on quarter-end + 5d |
| Audit-rights read-only access for customer's internal audit user role | Eng | RBAC + scoped view of `assessment_realized_outcomes` |
| `auditor` + `board_member` persona views over outcome data | Eng + Design | Closes the sales-blocker persona gap |
| Realised-vs-predicted leaderboard (internal) | Eng | Atheon ops dashboard for calibration health |
| CFO shared-savings strip — persistent header element with MTD realised savings | Design + Eng | Closes the [[personas_and_roles]] gap |

---

## 8. Risks + open questions (need Reshigan)

1. **Accounting treatment of "savings" claims** — Is a recovered duplicate payment treated as a recovery (P&L credit) or an asset adjustment by the customer? This varies by jurisdiction and audit firm. For Shared Savings to work, we need the customer's external auditor comfortable that our claimed savings are recognisable. **Needs:** legal + accounting review with a Big-4 firm, ideally before the first Shared-Savings contract signs. Risk: a customer's auditor refuses to recognise our outcome events, customer refuses to pay.

2. **Legal review of outcome contract template** — The MSA + order form for Model C is the most legally novel of the three. Audit-rights clauses, the dispute-arbitration ladder (§6.5), and the cap carry-forward all need bespoke drafting. **Needs:** Reshigan to brief outside counsel + ~6-week drafting cycle. We should not promise the first Shared-Savings sign before this is done.

3. **What counts as a "realised" outcome in a multi-month cash cycle** — For early-pay-discount-capture, the saving is realised the day the discount is taken. For duplicate-payment recovery, it could be 3-9 months (vendor returns the funds via credit note or bank transfer). For vendor-master-consolidation, the "saving" is process efficiency that may never trace cleanly to a single ERP event. **Needs:** Reshigan's call on the catalyst-by-catalyst definition of "realised event." Recommend per-catalyst playbook documents.

4. **Cost-of-serve floor calibration** — The R20k / R50k / R100k floors in §2.3 are estimates. We need a finance model showing actual cost-of-serve per tenant per revenue band (compute + analyst + connector maintenance + support). **Needs:** Reshigan + finance to produce a per-tenant unit-economics model before pricing locks.

5. **First reference customer for Shared Savings** — Whoever signs first sets the precedent for all future Shared-Savings deals (share-pct, floor, cap, audit terms). **Needs:** Reshigan's call on which prospect we offer the most favourable initial Shared-Savings terms to in exchange for being a named reference. Recommend a mid-market retailer or distributor where catalysts will fire fast.

6. **Free Assessment cannibalising paid Deep Look-Back** — At 180-day max free, we may rarely sell the 24-month paid look-back. Acceptable? Or should the free tier cap at 90 days? **DECIDED 2026-06-13 (Reshigan): free tier caps at 90 days.** The 24-month paid Deep Look-Back stays a paid upsell; free shows the most recent 90 days only.

7. **Demo-environment Shared-Savings simulation** — Should the existing `va-demo-vantax` seed include a worked Shared-Savings example so the sales team can demo the model selector? **DECIDED 2026-06-13 (Reshigan): yes.** Seed `va-demo-vantax` with a worked Shared-Savings example (realised outcomes → share calc → floor/cap applied → monthly invoice) in the Day 31-60 slice so the model selector demos against real numbers.

8. **Brand promise vs trade-secret rule** — The Free Assessment marketing copy needs to talk about how "Atheon Intelligence" finds savings without naming any underlying model/vendor. **Needs:** Reshigan sign-off on the messaging guardrail before web copy ships.

---

## Appendix A — One-page sales rubric (printable)

```
PROSPECT FILTERS (must all pass for free assessment)
  • Revenue ≥ R250m
  • ERP ∈ {SAP, Oracle, NetSuite, Sage}
  • Decision-maker = CFO/FD/CIO+CFO
  • Not in {Tier-1 bank, insurer, defence, gambling}
  • No Atheon assessment in last 18 months

LEAD MODEL — Shared Savings (C)
  • 22% share, 24-month term
  • Floor: R20k–R100k/mo by revenue band
  • Cap: 2× equivalent Fixed tier per quarter
  • Calibration grace: months 1-3 = floor only

FALLBACK — Fixed (A) — for predictability-first ICPs
FALLBACK — Base+Catalyst (B) — for modular-adoption ICPs

CONVERT WHEN
  • Walkthrough complete with CFO present
  • Top recoverable value > R3m annualised
  • IT confirmed read-only creds workable

KILL WHEN
  • NDA stuck > 14 days
  • Top recoverable value < R3m
  • CFO won't join walkthrough
  • Procurement gating before walkthrough
```

---

## Appendix B — Glossary

- **Catalyst** — a discrete savings-finder rule/model in the Atheon suite (e.g. duplicate-payments-detector, early-pay-discount-leak-detector)
- **Catalyst run** — a single execution of a catalyst against a tenant's data window
- **Candidate** — a specific transaction/record flagged by a catalyst as a potential recovery
- **Realised outcome** — a candidate that has been verified as actually recovered (§6.1)
- **Floor** — minimum monthly Shared-Savings invoice
- **Cap** — maximum quarterly Shared-Savings invoice
- **Calibration burn-in** — the first 90 days of a Shared-Savings contract where the floor bills only
- **Atheon Intelligence** — the trade-secret-protected umbrella term for all AI capabilities; the only term used in customer-facing artefacts

---

*End of spec. Awaiting Reshigan sign-off on items 1, 2, and 4 in §8 before the Day-30 slice ships.*
