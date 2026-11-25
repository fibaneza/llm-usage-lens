import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OrgUsageTiles } from "./OrgUsageTiles";

// Sources: Design System -- LiteLLM Organisation spend chart (unit OC1,
// T-OC5): four tiles -- Total spend, Requests, Tokens, Average cost per
// request ("—" with no requests); spend in USD, requests and tokens as grouped
// integers. Contract: <OrgUsageTiles totals={answer.totals} />.
const tile = (name: string) => screen.getByRole("group", { name });

describe("OrgUsageTiles (T-OC5)", () => {
  it("T-OC5: shows total spend, requests, tokens and the average cost per request", () => {
    render(
      <OrgUsageTiles
        totals={{ spend: 100, requests: 8, tokens: 1234567, failedRequests: 1 }}
      />,
    );
    expect(tile("Total spend")).toHaveTextContent("$100.00");
    expect(tile("Requests")).toHaveTextContent("8");
    expect(tile("Tokens")).toHaveTextContent("1,234,567");
    expect(tile("Average cost per request")).toHaveTextContent("$12.50");
  });

  it("T-OC5: the average is '—' when there are no requests or the request total is absent", () => {
    const { rerender } = render(
      <OrgUsageTiles totals={{ spend: 100, requests: 0, tokens: 0 }} />,
    );
    expect(tile("Average cost per request")).toHaveTextContent("—");
    rerender(<OrgUsageTiles totals={{ spend: 100 }} />);
    expect(tile("Average cost per request")).toHaveTextContent("—");
  });

  it("T-OC5: Tokens reads '—' when LiteLLM reported no total", () => {
    render(<OrgUsageTiles totals={{ spend: 5 }} />);
    expect(tile("Tokens")).toHaveTextContent("—");
    expect(tile("Total spend")).toHaveTextContent("$5.00");
  });
});
