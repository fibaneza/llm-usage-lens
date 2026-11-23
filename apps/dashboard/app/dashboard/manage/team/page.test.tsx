import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Sources: Design System - Management pages, Team, "List, then the team
// (unit TM1; D-TM1, D-TM4)" and its agent decision on `?team=`; Access Control
// - Enforcement item 2 (TM1 sentence: the list holds only in-scope teams, the
// ?team= redirect lands on the same 404) and - Navigation and landing by role
// (Team: admin / org admin every team, auditor read-only, lead the teams it
// leads, user not offered; hidden means absent and 404); LiteLLM spec LD25;
// plan Rules 10.3, 50.3, 60.7.
//
// The team page itself (TeamPageContent, access sections, canRaiseLimits) is
// tested in [teamId]/page.test.tsx; the cases that used to live here for it
// moved there. This file covers the list page and the `?team=` redirect.
//
// Contract for the developer (app/dashboard/manage/team/page.tsx):
//   default async Server Component, props
//   { searchParams: Promise<{ team?: string; view?: string }> }.
//   `team` flag false -> notFound(). With ?team=<id>: a non-global caller whose
//   scope holds neither the id in teamScopes nor (via findTeamEntry) its
//   department in departmentScopes gets notFound(); otherwise
//   redirect(`/dashboard/manage/team/<id>`) keeping ?view= when present
//   (temporary redirect). Without ?team=: renders
//   <TeamListTable rows canCreateTeam scopeLabel /> from
//   "@/components/manage/TeamListTable", where rows come from the new server
//   module "@/lib/manage/team-list" `listTeamRows(): Promise<TeamListRow[]>`
//   (every registry and created team, unscoped: { teamId, teamName,
//   departmentId, departmentName, memberCount, litellmTeamId }) filtered by
//   the page: a global reader sees all; a lead sees the teams in its
//   teamScopes plus those whose departmentId is in its departmentScopes.
//   canCreateTeam: true for internal-admin and internal-org-admin only.
//   scopeLabel: scopeLabelFor(scope), null for a global reader.
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
  { teamId: "team-a", departmentId: "dept-eng", hasAwsAccount: true },
  { teamId: "team-c", departmentId: "dept-ops", hasAwsAccount: true },
  {
    teamId: "appteam-00000000-0000-4000-8000-000000000001",
    departmentId: "dept-eng",
    hasAwsAccount: false,
  },
];
vi.mock("@/lib/api/team-directory", () => ({
  findTeamEntry: async (teamId: string) =>
    DIRECTORY.find((e) => e.teamId === teamId) ?? null,
}));
const ROWS = [
  ["t1", "Payments", "dept-eng"],
  ["team-a", "Alpha", "dept-eng"],
  ["team-c", "Gamma", "dept-ops"],
  ["appteam-00000000-0000-4000-8000-000000000001", "Guild", "dept-eng"],
].map(([teamId, teamName, departmentId]) => ({
  teamId,
  teamName,
  departmentId,
  departmentName: departmentId === "dept-eng" ? "Engineering" : "Operations",
  memberCount: 2,
  litellmTeamId: teamId === "team-a" ? "alpha-llm" : null,
}));
vi.mock("@/lib/manage/team-list", () => ({
  listTeamRows: async () => ROWS,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock("@/components/manage/TeamListTable", () => ({
  TeamListTable: (props: {
    rows: { teamId: string }[];
    canCreateTeam: boolean;
    scopeLabel?: string | null;
  }) => (
    <div
      data-testid="list"
      data-create={String(props.canCreateTeam)}
      data-scope-label={props.scopeLabel ?? ""}
      data-rows={JSON.stringify(props.rows)}
    >
      {props.rows.map((r) => r.teamId).join(",")}
    </div>
  ),
}));

import TeamPage from "./page";

const open = async (query: { team?: string; view?: string } = {}) =>
  TeamPage({ searchParams: Promise.resolve(query) });

const as = (roles: string[], authorization: Record<string, unknown> = {}) => {
  auth.mockResolvedValue({ user: { oid: "o", roles, authMethod: "entra" } });
  loadAuthorization.mockResolvedValue({
    appEnv: "dev",
    roleGrants: [],
    ...authorization,
  });
};

const teamLead = (scopeId: string) => ({
  adminScopes: [{ source: "manual", scopeType: "team", scopeId }],
});
const deptLead = (scopeId: string) => ({
  adminScopes: [{ source: "manual", scopeType: "department", scopeId }],
});
const listed = () => screen.getByTestId("list").textContent;
type PassedRow = {
  teamId: string;
  litellmTeamId?: string | null;
  litellmLinked: boolean;
};
const passedRows = () =>
  JSON.parse(
    screen.getByTestId("list").getAttribute("data-rows") ?? "[]",
  ) as PassedRow[];

beforeEach(() => {
  as(["internal-viewer"]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("TeamPage list (/dashboard/manage/team; D-TM1)", () => {
  it("is a Server Component (Rule 60.7)", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "page.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/^\s*["']use client["']/m);
  });

  it.each([
    ["an internal-org-admin", ["internal-org-admin"], {}],
    ["the read-only internal-auditor", ["internal-auditor"], {}],
    ["an internal-admin", ["internal-admin"], {}],
    ["the legacy Admin alias outside prod", ["Admin"], {}],
    ["a Lead with a team scope", ["internal-viewer"], teamLead("t1")],
    [
      "a Lead with a department scope",
      ["internal-viewer"],
      deptLead("dept-eng"),
    ],
  ])("%s gets the list (Who)", async (_n, roles, authorization) => {
    as(roles, authorization);
    render(await open());
    expect(screen.getByTestId("list")).toBeInTheDocument();
  });

  // Hidden means absent and 404 (Access Control - Navigation and landing).
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
    await expect(open()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("no session gets notFound() (404 parity)", async () => {
    auth.mockResolvedValue(null);
    await expect(open()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  // the list shows only teams in scope.
  it.each([
    ["an admin", ["internal-admin"], {}],
    ["an org-admin", ["internal-org-admin"], {}],
    ["the auditor", ["internal-auditor"], {}],
  ])("%s sees every team (global reader)", async (_n, roles, authorization) => {
    as(roles, authorization);
    render(await open());
    expect(listed()).toBe(ROWS.map((r) => r.teamId).join(","));
  });

  it("a team Lead sees only the teams of its team scopes", async () => {
    as(["internal-viewer"], teamLead("team-a"));
    render(await open());
    expect(listed()).toBe("team-a");
  });

  it("a department Lead sees every team of its department, registry and created, and none of another (Access Control - Created app teams)", async () => {
    as(["internal-viewer"], deptLead("dept-eng"));
    render(await open());
    expect(listed()).toBe(
      "t1,team-a,appteam-00000000-0000-4000-8000-000000000001",
    );
  });

  it("a Lead holding a team scope and a department scope sees the union", async () => {
    as(["internal-viewer"], {
      adminScopes: [
        { source: "manual", scopeType: "team", scopeId: "team-c" },
        { source: "manual", scopeType: "department", scopeId: "dept-eng" },
      ],
    });
    render(await open());
    expect(listed()).toBe(
      "t1,team-a,team-c,appteam-00000000-0000-4000-8000-000000000001",
    );
  });

  // Q-B1 (review r1): Design System - "List, then the team", The LiteLLM team
  // column by role: admin, org-admin and auditor see the id; every other caller
  // gets only a linked / not-linked state and the id is not sent to the browser.
  it.each([
    ["an admin", ["internal-admin"], {}],
    ["an org-admin", ["internal-org-admin"], {}],
    ["the auditor", ["internal-auditor"], {}],
  ])(
    "%s gets the LiteLLM team id and the linked state in the rows",
    async (_n, roles, authorization) => {
      as(roles, authorization);
      render(await open());
      const rows = passedRows();
      expect(rows.find((r) => r.teamId === "team-a")).toMatchObject({
        litellmTeamId: "alpha-llm",
        litellmLinked: true,
      });
      expect(rows.find((r) => r.teamId === "t1")).toMatchObject({
        litellmLinked: false,
      });
    },
  );

  it.each([
    ["a team lead", teamLead("team-a")],
    ["a department lead", deptLead("dept-eng")],
  ])(
    "%s gets only a linked state: no LiteLLM team id reaches the rows",
    async (_n, authorization) => {
      as(["internal-viewer"], authorization);
      render(await open());
      const rows = passedRows();
      expect(rows.find((r) => r.teamId === "team-a")).toMatchObject({
        litellmLinked: true,
      });
      expect(rows.every((r) => !r.litellmTeamId)).toBe(true);
      expect(
        screen.getByTestId("list").getAttribute("data-rows"),
      ).not.toContain("alpha-llm");
    },
  );

  it.each([
    ["an internal-admin", ["internal-admin"], {}, "true"],
    ["the legacy Admin alias outside prod", ["Admin"], {}, "true"],
    ["an internal-org-admin", ["internal-org-admin"], {}, "true"],
    [
      "a stored internal-org-admin grant on a viewer claim (Rule 50.4)",
      ["internal-viewer"],
      { roleGrants: [{ role: "internal-org-admin" }] },
      "true",
    ],
    ["the read-only internal-auditor", ["internal-auditor"], {}, "false"],
    ["a Lead with a team scope", ["internal-viewer"], teamLead("t1"), "false"],
    [
      "a Lead with a department scope",
      ["internal-viewer"],
      deptLead("dept-eng"),
      "false",
    ],
  ])(
    "%s gets canCreateTeam=%s (D-TM4; New team: admin and org-admin only)",
    async (_n, roles, authorization, create) => {
      as(roles, authorization);
      render(await open());
      expect(screen.getByTestId("list")).toHaveAttribute("data-create", create);
    },
  );

  it.each([
    ["a team lead", teamLead("t1"), "Showing teams you lead"],
    ["a department lead", deptLead("d1"), "Showing departments you lead"],
  ])(
    "%s gets the scope label (scopeLabelFor)",
    async (_n, authorization, label) => {
      as(["internal-viewer"], authorization);
      render(await open());
      expect(screen.getByTestId("list")).toHaveAttribute(
        "data-scope-label",
        label,
      );
    },
  );

  it("a global reader gets no scope label", async () => {
    as(["internal-admin"]);
    render(await open());
    expect(screen.getByTestId("list")).toHaveAttribute("data-scope-label", "");
  });
});

// Agent decision (2026-11-23, TM1): /dashboard/manage/team?team=<id> is a
// temporary redirect to /dashboard/manage/team/<id>, keeping ?view=; out of
// scope is 404 there (Access Control - Enforcement item 2, TM1 sentence).
describe("TeamPage ?team= redirect (TM1 agent decision)", () => {
  // Q-W2 / nit (review r1): an empty ?team= is no team, so the list renders.
  it.each([
    ["an admin", ["internal-admin"], {}],
    ["a team lead", ["internal-viewer"], teamLead("t1")],
  ])(
    "%s with an empty ?team= gets the list",
    async (_n, roles, authorization) => {
      as(roles, authorization);
      render(await open({ team: "" }));
      expect(screen.getByTestId("list")).toBeInTheDocument();
    },
  );

  it("redirects ?team=<id> to the team page (global reader)", async () => {
    as(["internal-org-admin"]);
    await expect(open({ team: "t9" })).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard/manage/team/t9",
    );
  });

  it("keeps ?view= on the redirect", async () => {
    as(["internal-admin"]);
    await expect(open({ team: "t1", view: "budgets" })).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard/manage/team/t1?view=budgets",
    );
  });

  it("a Lead redirects for a team in its team scope", async () => {
    as(["internal-viewer"], teamLead("t1"));
    await expect(open({ team: "t1" })).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard/manage/team/t1",
    );
  });

  it("a Lead outside the scope gets notFound(), not a redirect (same 404)", async () => {
    as(["internal-viewer"], teamLead("t1"));
    await expect(open({ team: "t2" })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a department Lead redirects for a team in its department (registry and created) and gets notFound() outside it or for an unknown id", async () => {
    as(["internal-viewer"], deptLead("dept-eng"));
    await expect(open({ team: "team-a" })).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard/manage/team/team-a",
    );
    await expect(
      open({ team: "appteam-00000000-0000-4000-8000-000000000001" }),
    ).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard/manage/team/appteam-00000000-0000-4000-8000-000000000001",
    );
    await expect(open({ team: "team-c" })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(open({ team: "appteam-unknown" })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("a Viewer with ?team= gets notFound() (the gate runs first)", async () => {
    await expect(open({ team: "t1" })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
