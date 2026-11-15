import { join } from "node:path";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { putIdentityLink } from "@/lib/data/access/identity-links";
import { ctxAt, ok } from "@/lib/data/access/access-test-support";
import {
  CALLERS,
  RANGE,
  get,
  numbersIn,
  seedOrg,
  signInAs,
} from "@/test/scope-fixtures";
import { clearTable, ensureTestTable, putRaw } from "@/test/test-support";

import { GET as getAccounts } from "./accounts/route";
import { GET as getSyncStatus } from "./sync-status/route";
import { GET as getTeams } from "./teams/route";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (/api/me, /api/me/usage: any signed-in role), "Enforcement" items 3-5,
// "Membership..." (SSO scopes suspended during overage), threats T6, T14.
// /api/me response fields are unspecced: only the {data} shape and that no
// other person's data appears are asserted. CSV, search and the command menu
// have no server route today (they serialise or filter already-scoped rows
// client-side), so nothing server-side is asserted for them.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.fakeNextCache;
});

const API_DIR = __dirname;
const ids = (body: { data?: unknown }) =>
  (body.data as { teamId: string }[]).map((a) => a.teamId).sort();

beforeAll(ensureTestTable);
beforeEach(async () => {
  const { resetFakeCache } = await import("@/test/next-cache-fake");
  resetFakeCache();
  await clearTable();
  await seedOrg();
});

describe("GET /api/accounts is scoped", () => {
  it.each([
    ["viewerNone", []],
    ["memberA", ["team-a"]],
    ["teamAdminA", ["team-a"]],
    ["admin", ["team-a", "team-b", "team-c", "team-m"]],
    ["auditor", ["team-a", "team-b", "team-c", "team-m"]],
  ] as const)("as %s", async (name, expected) => {
    signInAs(name);
    expect(ids((await get(getAccounts, "/api/accounts")).body)).toEqual([
      ...expected,
    ]);
  });

  it("a department scope lists its department's accounts and not another's", async () => {
    signInAs("deptAdminEng");
    const list = ids((await get(getAccounts, "/api/accounts")).body);
    expect(list).toEqual(expect.arrayContaining(["team-a", "team-b"]));
    expect(list).not.toContain("team-c");
  });
});

describe("GET /api/sync-status is any signed-in role", () => {
  it("401 unauthenticated, 200 with the data shape for a viewer without affiliation", async () => {
    signInAs(null);
    expect((await get(getSyncStatus, "/api/sync-status")).res.status).toBe(401);
    signInAs("viewerNone");
    const { res, body } = await get(getSyncStatus, "/api/sync-status");
    expect(res.status).toBe(200);
    expect(body).toHaveProperty("data");
  });
});

describe("SSO scope suspended during groups overage, at the route", () => {
  const identity = (groupsOverage: boolean) =>
    putRaw({
      PK: `IDENT#${CALLERS.viewerNone.oid}`,
      SK: "META",
      gsi1pk: "IDENTS",
      gsi1sk: `IDENT#${CALLERS.viewerNone.oid}`,
      oid: CALLERS.viewerNone.oid,
      tid: "t",
      lastSignInAt: "2026-11-14T10:00:00.000Z",
      lastSeenRoles: [],
      authMethod: "entra",
      version: 1,
      groupsOverage,
    });
  const ssoScope = () =>
    putRaw({
      PK: `IDENT#${CALLERS.viewerNone.oid}`,
      SK: "ADMINSCOPE#TEAM#team-a",
      gsi1pk: "ADMINS#TEAM#team-a",
      gsi1sk: `IDENT#${CALLERS.viewerNone.oid}`,
      oid: CALLERS.viewerNone.oid,
      scopeType: "team",
      scopeId: "team-a",
      source: "sso",
      version: 1,
      createdAt: "2026-11-14T10:00:00.000Z",
      createdBy: "system",
    });
  const teamIds = async () =>
    (
      (await get(getTeams, `/api/teams?${RANGE}`)).body.data as {
        teams: { teamId: string }[];
      }
    ).teams.map((t) => t.teamId);

  it("reads its team without overage and nothing with it", async () => {
    await ssoScope();
    await identity(false);
    signInAs("viewerNone");
    expect(await teamIds()).toEqual(["team-a"]);
    await identity(true);
    expect(await teamIds()).toEqual([]);
  });
});

describe("/api/me and /api/me/usage", () => {
  async function load(path: string) {
    const mod: Record<string, unknown> = await import(
      /* @vite-ignore */ join(API_DIR, path, "route.ts")
    );
    return mod.GET;
  }

  it("401 when unauthenticated, 200 with { data } for every signed-in role", async () => {
    for (const path of ["me", "me/usage"]) {
      const handler = await load(path);
      signInAs(null);
      expect((await get(handler, `/api/${path}?${RANGE}`)).res.status).toBe(
        401,
      );
      for (const name of Object.keys(CALLERS) as (keyof typeof CALLERS)[]) {
        signInAs(name);
        const { res, body } = await get(handler, `/api/${path}?${RANGE}`);
        expect(res.status).toBe(200);
        expect(body).toHaveProperty("data");
        expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      }
    }
  });

  it("/api/me never contains another person's identifiers", async () => {
    const handler = await load("me");
    signInAs("memberA");
    const text = JSON.stringify((await get(handler, "/api/me")).body);
    for (const other of ["memberB", "teamAdminA", "admin"] as const) {
      expect(text).not.toContain(CALLERS[other].oid);
      expect(text).not.toContain(CALLERS[other].email);
    }
  });

  it("/api/me/usage returns only the caller's own usage (member)", async () => {
    const handler = await load("me/usage");
    signInAs("memberA");
    const { body } = await get(handler, `/api/me/usage?${RANGE}`);
    const seen = numbersIn(body);
    expect(seen.has(21)).toBe(true); // a1: 7 x 3 days
    for (const forbidden of [12, 33, 69, 123])
      expect(seen.has(forbidden)).toBe(false);
    expect(JSON.stringify(body)).not.toContain("a2@company.com");
  });

  it("/api/me/usage follows the identity link, and usage alone grants nothing (T6)", async () => {
    const handler = await load("me/usage");
    signInAs("viewerNone", "c1@company.com"); // email matches byUser but no link
    const unlinked = numbersIn(
      (await get(handler, `/api/me/usage?${RANGE}`)).body,
    );
    expect(unlinked.has(123)).toBe(true); // canonical email matches c1 itself
    signInAs("viewerNone");
    expect(
      numbersIn((await get(handler, `/api/me/usage?${RANGE}`)).body).has(123),
    ).toBe(false);
    ok(
      await putIdentityLink(
        {
          oid: CALLERS.viewerNone.oid,
          usageIdentities: ["c1@company.com"],
          aliases: [],
          version: null,
        },
        ctxAt(undefined, "req-link"),
      ),
    );
    expect(
      numbersIn((await get(handler, `/api/me/usage?${RANGE}`)).body).has(123),
    ).toBe(true);
  });
});
