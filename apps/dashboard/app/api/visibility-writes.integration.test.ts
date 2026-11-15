import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { resetDeniedAudit } from "@/lib/data/access/audit";
import {
  CALLERS,
  MISSING,
  auditToday,
  deniedToday,
  expectData,
  expectError,
  expectOneDenied,
  expectSameBody,
  invoke,
  nonAuditItems,
  seedWorld,
  signInAs,
  type CallerName,
} from "@/test/matrix-route-support";
import { clearTable, ensureTestTable } from "@/test/test-support";

import {
  GET as GET_DEPT,
  PUT as PUT_DEPT,
} from "./departments/[id]/visibility/route";
import {
  GET as GET_TEAM,
  PUT as PUT_TEAM,
} from "./teams/[id]/visibility/route";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (/api/teams/[id]/visibility and /api/departments/[id]/visibility: GET read in
// scope, PUT write per matrix), "Visibility and inheritance" (values, defaults:
// team visible/own, department hidden/own; a team setting above its department
// cap is stored and applied as the cap, so the PUT stores it unclamped),
// "Permission matrix" (edit visibility: internal-admin, internal-org-admin, a
// department-scope admin for its department, its cap and its teams, a
// team-scope admin for its teams), "Enforcement" items 2, 4, 6 (version ->
// 409; body id equals path -> 400), "Audit log" (visibility.update; D17/T22),
// threats T3, T11, T15. Data layer: putTeamVisibility / putDepartmentVisibility
// (version null creates; the default carries version 0, so a PUT with version
// 0 creates and any other version updates). Contract: contract-slice1.md.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

const TEAM = "/api/teams/[id]/visibility";
const DEPT = "/api/departments/[id]/visibility";

const getTeam = (id: string) =>
  invoke(GET_TEAM, {
    method: "GET",
    path: `/api/teams/${id}/visibility`,
    params: { id },
  });
const putTeam = (id: string, body: unknown, extra = {}) =>
  invoke(PUT_TEAM, {
    method: "PUT",
    path: `/api/teams/${id}/visibility`,
    params: { id },
    body,
    ...extra,
  });
const getDept = (id: string) =>
  invoke(GET_DEPT, {
    method: "GET",
    path: `/api/departments/${id}/visibility`,
    params: { id },
  });
const putDept = (id: string, body: unknown, extra = {}) =>
  invoke(PUT_DEPT, {
    method: "PUT",
    path: `/api/departments/${id}/visibility`,
    params: { id },
    body,
    ...extra,
  });

type TeamVis = {
  teamId: string;
  teamLevel: string;
  userLevel: string;
  version: number;
};
type DeptVis = {
  departmentId: string;
  departmentLevel: string;
  maxUserLevel: string;
  version: number;
};
const teamBody = (teamId: string, version: number, over = {}) => ({
  teamId,
  teamLevel: "hidden",
  userLevel: "none",
  version,
  ...over,
});
const deptBody = (departmentId: string, version: number, over = {}) => ({
  departmentId,
  departmentLevel: "visible",
  maxUserLevel: "all",
  version,
  ...over,
});

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetDeniedAudit();
  await seedWorld();
  signInAs("admin");
});

const CANNOT_WRITE: CallerName[] = [
  "auditor",
  "viewerNone",
  "memberA",
  "memberB",
];

describe("GET /api/teams/[id]/visibility", () => {
  it("401 without a session", async () => {
    signInAs(null);
    await expectError(await getTeam("team-a"), 401, "UNAUTHORIZED");
  });

  it.each([
    "admin",
    "orgAdmin",
    "auditor",
    "teamAdminA",
    "deptAdminEng",
  ] as const)(
    "%s reads the defaults (visible, own, version 0) when nothing is stored, with no-store",
    async (caller) => {
      signInAs(caller);
      const data = await expectData<TeamVis>(await getTeam("team-a"));
      expect(data).toMatchObject({
        teamId: "team-a",
        teamLevel: "visible",
        userLevel: "own",
        version: 0,
      });
    },
  );

  it("returns the stored setting and its version after a PUT", async () => {
    await expectData(await putTeam("team-a", teamBody("team-a", 0)));
    const data = await expectData<TeamVis>(await getTeam("team-a"));
    expect(data).toMatchObject({
      teamLevel: "hidden",
      userLevel: "none",
      version: 1,
    });
  });

  it.each([
    ["viewerNone", "team-a"],
    ["memberB", "team-a"],
    ["teamAdminA", "team-b"],
    ["deptAdminEng", "team-c"],
  ] as const)(
    "%s reading %s gets the same 404 as a missing team and no denied record",
    async (caller, team) => {
      signInAs(caller);
      const outOfScope = await expectError(
        await getTeam(team),
        404,
        "NOT_FOUND",
      );
      signInAs("admin");
      const missing = await expectError(
        await getTeam(MISSING),
        404,
        "NOT_FOUND",
      );
      expectSameBody(outOfScope, missing, team, MISSING);
      expect(await deniedToday()).toEqual([]);
    },
  );

  it("400 BAD_REQUEST for a malformed path id", async () => {
    await expectError(await getTeam("x".repeat(129)), 400, "BAD_REQUEST");
  });
});

describe("PUT /api/teams/[id]/visibility", () => {
  it.each(["admin", "orgAdmin", "deptAdminEng", "teamAdminA"] as const)(
    "%s creates the setting with version 0: stored at version 1 and one visibility.update success record",
    async (caller) => {
      signInAs(caller);
      const data = await expectData<TeamVis>(
        await putTeam("team-a", teamBody("team-a", 0)),
      );
      expect(data).toMatchObject({
        teamId: "team-a",
        teamLevel: "hidden",
        userLevel: "none",
        version: 1,
      });
      const records = await auditToday();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: "visibility.update",
        result: "success",
        category: "change",
        actor: CALLERS[caller].oid,
        teamId: "team-a",
      });
    },
  );

  it("updates at the current version, bumping it, one record per write", async () => {
    await expectData(await putTeam("team-a", teamBody("team-a", 0)));
    const data = await expectData<TeamVis>(
      await putTeam(
        "team-a",
        teamBody("team-a", 1, { teamLevel: "visible", userLevel: "own" }),
      ),
    );
    expect(data).toMatchObject({
      teamLevel: "visible",
      userLevel: "own",
      version: 2,
    });
    expect(
      (await auditToday()).filter((r) => r.action === "visibility.update"),
    ).toHaveLength(2);
  });

  it("stores a team user level above the department cap unclamped (it is applied as the cap, not rewritten)", async () => {
    const data = await expectData<TeamVis>(
      await putTeam(
        "team-a",
        teamBody("team-a", 0, { teamLevel: "visible", userLevel: "all" }),
      ),
    );
    expect(data.userLevel).toBe("all");
    expect((await expectData<TeamVis>(await getTeam("team-a"))).userLevel).toBe(
      "all",
    );
  });

  it("a department-scope admin edits another team of its department (team-b)", async () => {
    signInAs("deptAdminEng");
    await expectData(await putTeam("team-b", teamBody("team-b", 0)));
  });

  it("409 CONFLICT for a stale version, and for version 0 when a setting already exists; the stored setting is unchanged and nothing is audited", async () => {
    await expectData(await putTeam("team-a", teamBody("team-a", 0)));
    const audited = (await auditToday()).length;
    for (const version of [0, 5]) {
      await expectError(
        await putTeam(
          "team-a",
          teamBody("team-a", version, { userLevel: "all" }),
        ),
        409,
        "CONFLICT",
      );
    }
    expect(await expectData<TeamVis>(await getTeam("team-a"))).toMatchObject({
      userLevel: "none",
      version: 1,
    });
    expect((await auditToday()).length).toBe(audited);
  });

  it.each([
    ["teamAdminA", "team-b"],
    ["deptAdminEng", "team-c"],
  ] as const)(
    "%s editing %s (out of scope): the same 404 as a missing team, nothing written, one denied NOT_FOUND record",
    async (caller, team) => {
      signInAs(caller);
      const before = await nonAuditItems();
      const outOfScope = await expectError(
        await putTeam(team, teamBody(team, 0)),
        404,
        "NOT_FOUND",
      );
      expect(await nonAuditItems()).toEqual(before);
      await expectOneDenied({
        actor: CALLERS[caller].oid,
        action: "visibility.update",
        code: "NOT_FOUND",
      });
      signInAs("admin");
      const missing = await expectError(
        await putTeam(MISSING, teamBody(MISSING, 0)),
        404,
        "NOT_FOUND",
      );
      expectSameBody(outOfScope, missing, team, MISSING);
    },
  );

  it("an admin editing a team that does not exist gets 404 and no record at all", async () => {
    await expectError(
      await putTeam(MISSING, teamBody(MISSING, 0)),
      404,
      "NOT_FOUND",
    );
    expect(await auditToday()).toEqual([]);
    expect(await deniedToday()).toEqual([]);
  });

  it("401 without a session", async () => {
    signInAs(null);
    await expectError(
      await putTeam("team-a", teamBody("team-a", 0)),
      401,
      "UNAUTHORIZED",
    );
  });

  describe.each(CANNOT_WRITE)("as %s (no write permission)", (caller) => {
    beforeEach(() => signInAs(caller));

    it("403 FORBIDDEN even for its own team, nothing written, one denied record with the fixed route pattern", async () => {
      const before = await nonAuditItems();
      await expectError(
        await putTeam("team-a", teamBody("team-a", 0)),
        403,
        "FORBIDDEN",
      );
      expect(await nonAuditItems()).toEqual(before);
      await expectOneDenied({
        actor: CALLERS[caller].oid,
        action: "visibility.update",
        code: "FORBIDDEN",
        route: { method: "PUT", pattern: TEAM },
      });
    });

    it("403 comes before parsing: a malformed id, body, content type and origin all stay 403", async () => {
      const longId = "x".repeat(200);
      for (const call of [
        { team: "team-a", body: "{not json" },
        { team: "team-a", body: {} },
        { team: longId, body: teamBody("team-a", 0) },
        {
          team: "team-a",
          body: teamBody("team-a", 0),
          extra: { contentType: "text/plain" },
        },
        {
          team: "team-a",
          body: teamBody("team-a", 0),
          extra: { origin: "https://evil.example.test" },
        },
      ]) {
        await expectError(
          await putTeam(call.team, call.body, call.extra),
          403,
          "FORBIDDEN",
        );
      }
      await expectError(
        await putTeam(longId, teamBody("team-a", 0)),
        403,
        "FORBIDDEN",
      );
      await expectOneDenied({
        actor: CALLERS[caller].oid,
        action: "visibility.update",
        code: "FORBIDDEN",
        route: { method: "PUT", pattern: TEAM },
        forbiddenRaw: [longId],
      });
      expect((await expectData<TeamVis>(await getTeamAsAdmin())).version).toBe(
        0,
      );
    });
  });

  it("403 for a permitted caller with a missing or foreign Origin, before parsing; nothing is stored", async () => {
    for (const origin of [null, "https://evil.example.test", "null"]) {
      await expectError(
        await putTeam("team-a", teamBody("team-a", 0), { origin }),
        403,
        "FORBIDDEN",
      );
    }
    expect((await expectData<TeamVis>(await getTeamAsAdmin())).version).toBe(0);
  });

  it.each([
    ["no Content-Type", null],
    ["text/plain", "text/plain"],
  ])(
    "400 BAD_REQUEST for %s; nothing stored or audited",
    async (_n, contentType) => {
      await expectError(
        await putTeam("team-a", teamBody("team-a", 0), { contentType }),
        400,
        "BAD_REQUEST",
      );
      expect(await auditToday()).toEqual([]);
      expect(await deniedToday()).toEqual([]);
    },
  );

  it.each([
    ["invalid JSON", "{not json"],
    ["an empty object", {}],
    ["a non-object body", "[]"],
    ["an unknown team level", teamBody("team-a", 0, { teamLevel: "shown" })],
    ["an unknown user level", teamBody("team-a", 0, { userLevel: "everyone" })],
    [
      "the department-only level 'visible' as a user level",
      teamBody("team-a", 0, { userLevel: "visible" }),
    ],
    ["a missing team level", teamBody("team-a", 0, { teamLevel: undefined })],
    ["a missing user level", teamBody("team-a", 0, { userLevel: undefined })],
    ["a missing version", teamBody("team-a", 0, { version: undefined })],
    ["a negative version", teamBody("team-a", -1)],
    ["a non-integer version", teamBody("team-a", 1.5)],
    ["a string version", teamBody("team-a", 0, { version: "0" })],
    ["a body teamId that differs from the path", teamBody("team-b", 0)],
    [
      "department fields on a team route",
      {
        teamId: "team-a",
        departmentLevel: "visible",
        maxUserLevel: "all",
        version: 0,
      },
    ],
  ])(
    "400 BAD_REQUEST for %s; nothing stored, no record, no denied record",
    async (_n, body) => {
      await expectError(await putTeam("team-a", body), 400, "BAD_REQUEST");
      expect((await expectData<TeamVis>(await getTeamAsAdmin())).version).toBe(
        0,
      );
      expect(await auditToday()).toEqual([]);
      expect(await deniedToday()).toEqual([]);
    },
  );

  it("400 BAD_REQUEST for a malformed path id (a permitted caller)", async () => {
    await expectError(
      await putTeam("x".repeat(129), teamBody("team-a", 0)),
      400,
      "BAD_REQUEST",
    );
  });
});

async function getTeamAsAdmin(): Promise<Response> {
  signInAs("admin");
  return getTeam("team-a");
}

describe("GET /api/departments/[id]/visibility", () => {
  it("401 without a session", async () => {
    signInAs(null);
    await expectError(await getDept("dept-eng"), 401, "UNAUTHORIZED");
  });

  it.each(["admin", "orgAdmin", "auditor", "deptAdminEng"] as const)(
    "%s reads the defaults (hidden, own, version 0) when nothing is stored",
    async (caller) => {
      signInAs(caller);
      expect(
        await expectData<DeptVis>(await getDept("dept-eng")),
      ).toMatchObject({
        departmentId: "dept-eng",
        departmentLevel: "hidden",
        maxUserLevel: "own",
        version: 0,
      });
    },
  );

  it.each([
    ["viewerNone", "dept-eng"],
    ["memberA", "dept-eng"],
    ["deptAdminEng", "dept-ops"],
  ] as const)(
    "%s reading %s gets the same 404 as a missing department and no denied record",
    async (caller, dept) => {
      signInAs(caller);
      const outOfScope = await expectError(
        await getDept(dept),
        404,
        "NOT_FOUND",
      );
      signInAs("admin");
      const missing = await expectError(
        await getDept(MISSING),
        404,
        "NOT_FOUND",
      );
      expectSameBody(outOfScope, missing, dept, MISSING);
      expect(await deniedToday()).toEqual([]);
    },
  );
});

describe("PUT /api/departments/[id]/visibility (internal-admin, internal-org-admin, a department-scope admin of that department)", () => {
  it.each(["admin", "orgAdmin", "deptAdminEng"] as const)(
    "%s creates the setting with version 0: stored at version 1 and one visibility.update success record",
    async (caller) => {
      signInAs(caller);
      const data = await expectData<DeptVis>(
        await putDept("dept-eng", deptBody("dept-eng", 0)),
      );
      expect(data).toMatchObject({
        departmentId: "dept-eng",
        departmentLevel: "visible",
        maxUserLevel: "all",
        version: 1,
      });
      const records = await auditToday();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: "visibility.update",
        result: "success",
        actor: CALLERS[caller].oid,
      });
    },
  );

  it("updates at the current version and 409s a stale one", async () => {
    await expectData(await putDept("dept-eng", deptBody("dept-eng", 0)));
    const data = await expectData<DeptVis>(
      await putDept(
        "dept-eng",
        deptBody("dept-eng", 1, {
          departmentLevel: "hidden",
          maxUserLevel: "none",
        }),
      ),
    );
    expect(data).toMatchObject({ maxUserLevel: "none", version: 2 });
    const audited = (await auditToday()).length;
    await expectError(
      await putDept("dept-eng", deptBody("dept-eng", 1)),
      409,
      "CONFLICT",
    );
    expect((await auditToday()).length).toBe(audited);
  });

  it("a department-scope admin editing another department: the same 404 as a missing one, one denied NOT_FOUND record", async () => {
    signInAs("deptAdminEng");
    const outOfScope = await expectError(
      await putDept("dept-ops", deptBody("dept-ops", 0)),
      404,
      "NOT_FOUND",
    );
    await expectOneDenied({
      actor: CALLERS.deptAdminEng.oid,
      action: "visibility.update",
      code: "NOT_FOUND",
    });
    signInAs("admin");
    const missing = await expectError(
      await putDept(MISSING, deptBody(MISSING, 0)),
      404,
      "NOT_FOUND",
    );
    expectSameBody(outOfScope, missing, "dept-ops", MISSING);
  });

  it("an admin editing a department that does not exist gets 404 and no record", async () => {
    await expectError(
      await putDept(MISSING, deptBody(MISSING, 0)),
      404,
      "NOT_FOUND",
    );
    expect(await auditToday()).toEqual([]);
  });

  it.each(["teamAdminA", "auditor", "viewerNone", "memberA"] as const)(
    "%s: 403 FORBIDDEN before parsing (a team-scope admin may not edit a department or its cap), nothing written, one denied record with the fixed route pattern",
    async (caller) => {
      signInAs(caller);
      const before = await nonAuditItems();
      await expectError(
        await putDept("x".repeat(200), "{not json"),
        403,
        "FORBIDDEN",
      );
      await expectError(
        await putDept("dept-eng", deptBody("dept-eng", 0)),
        403,
        "FORBIDDEN",
      );
      expect(await nonAuditItems()).toEqual(before);
      await expectOneDenied({
        actor: CALLERS[caller].oid,
        action: "visibility.update",
        code: "FORBIDDEN",
        route: { method: "PUT", pattern: DEPT },
      });
    },
  );

  it("401 without a session; 403 for an admin with a foreign Origin before parsing", async () => {
    signInAs(null);
    await expectError(
      await putDept("dept-eng", deptBody("dept-eng", 0)),
      401,
      "UNAUTHORIZED",
    );
    signInAs("admin");
    await expectError(
      await putDept("dept-eng", deptBody("dept-eng", 0), {
        origin: "https://evil.example.test",
      }),
      403,
      "FORBIDDEN",
    );
    expect((await expectData<DeptVis>(await getDept("dept-eng"))).version).toBe(
      0,
    );
  });

  it.each([
    ["invalid JSON", "{not json"],
    ["an empty object", {}],
    [
      "an unknown department level",
      deptBody("dept-eng", 0, { departmentLevel: "shown" }),
    ],
    ["an unknown cap", deptBody("dept-eng", 0, { maxUserLevel: "some" })],
    ["a missing cap", deptBody("dept-eng", 0, { maxUserLevel: undefined })],
    ["a missing version", deptBody("dept-eng", 0, { version: undefined })],
    ["a negative version", deptBody("dept-eng", -1)],
    ["a body departmentId that differs from the path", deptBody("dept-ops", 0)],
    [
      "team fields on a department route",
      {
        departmentId: "dept-eng",
        teamLevel: "visible",
        userLevel: "own",
        version: 0,
      },
    ],
  ])(
    "400 BAD_REQUEST for %s; nothing stored, nothing audited",
    async (_n, body) => {
      await expectError(await putDept("dept-eng", body), 400, "BAD_REQUEST");
      expect(
        (await expectData<DeptVis>(await getDept("dept-eng"))).version,
      ).toBe(0);
      expect(await auditToday()).toEqual([]);
      expect(await deniedToday()).toEqual([]);
    },
  );

  it("400 BAD_REQUEST for a wrong content type and for a malformed path id", async () => {
    await expectError(
      await putDept("dept-eng", deptBody("dept-eng", 0), {
        contentType: "text/plain",
      }),
      400,
      "BAD_REQUEST",
    );
    await expectError(
      await putDept("x".repeat(129), deptBody("dept-eng", 0)),
      400,
      "BAD_REQUEST",
    );
  });
});
