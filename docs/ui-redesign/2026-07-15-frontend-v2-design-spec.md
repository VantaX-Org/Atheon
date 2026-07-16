# Atheon Frontend v2 — "The Brief" Design Spec

**Date:** 2026-07-15 · **Status:** v2 FINAL (post-interrogation)
**Audience for this product:** C-suite and senior managers of mid/large enterprises. People with 90 seconds, not 90 minutes.
**Bar:** top-10 world company craft. Stripe's clarity, Apple's restraint, Bloomberg's information trust.

**Interrogated by a four-expert panel** (sitting-CFO buyer lens · principal product designer · information architect · forensic accountant). 40 findings, 10 blockers — all resolved in this version. Panel verdicts and the change log are in §14.

---

## 0. The one-sentence thesis

**Executives don't navigate software — they read a brief and make decisions.**
Everything in v2 derives from that sentence. The product stops being a
dashboard suite and becomes a daily financial brief with a decision queue and
a sealed receipt for every number.

## 1. Diagnosis — why the current UI angers senior people

| Symptom | Root cause |
|---|---|
| Exec sees 12 nav items, admin 35+ | Nav mirrors our org chart and codebase, not the user's job |
| Five pages answer "how are we doing" (/dashboard, /apex, /executive-summary, /roi-dashboard, /board-digest) | Every initiative shipped its own summary page; none was deleted |
| Codenames as navigation: Apex, Pulse, Mind, Memory, Catalysts, Control Plane, Action Layer | Internal architecture leaked into the UI |
| CatalystsPage: 3,298 lines, 8 tabs, ~60 state hooks | One URL hiding twelve screens; "cluster", "HITL", "autonomy tier" on screen |
| Three invisible context axes (role × module × company) change what a URL shows | Same link means different things to different people — screenshots can't be shared |
| Widget-grid dashboards | Grids force the reader to do the editor's job: decide what matters |

Users aren't confused because they're non-technical. They're angry because
the product makes *them* assemble the story it was hired to tell.

## 2. The v2 model — surfaces and the full role matrix

Every visit is one of a small number of questions. Each question gets one
surface and nothing else:

| Question | Surface | Replaces |
|---|---|---|
| **"What's happening with my money?"** | **Brief** | JourneyHome, Apex, Executive Summary, ROI Dashboard, Pulse, Board Digest |
| **"What needs me?"** | **Decisions** | Action Layer, approvals tab of Catalysts, pending-fix CTAs |
| **"Prove it."** | **Ledger** | Findings, ROI detail, Audit/Billing Proof |
| **"Is the machine running?"** | **Operations** | Catalysts (8 tabs), Data page, Connectivity, Integration Health |
| **"Show me the evidence."** (scoped) | **Assurance** | Compliance, Audit log, Data Governance, proof-pack export |
| Platform administration | **Console** | Everything in today's ADMIN disclosure |

### 2.1 Role → surface matrix (all ten roles + custom)

| Role | Brief | Decisions | Ledger | Operations | Assurance | Console | Landing |
|---|---|---|---|---|---|---|---|
| executive | ✓ | ✓ | ✓ | — | — | — | Brief |
| manager | ✓ | ✓ | ✓ | ✓ | — | — | Brief |
| analyst | ✓ (team edition) | — | ✓ **workbench altitude** (§5.4) | ✓ read | — | — | Ledger |
| operator | — | — | ✓ read | ✓ | — | — | Operations |
| board_member | **Board edition only** (§3.4, scoped API) | — | — | — | — | — | Brief (Board) |
| auditor | — | — | — | — | ✓ | — | Assurance |
| admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Brief |
| support_admin | impersonation-first workflow; own surfaces = Console + Assurance | | | | ✓ | ✓ | Console |
| superadmin | all | all | all | all | all | all | Console |
| custom roles | Custom Role Builder composes from these six surfaces + altitude flags — nothing finer-grained. A custom role is a row in this table, not a new nav. |

Nav rendered per row, in surface order. Exec cohort: **3 items, zero
disclosures.** "Zero admin vocabulary in exec DOM" (§13) is scoped to
tenant roles; superadmin/support see everything by definition.

### 2.2 The identity menu (the only other place anything lives)

Avatar menu, complete inventory — nothing else may creep into nav:
**Company switcher** (multi-tenant users) · Viewing-as persona picker ·
Settings · MFA · Support tickets · Sign out. Onboarding is not a page: it
is the Brief's first-run state (§3.5-b). The module switcher dies. Today's
/trust page dies as in-app nav; its proof story lives in Ledger/Assurance
(the public marketing trust pages are unaffected).

### 2.3 URLs — every object addressable

The v1 diagnosis named three hidden axes; killing the module switcher fixes
one. The other two are fixed by putting **company and object in the URL**:

```
/:companySlug/brief/2026-07-15?as=cfo     dated Brief edition (permalink)
/:companySlug/decisions/:decisionId
/:companySlug/ledger?period=2026-Q2       period filters are URL state
/:companySlug/ledger/:findingId           finding (receipt: ?receipt=<provenanceId>)
/:companySlug/operations/sources/:sourceId
/:companySlug/operations/playbooks/:playbookId
/:companySlug/assurance/evidence/:packId
```

Receipt-drawer state round-trips via `?receipt=` so a pasted URL reopens
the exact drawer. A screenshot's URL now reproduces the screenshot.

## 3. Brief — the flagship surface

The Brief is a **narrative document, not a dashboard** — generated from the
same APIs as today, laid out like the front page of a financial paper the
reader owns. Read end-to-end in under 90 seconds on a phone.

### 3.1 The closed primitive set (hard law)

The Brief tree is **one column, max measure 65ch**, composed ONLY of:

| Primitive | Rule |
|---|---|
| `Dateline` | date · company · freshness attestation (§3.6) · "Viewing as: CFO ▾" |
| `Figure` | max ONE per screenful; a `<Money>` hero with basis label |
| `Sentence` | prose line; numbers appear only inline via `<Money>` |
| `DecisionCard` | ≤3 on the Brief; the only card-shaped object |
| `ContextStrip` | the fenced external-signals strip (§3.7) |
| `ProgressRule` | one-line journey strip (§3.8) |

**No `display:grid` is permitted anywhere in the Brief tree.** CI enforces
this the same way it greps codenames (§13). This is the rule that stops the
Brief degrading back into a dashboard with sentences.

### 3.2 Anatomy (top → bottom)

1. **Dateline.** "Tuesday 15 July · Acme Foods · All 4 sources fresh,
   verified 06:00." Attestation rules in §3.6.
2. **The figures.** For CEO/CFO editions, two `Figure`s, never combined,
   never netted, each labelled with its measurement basis and period
   (forensic F5, CFO F1):
   - **"Recovered since onboarding (Mar 2026): R4.2m · Atheon fee R1.05m ·
     net to you R3.15m"** — realized, verified cash; the fee line is
     receipt-linked like every other number. The vendor's fee on the front
     page is a trust device no competitor will copy.
   - **"Confirmed open exposure as at 06:00: R1.8m"** — estimated
     recoverable, unrealized, labelled as such.
   Directly beneath: **one cumulative trend line** — confirmed recovered
   vs the contracted target/business case ("on track for R6m by Dec").
   Absolute numbers with no baseline are decoration.
3. **Since you were last here.** 1–4 delta `Sentence`s from the
   `brief_cursor` (§3.5). **Reversals outrank gains** (§3.3). Overflow:
   "…and 12 more changes → Ledger."
4. **Needs your decision.** Zero to three `DecisionCard`s; more → "and 4
   more in Decisions." Zero → "Nothing needs you today." (Absence stated,
   never blank.)
5. **Your lens.** Persona editions change the figures, lens sentences, and
   delta sort — never the document structure. Lens content is stacked
   `Sentence`s with receipt links, NOT a card row. CPO reads input-cost
   exposure, CMO foreign revenue, CFO net position (the economic-exposure
   work ships here unchanged, still `context`-fenced where it is context).
6. **Context, clearly fenced** (§3.7).
7. **The loop, demoted** — `ProgressRule` at the bottom; orientation, not
   content.

### 3.3 Narrative honesty rules (hard law — forensic F1/F2)

Prose is where numbers get minted, so prose is where the law is strictest:

- Sentences are **deterministic, versioned templates in code**. No LLM or
  free-text generation path exists on any money surface, ever.
- The verb vocabulary is a **closed set mapped 1:1 to ledger states**:
  confirmed / in review / approved / recovered / reversed / downgraded.
  Zero adjectives, zero causal claims, zero trend language not computed
  from ledger rows.
- Every numeric token renders via `<Money>` with provenance (§9). An
  aggregate sentence carries the finding IDs it sums — "worth R310k" is a
  claim with a receipt or it is a type error.
- **Reversals are mandatory lines**: same sentence weight as gains (no
  muting), higher priority under the 4-line cap, state prior and new value
  ("Finding #4411, confirmed at R120k on 2 Jul, was reversed — R0
  recoverable"), and **persist until explicitly acknowledged**, not until
  next visit. The Ledger row carries reversal history permanently.
- Every delta names the **accountable internal owner** and the finding's
  age (30/60/90) — "R1.8m open" is noise until it says who is sitting on
  it (CFO F5).

### 3.4 Editions

Same document structure; the figures, lens, and delta sort change:

- **CEO/CFO/COO/CPO/CMO/CHRO/CIO** — persona editions, picker in dateline.
- **Team edition (analyst/manager)** — deltas scoped to their queue.
- **Board edition** — a **frozen, dated snapshot** ("as at 30 Jun"), not a
  live screen-share: boards read packs, not apps (CFO F7). Distinct
  **scoped API endpoint** (no Decisions, no operational deltas — the role
  is procurement-scoped narrower than exec, IA F2). Rendered in
  presentation mode (§8) and exportable to PDF. Same `<Money>` component,
  **no edition-specific rounding**; unverified/context items keep explicit
  text labels ("not counted"), never colour-only; pagination is
  content-complete — reversals and the Context fence may paginate, never
  drop; every abbreviated figure carries the exact value in a footnote
  (forensic F8).
- **Email/Teams digest** — the Brief's delivery mechanism, because execs
  live in Outlook, not in apps (CFO F6). Scheduled digest of sections 1–4
  with deep links into Decisions; the web Brief is the destination, not
  the delivery.

### 3.5 `brief_cursor` — "since you were last here" done honestly (IA F6)

Server-side per-user cursor, explicit API (`GET/ADVANCE /brief-cursor`):

- Advances only when the Brief renders **for the real user** —
  impersonation never advances an exec's cursor.
- Multi-device safe (phone 07:00, laptop 09:00 — one cursor).
- Same-day revisit: "Nothing new since 06:12." — absence stated.
- (a) Reversal lines ignore the cursor: they persist until acknowledged
  (§3.3).
- (b) **First-run**: no cursor → the Brief renders its onboarding state —
  dateline, "Your Brief starts with your data", connect-sources CTA, and a
  worked sample edition clearly watermarked SAMPLE. The onboarding wizard
  dies as a separate page.
- 6-month absentee: window caps at the cursor but the delta list caps at 4
  + "…and 47 more changes → Ledger."

### 3.6 The freshness attestation (CFO F3, forensic F7)

"Verified 06:00" is a defined check, not a vibe: **all sources synced
within SLA and gates re-run since**. It degrades honestly:

- All fresh → "All 4 sources fresh, verified 06:00."
- One stale → dateline names it AND a banner fences the damage: "Payables
  last synced Mon 02:00 — Payables figures may be understated." A dead
  connector can never silently serve stale numbers under a fresh
  timestamp. This inherits the existing fetch-failure law ("a loading
  problem, not your data").

### 3.7 Context, clearly fenced

External pulse (FX, CPI, Brent, one real headline with source domain) as a
single quiet strip labelled **"Context — not counted in your numbers."**
Fence is typographic: smaller, no colour, hairline rule above. `value_kind:
'context'` rows can never render in §3.2-2, Decisions, or Ledger totals —
enforced at the type level (§9).

### 3.8 What the Brief refuses to do

- No grids of metric cards; max one number per sentence.
- No chart without a sentence above it stating what the chart proves.
- No empty state that looks like success. "No confirmed findings yet — 2
  in review" beats a green zero.
- Nothing more than one tap from its receipt (§5.3).

## 4. Decisions — the queue that respects how authority actually works

One list, sorted by money at stake. Every item: **amount · counterparty ·
what approving does · consequence if ignored · who queued it · actions.**

### 4.1 Actions (CFO F2)

**Approve · Reject (with reason — "this finding is wrong" is the most
common real outcome and feeds detector calibration) · Hold · Delegate ·
Route to owner** (e.g. "pending discussion with procurement").

### 4.2 Authority model (CFO F2/F10)

- **Delegation-of-authority matrix**: amount bands → required approvers;
  above a configurable limit, **dual sign-off** — the item shows
  "1 of 2 signatures."
- **Delegation is a first-class object**: delegate, scope (amount band /
  category), start/end dates (leave cover), every action logged to the
  Ledger against the *acting* authority ("approved by J. Naidoo under
  delegation from R. Govender, 1–15 Aug").
- **SLA escalation**: a decision aging past its deadline with the approver
  absent escalates per the matrix.

### 4.3 What "Approve" actually does (CFO F8)

Every decision type declares its **system of record**. If the action
executes in the customer's ERP workflow, Atheon integrates with that
release strategy — it never builds a parallel approval chain internal
audit will flag. If Atheon is advisory, the button says what it does:
**"Authorise Atheon to draft and queue."** No approval theater.

### 4.4 Consequence line — honest, never a fear ticker (forensic F6)

The "if ignored" slot is a rule bound to ledger/contract facts only.
Allowed: a dated, sourced deadline ("supplier credit-note window closes
30 Sep per contract") or a factual state ("remains open exposure; no
deadline"). Forbidden: extrapolated accruing losses, countdowns, red
styling (RAG is status-only), any projected Rand that isn't itself
gate-passed. No factual consequence → the line says so.

### 4.5 Batch approval (CFO F9, forensic F3)

- Batch groups by **counterparty**, shows supplier name + relationship
  flag; a flagged strategic supplier in the set **blocks batch** — that
  clawback is a phone call, not a thumb-tap. "Route to procurement" is
  offered instead.
- The batch tap expands an **itemised sheet** (amount, finding ID, receipt
  reference per item) that must be reviewed before submission.
- Submission writes **N individual immutable ledger entries** sharing a
  batch-id — each with approver identity, session, timestamp, and a
  snapshot hash of the item as rendered. Items whose gate status or amount
  changed between render and submit are **rejected server-side and
  re-presented** — never silently approved at the new value.

### 4.6 Interaction quality (designer F7/F8)

- Single-item approve is **optimistic with a 5-second inline undo**
  ("Approved R310k — Undo"); server commit happens at undo expiry, then
  the Ledger line materialises. No confirmation dialogs — they train
  blindness; undo is the safety. Batch is the exception: the itemised
  sheet (§4.5) is its deliberate confirmation.
- **Keyboard-first**: J/K to move through the queue, A/R/H to act, ⌘K
  command palette everywhere (jump to any finding, source, company).
- Phone-flawless at 390px — this is the interaction an exec repeats most.

## 5. Ledger — every rand has a receipt

### 5.1 The surface

One continuous, filterable ledger of findings and recoveries. Confirmed
rows in ink; unverified rows greyed with "needs review — not counted."
**Period filters and period-over-period totals are first-class**
(`?period=2026-Q2` — "compare Q1 vs Q2" must not be a dead end, IA F8).
Past Brief editions are archived and immutable (`/brief/2026-04-15`) —
citable in board packs.

### 5.2 The receipt — a sealed snapshot, not a live view (forensic F4)

A receipt must survive a billing dispute six months later, so it is an
**immutable, hash-chained snapshot captured at confirmation time**:

- source ERP row IDs **and row content hashes**, ingest dataset ID + sync
  timestamp (builds on the existing Tier-A `erp_record_id` traceback work)
- detector name + **version + config** at detection time
- each gate check with its **threshold and measured value**, not just
  pass/fail
- FX rate + rate date when converted
- confirmation timestamp; approver identity + approval timestamp
- reversal history **appended, never overwritten**

"Share proof pack" exports exactly this snapshot (surface lives in
Assurance; button also on the Ledger for exec convenience).

### 5.3 The depth law, stated honestly (IA F5)

"Two taps everywhere" breaks on aggregates, so the real law is:

> **Any number reaches *its own* receipt in ≤2 taps.** An aggregate's
> receipt lists its components as full-page Ledger links — the drawer
> promotes to a page, it never stacks a second drawer. A leaf receipt
> links onward to the source-document viewer.

### 5.4 Two altitudes on one object (IA F7)

The same Ledger row opens differently by role: **execs** get the receipt
drawer; **analysts** get the finding workbench page — status transitions,
false-positive marking with reason, notes, evidence attachments, detector
config and a link to the producing run in Operations → Queue. The grey
rows are the analyst's whole job; the workbench is where unverified
becomes confirmed (or dies honestly).

## 6. Operations — for the people who run the machine

The 8-tab CatalystsPage becomes three screens; "catalyst", "cluster",
"sub-catalyst", "HITL", "autonomy tier" are deleted from UI vocabulary:

1. **Queue** — what's running, blocked, failed; retry/inspect; run detail
   (today's `/catalysts/runs/:id`) keeps a stable URL. Activity feed and
   run analytics fold in as filters, not tabs.
2. **Playbooks** — what's allowed to run and when, written as sentences:
   "When a duplicate payment over R10k is confirmed, draft the recovery
   letter and queue it for approval." The plain-language autonomy policy
   ("recoveries under R50k run automatically; you approve everything
   above") lives here and is mirrored read-only in Decisions.
3. **Sources** — each source: connected/broken, last sync, **and a real
   detail view** (last N runs, error text, affected entity counts, one-tap
   OAuth re-auth). This is currently PLATFORM_ADMIN-gated front and back;
   migration explicitly re-cuts the relevant `workers/api` endpoints to
   MANAGER_ROLES (IA F9 — named as backend work in §10, not hand-waved).

## 7. Assurance and Console

- **Assurance** (auditor, compliance roles): read-only Ledger + evidence
  packs + audit log + governance records. The external PwC auditor lands
  here and never sees anything else. Proof-pack generation lives here.
- **Console** (admin world): IAM, tenants, feature flags, webhooks,
  platform health, impersonation, LLM budgets, support triage — behind a
  single entry with its own left nav. Zero admin vocabulary in tenant-role
  DOM. The Console gets the same ⌘K palette — quarantined ≠ neglected.

## 8. Design language — "Luminous Editorial", finished

Keep the identity (warm paper `#f1efe8`, ink `#1a1a17`, royal blue
`#2456d6` reserved for action/brand, RAG strictly for status). Finish it:

### 8.1 Typography (designer F3)

- **Serif carries the prose voice only** — dateline, delta sentences,
  section headers. Face: Tiempos Text class (licensed) with a
  metric-matched system fallback; **no swap-flash on the hero** — a FOUT
  on "the number" destroys the trust device.
- **Every numeral is Inter `tnum` at every size.** The money law (§9)
  requires numbers to render identically everywhere; editorial serifs
  ship weak tabular figures, so numerals never set in serif.
- Scale extends the existing 4-level scale upward: hero 56–64px desktop,
  36px at 390px. Test the widest realistic string (R1.24bn + basis label)
  at 390px.

### 8.2 Motion (designer F4)

Two-tier law:
- **One signature motion**: the Receipt drawer — 360ms, `--ease-drawer`
  (the existing iOS-curve token; 250ms flat feels snatched).
- **Functional feedback ≤160ms**: presses, toasts, menus — opacity/
  transform only, travel ≤8px.
- **No count-up animation anywhere** (designer F9 + forensic F10 agree: a
  mid-animation Rand figure is a transiently false billable number, and
  animated money reads as marketing). Numbers render true instantly.
- Delete the decorative keyframes already in index.css (`orbit`,
  `particle-drift`, `float-3d`, `glow-pulse`, `hero-rotate`) — slop the
  old spec allowed and this one outlaws.
- `prefers-reduced-motion` collapses both tiers to fades.

### 8.3 States (designer F5)

Each of these has a rule, not a hope:
- **Loading**: sentence-shaped skeletons (not card skeletons), zero layout
  shift.
- **First-run**: §3.5-b.
- **Partial sources**: §3.6.
- **Long tenant names**: dateline truncates the company, never the
  attestation.
- **Huge numbers**: §8.1 width test; `<Money>` compact rules in §9.
- **Long-absence deltas**: §3.5 cap.

### 8.4 Presentation mode

The one dark theme in the product, for the Board edition only (§3.4):
near-black paper, high-contrast type, paginated. Confirmed/unverified is
**never colour-only** here — explicit text labels — because grey-on-dark
degrades on projectors exactly when a board is watching.

### 8.5 Accessibility floor

WCAG 2.2 AA. 4.5:1 contrast everywhere **including the grey unverified
treatment** (muted ≠ illegible). Full keyboard paths for every decision
action (§4.6). True values in the DOM/accessibility tree always.

## 9. `<Money>` — the honesty law as a type system

One component renders every monetary value in the product. Not `<Rand>` —
the platform is multi-tenant with `useTenantCurrency()`; a component named
after one currency is a bug at the type level (designer F2).

- **`provenance` is a required prop.** A number without a receipt is a
  type error. `value_kind: 'context'` renders only inside `ContextStrip`.
- **Format table** (single source of truth, CI-tested):
  - compact: R412k / R4.2m / R1.24bn — thresholds 100k / 1m / 1bn,
    ≤3 significant figures, **never round a claim up** (forensic F9)
  - full precision: SA locale space grouping — R4 182 309
  - exact value always one tap away (receipt) and in the a11y tree
  - negatives: −R120k (true minus, not hyphen); reversals never
    parenthesised away
  - tabular figures always; confirmed = ink, unverified = 40% grey +
    dotted underline + label — identical treatment on every surface
    including Board edition.

## 10. Migration — no big bang, no half-brand, nobody locked out

0. **Substrate first** (designer F10): ship v2 tokens globally — type
   scale + serif, `<Money>`, the Receipt drawer (additive everywhere),
   delete decorative keyframes and legacy `card-dark/card-mint/teal`
   aliases. CatalystsPage gets a token-only reskin as a holding position
   so the people demoing to execs don't live in the ugly half for months.
1. **Ship Brief** at /dashboard behind a flag; "classic view" available
   with a **dated removal commitment** tied to the time-to-first-decision
   metric, not an aspiration. Ship the email digest with it (§3.4).
2. **Ship Decisions** with the authority model (§4.2 — DoA matrix is
   backend + UI).
2.5 **Re-cut role gates before any 301** (IA F3 — hard precondition):
   scoped landings for board_member (Board-edition endpoint) and auditor
   (Assurance) must exist and be gated **before** `/board-digest` and
   `/compliance` redirect, or those roles redirect-loop / lock out
   mid-engagement. Also re-cut the Sources backend endpoints to
   MANAGER_ROLES (§6.3).
3. **Fold the five exec summaries** into Brief editions; 301 the routes.
4. **Rebuild Operations** (kills CatalystsPage — biggest lift, last).
5. **Quarantine Console**; delete the module switcher.

Each step independently shippable and reversible. Route fossils get
redirects, as today.

## 11. What dies

Pages deleted or absorbed: JourneyHome, ApexPage, ExecutiveSummaryPage,
ROIDashboardPage, PulsePage, BoardDigestPage (→ Brief editions),
ActionLayerPage (→ Decisions), FindingsPage (→ Ledger two-altitude),
AuditPage + CompliancePage + DataGovernancePage (→ Assurance),
CatalystsPage 8 tabs + DataPage + ConnectivityPage + IntegrationHealthPage
(→ Operations), OnboardingWizardPage (→ Brief first-run), TrustPage
(in-app; public trust pages remain), ModuleSwitcher, PlatformTotalsChip,
CalibrationChip (→ dateline attestation), CostOfInactionTicker (fear
ticker; §4.4 is its honest replacement), FlipCard (gimmick), count-up
animation, decorative keyframes.

Vocabulary deleted from UI: Apex, Pulse, Mind, Memory, Catalyst, Cluster,
Sub-catalyst, HITL, Autonomy tier, Control Plane, Action Layer,
Calibration.

## 12. Success criteria

- Exec cohort nav: **3 items**, zero disclosures. Every role in §2.1 has a
  working landing surface — no dead ends, no redirect loops.
- Brief readable end-to-end < 90s; time-to-first-decision < 30s from open.
- Any number → its receipt in ≤2 taps (§5.3 law).
- Zero internal codenames in tenant-role DOM; **no `display:grid` in the
  Brief tree** — both CI-enforced.
- A pasted URL reproduces what the sender saw (company + object + receipt
  state in the URL).
- Weekly active execs and decision throughput become *the* product
  metrics.

## 13. CI enforcement (the spec that can't regress)

- Grep rendered exec-cohort routes for banned vocabulary (§11 list).
- Lint: no `grid` in Brief component tree; no numeral outside `<Money>`
  on money surfaces (custom ESLint rule matching currency-shaped
  literals); `provenance` required by types.
- `<Money>` format table is a unit-tested pure function.
- Reversal-persistence and batch-itemisation rules get integration tests —
  they are billing-dispute defences, not UX niceties.

## 14. Panel verdicts (summarised) and what changed

- **Sitting CFO**: "Demos beautifully and dies in the audit committee"
  until fee-transparency, real delegation of authority, and stale-source
  honesty exist. → §3.2-2 fee line, §4.2 DoA, §3.6 attestation, §3.4
  frozen board pack + email digest, §4.5 counterparty grouping.
- **Principal designer**: "Strategic spine is top-tier; as a design spec
  it's an essay" — the Brief would degrade back into a dashboard without
  hard layout law. → §3.1 closed primitives + CI, §9 `<Money>` format
  table, §8.1 numeral policy, §8.2 motion law, §8.3 states, §10 step 0.
- **Information architect**: "Written for three personas in a ten-role
  product" — auditor/analyst/board dead ends, migration lockout. → §2.1
  matrix, §7 Assurance, §5.4 workbench, §2.3 URLs, §3.5 cursor API,
  §10 step 2.5.
- **Forensic accountant**: "An unverifiable sentence is an unverifiable
  invoice." → §3.3 template law, reversal persistence, §4.5 itemised
  batch, §5.2 sealed receipts, §3.2 un-netted figures, §4.4 consequence
  rules.
