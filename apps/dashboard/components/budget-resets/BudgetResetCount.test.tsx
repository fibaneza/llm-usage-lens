import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import {
  OrgResetCell,
  OwnResetCount,
  TeamResetCount,
} from "./BudgetResetCount";

// Sources: docs/specs/2026-11-10-litellm.md -- MG-D9 (the count and total
// amount cover resets a person triggered through the dashboard in the
// selected range; LiteLLM's scheduled reset is not counted), MG-D10 (a user
// sees their own; surfaces: My usage, the Team page's Budgets view, the
// Organisation tab; per-member counts only when the route returns them);
// Access Control BR10 (the client shows only what the scoped route returns).
// The scoping itself is tested with GET /api/budget-resets; this layer tests
// what is rendered from a response and the request that is sent. Rule 60.24a.
const RANGE = { dateFrom: "2026-11-01", dateTo: "2026-11-14" };

function stub(response: () => Response) {
  const urls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      urls.push(new URL(String(input), "http://localhost"));
      return response();
    }),
  );
  return urls;
}
const counts = (over: Record<string, unknown> = {}) =>
  apiResponse({
    data: {
      teams: [{ teamId: "t1", count: 2, amount: 80.25 }],
      own: { count: 1, amount: 30 },
      ...over,
    },
  });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("OwnResetCount (My usage; MG-D10: a user sees their own)", () => {
  it("shows the caller's own count and amount, never the team's", async () => {
    stub(() => counts());
    renderWithProviders(<OwnResetCount range={RANGE} />);
    const line = await screen.findByText(/budget resets in this range/i);
    expect(line).toHaveTextContent("1 reset, $30.00");
    expect(line.textContent).not.toContain("80.25");
  });

  it("zero resets in the range says so, it does not hide", async () => {
    stub(() => counts({ own: { count: 0, amount: 0 } }));
    renderWithProviders(<OwnResetCount range={RANGE} />);
    expect(await screen.findByText(/No budget resets/)).toBeVisible();
  });

  it("asks the scoped route for the selected UTC range (Rule 20.1)", async () => {
    const urls = stub(() => counts());
    renderWithProviders(<OwnResetCount range={RANGE} />);
    await screen.findByText(/budget resets in this range/i);
    const first = urls[0];
    expect(first).toBeDefined();
    expect(first?.pathname).toBe("/api/budget-resets");
    expect(first?.searchParams.get("dateFrom")).toBe("2026-11-01");
    expect(first?.searchParams.get("dateTo")).toBe("2026-11-14");
  });

  it("a failed read hides the count and does not break the page (supplementary)", async () => {
    const urls = stub(() => apiError(500, "INTERNAL_ERROR", "boom"));
    const { container } = renderWithProviders(<OwnResetCount range={RANGE} />);
    await waitFor(() => expect(urls.length).toBeGreaterThan(0));
    expect(container).toBeEmptyDOMElement();
  });
});

describe("TeamResetCount and OrgResetCell (MG-D10: per team)", () => {
  it("a team with no row in the response shows nothing (BR10: absent, never zero)", async () => {
    const urls = stub(() => counts());
    const { container } = renderWithProviders(
      <TeamResetCount teamId="other-team" range={RANGE} />,
    );
    await waitFor(() => expect(urls.length).toBeGreaterThan(0));
    expect(container).toBeEmptyDOMElement();
  });

  it("per-member rows are summarised only when the route returned them", async () => {
    stub(() =>
      counts({
        teams: [
          {
            teamId: "t1",
            count: 2,
            amount: 80.25,
            members: [
              { oid: "a", count: 1, amount: 40 },
              { oid: "b", count: 1, amount: 40.25 },
            ],
          },
        ],
      }),
    );
    renderWithProviders(<TeamResetCount teamId="t1" range={RANGE} />);
    expect(await screen.findByText(/Across 2 members/)).toBeVisible();
  });

  it("without per-member rows (before the per-user approval in prod) only the team total shows", async () => {
    stub(() => counts());
    renderWithProviders(<TeamResetCount teamId="t1" range={RANGE} />);
    expect(await screen.findByText(/2 resets, \$80\.25/)).toBeVisible();
    expect(screen.queryByText(/Across/)).toBeNull();
  });

  it("the Organisation cell shows the team's figure, or a dash when the caller sees no row", async () => {
    stub(() => counts());
    renderWithProviders(
      <>
        <p data-testid="has">
          <OrgResetCell teamId="t1" range={RANGE} />
        </p>
        <p data-testid="none">
          <OrgResetCell teamId="t9" range={RANGE} />
        </p>
      </>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("has")).toHaveTextContent("2 resets, $80.25"),
    );
    expect(screen.getByTestId("none")).toHaveTextContent("\u2014");
  });

  // Design System - LiteLLM teams tab, round 3 (unit LP1 review), Budget resets
  // column: "a linked team shows its app team's count ... an unlinked team
  // '\u2014'". A linked team the caller sees no counts row for is absent, never
  // zero: an em dash, never a hyphen and never "No budget resets".
  it("Budget resets column: a linked team with no counts row shows exactly an em dash, not a hyphen, not zero", async () => {
    const urls = stub(() => counts());
    renderWithProviders(
      <p data-testid="cell">
        <OrgResetCell teamId="linked-team-without-row" range={RANGE} />
      </p>,
    );
    await waitFor(() => expect(urls.length).toBeGreaterThan(0));
    await waitFor(() =>
      expect(screen.getByTestId("cell").textContent).toBe("\u2014"),
    );
    expect(screen.getByTestId("cell")).not.toHaveTextContent("-");
    expect(screen.getByTestId("cell")).not.toHaveTextContent(
      /no budget resets/i,
    );
  });
});
