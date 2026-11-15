import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { LiteLLMReportedBadge } from "./LiteLLMReportedBadge";

// Source: Design System -- LiteLLM Page, "Provenance label"; LiteLLM spec --
// Cost visualisation and provenance; threat LT8.
describe("LiteLLMReportedBadge", () => {
  it("is labelled LiteLLM-reported", () => {
    render(<LiteLLMReportedBadge />);
    expect(screen.getByText("LiteLLM-reported")).toBeInTheDocument();
  });

  it("explains on hover that the figure is not billed cost", async () => {
    render(<LiteLLMReportedBadge />);
    await userEvent.hover(screen.getByText("LiteLLM-reported"));
    expect(
      (
        await screen.findAllByText(
          "Calculated by LiteLLM from its price map; not billed cost.",
        )
      ).length,
    ).toBeGreaterThan(0);
  });
});
