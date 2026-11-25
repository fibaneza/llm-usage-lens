import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError } from "@/test/fakes/api-stubs";
import {
  PROXY_USER,
  PROXY_USER_ID,
  PROXY_USER_UNLINKED,
  stubProxyUser,
} from "@/test/fixtures/proxy-user";
import { renderWithProviders } from "@/test/support/render-providers";

import { ProxyUserTeamsPanel } from "./ProxyUserTeamsPanel";

// Sources: Design System - LiteLLM user page (unit LP2, D-R3-8), T-LP8: "the
// user's LiteLLM teams, each a link to its page"; LiteLLM team page (LP1):
// /dashboard/manage/litellm/teams/[litellmTeamId], the id percent-encoded;
// LiteLLM spec - API routes (`teams: [{ litellmTeamId, alias | null,
// appTeam }]`); Rule 40.4.
// Contract: ProxyUserTeamsPanel({ litellmUserId }) in
// components/litellm/proxy-user/ProxyUserTeamsPanel.tsx: a Panel region
// "LiteLLM teams" reading the shared useProxyUser entry.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const render = () =>
  renderWithProviders(<ProxyUserTeamsPanel litellmUserId={PROXY_USER_ID} />, {
    searchParams: { dateFrom: "2026-11-01", dateTo: "2026-11-30" },
  });
const panel = () => screen.findByRole("region", { name: "LiteLLM teams" });

describe("ProxyUserTeamsPanel (T-LP8)", () => {
  it("T-LP8: each team is a link by its alias to its LiteLLM team page; a team with no alias is named by its id; the id is percent-encoded", async () => {
    stubProxyUser();
    render();
    const region = await panel();
    expect(
      await within(region).findByRole("link", { name: "Payments LLM" }),
    ).toHaveAttribute("href", "/dashboard/manage/litellm/teams/ll-team-1");
    expect(
      within(region).getByRole("link", { name: "ll/team 2" }),
    ).toHaveAttribute("href", "/dashboard/manage/litellm/teams/ll%2Fteam%202");
  });

  it("T-LP8: a user in no LiteLLM team says so", async () => {
    stubProxyUser({ user: PROXY_USER_UNLINKED });
    render();
    const region = await panel();
    expect(
      await within(region).findByText(/not in any litellm team/i),
    ).toBeVisible();
    expect(within(region).queryAllByRole("link")).toHaveLength(0);
  });

  it("T-LP10 shape: an answer with no `teams` (a Lead's) renders no list and no link, and no error", async () => {
    const calls = stubProxyUser({
      user: {
        userId: PROXY_USER.userId,
        email: PROXY_USER.email,
        enabledOperations: [],
      },
    });
    render();
    const region = await panel();
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(within(region).queryAllByRole("link")).toHaveLength(0);
    expect(within(region).queryByRole("alert")).toBeNull();
  });

  it("Rule 40.4: a failed read shows the panel's own error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubProxyUser({ user: () => apiError(500, "INTERNAL_ERROR", "boom") });
    render();
    expect(
      await screen.findByText("Couldn't load LiteLLM teams."),
    ).toBeInTheDocument();
  });
});
