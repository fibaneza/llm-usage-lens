import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { seedOrg, signInAs, type CallerName } from "@/test/scope-fixtures";
import { clearTable, ensureTestTable } from "@/test/test-support";

import DepartmentDetailPage from "./departments/[id]/page";
import DepartmentsPage from "./departments/page";
import RankingPage from "./ranking/page";
import ServicesPage from "./services/page";
import TeamDetailPage from "./teams/[id]/page";
import TeamsPage from "./teams/page";
import UsersPage from "./users/page";

// Source: Access Control - Navigation and landing by role (Usage group:
// organisation-level, admin / org admin / auditor only; lead and user: not
// offered) and "Hidden means absent and 404 ... its route returns the same 404
// body as a missing page (Enforcement item 2; Rule 10.3)"; Design System -
// Navigation (Sidebar); slice B1 brief B1-1 (visibility = the stored
// scope.global, not the role claim), B1-2 (every Usage route, both detail
// routes included, calls notFound() on the server for a non-global caller).
// This is a security matrix, so it stays complete: every Usage route x every
// caller class. Real policy inputs from DynamoDB Local (test/scope-fixtures.ts
// org); only `@/auth`, the Next navigation helpers and the client content
// components are stubbed. The page shells are Server Components, so calling
// them is the layer that sees the gate.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.fakeNextCache;
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/components/ranking/RankingContent", () => ({
  RankingContent: () => null,
}));
vi.mock("@/components/services/ServicesContent", () => ({
  ServicesContent: () => null,
}));
vi.mock("@/components/users/UsersContent", () => ({
  UsersContent: () => null,
}));
vi.mock("@/components/departments/DepartmentsContent", () => ({
  DepartmentsContent: () => null,
}));
vi.mock("@/components/departments/DepartmentDetailContent", () => ({
  DepartmentDetailContent: () => null,
}));
vi.mock("@/components/teams/TeamsContent", () => ({
  TeamsContent: () => null,
}));
vi.mock("@/components/teams/TeamDetailContent", () => ({
  TeamDetailContent: () => null,
}));

beforeAll(ensureTestTable);
beforeEach(async () => {
  const { resetFakeCache } = await import("@/test/next-cache-fake");
  resetFakeCache();
  await clearTable();
  await seedOrg();
});

type Outcome = "not-found" | "rendered" | { redirectedTo: string };

async function outcomeOf(render: () => unknown): Promise<Outcome> {
  try {
    await render();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "NEXT_NOT_FOUND") return "not-found";
    if (message.startsWith("NEXT_REDIRECT:")) {
      return { redirectedTo: message.slice("NEXT_REDIRECT:".length) };
    }
    throw error;
  }
  return "rendered";
}

const ROUTES: readonly [string, () => unknown][] = [
  ["/dashboard/ranking", () => RankingPage()],
  ["/dashboard/departments", () => DepartmentsPage()],
  [
    "/dashboard/departments/[id]",
    () => DepartmentDetailPage({ params: Promise.resolve({ id: "dept-eng" }) }),
  ],
  ["/dashboard/teams", () => TeamsPage()],
  [
    "/dashboard/teams/[id]",
    () => TeamDetailPage({ params: Promise.resolve({ id: "team-a" }) }),
  ],
  ["/dashboard/services", () => ServicesPage()],
  ["/dashboard/users", () => UsersPage()],
];

const GLOBAL: CallerName[] = ["admin", "orgAdmin", "auditor"];
const NON_GLOBAL: CallerName[] = [
  "viewerNone",
  "memberA",
  "memberB",
  "teamAdminA",
  "deptAdminEng",
];

describe.each(ROUTES)("%s (Usage route, B1-2)", (_path, render) => {
  it.each(GLOBAL)("renders for global reader %s", async (name) => {
    signInAs(name);
    expect(await outcomeOf(render)).toBe("rendered");
  });

  it.each(NON_GLOBAL)(
    "returns the not-found page for non-global caller %s",
    async (name) => {
      signInAs(name);
      expect(await outcomeOf(render)).toBe("not-found");
    },
  );

  it("sends an unauthenticated caller to sign in, never to a data page or a 404", async () => {
    signInAs(null);
    expect(await outcomeOf(render)).toEqual({ redirectedTo: "/sign-in" });
  });
});
