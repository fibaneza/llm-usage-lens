import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { MembersPanel } from "./MembersPanel";

// Sources: Design System - Management pages (*Confirm destructive actions*:
// "reset spend and remove member open an AlertDialog that names the person and
// the effect - 'Sets j.lee's spend to $0.00. Recorded in the audit log.' - with
// Cancel focused first and the destructive confirm button; the bulk reset's
// dialog states the member count ('Resets spend for 12 members to $0.00.
// Recorded in the audit log.')"; *Budget as a bar*: a BudgetBar under each
// member budget and the member toolbar's 'Near or over budget' filter (>= 80%);
// *Bulk reset*: "calls the existing per-member reset route once per member
// (each audited), shown only when `resetMemberSpend` is enabled; no new route
// and no LiteLLM call of the page's own"); LiteLLM spec - Writes
// (resetMemberSpend, removeTeamMember; toggle default off, LD10); slice B2
// brief B2-5, B2-6 (the coordinator approved editing MembersPanel; its props
// stay { teamId, capabilities }). Component tests assert rendering and the
// request made through the stubbed fetch layer (Rule 60.24); the routes' own
// scoping and audit are tested with the routes. The panel's other controls
// (add, limits, disable) are covered in TeamPageContent.test.tsx.
//
// Contract additions to components/litellm/team/MembersPanel.tsx:
//   - each member row renders <BudgetBar spend maxBudget /> (role=progressbar);
//   - a toolbar toggle button "Near or over budget" with aria-pressed, off by
//     default; on, only rows whose spend / maxBudget >= 0.8 remain (members with
//     no budget or no spend figure are excluded);
//   - a button "Reset spend for all members" above the table, rendered only when
//     resetMemberSpend is enabled and the table has members;
//   - the AlertDialog descriptions quoted above (the team name is the team
//     detail's alias).
const ALL_OPS = [
  "addTeamMember",
  "removeTeamMember",
  "setMemberBudget",
  "setMemberLimits",
  "resetMemberSpend",
  "resetMemberBudget",
  "disableMember",
  "enableMember",
];

const member = (
  oid: string,
  name: string,
  spend: number | undefined,
  maxBudget: number | null,
) => ({
  userId: `u-${oid}`,
  oid,
  name,
  email: `${oid}@example.test`,
  spend,
  maxBudget,
  rpmLimit: null,
  tpmLimit: null,
});

const MEMBERS = {
  connected: true,
  candidates: [],
  items: [
    member("ada", "Ada Lovelace", 77.1, 150),
    member("bob", "Bob Builder", 130, 150),
    member("cy", "Cy Poe", 40, 40),
    member("dee", "Dee Nolimit", 10, null),
  ],
};

const detail = (ops: string[]) => ({
  connected: true,
  spendSource: "litellm-team",
  team: {
    alias: "Payments",
    spend: 321.75,
    maxBudget: 500,
    softBudget: 400,
    budgetDuration: "30d",
    models: ["claude-sonnet"],
    rpmLimit: null,
    tpmLimit: null,
  },
  daily: [],
  enabledOperations: ops,
});

type Call = { method: string; path: string };

function stub(
  ops: string[] = ALL_OPS,
  overrides: Record<string, () => Response> = {},
) {
  const calls: Call[] = [];
  const routes: Record<string, () => Response> = {
    "GET /api/litellm/teams/t1": () => apiResponse({ data: detail(ops) }),
    "GET /api/litellm/teams/t1/members": () => apiResponse({ data: MEMBERS }),
    ...overrides,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const method = init?.method ?? "GET";
      calls.push({ method, path });
      const route = routes[`${method} ${path}`];
      if (!route) throw new Error(`unexpected ${method} ${path}`);
      return route();
    }),
  );
  const writes = () => calls.filter((c) => c.method !== "GET");
  return { calls, writes };
}

const user = () => userEvent.setup({ pointerEventsCheck: 0 });
const renderPanel = () =>
  renderWithProviders(
    <MembersPanel teamId="t1" capabilities={{ canRaiseLimits: false }} />,
  );
const resetUrl = (oid: string) =>
  `/api/litellm/teams/t1/members/${oid}/reset-spend`;
const rowOf = (name: string) =>
  screen.getByRole("row", { name: new RegExp(name) });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("MembersPanel budget bars (Budget as a bar)", () => {
  it("shows a BudgetBar with the percentage under each budgeted member, and 'No limit' for one without", async () => {
    stub();
    renderPanel();
    await screen.findByText("Ada Lovelace");

    const ada = within(rowOf("Ada Lovelace")).getByRole("progressbar");
    expect(ada).toHaveAttribute("data-state", "neutral");
    expect(within(rowOf("Ada Lovelace")).getByText("51%")).toBeInTheDocument();
    expect(
      within(rowOf("Bob Builder")).getByRole("progressbar"),
    ).toHaveAttribute("data-state", "warning");
    expect(within(rowOf("Cy Poe")).getByRole("progressbar")).toHaveAttribute(
      "data-state",
      "destructive",
    );
    expect(within(rowOf("Dee Nolimit")).getByText("No limit")).toBeVisible();
    expect(
      within(rowOf("Dee Nolimit")).queryByRole("progressbar"),
    ).not.toBeInTheDocument();
  });
});

describe("MembersPanel 'Near or over budget' filter (>= 80%)", () => {
  it("is off by default (every member listed) and, when on, keeps only members at 80% or more", async () => {
    stub();
    const u = user();
    renderPanel();
    await screen.findByText("Ada Lovelace");
    const toggle = screen.getByRole("button", { name: "Near or over budget" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByRole("row")).toHaveLength(5);

    await u.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
    expect(screen.queryByText("Dee Nolimit")).not.toBeInTheDocument();
    expect(screen.getByText("Bob Builder")).toBeInTheDocument();
    expect(screen.getByText("Cy Poe")).toBeInTheDocument();

    await u.click(toggle);
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });
});

describe("MembersPanel confirmation wording (Confirm destructive actions)", () => {
  it.each([
    [
      "Reset spend for Ada Lovelace",
      "Sets Ada Lovelace's spend to $0.00. Recorded in the audit log.",
    ],
    [
      "Remove Ada Lovelace",
      "Removes Ada Lovelace from Payments. Recorded in the audit log.",
    ],
  ])(
    "%s names the person and the effect, with Cancel focused first and a destructive Confirm",
    async (button, wording) => {
      stub();
      const u = user();
      renderPanel();
      await u.click(await screen.findByRole("button", { name: button }));

      const dialog = await screen.findByRole("alertdialog");
      expect(dialog).toHaveTextContent(wording);
      await waitFor(() =>
        expect(
          within(dialog).getByRole("button", { name: "Cancel" }),
        ).toHaveFocus(),
      );
      expect(
        within(dialog).getByRole("button", { name: "Confirm" }),
      ).toBeInTheDocument();
    },
  );
});

describe("MembersPanel bulk reset (Bulk reset, agent decision B2)", () => {
  it("states the member count, and calls the existing per-member reset route once per member only after Confirm", async () => {
    const reply = () => apiResponse({ data: { ok: true } });
    const api = stub(ALL_OPS, {
      [`POST ${resetUrl("ada")}`]: reply,
      [`POST ${resetUrl("bob")}`]: reply,
      [`POST ${resetUrl("cy")}`]: reply,
      [`POST ${resetUrl("dee")}`]: reply,
    });
    const u = user();
    renderPanel();
    await u.click(
      await screen.findByRole("button", {
        name: "Reset spend for all members",
      }),
    );

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(
      "Resets spend for 4 members to $0.00. Recorded in the audit log.",
    );
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Cancel" }),
      ).toHaveFocus(),
    );
    expect(api.writes()).toEqual([]);

    await u.click(within(dialog).getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(api.writes()).toHaveLength(4));
    expect(
      api
        .writes()
        .map((c) => `${c.method} ${c.path}`)
        .sort(),
    ).toEqual(
      ["ada", "bob", "cy", "dee"].map((oid) => `POST ${resetUrl(oid)}`),
    );
  });

  it("Cancel closes the dialog and calls no route", async () => {
    const api = stub();
    const u = user();
    renderPanel();
    await u.click(
      await screen.findByRole("button", {
        name: "Reset spend for all members",
      }),
    );
    const dialog = await screen.findByRole("alertdialog");

    await u.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(api.writes()).toEqual([]);
  });

  it("is absent when resetMemberSpend is not enabled (absent, not dead)", async () => {
    stub(["addTeamMember", "removeTeamMember"]);
    renderPanel();
    await screen.findByText("Ada Lovelace");

    expect(
      screen.queryByRole("button", { name: "Reset spend for all members" }),
    ).not.toBeInTheDocument();
  });

  it("is absent for a team with no members", async () => {
    stub(ALL_OPS, {
      "GET /api/litellm/teams/t1/members": () =>
        apiResponse({ data: { connected: true, candidates: [], items: [] } }),
    });
    renderPanel();
    await screen.findByText(/no members/i);

    expect(
      screen.queryByRole("button", { name: "Reset spend for all members" }),
    ).not.toBeInTheDocument();
  });

  it("shows the server message in an alert when a member's reset fails", async () => {
    const ok = () => apiResponse({ data: { ok: true } });
    stub(ALL_OPS, {
      [`POST ${resetUrl("ada")}`]: ok,
      [`POST ${resetUrl("bob")}`]: () =>
        apiError(403, "FORBIDDEN", "Reset spend is not enabled"),
      [`POST ${resetUrl("cy")}`]: ok,
      [`POST ${resetUrl("dee")}`]: ok,
    });
    const u = user();
    renderPanel();
    await u.click(
      await screen.findByRole("button", {
        name: "Reset spend for all members",
      }),
    );
    const dialog = await screen.findByRole("alertdialog");

    await u.click(within(dialog).getByRole("button", { name: "Confirm" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Reset spend is not enabled",
    );
  });
});

describe("MembersPanel bulk reset counts only members with an oid (B2 review)", () => {
  const withoutOid = (name: string) => ({
    ...member("x", name, 5, 10),
    oid: undefined,
  });
  const open = async (items: unknown[]) => {
    const ok = () => apiResponse({ data: { ok: true } });
    const api = stub(ALL_OPS, {
      "GET /api/litellm/teams/t1/members": () =>
        apiResponse({ data: { connected: true, candidates: [], items } }),
      [`POST ${resetUrl("ada")}`]: ok,
      [`POST ${resetUrl("bob")}`]: ok,
      [`POST ${resetUrl("cy")}`]: ok,
    });
    const u = user();
    renderPanel();
    await u.click(
      await screen.findByRole("button", {
        name: "Reset spend for all members",
      }),
    );
    return { api, u, dialog: await screen.findByRole("alertdialog") };
  };

  it("counts and resets only members that have an oid; one member reads '1 member'", async () => {
    const { api, u, dialog } = await open([
      member("ada", "Ada Lovelace", 77.1, 150),
      withoutOid("No Oid"),
    ]);
    expect(dialog).toHaveTextContent(
      "Resets spend for 1 member to $0.00. Recorded in the audit log.",
    );
    await u.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes().map((c) => `${c.method} ${c.path}`)).toEqual([
      `POST ${resetUrl("ada")}`,
    ]);
  });

  it("pluralises 3 members and skips the member without an oid", async () => {
    const { api, u, dialog } = await open([
      member("ada", "Ada Lovelace", 77.1, 150),
      withoutOid("No Oid"),
      member("bob", "Bob Builder", 130, 150),
      member("cy", "Cy Poe", 40, 40),
    ]);
    expect(dialog).toHaveTextContent(
      "Resets spend for 3 members to $0.00. Recorded in the audit log.",
    );
    await u.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(api.writes()).toHaveLength(3));
    expect(
      api
        .writes()
        .map((c) => c.path)
        .sort(),
    ).toEqual(["ada", "bob", "cy"].map(resetUrl));
  });
});

// ---- Slice B2b. Sources: Design System - Management pages, *Team page views
// and links* ("Member search on Members: a labelled search box ('Search
// members') filtering the loaded member rows client-side by name or email,
// case-insensitive; 'No members match' when nothing matches. No new request.";
// "G1 - member daily spend: on a linked team, each LiteLLM member row has a
// 'Daily spend' action that opens that person's daily spend for the selected
// range, read through the existing GET /api/litellm/users/[litellmUserId] ...
// LD23 cap applies. No new route"); LiteLLM spec - Gateway allowlist
// (getUserDailySpend; a control for a disabled operation is absent, not dead).
// Contract (MembersPanel.tsx, both the table and the card layout):
//   - a `searchbox` named "Search members" above the rows, shown when the team
//     has members; it ANDs with the "Near or over budget" toggle;
//   - when `getUserDailySpend` is in the team detail's enabledOperations each
//     row has a button, accessible name `Daily spend for <name>` (visible text
//     "Daily spend"); it requests GET /api/litellm/users/<member.userId>?
//     dateFrom=..&dateTo=.. (the URL range, Rule 20.8) and the result shows the
//     member's daily rows in the DailySpend table "Daily spend by UTC day";
//     the action is absent when the operation is not enabled.
describe("MembersPanel member search (Slice B2b)", () => {
  const searchbox = () =>
    screen.getByRole("searchbox", { name: "Search members" });
  const listed = () =>
    ["Ada Lovelace", "Bob Builder", "Cy Poe", "Dee Nolimit"].filter(
      (name) => screen.queryByText(name) !== null,
    );

  it("filters by name, case-insensitively, and shows every member again when cleared", async () => {
    stub();
    const u = user();
    renderPanel();
    await screen.findByText("Ada Lovelace");

    await u.type(searchbox(), "BOB");
    expect(listed()).toEqual(["Bob Builder"]);

    await u.clear(searchbox());
    expect(listed()).toHaveLength(4);
  });

  it("filters by email as well", async () => {
    stub();
    const u = user();
    renderPanel();
    await screen.findByText("Ada Lovelace");

    await u.type(searchbox(), "cy@Example");
    expect(listed()).toEqual(["Cy Poe"]);
  });

  it("says 'No members match' when nothing matches, and lists no row", async () => {
    stub();
    const u = user();
    renderPanel();
    await screen.findByText("Ada Lovelace");

    await u.type(searchbox(), "zzz");
    expect(screen.getByText(/no members match/i)).toBeInTheDocument();
    expect(listed()).toEqual([]);
  });

  it("filters the loaded rows without a new request", async () => {
    const api = stub();
    const u = user();
    renderPanel();
    await screen.findByText("Ada Lovelace");
    const before = api.calls.length;

    await u.type(searchbox(), "ada");

    expect(listed()).toEqual(["Ada Lovelace"]);
    expect(api.calls).toHaveLength(before);
  });

  it("combines with 'Near or over budget': both must match", async () => {
    stub();
    const u = user();
    renderPanel();
    await screen.findByText("Ada Lovelace");

    await u.click(screen.getByRole("button", { name: "Near or over budget" }));
    expect(listed()).toEqual(["Bob Builder", "Cy Poe"]);
    await u.type(searchbox(), "cy");
    expect(listed()).toEqual(["Cy Poe"]);
    await u.clear(searchbox());
    await u.type(searchbox(), "ada");
    expect(screen.getByText(/no members match/i)).toBeInTheDocument();
  });

  describe("in the card layout (below md)", () => {
    const originalWidth = window.innerWidth;
    beforeEach(() => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 375,
      });
    });
    afterEach(() => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalWidth,
      });
    });

    it("filters the cards too", async () => {
      stub();
      const u = user();
      renderPanel();
      const cards = await screen.findByRole("list", { name: "Team members" });

      await u.type(searchbox(), "dee");

      expect(within(cards).getAllByRole("listitem")).toHaveLength(1);
      expect(within(cards).getByText("Dee Nolimit")).toBeInTheDocument();
    });
  });
});

describe("MembersPanel member daily spend (Slice B2b, G1)", () => {
  const DAILY = {
    userId: "u-ada",
    email: "ada@example.test",
    spend: 77.1,
    maxBudget: 150,
    daily: [
      { date: "2026-11-02", spend: 1.25 },
      { date: "2026-11-03", spend: 2.5 },
    ],
    enabledOperations: ["getUserDailySpend"],
  };

  function stubDaily(ops: string[]) {
    const api = stub(ops, {
      "GET /api/litellm/users/u-ada": () => apiResponse({ data: DAILY }),
    });
    const urls: URL[] = [];
    const base = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        urls.push(new URL(String(input), "http://localhost"));
        return base(input, init);
      }),
    );
    return { api, urls };
  }

  it("each row offers 'Daily spend' when getUserDailySpend is enabled", async () => {
    stubDaily([...ALL_OPS, "getUserDailySpend"]);
    renderPanel();
    await screen.findByText("Ada Lovelace");
    for (const name of [
      "Ada Lovelace",
      "Bob Builder",
      "Cy Poe",
      "Dee Nolimit",
    ]) {
      expect(
        screen.getByRole("button", { name: `Daily spend for ${name}` }),
      ).toBeInTheDocument();
    }
  });

  it("the action is absent, not dead, when getUserDailySpend is not enabled", async () => {
    stub();
    renderPanel();
    await screen.findByText("Ada Lovelace");
    expect(screen.queryByRole("button", { name: /daily spend/i })).toBeNull();
  });

  it("opens the member's daily spend for the URL range through the existing user route, and lists the UTC days", async () => {
    const { urls } = stubDaily([...ALL_OPS, "getUserDailySpend"]);
    const u = user();
    renderWithProviders(
      <MembersPanel teamId="t1" capabilities={{ canRaiseLimits: false }} />,
      { searchParams: { dateFrom: "2026-11-01", dateTo: "2026-11-14" } },
    );
    await u.click(
      await screen.findByRole("button", {
        name: "Daily spend for Ada Lovelace",
      }),
    );

    const table = await screen.findByRole("table", {
      name: "Daily spend by UTC day",
    });
    expect(within(table).getByText("2026-11-03")).toBeInTheDocument();
    expect(within(table).getByText("$2.50")).toBeInTheDocument();
    const request = urls.find(
      (url) => url.pathname === "/api/litellm/users/u-ada",
    );
    expect(request?.searchParams.get("dateFrom")).toBe("2026-11-01");
    expect(request?.searchParams.get("dateTo")).toBe("2026-11-14");
  });

  // Review W1: under the Organisation cap (LD23) members carry no `spend`
  // (the panel shows "Hidden until per-user reporting is approved"); the
  // per-user route omits `daily` too, so the action is hidden, not misleading.
  it("hides the Daily spend action when per-user cost is hidden (spend omitted; LD23, review W1)", async () => {
    stub([...ALL_OPS, "getUserDailySpend"], {
      "GET /api/litellm/teams/t1/members": () =>
        apiResponse({
          data: {
            connected: true,
            candidates: [],
            items: [
              member("ada", "Ada Lovelace", undefined, 150),
              member("bob", "Bob Builder", undefined, null),
            ],
          },
        }),
    });
    renderPanel();
    await screen.findByText("Ada Lovelace");
    expect(screen.queryByRole("button", { name: /daily spend/i })).toBeNull();
  });

  it("reads nothing for a member until the action is used", async () => {
    const { urls } = stubDaily([...ALL_OPS, "getUserDailySpend"]);
    renderPanel();
    await screen.findByText("Ada Lovelace");
    expect(
      urls.some((url) => url.pathname.startsWith("/api/litellm/users")),
    ).toBe(false);
  });
});

// Review W4: a row with no available action renders nothing for MemberActions
// (no empty wrapper span), as before the G1 change.
describe("MembersPanel member actions with no operation enabled (review W4)", () => {
  it("leaves the actions cell empty: no empty span", async () => {
    stub([]);
    renderPanel();
    await screen.findByText("Ada Lovelace");
    const row = rowOf("Ada Lovelace");
    const cells = within(row).getAllByRole("cell");
    const lastCell = cells[cells.length - 1];
    expect(lastCell).toBeDefined();
    if (!lastCell) throw new Error("no actions cell");
    expect(lastCell).toBeEmptyDOMElement();
    expect(lastCell.querySelector("span:empty")).toBeNull();
  });
});
