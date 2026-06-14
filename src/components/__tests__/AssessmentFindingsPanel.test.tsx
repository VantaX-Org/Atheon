// RTL coverage for the Option B confidence render in AssessmentFindingsPanel.
//
// Contract under test:
//   - The headline "Value at risk" shows the CONFIRMED total only, with a
//     secondary "indicative, pending confirmation" figure beneath it.
//   - Gate-failed findings (confidence_gate_passed === false) are quarantined
//     into a separate "Indicative — pending your confirmation" group, excluded
//     from the headline, and labelled "Potential (unverified)".
//   - Each finding's expanded body surfaces a confidence band + ERP source ref.
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { AssessmentFindingsPanel } from "../AssessmentFindingsPanel";
import type {
  AssessmentFinding,
  AssessmentFindingCategory,
  AssessmentFindingsSummary,
} from "@/lib/api";

const baseFinding = (over: Partial<AssessmentFinding>): AssessmentFinding => ({
  id: over.id ?? "f-id",
  code: over.code ?? "FIN-001",
  category: over.category ?? "finance",
  severity: over.severity ?? "high",
  title: over.title ?? "A finding",
  narrative: over.narrative ?? "Some narrative about the finding.",
  affected_count: over.affected_count ?? 120,
  value_at_risk_zar: over.value_at_risk_zar ?? 1_000_000,
  value_components: over.value_components ?? [],
  currency_breakdown: over.currency_breakdown ?? { ZAR: 1_000_000 },
  sample_records: over.sample_records ?? [],
  recommended_catalyst: over.recommended_catalyst ?? { catalyst: "Cat", sub_catalyst: "Sub" },
  metric_signature: over.metric_signature ?? "sig",
  evidence_quality: over.evidence_quality ?? "high",
  confidence: over.confidence,
  confidence_explanation: over.confidence_explanation,
  confidence_gate_passed: over.confidence_gate_passed,
  erp_record_id: over.erp_record_id,
  detected_at: over.detected_at ?? "2026-06-13T00:00:00Z",
  company_id: over.company_id,
  company_name: over.company_name,
});

const confirmed = baseFinding({
  id: "confirmed-1",
  code: "FIN-CONF",
  title: "Confirmed leakage",
  value_at_risk_zar: 2_000_000,
  confidence: 0.95,
  confidence_gate_passed: true,
  confidence_explanation: "Direct observation across 480 invoices.",
  erp_record_id: "INV-99812",
});

const unverified = baseFinding({
  id: "unverified-1",
  code: "FIN-UNV",
  title: "Indicative duplicate risk",
  value_at_risk_zar: 750_000,
  confidence: 0.4,
  confidence_gate_passed: false,
  confidence_explanation: "Inferred from a small sample.",
  erp_record_id: "PO-1234",
});

const ALL_CATEGORIES: AssessmentFindingCategory[] = [
  "finance", "procurement", "supply_chain", "sales",
  "workforce", "compliance", "cross_cutting", "service_delivery",
];

const summary: AssessmentFindingsSummary = {
  total_count: 2,
  total_value_at_risk_zar: 2_000_000, // confirmed only
  potential_unverified_zar: 750_000,
  unverified_count: 1,
  by_severity: { critical: 0, high: 2, medium: 0, low: 0 },
  by_category: Object.fromEntries(
    ALL_CATEGORIES.map(c => [c, { count: c === "finance" ? 2 : 0, value_at_risk_zar: 0 }]),
  ) as AssessmentFindingsSummary["by_category"],
  recommended_catalysts: [],
};

describe("AssessmentFindingsPanel — Option B confidence render", () => {
  it("shows confirmed-only headline plus a secondary indicative figure", () => {
    render(<AssessmentFindingsPanel findings={[confirmed, unverified]} summary={summary} />);
    expect(screen.getByTestId("findings-total-value")).toHaveTextContent(/2[\s ,.]?000[\s ,.]?000/);
    expect(screen.getByTestId("findings-potential-value")).toHaveTextContent(/indicative, pending confirmation/i);
  });

  it("headline value equals the confirmed total only, excluding the unverified value", () => {
    render(<AssessmentFindingsPanel findings={[confirmed, unverified]} summary={summary} />);
    const headline = screen.getByTestId("findings-total-value");
    // Build separator-agnostic patterns from the digit groups so we don't depend
    // on the host ICU group separator (space vs narrow-no-break space).
    const toPattern = (n: number): RegExp =>
      new RegExp(
        Math.round(n)
          .toLocaleString("en-ZA")
          .replace(/[^\d]/g, "[\\s ,.]?"),
      );
    // Confirmed-only: 2,000,000 (summary.total_value_at_risk_zar).
    expect(headline).toHaveTextContent(toPattern(summary.total_value_at_risk_zar));
    // Confirmed + unverified combined: 2,750,000 — must NOT appear.
    const combined = summary.total_value_at_risk_zar + summary.potential_unverified_zar;
    expect(headline).not.toHaveTextContent(toPattern(combined));
  });

  it("renders no confidence badge for a confirmed finding with no confidence number", () => {
    const noConfidence = baseFinding({
      id: "noconf-1",
      code: "FIN-NOCONF",
      title: "Confirmed but unscored",
      value_at_risk_zar: 500_000,
      confidence: undefined,
      confidence_gate_passed: true,
    });
    render(<AssessmentFindingsPanel findings={[noConfidence]} summary={summary} />);
    fireEvent.click(screen.getByText("Confirmed but unscored"));
    expect(screen.queryByTestId("finding-confidence-FIN-NOCONF")).toBeNull();
  });

  it("quarantines gate-failed findings into the indicative group", () => {
    render(<AssessmentFindingsPanel findings={[confirmed, unverified]} summary={summary} />);
    const group = screen.getByTestId("indicative-group");
    expect(group).toBeInTheDocument();
    expect(within(group).getByText(/Indicative — pending your confirmation/i)).toBeInTheDocument();
    expect(within(group).getByText(/excluded from the headline above/i)).toBeInTheDocument();
    expect(within(group).getByText(/fewer than 25 records/i)).toBeInTheDocument();
    expect(within(group).getByText(/Potential \(unverified\)/i)).toBeInTheDocument();
  });

  it("renders a 'Verified' confidence band + ERP source ref for the confirmed finding", () => {
    render(<AssessmentFindingsPanel findings={[confirmed, unverified]} summary={summary} />);
    fireEvent.click(screen.getByText("Confirmed leakage"));
    const row = screen.getByTestId("finding-confidence-FIN-CONF");
    expect(row).toHaveTextContent("Verified");
    expect(row).toHaveTextContent("src:INV-99812");
  });

  it("renders 'Indicative — confirm' for the unverified finding", () => {
    render(<AssessmentFindingsPanel findings={[confirmed, unverified]} summary={summary} />);
    fireEvent.click(screen.getByText("Indicative duplicate risk"));
    const row = screen.getByTestId("finding-confidence-FIN-UNV");
    expect(row).toHaveTextContent("Indicative — confirm");
  });

  it("excludes unverified value from the headline even with no summary supplied", () => {
    // Fallback path (summary undefined): headline must still be derived from
    // confirmed findings only, never re-admitting gate-failed rand.
    render(<AssessmentFindingsPanel findings={[confirmed, unverified]} />);
    const headline = screen.getByTestId("findings-total-value");
    const toPattern = (n: number): RegExp =>
      new RegExp(
        Math.round(n)
          .toLocaleString("en-ZA")
          .replace(/[^\d]/g, "[\\s ,.]?"),
      );
    // confirmed.value_at_risk_zar present; combined confirmed+unverified absent.
    expect(headline).toHaveTextContent(toPattern(confirmed.value_at_risk_zar));
    expect(headline).not.toHaveTextContent(
      toPattern(confirmed.value_at_risk_zar + unverified.value_at_risk_zar),
    );
    // Secondary indicative figure is computed from findings, not hardcoded to 0.
    expect(screen.getByTestId("findings-potential-value")).toHaveTextContent(
      /indicative, pending confirmation/i,
    );
  });
});
