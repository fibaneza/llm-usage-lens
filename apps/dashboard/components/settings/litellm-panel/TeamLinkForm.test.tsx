import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { TeamLinkForm } from "./TeamLinkForm";

// Source: Design System - Management improvements, D4a (2026-11-17; item 15):
// "Team" lists every app team by name with its id as secondary text, "LiteLLM
// team" lists every LiteLLM team by alias with its team_id; a team that already
// has a link shows "linked" and cannot be chosen; no free-text id field; an
// unreadable LiteLLM list says "LiteLLM teams could not be loaded" and offers
// no fallback. LiteLLM spec MI-D4a, LT-MI3 (the server still validates and
// answers 409 on a duplicate: the form shows its message). PUT body per
// docs/specs/2026-11-10-litellm.md - API routes: { litellmTeamId, version: null }.
afterEach(() => {
  vi.unstubAllGlobals();
});

const LINKS = [
  {
    teamId: "payments",
    litellmTeamId: "ll-111",
    version: 1,
    updatedAt: "2026-11-01T00:00:00Z",
  },
];
const APP_TEAMS = {
  state: "ready" as const,
  teams: [
    { id: "growth", name: "Growth" },
    { id: "payments", name: "Payments" },
    { id: "search", name: "Search" },
  ],
};
const LITELLM_TEAMS = {
  state: "ready" as const,
  teams: [
    { litellmTeamId: "ll-111", alias: "Alpha" },
    { litellmTeamId: "ll-222", alias: "Beta" },
  ],
};

function stubPut(response?: Response) {
  const fetchFn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    void input;
    if (init?.method === "PUT") {
      return Promise.resolve(
        response ??
          apiResponse({
            data: {
              teamId: "growth",
              litellmTeamId: "ll-222",
              version: 1,
              updatedAt: "2026-11-02T00:00:00Z",
            },
          }),
      );
    }
    return Promise.resolve(apiResponse({ data: { items: LINKS } }));
  });
  vi.stubGlobal("fetch", fetchFn);
  return fetchFn;
}

const writes = (f: ReturnType<typeof stubPut>) =>
  f.mock.calls.filter(([, init]) => init?.method === "PUT");

async function choose(label: string, option: RegExp) {
  await userEvent.click(screen.getByRole("combobox", { name: label }));
  await userEvent.click(screen.getByRole("option", { name: option }));
}

describe("TeamLinkForm (D4a, LT-MI3)", () => {
  it("offers every app team by name with its id, and every LiteLLM team by alias with its team_id; linked ones are marked and not selectable", async () => {
    renderWithProviders(
      <TeamLinkForm
        links={LINKS}
        appTeams={APP_TEAMS}
        litellmTeams={LITELLM_TEAMS}
      />,
    );
    await userEvent.click(screen.getByRole("combobox", { name: "Team" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      expect.stringContaining("Growth"),
      expect.stringContaining("Payments"),
      expect.stringContaining("Search"),
    ]);
    const growth = screen.getByRole("option", { name: /Growth/ });
    expect(within(growth).getByText("growth")).toBeInTheDocument();
    expect(growth).not.toHaveAttribute("aria-disabled", "true");
    const payments = screen.getByRole("option", { name: /Payments/ });
    expect(payments).toHaveTextContent("linked");
    expect(payments).toHaveAttribute("aria-disabled", "true");
    await userEvent.keyboard("{Escape}");

    await userEvent.click(
      screen.getByRole("combobox", { name: "LiteLLM team" }),
    );
    expect(screen.getAllByRole("option")).toHaveLength(2);
    const alpha = screen.getByRole("option", { name: /Alpha/ });
    expect(within(alpha).getByText("ll-111")).toBeInTheDocument();
    expect(alpha).toHaveTextContent("linked");
    expect(alpha).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("option", { name: /Beta/ })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("has no text input that takes an id: nothing editable until a search box opens, and that is a search", async () => {
    renderWithProviders(
      <TeamLinkForm
        links={LINKS}
        appTeams={APP_TEAMS}
        litellmTeams={LITELLM_TEAMS}
      />,
    );
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryByLabelText(/team id/i)).toBeNull();
    expect(document.querySelectorAll("input")).toHaveLength(0);
    await userEvent.click(screen.getByRole("combobox", { name: "Team" }));
    expect(
      [...document.querySelectorAll("input")].map((i) =>
        i.getAttribute("aria-label"),
      ),
    ).toEqual(["Search Team"]);
  });

  it("Link stays disabled until both teams are chosen, then sends PUT with the chosen ids and version null", async () => {
    const f = stubPut();
    renderWithProviders(
      <TeamLinkForm
        links={LINKS}
        appTeams={APP_TEAMS}
        litellmTeams={LITELLM_TEAMS}
      />,
    );
    const button = screen.getByRole("button", { name: /^link$/i });
    expect(button).toBeDisabled();
    await choose("Team", /Growth/);
    expect(button).toBeDisabled();
    await choose("LiteLLM team", /Beta/);
    expect(button).toBeEnabled();
    await userEvent.click(button);
    await vi.waitFor(() => expect(writes(f)).toHaveLength(1));
    const put = writes(f).at(0);
    expect(String(put?.[0])).toBe("/api/litellm/team-links/growth");
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({
      litellmTeamId: "ll-222",
      version: null,
    });
  });

  it("choosing a linked option does nothing: Link stays disabled and nothing is sent", async () => {
    const f = stubPut();
    renderWithProviders(
      <TeamLinkForm
        links={LINKS}
        appTeams={APP_TEAMS}
        litellmTeams={LITELLM_TEAMS}
      />,
    );
    await userEvent.click(screen.getByRole("combobox", { name: "Team" }));
    await userEvent.click(screen.getByRole("option", { name: /Payments/ }));
    await choose("LiteLLM team", /Alpha/);
    expect(screen.getByRole("button", { name: /^link$/i })).toBeDisabled();
    expect(writes(f)).toHaveLength(0);
  });

  it("shows the server's refusal inline (a duplicate is 409, the picker is never the control)", async () => {
    stubPut(
      apiResponse(
        { error: { code: "CONFLICT", message: "Already linked elsewhere" } },
        409,
      ),
    );
    renderWithProviders(
      <TeamLinkForm
        links={LINKS}
        appTeams={APP_TEAMS}
        litellmTeams={LITELLM_TEAMS}
      />,
    );
    await choose("Team", /Search/);
    await choose("LiteLLM team", /Beta/);
    await userEvent.click(screen.getByRole("button", { name: /^link$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Already linked elsewhere",
    );
  });

  it("an unreadable LiteLLM list says so and offers no LiteLLM picker and no free-text fallback", async () => {
    renderWithProviders(
      <TeamLinkForm
        links={LINKS}
        appTeams={APP_TEAMS}
        litellmTeams={{ state: "unavailable" }}
      />,
    );
    expect(
      screen.getByText("LiteLLM teams could not be loaded"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "LiteLLM team" })).toBeNull();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(document.querySelectorAll("input")).toHaveLength(0);
    await choose("Team", /Growth/);
    expect(screen.getByRole("button", { name: /^link$/i })).toBeDisabled();
  });

  it("LiteLLM not configured (LD37) says LiteLLM is not connected, with no LiteLLM picker and no fallback", () => {
    renderWithProviders(
      <TeamLinkForm
        links={[]}
        appTeams={APP_TEAMS}
        litellmTeams={{ state: "not-configured" }}
      />,
    );
    expect(
      screen.getByText(/litellm.*not (connected|configured)/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "LiteLLM team" })).toBeNull();
    expect(document.querySelectorAll("input")).toHaveLength(0);
  });
});
