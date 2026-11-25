import { AppTeamSchema } from "@llm-usage-lens/shared";
import type { AppTeam } from "@llm-usage-lens/shared";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { resetDeniedAudit } from "@/lib/data/access/audit";
import {
  createAppTeam,
  getAppTeam,
  hasAppTeamName,
  listAppTeams,
  updateAppTeam,
} from "@/lib/data/access/app-teams";
import { findTeamInScope } from "@/lib/manage/team-scope";
import { resetFakeCache, revalidatedTags } from "@/test/fakes/next-cache-fake";
import {
  CALLERS,
  auditToday,
  deniedToday,
  expectData,
  expectError,
  invoke,
  nonAuditItems,
  PEOPLE,
  seedAdminScope,
  seedCtx,
  seedWorld,
  signInAs,
  type CallerName,
} from "@/test/support/matrix-route-support";
import { ok } from "@/test/support/access-test-support";
import { clearTable, ensureTestTable } from "@/test/support/test-support";

import { GET as getOrgUnits } from "../../access/org-units/route";
import { GET as getMembers, POST as postMember } from "./members/route";
import { PATCH } from "./route";

// Source: docs/specs/2026-11-10-access-control.md - "Edit a created team"
// (unit TP1) and the Permission matrix row "Edit a created team": internal-admin
// and internal-org-admin edit the name and the department of a CREATED team
// (user, Q-R3-2); leads, auditors and members get 403 before parsing with one
// `denied` record; body { name, departmentId, version }; stale version 409;
// a name another team has is the creation route's error; a registry team 400
// "Edited in Settings -> AWS accounts"; unknown team 404; the write records
// `appteam.update` and refreshes the team directory. Design System - "Team
// page, round 3", T-TP2..T-TP5. The cross-cutting 401 / 403-before-parsing /
// 400 shape / no-store / denied-audit contract is asserted once by
// route-contract.integration.test.ts (registry entry "PATCH teams/[id]/route.ts",
// Rule 60.23); this file keeps the route-specific cases and the complete role
// matrix (security). Only `@/auth` is mocked; the cache is the in-memory fake.
//
// No out-of-scope 404 case for the permitted roles: internal-admin and
// internal-org-admin are global matrix writers (lib/auth/write-policy.ts
// isMatrixWriter), so every created team is in their scope; the 404 of this
// route is the unknown team. Leads never reach the target lookup (403 first).
//
// Planned guards: PATCH in app/api/teams/[id]/route.ts - the `permit` callback
// (isMatrixWriter, lib/auth/write-policy.ts:50) for 403 before parsing and the
// denied record; parseJsonBody + UpdateAppTeamInputSchema for 400; the registry
// check against getAllAccountsCached for "Edited in Settings"; updateAppTeam in
// lib/data/access/app-teams.ts for 404 / 409 and the audit record.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.fakeNextCache;
});

const PATTERN = "/api/teams/[id]";
const REGISTRY_MESSAGE = "Edited in Settings → AWS accounts";
const TAKEN_MESSAGE = "A team with this name already exists";
const MISSING_APP_TEAM = "appteam-00000000-0000-4000-8000-0000000000ff";

let team: AppTeam;

const patch = (id: string, body: unknown) =>
  invoke(PATCH, {
    method: "PATCH",
    path: `/api/teams/${encodeURIComponent(id)}`,
    params: { id },
    body,
  });
const orgUnits = () =>
  invoke(getOrgUnits, { method: "GET", path: "/api/access/org-units" });

const change = (over: Record<string, unknown> = {}) => ({
  name: "Renamed Guild",
  departmentId: "dept-ops",
  version: 1,
  ...over,
});

async function seedTeam(name = "Platform Guild", departmentId = "dept-eng") {
  return ok(
    await createAppTeam(
      {
        name,
        departmentId,
        departmentName: departmentId === "dept-eng" ? "Engineering" : "Ops",
      },
      seedCtx(),
    ),
  );
}

beforeAll(ensureTestTable);
beforeEach(async () => {
  resetFakeCache();
  await clearTable();
  resetDeniedAudit();
  await seedWorld();
  team = await seedTeam();
  signInAs("admin");
});

describe("PATCH /api/teams/[id] - who may edit (Edit a created team; T-TP2, user Q-R3-2)", () => {
  it.each(["admin", "orgAdmin"] as CallerName[])(
    "%s gets 200 with the updated AppTeam: new name and department, version + 1",
    async (caller) => {
      signInAs(caller);
      const updated = AppTeamSchema.parse(
        await expectData(await patch(team.teamId, change())),
      );
      expect(updated).toMatchObject({
        teamId: team.teamId,
        name: "Renamed Guild",
        departmentId: "dept-ops",
        departmentName: "Ops",
        createdBy: team.createdBy,
        createdAt: team.createdAt,
        version: 2,
      });
      expect(await getAppTeam(team.teamId)).toEqual(updated);
      expect(await deniedToday()).toEqual([]);
    },
  );

  // Complete role matrix (security). Each refusal is 403 before parsing (an
  // unparsable and an invalid body both get 403, never 400), writes nothing and
  // leaves exactly one `denied` record naming the fixed route pattern. The lead
  // cases include a lead of this very team and of its department. The denied
  // record is suppressed per actor and action within one minute (Access Control
  // - audit log, T22 "per-minute suppression"), so the window is reset before
  // each body to prove one record per refusal.
  it.each([
    "auditor",
    "teamAdminA",
    "deptAdminEng",
    "viewerNone",
    "memberA",
  ] as CallerName[])(
    "%s gets 403 FORBIDDEN before parsing, one denied record per request, nothing written",
    async (caller) => {
      await seedAdminScope(CALLERS.teamAdminA.oid, "team", team.teamId);
      signInAs(caller);
      const stored = await nonAuditItems();
      for (const body of ["{not json", { name: "", version: "x" }, change()]) {
        resetDeniedAudit();
        const before = (await deniedToday()).length;
        await expectError(await patch(team.teamId, body), 403, "FORBIDDEN");
        const denied = await deniedToday();
        expect(denied).toHaveLength(before + 1);
        expect(denied.at(-1)).toMatchObject({
          action: "appteam.update",
          result: "denied",
          category: "security",
          code: "FORBIDDEN",
          actor: CALLERS[caller].oid,
          route: { method: "PATCH", pattern: PATTERN },
        });
      }
      expect(await nonAuditItems()).toEqual(stored);
      expect(await getAppTeam(team.teamId)).toEqual(team);
      expect(
        (await auditToday()).filter(
          (r) => r.action === "appteam.update" && r.result === "success",
        ),
      ).toEqual([]);
    },
  );
});

describe("PATCH /api/teams/[id] - body is validated (Edit a created team; Rule 10.3)", () => {
  it.each([
    ["a whitespace-only name", change({ name: "   " })],
    ["an 81 character name", change({ name: "x".repeat(81) })],
    ["a missing department", { name: "Guild", version: 1 }],
    ["a missing version", { name: "Guild", departmentId: "dept-ops" }],
    ["a fractional version", change({ version: 1.5 })],
    ["a body teamId (the id is the path's)", change({ teamId: "team-a" })],
  ])("%s is 400 and writes nothing", async (_label, body) => {
    const stored = await nonAuditItems();
    await expectError(await patch(team.teamId, body), 400, "BAD_REQUEST");
    expect(await nonAuditItems()).toEqual(stored);
    expect(await getAppTeam(team.teamId)).toEqual(team);
  });

  it("an unknown department is 400 like POST /api/teams and writes nothing", async () => {
    const stored = await nonAuditItems();
    await expectError(
      await patch(team.teamId, change({ departmentId: "dept-nowhere" })),
      400,
      "BAD_REQUEST",
    );
    expect(await nonAuditItems()).toEqual(stored);
  });

  it("an 80 character name after trimming is accepted and stored trimmed", async () => {
    const updated = await expectData<AppTeam>(
      await patch(team.teamId, change({ name: ` ${"x".repeat(80)} ` })),
    );
    expect(updated.name).toBe("x".repeat(80));
  });

  it("an id over 128 characters is 400", async () => {
    await expectError(
      await patch("x".repeat(129), change()),
      400,
      "BAD_REQUEST",
    );
  });
});

describe("PATCH /api/teams/[id] - conflicts and targets (T-TP3)", () => {
  it("a stale version is 409 CONFLICT and writes nothing", async () => {
    await expectData(await patch(team.teamId, change()));
    const stored = await nonAuditItems();
    const auditBefore = (await auditToday()).length;
    resetFakeCache();
    await expectError(
      await patch(team.teamId, change({ name: "Third Name" })),
      409,
      "CONFLICT",
    );
    expect(await nonAuditItems()).toEqual(stored);
    expect((await auditToday()).length).toBe(auditBefore);
    expect(revalidatedTags).toEqual([]);
  });

  it.each([
    [
      "another created team's name, other case and padding",
      "  PLATFORM guild ",
    ],
  ])("%s is 409 CONFLICT and writes nothing", async (_l, name) => {
    const mine = await seedTeam("Mine");
    const stored = await nonAuditItems();
    await expectError(
      await patch(mine.teamId, change({ name })),
      409,
      "CONFLICT",
    );
    expect(await nonAuditItems()).toEqual(stored);
    expect(await hasAppTeamName("mine")).toBe(true);
  });

  it("another created team's name is 409 CONFLICT with the duplicate-name message, not the stale-version text (T-TP3)", async () => {
    const mine = await seedTeam("Mine");
    const res = await expectError(
      await patch(mine.teamId, change({ name: team.name, version: 1 })),
      409,
      "CONFLICT",
    );
    expect(res.error.message).toBe(TAKEN_MESSAGE);
  });

  it.each([
    ["a registry team's name (team-a is 'A'), lower-cased and padded", " a "],
    ["a registry team's name (team-m is 'M')", "M"],
  ])(
    "%s is the creation route's 409 CONFLICT and writes nothing",
    async (_l, name) => {
      const stored = await nonAuditItems();
      const res = await expectError(
        await patch(team.teamId, change({ name })),
        409,
        "CONFLICT",
      );
      expect(res.error.message).toBe(TAKEN_MESSAGE);
      expect(await nonAuditItems()).toEqual(stored);
      expect(await listAppTeams()).toEqual([team]);
    },
  );

  it("renaming to its own current name while changing the department works", async () => {
    const updated = await expectData<AppTeam>(
      await patch(team.teamId, change({ name: team.name })),
    );
    expect(updated).toMatchObject({
      name: team.name,
      departmentId: "dept-ops",
      departmentName: "Ops",
      version: 2,
    });
    expect(await hasAppTeamName(team.name)).toBe(true);
  });

  it("a registry team (from an AWS account) is 400 with the Settings message and writes nothing", async () => {
    const stored = await nonAuditItems();
    const res = await expectError(
      await patch("team-a", change({ name: "Free Name" })),
      400,
      "BAD_REQUEST",
    );
    expect(res.error.message).toBe(REGISTRY_MESSAGE);
    expect(await nonAuditItems()).toEqual(stored);
  });

  it("an unknown team id is 404 NOT_FOUND and writes nothing", async () => {
    const stored = await nonAuditItems();
    for (const id of [MISSING_APP_TEAM, "no-such-thing"]) {
      const res = await expectError(
        await patch(id, change()),
        404,
        "NOT_FOUND",
      );
      expect(res.error.message).toBe("Not found");
      expect(JSON.stringify(res)).not.toContain(id);
    }
    expect(await nonAuditItems()).toEqual(stored);
  });
});

describe("PATCH /api/teams/[id] - audit, name claim and directory refresh (T-TP4)", () => {
  it("writes exactly one appteam.update record with the old and new name and department", async () => {
    await expectData(await patch(team.teamId, change()));
    const records = (await auditToday()).filter(
      (r) => r.action === "appteam.update",
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "appteam.update",
      result: "success",
      category: "change",
      actor: CALLERS.admin.oid,
      target: { type: "team", id: team.teamId },
      teamId: team.teamId,
      before: { name: "Platform Guild", departmentId: "dept-eng" },
      after: { name: "Renamed Guild", departmentId: "dept-ops" },
    });
    expect(await deniedToday()).toEqual([]);
  });

  it("frees the old name and reserves the new one", async () => {
    await expectData(await patch(team.teamId, change()));
    expect(await hasAppTeamName("Platform Guild")).toBe(false);
    expect(await hasAppTeamName("renamed guild")).toBe(true);
    const other = await seedTeam("Platform Guild", "dept-ops");
    await expectError(
      await patch(other.teamId, change({ name: "RENAMED guild" })),
      409,
      "CONFLICT",
    );
  });

  it("revalidates the app-teams tag so the team directory shows the new name and department", async () => {
    const read = async () =>
      (
        await expectData<{
          teams: { id: string; name: string; departmentId: string }[];
        }>(await orgUnits())
      ).teams.find((t) => t.id === team.teamId);
    // Prime the cached directory so a missing refresh would serve the old row.
    expect(await read()).toMatchObject({
      name: "Platform Guild",
      departmentId: "dept-eng",
    });

    await expectData(await patch(team.teamId, change()));

    expect(revalidatedTags).toContain("app-teams");
    expect(await read()).toMatchObject({
      name: "Renamed Guild",
      departmentId: "dept-ops",
    });
  });
});

describe("PATCH /api/teams/[id] - a move changes department scope from the next request (T-TP5)", () => {
  const teamsFor = async (caller: CallerName) => {
    signInAs(caller);
    const res = await orgUnits();
    return (await expectData<{ teams: { id: string }[] }>(res)).teams.map(
      (t) => t.id,
    );
  };

  it("a lead of the old department loses the team and a lead of the new one gains it", async () => {
    // deptAdminEng leads dept-eng (the seeded world); viewerNone leads dept-ops.
    await seedAdminScope(CALLERS.viewerNone.oid, "department", "dept-ops");
    expect(await teamsFor("deptAdminEng")).toContain(team.teamId);
    expect(await teamsFor("viewerNone")).not.toContain(team.teamId);

    signInAs("admin");
    await expectData(await patch(team.teamId, change()));

    expect(await teamsFor("deptAdminEng")).not.toContain(team.teamId);
    expect(await teamsFor("viewerNone")).toContain(team.teamId);
  });
});

// Rule 60.10 "authorization data is never cached"; Access Control - Edit a
// created team (T-TP5). A created team's department decides a lead's scope, so
// it is read per request. These cases move the team with updateAppTeam
// directly (no revalidateTag) while the fake cache still holds the old
// directory entry, as another server instance would for up to an hour.
// Guards planned: lib/api/org-lookup.ts findTeam and lib/manage/team-scope.ts
// findTeamInScope read the team's department from the table, not from
// getAppTeamsCached (lib/api/team-directory.ts:24).
describe("a move changes department scope without a cache refresh (T-TP5, Rule 60.10)", () => {
  const engScope = {
    teamScopes: new Set<string>(),
    departmentScopes: new Set(["dept-eng"]),
  };
  const opsScope = {
    teamScopes: new Set<string>(),
    departmentScopes: new Set(["dept-ops"]),
  };
  const members = (caller: CallerName, id: string) => {
    signInAs(caller);
    return invoke(getMembers, {
      method: "GET",
      path: `/api/teams/${id}/members`,
      params: { id },
    });
  };
  const add = (caller: CallerName, id: string) => {
    signInAs(caller);
    return invoke(postMember, {
      method: "POST",
      path: `/api/teams/${id}/members`,
      params: { id },
      body: { oid: PEOPLE.alice.oid },
    });
  };

  async function primeThenMoveBehindTheCache() {
    await seedAdminScope(CALLERS.viewerNone.oid, "department", "dept-ops");
    // Prime the cached directory with the old department.
    expect(await findTeamInScope(team.teamId, false, engScope)).not.toBeNull();
    ok(
      await updateAppTeam(
        team.teamId,
        {
          name: team.name,
          departmentId: "dept-ops",
          departmentName: "Ops",
          version: team.version,
        },
        seedCtx(),
      ),
    );
    expect(revalidatedTags).toEqual([]);
  }

  it("the team page read no longer finds the team for the old department and finds it for the new one", async () => {
    await primeThenMoveBehindTheCache();
    expect(await findTeamInScope(team.teamId, false, engScope)).toBeNull();
    expect(await findTeamInScope(team.teamId, false, opsScope)).toMatchObject({
      teamId: team.teamId,
      departmentId: "dept-ops",
    });
  });

  it("the old department's lead is refused a member write and a member read; the new department's lead is allowed", async () => {
    await primeThenMoveBehindTheCache();
    const refused = await add("deptAdminEng", team.teamId);
    expect([403, 404]).toContain(refused.status);
    expect((await members("deptAdminEng", team.teamId)).status).toBe(404);
    expect((await members("viewerNone", team.teamId)).status).toBe(200);
    expect((await add("viewerNone", team.teamId)).status).toBe(201);
  });
});
