# GTM Finding Confidence Render (Option B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render per-finding confidence in the prospect-facing panel + PDF business report, quarantining sub-threshold inferred findings ("Indicative — pending confirmation") so their rand value never enters the headline claimed-savings total.

**Architecture:** The data layer is already shipped — every `Finding` carries `confidence`, `confidence_explanation`, `confidence_gate_passed`, `erp_record_id`. This plan makes three changes, all keyed off the predicate **`confidence_gate_passed === false` = "indicative/unverified"** (DIRECT findings and legacy/undefined are treated as confirmed): (1) `summariseFindings` redefines `total_value_at_risk_zar` to confirmed-only and adds a separate `potential_unverified_zar` subtotal — this single change makes every downstream consumer defensible, including the savings projection at `assessment-engine.ts:2396` that becomes the shared-savings invoice basis; (2) the live panel splits the list into a confirmed group + an "Indicative — pending your confirmation" group, shows a secondary potential figure, and adds a confidence row per finding; (3) the PDF mirrors the split with a separate "Potential — pending your confirmation" section.

**Tech Stack:** TypeScript, React + Vite, jsPDF (deterministic, no LLM), vitest (`cloudflare:test` for backend, jsdom + @testing-library/react for frontend).

**Binding rule (do not violate):** assessments/reports are billing artefacts — every headline rand must trace to an ERP record + field mapping + confidence. Prefer false negatives (show + ask the customer) over silently applying weak rules. Gate-failed (n<25, confidence < 0.6) dollars are **shown but excluded** from any headline/claimed/billing total. The platform never names a model/provider in any auditor-facing string.

---

## File Structure

- **Modify** `workers/api/src/services/assessment-findings.ts` — `summariseFindings` return shape (Task 1). The shared "is this finding unverified?" semantics live here as an exported predicate so backend + tests agree.
- **Modify** `workers/api/src/__tests__/assessment-findings-confidence.test.ts` — add a `summariseFindings` describe block (Task 1).
- **Modify** `src/lib/api.ts` — `AssessmentFindingsSummary` type sync (Task 2).
- **Modify** `src/components/AssessmentFindingsPanel.tsx` — confidence helpers, secondary potential figure, confidence row, confirmed/indicative grouping (Task 3).
- **Create** `src/components/__tests__/AssessmentFindingsPanel.test.tsx` — RTL coverage (Task 4).
- **Modify** `workers/api/src/services/assessment-engine.ts` — PDF findings section: confirmed/indicative split, intro totals, per-card confidence label (Task 5).

A finding is **unverified** iff `confidence_gate_passed === false`. Use exactly this comparison everywhere (not `!confidence_gate_passed`) so that DIRECT findings (`true`) and legacy/undefined remain **confirmed**.

---

### Task 1: Backend — `summariseFindings` confirmed/unverified split

**Files:**
- Modify: `workers/api/src/services/assessment-findings.ts:2959-2994`
- Test: `workers/api/src/__tests__/assessment-findings-confidence.test.ts` (append a describe block)

- [ ] **Step 1: Write the failing test**

Append to `workers/api/src/__tests__/assessment-findings-confidence.test.ts`. The existing file already imports `makeFinding`, `FindingCode`, and defines `ctx`/`baseArgs`. Add `summariseFindings` to the import list at the top of the file, then add:

```typescript
import { summariseFindings } from '../services/assessment-findings';

describe('summariseFindings — confirmed vs unverified split', () => {
  // DIRECT code (gate always passes, even tiny sample) vs an INFERRED code
  // below the 25-record minimum (gate fails). Codes are classified in
  // FINDING_INFERENCE_KIND; pick one of each that exists in FINDING_CATALYST_MAP.
  function confirmed(value: number) {
    // ar_aging_overdue is DIRECT → gate passes
    return makeFinding({ ...baseArgs('ar_aging_overdue' as FindingCode, 100), value_at_risk_zar: value, severity: 'high' });
  }
  function unverified(value: number) {
    // vendor_spend_concentration is INFERRED; 5 records is below the 25 minimum → gate fails
    return makeFinding({ ...baseArgs('vendor_spend_concentration' as FindingCode, 5), value_at_risk_zar: value, severity: 'medium' });
  }

  it('excludes gate-failed value from total_value_at_risk_zar', () => {
    const s = summariseFindings([confirmed(1_000_000), unverified(400_000)]);
    expect(s.total_value_at_risk_zar).toBe(1_000_000);
  });

  it('reports gate-failed value as potential_unverified_zar with a count', () => {
    const s = summariseFindings([confirmed(1_000_000), unverified(400_000)]);
    expect(s.potential_unverified_zar).toBe(400_000);
    expect(s.unverified_count).toBe(1);
  });

  it('total_count still counts every finding', () => {
    const s = summariseFindings([confirmed(1_000_000), unverified(400_000)]);
    expect(s.total_count).toBe(2);
  });

  it('a confirmed-only set has zero potential_unverified_zar', () => {
    const s = summariseFindings([confirmed(500_000), confirmed(250_000)]);
    expect(s.total_value_at_risk_zar).toBe(750_000);
    expect(s.potential_unverified_zar).toBe(0);
    expect(s.unverified_count).toBe(0);
  });
});
```

If `vendor_spend_concentration` or `ar_aging_overdue` are not present in `FINDING_INFERENCE_KIND`/`FINDING_CATALYST_MAP`, substitute the nearest DIRECT and INFERRED codes (read `FINDING_INFERENCE_KIND` to pick: one mapped to `'direct'`, one mapped to `'inferred'`). The DIRECT finding must have gate passed; the INFERRED one with `affected_count: 5` must have gate failed.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd workers/api && npx vitest run src/__tests__/assessment-findings-confidence.test.ts -t "confirmed vs unverified"`
Expected: FAIL — `potential_unverified_zar`/`unverified_count` are `undefined`; `total_value_at_risk_zar` includes the 400_000.

- [ ] **Step 3: Implement the split in `summariseFindings`**

Replace the function at `workers/api/src/services/assessment-findings.ts:2959-2994` with:

```typescript
/** Tally findings into a category-grouped summary for the report cover page.
 *
 * `total_value_at_risk_zar` is the CONFIRMED total only — direct observations
 * plus inferred findings that cleared the sample-size gate. Gate-failed
 * (unproven) findings are summed separately into `potential_unverified_zar`
 * and never enter the headline / claimed / billing number. This keeps every
 * downstream consumer (panel headline, PDF intro, and the savings projection
 * that becomes the shared-savings basis) defensible by construction. */
export function summariseFindings(findings: Finding[]): {
  total_count: number;
  total_value_at_risk_zar: number;
  potential_unverified_zar: number;
  unverified_count: number;
  by_severity: Record<Severity, number>;
  by_category: Record<FindingCategory, { count: number; value_at_risk_zar: number }>;
  recommended_catalysts: string[];
} {
  const by_severity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const by_category: Record<FindingCategory, { count: number; value_at_risk_zar: number }> = {
    finance: { count: 0, value_at_risk_zar: 0 },
    procurement: { count: 0, value_at_risk_zar: 0 },
    supply_chain: { count: 0, value_at_risk_zar: 0 },
    sales: { count: 0, value_at_risk_zar: 0 },
    workforce: { count: 0, value_at_risk_zar: 0 },
    compliance: { count: 0, value_at_risk_zar: 0 },
    cross_cutting: { count: 0, value_at_risk_zar: 0 },
    service_delivery: { count: 0, value_at_risk_zar: 0 },
  };
  const catalysts = new Set<string>();
  let confirmedValue = 0;
  let potentialUnverified = 0;
  let unverifiedCount = 0;
  for (const f of findings) {
    by_severity[f.severity]++;
    by_category[f.category].count++;
    by_category[f.category].value_at_risk_zar += f.value_at_risk_zar;
    catalysts.add(f.recommended_catalyst.catalyst);
    // Gate-failed findings are unproven: quarantine their value from the headline.
    if (f.confidence_gate_passed === false) {
      potentialUnverified += f.value_at_risk_zar;
      unverifiedCount++;
    } else {
      confirmedValue += f.value_at_risk_zar;
    }
  }
  return {
    total_count: findings.length,
    total_value_at_risk_zar: confirmedValue,
    potential_unverified_zar: potentialUnverified,
    unverified_count: unverifiedCount,
    by_severity,
    by_category,
    recommended_catalysts: Array.from(catalysts).sort(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd workers/api && npx vitest run src/__tests__/assessment-findings-confidence.test.ts`
Expected: PASS (existing confidence tests + 4 new ones).

- [ ] **Step 5: Verify no other backend consumer broke**

Run: `cd workers/api && npx tsc --noEmit`
Expected: clean. (`assessment-engine.ts:2396` reads `findingsSummary.total_value_at_risk_zar` — it now receives the confirmed-only number, which is the intended behaviour: the savings projection no longer counts unverified dollars.)

- [ ] **Step 6: Commit**

```bash
git add workers/api/src/services/assessment-findings.ts workers/api/src/__tests__/assessment-findings-confidence.test.ts
git commit -m "feat(findings): summariseFindings splits confirmed vs unverified value

total_value_at_risk_zar is now confirmed-only (direct + gate-passed);
gate-failed value is quarantined into potential_unverified_zar. The
savings projection at assessment-engine.ts:2396 inherits the defensible
number automatically.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Frontend — sync `AssessmentFindingsSummary` type

**Files:**
- Modify: `src/lib/api.ts:3516-3522`

- [ ] **Step 1: Add the new fields**

Replace the interface at `src/lib/api.ts:3516-3522` with:

```typescript
export interface AssessmentFindingsSummary {
  total_count: number;
  /** CONFIRMED value only (direct + gate-passed). The defensible headline number. */
  total_value_at_risk_zar: number;
  /** Sum of gate-failed (unproven) findings — shown separately, never in the headline. */
  potential_unverified_zar?: number;
  /** How many findings fell below the confidence gate. */
  unverified_count?: number;
  by_severity: Record<AssessmentFindingSeverity, number>;
  by_category: Record<AssessmentFindingCategory, { count: number; value_at_risk_zar: number }>;
  recommended_catalysts: string[];
}
```

(The two new fields are optional so any already-serialised summary still type-checks; the panel guards on them.)

- [ ] **Step 2: Verify types**

Run: `cd /Users/reshigan/Atheon && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat(findings): add potential_unverified_zar to AssessmentFindingsSummary type

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Frontend — panel confidence render + confirmed/indicative grouping

**Files:**
- Modify: `src/components/AssessmentFindingsPanel.tsx`

Render contract (Option B):
1. Headline "Value at risk" stays = `summary.total_value_at_risk_zar` (now confirmed-only). When `potential_unverified_zar > 0`, add a secondary, visually-muted figure "Potential (pending confirmation)".
2. Split the visible list into a **Confirmed** group (rendered as today) and an **Indicative — pending your confirmation** group under its own sub-header with an explainer line.
3. Each finding's expanded body gains a "Confidence" row: a band badge + `confidence_explanation` + the `erp_record_id` source ref.
4. An indicative finding's header-row value reads "Potential (unverified)" in muted text, not the bold accent "Value at risk".

- [ ] **Step 1: Add confidence helpers near the existing `formatZAR` (after line 76)**

Insert after the `formatZAR` definition (`src/components/AssessmentFindingsPanel.tsx:76`):

```typescript
/** A finding is unverified iff its confidence gate explicitly failed.
 *  DIRECT findings (true) and legacy/undefined are treated as confirmed. */
const isUnverified = (f: AssessmentFinding): boolean => f.confidence_gate_passed === false;

type ConfidenceBand = { label: string; tone: 'pos' | 'info' | 'warn' };

/** Map a finding to a confidence badge. Returns null for legacy findings with
 *  no confidence attached (nothing to claim). */
function confidenceBand(f: AssessmentFinding): ConfidenceBand | null {
  if (f.confidence_gate_passed === false) return { label: 'Indicative — confirm', tone: 'warn' };
  if (typeof f.confidence !== 'number') return null;
  if (f.confidence >= 0.9) return { label: 'Verified', tone: 'pos' };
  if (f.confidence >= 0.75) return { label: 'High confidence', tone: 'info' };
  return { label: 'Medium confidence', tone: 'info' };
}

const BAND_CLASS: Record<ConfidenceBand['tone'], string> = {
  pos: 'text-pos border-pos/40',
  info: 'text-[var(--info)] border-[var(--info)]/40',
  warn: 'text-[var(--warning)] border-[var(--warning)]/40',
};
```

- [ ] **Step 2: Split the visible findings into confirmed + indicative**

After the `visibleFindings` useMemo (`src/components/AssessmentFindingsPanel.tsx:95-115`), add:

```typescript
  const confirmedVisible = useMemo(
    () => visibleFindings.filter(f => !isUnverified(f)),
    [visibleFindings],
  );
  const indicativeVisible = useMemo(
    () => visibleFindings.filter(isUnverified),
    [visibleFindings],
  );
  const potentialUnverified = summary?.potential_unverified_zar ?? 0;
```

- [ ] **Step 3: Add the secondary potential figure to the headline**

In the headline block, replace the "Value at risk" `<div className="text-right">` (`src/components/AssessmentFindingsPanel.tsx:175-180`) with:

```tsx
            <div className="text-right">
              <div className="text-label">Value at risk</div>
              <div className="text-2xl font-semibold text-accent" data-testid="findings-total-value">
                {formatZAR(totalValue)}
              </div>
              {potentialUnverified > 0 && (
                <div className="text-caption t-muted mt-1" data-testid="findings-potential-value">
                  + {formatZAR(potentialUnverified)} indicative, pending confirmation
                </div>
              )}
            </div>
```

- [ ] **Step 4: Add the Confidence row to the expanded body**

Immediately after the narrative paragraph (`src/components/AssessmentFindingsPanel.tsx:330`, the `<p>{f.narrative}</p>`), insert:

```tsx
                    {/* Confidence + source traceback */}
                    {confidenceBand(f) && (
                      <div className="flex items-start gap-2 flex-wrap" data-testid={`finding-confidence-${f.code}`}>
                        <Badge variant="outline" className={`text-caption ${BAND_CLASS[confidenceBand(f)!.tone]}`}>
                          {confidenceBand(f)!.label}
                        </Badge>
                        {f.confidence_explanation && (
                          <span className="text-xs t-muted flex-1 min-w-[12rem]">{f.confidence_explanation}</span>
                        )}
                        {f.erp_record_id && (
                          <span className="text-caption t-muted font-mono">src: {f.erp_record_id}</span>
                        )}
                      </div>
                    )}
```

- [ ] **Step 5: Extract the finding-card render so confirmed + indicative groups share it**

The existing `visibleFindings.map(f => { ... })` block (`src/components/AssessmentFindingsPanel.tsx:280-441`) becomes a local render function. Define it just before the `return` (after Step 2's memos):

```tsx
  const renderFindingCard = (f: AssessmentFinding) => {
    const isOpen = expanded.has(f.id);
    const unverified = isUnverified(f);
    return (
      // ... the existing <Card> ... </Card> body, with the header-row value block changed (Step 6).
    );
  };
```

Move the entire existing `<Card key={f.id} ...> ... </Card>` JSX into the body of `renderFindingCard`, replacing the inline `const isOpen = expanded.has(f.id);` (it now lives in the function). Keep the Step-4 confidence row inside it.

- [ ] **Step 6: Make the header value reflect verified vs indicative**

Inside `renderFindingCard`, replace the header-row value block (was `src/components/AssessmentFindingsPanel.tsx:312-323`) with:

```tsx
                  <div className="text-right whitespace-nowrap">
                    {f.value_at_risk_zar > 0 ? (
                      <>
                        <div className="text-label">{unverified ? 'Potential (unverified)' : 'Value at risk'}</div>
                        <div className={`text-base font-semibold ${unverified ? 't-muted' : 'text-accent'}`}>
                          {formatZAR(f.value_at_risk_zar)}
                        </div>
                      </>
                    ) : (
                      <div className="text-xs t-muted">Informational</div>
                    )}
                  </div>
```

- [ ] **Step 7: Replace the findings list render with the two groups**

Replace the findings-list block (`src/components/AssessmentFindingsPanel.tsx:273-443`, the `{visibleFindings.length === 0 ? (...) : (...)}`) with:

```tsx
      {/* Findings list */}
      {visibleFindings.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm t-muted">No findings match the current filters.</p>
        </Card>
      ) : (
        <>
          {confirmedVisible.length > 0 && (
            <div className="space-y-2">
              {confirmedVisible.map(renderFindingCard)}
            </div>
          )}

          {indicativeVisible.length > 0 && (
            <div className="space-y-2" data-testid="indicative-group">
              <div className="flex items-center gap-2 mt-2">
                <AlertTriangle size={14} className="text-[var(--warning)]" />
                <h4 className="text-sm font-semibold t-primary">Indicative — pending your confirmation</h4>
              </div>
              <p className="text-xs t-muted max-w-2xl">
                These findings are based on fewer than 25 records, so their value is shown separately and
                is excluded from the headline above. Connect more history and we can confirm them against
                your ERP.
              </p>
              {indicativeVisible.map(renderFindingCard)}
            </div>
          )}
        </>
      )}
```

(`AlertTriangle` is already imported at `src/components/AssessmentFindingsPanel.tsx:26`.)

- [ ] **Step 8: Verify types + build**

Run: `cd /Users/reshigan/Atheon && npx tsc --noEmit && npm run build`
Expected: clean build.

- [ ] **Step 9: Commit**

```bash
git add src/components/AssessmentFindingsPanel.tsx
git commit -m "feat(findings): render confidence + quarantine indicative findings in panel

Confirmed findings keep the bold headline; gate-failed findings render in
a separate 'Indicative — pending your confirmation' group with their value
excluded from the headline and shown as a secondary figure. Each finding
gains a confidence badge + explanation + ERP source ref.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Frontend — RTL test for the panel

**Files:**
- Create: `src/components/__tests__/AssessmentFindingsPanel.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssessmentFindingsPanel } from '../AssessmentFindingsPanel';
import type { AssessmentFinding, AssessmentFindingsSummary } from '@/lib/api';

function finding(over: Partial<AssessmentFinding>): AssessmentFinding {
  return {
    id: over.id ?? 'f1',
    code: over.code ?? 'ar_aging_overdue',
    category: over.category ?? 'finance',
    severity: over.severity ?? 'high',
    title: over.title ?? 'Overdue receivables',
    narrative: over.narrative ?? 'Some overdue invoices.',
    affected_count: over.affected_count ?? 120,
    value_at_risk_zar: over.value_at_risk_zar ?? 1_000_000,
    value_components: [],
    currency_breakdown: { ZAR: over.value_at_risk_zar ?? 1_000_000 },
    sample_records: [],
    recommended_catalyst: { catalyst: 'finance', sub_catalyst: 'collections' },
    metric_signature: 'sig',
    evidence_quality: 'high',
    detected_at: '2026-06-13',
    ...over,
  };
}

const summary: AssessmentFindingsSummary = {
  total_count: 2,
  total_value_at_risk_zar: 1_000_000,
  potential_unverified_zar: 400_000,
  unverified_count: 1,
  by_severity: { critical: 0, high: 1, medium: 1, low: 0 },
  by_category: {
    finance: { count: 1, value_at_risk_zar: 1_000_000 },
    procurement: { count: 1, value_at_risk_zar: 400_000 },
    supply_chain: { count: 0, value_at_risk_zar: 0 },
    sales: { count: 0, value_at_risk_zar: 0 },
    workforce: { count: 0, value_at_risk_zar: 0 },
    compliance: { count: 0, value_at_risk_zar: 0 },
    cross_cutting: { count: 0, value_at_risk_zar: 0 },
    service_delivery: { count: 0, value_at_risk_zar: 0 },
  },
  recommended_catalysts: ['finance', 'procurement'],
};

const confirmed = finding({
  id: 'c1', code: 'ar_aging_overdue', severity: 'high',
  value_at_risk_zar: 1_000_000, confidence: 0.95, confidence_gate_passed: true,
  confidence_explanation: 'Direct observation of 120 overdue invoices.',
  erp_record_id: 'INV-001',
});
const indicative = finding({
  id: 'u1', code: 'vendor_spend_concentration', category: 'procurement', severity: 'medium',
  title: 'Vendor concentration risk', value_at_risk_zar: 400_000,
  confidence: 0.4, confidence_gate_passed: false,
  confidence_explanation: 'Inferred from 5 records — below the 25-record minimum.',
  erp_record_id: 'PO-777',
});

describe('AssessmentFindingsPanel — Option B confidence render', () => {
  it('headline shows confirmed total and a secondary indicative figure', () => {
    render(<AssessmentFindingsPanel findings={[confirmed, indicative]} summary={summary} />);
    expect(screen.getByTestId('findings-total-value').textContent).toContain('1');
    const potential = screen.getByTestId('findings-potential-value');
    expect(potential.textContent).toMatch(/indicative, pending confirmation/i);
  });

  it('renders the indicative group with its quarantine explainer', () => {
    render(<AssessmentFindingsPanel findings={[confirmed, indicative]} summary={summary} />);
    expect(screen.getByTestId('indicative-group')).toBeInTheDocument();
    expect(screen.getByText(/Indicative — pending your confirmation/i)).toBeInTheDocument();
    expect(screen.getByText(/excluded from the headline above/i)).toBeInTheDocument();
  });

  it('labels an indicative finding value as Potential (unverified)', () => {
    render(<AssessmentFindingsPanel findings={[confirmed, indicative]} summary={summary} />);
    expect(screen.getByText('Potential (unverified)')).toBeInTheDocument();
  });

  it('shows a confidence badge + ERP source ref when a finding is expanded', () => {
    render(<AssessmentFindingsPanel findings={[confirmed, indicative]} summary={summary} />);
    // expand the confirmed finding
    fireEvent.click(screen.getByText('Overdue receivables'));
    const conf = screen.getByTestId('finding-confidence-ar_aging_overdue');
    expect(conf.textContent).toContain('Verified');
    expect(conf.textContent).toContain('INV-001');
  });

  it('badges a gate-failed finding as Indicative — confirm', () => {
    render(<AssessmentFindingsPanel findings={[confirmed, indicative]} summary={summary} />);
    fireEvent.click(screen.getByText('Vendor concentration risk'));
    const conf = screen.getByTestId('finding-confidence-vendor_spend_concentration');
    expect(conf.textContent).toContain('Indicative — confirm');
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd /Users/reshigan/Atheon && npx vitest run src/components/__tests__/AssessmentFindingsPanel.test.tsx`
Expected: PASS (5 tests). If a `data-testid` or label string differs from Task 3, fix Task 3's render to match this contract (the test is the spec).

- [ ] **Step 3: Commit**

```bash
git add src/components/__tests__/AssessmentFindingsPanel.test.tsx
git commit -m "test(findings): RTL coverage for Option B confidence render

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: PDF business report — confirmed/indicative split

**Files:**
- Modify: `workers/api/src/services/assessment-engine.ts:1208-1356`

Mirror the panel: the intro leads with the confirmed total and notes the indicative total separately; confirmed findings render as today; gate-failed findings render in a "Potential — pending your confirmation" section with a muted value label.

- [ ] **Step 1: Replace the intro total computation**

At `workers/api/src/services/assessment-engine.ts:1216-1220`, replace:

```typescript
    const totalValue = findings.reduce((s, f) => s + f.value_at_risk_zar, 0);
    const intro = `${findings.length} findings detected across your ERP data, totalling ${formatCurrency(totalValue, config.currency, config.exchange_rate_to_zar)} of value-at-risk. Each finding is derived from your own records and maps to the Atheon catalyst that resolves it. Sample records are included so you can verify against your source system.`;
```

with:

```typescript
    const confirmedFindings = findings.filter(f => f.confidence_gate_passed !== false);
    const indicativeFindings = findings.filter(f => f.confidence_gate_passed === false);
    const confirmedValue = confirmedFindings.reduce((s, f) => s + f.value_at_risk_zar, 0);
    const indicativeValue = indicativeFindings.reduce((s, f) => s + f.value_at_risk_zar, 0);
    const totalValue = confirmedValue; // headline = confirmed only
    const indicativeSentence = indicativeFindings.length > 0
      ? ` A further ${indicativeFindings.length} indicative finding${indicativeFindings.length === 1 ? '' : 's'} (based on fewer than 25 records, ${formatCurrency(indicativeValue, config.currency, config.exchange_rate_to_zar)}) are listed separately for you to confirm — their value is excluded from the figure above.`
      : '';
    const intro = `${confirmedFindings.length} confirmed findings detected across your ERP data, totalling ${formatCurrency(confirmedValue, config.currency, config.exchange_rate_to_zar)} of value-at-risk. Each finding is derived from your own records and maps to the Atheon catalyst that resolves it. Sample records are included so you can verify against your source system.${indicativeSentence}`;
```

- [ ] **Step 2: Render confirmed findings, then an indicative section**

At `workers/api/src/services/assessment-engine.ts:1238`, replace `const top = findings.slice(0, 25);` with `const top = confirmedFindings.slice(0, 25);`.

Then, immediately after the existing per-finding `for` loop closes (`src/services/assessment-engine.ts:1355`, the `}` ending the `for (let i...)`), insert the indicative section before the "Footer note for trimmed list" block at line 1357:

```typescript
    // ── Indicative (pending confirmation) section ──────────────────────────
    // Gate-failed findings: shown so the prospect sees the upside, but with a
    // muted value label and excluded from the headline total above. This is the
    // false-negatives-over-weak-rules rule made concrete on the page.
    const indicativeTop = indicativeFindings.slice(0, 10);
    if (indicativeTop.length > 0) {
      pageFooter();
      doc.addPage();
      pageHeader('Potential — pending your confirmation');
      fy = 28;
      doc.setTextColor(...slate);
      doc.setFontSize(9);
      const note = `${indicativeFindings.length} finding${indicativeFindings.length === 1 ? ' is' : 's are'} based on fewer than 25 records. We show ${indicativeFindings.length === 1 ? 'it' : 'them'} here so nothing is hidden, but ${indicativeFindings.length === 1 ? 'its' : 'their'} value is NOT included in the headline above. Connect more history and Atheon can confirm ${indicativeFindings.length === 1 ? 'it' : 'them'} against your ERP.`;
      const noteLines = doc.splitTextToSize(note, pageW - 28);
      doc.text(noteLines, 14, fy);
      fy += noteLines.length * 4 + 6;

      for (const f of indicativeTop) {
        const narrLines = doc.splitTextToSize(f.narrative, pageW - 36).slice(0, 2);
        const cardH = 30 + narrLines.length * 4;
        if (fy > pageH - cardH - 10) {
          pageFooter();
          doc.addPage();
          pageHeader('Potential — pending your confirmation (cont.)');
          fy = 28;
        }
        doc.setFillColor(...lightBg);
        doc.rect(14, fy, pageW - 28, cardH, 'F');
        doc.setFillColor(...gold);
        doc.rect(14, fy, 2, cardH, 'F');
        doc.setFontSize(7);
        doc.setTextColor(...gold);
        doc.text('INDICATIVE — CONFIRM', 18, fy + 5);
        doc.setTextColor(160, 160, 160);
        doc.text(f.code, pageW - 18, fy + 5, { align: 'right' });
        doc.setFontSize(10);
        doc.setTextColor(...navy);
        doc.text(doc.splitTextToSize(f.title, pageW - 36).slice(0, 1), 18, fy + 11);
        doc.setFontSize(8);
        doc.setTextColor(...slate);
        doc.text(narrLines, 18, fy + 17);
        if (f.value_at_risk_zar > 0) {
          doc.setFontSize(7);
          doc.setTextColor(120, 120, 120);
          doc.text('POTENTIAL (UNVERIFIED)', pageW - 18, fy + 17, { align: 'right' });
          doc.setFontSize(10);
          doc.setTextColor(150, 130, 60);
          doc.text(
            formatCurrency(f.value_at_risk_zar, config.currency, config.exchange_rate_to_zar),
            pageW - 18, fy + 23, { align: 'right' },
          );
        }
        fy += cardH + 4;
      }
    }
```

(`gold`, `navy`, `slate`, `lightBg`, `pageW`, `pageH`, `pageHeader`, `pageFooter`, `formatCurrency` are all already in scope in this function — same names used by the confirmed loop above.)

- [ ] **Step 3: Fix the trimmed-list footer note to reference the confirmed list**

At `workers/api/src/services/assessment-engine.ts:1358`, the condition `if (findings.length > top.length)` now compares the full list against the confirmed cap. Replace with:

```typescript
    if (confirmedFindings.length > top.length) {
```

(and if the body text references `findings.length`, change it to `confirmedFindings.length`). Read lines 1358-1366 and adjust the count used in the note to `confirmedFindings.length`.

- [ ] **Step 4: Verify types**

Run: `cd workers/api && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Run the backend suite to confirm no regression**

Run: `cd workers/api && npx vitest run src/__tests__/assessment-findings-confidence.test.ts`
Expected: PASS. (The PDF path has no dedicated render test; correctness of the totals is locked by Task 1 because the PDF derives `confirmedValue` from the same predicate.)

- [ ] **Step 6: Commit**

```bash
git add workers/api/src/services/assessment-engine.ts
git commit -m "feat(findings): PDF report splits confirmed vs indicative findings

Headline value-at-risk is confirmed-only; gate-failed findings render in a
separate 'Potential — pending your confirmation' section with a muted,
unverified value label and excluded from the headline.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Verification (after all tasks)

- [ ] Backend: `cd workers/api && npx vitest run && npx tsc --noEmit`
- [ ] Frontend: `cd /Users/reshigan/Atheon && npx vitest run src/components/__tests__/AssessmentFindingsPanel.test.tsx && npx tsc --noEmit && npm run build`
- [ ] Manual sanity (optional, staging seed): generate a VantaX assessment, confirm the panel headline excludes any indicative findings and the PDF carries a "Potential — pending your confirmation" page when gate-failed findings exist.

## Out of scope

- No change to detectors or SQL — confidence is derived from `affected_count` + the code's classification, both already present.
- No change to `value-assessment-engine` (it has its own gating).
- `by_category.value_at_risk_zar` intentionally still sums all findings (it drives the category filter, not the headline); only the top-line total splits.
