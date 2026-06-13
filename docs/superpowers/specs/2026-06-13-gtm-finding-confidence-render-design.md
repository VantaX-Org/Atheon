# GTM Finding Confidence — Render & Suppression Policy

> **Status:** DECIDED 2026-06-13 (Reshigan) — **Option B approved.** Ready for an
> implementation plan. The render spec in this doc is the build contract.
> Option C was explicitly rejected for putting unverified dollars in the headline.

## Context

The primary go-to-market finding path is `assessment-findings.ts` →
`AssessmentFindingsPanel.tsx` (live panel) + `assessment-engine.ts` (PDF
business report). It is the artefact a prospect verifies against their own ERP,
and under the shared-savings model every claimed rand must trace to a source
record + basis + confidence.

**Done (this branch, additive, low-risk, committed locally):** every `Finding`
now carries, computed centrally in `makeFinding`:

- `confidence` (0–1) — DIRECT observations = 0.95; INFERRED scale with sample size.
- `confidence_explanation` — auditor-facing statistical basis (no model/provider name).
- `confidence_gate_passed` — `false` when an inferred finding fell below the
  25-record sample minimum (the dollar is unproven).
- `erp_record_id` — the first sample record's ref, for traceback.

The 40 codes are classified `direct` (26) vs `inferred` (14) in
`FINDING_INFERENCE_KIND`, with a per-code basis phrase in `FINDING_BASIS`.
`risk_alerts.probability` now writes the real `confidence` instead of an
evidence-quality proxy. Tests lock the classification, the no-provider-leak
invariant, and the `makeFinding` wiring (26 tests green).

**Not done (this note):** the data is carried but not yet RENDERED, and the
treatment of sub-threshold inferred findings (`confidence_gate_passed === false`)
in the prospect-facing artefacts is undecided. That is a credibility-vs-
completeness call with a direct effect on the headline claimed-savings number,
so it is Reshigan's to make.

## The decision

How should the live panel + PDF business report treat an INFERRED finding whose
sample fell below the 25-record minimum (gate failed, confidence < 0.6)?

### Option A — Suppress entirely

Drop gated findings from the panel and PDF. Headline total = direct + inferred
gate-passed only.

- **+** Cleanest possible credibility; nothing on the page is weak.
- **−** Hides a real signal from the prospect and silently removes upside; a
  later "we missed this" erodes trust more than a flagged-uncertain line would.

### Option B — Show, demoted + flagged, excluded from the headline (RECOMMENDED)

Render gated findings in a separate "Indicative — pending your confirmation"
group. Badge each: "Based on n<25 records — confirm against your ERP". Their
rand value is shown but **excluded from the headline claimed-savings total** and
reported as a separate "potential, unverified" subtotal.

- **+** Matches the binding rule: prefer false negatives (low-confidence + ask
  the customer) over silently applying weak rules. The headline number stays
  defensible (only direct + gate-passed dollars); upside is surfaced honestly,
  not hidden or over-claimed.
- **+** Turns uncertainty into a sales conversation ("connect more history and
  we can confirm these too") rather than a hidden gap.
- **−** More UI states; the report has two totals to explain.

### Option C — Show inline with a confidence badge, include the dollar

One list, each finding badged with its confidence; gated dollars still count in
the headline.

- **−** Lets a sub-threshold heuristic inflate the headline claim — the exact
  "silently applying weak rules" failure the binding rule forbids. Not advised.

## Decision

**Option B — APPROVED (Reshigan, 2026-06-13).** It is the only option consistent
with the shared-savings rule: the claimed number is provable; the unprovable is
shown but quarantined and explicitly handed back to the customer to confirm.
Option C was considered and rejected — counting gate-failed (n<25, confidence
<0.6) dollars in the headline total would let a weak heuristic inflate the
Shared-Savings invoice basis, the exact failure the binding rule forbids.

## Render spec (build contract — Option B)

1. **`AssessmentFindingsPanel.tsx`** — in each finding's expanded body, add a
   "Confidence" row: badge (`Verified` for direct, `High/Medium` for gate-passed
   inferred by confidence band, `Indicative — confirm` for gated) + the
   `confidence_explanation` text + the `erp_record_id` shown as the source ref.
   Group gated findings under an "Indicative — pending confirmation" sub-header.
2. **Summary / headline** — `total_value_at_risk_zar` counts direct +
   (inferred AND `confidence_gate_passed`). Add `potential_unverified_zar` =
   sum of gated findings, surfaced as a clearly secondary figure.
3. **PDF business report (`assessment-engine.ts`)** — mirror: claimed total from
   confirmed findings only; a separate "Potential, pending confirmation"
   section listing gated findings with the same confirm-against-ERP framing.
4. **`summariseFindings`** — split counts/value by `confidence_gate_passed`.

## Out of scope

- No change to the detectors or SQL — confidence is derived from
  `affected_count` + the code's classification, both already present.
- No change to the value-assessment-engine path (it already has its own gating).
