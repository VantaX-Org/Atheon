# Recovery Console v2 — flow-river theme refactor

Date: 2026-07-16. Source of truth: `Atheon_Recovery_Console_v2.html` mockup + 4 screenshots
(Brief hero stage, Decisions strip, Ledger cumulative river, Catalysts grid).
Product model + honesty laws still governed by `docs/ui-redesign/2026-07-15-frontend-v2-design-spec.md`.

## Verdict

The mockup supersedes the visual language. The animated flow river is the central motif of
every screen: each console section opens with its own flow stage; login and marketing carry
the same river tastefully. All existing functionality is preserved — nothing removed.

## Theme (tokens.css)

**Light default, navy dark** (user decision — supersedes earlier always-dark call). Light is a
soft indigo-tinted paper (`--bg:#f5f6fb`, white cards); dark is the mockup navy:

```
dark:  --bg:#0a0d17  --card:#10152a  --card2:#141b32  --line:rgba(148,163,214,.12)
       --ink:#eef1fb  --mut:#8b93b3  --faint:#5b6280
       --ok:#34d399  --brand:#7c9bff  --brand-btn:#5b76f7  --warn:#e8b44a  --bad:#f0647c
light: same hue family, darkened for contrast (--ok:#0f9d63 --brand:#4459d8 --bad:#d63b57 …)
```

Dark applies via `@media(prefers-color-scheme:dark)` guarded `:root:not([data-theme="light"])`,
plus explicit `:root[data-theme="dark"]`. `--glow:0` light / `7` dark drives canvas bloom;
`--bloom1/2` drive the page radial washes. Flow tokens `--f-*` themed per mode.
Fonts stay Schibsted Grotesk / IBM Plex Sans / Space Mono (already
loaded; Inter adds a dependency for no functional gain — display face keeps brand continuity).
Gradient logo mark `#5b76f7 → #7c5bf7`. Radial blooms behind hero panels.

## River engine (river.ts)

Port mockup's richer rendering, keep node tiles + honesty laws (null → em-dash, 0 particles):

- 3-layer stream strokes: base w×2.6 α.10 (glow halo in dark), mid w×1.4 α.22, core w×0.6 α.45.
- Particles: scatter off the path + sine twinkle; radius jitter.
- Whole fnode tile is the drill-through target (role=button, Enter/Space); ✦ ask button
  stops propagation.
- `RiverNode.tag` — boundary chip (EXTERNAL / INTERNAL / YOUR CALL); `RiverOpts.lanes` —
  faint labelled dashed bands ("outside your business" / "inside your business"). C-suite
  framing: the river reads as money crossing the business boundary; role-aware copy
  (persona `canApprove` → "YOUR SIGNATURE") lives in the graph builders.
- DPR clamp 2, `prefers-reduced-motion` → static frame (exists).

**One engine everywhere** (user decision): no separate ledger renderer. The ledger's
cumulative river is a `RiverGraph` from flows.ts — month nodes chained left→right, edge
`amt` ∝ cumulative recovered so the stream widens month over month; terminal "TO DATE"
node. Only booked receipts feed it; no receipts → thin static line + em-dash.

## Console layout (/x)

Single scroll page stays (pills scrollspy = tabs' cheap cousin; deep links + in-flight hero
already built). Every section opens with its own flow stage:

1. **Brief** — net-recovered hero row (in-flight) + full Reactor stage (in-flight per-zone
   normalization, ROI multiple, all-time scope). Loading shimmer until ledger reports.
2. **Decisions** — flow strip: "Confirmed & waiting <R>" → gate tile "<n> to sign / oldest <d>
   days" (particles pool before it) → "Collected this week <R>". Built from real pending
   actions + completed-this-week; caption explains pooling. Cards: big amount, what, meta
   (signatures/band/window/waiting), badges (needs-X amber, in-your-band green), actions
   (Review & sign primary, Draft letter ✦Jeff, Hold / Approve & release / Reject). Step-up
   MFA and evidence chain unchanged.
3. **Ledger** — cumulative river stage (above), then KPIs, attribution/proof/exports cards,
   sealed lrows + receipt drawer unchanged.
4. **Catalysts** — 2×2 ccards each with mini flow (green widening recovered stream, blue
   awaiting, red reversed sag), stats row, "Open catalyst →"; recent runs list unchanged.

Nav: sticky rounded pill bar — logo mark + wordmark, section pills (Decisions carries pending
badge), right side ✦ Ask (Jeff), tenant name, persona/identity menu. 900px collapse per mockup;
390px still flawless.

## Login + marketing

Both already carry MiniRiver scaffolding. Work = navy retheme + motion polish:

- **Login**: page-scoped navy override of the old tree's CSS vars (children inherit); left
  aside river hero glows on navy; frosted card; riseIn stagger. All auth flows untouched
  (MFA, SSO, SAML, tenant select, forgot/reset).
- **Marketing**: mk5 var block rethemed navy; hero river central in `.mk5-hero`; motion =
  fade-up on scroll, river particles as the living element. Copy/structure untouched.

## Honesty laws (unchanged, enforced in stages)

net = recovered − fee only when both real; fee never netted silently; recovery all-time vs
leak per-assessment never divided; null → em-dash + static flow, never fabricated motion.

## Verify

`tsc && vite build` + existing vitest (flows/persona/reactor-graph). Playwright against dev
server with mocked API boundary (memory: verify recipe) — screenshot every section + login +
marketing at 1440/390, reduced-motion pass.
