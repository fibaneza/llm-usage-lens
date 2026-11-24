import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { TeamListTable } from "./TeamListTable";

// Sources: Design System - Management pages, Team, "List, then the team (unit
// TM1; D-TM1-D-TM4)": the list is a table with the columns name, department,
// members and linked LiteLLM team ("Not linked" when none); a row's name links
// to /dashboard/manage/team/[teamId]; New team stays on the list page (D-TM4)
// and, on success, opens the new team's page (agent decision, 2026-11-23);
// the list shows only the rows it is given: scope filtering is the page's
// job, see page.test.tsx. Rule 60.24a: one layer per behaviour.
//
// Contract for the developer (components/manage/TeamListTable.tsx, "use client"):
//   props { rows: TeamListRow[]; canCreateTeam: boolean;
//           scopeLabel?: string | null }
//   TeamListRow = { teamId: string; teamName: string; departmentId: string;
//     departmentName: string;
//     memberCount: number; litellmTeamId: string | null }
//   Renders a table; the name cell is a link (accessible name = team name).
//   New team = <TeamCreateDialog/> (button "New team"); onCreated pushes
//   `/dashboard/manage/team/<teamId>` with next/navigation's router.
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/dashboard/manage/team",
  useSearchParams: () => new URLSearchParams(),
}));

const ROWS = [
  {
    teamId: "t1",
    teamName: "Payments",
    departmentId: "dept-eng",
    departmentName: "Engineering",
    memberCount: 4,
    litellmTeamId: "payments-llm",
    litellmLinked: true,
  },
  {
    teamId: "appteam-00000000-0000-4000-8000-000000000001",
    teamName: "Platform Guild",
    departmentId: "dept-ops",
    departmentName: "Operations",
    memberCount: 0,
    litellmTeamId: null,
    litellmLinked: false,
  },
];

const CREATED = {
  teamId: "appteam-00000000-0000-4000-8000-000000000009",
  name: "Data Guild",
  departmentId: "dept-eng",
  departmentName: "Engineering",
  createdBy: "oid-admin",
  createdAt: "2026-11-23T01:00:00.000Z",
  version: 1,
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const method = init?.method ?? "GET";
      if (method === "GET" && path === "/api/access/org-units") {
        return apiResponse({
          data: {
            teams: [],
            departments: [{ id: "dept-eng", name: "Engineering" }],
          },
        });
      }
      if (method === "POST" && path === "/api/teams") {
        return apiResponse({ data: CREATED }, 201);
      }
      throw new Error(`unexpected ${method} ${path}`);
    }),
  );
});

afterEach(() => {
  push.mockClear();
  vi.unstubAllGlobals();
});

const renderList = (props: Partial<Parameters<typeof TeamListTable>[0]> = {}) =>
  renderWithProviders(
    <TeamListTable rows={ROWS} canCreateTeam={false} {...props} />,
  );

describe("TeamListTable (List, then the team; D-TM1)", () => {
  it("shows the columns name, department, members and linked LiteLLM team (D-TM1)", () => {
    renderList();
    const headers = screen
      .getAllByRole("columnheader")
      .map((h) => h.textContent?.trim());
    expect(headers).toEqual(["Team", "Department", "Members", "LiteLLM team"]);
  });

  it("renders one row per team passed, with department, member count and linked team (D-TM1)", () => {
    renderList();
    const row = screen.getByRole("row", { name: /Payments/ });
    expect(within(row).getByText("Engineering")).toBeInTheDocument();
    expect(within(row).getByText("4")).toBeInTheDocument();
    expect(within(row).getByText("payments-llm")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(ROWS.length + 1);
  });

  it("an unlinked team reads 'Not linked' in the LiteLLM team column (D-TM1 spec: 'Not linked' when none)", () => {
    renderList();
    const row = screen.getByRole("row", { name: /Platform Guild/ });
    expect(within(row).getByText("Not linked")).toBeInTheDocument();
    expect(within(row).getByText("0")).toBeInTheDocument();
  });

  // Q-B1 (review r1; Design System - "List, then the team", The LiteLLM team
  // column by role): a caller who is not a global reader gets the linked
  // state without the id.
  it("a linked row without an id reads 'Linked' and shows no id", () => {
    renderList({
      rows: [{ ...ROWS[0]!, litellmTeamId: null, litellmLinked: true }],
    });
    const row = screen.getByRole("row", { name: /Payments/ });
    expect(within(row).getByText("Linked")).toBeInTheDocument();
    expect(within(row).queryByText("Not linked")).toBeNull();
    expect(within(row).queryByText("payments-llm")).toBeNull();
  });

  it("an unlinked row without an id still reads 'Not linked'", () => {
    renderList({ rows: [ROWS[1]!] });
    expect(
      within(screen.getByRole("row", { name: /Platform Guild/ })).getByText(
        "Not linked",
      ),
    ).toBeInTheDocument();
  });

  it("only the rows passed are rendered: a team not in the rows is absent (scope filtering is the page's)", () => {
    renderList({ rows: ROWS.slice(0, 1) });
    expect(screen.getByText("Payments")).toBeInTheDocument();
    expect(screen.queryByText("Platform Guild")).toBeNull();
  });

  it("the name links to /dashboard/manage/team/<teamId> (D-TM1)", () => {
    renderList();
    expect(screen.getByRole("link", { name: "Payments" })).toHaveAttribute(
      "href",
      "/dashboard/manage/team/t1",
    );
    expect(
      screen.getByRole("link", { name: "Platform Guild" }),
    ).toHaveAttribute(
      "href",
      "/dashboard/manage/team/appteam-00000000-0000-4000-8000-000000000001",
    );
  });

  it("a caller with a single team still gets the table with that one row (D-TM2: 'A caller with one team still sees the list first')", () => {
    renderList({ rows: ROWS.slice(0, 1) });
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Payments" })).toBeInTheDocument();
  });

  it("no rows reads as an empty state, not an error (Rule 60.12 states)", () => {
    renderList({ rows: [] });
    expect(screen.getByText(/no teams/i)).toBeInTheDocument();
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });

  it("states a lead's scope when a scope label is given (ScopeLine)", () => {
    renderList({ scopeLabel: "Showing teams you lead" });
    expect(screen.getByText(/Showing teams you lead/)).toBeInTheDocument();
  });
});

describe("TeamListTable New team (D-TM4; Design System - New team D5, D6)", () => {
  it.each([
    [true, "shows"],
    [false, "does not show"],
  ])("canCreateTeam=%s %s the New team button", (can) => {
    renderList({ canCreateTeam: can });
    expect(screen.queryByRole("button", { name: "New team" }) !== null).toBe(
      can,
    );
  });

  it("canCreateTeam shows the button even with no rows (D-TM4)", () => {
    renderList({ rows: [], canCreateTeam: true });
    expect(
      screen.getByRole("button", { name: "New team" }),
    ).toBeInTheDocument();
  });

  it("on created, navigates to the new team's page (agent decision 2026-11-23, TM1)", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    renderList({ canCreateTeam: true });
    await u.click(screen.getByRole("button", { name: "New team" }));
    await screen.findByRole("option", { name: "Engineering" });
    await u.type(
      screen.getByRole("textbox", { name: "Team name" }),
      "Data Guild",
    );
    await u.selectOptions(
      screen.getByRole("combobox", { name: "Department" }),
      "Engineering",
    );
    await u.click(screen.getByRole("button", { name: "Create team" }));
    await vi.waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        `/dashboard/manage/team/${CREATED.teamId}`,
      ),
    );
  });
});

// Sources: Design System - "Sorting in the other tables (unit SRT1, 2026-11-24;
// D-SR1, D-SR2)": the team list sorts in the browser with the one
// SortableHeader; the order is stable (ties keep the server's order) and
// survives a refetch; a lead's team list offers no sort on a column a lead
// does not see; the sort lives in the URL (nuqs `sort`, `dir`). Contract: the
// sort keys are `team`, `department`, `members` and `litellm`; the default is
// `team` ascending (the server's own order, by team name); `members` sorts
// numerically; a table whose ids are withheld (a lead: litellmTeamId null on
// every row) gives the LiteLLM team column a plain, non-sortable header.
const SORT_ROWS = [
  { name: "Alpha", dept: "Engineering", members: 10, llm: "m-llm" },
  { name: "Beta", dept: "Operations", members: 2, llm: "c-llm" },
  { name: "Delta", dept: "Engineering", members: 5, llm: "x-llm" },
  { name: "Gamma", dept: "Operations", members: 2, llm: "a-llm" },
].map((r) => ({
  teamId: `t-${r.name.toLowerCase()}`,
  teamName: r.name,
  departmentId: `d-${r.dept}`,
  departmentName: r.dept,
  memberCount: r.members,
  litellmTeamId: r.llm as string | null,
  litellmLinked: true,
}));

const order = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getByRole("link").textContent);
const th = (name: string) => screen.getByRole("columnheader", { name });

describe("TeamListTable sorting (unit SRT1; D-SR1)", () => {
  it("each visible column is a SortableHeader: a button in the th, Team ascending by default", () => {
    renderList({ rows: SORT_ROWS });
    for (const name of ["Team", "Department", "Members", "LiteLLM team"]) {
      expect(within(th(name)).getByRole("button")).toBeInTheDocument();
    }
    expect(th("Team")).toHaveAttribute("aria-sort", "ascending");
    expect(th("Members")).toHaveAttribute("aria-sort", "none");
    expect(order()).toEqual(["Alpha", "Beta", "Delta", "Gamma"]);
  });

  it.each([
    ["team", "desc", "Team", "descending", ["Gamma", "Delta", "Beta", "Alpha"]],
    [
      "members",
      "asc",
      "Members",
      "ascending",
      ["Beta", "Gamma", "Delta", "Alpha"],
    ],
    [
      "members",
      "desc",
      "Members",
      "descending",
      ["Alpha", "Delta", "Beta", "Gamma"],
    ],
    [
      "department",
      "asc",
      "Department",
      "ascending",
      ["Alpha", "Delta", "Beta", "Gamma"],
    ],
    [
      "department",
      "desc",
      "Department",
      "descending",
      ["Beta", "Gamma", "Alpha", "Delta"],
    ],
    [
      "litellm",
      "asc",
      "LiteLLM team",
      "ascending",
      ["Gamma", "Beta", "Alpha", "Delta"],
    ],
  ])(
    "the URL sort=%s dir=%s sets aria-sort on %s and orders the rows; members numeric, ties keep the server order both ways",
    (sort, dir, header, ariaSort, expected) => {
      render(sort, dir);
      expect(th(header)).toHaveAttribute("aria-sort", ariaSort);
      expect(order()).toEqual(expected);
    },
  );

  it("an unknown URL sort falls back to the default (Team ascending, server order)", () => {
    render("password", "desc");
    expect(th("Team")).toHaveAttribute("aria-sort", "ascending");
    expect(th("Department")).toHaveAttribute("aria-sort", "none");
    expect(order()).toEqual(["Alpha", "Beta", "Delta", "Gamma"]);
  });

  it("a header click sorts in the browser and writes sort and dir to the URL", async () => {
    const u = userEvent.setup();
    const onUrlUpdate = vi.fn();
    renderWithProviders(
      <TeamListTable rows={SORT_ROWS} canCreateTeam={false} />,
      { onUrlUpdate },
    );
    await u.click(within(th("Members")).getByRole("button"));
    await vi.waitFor(() =>
      expect(order()).toEqual(["Beta", "Gamma", "Delta", "Alpha"]),
    );
    expect(th("Members")).toHaveAttribute("aria-sort", "ascending");
    expect(th("Team")).toHaveAttribute("aria-sort", "none");
    expect(onUrlUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        queryString: expect.stringMatching(/sort=members/),
      }),
    );
    await u.click(within(th("Members")).getByRole("button"));
    await vi.waitFor(() =>
      expect(order()).toEqual(["Alpha", "Delta", "Beta", "Gamma"]),
    );
    expect(th("Members")).toHaveAttribute("aria-sort", "descending");
  });

  it("the sort survives a refetch: new rows arrive and the order and aria-sort hold", () => {
    const view = render("members", "desc");
    expect(order()).toEqual(["Alpha", "Delta", "Beta", "Gamma"]);
    view.rerender(
      <TeamListTable
        rows={[
          ...SORT_ROWS.slice(0, 2),
          { ...SORT_ROWS[2]!, memberCount: 1 },
          SORT_ROWS[3]!,
        ]}
        canCreateTeam={false}
      />,
    );
    expect(order()).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
    expect(th("Members")).toHaveAttribute("aria-sort", "descending");
  });

  // TM1 withholds the id from a caller who is not a global reader.
  it("a lead's list (ids withheld) offers no sort on the LiteLLM team column; the others still sort", () => {
    const lead = SORT_ROWS.map((r) => ({ ...r, litellmTeamId: null }));
    renderList({ rows: lead });
    expect(within(th("LiteLLM team")).queryByRole("button")).toBeNull();
    expect(th("LiteLLM team")).not.toHaveAttribute("aria-sort", "ascending");
    expect(within(th("Members")).getByRole("button")).toBeInTheDocument();
  });

  it("a lead's URL sort=litellm is not honoured: it falls back to the default order", () => {
    const lead = SORT_ROWS.map((r) => ({ ...r, litellmTeamId: null }));
    renderWithProviders(<TeamListTable rows={lead} canCreateTeam={false} />, {
      searchParams: { sort: "litellm", dir: "desc" },
    });
    expect(th("Team")).toHaveAttribute("aria-sort", "ascending");
    expect(order()).toEqual(["Alpha", "Beta", "Delta", "Gamma"]);
  });
});

function render(sort: string, dir: string) {
  return renderWithProviders(
    <TeamListTable rows={SORT_ROWS} canCreateTeam={false} />,
    { searchParams: { sort, dir } },
  );
}
