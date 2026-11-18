import { AppTeamSchema } from "@llm-usage-lens/shared";
import type { AppTeam } from "@llm-usage-lens/shared";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { resetDeniedAudit } from "@/lib/data/access/audit";
import {
  getAppTeam,
  hasAppTeamName,
  listAppTeams,
} from "@/lib/data/access/app-teams";
import { resetFakeCache, revalidatedTags } from "@/test/fakes/next-cache-fake";
import { rollups } from "@/test/fixtures/scope-fixtures";
import {
  CALLERS,
  accounts,
  auditToday,
  deniedToday,
  expectData,
  expectError,
  invoke,
  nonAuditItems,
  seedWorld,
  signInAs,
  type CallerName,
} from "@/test/support/matrix-route-support";
import {
  clearTable,
  ensureTestTable,
  loadFixtures,
  makeAccount,
} from "@/test/support/test-support";

import { GET as getOrgUnits } from "../access/org-units/route";
import { GET, POST } from "./route";

// Source: docs/specs/2026-11-10-access-control.md - "Created app teams" (who
// may create: internal-admin and internal-org-admin, everyone else 403 before
// parsing; body { name, departmentId }; name 1-80 after trimming, unique
// case-insensitively among created teams and registry names, 409; department
// must exist in the registry, 400; the id is generated on the server,
// `appteam-<uuid v4>`, never from the body; create + `appteam.create` audit
// record; the route revalidates the team-list tag), threat T-MI3; Data Model
// spec - "Entity: AppTeam" (a created team has no DailyRollup: no Bedrock row,
// never $0); App Teams spec - "Teams without an AWS account". The cross-cutting
// 401 / 403-before-parsing / 400 shape / no-store / denied-audit contract for
// POST is asserted once by route-contract.integration.test.ts (registry entry
// "POST teams/route.ts", Rule 60.23); this file keeps the route-specific cases
// and the complete role matrix (security). Only `@/auth` is mocked; the cache
// is the in-memory fake so the revalidation is observable.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.fakeNextCache;
});

const RANGE = "dateFrom=2026-10-01&dateTo=2026-10-03";
const create = (body: unknown) =>
  invoke(POST, { method: "POST", path: "/api/teams", body });
const listTeams = () =>
  invoke(GET, { method: "GET", path: `/api/teams?${RANGE}` });
const orgUnits = () =>
  invoke(getOrgUnits, { method: "GET", path: "/api/access/org-units" });

const GUILD = { name: "Platform Guild", departmentId: "dept-eng" };
const UUID_V4 =
  /^appteam-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REGISTRY_TEAM_IDS = accounts.map((a) => a.teamId);

beforeAll(ensureTestTable);
beforeEach(async () => {
  resetFakeCache();
  await clearTable();
  resetDeniedAudit();
  await seedWorld();
  signInAs("admin");
});

async function created(body: unknown = GUILD) {
  return expectData<AppTeam>(await create(body), [201]);
}

describe("POST /api/teams - who may create (Created app teams, user Q2)", () => {
  it.each(["admin", "orgAdmin"] as CallerName[])(
    "%s gets 201 with the AppTeam; the stored team equals it and the department name comes from the registry",
    async (caller) => {
      signInAs(caller);
      const team = AppTeamSchema.parse(await created());
      expect(team).toMatchObject({
        name: "Platform Guild",
        departmentId: "dept-eng",
        departmentName: "Engineering",
        createdBy: CALLERS[caller].oid,
        version: 1,
      });
      expect(await getAppTeam(team.teamId)).toEqual(team);
      expect(await listAppTeams()).toEqual([team]);
    },
  );

  // Complete role matrix (security): the team lead (team-scope admin) and a
  // department-scope admin hold admin scopes but not the create permission.
  it.each([
    "auditor",
    "teamAdminA",
    "deptAdminEng",
    "viewerNone",
    "memberA",
  ] as CallerName[])(
    "%s gets 403 FORBIDDEN even with an unparsable body (before parsing); nothing is written",
    async (caller) => {
      signInAs(caller);
      const before = await nonAuditItems();
      for (const body of [GUILD, "{not json"]) {
        await expectError(await create(body), 403, "FORBIDDEN");
      }
      expect(await nonAuditItems()).toEqual(before);
      expect(await listAppTeams()).toEqual([]);
      expect(await hasAppTeamName(GUILD.name)).toBe(false);
      expect(
        (await auditToday()).filter(
          (r) => r.action === "appteam.create" && r.result === "success",
        ),
      ).toEqual([]);
    },
  );
});

describe("POST /api/teams - the stored team and its audit record", () => {
  it("trims the name; the id is appteam-<uuid v4>, generated per create, and never a registry team id (T-MI3)", async () => {
    const first = await created({ ...GUILD, name: "  Platform Guild  " });
    const second = await created({
      name: "Another Guild",
      departmentId: "dept-ops",
    });
    expect(first.name).toBe("Platform Guild");
    expect(first.teamId).toMatch(UUID_V4);
    expect(second.teamId).toMatch(UUID_V4);
    expect(second.teamId).not.toBe(first.teamId);
    for (const id of [first.teamId, second.teamId]) {
      expect(REGISTRY_TEAM_IDS).not.toContain(id);
    }
    expect(second.departmentName).toBe("Ops");
  });

  it("writes one appteam.create success record with the actor and the team (Audit log; same transaction as the team)", async () => {
    const team = await created();
    const records = (await auditToday()).filter(
      (r) => r.action === "appteam.create",
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "appteam.create",
      result: "success",
      category: "change",
      actor: CALLERS.admin.oid,
      teamId: team.teamId,
    });
    expect(await deniedToday()).toEqual([]);
  });

  it("revalidates the app-teams tag so the next org-units read lists the team (Created app teams: the route revalidates the team-list tags)", async () => {
    const before = await expectData<{ teams: { id: string }[] }>(
      await orgUnits(),
    );
    const team = await created();
    expect(revalidatedTags).toContain("app-teams");
    const after = await expectData<{ teams: { id: string }[] }>(
      await orgUnits(),
    );
    expect(before.teams.map((t) => t.id)).not.toContain(team.teamId);
    expect(after.teams.map((t) => t.id)).toContain(team.teamId);
  });
});

describe("POST /api/teams - duplicate names are 409 CONFLICT and write nothing (T-MI3)", () => {
  it.each([
    ["a created team's name, other case and padding", "  platform GUILD "],
    ["a created team's name, exactly", "Platform Guild"],
  ])("%s", async (_label, name) => {
    await created();
    const before = await nonAuditItems();
    const auditBefore = (await auditToday()).length;
    await expectError(
      await create({ name, departmentId: "dept-ops" }),
      409,
      "CONFLICT",
    );
    expect(await nonAuditItems()).toEqual(before);
    expect(await listAppTeams()).toHaveLength(1);
    expect((await auditToday()).length).toBe(auditBefore);
  });

  it.each([
    ["a registry team's name (team-a is 'A'), lower-cased", "a"],
    ["a registry team's name (team-m is 'M'), padded", "  M  "],
  ])("%s", async (_label, name) => {
    const before = await nonAuditItems();
    await expectError(
      await create({ name, departmentId: "dept-eng" }),
      409,
      "CONFLICT",
    );
    expect(await nonAuditItems()).toEqual(before);
    expect(await listAppTeams()).toEqual([]);
    expect(await hasAppTeamName(name)).toBe(false);
    expect(
      (await auditToday()).filter((r) => r.action === "appteam.create"),
    ).toEqual([]);
  });

  it("a multi-word registry name clashes case-insensitively too", async () => {
    await loadFixtures({
      accounts: [
        makeAccount(9, {
          teamId: "team-data",
          teamName: "Data Platform",
          departmentId: "dept-eng",
          departmentName: "Engineering",
        }),
      ],
    });
    await expectError(
      await create({ name: " data PLATFORM", departmentId: "dept-eng" }),
      409,
      "CONFLICT",
    );
    expect(await listAppTeams()).toEqual([]);
  });
});

describe("POST /api/teams - input is validated (Rule 10.3; Created app teams)", () => {
  it("an unknown department is 400 and writes nothing", async () => {
    const before = await nonAuditItems();
    await expectError(
      await create({ name: "Guild", departmentId: "dept-nowhere" }),
      400,
      "BAD_REQUEST",
    );
    expect(await nonAuditItems()).toEqual(before);
    expect(await hasAppTeamName("Guild")).toBe(false);
  });

  it.each([
    ["a body teamId (a registry id)", { ...GUILD, teamId: "team-a" }],
    [
      "a body teamId shaped like a generated id",
      { ...GUILD, teamId: "appteam-00000000-0000-4000-8000-000000000099" },
    ],
  ])(
    "%s is refused 400 (T-MI3: the id is never taken from the body) and nothing is stored under it",
    async (_label, body) => {
      const before = await nonAuditItems();
      await expectError(await create(body), 400, "BAD_REQUEST");
      expect(await nonAuditItems()).toEqual(before);
      expect(await getAppTeam(body.teamId)).toBeNull();
      expect(await listAppTeams()).toEqual([]);
    },
  );

  it.each([
    ["a whitespace-only name", { name: "   ", departmentId: "dept-eng" }],
    [
      "a name over 80 characters",
      { name: "x".repeat(81), departmentId: "dept-eng" },
    ],
    ["a missing department", { name: "Guild" }],
  ])("%s is 400 and writes nothing", async (_label, body) => {
    const before = await nonAuditItems();
    await expectError(await create(body), 400, "BAD_REQUEST");
    expect(await nonAuditItems()).toEqual(before);
  });

  it("an 80-character name (after trimming) is accepted", async () => {
    const team = await created({
      name: ` ${"x".repeat(80)} `,
      departmentId: "dept-eng",
    });
    expect(team.name).toBe("x".repeat(80));
  });
});

describe("GET /api/teams stays the Bedrock team list (Data Model - Entity: AppTeam; App Teams spec - Teams without an AWS account)", () => {
  it("has no row for a created team: not a $0 row, not by id and not by name", async () => {
    await loadFixtures({ rollups: rollups() });
    const before = await expectData<{ teams: unknown[] }>(await listTeams());
    expect(before.teams.length).toBeGreaterThan(0);

    const team = await created();
    resetFakeCache();
    const after = await expectData<{ teams: unknown[] }>(await listTeams());

    expect(after).toEqual(before);
    const text = JSON.stringify(after);
    expect(text).not.toContain(team.teamId);
    expect(text).not.toContain(team.name);
  });
});
