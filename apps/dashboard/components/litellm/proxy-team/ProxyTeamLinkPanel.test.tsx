import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError } from "@/test/fakes/api-stubs";
import {
  PROXY_TEAM,
  PROXY_TEAM_ID,
  PROXY_TEAM_UNLINKED,
  stubProxyTeam,
} from "@/test/fixtures/proxy-team";
import { renderWithProviders } from "@/test/support/render-providers";

import { ProxyTeamLinkPanel } from "./ProxyTeamLinkPanel";

// Sources: Design System - LiteLLM team page (unit LP1, D-R3-7), T-LP4: "the
// linked app team with its lead names, or 'Not linked to a dashboard team'";
// LiteLLM spec - API routes, GET /api/litellm/proxy-teams/[litellmTeamId]
// (`linkedAppTeam: { teamId, name, leads: [{ name }] } | null`).
//
// Contract (new module components/litellm/proxy-team/ProxyTeamLinkPanel.tsx):
//   ProxyTeamLinkPanel({ litellmTeamId }: { litellmTeamId: string }), a Panel
//   (region) titled "Linked dashboard team" reading the team through the same
//   useProxyTeam hook as the summary.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const render = () =>
  renderWithProviders(<ProxyTeamLinkPanel litellmTeamId={PROXY_TEAM_ID} />);
const panel = () =>
  screen.findByRole("region", { name: "Linked dashboard team" });

describe("ProxyTeamLinkPanel (T-LP4)", () => {
  it("T-LP4: a linked team shows the dashboard team's name and each lead's name", async () => {
    stubProxyTeam({ team: PROXY_TEAM });
    render();
    const region = await panel();
    expect(await within(region).findByText("Payments")).toBeInTheDocument();
    expect(within(region).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(region).getByText("Grace Hopper")).toBeInTheDocument();
    expect(within(region).queryByText(/not linked/i)).toBeNull();
  });

  it("T-LP4: a linked team without a lead still shows the team and says nothing is broken", async () => {
    stubProxyTeam({
      team: {
        ...PROXY_TEAM,
        linkedAppTeam: { teamId: "payments", name: "Payments", leads: [] },
      },
    });
    render();
    const region = await panel();
    expect(await within(region).findByText("Payments")).toBeInTheDocument();
    expect(within(region).queryByText(/not linked/i)).toBeNull();
    expect(within(region).queryByRole("alert")).toBeNull();
  });

  it("T-LP4: an unlinked team says 'Not linked to a dashboard team'", async () => {
    stubProxyTeam({ team: PROXY_TEAM_UNLINKED });
    render();
    const region = await panel();
    expect(
      await within(region).findByText("Not linked to a dashboard team"),
    ).toBeInTheDocument();
    expect(within(region).queryByText("Ada Lovelace")).toBeNull();
  });

  it("Rule 40.4: a failed read shows the panel's own error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubProxyTeam({ team: () => apiError(500, "INTERNAL_ERROR", "boom") });
    render();
    expect(
      await screen.findByText("Couldn't load Linked dashboard team."),
    ).toBeInTheDocument();
  });
});
