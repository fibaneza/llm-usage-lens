import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Sources: Access Control - MI-D7 (Team usage and the teamUsage flag: a global
// reader opens any team; a caller with a live team or department admin scope
// opens the teams of that scope; everyone else, and a team outside the list,
// get the missing-page 404) and T-MI4 (a lead never sees another team's
// spend); Access Control - Navigation and landing by role (Team usage row);
// App Teams spec - AT6 (include=memberSum is for a global reader only, so the
// page passes includeMemberSum = global); Design System - Scoped labels
// (scopeLabelFor, none for a global reader); Rules 10.3, 60.7.
// The page reads managementAccessFor, viewableTeams and scopeLabelFor for
// real; only the stores and the client body are replaced.
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
vi.mock("next/cache", () => ({
  unstable_cache: <T,>(fn: T) => fn,
  revalidateTag: vi.fn(),
}));
vi.mock("@/lib/data/account-meta", () => ({
  getAccountsByDepartment: async () => [],
  getAllAccounts: async () => [
    {
      teamId: "team-a",
      teamName: "Alpha",
      departmentId: "dept-eng",
      departmentName: "Engineering",
    },
    {
      teamId: "team-b",
      teamName: "Beta",
      departmentId: "dept-eng",
      departmentName: "Engineering",
    },
    {
      teamId: "team-c",
      teamName: "Gamma",
      departmentId: "dept-ops",
      departmentName: "Operations",
    },
  ],
}));
vi.mock("@/lib/data/access/app-teams", () => ({
  listAppTeams: async () => [
    {
      teamId: "appteam-1",
      name: "Created",
      departmentId: "dept-eng",
      departmentName: "Engineering",
    },
  ],
}));
vi.mock("@/lib/data/litellm/team-links", () => ({
  listTeamLinks: async () => [{ teamId: "team-a", litellmTeamId: "llm-a" }],
  getTeamLink: async () => null,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock("@/components/manage/TeamUsageContent", () => ({
  TeamUsageContent: (props: {
    teams: { teamId: string; teamName: string; linked: boolean }[];
    includeMemberSum: boolean;
    scopeLabel: string | null;
  }) => (
    <div
      data-testid="usage"
      data-member-sum={String(props.includeMemberSum)}
      data-scope-label={props.scopeLabel ?? ""}
      data-teams={props.teams.map((t) => t.teamId).join(",")}
      data-linked={props.teams
        .filter((t) => t.linked)
        .map((t) => t.teamId)
        .join(",")}
    />
  ),
}));

import TeamUsagePage from "./page";

const open = async (team?: string) =>
  TeamUsagePage({ searchParams: Promise.resolve(team ? { team } : {}) });

const as = (roles: string[], authorization: Record<string, unknown> = {}) => {
  const session = { user: { oid: "o", roles, authMethod: "entra" } };
  auth.mockResolvedValue(session);
  loadAuthorization.mockResolvedValue({
    appEnv: "dev",
    session,
    affiliation: null,
    adminScopes: [],
    roleGrants: [],
    identity: null,
    identityLink: null,
    visibility: { teams: new Map(), departments: new Map() },
    perUserApproved: false,
    ...authorization,
  });
};

const teamScope = (scopeId: string) => ({
  adminScopes: [{ source: "manual", scopeType: "team", scopeId }],
});
const deptScope = (scopeId: string) => ({
  adminScopes: [{ source: "manual", scopeType: "department", scopeId }],
});

// Listed by team name: Alpha, Beta, Created, Gamma.
const ALL_TEAMS = "team-a,team-b,appteam-1,team-c";

beforeEach(() => {
  as(["internal-viewer"]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("TeamUsagePage (/dashboard/team-usage)", () => {
  it("is a Server Component (Rule 60.7)", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "page.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/^\s*["']use client["']/m);
  });

  // MI-D7: global readers open any team, with the member sum offered (AT6).
  it.each([
    ["an internal-admin", ["internal-admin"]],
    ["an internal-org-admin", ["internal-org-admin"]],
    ["the read-only internal-auditor", ["internal-auditor"]],
  ])(
    "%s sees every team, registry and created, with includeMemberSum true and no scope line (MI-D7, AT6)",
    async (_n, roles) => {
      as(roles);
      render(await open());
      const page = screen.getByTestId("usage");
      expect(page).toHaveAttribute("data-teams", ALL_TEAMS);
      expect(page).toHaveAttribute("data-member-sum", "true");
      expect(page).toHaveAttribute("data-scope-label", "");
    },
  );

  it("marks a team linked to LiteLLM in the list handed to the client (Spend source)", async () => {
    as(["internal-admin"]);
    render(await open());
    expect(screen.getByTestId("usage")).toHaveAttribute(
      "data-linked",
      "team-a",
    );
  });

  // MI-D7 + LT28: a lead never gets the member sum, and sees only its scope.
  it("a team-scope lead sees only its team, includeMemberSum false (MI-D7, T-MI4, LT28)", async () => {
    as(["internal-viewer"], teamScope("team-b"));
    render(await open());
    const page = screen.getByTestId("usage");
    expect(page).toHaveAttribute("data-teams", "team-b");
    expect(page).toHaveAttribute("data-member-sum", "false");
    expect(page).toHaveAttribute("data-scope-label", "Showing teams you lead");
  });

  it("a department-scope lead sees its department's teams, created teams included, includeMemberSum false (MI-D7, LT28)", async () => {
    as(["internal-viewer"], deptScope("dept-eng"));
    render(await open());
    const page = screen.getByTestId("usage");
    expect(page).toHaveAttribute("data-teams", "team-a,team-b,appteam-1");
    expect(page).toHaveAttribute("data-member-sum", "false");
    expect(page).toHaveAttribute(
      "data-scope-label",
      "Showing departments you lead",
    );
  });

  it("a stored global role on a viewer claim counts like the claim (Rule 50.4)", async () => {
    as(["internal-viewer"], { roleGrants: [{ role: "internal-auditor" }] });
    render(await open());
    const page = screen.getByTestId("usage");
    expect(page).toHaveAttribute("data-teams", ALL_TEAMS);
    expect(page).toHaveAttribute("data-member-sum", "true");
  });

  // MI-D7: "everyone else ... gets the missing-page 404".
  it.each([
    ["a Viewer", ["internal-viewer"], {}],
    ["no role claim", [], {}],
    [
      "a plain team member (affiliation, no admin scope)",
      ["internal-viewer"],
      { affiliation: { teamId: "team-a", departmentId: "dept-eng" } },
    ],
    [
      "a lead whose only scope is suspended (sso, groupsOverage)",
      ["internal-viewer"],
      {
        identity: { groupsOverage: true },
        adminScopes: [{ source: "sso", scopeType: "team", scopeId: "team-a" }],
      },
    ],
  ])("%s gets notFound() (MI-D7)", async (_n, roles, authorization) => {
    as(roles, authorization);
    await expect(open()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("no session gets notFound() (MI-D7, Rule 10.3)", async () => {
    auth.mockResolvedValue(null);
    await expect(open()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  // ?team= handling.
  it("a global reader opening ?team= of a listed team gets the page", async () => {
    as(["internal-auditor"]);
    render(await open("team-c"));
    expect(screen.getByTestId("usage")).toBeInTheDocument();
  });

  it("a lead opening ?team= inside its scope gets the page (MI-D7)", async () => {
    as(["internal-viewer"], teamScope("team-b"));
    render(await open("team-b"));
    expect(screen.getByTestId("usage")).toBeInTheDocument();
  });

  it("a department lead opening ?team= of a created team in its department gets the page (MI-D7)", async () => {
    as(["internal-viewer"], deptScope("dept-eng"));
    render(await open("appteam-1"));
    expect(screen.getByTestId("usage")).toBeInTheDocument();
  });

  // T-MI4: a lead never sees another team's spend; same 404 as a missing page.
  it.each([
    ["a team lead, another team", teamScope("team-b"), "team-a"],
    [
      "a team lead, a team of another department",
      teamScope("team-b"),
      "team-c",
    ],
    ["a department lead, another department", deptScope("dept-eng"), "team-c"],
  ])(
    "%s: ?team= outside the caller's list is notFound() (T-MI4)",
    async (_n, authorization, team) => {
      as(["internal-viewer"], authorization);
      await expect(open(team)).rejects.toThrow("NEXT_NOT_FOUND");
    },
  );

  it.each([
    ["an internal-admin", ["internal-admin"], {}],
    ["a team lead", ["internal-viewer"], teamScope("team-b")],
  ])(
    "%s: an unknown ?team= is notFound(), the same response as a missing page (MI-D7)",
    async (_n, roles, authorization) => {
      as(roles, authorization);
      await expect(open("no-such-team")).rejects.toThrow("NEXT_NOT_FOUND");
    },
  );
});
