import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { TeamLinkNewTeamForm } from "./TeamLinkNewTeamForm";

// Source: Design System - Management improvements, D2/D4a (2026-11-17): "New
// LiteLLM team" on the LiteLLM teams tab; the app team is chosen from the same
// kind of picker (a linked team is shown and not selectable), the only typed
// value is the new team's alias. LiteLLM spec - API routes: POST
// /api/litellm/teams ({ teamId, teamAlias }; createTeam + link, Admin only,
// LD24 - the route answers 403 to anyone else, the section renders the form for
// internal-admin only).
afterEach(() => {
  vi.unstubAllGlobals();
});

const APP_TEAMS = {
  state: "ready" as const,
  teams: [
    { id: "growth", name: "Growth" },
    { id: "payments", name: "Payments" },
  ],
};

describe("TeamLinkNewTeamForm", () => {
  it("posts the chosen app team and the alias to POST /api/litellm/teams", async () => {
    const f = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        init?.method === "POST"
          ? apiResponse({ data: { teamId: "growth", litellmTeamId: "ll-9" } })
          : apiResponse({ data: { items: [] } }),
      ),
    );
    vi.stubGlobal("fetch", f);
    renderWithProviders(
      <TeamLinkNewTeamForm links={[]} appTeams={APP_TEAMS} />,
    );
    const form = screen.getByRole("form", { name: "New LiteLLM team" });
    const submit = screen.getByRole("button", { name: "New LiteLLM team" });
    expect(submit).toBeDisabled();
    await userEvent.click(
      screen.getByRole("combobox", { name: "Team to create it for" }),
    );
    await userEvent.click(screen.getByRole("option", { name: /Growth/ }));
    await userEvent.type(
      screen.getByLabelText("LiteLLM team alias"),
      "Growth team",
    );
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    await vi.waitFor(() =>
      expect(f.mock.calls.some(([, i]) => i?.method === "POST")).toBe(true),
    );
    const post = f.mock.calls.find(([, i]) => i?.method === "POST");
    expect(String(post?.[0])).toBe("/api/litellm/teams");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      teamId: "growth",
      teamAlias: "Growth team",
    });
    expect(form).toBeInTheDocument();
  });

  it("a team that already has a link is shown as linked and cannot be chosen", async () => {
    renderWithProviders(
      <TeamLinkNewTeamForm
        links={[{ teamId: "payments" }]}
        appTeams={APP_TEAMS}
      />,
    );
    await userEvent.click(
      screen.getByRole("combobox", { name: "Team to create it for" }),
    );
    const payments = screen.getByRole("option", { name: /Payments/ });
    expect(payments).toHaveTextContent("linked");
    expect(payments).toHaveAttribute("aria-disabled", "true");
  });

  it("has no field that takes a team id: the alias is the only typed value", async () => {
    renderWithProviders(
      <TeamLinkNewTeamForm links={[]} appTeams={APP_TEAMS} />,
    );
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByRole("textbox")).toHaveAccessibleName(
      "LiteLLM team alias",
    );
  });

  // Source: Rule 60.17 (no silent failures) and LiteLLM spec MI-D4a (an
  // unreadable list says so and offers no free-text fallback). Same message and
  // state as TeamLinkForm when its app-team list cannot be read.
  it("an unreadable app-team list says 'Teams could not be loaded', offers no team choice and no free-text fallback", async () => {
    renderWithProviders(
      <TeamLinkNewTeamForm links={[]} appTeams={{ state: "unavailable" }} />,
    );
    expect(screen.getByText("Teams could not be loaded")).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Team to create it for" }),
    ).toBeNull();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByRole("textbox")).toHaveAccessibleName(
      "LiteLLM team alias",
    );
    await userEvent.type(screen.getByRole("textbox"), "Growth team");
    expect(
      screen.getByRole("button", { name: "New LiteLLM team" }),
    ).toBeDisabled();
  });
});
