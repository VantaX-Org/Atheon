# Flow Refactor — the reactor as the central UI concept

**Date:** 2026-07-16
**Status:** Approved direction (user chose "Overview" — the full-variable reactor — over the simplified Riverline band, Command deck, and Editorial spine options)
**Options artifact:** https://claude.ai/code/artifact/446db7d5-b67e-4cf0-a5d8-143e944ba516
**Reference design:** the "Atheon — Recovery Console" artifact (3fcc6521) — the product must look exactly like it.

## Decision record

| Choice | Decision |
|---|---|
| Direction | **Overview reactor** — the full multi-variable river (value chain + leak streams + recovery machine + signature gate pool + review/reversed + fee split) is the persistent centerpiece of the console, because the complexity of variables needs the full graphic, not a simplified 5-stage band |
| Strategy | **From-scratch rebuild** — new console built fresh around the reactor hero; old pages are the feature inventory, not the codebase to restyle. Zero functionality loss (parity gate) |
| Role switching | **Dateline persona + `?as=`** — "Viewing as CPO ▾" in the dateline; URL carries `?as=cpo` so any demo view is a shareable link. Vantax (demo tenant) only; real tenants see their own role, no switcher |
| Tab folding | **Anchor rail, no tabs at all** — the whole console is ONE screen ("single cohesive design"); Brief/Decisions/Ledger/Catalysts are sections on it, the rail scrolls, nothing hidden behind a tab |
| Avatar | **Identity menu** — company switcher · viewing-as · Settings · MFA · Support · Sign out. Absorbs the module switcher and orphaned settings routes |
| Jeff | **Always assisting** — Jeff (the existing honest assistant, `/api/mind/query`) is first-class in the shell on every surface, context-aware of the reactor |

## Goal

Rebuild the frontend **from scratch** around the reactor hero — a new console, not a restyle of the 58 existing pages. Four surfaces where the animated reactor — the full value-chain river — is the first thing on every surface, re-contextualized per surface and per role. Vantax is the demo company with a working persona switcher; CPO is the worked example role.

**Hard constraint: zero functionality loss.** The old UI is the feature inventory, not the codebase to reuse. Every capability a user can perform today must be reachable in the new console before any old page is deleted (see Parity gate below). Reuse is allowed where it is genuinely the lazy correct move (auth, API clients, stores, `journey.ts`, the honesty-gated data hooks); page components are rebuilt fresh in the Recovery Console identity.

## Visual identity (non-negotiable — match the artifact)

- **Fonts:** Schibsted (headings/figures, weights 400–900, letter-spacing −0.015em; hero −0.03em) + Plex (body 13.5px, 400/600). Self-hosted woff2 (already extracted from the artifact).
- **Tokens (light):** `--bg:#f6f7f9 --card:#fff --ink:#101322 --brand:#2453ff --ok:#0f8a4d --warn:#9a6200 --bad:#d33b4e`; flow tokens `--f-rec:#12a150 --f-fee:#0d9488 --f-gate:#2453ff --f-revw:#aab2c0 --f-rev:#e0455a --f-leak:#d99a2b --glow:0`.
- **Tokens (dark):** `--bg:#12141b --card:#1b1e28 --brand:#7d95ff --f-rec:#3ecf8e --f-leak:#e0b054 --glow:7` (glow drives particle shadowBlur in dark only). Both `prefers-color-scheme` and `[data-theme]` override.
- **Layout:** 1180px max width; floating sticky rounded shell (18px radius) as the only chrome; rounded 22px flow panels; soft two-layer shadows; `.num` tabular figures; kickers uppercase 0.72rem.

## The reactor — the business in the world, not the ROI pipeline

**Reframe (user):** "this isn't about ROI only, it's about what's happening internally and externally in the business and the world; ROI is between Vantax and the customer." The reactor models THE BUSINESS. Think how a group exec at Mondelēz / PepsiCo / Tiger Brands reads it: what the world is doing to us, where our operations leak, what needs our decision, what came back. The Vantax commercial strand (fee, ROI multiple) is plumbing between Vantax and the customer — it renders in the Ledger section only and never headlines the reactor.

Built fresh on the artifact's canvas engine (the shipped 5-stage `ValueChainFlow.tsx` ribbon is the predecessor, retired at cutover):

- **Nodes, three fields left→right:**
  - **WORLD (external inflows):** Tailwinds · Headwinds · Regulatory — real fields from `api.radar.context()` (`StrategicContext.headwinds/tailwinds/regulatoryDeadlines/topSignals`). Edges flow INTO the business, colored ok/bad.
  - **BUSINESS (internal operations):** operations streams from the latest complete assessment's `findings_summary.by_category` (real category names — procurement, supply chain, finance, sales, compliance, …; top 5 by value, rest folded into "Other"), each with its at-risk figure and leaky/clean state; business health score (`StrategicContext.healthScore` vs `industryBenchmark`). Multi-entity tenants aggregate; entity drill via the existing company switcher (`findings_by_company`).
  - **OUTCOMES:** Leakage detected → Decision gate (pooling, from `actionsSummary.pending_approval_*`) · In review (`previewed_*`) · Reversed (`failed_* + rejected_*`) → Recovered (gold, `roi` `totalDiscrepancyValueRecovered`) flowing BACK into the business.
- **Engine:** the artifact's `mount(el, nodes, edges, opts)` canvas pattern — bezier edges, width ∝ amount, particles along curves, `pool:true` edges bunch at the gate until a decision is signed, `--glow` in dark, static curves under `prefers-reduced-motion`, pause when off-screen.
- **Focus:** `focus` prop per surface highlights the relevant region (e.g. Decisions focuses the gate pool; Ledger focuses recovered/fee), dims the rest; one context line + CTA under the panel phrased per role.
- **Heart of the system:** every surface opens with the reactor; every navigation, decision, and Jeff conversation is anchored to a reactor node. Nothing in the console exists that the reactor can't point to.
- **Honesty law (hard):** every node value binds to a real API field; null/failed → em-dash and that node's edges render static grey; a segment animates only when its field is non-zero; fees never netted; no fabricated motion.

## IA — one cohesive screen, everything folds

**No tabs anywhere** (user: "not in multiple tabs", "it should be a single cohesive design"). The console is ONE continuous screen: the reactor at the top, then **Brief · Decisions · Ledger · Catalysts** as sections flowing beneath it in that order. The anchor rail (left, sticky) is the only navigation — click scrolls, scroll highlights. The shell nav carries the same four anchors as pills (they scroll, they don't route). One URL (`/x`), section deep-links via `#brief #decisions #ledger #catalysts`. Everything reachable in one click from anywhere on the page.

| Absorbs | Into (section on the one screen) |
|---|---|
| Data, Connectivity, Integrations, Integration Health | `#brief` connect health strip + reactor CONNECT context |
| Findings, Assessments | `#brief` detect block + reactor leak nodes (click-through) |
| Decisions, Catalysts (8 tabs), Action Layer | `#decisions` + `#catalysts` sections |
| ROI, Savings, Outlook | `#ledger` — the commercial layer between Vantax and the customer (recovered · net · Atheon fee, never netted · ROI multiple) |
| Pulse, Apex/Radar (signals, competitors, regulatory), Outlook | `#brief` world block + reactor WORLD field |
| Brief, Exec Summary, Board Digest | `#brief` + sealed export |

Old routes 301 to `/x#anchor` at cutover. `/console` (admin quarantine) stays as is.

## Roles — Vantax demo

**Enterprise usage lens:** design every section as if the reader is a group exec at a multi-entity FMCG (Mondelēz, PepsiCo, Tiger Brands) — multi-company aggregation by default, entity drill-down via the existing company switcher, figures phrased as business operations ("procurement leakage across 4 entities"), never as vendor-tool telemetry.

- Persona select in the dateline, `?as=<role>` in the URL. Roles: board, ceo, cfo, coo, cpo, controller, finance manager (approver), ap, tax, ops.
- Per role: visible sections, decision badge scope, hero kicker, lens copy, greyed out-of-band decisions (visible but not actionable).
- **CPO example:** lands on Brief with detect focus grouped by supplier; kicker "Recovered from your suppliers · since March"; lens surfaces supplier concentration (e.g. Karoo Packaging, open findings, price-variance vs contract) — figures computed from real fields, phrased in supplier/contract terms.
- Real tenants: role comes from auth; no switcher; `?as=` ignored server-side outside the demo tenant.

## Jeff — the reactor's voice, always present

The reactor is the heart of the system; Jeff is how you talk to it. The existing honest assistant (`JeffLauncher`, arc-reactor mark, `POST /api/mind/query`) graduates from a floating afterthought to a first-class shell citizen:

- **Placement:** the artifact's `✦ Ask` slot in the shell nav becomes **Jeff** (arc-reactor `JeffLogo`, spins while thinking) — present on every surface, same slide-over.
- **Reactor-aware context:** Jeff's query carries the current surface, role lens (`?as=`), and focused reactor node, so "why is this pooling?" answers about THE gate the user is looking at. Every reactor node gets an "Ask Jeff" affordance in its hover/receipt card.
- **Honesty law unchanged:** Jeff answers only from booked rows, cites receipts, figures computed never generated, attribution line on every answer.
- Backend reuse: `/api/mind/query` as-is; only the context envelope grows (surface, role, node id).

## Menus & custom iconography

Every menu is redesigned to the Recovery Console craft level — no admin-template dropdowns, no off-the-shelf icon pack:

- **Custom icon set:** bespoke SVG icons drawn in one language — the reactor's: 1.5px rounded strokes, flow-curve motifs, `currentColor`, 20px grid. Set covers the four surfaces, five value-chain stages, gate/pool, receipt/seal, Jeff arc-reactor, identity-menu entries, anchor-rail sections. Ships as a single `icons.tsx` sprite module; lucide retired from the new console.
- **Shell nav:** icon + label anchor pills (artifact `.tabs` treatment) that scroll to sections — not routes; decision badge on Decisions.
- **Identity menu (avatar):** Company switcher · Viewing as (mirror of dateline persona) · Settings · MFA · Support · Sign out. Nothing else. Rendered as a shell-styled floating card (18px radius, `--sh2`), each entry with its custom icon.
- **Anchor rails:** section icons + labels, active state in `--brand-soft`.
- **Context menus / selects:** the artifact's `.role` pill-select treatment everywhere; native `<select>` under the skin.

## Build plan (from scratch, parity-gated)

0. **Functionality inventory first.** Audit all 58 pages (+ `/console` boundary) into a capability list — every action, figure, export, and admin task a user can perform today — and map each row to its new surface + anchor. This table is the parity contract; it ships in the repo next to this spec.
1. New console grows in a parallel route tree (`/x/*` behind a flag on Vantax): shell + tokens + fonts + full reactor.
2. Sections built fresh on the one screen, one PR each: Brief, Decisions, Ledger, Catalysts — each PR checks off its inventory rows.
3. Persona switcher + identity menu.
4. **Parity gate:** every inventory row checked (or explicitly retired with the user's sign-off) → cut over: `/x/*` becomes `/`, old routes 301, old page components deleted.

Each step live-verified via the Playwright recipe (env creds, service workers blocked).

## Out of scope

Backend/API changes (UI binds to existing fields only); `/console` admin surfaces; mobile-native work beyond the responsive shell.
