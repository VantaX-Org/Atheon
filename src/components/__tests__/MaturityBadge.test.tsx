// Component tests for MaturityBadge + ImplementationDot (implementation-status
// badges on the catalyst template catalog).
import React from "react";
import { render, screen } from "@testing-library/react";
import { MaturityBadge, maturityTooltip } from "../MaturityBadge";
import { ImplementationDot } from "../ImplementationDot";

describe("MaturityBadge", () => {
  it("renders 'Production' label for production maturity", () => {
    render(<MaturityBadge maturity="production" />);
    expect(screen.getByText("Production")).toBeInTheDocument();
  });

  it("renders 'Partial' label with tooltip counts when summary provided", () => {
    render(
      <MaturityBadge
        maturity="partial"
        summary={{ real: 4, generic: 2, stub: 0, total: 6, maturity: 'partial' }}
      />
    );
    const el = screen.getByText("Partial");
    expect(el).toBeInTheDocument();
    expect(el.getAttribute("title")).toContain("4 of 6 sub-catalysts");
    expect(el.getAttribute("title")).toContain("The other 2 return generic data");
  });

  it("renders 'Planned' label with named-only tooltip copy", () => {
    render(<MaturityBadge maturity="planned" />);
    const el = screen.getByText("Planned");
    expect(el.getAttribute("title")).toContain("no real runtime handlers");
  });

  it("exposes data-maturity attribute for styling / testing hooks", () => {
    render(<MaturityBadge maturity="production" />);
    expect(screen.getByText("Production").getAttribute("data-maturity")).toBe("production");
  });
});

describe("maturityTooltip", () => {
  it("uses counts for production when summary supplied", () => {
    expect(
      maturityTooltip('production', { real: 6, generic: 0, stub: 0, total: 6, maturity: 'production' })
    ).toContain("6 of 6");
  });

  it("omits the tail when partial has no non-real sub-catalysts", () => {
    const txt = maturityTooltip('partial', { real: 6, generic: 0, stub: 0, total: 6, maturity: 'partial' });
    expect(txt).not.toContain("return generic data");
  });
});

describe("ImplementationDot", () => {
  it("renders an accessible dot for each implementation tier", () => {
    const { rerender } = render(<ImplementationDot implementation="real" />);
    expect(screen.getByRole("img", { name: /Real/ })).toBeInTheDocument();

    rerender(<ImplementationDot implementation="generic" />);
    expect(screen.getByRole("img", { name: /Generic/ })).toBeInTheDocument();

    rerender(<ImplementationDot implementation="stub" />);
    expect(screen.getByRole("img", { name: /Stub/ })).toBeInTheDocument();
  });

  it("has a title attribute for hover tooltip", () => {
    render(<ImplementationDot implementation="generic" />);
    const el = screen.getByRole("img", { name: /Generic/ });
    expect(el.getAttribute("title")).toContain("default dispatcher");
  });
});
