import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ORG_ROUTES,
  ORG_UNITS,
  UNUSED_TEAM,
  fail,
  ok,
  stubAccessApi,
} from "@/test/fakes/access-ui-stubs";
import { ADMIN, DEPT_ADMIN, TEAM_ADMIN } from "@/test/fixtures/access-viewers";
import { renderWithProviders } from "@/test/support/render-providers";

import { VisibilitySection } from "./VisibilitySection";

// Source: docs/specs/2026-11-10-access-control.md - "Visibility and
// inheritance" (team level visible/hidden default visible; user level
// all/own/none default own; department level default hidden and its cap
// maxUserLevel default own; "A team setting above its department cap is
// stored, applied as the cap, and shown as 'limited by department'"),
// "Permission matrix" (edit visibility: admin, org-admin, department-scope for
// the department, its cap and its teams, team-scope for its teams),
// "API routes (additions)" (/api/teams|departments/[id]/visibility GET PUT;
// version 0 = defaults not stored yet), "Enforcement" item 6 (stale version
// -> 409). Design System - Settings Page.
//
// Module under test: `components/settings/access/VisibilitySection.tsx`
//   <VisibilitySection viewer={AccessViewer} />
// - Native <select> labelled "Scope" ("Team: <name>" / "Department: <name>";
//   departments only when the viewer may edit department visibility).
// - Team form: selects "Team totals" (Visible/Hidden) and "User level"
//   (All/Own/None), button "Save visibility".
// - Department form: selects "Department totals" (Visible/Hidden) and "User
//   level cap" (All/Own/None), button "Save visibility".
// - The department cap for a team comes from GET /api/departments/<dept>/
//   visibility; a 404 there (out of scope) is tolerated silently.
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const TEAM_VIS = {
  teamId: "team-pay",
  teamLevel: "visible",
  userLevel: "all",
  version: 3,
  updatedAt: "2026-11-10T09:00:00.000Z",
};
const DEPT_VIS = {
  departmentId: "dept-eng",
  departmentLevel: "hidden",
  maxUserLevel: "own",
  version: 2,
  updatedAt: "2026-11-10T09:00:00.000Z",
};

function routes(extra: Record<string, unknown> = {}) {
  return {
    ...ORG_ROUTES,
    "GET /api/teams/team-pay/visibility": TEAM_VIS,
    "GET /api/teams/team-risk/visibility": {
      ...TEAM_VIS,
      teamId: "team-risk",
      userLevel: "own",
      version: 0,
    },
    "GET /api/departments/dept-eng/visibility": DEPT_VIS,
    ...extra,
  };
}

describe("VisibilitySection", () => {
  // D37: the Scope picker lists the account
  // registry scoped to the caller, so a team with no recent usage is editable.
  it("takes its team and department scopes from /api/access/org-units, including a team with no usage, and never from /api/teams or /api/departments", async () => {
    const api = stubAccessApi(
      routes({
        "GET /api/access/org-units": {
          ...ORG_UNITS,
          teams: [...ORG_UNITS.teams, UNUSED_TEAM],
        },
      }),
    );
    renderWithProviders(<VisibilitySection viewer={ADMIN} />);
    await screen.findByLabelText("User level");
    const scope = screen.getByLabelText("Scope");
    expect(
      within(scope).getByRole("option", { name: "Team: Treasury" }),
    ).toBeInTheDocument();
    expect(
      within(scope).getByRole("option", { name: "Department: Finance" }),
    ).toBeInTheDocument();
    expect(api.to("GET /api/teams")).toEqual([]);
    expect(api.to("GET /api/departments")).toEqual([]);
  });

  it("shows the first team's stored settings", async () => {
    stubAccessApi(routes());
    renderWithProviders(<VisibilitySection viewer={ADMIN} />);
    expect(await screen.findByLabelText("User level")).toHaveDisplayValue(
      "All",
    );
    expect(screen.getByLabelText("Team totals")).toHaveDisplayValue("Visible");
  });

  it("says 'limited by department' when the team level exceeds the department cap", async () => {
    stubAccessApi(routes());
    renderWithProviders(<VisibilitySection viewer={ADMIN} />);
    await screen.findByLabelText("User level");
    expect(await screen.findByText(/limited by department/i)).toBeVisible();
  });

  it("does not say 'limited' when the team level is within the cap", async () => {
    stubAccessApi(
      routes({
        "GET /api/departments/dept-eng/visibility": {
          ...DEPT_VIS,
          maxUserLevel: "all",
        },
      }),
    );
    renderWithProviders(<VisibilitySection viewer={ADMIN} />);
    await screen.findByLabelText("User level");
    await vi.waitFor(() =>
      expect(screen.queryByText(/limited by department/i)).toBeNull(),
    );
  });

  it("still renders the team form when the department cap is out of scope (404)", async () => {
    stubAccessApi(
      routes({
        "GET /api/departments/dept-eng/visibility": () =>
          fail(404, "NOT_FOUND"),
      }),
    );
    renderWithProviders(<VisibilitySection viewer={TEAM_ADMIN} />);
    expect(await screen.findByLabelText("User level")).toBeInTheDocument();
    expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument();
  });

  it("saves the team setting with the version it loaded", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "PUT /api/teams/team-pay/visibility": () =>
          ok({ ...TEAM_VIS, userLevel: "none", version: 4 }),
      }),
    );
    renderWithProviders(<VisibilitySection viewer={ADMIN} />);
    await user.selectOptions(
      await screen.findByLabelText("User level"),
      "None",
    );
    await user.click(screen.getByRole("button", { name: "Save visibility" }));
    await vi.waitFor(() =>
      expect(api.writes()).toEqual([
        expect.objectContaining({
          method: "PUT",
          path: "/api/teams/team-pay/visibility",
          body: { teamLevel: "visible", userLevel: "none", version: 3 },
        }),
      ]),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(/saved/i);
  });

  it("sends version 0 for a team that has no stored setting yet", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "PUT /api/teams/team-risk/visibility": () =>
          ok({ ...TEAM_VIS, teamId: "team-risk", version: 1 }),
      }),
    );
    renderWithProviders(<VisibilitySection viewer={ADMIN} />);
    await user.selectOptions(
      await screen.findByLabelText("Scope"),
      "Team: Risk",
    );
    await vi.waitFor(() =>
      expect(screen.getByLabelText("User level")).toHaveDisplayValue("Own"),
    );
    await user.click(screen.getByRole("button", { name: "Save visibility" }));
    await vi.waitFor(() =>
      expect(api.writes()[0]?.body).toMatchObject({ version: 0 }),
    );
  });

  it("edits a department's level and cap", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "PUT /api/departments/dept-eng/visibility": () =>
          ok({ ...DEPT_VIS, departmentLevel: "visible", version: 3 }),
      }),
    );
    renderWithProviders(<VisibilitySection viewer={ADMIN} />);
    await user.selectOptions(
      await screen.findByLabelText("Scope"),
      "Department: Engineering",
    );
    await user.selectOptions(
      await screen.findByLabelText("Department totals"),
      "Visible",
    );
    expect(screen.getByLabelText("User level cap")).toHaveDisplayValue("Own");
    await user.click(screen.getByRole("button", { name: "Save visibility" }));
    await vi.waitFor(() =>
      expect(api.writes()).toEqual([
        expect.objectContaining({
          path: "/api/departments/dept-eng/visibility",
          body: { departmentLevel: "visible", maxUserLevel: "own", version: 2 },
        }),
      ]),
    );
  });

  it("offers a team-scope admin teams only; a department-scope admin gets its department too", async () => {
    stubAccessApi(routes());
    const first = renderWithProviders(
      <VisibilitySection viewer={TEAM_ADMIN} />,
    );
    const teamOnly = await screen.findByLabelText("Scope");
    expect(
      within(teamOnly)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).not.toContainEqual(expect.stringMatching(/^Department:/));
    first.unmount();

    stubAccessApi(routes());
    renderWithProviders(<VisibilitySection viewer={DEPT_ADMIN} />);
    expect(
      await screen.findByRole("option", { name: "Department: Engineering" }),
    ).toBeInTheDocument();
  });

  it("shows the reload message on a stale-version 409", async () => {
    const user = userEvent.setup();
    stubAccessApi(
      routes({
        "PUT /api/teams/team-pay/visibility": () => fail(409, "CONFLICT"),
      }),
    );
    renderWithProviders(<VisibilitySection viewer={ADMIN} />);
    await user.selectOptions(await screen.findByLabelText("User level"), "Own");
    await user.click(screen.getByRole("button", { name: "Save visibility" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/reload/i);
  });

  it("shows a permission message on 403", async () => {
    const user = userEvent.setup();
    stubAccessApi(
      routes({
        "PUT /api/teams/team-pay/visibility": () => fail(403, "FORBIDDEN"),
      }),
    );
    renderWithProviders(<VisibilitySection viewer={ADMIN} />);
    await user.selectOptions(await screen.findByLabelText("User level"), "Own");
    await user.click(screen.getByRole("button", { name: "Save visibility" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /permission|not allowed|can't/i,
    );
  });
});

// Unit C1 item 7: the Scope picker opens on the page's team (?team=), the same
// state as the Team page's picker (Design System - Management pages, Team).
describe("VisibilitySection follows the page's selected team (?team=)", () => {
  it("opens on 'Team: Risk' for ?team=team-risk and reads that team's visibility", async () => {
    const api = stubAccessApi(routes());
    renderWithProviders(<VisibilitySection viewer={ADMIN} />, {
      searchParams: { team: "team-risk" },
    });
    expect(await screen.findByLabelText("Scope")).toHaveDisplayValue(
      "Team: Risk",
    );
    expect(
      api.to("GET /api/teams/team-risk/visibility").length,
    ).toBeGreaterThan(0);
  });
});

// Unit TM1, D-TM2 (Design
// System - Management pages, Team, "List, then the team"): with the optional
// `teamId` prop the section has no "Scope" select and edits that team's
// visibility. Prop contract: `<VisibilitySection viewer teamId="team-risk" />`.
describe("VisibilitySection with a teamId prop (TM1 D-TM2)", () => {
  it("renders no Scope select and reads /api/teams/<id>/visibility for the route's team", async () => {
    const api = stubAccessApi(routes());
    renderWithProviders(
      <VisibilitySection viewer={ADMIN} teamId="team-risk" />,
    );
    expect(await screen.findByLabelText("User level")).toHaveDisplayValue(
      "Own",
    );
    expect(screen.queryByLabelText("Scope")).not.toBeInTheDocument();
    expect(
      api.to("GET /api/teams/team-risk/visibility").length,
    ).toBeGreaterThan(0);
    expect(api.to("GET /api/teams/team-pay/visibility")).toEqual([]);
  });

  // D-TM2: the save writes to the route's team, with the stored version.
  it("saves to /api/teams/<id>/visibility for the route's team", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "PUT /api/teams/team-risk/visibility": () =>
          ok({
            teamId: "team-risk",
            teamLevel: "visible",
            userLevel: "none",
            version: 1,
            updatedAt: "2026-11-10T09:00:00.000Z",
          }),
      }),
    );
    renderWithProviders(
      <VisibilitySection viewer={ADMIN} teamId="team-risk" />,
    );
    await user.selectOptions(
      await screen.findByLabelText("User level"),
      "None",
    );
    await user.click(
      within(
        screen.getByLabelText("User level").closest("form") as HTMLElement,
      ).getByRole("button", { name: "Save visibility" }),
    );
    expect(await screen.findByText("Saved.")).toBeVisible();
    expect(api.writes()[0]).toMatchObject({
      method: "PUT",
      path: "/api/teams/team-risk/visibility",
      body: { teamLevel: "visible", userLevel: "none", version: 0 },
    });
  });

  // Rule: the prop wins over a stray ?team= (the page's route gives the team).
  it("ignores ?team= when it has a teamId prop", async () => {
    const api = stubAccessApi(routes());
    renderWithProviders(
      <VisibilitySection viewer={ADMIN} teamId="team-pay" />,
      {
        searchParams: { team: "team-risk" },
      },
    );
    await screen.findByLabelText("User level");
    expect(api.to("GET /api/teams/team-pay/visibility").length).toBeGreaterThan(
      0,
    );
    expect(api.to("GET /api/teams/team-risk/visibility")).toEqual([]);
  });
});

// Q-B2 (review r1; Design System - "List, then the team", Department
// visibility on the team page): a caller with editDepartmentVisibility for the
// team's department also sees that department's panel (setting and cap) on the
// team page, through the existing department route; a team-only lead does not;
// a department lead of another department does not. Settings is closed to
// leads, so this is the only place a department lead can edit it.
describe("VisibilitySection department panel on the team page (Q-B2)", () => {
  const OTHER_DEPT_ADMIN = {
    ...DEPT_ADMIN,
    adminScopes: [{ scopeType: "department", scopeId: "dept-fin" }],
  } as typeof DEPT_ADMIN;

  it("a department lead sees the team's department panel beside the team form", async () => {
    stubAccessApi(routes());
    renderWithProviders(
      <VisibilitySection
        viewer={DEPT_ADMIN}
        teamId="team-pay"
        departmentId="dept-eng"
      />,
    );
    expect(await screen.findByLabelText("User level")).toBeInTheDocument();
    expect(
      await screen.findByLabelText("Department totals"),
    ).toHaveDisplayValue("Hidden");
    expect(screen.getByLabelText("User level cap")).toHaveDisplayValue("Own");
  });

  it("a department lead saves the department's setting and cap with the stored version", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "PUT /api/departments/dept-eng/visibility": () =>
          ok({ ...DEPT_VIS, departmentLevel: "visible", version: 3 }),
      }),
    );
    renderWithProviders(
      <VisibilitySection
        viewer={DEPT_ADMIN}
        teamId="team-pay"
        departmentId="dept-eng"
      />,
    );
    await user.selectOptions(
      await screen.findByLabelText("Department totals"),
      "Visible",
    );
    await user.click(
      within(
        screen
          .getByLabelText("Department totals")
          .closest("form") as HTMLElement,
      ).getByRole("button", { name: "Save visibility" }),
    );
    await vi.waitFor(() =>
      expect(api.writes()).toEqual([
        expect.objectContaining({
          path: "/api/departments/dept-eng/visibility",
          body: { departmentLevel: "visible", maxUserLevel: "own", version: 2 },
        }),
      ]),
    );
  });

  it("a team-only lead does not see the department panel and fetches no department setting for it", async () => {
    const api = stubAccessApi(routes());
    renderWithProviders(
      <VisibilitySection
        viewer={TEAM_ADMIN}
        teamId="team-pay"
        departmentId="dept-eng"
      />,
    );
    await screen.findByLabelText("User level");
    expect(screen.queryByLabelText("Department totals")).toBeNull();
    expect(screen.queryByLabelText("User level cap")).toBeNull();
    expect(api.writes()).toEqual([]);
  });

  it("a department lead of another department does not see this team's department panel", async () => {
    stubAccessApi(routes());
    renderWithProviders(
      <VisibilitySection
        viewer={OTHER_DEPT_ADMIN}
        teamId="team-pay"
        departmentId="dept-eng"
      />,
    );
    await screen.findByLabelText("User level");
    expect(screen.queryByLabelText("Department totals")).toBeNull();
  });
});
