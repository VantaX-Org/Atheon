# Dashboard Light-Evolution Redesign — Design

**Status:** Draft for review.
**Date:** 2026-06-14
**Owner:** Reshigan

---

## 1. Goal

Bring the structure of the locked **Dark-2** executive mockup (board-grade hero
$ figure, 3 KPI tiles with a confidence gauge, a traceable findings table) into
the **real** application — **without** reversing the standing product decision
that the app is permanently light.

This is a **light evolution**, not a re-skin. We keep:

- The **Swiss Calm Authority** design language ([2026-05-29-executive-frontend-redesign-design.md](./2026-05-29-executive-frontend-redesign-design.md)) — warm white field, ink type, one accent.
- The **ledger-green accent** (`--accent #0a7d4f`) and the existing CSS-var token system in [src/index.css](../../../src/index.css).
- Light-only; the retired dark mode stays retired ([src/index.css:47](../../../src/index.css#L47), [appStore.ts:104-110](../../../src/stores/appStore.ts#L104-L110)).

The Dark-2 navy/blue mockup remains a **marketing-only** asset (LinkedIn video /
stills). We import its *information structure*, not its colours.

Every dollar shown still traces ERP record → field mapping → confidence → $,
consistent with the shared-savings billing model and the Option-B finding
contract ([2026-06-13-gtm-finding-confidence-render-design.md](./2026-06-13-gtm-finding-confidence-render-design.md)).

## 2. Scope

Redesign **all executive surfaces**, built in phases off a single reference
implementation. Phase 1 (Dashboard) is the build contract; later phases reuse
the same primitives so every surface reads as one system.

- **Phase 1 — Dashboard** (`src/pages/Dashboard.tsx`): build 3 primitives + restructure. *Review gate here before propagating.*
- **Phase 2 — Exec trio**: `ExecutiveSummaryPage`, `ROIDashboardPage`, `ApexPage` adopt the primitives.
- **Phase 3 — `BoardDigestPage` + Apex polish**.

Out of scope: token/colour changes, dark mode, new API endpoints, the LinkedIn
video, the new icon (tracked separately).

## 3. The three shared primitives

Build once in Phase 1, reuse on every surface. All conform to Swiss Calm
Authority (hairline rules, tabular numerals, uppercase letterspaced labels,
one accent).

### 3.1 `HeroSavings`
Board-grade hero anchoring the verified-savings figure.

- **Upgrades** the existing `SharedSavingsStrip variant="hero"` ([src/components/SharedSavingsStrip.tsx](../../../src/components/SharedSavingsStrip.tsx)) — does **not** fork it. We enlarge the lead figure (clamp 56–72px, `font-black`, `tnum`), keep "Verified Savings" label + traced sub-line ("traced to ERP record across N catalyst runs"), keep the green accent left-rule.
- **Data:** `api.insightsStats.billingSummary()` (unchanged) → `total_realised_savings`, `total_atheon_revenue`, `currency`.

### 3.2 `KpiTile` (+ gauge)
A 3-up band of KPI tiles. One tile carries a circular confidence gauge.

- **Composes** existing `Card` + `ScoreRing` ([src/components/ui/score-ring.tsx](../../../src/components/ui/score-ring.tsx)) — no new chart lib.
- **Tiles (Dashboard mapping):**
  1. **Active catalysts** — `clusters.filter(active).length` (from `api.catalysts.clusters()`).
  2. **Avg savings / run** — `roiData.totalDiscrepancyValueRecovered / catalystCount` (from `api.roi.get()`).
  3. **ROI confidence** — `ScoreRing` gauge on `health.overall` (from `api.apex.health()`), labelled as the confidence figure.
- Each tile carries a `MetricSource` provenance popover (existing pattern) so the figure is auditable.

### 3.3 `FindingsTable`
The billing proof: each row is one real finding with its traceable basis.

- **Reuses the existing confidence-render contract** from `AssessmentFindingsPanel` ([src/components/AssessmentFindingsPanel.tsx](../../../src/components/AssessmentFindingsPanel.tsx)) — specifically `confidenceBand()` / `isUnverified()` (Option B). We do **not** re-implement confidence chips. If embedding the whole panel is too heavy for the dashboard density, extract `confidenceBand`/`isUnverified` into a shared `lib/finding-confidence.ts` and have both consume it.
- **Row anatomy:** description (`title`) · ERP record (`erp_record_id` / `evidence.sample_records[0].ref`) · domain/field mapping (`domain`, optionally labelled via `api.erp.mappings()`) · confidence chip (`confidenceBand`) · `financial_impact` $.
- **Data:** `api.assessments.findings()` → `ValueAssessmentFinding[]` ([api.ts:4665-4703](../../../src/lib/api.ts#L4665-L4703)). Real per-finding rows — no synthesis.
- **Suppression:** honour Option B — gate-failed findings (`confidence_gate_passed === false`) render as "Indicative — confirm", never in a headline total.

## 4. Dashboard restructure (Phase 1)

`src/pages/Dashboard.tsx` today is a ~770-line stack of many sections
([Dashboard.tsx:265-1032](../../../src/pages/Dashboard.tsx#L265)). We restructure
the **top of the page** to the Dark-2 spine and keep the rest:

```
HeroSavings                          (upgraded SharedSavingsStrip hero)
PageHeader (masthead)                (unchanged)
KpiTile × 3  (active · avg · ROI gauge)   (new band, replaces MetricGrid lead)
Cumulative savings growth chart      (existing AreaChart, relabelled to savings)
FindingsTable                        (new — the billing proof)
── existing sections retained below ──
CFO morning view · dimensions ledger · status breakdown · charts · etc.
```

Data hooks are unchanged (`roiData`, `health`, `clusters`, `billingSummary`,
`actions`). We add `api.assessments.findings()` for the FindingsTable. No new
endpoints. The 60s silent auto-refresh and skeleton loading stay.

We **remove** the now-redundant `MetricGrid` lead band (its three figures —
value recovered / score / catalysts — are absorbed by HeroSavings + KpiTiles) to
avoid showing the same numbers twice. The dimension ledger + journey split stay.

## 5. Components & files

| Unit | File | Change |
|---|---|---|
| `HeroSavings` | `src/components/SharedSavingsStrip.tsx` | enlarge hero variant in place |
| `KpiTile` | `src/components/dashboard/KpiTile.tsx` | **new** (Card + ScoreRing) |
| `FindingsTable` | `src/components/dashboard/FindingsTable.tsx` | **new** |
| confidence helpers | `src/lib/finding-confidence.ts` | **new** (extract from AssessmentFindingsPanel) — only if shared |
| Dashboard wiring | `src/pages/Dashboard.tsx` | restructure top, add findings fetch |

## 6. Data flow

```
billingSummary ─→ HeroSavings (realised savings, revenue, currency)
roi.get + apex.health + catalysts.clusters ─→ KpiTile ×3
assessments.findings ─→ FindingsTable (rows) ─→ confidenceBand() chip
erp.mappings (optional) ─→ field-mapping column label
```

All fetches go through `Promise.allSettled` like the current page so one failure
never blanks the dashboard. FindingsTable shows `EmptyState` until findings load.

## 7. Error handling & states

- Each primitive renders its own empty/loading/error state (reuse `state.tsx`, `skeleton.tsx`).
- FindingsTable empty → "No findings yet · run a catalyst" with link to `/catalysts`.
- Gate-failed / unverified findings visually demoted, never counted in HeroSavings.

## 8. Testing

- Unit: `KpiTile` renders gauge + provenance; `FindingsTable` maps a `ValueAssessmentFinding` to the right columns; gate-failed finding renders "Indicative — confirm".
- Reuse existing `AssessmentFindingsPanel.test.tsx` confidence-band coverage; if extracting helpers, move those assertions to `finding-confidence.test.ts`.
- Visual: Dashboard renders against the existing light token system; no dark-mode regression.

## 9. Risks

- **Low.** Additive components inside the existing token system; no global CSS churn, no endpoint changes.
- Main risk is **duplicating** confidence logic — mitigated by reusing/extracting from `AssessmentFindingsPanel`.
- Removing `MetricGrid` lead must not drop a figure execs rely on — covered because HeroSavings + KpiTiles carry all three.

## 10. Open questions

1. Embed the full `AssessmentFindingsPanel` in the dashboard, or extract `confidenceBand`/`isUnverified` into `lib/finding-confidence.ts` and build a denser table? (Lean: extract — dashboard wants a compact table, the panel is verbose.)
2. Field-mapping column: show `domain` (cheap, always present) or fetch `api.erp.mappings()` for the literal `Source → Canonical` label (richer, one extra call)? (Lean: `domain` for Phase 1, mappings later.)
