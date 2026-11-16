import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { seedOrg, signInAs, type CallerName } from "@/test/scope-fixtures";
import { clearTable, ensureTestTable } from "@/test/test-support";

import DepartmentsPage from "./departments/page";
import RankingPage from "./ranking/page";
import ServicesPage from "./services/page";
import UsersPage from "./users/page";

// Source: Design System - "Access states and scoped labels" (callers below
// internal-org-admin see the "your teams" notice on organisation-wide KPIs,
// rankings and charts, not only on the Overview); implementation-phases Phase
// 4R.5; 4R.5 review round 1 blocker B2. Page layer, like
// page.integration.test.ts: real policy inputs from DynamoDB Local, only
// `@/auth` and the client content components are stubbed. The page shells are
// Server Components, so the returned element tree is searched for text without
// rendering it.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.fakeNextCache;
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
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

beforeAll(ensureTestTable);
beforeEach(async () => {
  const { resetFakeCache } = await import("@/test/next-cache-fake");
  resetFakeCache();
  await clearTable();
  await seedOrg();
});

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") return `${node}`;
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (typeof node === "object" && "props" in node) {
    return textOf((node.props as { children?: ReactNode }).children);
  }
  return "";
}

const NOTICE = /your teams/i;
const SCOPED: CallerName[] = ["memberA", "teamAdminA", "deptAdminEng"];
const GLOBAL: CallerName[] = ["admin", "orgAdmin", "auditor"];

describe.each([
  ["/dashboard/ranking", RankingPage],
  ["/dashboard/services", ServicesPage],
  ["/dashboard/users", UsersPage],
] as const)("%s scoped notice", (_path, Page) => {
  it.each(SCOPED)(
    "shows the your-teams notice to scoped caller %s",
    async (name) => {
      signInAs(name);
      expect(textOf(await Page())).toMatch(NOTICE);
    },
  );

  it.each(GLOBAL)("omits the notice for global reader %s", async (name) => {
    signInAs(name);
    expect(textOf(await Page())).not.toMatch(NOTICE);
  });
});

describe("/dashboard/departments scoped notice", () => {
  it("shows the your-teams notice to a department admin", async () => {
    signInAs("deptAdminEng");
    expect(textOf(await DepartmentsPage())).toMatch(NOTICE);
  });

  it.each(GLOBAL)("omits the notice for global reader %s", async (name) => {
    signInAs(name);
    expect(textOf(await DepartmentsPage())).not.toMatch(NOTICE);
  });
});
