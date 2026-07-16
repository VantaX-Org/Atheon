# Flow Refactor (Recovery Console) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the frontend from scratch as ONE cohesive screen at `/x` — the reactor (the business in the world, canvas river) on top, Brief · Decisions · Ledger · Catalysts sections flowing beneath, anchor-rail navigation, persona switcher for the Vantax demo, Jeff always assisting — then parity-gate and cut over.

**Architecture:** New parallel tree `src/x/` (route `/x`, own shell, NOT inside `AppLayout`). Pure graph builder (`reactor-graph.ts`, unit-tested) feeds a canvas river engine (`river.ts`, ported from the approved artifact). One data hook (`use-reactor-input.ts`) with `Promise.allSettled` honesty gating. Sections fetch their own detail. Old pages untouched until the parity-gated cutover.

**Tech Stack:** React 18 + react-router (existing), Zustand store (existing), vitest (existing), plain CSS file scoped under `.rx` (no Tailwind in new tree), Canvas 2D. No new dependencies.

## Global Constraints

- **Honesty law (hard):** every displayed Rand traces to a real API field; null/failed fetch → em-dash (`—`) and static grey edges; never coerce null to 0; a flow segment animates only when its field is non-zero; fees never netted (recovered, fee, net shown as three figures, net labelled computed); no fabricated metrics, no `Math.random` in data paths; AI text attributed.
- **The business, not the pipeline:** the reactor headlines internal operations + external world (`api.radar.context()`); the Vantax fee/ROI strand renders in `#ledger` only.
- **Single cohesive screen:** no tabs anywhere. One URL `/x`, sections as `#brief #decisions #ledger #catalysts` anchors. Everything reachable in ≤2 clicks.
- **Visual identity (exact, from artifact 3fcc6521):** light `--bg:#f6f7f9 --card:#fff --ink:#101322 --brand:#2453ff --ok:#0f8a4d --warn:#9a6200 --bad:#d33b4e`; flow `--f-rec:#12a150 --f-fee:#0d9488 --f-gate:#2453ff --f-revw:#aab2c0 --f-rev:#e0455a --f-leak:#d99a2b --glow:0`; dark `--bg:#12141b --card:#1b1e28 --brand:#7d95ff --f-rec:#3ecf8e --f-leak:#e0b054 --glow:7`. Fonts: Schibsted Grotesk (headings/figures, ls −0.015em, hero −0.03em) + IBM Plex Sans 13.5px body — already loaded via Google Fonts in `index.html`. 1180px shell, 18px sticky rounded shell, 22px panels, `.num` tabular-nums, kickers uppercase 0.72rem.
- **Enterprise lens:** multi-entity aggregation by default (Mondelēz/PepsiCo/Tiger Brands reader); phrase figures as business operations, never vendor telemetry.
- **Git:** explicit paths only — NEVER `git add -A` (untracked `docs/ui-redesign/`, `docs/valuation/`, `validate-live.mjs` must never be swept). Never touch/commit `validate-live.mjs` (contains prod creds). Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Live verify:** Playwright from `e2e/node_modules/playwright/index.mjs`, creds via `LIVE_EMAIL`/`LIVE_PASS` env only, `serviceWorkers:'block'`, `domcontentloaded` + explicit `waitForSelector`.
- **Out of scope:** backend changes; `/console` admin quarantine; mobile-native.

## File map

| File | Responsibility |
|---|---|
| `src/x/tokens.css` | Recovery Console tokens + shell/panel/rail/node CSS, scoped under `.rx` |
| `src/x/river.ts` | Canvas river engine `mountRiver(el, nodes, edges, opts) => cleanup` |
| `src/x/reactor-graph.ts` | Pure `buildReactorGraph(input, currency, focus)` — honesty gating lives here |
| `src/x/reactor-graph.test.ts` | Vitest for honesty law + focus dimming |
| `src/x/use-reactor-input.ts` | `useReactorInput()` — allSettled fetch of the 5 reactor feeds |
| `src/x/persona.ts` + `.test.ts` | 10 personas, `?as=` parsing, demo-tenant gating |
| `src/x/icons.tsx` | Bespoke 20px/1.5px-stroke icon set (`XIcon`) |
| `src/x/Reactor.tsx` | Panel + canvas + node tiles + Ask-Jeff affordance |
| `src/x/Shell.tsx` | Sticky shell: wordmark, anchor pills, persona select, Jeff, identity menu |
| `src/x/sections/BriefSection.tsx` | World + health + connect strip + detect (findings) |
| `src/x/sections/DecisionsSection.tsx` | Pending-approval queue, approve/reject, evidence |
| `src/x/sections/LedgerSection.tsx` | Commercial layer: recovered/net/fee/ROI, receipts, exports |
| `src/x/sections/CatalystsSection.tsx` | Catalyst runs + summaries |
| `src/x/ConsolePage.tsx` | Assembly: shell + reactor + rail + sections + scrollspy |
| `src/App.tsx` (modify) | Register `/x` (auth-guarded, outside `AppLayout`) |
| `src/components/common/JeffLauncher.tsx` (modify) | Add `context?: string`, `variant?: 'floating'\|'shell'` |
| `docs/superpowers/plans/2026-07-16-flow-refactor-inventory.md` | Parity contract (Task 0) |

---

### Task 0: Capability inventory (parity contract)

**Files:**
- Create: `docs/superpowers/plans/2026-07-16-flow-refactor-inventory.md`

**Interfaces:** Produces the parity contract every section PR checks rows off against. Table columns: `# | Old page | Capability (action/figure/export) | API it binds | New home (section#anchor or /console or RETIRE?) | Status`.

- [ ] **Step 1:** Audit all 58 files in `src/pages/` (dispatch read-only subagents in parallel, ~10 pages each). For each page record every user capability: figures displayed, actions (buttons/mutations), exports, deep links. `/console`-quarantined admin pages map to `/console (stays)`.
- [ ] **Step 2:** Write the table to the inventory file. Rows proposed `RETIRE?` are only retired later with explicit user sign-off (Task 10).
- [ ] **Step 3:** Commit: `git add docs/superpowers/plans/2026-07-16-flow-refactor-inventory.md && git commit -m "docs(flow-refactor): capability inventory — parity contract"`

### Task 1: Tokens + route skeleton

**Files:**
- Create: `src/x/tokens.css`, `src/x/ConsolePage.tsx` (skeleton)
- Modify: `src/App.tsx` (lazy route `/x`)

**Interfaces:**
- Produces: `.rx` scope class; CSS classes `rx-shell rx-panel rx-kicker rx-num rx-rail rx-pill rx-card rx-btn rx-select`; route `/x` rendering `<ConsolePage/>` for authenticated users, `<Navigate to="/login"/>` otherwise.

- [ ] **Step 1:** Write `src/x/tokens.css` — token block exactly as Global Constraints, both `@media (prefers-color-scheme: dark)` and `[data-theme]` overrides, scoped `.rx { background:var(--bg); color:var(--ink); font:400 13.5px/1.55 "IBM Plex Sans",sans-serif; }`; headings/figures `font-family:"Schibsted Grotesk"; letter-spacing:-0.015em`; `.rx-shell` sticky 18px-radius floating bar (max-width 1180px, `--sh1/--sh2` shadows); `.rx-panel` 22px radius card; `.rx-kicker` uppercase 0.72rem letter-spacing .08em; `.rx-num` tabular-nums; `.rx-rail` sticky left rail; `.rx-pill` nav pill with `[aria-current]` brand-soft state. (Full CSS authored at execution from the artifact's stylesheet — the artifact file at scratchpad `console-artifact-clean.html` is the source; lift, rename prefixes to `rx-`, scope under `.rx`.)
- [ ] **Step 2:** `src/x/ConsolePage.tsx` skeleton: `.rx` root div, placeholder shell + four empty `<section id>`s.
- [ ] **Step 3:** `src/App.tsx`: `const ConsolePageX = lazyWithRetry(() => import("@/x/ConsolePage").then(m => ({ default: m.ConsolePage })));` and a top-level route (NOT inside `AppLayout`): `<Route path="/x" element={user ? <ConsolePageX/> : <Navigate to="/login" replace/>}/>` — match how existing top-level auth checks are done in App.tsx.
- [ ] **Step 4:** `npm run build` — expect success. Visit `/x` in dev — expect shell skeleton.
- [ ] **Step 5:** Commit explicit paths, message `feat(x): recovery console skeleton — tokens + /x route`.

### Task 2: River engine

**Files:**
- Create: `src/x/river.ts`

**Interfaces:**
- Produces:
```ts
export interface RiverNode { id: string; x: number; y: number; kicker: string; value: string; sub?: string; tone?: 'ok'|'bad'|'warn'|'gold'|'none'; anchor?: string; dim?: boolean }
export interface RiverEdge { from: string; to: string; amt: number; colorVar: string; particles: number; pool?: boolean; dim?: boolean }
export interface RiverOpts { wBase?: number; wScale?: number; poolT?: number; onNodeClick?: (n: RiverNode) => void; onAskJeff?: (n: RiverNode) => void }
export function mountRiver(el: HTMLElement, nodes: RiverNode[], edges: RiverEdge[], opts?: RiverOpts): () => void
```

- [ ] **Step 1:** Port the artifact engine to TS: absolutely-positioned `.rx-fnode` tiles at fractional coords; canvas beziers (control points at mid-x) width `wBase(3) + amt*wScale(6.2)`; particles `p.t += p.sp*dt` along curves, count = `particles`; `pool:true` bunches particles at `poolT(0.88)` with sine/cos jitter; `--glow` (read via `getComputedStyle`) → `shadowBlur`; edge colors resolved from `colorVar` CSS custom properties at mount; `dim` → 0.25 alpha; `prefers-reduced-motion` → static curves, no rAF; pause when `!el.offsetParent`; DPR capped 2; `ResizeObserver` relayout; cleanup cancels rAF + disconnects observers + empties `el`.
- [ ] **Step 2:** Each node tile: kicker + `.rx-num` value + sub; `tone` class; `anchor` → click calls `onNodeClick`; hover reveals a `✦` button calling `onAskJeff`.
- [ ] **Step 3:** `npm run build` + typecheck pass. (Canvas untestable in jsdom — runtime verified in Task 9 live check.)
- [ ] **Step 4:** Commit `feat(x): river canvas engine`.

### Task 3: Reactor graph builder (TDD)

**Files:**
- Create: `src/x/reactor-graph.ts`, `src/x/reactor-graph.test.ts`

**Interfaces:**
- Produces:
```ts
export type SectionKey = 'brief'|'decisions'|'ledger'|'catalysts';
export type ReactorFocus = SectionKey | 'all';
export interface ReactorInput {
  world: { headwinds: number; tailwinds: number; regulatoryDeadlines: number; signalCount: number } | null;
  health: { score: number; benchmark: number | null } | null;
  connections: { total: number; broken: number } | null;
  ops: { categories: Array<{ key: string; label: string; count: number; valueZar: number }>; totalZar: number; totalCount: number } | null;
  gate: { pendingCount: number; pendingZar: number; reviewCount: number; reviewZar: number; reversedCount: number; reversedZar: number } | null;
  recovered: { zar: number } | null;
}
export function buildReactorGraph(input: ReactorInput, currency: string, focus: ReactorFocus): { nodes: RiverNode[]; edges: RiverEdge[] }
```
- Consumes: `RiverNode/RiverEdge` from Task 2; `formatCompactCurrency` from `@/lib/format-currency`.

- [ ] **Step 1: Failing tests** (`npm run test -- src/x/reactor-graph.test.ts`):
```ts
import { describe, it, expect } from 'vitest';
import { buildReactorGraph, type ReactorInput } from './reactor-graph';

const NULL_INPUT: ReactorInput = { world: null, health: null, connections: null, ops: null, gate: null, recovered: null };
const FULL_INPUT: ReactorInput = {
  world: { headwinds: 2, tailwinds: 3, regulatoryDeadlines: 1, signalCount: 9 },
  health: { score: 71, benchmark: 68 },
  connections: { total: 3, broken: 0 },
  ops: { categories: [{ key: 'procurement', label: 'Procurement', count: 12, valueZar: 4200000 }], totalZar: 4200000, totalCount: 12 },
  gate: { pendingCount: 4, pendingZar: 800000, reviewCount: 2, reviewZar: 100000, reversedCount: 1, reversedZar: 50000 },
  recovered: { zar: 1200000 },
};

describe('honesty law', () => {
  it('null input → em-dash values, zero particles everywhere', () => {
    const g = buildReactorGraph(NULL_INPUT, 'ZAR', 'all');
    expect(g.nodes.every(n => n.value === '—')).toBe(true);
    expect(g.edges.every(e => e.particles === 0)).toBe(true);
  });
  it('never renders a literal 0 for a null field', () => {
    const g = buildReactorGraph(NULL_INPUT, 'ZAR', 'all');
    expect(g.nodes.some(n => /(^|\s)R?0(\s|$)/.test(n.value))).toBe(false);
  });
  it('full input animates non-zero segments, gate edge pools', () => {
    const g = buildReactorGraph(FULL_INPUT, 'ZAR', 'all');
    const gateEdge = g.edges.find(e => e.to === 'gate');
    expect(gateEdge?.pool).toBe(true);
    expect(gateEdge!.particles).toBeGreaterThan(0);
  });
  it('no fee/ROI node in the reactor (commercial layer is Ledger-only)', () => {
    const g = buildReactorGraph(FULL_INPUT, 'ZAR', 'all');
    expect(g.nodes.find(n => /fee|roi/i.test(n.kicker))).toBeUndefined();
  });
});

describe('focus', () => {
  it('decisions focus dims world nodes, keeps gate undimmed', () => {
    const g = buildReactorGraph(FULL_INPUT, 'ZAR', 'decisions');
    expect(g.nodes.find(n => n.id === 'tailwinds')?.dim).toBe(true);
    expect(g.nodes.find(n => n.id === 'gate')?.dim).toBeFalsy();
  });
});
```
- [ ] **Step 2:** Run — expect FAIL (module not found).
- [ ] **Step 3:** Implement. Layout (fractions): world col x=.05 (tailwinds y=.14 tone ok, headwinds y=.40 tone bad, regulatory y=.66 tone warn) → hub x=.27 y=.40 (kicker = "The business", value = health score or —, sub "vs industry {benchmark}") → ops categories x=.48 spread y .10–.86 (top 5 by value + "Other" fold, tone bad when valueZar>0) → leak x=.66 y=.28 ("Leakage detected", total at-risk) → gate x=.66 y=.56 (pool), review x=.66 y=.74, reversed x=.66 y=.88 → recovered x=.88 y=.30 (gold) with edge recovered→hub flowing back. Edge colors: world in `--ok/--bad/--warn`; hub→ops `--f-revw`; ops→leak `--f-leak`; leak→gate `--f-gate` pool; leak→review `--f-revw`; gate→reversed `--f-rev`; gate→recovered + recovered→hub `--f-rec`. `amt` = value/max across money edges; `particles = v==null||v===0 ? 0 : clamp(1..4, round(amt*4))`. Null section → its nodes `value:'—', tone:'none'`, its edges `particles:0, amt:0.12`. Node anchors: world/hub/ops → `brief`; leak → `brief`; gate/review/reversed → `decisions`; recovered → `ledger`. Focus dim map: `brief`→dim gate/review/reversed/recovered; `decisions`→dim world/hub/ops; `ledger`→dim world/ops/review; `catalysts`→dim world/recovered; `all`→nothing.
- [ ] **Step 4:** Run tests — expect PASS.
- [ ] **Step 5:** Commit `feat(x): reactor graph builder — honesty-gated business flow`.

### Task 4: Reactor input hook

**Files:**
- Create: `src/x/use-reactor-input.ts`

**Interfaces:**
- Produces: `useReactorInput(): { input: ReactorInput; loading: boolean }` (fields null until resolved; every failure → that field stays null).
- Consumes: `api.radar.context()`, `api.erp.connections()`, `api.assessments.list()` + `.get(id)` via `latestCompleteAssessment`, `api.erp.actionsSummary()`, `api.roi.get()`; `useSelectedCompanyId` from store.

- [ ] **Step 1:** Implement, modelled on `src/lib/use-journey-input.ts` (allSettled; refetch on `companyId`): `world` from `StrategicContext` (`headwinds.length`, `tailwinds.length`, `regulatoryDeadlines`, `topSignals.length`); `health` from `healthScore/industryBenchmark`; `ops` from `findings_summary.by_category` (sorted by `value_at_risk_zar` desc, top 5 + Other); `gate` from `actionsSummary.summary` (pending/previewed/failed+rejected); `recovered` from `roi.get().totalDiscrepancyValueRecovered`.
- [ ] **Step 2:** `npm run build` pass. Commit `feat(x): reactor input hook`.

### Task 5: Icons + persona (TDD on persona)

**Files:**
- Create: `src/x/icons.tsx`, `src/x/persona.ts`, `src/x/persona.test.ts`

**Interfaces:**
- Produces: `XIcon({ name, size=20 }: { name: IconName; size?: number })` — names: `brief decisions ledger catalysts world ops gate seal jeff company persona settings mfa support signout export`; all 1.5px rounded strokes, flow-curve motifs, `currentColor`, 20px viewBox.
- Produces:
```ts
export type PersonaKey = 'board'|'ceo'|'cfo'|'coo'|'cpo'|'controller'|'fm'|'ap'|'tax'|'ops';
export interface Persona { key: PersonaKey; label: string; kicker: string; lens: string; sections: SectionKey[]; canApprove: boolean; opsFirst?: string[] }
export const PERSONAS: Record<PersonaKey, Persona>;
export function activePersona(search: string, tenantName: string | null): Persona | null; // null = no switcher (real tenant)
```

- [ ] **Step 1: Failing persona tests:** `?as=cpo` on tenant "Vantax Demo" → cpo persona (kicker "Recovered from your suppliers", `opsFirst` starts `['procurement','supply_chain']`, `canApprove:false`); `?as=cpo` on tenant "Acme" → null; no `?as=` on Vantax → default `cfo`; unknown `?as=zzz` → default; `fm.canApprove === true`, `board.canApprove === false`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement (demo check: `tenantName?.toLowerCase().includes('vantax')`). **Step 4:** PASS. **Step 5:** Commit `feat(x): personas + custom icon set`.

### Task 6: Shell + identity menu + Jeff integration

**Files:**
- Create: `src/x/Shell.tsx`
- Modify: `src/components/common/JeffLauncher.tsx`

**Interfaces:**
- Produces: `Shell({ active, persona, onPersona, decisionsCount }: { active: SectionKey; persona: Persona | null; onPersona: (k: PersonaKey) => void; decisionsCount: number | null })`.
- JeffLauncher gains optional props `{ context?: string; variant?: 'floating' | 'shell' }` — `context` prepended to the query as a `Context:` line before `api.mind.query`; `variant:'shell'` renders an inline nav pill (JeffLogo + "Jeff", spins while busy) instead of the fixed floating button; default behaviour unchanged (all existing call sites keep working with zero changes).

- [ ] **Step 1:** Shell: sticky `.rx-shell` — wordmark "Atheon" + kicker "Recovery Console"; four anchor pills (XIcon + label, `aria-current` on `active`, Decisions pill shows `.rx-badge` with `decisionsCount` or nothing when null); persona `.rx-select` (native `<select>` under pill skin, only when `persona !== null`); `<JeffLauncher variant="shell" context={…}/>`; avatar button → identity card (`.rx-panel`, `--sh2`): company switcher (existing store companies/selected), "Viewing as" mirror, Settings `/settings`, MFA `/mfa-setup`, Support `/support`, Sign out (store logout action).
- [ ] **Step 2:** JeffLauncher diff: add the two props; `const q2 = context ? `Context: ${context}\n\n${q}` : q` at the `ask()` call; extract trigger into `variant === 'shell'` branch. No other changes.
- [ ] **Step 3:** Build + old app still renders (JeffLauncher default unchanged). Commit `feat(x): shell, identity menu, Jeff shell variant`.

### Task 7: Reactor component + sections

**Files:**
- Create: `src/x/Reactor.tsx`, `src/x/sections/BriefSection.tsx`, `src/x/sections/DecisionsSection.tsx`, `src/x/sections/LedgerSection.tsx`, `src/x/sections/CatalystsSection.tsx`

**Interfaces:**
- `Reactor({ input, focus, onAskJeff }: { input: ReactorInput; focus: ReactorFocus; onAskJeff: (nodeContext: string) => void })` — builds graph, mounts river, node click scrolls to `#`+anchor.
- Sections: `({ persona, onAskJeff }: { persona: Persona | null; onAskJeff: (ctx: string) => void })`; each `<section id="…">` with `.rx-kicker` header. Every displayed figure binds to the API fields below; fetch failures render em-dash + "couldn't load" note (never zeros).

- [ ] **Step 1:** Reactor.tsx: `useEffect` remounts river on `[input, focus]` change; context line under panel phrased per focus; legend chips per flow token.
- [ ] **Step 2:** BriefSection — world block (`api.radar.context()`: `contextNarrative` attributed as AI-generated, headwind/tailwind impact lists, `topSignals` with `sourceName` links, regulatory deadlines); health strip (score vs benchmark); connect strip (`api.erp.connections()` rows with status, broken → `--bad`); detect block (latest complete assessment: `findings_summary` totals — confirmed headline `total_value_at_risk_zar`, `potential_unverified_zar` shown separately, never summed — top findings list with severity/value, grouped by `persona.opsFirst` categories first).
- [ ] **Step 3:** DecisionsSection — `api.erp.listAllActions({ status: 'pending_approval' })` queue; per row: catalyst name, action type, `value_zar`, evidence expand (`api.erp.actionEvidence(id)`); Approve/Reject via `api.catalysts.approveAction/rejectAction` (MFA code passthrough as those signatures require); buttons disabled + greyed when `!persona?.canApprove` (visible, not actionable).
- [ ] **Step 4:** LedgerSection — commercial layer between Vantax and the customer: recovered (`roi.get().totalDiscrepancyValueRecovered`), prevented (`totalPreventedLosses`), platform fee (`platformCost`, never netted), net = recovered − fee labelled "computed", `roiMultiple`; attribution `breakdown.byConnection`; receipts (`listAllActions({status:'completed'})`); sealed exports (ROI PDF via `api.roi.exportPdf`, board digest link).
- [ ] **Step 5:** CatalystsSection — catalyst list + run summaries from `api.catalysts.*` (exact method names read from `src/lib/api.ts:861` at execution); per run: items, match rate, value, link to run detail capability per inventory.
- [ ] **Step 6:** Build. Commit per section (`feat(x): brief section` … one commit each).

### Task 8: Console assembly

**Files:**
- Modify: `src/x/ConsolePage.tsx`

- [ ] **Step 1:** Assemble: `useReactorInput()`; persona from `useSearchParams` + `activePersona`; `Shell` + `Reactor` (focus = active section from scrollspy) + `.rx-rail` (same four anchors + subsection anchors) + sections filtered by `persona.sections`; scrollspy via `IntersectionObserver` on the four `<section>`s; `#hash` deep link scrolls on mount; `onPersona` updates `?as=` via `setSearchParams` (shareable link); `onAskJeff(ctx)` opens Jeff with `context = "surface:/x role:{persona.key} node:{ctx}"`.
- [ ] **Step 2:** Build + dev smoke: `/x#decisions?as=cpo` lands focused, greyed approvals. Commit `feat(x): one-screen console assembly`.

### Task 9: Live verify

**Files:**
- Create: `/private/tmp/claude-501/.../scratchpad/verify-x.mjs` (scratchpad, never committed)

- [ ] **Step 1:** PR the branch → merge → deploy (frontend deploys on push to main; check `gh pr checks`, Lint is non-required).
- [ ] **Step 2:** Playwright script (recipe per Global Constraints): login, `goto /x`, assert shell + `canvas` present, screenshot; `goto /x?as=cpo#decisions`, assert persona select value `cpo` and disabled approve buttons; screenshot. Run `LIVE_EMAIL=… LIVE_PASS=… node verify-x.mjs`.
- [ ] **Step 3:** Report screenshots/results to user.

### Task 10: Parity gate + cutover (USER SIGN-OFF REQUIRED)

- [ ] **Step 1:** Walk the Task-0 inventory: every row `DONE` (reachable in the new console) or `RETIRE?` — present the retire list to the user; wait for sign-off.
- [ ] **Step 2:** Cutover PR: `/x` becomes `/` (post-login landing), old routes `<Navigate>` to `/x#anchor` equivalents, old page components deleted (explicit `git rm` paths), `/console` untouched.
- [ ] **Step 3:** Live verify again (old bookmark URLs redirect; console loads).

## Self-review

- **Spec coverage:** single cohesive screen (T1/T8), reactor = business-in-the-world with WORLD/BUSINESS/OUTCOMES fields and ROI confined to Ledger (T3/T7.4 + test), honesty law (T3 tests), anchor rail + scrollspy (T8), personas + `?as=` demo-gating (T5), identity menu (T6), Jeff always assisting with reactor context (T6/T8), custom icons (T5), parity gate + cutover with user sign-off (T0/T10), live verify (T9). No gaps found.
- **Placeholder scan:** T1 CSS and T7 section JSX are authored at execution from named concrete sources (artifact stylesheet on disk; exact `api.ts` line refs) — bindings, states, and behaviours are fully specified above; no TBDs.
- **Type consistency:** `RiverNode/RiverEdge` (T2) consumed by T3; `ReactorInput/SectionKey/ReactorFocus` (T3) consumed by T4/T7/T8; `Persona/PersonaKey` (T5) consumed by T6/T7/T8; JeffLauncher props (T6) consumed by T8. Names match throughout.
