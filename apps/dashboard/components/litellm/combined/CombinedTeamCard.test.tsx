import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";
import {
  HIDDEN,
  ME_ADMIN,
  stubRoutes,
  teamShow,
} from "@/test/fakes/combined-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { CombinedTeamCard } from "./CombinedTeamCard";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage
// (L6)": Where each figure appears ("Team Detail: a combined card for a
// linked team"), Computation -> Team T (unlinked: combined null, reason
// "not-linked"; gateway-account team: bedrockDirect 0, slice shown), States,
// Routes (GET /api/litellm/combined/teams/[teamId]).
// Module under test: `components/litellm/combined/CombinedTeamCard.tsx`
//   <CombinedTeamCard teamId range={{ dateFrom, dateTo }} />   (client)
// Contract: region "Combined usage" with the figure; a not-linked team
// renders nothing (no card for an unlinked team); a team with gatewaySlice > 0
// shows "Billed via LiteLLM $x"; warn -> the status warning; hidden -> nothing;
// LD37 -> "LiteLLM not configured" and no combined figure; the teamId is
// URL-encoded in the path; 503 -> "Couldn't load combined usage."
const RANGE = { dateFrom: "2026-01-11", dateTo: "2026-01-20" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CombinedTeamCard", () => {
  it("linked: the team's combined figure with its parts, requested for the id and range", async () => {
    const { urls } = stubRoutes({
      "/api/litellm/combined/teams/team-pay": teamShow(),
    });
    renderWithProviders(<CombinedTeamCard teamId="team-pay" range={RANGE} />);
    const region = await screen.findByRole("region", {
      name: "Combined usage",
    });
    expect(within(region).getByTestId("combined-total")).toHaveTextContent(
      "$11.50",
    );
    expect(
      within(region).getByText("Direct Bedrock $8.00 · Via LiteLLM $3.50"),
    ).toBeInTheDocument();
    expect(urls[0]?.searchParams.get("dateTo")).toBe("2026-01-20");
    expect(within(region).queryByText(/Billed via LiteLLM/)).toBeNull();
  });

  it("a gateway-account team shows its slice as Billed via LiteLLM", async () => {
    stubRoutes({
      "/api/litellm/combined/teams/team-pay": teamShow({
        bedrockDirect: 0,
        gatewaySlice: 2.5,
        litellm: 2.4,
        combined: 2.4,
      }),
    });
    renderWithProviders(<CombinedTeamCard teamId="team-pay" range={RANGE} />);
    expect(
      await screen.findByText("Billed via LiteLLM $2.50"),
    ).toBeInTheDocument();
  });

  it("an unlinked team gets no card", async () => {
    stubRoutes({
      "/api/litellm/combined/teams/team-pay": teamShow({
        litellm: null,
        combined: null,
        reason: "not-linked",
      }),
    });
    const view = renderWithProviders(
      <CombinedTeamCard teamId="team-pay" range={RANGE} />,
    );
    await waitFor(() =>
      expect(view.container.querySelector('[data-slot="skeleton"]')).toBeNull(),
    );
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByTestId("combined-total")).toBeNull();
  });

  it("warn shows the warning; hidden shows nothing", async () => {
    stubRoutes({
      "/api/litellm/combined/teams/team-pay": teamShow({
        visibility: "warn",
        gatewayConfigured: false,
      }),
      "/api/me": ME_ADMIN,
    });
    const warn = renderWithProviders(
      <CombinedTeamCard teamId="team-pay" range={RANGE} />,
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "gateway not configured — totals may double count",
    );
    warn.unmount();

    stubRoutes({ "/api/litellm/combined/teams/team-pay": HIDDEN });
    const hidden = renderWithProviders(
      <CombinedTeamCard teamId="team-pay" range={RANGE} />,
    );
    await waitFor(() =>
      expect(
        hidden.container.querySelector('[data-slot="skeleton"]'),
      ).toBeNull(),
    );
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("LD37: says LiteLLM is not configured and shows no combined figure", async () => {
    stubRoutes({
      "/api/litellm/combined/teams/team-pay": teamShow({
        configured: false,
        litellm: null,
        combined: null,
      }),
    });
    renderWithProviders(<CombinedTeamCard teamId="team-pay" range={RANGE} />);
    expect(
      await screen.findByText("LiteLLM not configured"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("combined-total")).toBeNull();
  });

  it("a 503 is this card's error state only", async () => {
    stubRoutes({
      "/api/litellm/combined/teams/team-pay": () =>
        apiResponse(
          { error: { code: "LITELLM_UNAVAILABLE", message: "unavailable" } },
          503,
        ),
    });
    renderWithProviders(<CombinedTeamCard teamId="team-pay" range={RANGE} />);
    expect(
      await screen.findByText("Couldn't load combined usage."),
    ).toBeInTheDocument();
  });
});
