import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Sources: Design System - Management pages, Team, "List, then the team (unit
// TM1; D-TM1, D-TM2)": the team page holds every panel the page had for the
// chosen team, the route gives the team and the access sections take it as a
// prop; Access Control - Enforcement item 2 (TM1 sentence:
// /dashboard/manage/team/[teamId] is 404 with the missing-team body for a team
// outside the caller's scope - neither one of a lead's team scopes nor in one
// of its department scopes - and for an unknown id); Navigation and landing by
// role (Team: global readers every team, a lead the teams it leads; hidden
// means absent and 404); LiteLLM spec LD25-LD26 (only internal-admin raises
// limits; legacy Admin alias outside prod; a suspended SSO scope grants
// nothing; a stored grant counts, Rule 50.4). Cases for
// who-gets-the-page, canRaiseLimits and the access sections moved here from
// the list page's test, which no longer renders the team page. Rules 10.3,
// 50.3, 60.7. The full caller x route matrix runs in
// __tests__/manage-routes.integration.test.ts.
//
// Contract for the developer (app/dashboard/manage/team/[teamId]/page.tsx):
//   default async Server Component, props
//   { params: Promise<{ teamId: string }> }. `team` flag false -> notFound().
//   findTeamEntry(teamId) null (unknown) -> notFound(), for every caller. A
//   non-global caller must hold teamId in scope.teamScopes or the entry's
//   departmentId in scope.departmentScopes, else notFound() - the same
//   outcome as an unknown id. A global reader (admin, org admin, auditor) may
//   open any known team. Renders
//   <TeamPageContent teamId canRaiseLimits scopeLabel access /> (no
//   canCreateTeam: New team lives on the list, D-TM4), and `access` is
//   <AccessSections viewer stepUp sections teamId={teamId} /> with the four
//   sections members, team-admins, pending-access, visibility.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => auth() }));
vi.mock("server-only", () => ({}));
const loadAuthorization = vi.fn();
vi.mock("@/lib/data/access/authorization", () => ({
  loadAuthorization: (input: unknown) => loadAuthorization(input),
}));
vi.mock("@/env", () => ({
  env: { APP_ENV: "dev", AUTH_ACCESS_MODE: "enforce" },
}));
const DIRECTORY = [
  { teamId: "t1", departmentId: "dept-eng", hasAwsAccount: true },
  { teamId: "t2", departmentId: "dept-ops", hasAwsAccount: true },
  { teamId: "t9", departmentId: "dept-ops", hasAwsAccount: true },
  { teamId: "team-a", departmentId: "dept-eng", hasAwsAccount: true },
  { teamId: "team-c", departmentId: "dept-ops", hasAwsAccount: true },
  {
    teamId: "appteam-00000000-0000-4000-8000-000000000001",
    departmentId: "dept-eng",
    hasAwsAccount: false,
  },
  {
    teamId: "appteam-00000000-0000-4000-8000-000000000002",
    departmentId: "dept-ops",
    hasAwsAccount: false,
  },
];
vi.mock("@/lib/api/team-directory", () => ({
  findTeamEntry: async (teamId: string) =>
    DIRECTORY.find((e) => e.teamId === teamId) ?? null,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock("@/app/dashboard/settings/step-up-actions", () => ({
  stepUpWithEntra: vi.fn(),
  stepUpWithCredentials: vi.fn(),
  stepUpWithDevLogin: vi.fn(),
}));
const loadViewer = vi.fn();
vi.mock("@/lib/auth/settings-access", () => ({
  loadSettingsAccessViewer: (session: unknown) => loadViewer(session),
}));
vi.mock("@/components/settings/access/AccessSections", () => ({
  AccessSections: (props: {
    sections: string[];
    teamId?: string;
    departmentId?: string;
  }) => (
    <div
      data-testid="access-sections"
      data-team={props.teamId ?? ""}
      data-department={props.departmentId ?? ""}
    >
      {props.sections.join(",")}
    </div>
  ),
}));
vi.mock("@/components/manage/TeamPageContent", () => ({
  TeamPageContent: (props: {
    teamId: string;
    canRaiseLimits: boolean;
    canCreateTeam?: boolean;
    scopeLabel: string | null;
    access?: React.ReactNode;
  }) => (
    <div
      data-testid="team"
      data-team={props.teamId}
      data-raise={String(props.canRaiseLimits)}
      data-has-create={String(props.canCreateTeam !== undefined)}
      data-scope-label={props.scopeLabel ?? ""}
    >
      {props.access}
    </div>
  ),
}));

import TeamDetailPage from "./page";

const open = async (teamId = "t1") =>
  TeamDetailPage({ params: Promise.resolve({ teamId }) });

const as = (roles: string[], authorization: Record<string, unknown> = {}) => {
  auth.mockResolvedValue({ user: { oid: "o", roles, authMethod: "entra" } });
  loadAuthorization.mockResolvedValue({
    appEnv: "dev",
    roleGrants: [],
    ...authorization,
  });
  const scoped = Array.isArray(authorization.adminScopes)
    ? authorization.adminScopes
    : [];
  loadViewer.mockResolvedValue({
    roles,
    authMethod: "entra",
    adminScopes: scoped,
  });
};

const teamLead = (scopeId: string) => ({
  adminScopes: [{ source: "manual", scopeType: "team", scopeId }],
});
const deptLead = (scopeId: string) => ({
  adminScopes: [{ source: "manual", scopeType: "department", scopeId }],
});

beforeEach(() => {
  as(["internal-viewer"]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("TeamDetailPage (/dashboard/manage/team/[teamId])", () => {
  it("is a Server Component (Rule 60.7)", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "page.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/^\s*["']use client["']/m);
  });

  it("in scope, renders TeamPageContent for the route's team (D-TM1)", async () => {
    as(["internal-viewer"], teamLead("t1"));
    render(await open("t1"));
    expect(screen.getByTestId("team")).toHaveAttribute("data-team", "t1");
  });

  it("does not hand the team page a New team flag: New team stays on the list (D-TM4)", async () => {
    as(["internal-admin"]);
    render(await open("t1"));
    expect(screen.getByTestId("team")).toHaveAttribute(
      "data-has-create",
      "false",
    );
  });

  // Who: lead, org admin, admin get the page; only admin may raise (LD26).
  it.each([
    [
      "a Lead with a team admin scope",
      ["internal-viewer"],
      teamLead("t1"),
      "false",
    ],
    [
      "a Lead with a department admin scope",
      ["internal-viewer"],
      deptLead("dept-eng"),
      "false",
    ],
    [
      "an internal-org-admin (lowers only, LD26)",
      ["internal-org-admin"],
      {},
      "false",
    ],
    ["the read-only internal-auditor", ["internal-auditor"], {}, "false"],
    ["an internal-admin", ["internal-admin"], {}, "true"],
    ["the legacy Admin alias outside prod", ["Admin"], {}, "true"],
    [
      "a stored internal-org-admin grant on a viewer claim (Rule 50.4)",
      ["internal-viewer"],
      { roleGrants: [{ role: "internal-org-admin" }] },
      "false",
    ],
  ])("%s gets the page (Who)", async (_n, roles, authorization, raise) => {
    as(roles, authorization);
    render(await open("t1"));
    expect(screen.getByTestId("team")).toHaveAttribute("data-raise", raise);
  });

  // Hidden means absent and 404.
  it.each([
    ["a Viewer", ["internal-viewer"], {}],
    ["no role claim", [], {}],
    [
      "a plain team member (affiliation, no admin scope)",
      ["internal-viewer"],
      { affiliation: { teamId: "t1", departmentId: "dept-eng" } },
    ],
    [
      "a Lead whose only scope is suspended (sso, groupsOverage)",
      ["internal-viewer"],
      {
        identity: { groupsOverage: true },
        adminScopes: [{ source: "sso", scopeType: "team", scopeId: "t1" }],
      },
    ],
  ])("%s gets notFound() (404 parity)", async (_n, roles, authorization) => {
    as(roles, authorization);
    await expect(open("t1")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("no session gets notFound() (404 parity)", async () => {
    auth.mockResolvedValue(null);
    await expect(open("t1")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  // an out-of-scope [teamId] is the same 404 as a missing one.
  it("a team Lead opening a team outside its team scopes gets notFound() (Access Control - Enforcement item 2)", async () => {
    as(["internal-viewer"], teamLead("t1"));
    // t2 exists but is in dept-ops and not in the lead's scope.
    await expect(open("t2")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("an unknown team id gets notFound(), the same outcome as an out-of-scope one", async () => {
    as(["internal-viewer"], teamLead("t1"));
    const outOfScope = await open("t2").catch((e: Error) => e.message);
    const unknown = await open("no-such-team").catch((e: Error) => e.message);
    expect(unknown).toBe("NEXT_NOT_FOUND");
    expect(unknown).toBe(outOfScope);
  });

  it("a department Lead opens a team of its department; a team of another department is notFound() (Coordinator ruling 2026-11-16)", async () => {
    as(["internal-viewer"], deptLead("dept-eng"));
    render(await open("team-a"));
    expect(screen.getByTestId("team")).toHaveAttribute("data-team", "team-a");
    await expect(open("team-c")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a department Lead opens a created team of its department and not one of another department (Access Control - Created app teams)", async () => {
    as(["internal-viewer"], deptLead("dept-eng"));
    render(await open("appteam-00000000-0000-4000-8000-000000000001"));
    expect(screen.getByTestId("team")).toBeInTheDocument();
    await expect(
      open("appteam-00000000-0000-4000-8000-000000000002"),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each([
    ["an admin", ["internal-admin"]],
    ["an org-admin", ["internal-org-admin"]],
    ["the auditor", ["internal-auditor"]],
  ])("%s may open any known team (global reader)", async (_n, roles) => {
    as(roles);
    render(await open("t9"));
    expect(screen.getByTestId("team")).toHaveAttribute("data-team", "t9");
  });

  it.each([
    ["an admin", ["internal-admin"]],
    ["the auditor", ["internal-auditor"]],
  ])("%s opening an unknown team id gets notFound()", async (_n, roles) => {
    as(roles);
    await expect(open("no-such-team")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each([
    ["a team lead", teamLead("t1"), "Showing teams you lead"],
    ["a department lead", deptLead("dept-eng"), "Showing departments you lead"],
  ])(
    "%s gets the scope label (scopeLabelFor)",
    async (_n, authorization, label) => {
      as(["internal-viewer"], authorization);
      render(await open("t1"));
      expect(screen.getByTestId("team")).toHaveAttribute(
        "data-scope-label",
        label,
      );
    },
  );

  it("a global reader gets no scope label", async () => {
    as(["internal-auditor"]);
    render(await open("t1"));
    expect(screen.getByTestId("team")).toHaveAttribute("data-scope-label", "");
  });
});

// D-TM2: the access sections get the route's team as a prop (no
// dropdowns); B2-4: the page chooses the four team-level sections.
describe("TeamDetailPage access sections (B2-4)", () => {
  it.each([
    ["a team lead", ["internal-viewer"], teamLead("t1")],
    ["an org admin", ["internal-org-admin"], {}],
    ["an admin", ["internal-admin"], {}],
    [
      "the auditor (the sections' own filter hides what it may not read)",
      ["internal-auditor"],
      {},
    ],
  ])(
    "%s gets the four team-level sections for the route's team",
    async (_n, roles, authorization) => {
      as(roles, authorization);
      render(await open("t1"));
      const sections = screen.getByTestId("access-sections");
      expect(sections).toHaveTextContent(
        "members,team-admins,pending-access,visibility",
      );
      expect(sections).toHaveAttribute("data-team", "t1");
    },
  );

  it("passes the route's team, not a default, to the sections", async () => {
    as(["internal-admin"]);
    render(await open("t9"));
    expect(screen.getByTestId("access-sections")).toHaveAttribute(
      "data-team",
      "t9",
    );
  });

  // Q-B2 (review r1; Design System - "List, then the team", Department
  // visibility on the team page): the page hands the sections the team's
  // department so a caller with editDepartmentVisibility for it gets that
  // department's Visibility panel (the section decides by the viewer's scopes).
  it.each([
    ["a department lead", deptLead("dept-eng"), "team-a", "dept-eng"],
    ["an admin", {}, "t9", "dept-ops"],
    ["a team lead", teamLead("t1"), "t1", "dept-eng"],
  ])(
    "%s: the sections get the team's department (Q-B2)",
    async (_n, authorization, teamId, department) => {
      as(
        _n === "an admin" ? ["internal-admin"] : ["internal-viewer"],
        authorization,
      );
      render(await open(teamId));
      expect(screen.getByTestId("access-sections")).toHaveAttribute(
        "data-department",
        department,
      );
    },
  );

  it("mounts no access sections when the viewer cannot be resolved", async () => {
    as(["internal-admin"]);
    loadViewer.mockResolvedValue(undefined);
    render(await open("t1"));
    expect(screen.queryByTestId("access-sections")).not.toBeInTheDocument();
  });
});
