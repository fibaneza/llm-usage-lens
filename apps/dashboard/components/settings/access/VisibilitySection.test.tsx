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
} from "@/test/access-ui-stubs";
import { ADMIN, DEPT_ADMIN, TEAM_ADMIN } from "@/test/access-viewers";
import { renderWithProviders } from "@/test/render-providers";

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
  // F10 (temp/run-r4b/decisions.md): the Scope picker lists the account
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
