import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";
import {
  HIDDEN,
  ME_ADMIN,
  stubRoutes,
  teamRow,
  teamsShow,
} from "@/test/fakes/combined-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { CombinedTeamsPanel } from "./CombinedTeamsPanel";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage
// (L6)": Where each figure appears ("Teams: a separate 'Combined with
// LiteLLM' panel under the Bedrock table (team, direct Bedrock, via LiteLLM,
// combined; 'not linked' for unlinked teams); the Bedrock table and its CSV
// stay Bedrock-only (provenance)"), Computation -> Team T (unlinked: combined
// null, reason "not-linked"; a gateway-account team has bedrockDirect 0 and
// its slice shown), States (LD37, warn, hidden, 503); Design System
// Responsive Tables (a real table at md and up).
// Module under test: `components/litellm/combined/CombinedTeamsPanel.tsx`
//   <CombinedTeamsPanel range={{ dateFrom, dateTo }} />   (client)
// GET /api/litellm/combined/teams?dateFrom=&dateTo=. Contract:
//   loaded: region "Combined with LiteLLM" (h2) holding a table named
//   "Combined with LiteLLM" with column headers Team, Direct Bedrock,
//   Via LiteLLM, Combined and one row per team; a linked row shows $ values
//   (2 dp); an unlinked row (reason "not-linked") shows "not linked" in its
//   Combined cell and "—" in Via LiteLLM; a team with gatewaySlice > 0 shows
//   "Billed via LiteLLM $x" in its Team cell; warn -> the status warning
//   above the table; LD37 -> "LiteLLM not configured" and no table; hidden ->
//   nothing; 503 -> "Couldn't load combined with litellm."
const RANGE = { dateFrom: "2026-01-11", dateTo: "2026-01-20" };
const PATH = "/api/litellm/combined/teams";

afterEach(() => {
  vi.unstubAllGlobals();
});

const ROWS = [
  teamRow(),
  teamRow({
    teamId: "team-ledger",
    teamName: "Ledger",
    bedrockDirect: 4,
    litellm: null,
    combined: null,
    reason: "not-linked",
  }),
  teamRow({
    teamId: "team-gw",
    teamName: "Gateway team",
    bedrockDirect: 0,
    gatewaySlice: 2.5,
    litellm: 2.4,
    combined: 2.4,
  }),
];

describe("CombinedTeamsPanel", () => {
  it("lists every team with direct Bedrock, via LiteLLM and combined, and 'not linked' for an unlinked one", async () => {
    const { urls } = stubRoutes({ [PATH]: teamsShow(ROWS) });
    renderWithProviders(<CombinedTeamsPanel range={RANGE} />);
    const region = await screen.findByRole("region", {
      name: "Combined with LiteLLM",
    });
    expect(urls[0]?.searchParams.get("dateFrom")).toBe("2026-01-11");
    const table = within(region).getByRole("table", {
      name: "Combined with LiteLLM",
    });
    for (const name of ["Team", "Direct Bedrock", "Via LiteLLM", "Combined"]) {
      expect(
        within(table).getByRole("columnheader", { name }),
      ).toBeInTheDocument();
    }
    const pay = within(table).getByRole("row", { name: /Payments/ });
    expect(pay).toHaveTextContent("$8.00");
    expect(pay).toHaveTextContent("$3.50");
    expect(pay).toHaveTextContent("$11.50");
    const ledger = within(table).getByRole("row", { name: /Ledger/ });
    expect(ledger).toHaveTextContent("$4.00");
    expect(ledger).toHaveTextContent("not linked");
    expect(ledger).not.toHaveTextContent("$0.00");
    const gw = within(table).getByRole("row", { name: /Gateway team/ });
    expect(gw).toHaveTextContent("Billed via LiteLLM $2.50");
  });

  it("warn: the exact warning above the table", async () => {
    stubRoutes({
      [PATH]: teamsShow(ROWS, { visibility: "warn", gatewayConfigured: false }),
      "/api/me": ME_ADMIN,
    });
    renderWithProviders(<CombinedTeamsPanel range={RANGE} />);
    await screen.findByRole("table", { name: "Combined with LiteLLM" });
    expect(screen.getByRole("status")).toHaveTextContent(
      "gateway not configured — totals may double count",
    );
  });

  it("LD37 LiteLLM not configured: says so and shows no combined column", async () => {
    stubRoutes({ [PATH]: teamsShow(ROWS, { configured: false }) });
    renderWithProviders(<CombinedTeamsPanel range={RANGE} />);
    const region = await screen.findByRole("region", {
      name: "Combined with LiteLLM",
    });
    expect(
      within(region).getByText("LiteLLM not configured"),
    ).toBeInTheDocument();
    expect(within(region).queryByRole("table")).toBeNull();
  });

  it("hidden: renders nothing once loaded", async () => {
    stubRoutes({ [PATH]: HIDDEN });
    const view = renderWithProviders(<CombinedTeamsPanel range={RANGE} />);
    await waitFor(() =>
      expect(view.container.querySelector('[data-slot="skeleton"]')).toBeNull(),
    );
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("a 503 is this panel's error state only", async () => {
    stubRoutes({
      [PATH]: () =>
        apiResponse(
          { error: { code: "LITELLM_UNAVAILABLE", message: "unavailable" } },
          503,
        ),
    });
    renderWithProviders(<CombinedTeamsPanel range={RANGE} />);
    expect(
      await screen.findByText("Couldn't load combined with litellm."),
    ).toBeInTheDocument();
  });
});
