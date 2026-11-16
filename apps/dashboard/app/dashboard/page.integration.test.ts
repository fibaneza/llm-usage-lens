import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CALLERS, seedOrg, signInAs } from "@/test/scope-fixtures";
import { clearTable, ensureTestTable } from "@/test/test-support";

import OverviewPage from "./page";

// Source: Access Control - Navigation and landing by role (Usage is
// organisation-level; landing: global -> Cost overview, lead and user -> My
// usage); Design System - Navigation (Sidebar) (a hidden item's route returns
// the same 404 as a missing page); slice B1 brief B1-1 (Usage visibility =
// scope.global, read from the stored scope, not the role claim), B1-3
// (`/dashboard` is the sign-in callback target: a non-global caller is
// redirected to /dashboard/me and the Overview content is never rendered;
// ?view=overview is removed and has no effect). Real policy inputs from
// DynamoDB Local (test/scope-fixtures.ts org); only `@/auth` and the Next
// redirect are stubbed.
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

beforeAll(ensureTestTable);
beforeEach(async () => {
  const { resetFakeCache } = await import("@/test/next-cache-fake");
  resetFakeCache();
  await clearTable();
  await seedOrg();
});

type Outcome = { redirectedTo: string } | { rendered: true };

// The page ignores the query after B1-3, so it may declare no props; the cast
// keeps these calls compiling either way while still sending the query.
const page = OverviewPage as unknown as (props: {
  searchParams: Promise<Record<string, string>>;
}) => Promise<unknown>;

async function visit(search: Record<string, string> = {}): Promise<Outcome> {
  try {
    await page({ searchParams: Promise.resolve(search) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("NEXT_REDIRECT:")) {
      return { redirectedTo: message.slice("NEXT_REDIRECT:".length) };
    }
    throw error;
  }
  return { rendered: true };
}

const GLOBAL = ["admin", "orgAdmin", "auditor"] as const;
const NON_GLOBAL = [
  "viewerNone",
  "memberA",
  "memberB",
  "teamAdminA",
  "deptAdminEng",
] as const;

describe("/dashboard (sign-in callback target; B1-3)", () => {
  it.each(GLOBAL)(
    "renders the Overview for global reader %s, no redirect",
    async (name) => {
      signInAs(name);
      expect(await visit()).toEqual({ rendered: true });
    },
  );

  it.each(NON_GLOBAL)(
    "redirects %s to /dashboard/me and never renders the Overview",
    async (name) => {
      signInAs(name);
      expect(await visit()).toEqual({ redirectedTo: "/dashboard/me" });
    },
  );

  // B1-3: ?view=overview is gone; it opts nobody out and changes nothing.
  it.each(NON_GLOBAL)(
    "?view=overview does not let %s see the Overview (still redirected)",
    async (name) => {
      signInAs(name);
      expect(await visit({ view: "overview" })).toEqual({
        redirectedTo: "/dashboard/me",
      });
    },
  );

  it("?view=overview has no effect for a global reader", async () => {
    signInAs("orgAdmin");
    expect(await visit({ view: "overview" })).toEqual({ rendered: true });
  });

  it("a date range alone does not let a non-global caller in", async () => {
    signInAs("memberA");
    expect(
      await visit({ dateFrom: "2026-01-01", dateTo: "2026-01-31" }),
    ).toEqual({ redirectedTo: "/dashboard/me" });
  });

  it("sends an unauthenticated caller to sign in, never to a data page", async () => {
    signInAs(null);
    expect(await visit()).toEqual({ redirectedTo: "/sign-in" });
  });

  it("uses the stored scope, not the role claim (a viewer-claim lead is still redirected)", async () => {
    expect(CALLERS.teamAdminA.roles).toEqual(["internal-viewer"]);
    signInAs("teamAdminA");
    expect(await visit()).toEqual({ redirectedTo: "/dashboard/me" });
  });
});
