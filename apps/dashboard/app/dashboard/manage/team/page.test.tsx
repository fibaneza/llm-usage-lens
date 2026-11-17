import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Sources: Design System - Management pages (Team: "lead for the teams it
// leads, internal-org-admin and internal-admin for every team;
// internal-auditor read-only"; the ScopeLine for a lead; "Lead's other
// team-scoped access actions": the page mounts the Access sections the
// viewer's capabilities allow); Access Control - Navigation and landing by
// role (Team: admin / org admin every team, auditor read-only, lead the teams
// it leads, user not offered; Hidden means absent and 404); slice B2 brief
// B2-4; LiteLLM spec - Team configuration page / LD25-LD26 (only
// internal-admin raises limits; the legacy Admin alias outside prod counts;
// a suspended SSO scope grants nothing; a stored grant counts, Rule 50.4;
// "A team outside the caller's scope returns the same 404"); Rules 10.3,
// 50.3, 60.7. These cases moved from the retired
// litellm/team-config/page.test.tsx; the auditor case is the one change
// (read-only access now, the old page gave it a 404). The full caller x route
// matrix runs in __tests__/manage-routes.integration.test.ts.
//
// Contract for the developer (app/dashboard/manage/team/page.tsx):
//   default async Server Component, props
//   { searchParams: Promise<{ team?: string }> }. Roles and live scopes resolve
//   through lib/manage-access (managementAccessFor) and the same primitives the
//   old team-config page used. `team` flag false -> notFound(). With a
//   non-global caller and ?team=<id>, the id must be in scope.teamScopes or
//   belong (via getAllAccounts) to one of scope.departmentScopes, else
//   notFound(); a global reader (admin, org admin, auditor) may open any team.
//   Renders <TeamPageContent canRaiseLimits scopeLabel access /> from
//   "@/components/manage/TeamPageContent":
//     canRaiseLimits: boolean, true only for internal-admin;
//     scopeLabel: string | null, scopeLabelFor(scope) (null for a global
//       reader), the client adds the team names;
//     access: ReactNode | undefined, an <AccessSections viewer stepUp
//       sections={["members","team-admins","pending-access","visibility"]} />
//       when the viewer resolves and has at least one of those sections,
//       otherwise undefined.
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
vi.mock("@/lib/data/account-meta", () => ({
  getAllAccounts: async () => [
    { teamId: "team-a", departmentId: "dept-eng" },
    { teamId: "team-c", departmentId: "dept-ops" },
  ],
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
  AccessSections: (props: { sections: string[] }) => (
    <div data-testid="access-sections">{props.sections.join(",")}</div>
  ),
}));
vi.mock("@/components/manage/TeamPageContent", () => ({
  TeamPageContent: (props: {
    canRaiseLimits: boolean;
    scopeLabel: string | null;
    access?: React.ReactNode;
  }) => (
    <div
      data-testid="team"
      data-raise={String(props.canRaiseLimits)}
      data-scope-label={props.scopeLabel ?? ""}
    >
      {props.access}
    </div>
  ),
}));

import TeamPage from "./page";

const open = async (team?: string) =>
  TeamPage({ searchParams: Promise.resolve(team ? { team } : {}) });

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

beforeEach(() => {
  as(["internal-viewer"]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("TeamPage (/dashboard/manage/team)", () => {
  it("is a Server Component (Rule 60.7)", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "page.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/^\s*["']use client["']/m);
  });

  // Who: lead, org admin, admin get the page; only admin may raise (LD26); the
  // auditor reads it (Access Control matrix) and cannot raise.
  it.each([
    [
      "a Lead with a team admin scope",
      ["internal-viewer"],
      { adminScopes: [{ source: "manual", scopeType: "team", scopeId: "t1" }] },
      "false",
    ],
    [
      "a Lead with a department admin scope",
      ["internal-viewer"],
      {
        adminScopes: [
          { source: "manual", scopeType: "department", scopeId: "d1" },
        ],
      },
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
    render(await open());
    expect(screen.getByTestId("team")).toHaveAttribute("data-raise", raise);
  });

  // Hidden means absent and 404.
  it.each([
    ["a Viewer", ["internal-viewer"], {}],
    ["no role claim", [], {}],
    [
      "a plain team member (affiliation, no admin scope)",
      ["internal-viewer"],
      { affiliation: { teamId: "t1", departmentId: "d1" } },
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
    await expect(open()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("no session gets notFound() (404 parity)", async () => {
    auth.mockResolvedValue(null);
    await expect(open()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  // Who: "A team outside the caller's scope returns the same 404".
  it("a Lead opening ?team= inside its scope gets the page; outside it, notFound()", async () => {
    as(["internal-viewer"], {
      adminScopes: [{ source: "manual", scopeType: "team", scopeId: "t1" }],
    });
    render(await open("t1"));
    expect(screen.getByTestId("team")).toBeInTheDocument();
    await expect(open("t2")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  // Coordinator ruling 2026-11-16: a department-scope Lead may open ?team= for
  // any team in its department (the write routes' scope).
  it("a department Lead opening ?team= of a team in its department gets the page; outside it, notFound()", async () => {
    as(["internal-viewer"], {
      adminScopes: [
        { source: "manual", scopeType: "department", scopeId: "dept-eng" },
      ],
    });
    render(await open("team-a"));
    expect(screen.getByTestId("team")).toBeInTheDocument();
    await expect(open("team-c")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each([
    ["an org-admin", ["internal-org-admin"]],
    ["the auditor", ["internal-auditor"]],
  ])("%s may open any ?team= (global scope)", async (_n, roles) => {
    as(roles);
    render(await open("t9"));
    expect(screen.getByTestId("team")).toBeInTheDocument();
  });
});

// B2-4: the ScopeLine label for a non-global caller; none for a global reader.
describe("TeamPage scope line label (Design System - Scoped labels; scopeLabelFor)", () => {
  it.each([
    [
      "a team lead",
      ["internal-viewer"],
      { adminScopes: [{ source: "manual", scopeType: "team", scopeId: "t1" }] },
      "Showing teams you lead",
    ],
    [
      "a department lead",
      ["internal-viewer"],
      {
        adminScopes: [
          { source: "manual", scopeType: "department", scopeId: "d1" },
        ],
      },
      "Showing departments you lead",
    ],
    ["an admin", ["internal-admin"], {}, ""],
    ["the auditor", ["internal-auditor"], {}, ""],
  ])("%s", async (_n, roles, authorization, label) => {
    as(roles, authorization);
    render(await open());
    expect(screen.getByTestId("team")).toHaveAttribute(
      "data-scope-label",
      label,
    );
  });
});

// B2-4: the lead's team-scoped access surface now that Settings is closed to
// it. AccessSections filters by capability itself; the page chooses the four
// team-level sections and mounts nothing for a caller with none of them.
describe("TeamPage access sections (B2-4)", () => {
  it.each([
    [
      "a team lead",
      ["internal-viewer"],
      { adminScopes: [{ source: "manual", scopeType: "team", scopeId: "t1" }] },
    ],
    ["an org admin", ["internal-org-admin"], {}],
    ["an admin", ["internal-admin"], {}],
  ])(
    "%s gets the four team-level sections",
    async (_n, roles, authorization) => {
      as(roles, authorization);
      render(await open());
      expect(screen.getByTestId("access-sections")).toHaveTextContent(
        "members,team-admins,pending-access,visibility",
      );
    },
  );

  it("the auditor (read-only) is offered the sections list too, and the sections' own capability filter hides what it may not read", async () => {
    as(["internal-auditor"]);
    render(await open());
    expect(screen.getByTestId("access-sections")).toHaveTextContent(
      "members,team-admins,pending-access,visibility",
    );
  });

  it("mounts no access sections when the viewer cannot be resolved", async () => {
    as(["internal-admin"]);
    loadViewer.mockResolvedValue(undefined);
    render(await open());
    expect(screen.queryByTestId("access-sections")).not.toBeInTheDocument();
  });
});
