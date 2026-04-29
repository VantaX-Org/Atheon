# Customer Success Playbook — First 10 Customers

**Audience:** Atheon CS team, sales engineering, account managers.
**Purpose:** turn the engineering moat into customer-realised value during the first 90 days. Without this motion, paying customers churn from confusion, not product gaps.

---

## Why this exists

The product is *more* than most customers can absorb day-one. Atheon ships:

- 40 detectors with quantitative value-at-risk
- 96 bespoke catalyst handlers + 374 catalog-aware
- Closed-loop calibration, cryptographic provenance ledger, DP-noised peer benchmarks
- Three deployment models (saas, hybrid, on-premise)

A buyer who said yes to the demo will not absorb that surface area unaided. The first ten customers need a high-touch motion that picks one or two things to celebrate in week one and lets the rest unfold over months.

**Outcome of week 1:** customer has connected ERP, run one assessment, deployed one catalyst, approved one HITL action, seen one finding resolved on real data.

If those five things happen, the customer keeps paying. If any one of them *doesn't* happen, the customer is at risk.

---

## Onboarding stage gates (week-by-week)

### Week 0 — Pre-kickoff (ops + AM)

- [ ] Tenant provisioned in Atheon (`/admin/tenants` create, plan tier set, contact emails added)
- [ ] Welcome email sent with login URL + temporary password
- [ ] Customer's nominated admin user has logged in once (verify in `/admin/tenants` Last Login column)
- [ ] Pricing & contract attached to tenant in `/revenue` (so MRR aggregation is correct from day 1)
- [ ] Slack channel `#customer-<slug>` created with the AM, CS engineer, and on-call eng

**Stop-gate:** if the admin user hasn't logged in by the kickoff call, that call moves to a re-onboarding call. Do not push features onto a customer who hasn't logged in.

### Week 1 — Kickoff & ERP connect

**Kickoff call (45 min, video):**

1. **Welcome + 60-second demo of `/trust`** — show calibration accuracy, Merkle root, peer benchmarks. This is the moat made tangible. Use the Trust page even if their tenant is empty — show the platform-level numbers from your own demo tenant. *(5 min)*
2. **Walk through `/dashboard` and the Onboarding Checklist widget.** The checklist is the customer's source of truth for week-1 progress. *(5 min)*
3. **ERP connect.** Use `/integrations` → Add Connection. Most customers are SAP / Odoo / Xero / NetSuite — those have first-class adapters. For others, use the canonical flat-file uploader. *(20 min, screen-share)*
4. **Run first assessment.** Once ERP is connected, kick off a Quick assessment from `/assessments`. Wait for it to complete on the call. Open the Findings tab and review the top 3 findings together. *(15 min)*

**Day 2–5 (async):**

- [ ] CS reviews the Findings tab in the customer's tenant; identifies the **single highest-value finding** for the customer's industry
- [ ] CS schedules a 30-min "first finding" review call for end of week 1
- [ ] On the review call: deploy the recommended catalyst from the finding's Deploy button; demo the HITL approval flow if applicable

**Stop-gate at end of week 1:**
- [ ] At least 1 ERP connection healthy
- [ ] At least 1 assessment run with non-zero findings
- [ ] At least 1 catalyst deployed
- [ ] At least 1 HITL approval recorded (real or synthetic)

If any of these is false, the customer is in **yellow**. Loop in eng on Slack within 48h.

### Week 2 — First real outcome

**Goal:** customer attributes a real-world dollar outcome (recovered, avoided, or accelerated) to an Atheon catalyst.

- [ ] Pick one catalyst run from week 1 and record the outcome via `recordOutcome` (POST `/api/v1/catalysts/simulations/:id/record-outcome`). This is what feeds the calibration loop.
- [ ] CS sends a "first outcome" email to the customer's exec sponsor with: catalyst name, predicted value, actual value, accuracy %.
- [ ] Customer's exec sponsor sees the residual on `/trust` page.

**Stop-gate at end of week 2:**
- [ ] At least 1 outcome recorded
- [ ] Calibration accuracy displayed on Trust page (even if cold-start band is wide)
- [ ] CS has scheduled the week-4 ROI review call

### Week 3 — Expanding catalyst footprint

- [ ] Roll out 2 more catalysts based on Findings tab priorities
- [ ] Configure HITL approver assignments in `/catalysts` → HITL Permissions tab (so approvals route to the right person, not the platform admin)
- [ ] Set up tenant-specific webhook destinations in `/webhooks` (Slack, MS Teams, generic HTTP) for HITL notifications

### Week 4 — ROI review call

**Format:** 30-min call with customer's exec sponsor + AM + CS engineer.

1. **Open `/apex` Briefing tab** and walk through the executive summary
2. **`/trust` page** — show 4-week calibration accuracy, provenance Merkle root with the verify button live, any peer-pattern coverage available for their industry
3. **Quantify the value capture so far** — sum of recorded outcomes, list the catalysts that contributed
4. **Set the next-30-day plan** — which 3 findings get catalysts deployed; which exec attends the next review

**Stop-gate at end of week 4:**
- [ ] Recorded value capture is non-zero AND ≥3× monthly subscription cost
- [ ] Exec sponsor agrees to a recurring monthly review
- [ ] Customer rates the experience NPS ≥7 (informal, not survey)

If recorded value capture is below 3× subscription, escalate to the Atheon AE within 48h. The deal is at risk of churn at the next renewal.

---

## SLA contract (first 90 days)

| Severity | Definition | Ack | Resolve |
|---|---|---|---|
| P0 | Production down for the customer; data loss; auth broken | <30 min | <4 h |
| P1 | Critical feature broken; ERP feed silent >24 h; HITL approvals not landing | <4 h | <1 day |
| P2 | Non-critical feature broken; UI bug; report rendering glitch | <24 h | <1 week |
| P3 | Feature request | <1 week | scheduled in roadmap |

Track all P0 / P1 in `/support` (admin console). Customer-side users file via `/support-tickets`. Weekly review every Monday — close stale tickets, follow up on aged P2.

---

## Per-customer profile dossier

Before kickoff, CS prepares a one-page dossier covering:

- **Industry vertical** (so we know which catalysts to prioritise — Mining vs FMCG vs Healthcare have different first-week wins)
- **ERP system + version** (so we know which adapter to use; flag if it's an unusual variant we haven't tested)
- **Multi-company structure** (does the tenant need `erp_companies` rows for entities? if so, configure on day 0)
- **Top 3 business problems they articulated in the sales process** (use these to pick the first catalyst)
- **Exec sponsor** (the person whose attention determines renewal)
- **Champion** (the day-to-day power user)

Store in Notion / Confluence under `Customers/<slug>/Onboarding Dossier`. One page max — if it doesn't fit, you don't know the customer well enough.

---

## Handing off from CS to AM

After day 90, the customer transitions from white-glove CS to standard AM motion. Hand-off checklist:

- [ ] All P0/P1 historical tickets closed
- [ ] At least 5 catalysts in regular use
- [ ] At least 10 HITL approvals processed
- [ ] At least 4 weeks of recorded outcomes (drives calibration confidence)
- [ ] Exec sponsor attended ≥3 monthly reviews
- [ ] Champion has trained at least 1 backup
- [ ] CS engineer signs off in writing (Slack + ticket)

If any item is unchecked, do not hand off. Extend CS by another 30 days.

---

## Common first-90-day failure modes (with mitigations)

| Failure | Symptom | Mitigation |
|---|---|---|
| ERP credentials wrong but customer doesn't realise | First assessment runs but returns no findings | CS checks `/integrations` → Connection Health daily for week 1; if 0 records loaded for 24h, page customer. |
| Champion leaves company in week 6 | Catalyst usage drops to 0 | Insist on a backup champion in week 4. Record both in dossier. |
| Exec sponsor never logs in | Renewal call fails because exec doesn't know the value | Force a one-page printable summary (Apex Board Report) and email it monthly to exec, even if they don't open the app. |
| Customer gets approval-fatigued by HITL | Approvals queue over 50, nothing getting decided | Reduce HITL strictness in `/catalysts` → HITL Permissions or move catalyst to autonomous tier (with audit trail). |
| Customer wants a feature we don't have | Repeated escalations | Be honest about timing. If <90 days, ship it. If >90 days, write up the requirement and price the work. Don't promise vapor. |

---

## Internal escalation paths

- **CS issue not resolving in 48h** → AM, then VP Customer Success
- **Engineering issue (P0/P1)** → on-call rotation in `#oncall-eng`, paged via `runbook.md` §4
- **Compliance / legal** → general counsel before any customer-facing communication
- **Pricing / commercial** → CRO; never negotiate price changes inside CS

---

## What we measure

These are the four numbers a CS lead reports weekly. Lower is worse:

1. **Activation rate (week-4)**: fraction of new customers reaching all four week-1 stop-gates. Target ≥85%.
2. **Time-to-first-recorded-outcome**: median days from kickoff to first `recordOutcome` call. Target ≤14 days.
3. **Calibration ratio at day 30**: median customer's calibration accuracy. Target ≥75%.
4. **CS-attributed gross retention at day 90**: fraction of week-0 customers still active at day 90. Target ≥95%.

If any of these slips for two consecutive weeks, schedule a CS-eng sync to find the structural cause. Don't treat it as a per-customer problem.
