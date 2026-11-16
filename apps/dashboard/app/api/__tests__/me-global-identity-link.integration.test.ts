import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ctxAt, ok } from "@/test/support/access-test-support";
import { putIdentityLink } from "@/lib/data/access/identity-links";
import { CALLERS, RANGE, get, signInAs } from "@/test/fixtures/scope-fixtures";
import { seedOrg } from "@/test/fixtures/scope-fixtures";
import { clearTable, ensureTestTable } from "@/test/support/test-support";

import { GET as getMe } from "../me/route";
import { GET as getMeUsage } from "../me/usage/route";

// Source: docs/specs/2026-11-10-access-control.md - "Visibility and
// inheritance" (everyone always sees their own usage) and "Canonical usage
// identity". A global-role caller's identity link must still be honoured.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.fakeNextCache;
});

beforeAll(ensureTestTable);
beforeEach(async () => {
  const { resetFakeCache } = await import("@/test/fakes/next-cache-fake");
  resetFakeCache();
  await clearTable();
  await seedOrg();
});

const ALIAS = "a1@company.com"; // 7 x 3 days = 21
const USAGE_IDENTITY = "c1@company.com"; // 41 x 3 days = 123

describe.each(["admin", "auditor", "orgAdmin"] as const)(
  "a linked %s (global role)",
  (name) => {
    beforeEach(async () => {
      ok(
        await putIdentityLink(
          {
            oid: CALLERS[name].oid,
            usageIdentities: [USAGE_IDENTITY],
            aliases: [ALIAS],
            version: null,
          },
          ctxAt(undefined, "req-link"),
        ),
      );
      signInAs(name);
    });

    it("/api/me lists the alias and the usage identity", async () => {
      const { res, body } = await get(getMe, "/api/me");
      expect(res.status).toBe(200);
      const keys = (body.data as { usageIdentities: string[] }).usageIdentities;
      expect(keys).toEqual(expect.arrayContaining([ALIAS, USAGE_IDENTITY]));
    });

    it("/api/me/usage totals include both keys and exclude other people", async () => {
      const { res, body } = await get(getMeUsage, `/api/me/usage?${RANGE}`);
      expect(res.status).toBe(200);
      const totals = (body.data as { totals: { cost: number } }).totals;
      // a1 (21) + c1 (123); a2 (12), b1 (69), m1 (15) stay out.
      expect(totals.cost).toBe(144);
    });
  },
);
