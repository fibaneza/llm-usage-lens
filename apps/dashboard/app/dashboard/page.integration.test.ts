import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CALLERS, seedOrg, signInAs } from "@/test/scope-fixtures";
import { clearTable, ensureTestTable } from "@/test/test-support";

import OverviewPage from "./page";

// Source: implementation-phases Phase 4R.5 ("role-aware landing"; Verify:
// seeded probe per role); prompts/rbac_prompt.md R5 row (internal-viewer and
// member -> My usage, leads -> My team / My department, internal-org-admin,
// internal-admin, internal-auditor -> the Overview); Design System - "Access
// states and scoped labels". Ruling 2026-11-16: auth.ts keeps redirecting
// every sign-in to /dashboard, so this page does the landing server-side: a
// non-global caller without ?view=overview is redirected to landingPathFor;
// ?view=overview is the Overview link the sidebar offers scoped callers.
// Real policy inputs from DynamoDB Local; only `@/auth` and the Next redirect
// are stubbed.
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

type Outcome = { redirectedTo: string } | { rendered: true };

async function visit(search: Record<string, string> = {}): Promise<Outcome> {
  try {
    await OverviewPage({ searchParams: Promise.resolve(search) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("NEXT_REDIRECT:")) {
      return { redirectedTo: message.slice("NEXT_REDIRECT:".length) };
    }
    throw error;
  }
  return { rendered: true };
}

describe("/dashboard role-aware landing (sign-in always lands here)", () => {
  it.each([["admin"], ["orgAdmin"], ["auditor"]] as const)(
    "renders the Overview for global reader %s, no redirect",
    async (name) => {
      signInAs(name);
      expect(await visit()).toEqual({ rendered: true });
    },
  );

  it.each([
    ["viewerNone", "/dashboard/me"],
    ["memberA", "/dashboard/me"],
    ["memberB", "/dashboard/me"],
    ["teamAdminA", "/dashboard/teams"],
    ["deptAdminEng", "/dashboard/departments/dept-eng"],
  ] as const)("redirects %s to %s", async (name, path) => {
    signInAs(name);
    expect(await visit()).toEqual({ redirectedTo: path });
  });

  it.each([
    "viewerNone",
    "memberA",
    "teamAdminA",
    "deptAdminEng",
    "orgAdmin",
  ] as const)("?view=overview never redirects (%s)", async (name) => {
    signInAs(name);
    expect(await visit({ view: "overview" })).toEqual({ rendered: true });
  });

  it("redirects on a date range alone: only view=overview opts out", async () => {
    signInAs("memberA");
    expect(
      await visit({ dateFrom: "2026-01-01", dateTo: "2026-01-31" }),
    ).toEqual({ redirectedTo: "/dashboard/me" });
  });

  it("uses the stored scope, not the role claim (viewer-claim lead lands on their admin scope)", async () => {
    expect(CALLERS.teamAdminA.roles).toEqual(["internal-viewer"]);
    signInAs("teamAdminA");
    expect(await visit()).toEqual({ redirectedTo: "/dashboard/teams" });
  });
});
