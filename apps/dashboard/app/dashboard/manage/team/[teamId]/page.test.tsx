import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import { cloneElement, isValidElement, type ReactNode } from "react";
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
    summary?: React.ReactNode;
  }) => (
    <div
      data-testid="team"
      data-team={props.teamId}
      data-raise={String(props.canRaiseLimits)}
      data-has-create={String(props.canCreateTeam !== undefined)}
      data-scope-label={props.scopeLabel ?? ""}
    >
      {props.summary}
      {props.access}
    </div>
  ),
}));

// Unit TP1 (Design System - Team page, round 3, Summary and Edit team). Contract
// for the developer: the page builds the summary on the server with
// loadTeamSummary(entry, { global }) from lib/manage/team-summary.ts (server-only;
// `global` is access.global: the LiteLLM alias and id are in the result only
// when true, ruling Q-B1) and renders it as <TeamSummaryPanel {...summary}
// canEdit /> passed to TeamPageContent as its `summary` prop. canEdit is true
// only for internal-admin and internal-org-admin (legacy Admin alias outside
// prod) on a created team (Access Control - Edit a created team).
const loadTeamSummary = vi.fn<
  (
    entry: { teamId: string; hasAwsAccount: boolean },
    opts: { global: boolean; range?: unknown },
  ) => Promise<Record<string, unknown>>
>(async (entry) => ({
  name: `name-of-${entry.teamId}`,
  departmentName: "Engineering",
  kind: entry.hasAwsAccount ? "registry" : "created",
  leadNames: [],
  memberCount: 0,
  litellm: null,
  budgetResetsInRange: 0,
  ...(entry.hasAwsAccount
    ? {}
    : {
        editTarget: {
          teamId: entry.teamId,
          name: `name-of-${entry.teamId}`,
          departmentId: "dept-eng",
          version: 1,
        },
      }),
}));
vi.mock("@/lib/manage/team-summary", () => ({
  loadTeamSummary: (entry: unknown, opts: unknown) =>
    loadTeamSummary(entry as never, opts as never),
}));
vi.mock("@/components/manage/TeamSummaryPanel", () => ({
  TeamSummaryPanel: (props: {
    kind: string;
    canEdit: boolean;
    editTarget?: { teamId: string };
  }) => (
    <div
      data-testid="summary"
      data-kind={props.kind}
      data-can-edit={String(props.canEdit)}
      data-edit-target={props.editTarget?.teamId ?? ""}
    />
  ),
}));

import { renderWithProviders } from "@/test/support/render-providers";

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
  // mockReset drops an unconsumed once-value (the never-resolving read the
  // page correctly never awaits) and restores the vi.fn(impl) default.
  loadTeamSummary.mockReset();
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

// Unit TP1 (Design System - Team page, round 3: Summary, Edit team; Access
// Control - Edit a created team, T-TP1, T-TP7). The role table of who gets
// canEdit is complete (Rule 60.24a: a security case). Guard for every canEdit
// row: page.tsx derives it from globalRolesOf(...) with INTERNAL_ADMIN_ROLE and
// INTERNAL_ORG_ADMIN_ROLE (lib/auth/roles.ts), never from scope.
// Resolves the async Server Components inside a returned tree (as a server
// would) so jsdom can render it. An async component that rejects becomes a
// component that throws, so the nearest error boundary around it decides what
// the page shows - the behaviour Rule 40.4 / 60.12 specify.
async function settled(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map((n) => settled(n)));
  if (!isValidElement(node)) return node;
  const element = node as React.ReactElement<Record<string, unknown>>;
  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(element.props)) {
    props[key] =
      key === "children" || isValidElement(value) || Array.isArray(value)
        ? await settled(value as ReactNode)
        : value;
  }
  const type = element.type as unknown;
  if (typeof type === "function" && type.constructor.name === "AsyncFunction") {
    try {
      return await settled(
        await (type as (p: unknown) => Promise<ReactNode>)(element.props),
      );
    } catch (error) {
      const Thrower = () => {
        throw error;
      };
      return <Thrower />;
    }
  }
  return cloneElement(element, props);
}

describe("TeamDetailPage summary and Edit team (TP1)", () => {
  const CREATED = "appteam-00000000-0000-4000-8000-000000000001";

  it("renders the summary for the route's team through TeamPageContent's summary slot", async () => {
    as(["internal-admin"]);
    render(await settled(await open(CREATED)));
    expect(screen.getByTestId("summary")).toHaveAttribute(
      "data-kind",
      "created",
    );
    expect(loadTeamSummary).toHaveBeenCalledTimes(1);
    expect(loadTeamSummary.mock.calls[0]?.[0]).toMatchObject({
      teamId: CREATED,
    });
  });

  it("a team from an AWS account is kind registry and carries no edit target", async () => {
    as(["internal-admin"]);
    render(await settled(await open("t1")));
    expect(screen.getByTestId("summary")).toHaveAttribute(
      "data-kind",
      "registry",
    );
    expect(screen.getByTestId("summary")).toHaveAttribute(
      "data-edit-target",
      "",
    );
  });

  it.each([
    ["an internal-admin", ["internal-admin"], {}, "true"],
    ["an internal-org-admin", ["internal-org-admin"], {}, "true"],
    ["the legacy Admin alias outside prod", ["Admin"], {}, "true"],
    ["the internal-auditor", ["internal-auditor"], {}, "false"],
    [
      "a department Lead of the team's department",
      ["internal-viewer"],
      deptLead("dept-eng"),
      "false",
    ],
    [
      "a team Lead of the team",
      ["internal-viewer"],
      teamLead(CREATED),
      "false",
    ],
    [
      "a stored internal-org-admin grant on a viewer claim (Rule 50.4)",
      ["internal-viewer"],
      { roleGrants: [{ role: "internal-org-admin" }] },
      "true",
    ],
  ])(
    "%s on a created team: canEdit follows the role table (T-TP7)",
    async (_n, roles, authorization, canEdit) => {
      as(roles, authorization);
      render(await settled(await open(CREATED)));
      expect(screen.getByTestId("summary")).toHaveAttribute(
        "data-can-edit",
        canEdit,
      );
      if (canEdit === "true") {
        expect(screen.getByTestId("summary")).toHaveAttribute(
          "data-edit-target",
          CREATED,
        );
      }
    },
  );

  it.each([
    ["an internal-admin", ["internal-admin"], {}, true],
    ["an internal-org-admin", ["internal-org-admin"], {}, true],
    ["the internal-auditor", ["internal-auditor"], {}, true],
    ["a Lead", ["internal-viewer"], deptLead("dept-eng"), false],
  ])(
    "%s: the summary is built with the matching global flag (the LiteLLM id only for global roles, ruling Q-B1; T-TP1)",
    async (_n, roles, authorization, isGlobal) => {
      as(roles, authorization);
      render(await settled(await open(CREATED)));
      expect(loadTeamSummary.mock.calls[0]?.[1]).toMatchObject({
        global: isGlobal,
      });
    },
  );

  it("a team outside the caller's scope is notFound() and no summary is loaded", async () => {
    as(["internal-viewer"], teamLead("t1"));
    await expect(open("t2")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(loadTeamSummary).not.toHaveBeenCalled();
  });

  // Q-B1 (Design System - Team page, round 3; Rule 40.4, 60.12: every page
  // section has its own Suspense + ErrorBoundary, one failing or slow section
  // never breaks or delays the page). Guard: page.tsx must not await
  // loadTeamSummary; the summary is an async TeamSummarySection inside
  // Suspense + SectionBoundary (page.tsx:61 today awaits it).
  it("a failing summary read does not break the page: the access sections render and the summary area shows its error fallback (Rule 40.4, 60.12)", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    loadTeamSummary.mockRejectedValueOnce(new Error("dynamo down"));
    as(["internal-admin"]);
    const tree = await open(CREATED);
    renderWithProviders(<>{await settled(tree)}</>);
    expect(screen.getByTestId("access-sections")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByTestId("summary")).not.toBeInTheDocument();
    quiet.mockRestore();
  });

  it("the page does not wait for the summary read: it returns while loadTeamSummary is still pending (Rule 60.12)", async () => {
    loadTeamSummary.mockReturnValueOnce(new Promise(() => {}));
    as(["internal-admin"]);
    const outcome = await Promise.race([
      open(CREATED).then(() => "returned"),
      new Promise((resolve) => setImmediate(() => resolve("waited"))),
    ]);
    expect(outcome).toBe("returned");
  });

  // Nit (review r1): editTarget is the edit form's data; give it only to a
  // caller who may edit. Guard: page.tsx passes editTarget only when canEdit.
  it.each([
    ["the internal-auditor", ["internal-auditor"], {}],
    ["a department Lead", ["internal-viewer"], deptLead("dept-eng")],
    ["a team Lead", ["internal-viewer"], teamLead(CREATED)],
  ])(
    "%s: the summary props carry no editTarget (T-TP7)",
    async (_n, roles, authorization) => {
      as(roles, authorization);
      render(await settled(await open(CREATED)));
      expect(screen.getByTestId("summary")).toHaveAttribute(
        "data-edit-target",
        "",
      );
    },
  );
});
