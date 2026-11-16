import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CALLERS, seedOrg, signInAs } from "@/test/fixtures/scope-fixtures";
import { clearTable, ensureTestTable } from "@/test/support/test-support";

import HomePage from "./page";

// Source: Access Control - Navigation and landing by role ("Landing page:
// admin and org admin -> Cost overview (/dashboard); lead and user -> My usage
// (/dashboard/me). This replaces the 4R.5 My teams landing for a lead");
// Auditor -> Cost overview; slice B1 brief B1-3 and B1-4. The page reads the
// real policy inputs from DynamoDB Local (test/fixtures/scope-fixtures.ts org); only
// `@/auth` and the Next redirect are stubbed. /dashboard/home keeps working as
// the landing redirect for a bookmarked URL.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
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

beforeAll(ensureTestTable);
beforeEach(async () => {
  const { resetFakeCache } = await import("@/test/fakes/next-cache-fake");
  resetFakeCache();
  await clearTable();
  await seedOrg();
});

// The query is ignored (B1-3); the cast lets the call carry ?view=overview
// whether or not the page declares props.
const home = HomePage as unknown as (props?: {
  searchParams: Promise<Record<string, string>>;
}) => Promise<unknown>;

async function landing(search?: Record<string, string>): Promise<string> {
  try {
    await home(
      search === undefined
        ? undefined
        : { searchParams: Promise.resolve(search) },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("NEXT_REDIRECT:")) {
      return message.slice("NEXT_REDIRECT:".length);
    }
    throw error;
  }
  throw new Error("the landing page rendered instead of redirecting");
}

describe("/dashboard/home role-aware landing (B1-3, B1-4)", () => {
  it.each([
    ["admin", "/dashboard"],
    ["orgAdmin", "/dashboard"],
    ["auditor", "/dashboard"],
    ["viewerNone", "/dashboard/me"],
    ["memberA", "/dashboard/me"],
    ["memberB", "/dashboard/me"],
    ["teamAdminA", "/dashboard/me"],
    ["deptAdminEng", "/dashboard/me"],
  ] as const)("lands %s on %s", async (name, path) => {
    signInAs(name);
    expect(await landing()).toBe(path);
  });

  it.each(["viewerNone", "memberA", "teamAdminA", "deptAdminEng"] as const)(
    "?view=overview does not change where %s lands",
    async (name) => {
      signInAs(name);
      expect(await landing({ view: "overview" })).toBe("/dashboard/me");
    },
  );

  it("sends an unauthenticated caller to sign in, never to a data page", async () => {
    signInAs(null);
    expect(await landing()).toBe("/sign-in");
  });

  it("uses the stored scope, not the role claim (a viewer-claim lead lands on My usage)", async () => {
    expect(CALLERS.teamAdminA.roles).toEqual(["internal-viewer"]);
    signInAs("teamAdminA");
    expect(await landing()).toBe("/dashboard/me");
  });
});
