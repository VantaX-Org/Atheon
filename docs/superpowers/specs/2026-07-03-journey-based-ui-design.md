# Journey-Based UI — Evaluation & Design

**Date:** 2026-07-03
**Status:** Approved (design authority delegated — "free to design, no constraints")
**Driver:** User base feedback: *"the system is way too complicated."*

---

## 1. Evaluation — why Atheon feels complicated

The product does one thing: it turns ERP data into recovered money. That is a
five-step loop. The UI presents it as ~50 flat analytics pages.

Concrete findings (verified in code, 2026-07-03):

1. **50 pages for a 5-step product.** `src/pages/` holds 50 page components,
   ~37,700 lines. An admin's reachable surface is 5 pinned nav items + a
   5-item Workspace disclosure + a **23-item Admin disclosure**, crossed with
   a module switcher and a company/tenant switcher. Three hidden context axes
   (role × module × company) mean the same URL shows different things.
2. **Four overlapping executive surfaces.** `/dashboard`, `/apex`,
   `/executive-summary`, `/roi-dashboard`, `/board-digest` all present
   variations of "how is the company doing / what did Atheon save." The
   router carries six redirect fossils from previous merges of duplicated
   pages — proliferation is chronic, not accidental.
3. **The home page is a wall, not a door.** `Dashboard.tsx` (1,008 lines)
   loads ~12 data engines on first paint (health, risks, metrics, anomalies,
   clusters, actions, control-plane health, intelligence, radar context,
   diagnostics, ROI, baseline comparison). Nothing tells the user what to do
   next.
4. **Mega-pages hide a dozen screens each.** CatalystsPage 3,273 lines (~12
   sub-sections), PulsePage 3,077, ApexPage 2,371, IntegrationsPage 1,651
   (~14 panels). Single URLs, walls of tabs.
5. **Jargon as navigation.** Apex, Pulse, Catalysts, Mind, Memory, Action
   Layer, Control Plane, Stop-gates, Value Ledger — invented codenames in
   UPPERCASE mono. Nav label ≠ route ≠ concept (`/trust` → "ASSURANCE").
6. **Onboarding is a tour, not a journey.** The 7-stop wizard deep-links
   across 7 different pages, mirroring the complexity instead of hiding it.
7. **The prior redesign re-skinned the problem.** The 55-screen "Luminous
   Editorial" deck maps one mockup to each existing page — visual polish,
   zero IA change. The only flow-level rethink in flight is Feature A
   (exposure-proof front door), which is exactly the right instinct: upload →
   see real exposure → act.

**Root cause:** the information architecture is organized by *system
capability* (one page per engine) instead of *user intent* (one step per
stage of the value loop).

## 2. Design principles

1. **The product is a loop; the UI is the loop.**
   `CONNECT → DETECT → FIX → RECOVER → REPORT`. Every screen belongs to
   exactly one stage or to Admin.
2. **Plain language first.** Stage names are verbs a CFO uses. Codenames
   survive only as technical detail inside pages (a catalyst run is still
   called a catalyst run *on* the Fixes page).
3. **One canonical page per stage.** Everything else is a drill-down from it
   or lives behind Workspace/Admin.
4. **Home answers two questions:** *where am I in the loop* and *what needs
   me now* — one number and one action per stage, not twelve charts.
5. **No re-theme.** Luminous Editorial tokens, primitives, and glass shell
   stay untouched. This is IA and flow, not paint. (The token layer has
   already churned green→blue once; a third repaint is complexity, not
   simplicity.)

## 3. The journey model

| Stage | Nav label | Canonical route | Live number on Home | Home CTA |
|---|---|---|---|---|
| Connect | **DATA** | `/data` (new, thin) | sources connected · data freshness | Connect / upload data |
| Detect | **FINDINGS** | `/findings` (new, thin) | open exposure (R) · open findings count | Review findings |
| Fix | **FIXES** | `/catalysts` (existing, relabeled) | fixes awaiting approval · running | Approve fixes |
| Recover | **SAVINGS** | `/roi-dashboard` (existing) | recovered this period (R) · ROI multiple | See savings proof |
| Report | **REPORTS** | `/executive-summary` (existing) | last report date | Generate board report |

RAG dot per stage follows the existing rule (status/health only): green =
healthy/idle, amber = needs attention, red = at risk (e.g. stale data, red
findings, stalled approvals).

**Current stage** = first stage with outstanding work; it gets the accent
highlight. A brand-new tenant sees stage 1 active with a single "Connect your
data" action — the journey spine **is** the onboarding, and it aligns with
Feature A's first-run empty state (same upload → exposure spine).

## 4. Information architecture changes

### Sidebar (standard user sees at most 7 rows)

```
HOME        /dashboard        (JourneyHome — new)
DATA        /data             STANDARD_ROLES
FINDINGS    /findings         STANDARD_ROLES
FIXES       /catalysts        OPERATOR_ROLES
SAVINGS     /roi-dashboard    EXECUTIVE_ROLES
REPORTS     /executive-summary EXECUTIVE_ROLES
────────────────────────────
WORKSPACE ▸  Apex · Pulse · Board Digest · Memory · Mind · Trust
ADMIN ▸      (unchanged, 23 items, platform admins only)
SETTINGS
```

- `/trust` ("Assurance") demotes from primary rail to Workspace — it is
  proof/telemetry, not a journey stage. Scoped roles unchanged (auditor →
  `/compliance`, board_member → `/board-digest`).
- Admin disclosure untouched. Admins are power users; they are not the
  complaining population, and 23 items one disclosure deep is acceptable.

### Home — `JourneyHome` replaces `Dashboard.tsx`

Layout, top to bottom:

1. **Header row** — greeting + one plain sentence locating the user:
   *"3 sources connected · R4.2M open exposure · R160.6M recovered to date."*
2. **The Spine** — five stage cards in a horizontal flow (stacks on mobile).
   Each card: stage verb, one big number, RAG dot, one CTA. Current stage
   accent-highlighted with the 3px royal-blue rule (existing active-state
   language).
3. **Needs you now** — the single highest-priority item (top pending catalyst
   approval, else biggest unreviewed finding) as a hero row, then the
   existing `ActionQueuePanel` (reused component) beneath it.

That is the whole page. No KPI grid, no radar, no diagnostics, no baseline
cards — those live in Pulse/Apex (Workspace) where analysts already have
them. `Dashboard.tsx` is deleted; `ActionQueuePanel` is reused;
`FindingsReviewTable` moves to `/findings`.

Data: every spine number comes from endpoints the old dashboard already
calls (`api.assessments.findings`, ROI tracking, action queue, integration
health). One `Promise.all`, skeleton per card, per-card error → em-dash
(never block the page on one engine).

### New thin pages (composition, not construction)

- **`/data` (DataPage)** — connected sources with freshness (reuse the
  integration-health list component), latest dataset summary, and the
  upload entry point (links to the existing ingest flow; becomes Feature A's
  logged-in upload home when that ships). Read-only for analysts.
- **`/findings` (FindingsPage)** — exposure headline (Σ open value-at-risk,
  confidence-gated per the traceability rule — gate-failed value never in
  the headline), `FindingsReviewTable` (existing component), severity/domain
  filters (existing `FilterBar`), drill to finding detail. This gives
  findings a canonical home for all standard roles — today the full list is
  buried on a superadmin-only page.

### Stage framing on existing pages

A small shared `JourneyStageBar` (one line: `DATA → FINDINGS → [FIXES] →
SAVINGS → REPORTS`, current stage marked, prev/next clickable) renders under
the PageHeader of the five canonical stage pages. One component, five
one-line insertions. Mega-page internals are **not** rewritten.

### Copy renames (labels only — routes and code identifiers unchanged)

| Old label | New label | Where |
|---|---|---|
| CATALYSTS | FIXES | Sidebar, JourneyStageBar |
| ASSURANCE | TRUST | Workspace disclosure |
| Catalysts page title | "Fixes" + subtitle "Catalyst runs — automated remediations" | CatalystsPage header |

### Deletions & redirects

- `Dashboard.tsx` and dashboard-only sub-cards it exclusively used are
  deleted (KpiGrid, IntelligencePanel etc. — content duplicated in
  Pulse/Apex). `/dashboard` now renders JourneyHome (URL unchanged —
  bookmarks keep working).
- The 7-stop `/onboarding` wizard stays for now (it also gates MFA setup);
  follow-up: fold it into the spine's first-run state once Feature A lands.

## 5. Error handling & testing

- Spine cards degrade independently: failed fetch → em-dash + tooltip,
  never a blocked page.
- Role gating reuses the existing `visibleFor`/`ProtectedRoute` machinery —
  no new auth logic.
- Tests: one render test per new page (JourneyHome spine renders 5 stages,
  current-stage logic; FindingsPage headline excludes gate-failed value),
  Sidebar role-filter test updated. Existing e2e smoke (login → dashboard)
  must stay green.

## 6. Explicitly out of scope

- Rewriting Catalysts/Pulse/Apex/Integrations mega-page internals.
- Any token/theme change.
- Renaming code identifiers or API routes ("catalyst" stays in code).
- Feature A implementation (separate approved spec; this design aligns with
  it but does not depend on it).
- Consolidating the four executive surfaces into one (follow-up; REPORTS is
  the canonical door to them now).

## 7. Success criteria

- A standard user's visible surface: **7 nav rows**, all plain-language.
- Home first paint: 5 numbers + 1 action, `< 1` screen tall above the fold
  on a laptop.
- Every stage page states its place in the loop and links the next step.
- No net-new heavy pages: 2 new thin pages, 1 deleted 1,008-line page.
