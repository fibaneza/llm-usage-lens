import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Sources: docs/specs/2026-11-10-litellm.md -- "Team configuration page (L4)"
// (Who: a Lead for the teams in its scope, internal-org-admin and
// internal-admin; a Viewer, plain member and the Auditor get the standard
// not-found page, 404 parity; a team outside the caller's scope the same),
// LD25, LD26 + "Writes" (only internal-admin sets or raises; org-admin is a
// Lead and lowers only), "Budgets and limits"; Access Control
// -- Enforcement item 2 (404 parity); Rules 10.3, 50.3, 50.4, 60.7.
//
// Contract for the developer (app/dashboard/litellm/team-config/page.tsx):
//   default async Server Component, props { searchParams: Promise<{ team?: string }> }.
//   Roles and live scopes resolve exactly as app/dashboard/litellm/page.tsx
//   does (authorizationFor + globalRolesOf + resolveScope). Allowed: Admin,
//   org-admin (global: any ?team=), or a Lead (any team or department admin
//   scope that is live). Everything else, including no session, calls
//   notFound(). With a Lead and ?team=<id> the id must be in
//   scope.teamScopes (a department-scope Lead's ?team= must belong to
//   one of its departments (department via getAllAccounts, as the write routes).
//   Renders <TeamConfigContent canRaiseLimits={boolean} /> from
//   "@/components/litellm/TeamConfigContent"; canRaiseLimits is true only for
//   internal-admin (the legacy Admin alias outside prod counts); org-admin and
//   a Lead lower only (LD26). org-admin still opens the page for any ?team=.
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
// A department Lead's ?team= is resolved like the write routes do: the team's
// department from getAllAccounts().
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
}));
vi.mock("@/components/litellm/TeamConfigContent", () => ({
  TeamConfigContent: (props: { canRaiseLimits: boolean }) => (
    <div data-testid="config" data-raise={String(props.canRaiseLimits)} />
  ),
}));

import TeamConfigPage from "./page";

const open = async (team?: string) =>
  TeamConfigPage({ searchParams: Promise.resolve(team ? { team } : {}) });

const as = (roles: string[], authorization: Record<string, unknown> = {}) => {
  auth.mockResolvedValue({ user: { oid: "o", roles } });
  loadAuthorization.mockResolvedValue({
    appEnv: "dev",
    roleGrants: [],
    ...authorization,
  });
};

beforeEach(() => {
  as(["internal-viewer"]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("TeamConfigPage (/dashboard/litellm/team-config)", () => {
  it("is a Server Component (Rule 60.7)", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "page.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/^\s*["']use client["']/m);
  });

  // Who: Lead, org-admin, Admin get the page; only the last two may raise.
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
    expect(screen.getByTestId("config")).toHaveAttribute("data-raise", raise);
  });

  // Who + LD25: every other caller gets notFound() (404 parity).
  it.each([
    ["a Viewer", ["internal-viewer"], {}],
    ["no role claim", [], {}],
    [
      "a plain team member (affiliation, no admin scope)",
      ["internal-viewer"],
      { affiliation: { teamId: "t1", departmentId: "d1" } },
    ],
    ["the Auditor (user direction: no page)", ["internal-auditor"], {}],
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
    expect(screen.getByTestId("config")).toBeInTheDocument();
    await expect(open("t2")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  // Coordinator ruling 2026-11-16: a department-scope Lead may open ?team=
  // for any team in its department (the write routes' scope).
  it("a department Lead opening ?team= of a team in its department gets the page; outside it, notFound()", async () => {
    as(["internal-viewer"], {
      adminScopes: [
        { source: "manual", scopeType: "department", scopeId: "dept-eng" },
      ],
    });
    render(await open("team-a"));
    expect(screen.getByTestId("config")).toBeInTheDocument();
    await expect(open("team-c")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("an org-admin may open any ?team= (global scope)", async () => {
    as(["internal-org-admin"]);
    render(await open("t9"));
    expect(screen.getByTestId("config")).toBeInTheDocument();
  });
});
