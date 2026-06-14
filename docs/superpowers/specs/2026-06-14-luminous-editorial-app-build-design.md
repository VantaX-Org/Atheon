# Atheon Luminous Editorial — App + Marketing Build Design

**Status:** Draft for review.
**Date:** 2026-06-14
**Owner:** Reshigan
**Supersedes:** [2026-06-14-dashboard-light-evolution-design.md](./2026-06-14-dashboard-light-evolution-design.md) (green-only / marketing-only-blue stance is retired).

---

## 1. Goal

Build the **real** Atheon application + marketing site in the **Atheon Luminous
Editorial** design language, pixel-matching the approved 55-screen blue deck
([docs/ui-redesign/DECK.md](../../ui-redesign/DECK.md),
`docs/ui-redesign/higgsfield/v4-NN-*.png`).

Four decisions (locked via AskUserQuestion):

1. **Blue everywhere.** Royal-blue `#2456d6` is the live brand across all 55 app
   screens AND marketing. Green is retired as a brand accent — kept ONLY as RAG
   "healthy" status.
2. **Token + primitives + shell first.** Redefine CSS vars + tailwind, restyle
   `ui/*` primitives + Sidebar/Header/AppLayout, then sweep pages.
3. **Marketing in-place.** Rebuild Marketing/Pricing/Trial inside the SPA.
4. **Pixel-match** the mockups (adapt to real data; no fabricated figures —
   shared-savings billing rule holds: every $ traces ERP record → mapping →
   confidence).

App stays **light-only**. RAG semantics unchanged (status/health only, never
decorative). The leverage point is the CSS-var token system in
[src/index.css](../../../src/index.css) — restyle propagates to all 55 pages
without a 55-page rewrite.

## 2. Design language — Luminous Editorial

| Aspect | Swiss Calm (current) | Luminous Editorial (target) |
|---|---|---|
| Field | `#fbfaf7` warm white | `#faf9f5` warm white |
| Ink | `#0f1115` | `#1a1a17` warm near-black |
| Brand accent | green `#0a7d4f` | **blue `#2456d6`** |
| Accent hover | `#096a43` | `#1c46ad` |
| Surfaces | flat, hairline, no shadow | **frosted glass**, soft elevation, hairline |
| Depth | none | faint **blue gradient-mesh blooms** behind hero bands |
| Display face | Archivo | **Inter** (oversized tabular numerals) |
| Micro-label face | IBM Plex Mono | **Space Mono** (uppercase, letterspaced) |
| Sidebar | warm-white, ink type | **slim left glass** sidebar, blue active state |
| Radius | 2px sharp | 8–12px on cards/glass, 2–4px on controls |
| RAG | green=success(brand) | green `#1a7d4f` · amber `#d98a00` · red `#c0392b` (status only) |

## 3. Token map (the swap)

Single source of truth = [src/index.css](../../../src/index.css) `:root`. Repoint,
do not rename (keeps all `--accent`/`--sage`/`var()` consumers working). RAG
gets dedicated `--rag-*` tokens so "healthy" no longer aliases the brand.

```
--bg-primary    #fbfaf7 → #faf9f5
--bg-card       #ffffff (keep; glass via new --glass-* tokens)
--text-primary  #0f1115 → #1a1a17
--text-secondary #6c7079 → #5c5f63 (warm)
--accent        #0a7d4f → #2456d6      (+ --accent-rgb 36,86,214)
--accent-hover  #096a43 → #1c46ad
--accent-glow   green   → rgba(36,86,214,0.14)
--sage / --sage-b  → repoint to blue (legacy alias)
--ring-focus    green   → rgba(36,86,214,0.45)
--positive      keep = RAG green #1a7d4f  (NOT brand)
--warning       #9a6b1f → #d98a00 (RAG amber)
--critical/--neg #b03423 → #c0392b (RAG red)  + rgb triples
NEW: --rag-healthy #1a7d4f  --rag-watch #d98a00  --rag-risk #c0392b (+ rgb)
NEW glass: --glass-bg rgba(255,255,255,0.72)  --glass-border rgba(26,26,23,0.08)
           --glass-blur 16px  --glass-shadow 0 8px 32px rgba(26,26,23,0.08)
NEW bloom: --field-gradient = radial blue-mesh blooms (top-left + far-right)
--theme-color meta (index.html) #0a7d4f → #2456d6
```

`chart-*` repoints to blue primary + slate/amber/red secondaries.
`pill-success` keeps RAG green (status), `pill-accent` becomes blue (brand).

## 4. Typography

- Add **Inter** (400–800) + **Space Mono** (400/700) to the index.html Google
  Fonts link; keep Material Symbols. Drop Archivo/Plex Mono links once swept.
- tailwind `fontFamily`: `sans`/`body`/`display`/`headline` → Inter; `mono`/
  `mono-data` → Space Mono. `body` and `.material-symbols` rules in index.css
  repoint to Inter.
- Oversized tabular numerals: `.text-hero` (44→clamp 48–72px), `.text-display`,
  `.text-h1` keep `tnum`; Inter `font-feature-settings: "tnum","cv05"`.
- `.text-label` / `.hero-eyebrow` / `.pill` → Space Mono uppercase letterspaced.

## 5. Surfaces — glass

Repoint `.glass-card`, `.glass-panel`, `.card-swiss` and the `card-*` family to
the new glass tokens: translucent white bg, `backdrop-filter: blur(16px)`,
hairline `--glass-border`, soft `--glass-shadow`, 10–12px radius. `.card-hero`
gets the blue gradient-mesh wash + blue left-rule. Modals/overlays already use
glass — repoint their tokens too. Body gets `--field-gradient` blue blooms
(fixed attachment, very low alpha) so panels read as floating glass.

## 6. Shell redesign

- **Sidebar** ([src/components/layout/Sidebar.tsx](../../../src/components/layout/Sidebar.tsx)):
  slim left **glass** rail, blue wordmark, 5-section IA preserved, active item =
  blue fill/left-rule + blue icon (was sage right-border). Material Symbols kept.
- **Header** ([src/components/layout/Header.tsx](../../../src/components/layout/Header.tsx)):
  frosted glass bar, blue focus ring on search, blue primary actions.
- **AppLayout** ([src/components/layout/AppLayout.tsx](../../../src/components/layout/AppLayout.tsx)):
  field bloom background; content max-width + editorial asymmetric gutters per deck.

## 7. Primitives (`src/components/ui/*`, ~30)

Token swap covers most. Touch by hand where color/shape is hardcoded:
`button.tsx` (blue primary, glass secondary), `badge.tsx` + `status-pill.tsx`
(brand-blue vs RAG split — verify "healthy/watch/risk" map to `--rag-*`, brand
chips to blue), `atheon-score-ring.tsx` + `score-ring.tsx` (ring gradient
blue; RAG ring stays health-colored), `card.tsx` (glass), `tabs.tsx` (blue
active underline), `input.tsx`/`modal.tsx`/`toast.tsx`/`progress.tsx`/
`sparkline.tsx`/`metric-grid.tsx`/`page-header.tsx` (accent + glass). Sweep:
grep hardcoded greens (`#0a7d4f`,`0,125,79`,`teal`,`sage`,`spruce`,`emerald`,
`green-`) across `src/` and convert to token or RAG as appropriate.

## 8. Pages — sweep order

Pages inherit the new look from tokens+primitives. Then pixel-match per deck,
flagship-first, reusing existing data hooks (no new endpoints, no fabricated
data):

1. **Dashboard** (`v4-01`) — reference build: blue hero, KPI band w/ blue
   confidence ring, traceable FindingsTable, savings chart. Sets the pattern.
2. Exec/billing batch (02–08).
3. Assess/catalyst/audit (09–16).
4. Trust/security/perf (17–24), connectivity (25–32), IAM (33–40),
   settings/support (49–55).
5. **Auth/marketing/GTM** (41–48): Login/MFA/Verify/Onboarding glass cards on
   blue bloom; **Marketing** (`v4-47`), **Pricing** (`v4-46`), **Trial**
   (`v4-45`) rebuilt in-place (`.mk5-*` scoped CSS → Luminous Editorial blue).

## 9. Components & files

| Unit | File | Change |
|---|---|---|
| Tokens | `src/index.css` `:root` + utilities | repoint to blue/glass/RAG; add `--rag-*`,`--glass-*`,bloom |
| Tailwind | `tailwind.config.js` | accent rgb, Inter/Space Mono families, radius, RAG colors |
| Fonts/meta | `index.html` | Inter+Space Mono link; theme-color blue |
| Shell | `layout/{Sidebar,Header,AppLayout}.tsx` | glass rail + blue active |
| Primitives | `components/ui/*` (~30) | swap + hand-fix color/shape per §7 |
| Domain | `SharedSavingsStrip`, `AssessmentFindingsPanel`, `ScoreRing`, dashboard/* | blue hero, RAG split |
| Pages | `src/pages/*` (55) | inherit; pixel-match flagship-first |
| Marketing | `pages/{Marketing,Pricing,Trial}Page.tsx` | rebuild in-place |

## 10. Verification

- Per phase: `npm run lint`, `npm run build`, `npm run test` green (currently 0
  lint errors — keep it). Visual check vs the matching `v4-NN` mockup.
- Grep gate: no stray brand-green hex outside RAG/`--rag-*` after the sweep.
- No regression to the billing-traceability contract: findings still render
  confidence band + ERP basis; gate-failed findings stay demoted.
- Light-only preserved (no dark-mode reintroduction).

## 11. Risks

- **Global CSS churn** (unlike the additive prior spec). Mitigation: token
  repoint not rename → consumers unaffected; sweep greens by grep; phase gates.
- **RAG/brand collision** — green currently doubles as success+brand. Mitigation:
  split into `--rag-healthy` (status) vs `--accent` blue (brand); audit every
  `--positive`/`pill-success` use to confirm it's a status, not a brand chip.
- **Font shift** (Archivo→Inter) changes metrics; re-check truncation/overflow on
  dense tables during sweep.
- **Scope** — 55 pages + marketing is multi-session. Phased; each batch ships
  independently behind green gates.

## 12. Open questions

1. Keep Material Symbols, or move fully to lucide? (Lean: keep Material Symbols —
   deck uses inline iconography; no need to churn.)
2. Glass `backdrop-filter` perf on large tables — cap blur to containers, not
   per-row. (Lean: glass on panels/sidebar/header/modals only, not table rows.)
