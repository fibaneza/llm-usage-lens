import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CALLERS, seedOrg, signInAs } from "@/test/scope-fixtures";
import { clearTable, ensureTestTable } from "@/test/test-support";

import HomePage from "./page";

// Source: implementation-phases Phase 4R.5 ("role-aware landing"; Verify:
// seeded probe per role); Design System - "Access states and scoped labels"
// (Role-aware landing: internal-viewer and members -> My usage;
// internal-team-admin -> My teams; internal-org-admin, internal-admin,
// internal-auditor -> Overview); Access Control spec - Roles. The page reads
// the real policy inputs from DynamoDB Local (test/scope-fixtures.ts org);
// only `@/auth` and the Next redirect are stubbed. Agent decision 2026-11-16:
// the landing is the Server Component /dashboard/home (sign-in redirects
// there); /dashboard itself stays the Overview so scoped callers can reach it.
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

beforeAll(ensureTestTable);
beforeEach(async () => {
  const { resetFakeCache } = await import("@/test/next-cache-fake");
  resetFakeCache();
  await clearTable();
  await seedOrg();
});

async function landing(): Promise<string> {
  try {
    await HomePage();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("NEXT_REDIRECT:")) {
      return message.slice("NEXT_REDIRECT:".length);
    }
    throw error;
  }
  throw new Error("the landing page rendered instead of redirecting");
}

describe("/dashboard/home role-aware landing", () => {
  it.each([
    ["admin", "/dashboard"],
    ["orgAdmin", "/dashboard"],
    ["auditor", "/dashboard"],
    ["viewerNone", "/dashboard/me"],
    ["memberA", "/dashboard/me"],
    ["memberB", "/dashboard/me"],
    ["teamAdminA", "/dashboard/teams"],
    ["deptAdminEng", "/dashboard/departments/dept-eng"],
  ] as const)("lands %s on %s", async (name, path) => {
    signInAs(name);
    expect(await landing()).toBe(path);
  });

  it("sends an unauthenticated caller to sign in, never to a data page", async () => {
    signInAs(null);
    expect(await landing()).toBe("/sign-in");
  });

  it("uses the stored scope, not the role claim (a viewer-claim lead lands on their admin scope)", async () => {
    expect(CALLERS.teamAdminA.roles).toEqual(["internal-viewer"]);
    signInAs("teamAdminA");
    expect(await landing()).toBe("/dashboard/teams");
  });
});
