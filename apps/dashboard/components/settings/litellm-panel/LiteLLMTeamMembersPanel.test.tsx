import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { LiteLLMTeamLinksSection } from "./LiteLLMTeamLinksSection";
import { LiteLLMTeamMembersPanel } from "./LiteLLMTeamMembersPanel";

// Sources: Design System - "Reset any LiteLLM user" (unit RS2, D-RS7): on
// Management -> LiteLLM -> LiteLLM teams a team row opens its members, each with
// Reset spend and Reset budget for Admin and org-admin; the auditor sees the list
// and no button; LiteLLM spec - API routes (GET
// /api/litellm/proxy-teams/[litellmTeamId]/members, D-RS6, T-RS8; the two POST
// member routes, D-RS4), D-RS2 (a control whose operation is off is absent),
// T-RS7. Route authorization and scoping are asserted with the routes.
//
// Contract (new module components/settings/litellm-panel/LiteLLMTeamMembersPanel.tsx):
//   LiteLLMTeamMembersPanel({ litellmTeamId, teamName, canReset }:
//     { litellmTeamId: string; teamName: string; canReset: boolean })
//   GETs /api/litellm/proxy-teams/${litellmTeamId}/members ->
//   { configured?: false, enabledOperations: string[], items: [{ userId,
//     email, spend?, maxBudget?: number|null, person: { oid, name }|null }] }
//   (spec row, agent decision 2026-11-23; also carries litellmTeamId)
//   and renders a table named `Members of ${teamName}` (row = member; shows
//   spend, budget, the app person or "Not linked"). With canReset, per row and
//   per enabled operation (resetMemberSpend / resetMemberBudget): a button
//   `Reset spend for ${label}` / `Reset budget for ${label}` (label = person.name,
//   else email) that opens an AlertDialog (Cancel, Confirm) and on
//   Confirm POSTs /api/litellm/proxy-teams/${litellmTeamId}/members/${userId}/reset-spend
//   or /reset-budget (no body).
// LiteLLMTeamLinksSection gains a table named "LiteLLM teams" with one row per
// `litellmTeams` entry and a button `Members of ${alias}` that shows the panel.
afterEach(() => vi.unstubAllGlobals());

type Call = { method: string; path: string };

const MEMBERS = {
  litellmTeamId: "ll-111",
  enabledOperations: ["resetMemberSpend", "resetMemberBudget"],
  items: [
    {
      userId: "ll-ada",
      email: "ada@example.test",
      spend: 6,
      maxBudget: 10,
      person: { oid: "oid-ada", name: "Ada Lovelace" },
    },
    {
      userId: "ll-zed",
      email: "zed@example.test",
      spend: 2,
      maxBudget: null,
      person: null,
    },
  ],
};

function stub(members: unknown = MEMBERS, post?: () => Response) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, path });
      if (path === "/api/litellm/team-links") {
        return Promise.resolve(
          apiResponse({
            data: {
              items: [],
              configured: true,
              litellmTeams: [
                { litellmTeamId: "ll-111", alias: "Alpha" },
                { litellmTeamId: "ll-222", alias: "Beta" },
              ],
            },
          }),
        );
      }
      if (method === "POST") {
        return Promise.resolve(post?.() ?? apiResponse({ data: { ok: true } }));
      }
      if (path === "/api/litellm/proxy-teams/ll-111/members") {
        return Promise.resolve(
          members instanceof Object && "status" in members
            ? (members as Response)
            : apiResponse({ data: members }),
        );
      }
      return Promise.resolve(apiError(404, "NOT_FOUND", "unexpected " + path));
    }),
  );
  return calls;
}
const writes = (calls: Call[]) => calls.filter((c) => c.method === "POST");
const rowOf = (text: string) =>
  screen.getByRole("row", { name: new RegExp(text) });
const panel = (canReset: boolean) =>
  renderWithProviders(
    <LiteLLMTeamMembersPanel
      litellmTeamId="ll-111"
      teamName="Alpha"
      canReset={canReset}
    />,
  );

describe("LiteLLMTeamMembersPanel (RS2, T-RS7)", () => {
  it("lists each member with spend, budget and the app person or none (D-RS6)", async () => {
    stub();
    panel(true);
    await screen.findByRole("table", { name: "Members of Alpha" });
    expect(rowOf("ada@example.test")).toHaveTextContent("$6.00");
    expect(rowOf("ada@example.test")).toHaveTextContent("Ada Lovelace");
    expect(rowOf("zed@example.test")).toHaveTextContent("No budget");
    expect(rowOf("zed@example.test")).not.toHaveTextContent("Ada Lovelace");
  });

  it("admin and org-admin (canReset): each member has Reset spend and Reset budget (D-RS7)", async () => {
    stub();
    panel(true);
    await screen.findByRole("table", { name: "Members of Alpha" });
    for (const [row, label] of [
      ["ada@example.test", "Ada Lovelace"],
      ["zed@example.test", "zed@example.test"],
    ] as const) {
      expect(
        within(rowOf(row)).getByRole("button", {
          name: `Reset spend for ${label}`,
        }),
      ).toBeEnabled();
      expect(
        within(rowOf(row)).getByRole("button", {
          name: `Reset budget for ${label}`,
        }),
      ).toBeEnabled();
    }
  });

  it("the auditor (canReset false) sees the list and no button (D-RS7, T-RS7)", async () => {
    stub();
    panel(false);
    await screen.findByRole("table", { name: "Members of Alpha" });
    expect(screen.queryByRole("button", { name: /^Reset/ })).toBeNull();
  });

  it.each([
    ["resetMemberSpend", "Reset spend"],
    ["resetMemberBudget", "Reset budget"],
  ])(
    "while %s is off there is no '%s' button (D-RS2, T-RS7)",
    async (op, text) => {
      stub({
        ...MEMBERS,
        enabledOperations: MEMBERS.enabledOperations.filter((o) => o !== op),
      });
      panel(true);
      await screen.findByRole("table", { name: "Members of Alpha" });
      expect(
        screen.queryByRole("button", { name: new RegExp(`^${text}`) }),
      ).toBeNull();
    },
  );

  it.each([
    ["Reset spend", "reset-spend"],
    ["Reset budget", "reset-budget"],
  ])(
    "%s confirms in an AlertDialog and POSTs the LiteLLM-id member route, no body (D-RS4)",
    async (text, action) => {
      const calls = stub();
      const user = userEvent.setup();
      panel(true);
      await screen.findByRole("table", { name: "Members of Alpha" });
      await user.click(
        within(rowOf("zed@example.test")).getByRole("button", {
          name: `${text} for zed@example.test`,
        }),
      );
      const dialog = await screen.findByRole("alertdialog");
      expect(writes(calls)).toEqual([]);
      await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
      await waitFor(() => expect(writes(calls)).toHaveLength(1));
      expect(writes(calls)[0]?.path).toBe(
        `/api/litellm/proxy-teams/ll-111/members/ll-zed/${action}`,
      );
    },
  );

  // R4 (review r1): the Settings dialog carries the D-RS9 text.
  it("the Reset spend confirm says usage history, cost data and the audit log do not change (D-RS9, R4)", async () => {
    const text = "Reset spend";
    stub();
    const user = userEvent.setup();
    panel(true);
    await screen.findByRole("table", { name: "Members of Alpha" });
    await user.click(
      within(rowOf("zed@example.test")).getByRole("button", {
        name: `${text} for zed@example.test`,
      }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(
      /usage history, cost data and the audit log do not change/i,
    );
  });

  it("a refused reset shows the server's message (D-RS5 409)", async () => {
    stub(MEMBERS, () =>
      apiError(409, "PRIVILEGED_TARGET", "This LiteLLM user cannot be reset"),
    );
    const user = userEvent.setup();
    panel(true);
    await screen.findByRole("table", { name: "Members of Alpha" });
    await user.click(
      screen.getByRole("button", { name: "Reset spend for zed@example.test" }),
    );
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Confirm",
      }),
    );
    expect(
      await screen.findByText(/This LiteLLM user cannot be reset/),
    ).toBeInTheDocument();
  });

  it("an empty team says so (States)", async () => {
    stub({ ...MEMBERS, items: [] });
    panel(true);
    expect(await screen.findByText(/no members/i)).toBeInTheDocument();
  });
});

describe("LiteLLMTeamLinksSection LiteLLM teams table (RS2, T-RS7)", () => {
  it.each([
    ["admin or org-admin (canEdit)", true, true],
    ["the auditor (read-only)", false, false],
  ])(
    "a team row opens its members; %s: reset buttons %s (D-RS7)",
    async (_n, canEdit, buttons) => {
      const calls = stub();
      const user = userEvent.setup();
      renderWithProviders(<LiteLLMTeamLinksSection canEdit={canEdit} />);
      const table = await screen.findByRole("table", { name: "LiteLLM teams" });
      expect(within(table).getByText("Beta")).toBeInTheDocument();
      await user.click(
        within(table).getByRole("button", { name: "Members of Alpha" }),
      );
      await screen.findByRole("table", { name: "Members of Alpha" });
      expect(calls.map((c) => c.path)).toContain(
        "/api/litellm/proxy-teams/ll-111/members",
      );
      expect(
        screen.queryAllByRole("button", { name: /^Reset spend for/ }).length >
          0,
      ).toBe(buttons);
    },
  );
});
