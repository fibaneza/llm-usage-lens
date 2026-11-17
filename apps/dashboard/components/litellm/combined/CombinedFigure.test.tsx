import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CombinedFigure } from "./CombinedFigure";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage
// (L6)" -> UI pieces: "`CombinedFigure` renders the total with its parts
// always as text beneath it ("Direct Bedrock $x · Via LiteLLM $y") and a
// disclosure (aria-expanded) for the provider split - expansion, not hover
// (touch, WCAG 1.4.13). Badges "Includes estimates", "LiteLLM-reported"";
// computation -> Estimates (costEstimated, provisional); Rule 60.24a.
// Module under test: `components/litellm/combined/CombinedFigure.tsx`
//   <CombinedFigure combined bedrockDirect litellm byProvider? costEstimated
//                   provisional />   (numbers in USD; shown to 2 dp)
// Contract:
//   - the total in an element with data-testid="combined-total" ("$16.20")
//   - ONE element data-testid="combined-parts" whose text is
//     "Direct Bedrock $10.00 · Via LiteLLM $6.20" followed by the badge
//     (always rendered)
//   - the "LiteLLM-reported" badge (LiteLLMReportedBadge) sits on the Via
//     LiteLLM part, inside combined-parts after its amount, NOT beside the
//     combined total: the total is not LiteLLM-reported (Rule 20.3; L6 review
//     round 1, NIT)
//   - "Includes estimates" badge only when costEstimated
//   - the note "Provisional: recent days are not final." only when provisional
//   - a button named "Provider split" with aria-expanded (false initially),
//     present only when byProvider is non-empty; expanded -> a list with one
//     item per provider, text containing the provider and its amount
const PROVIDERS = [
  { provider: "bedrock", spend: 5.2 },
  { provider: "openai", spend: 1 },
];
const BASE = {
  combined: 16.2,
  bedrockDirect: 10,
  litellm: 6.2,
  costEstimated: false,
  provisional: false,
};

describe("CombinedFigure", () => {
  it("shows the total and its parts as plain text, without any interaction", () => {
    render(<CombinedFigure {...BASE} byProvider={PROVIDERS} />);
    expect(screen.getByTestId("combined-total")).toHaveTextContent("$16.20");
    const parts = screen.getByTestId("combined-parts");
    expect(parts.textContent).toMatch(
      /^Direct Bedrock \$10\.00 · Via LiteLLM \$6\.20/,
    );
  });

  it("puts the LiteLLM-reported badge on the Via LiteLLM part, not on the combined total (Rule 20.3)", () => {
    render(<CombinedFigure {...BASE} byProvider={PROVIDERS} />);
    const badge = screen.getByText("LiteLLM-reported");
    const parts = screen.getByTestId("combined-parts");
    expect(within(parts).getByText("LiteLLM-reported")).toBe(badge);
    expect(parts.textContent).toMatch(/Via LiteLLM \$6\.20\s*LiteLLM-reported/);
    const total = screen.getByTestId("combined-total");
    expect(total.parentElement).not.toContainElement(badge);
    expect(total).not.toContainElement(badge);
  });

  it("discloses the provider split on click, not hover, and collapses again", async () => {
    const user = userEvent.setup();
    render(<CombinedFigure {...BASE} byProvider={PROVIDERS} />);
    const toggle = screen.getByRole("button", { name: "Provider split" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("openai")).toBeNull();

    await user.hover(toggle);
    expect(screen.queryByText("openai")).toBeNull();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("bedrock");
    expect(items[0]).toHaveTextContent("$5.20");
    expect(items[1]).toHaveTextContent("openai");
    expect(items[1]).toHaveTextContent("$1.00");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("openai")).toBeNull();
  });

  it("has no disclosure when there is no provider split", () => {
    render(<CombinedFigure {...BASE} byProvider={[]} />);
    expect(screen.queryByRole("button", { name: "Provider split" })).toBeNull();
    render(<CombinedFigure {...BASE} />);
    expect(screen.queryByRole("button", { name: "Provider split" })).toBeNull();
  });

  it("marks estimates and provisional days only when the flags are set (no colour-only state)", () => {
    const { rerender } = render(<CombinedFigure {...BASE} />);
    expect(screen.queryByText("Includes estimates")).toBeNull();
    expect(
      screen.queryByText("Provisional: recent days are not final."),
    ).toBeNull();

    rerender(<CombinedFigure {...BASE} costEstimated provisional />);
    expect(screen.getByText("Includes estimates")).toBeInTheDocument();
    expect(
      screen.getByText("Provisional: recent days are not final."),
    ).toBeInTheDocument();
  });

  it("renders zero parts as $0.00, never blank", () => {
    render(
      <CombinedFigure {...BASE} combined={10} bedrockDirect={10} litellm={0} />,
    );
    expect(
      screen.getByText("Direct Bedrock $10.00 · Via LiteLLM $0.00"),
    ).toBeInTheDocument();
  });
});
