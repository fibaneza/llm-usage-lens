import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ORG_ROUTES,
  ORG_UNITS,
  UNUSED_TEAM,
  adminScopeItem,
  fail,
  ok,
  page,
  stubAccessApi,
} from "@/test/fakes/access-ui-stubs";
import { ADMIN, DEPT_ADMIN, TEAM_ADMIN } from "@/test/fixtures/access-viewers";
import { renderWithProviders } from "@/test/support/render-providers";

import { TeamAdminsSection } from "./TeamAdminsSection";

// Source: docs/specs/2026-11-10-access-control.md - "Membership, admin scopes
// and lifecycle" (admin scopes: one or more teams and/or departments, each its
// own item), "Permission matrix" (team-scope grants: internal-admin, org-admin,
// and admins whose scope covers the team, never their own scope; department-
// scope grants: internal-admin and internal-org-admin only), "Identity, SSO
// mapping and defaults" (SSO-sourced scopes are read-only in the UI),
// "API routes (additions)" (/api/teams|departments/[id]/admins GET POST,
// .../[oid] DELETE {version}). Design System - Settings Page ("Team admins
// (team and department scopes)"). Rule 60.24.
//
// Module under test: `components/settings/access/TeamAdminsSection.tsx`
//   <TeamAdminsSection viewer={AccessViewer} />
// - Native <select> labelled "Scope": options "Team: <name>" for every team in
//   scope and, only when the viewer may grant department scopes (admin,
//   org-admin), "Department: <name>". First option preselected.
// - Add form: field "Work email or UPN" + button "Add admin".
// - Row action: icon button labelled "Revoke admin <name>".
// - Scope options come from GET /api/access/org-units (F10, registry-backed),
//   names from the row itself (F11), falling back to the oid.
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function routes(extra: Record<string, unknown> = {}) {
  return {
    ...ORG_ROUTES,
    "GET /api/teams/team-pay/admins": page([
      adminScopeItem(),
      adminScopeItem({ oid: "oid-alice", source: "sso", version: 4 }),
    ]),
    "GET /api/departments/dept-eng/admins": page([
      adminScopeItem({
        oid: "oid-alice",
        scopeType: "department",
        scopeId: "dept-eng",
      }),
    ]),
    ...extra,
  };
}

describe("TeamAdminsSection", () => {
  it("lists a team's admins by name and marks SSO-sourced scopes read-only", async () => {
    stubAccessApi(routes());
    renderWithProviders(<TeamAdminsSection viewer={ADMIN} />);
    const bob = await screen.findByRole("row", { name: /Bob Brown/ });
    expect(
      within(bob).getByRole("button", { name: "Revoke admin Bob Brown" }),
    ).toBeInTheDocument();
    const alice = screen.getByRole("row", { name: /Alice Adams/ });
    expect(within(alice).getByText(/managed in entra/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Revoke admin Alice Adams" }),
    ).not.toBeInTheDocument();
  });

  it("offers team and department scopes to an admin and loads a department's admins", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(routes());
    renderWithProviders(<TeamAdminsSection viewer={ADMIN} />);
    await screen.findByRole("row", { name: /Bob Brown/ });
    const scope = screen.getByLabelText("Scope");
    expect(
      within(scope).getByRole("option", { name: "Team: Payments" }),
    ).toBeInTheDocument();
    await user.selectOptions(scope, "Department: Engineering");
    await screen.findByRole("row", { name: /Alice Adams/ });
    expect(api.to("GET /api/departments/dept-eng/admins")).toHaveLength(1);
  });

  // D37.
  it("takes its team and department scopes from /api/access/org-units, including a team with no usage, and never from /api/teams or /api/departments", async () => {
    const api = stubAccessApi(
      routes({
        "GET /api/access/org-units": {
          ...ORG_UNITS,
          teams: [...ORG_UNITS.teams, UNUSED_TEAM],
        },
      }),
    );
    renderWithProviders(<TeamAdminsSection viewer={ADMIN} />);
    await screen.findByRole("row", { name: /Bob Brown/ });
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

  // D37: a scoped admin cannot read the directory.
  it("shows the name with the email from the row when /api/identities is refused, and the oid when the row has no name", async () => {
    stubAccessApi(
      routes({
        "GET /api/identities": () => fail(403, "FORBIDDEN"),
        "GET /api/teams/team-pay/admins": page([
          adminScopeItem(),
          adminScopeItem({ oid: "oid-ghost", version: 1 }),
        ]),
      }),
    );
    renderWithProviders(<TeamAdminsSection viewer={TEAM_ADMIN} />);
    const bob = await screen.findByRole("row", { name: /Bob Brown/ });
    expect(within(bob).getByText("bob@example.com")).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /oid-ghost/ })).toBeInTheDocument();
  });

  it.each([
    ["a team-scope admin", TEAM_ADMIN],
    ["a department-scope admin", DEPT_ADMIN],
  ])("%s is not offered department scopes", async (_name, viewer) => {
    stubAccessApi(routes());
    renderWithProviders(<TeamAdminsSection viewer={viewer} />);
    await screen.findByRole("row", { name: /Bob Brown/ });
    const options = within(screen.getByLabelText("Scope")).getAllByRole(
      "option",
    );
    expect(options.map((o) => o.textContent)).not.toContainEqual(
      expect.stringMatching(/^Department:/),
    );
  });

  it("grants a team scope to a pending work email", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "POST /api/teams/team-pay/admins": () =>
          ok(
            {
              kind: "adminScope",
              emailOrUpn: "dana@example.com",
              scopeType: "team",
              scopeId: "team-pay",
              createdBy: "oid-admin",
              createdAt: "2026-11-15T00:00:00.000Z",
              version: 1,
            },
            201,
          ),
      }),
    );
    renderWithProviders(<TeamAdminsSection viewer={ADMIN} />);
    await screen.findByRole("row", { name: /Bob Brown/ });
    await user.type(
      screen.getByLabelText(/work email or upn/i),
      "dana@example.com",
    );
    await user.click(screen.getByRole("button", { name: /add admin/i }));
    expect(
      await screen.findByText(/dana@example\.com.*(pending|first sign-in)/is),
    ).toBeInTheDocument();
    expect(api.writes()).toEqual([
      expect.objectContaining({
        method: "POST",
        path: "/api/teams/team-pay/admins",
        body: { emailOrUpn: "dana@example.com" },
      }),
    ]);
  });

  it("grants a department scope to the department's route", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "POST /api/departments/dept-eng/admins": () =>
          ok(
            {
              kind: "adminScope",
              emailOrUpn: "dana@example.com",
              scopeType: "department",
              scopeId: "dept-eng",
              createdBy: "oid-admin",
              createdAt: "2026-11-15T00:00:00.000Z",
              version: 1,
            },
            201,
          ),
      }),
    );
    renderWithProviders(<TeamAdminsSection viewer={ADMIN} />);
    await screen.findByRole("row", { name: /Bob Brown/ });
    await user.selectOptions(
      screen.getByLabelText("Scope"),
      "Department: Engineering",
    );
    await user.type(
      screen.getByLabelText(/work email or upn/i),
      "dana@example.com",
    );
    await user.click(screen.getByRole("button", { name: /add admin/i }));
    await vi.waitFor(() =>
      expect(api.writes().map((c) => c.path)).toEqual([
        "/api/departments/dept-eng/admins",
      ]),
    );
  });

  it("validates the email before sending", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(routes());
    renderWithProviders(<TeamAdminsSection viewer={ADMIN} />);
    await screen.findByRole("row", { name: /Bob Brown/ });
    await user.type(screen.getByLabelText(/work email or upn/i), "nope");
    await user.click(screen.getByRole("button", { name: /add admin/i }));
    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(api.writes()).toEqual([]);
  });

  it("revokes an admin scope after confirmation, sending the item's version", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "DELETE /api/teams/team-pay/admins/oid-bob": () =>
          ok({ oid: "oid-bob", scopeId: "team-pay" }),
      }),
    );
    renderWithProviders(<TeamAdminsSection viewer={ADMIN} />);
    await user.click(
      await screen.findByRole("button", { name: "Revoke admin Bob Brown" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(api.writes()).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Revoke" }));
    await vi.waitFor(() =>
      expect(api.writes()).toEqual([
        expect.objectContaining({
          method: "DELETE",
          path: "/api/teams/team-pay/admins/oid-bob",
          body: { version: 1 },
        }),
      ]),
    );
  });

  it("shows a permission message when the server refuses (own scope)", async () => {
    const user = userEvent.setup();
    stubAccessApi(
      routes({
        "DELETE /api/teams/team-pay/admins/oid-bob": () =>
          fail(403, "FORBIDDEN"),
      }),
    );
    renderWithProviders(<TeamAdminsSection viewer={TEAM_ADMIN} />);
    await user.click(
      await screen.findByRole("button", { name: "Revoke admin Bob Brown" }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Revoke",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /permission|not allowed|can't/i,
    );
  });

  it("shows an empty state for a team with no admins", async () => {
    stubAccessApi(routes({ "GET /api/teams/team-pay/admins": page([]) }));
    renderWithProviders(<TeamAdminsSection viewer={ADMIN} />);
    expect(await screen.findByText(/no (team )?admins/i)).toBeInTheDocument();
  });
});

// Unit TM1, D-TM2 (Design
// System - Management pages, Team, "List, then the team"): with the optional
// `teamId` prop the section has no "Scope" select and works on that team.
// Prop contract: `<TeamAdminsSection viewer teamId="team-risk" />`.
describe("TeamAdminsSection with a teamId prop (TM1 D-TM2)", () => {
  const riskAdmins = page([
    adminScopeItem({ oid: "oid-bob", scopeId: "team-risk", version: 7 }),
  ]);

  it("renders no Scope select and reads that team's admins, not the first team's", async () => {
    const api = stubAccessApi(
      routes({ "GET /api/teams/team-risk/admins": riskAdmins }),
    );
    renderWithProviders(
      <TeamAdminsSection viewer={ADMIN} teamId="team-risk" />,
    );
    await screen.findByRole("row", { name: /Bob Brown/ });
    expect(screen.queryByLabelText("Scope")).not.toBeInTheDocument();
    expect(api.to("GET /api/teams/team-risk/admins").length).toBeGreaterThan(0);
    expect(api.to("GET /api/teams/team-pay/admins")).toEqual([]);
    expect(api.to("GET /api/departments/dept-eng/admins")).toEqual([]);
  });

  // D-TM2: adding an admin writes to the route's team.
  it("adds an admin on the route's team", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "GET /api/teams/team-risk/admins": riskAdmins,
        "POST /api/teams/team-risk/admins": () => ok({}, 201),
      }),
    );
    renderWithProviders(
      <TeamAdminsSection viewer={ADMIN} teamId="team-risk" />,
    );
    await screen.findByRole("row", { name: /Bob Brown/ });
    await user.type(
      screen.getByLabelText("Work email or UPN"),
      "new.lead@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Add admin" }));
    expect(
      await screen.findByText(/new\.lead@example\.com is pending/),
    ).toBeVisible();
    expect(api.writes()[0]).toMatchObject({
      method: "POST",
      path: "/api/teams/team-risk/admins",
      body: { emailOrUpn: "new.lead@example.com" },
    });
  });

  // Coordinator ruling: a team prop outside the shown scopes is still its own
  // team - the empty state names the team, not a missing-scope message.
  it("shows the empty state for a team with no admins", async () => {
    stubAccessApi(routes({ "GET /api/teams/team-risk/admins": page([]) }));
    renderWithProviders(
      <TeamAdminsSection viewer={ADMIN} teamId="team-risk" />,
    );
    expect(await screen.findByText(/no (team )?admins/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Scope")).not.toBeInTheDocument();
  });
});
