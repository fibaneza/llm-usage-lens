import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { clearTable, ensureTestTable } from "@/test/support/test-support";

// Pages of 2 items so GSI1 pagination is exercised with a handful of teams
// (Rule 20.6); every other command goes to DynamoDB Local unchanged.
const queryCalls = vi.hoisted(() => ({ count: 0, scans: 0 }));
vi.mock("@/lib/dynamodb", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/dynamodb")>("@/lib/dynamodb");
  return {
    ...actual,
    getDocumentClient: () => {
      const real = actual.getDocumentClient();
      return new Proxy(real, {
        get(target, prop) {
          if (prop !== "send") return Reflect.get(target, prop);
          return async (command: unknown) => {
            if (command instanceof ScanCommand) queryCalls.scans += 1;
            if (command instanceof QueryCommand && command.input.IndexName) {
              queryCalls.count += 1;
              command.input.Limit = 2;
            }
            return (target.send as (c: unknown) => Promise<unknown>).call(
              target,
              command,
            );
          };
        },
      });
    },
  };
});

import { auditRecords, ctxAt, ok } from "@/test/support/access-test-support";
import { testDoc, TEST_TABLE_NAME } from "@/test/support/test-support";

import {
  createAppTeam,
  getAppTeam,
  hasAppTeamName,
  listAppTeams,
  updateAppTeam,
} from "./app-teams";

// Source: docs/specs/2026-05-15-data-model.md — "Entity: AppTeam" (access
// patterns, AppTeamNameClaim in the same TransactWriteItems as the team and
// its audit record; list loops on LastEvaluatedKey, Rule 20.6); Access Control
// — "Created app teams", T-MI3.
const UUID_ID =
  /^appteam-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const input = (name: string) => ({
  name,
  departmentId: "dept-eng",
  departmentName: "Engineering",
});

async function allItems() {
  const res = await testDoc().send(
    new ScanCommand({ TableName: TEST_TABLE_NAME }),
  );
  return res.Items ?? [];
}
const nonAudit = async () =>
  (await allItems()).filter((i) => !String(i.PK).startsWith("AUDIT#"));

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  queryCalls.count = 0;
  queryCalls.scans = 0;
});

describe("createAppTeam", () => {
  it("stores the team, the name claim and one appteam.create record", async () => {
    const team = ok(await createAppTeam(input("Platform Guild"), ctxAt()));
    expect(team).toMatchObject({
      name: "Platform Guild",
      departmentId: "dept-eng",
      departmentName: "Engineering",
      createdBy: ctxAt().actor,
      createdAt: "2026-11-14T10:00:00.000Z",
      version: 1,
    });
    expect(team.teamId).toMatch(UUID_ID);

    const items = await nonAudit();
    expect(items.map((i) => i.PK).sort()).toEqual(
      [`APPTEAM#${team.teamId}`, "APPTEAMNAME#platform guild"].sort(),
    );
    const claim = items.find((i) => i.PK === "APPTEAMNAME#platform guild");
    expect(claim).toMatchObject({ SK: "OWNER", teamId: team.teamId });
    expect(items.find((i) => i.PK === `APPTEAM#${team.teamId}`)).toMatchObject({
      SK: "META",
      gsi1pk: "APPTEAMS",
      gsi1sk: `APPTEAM#${team.teamId}`,
    });

    const records = await auditRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "appteam.create",
      category: "change",
      result: "success",
      target: { type: "team", id: team.teamId },
      teamId: team.teamId,
      after: { teamId: team.teamId, version: 1 },
    });
  });

  it("trims the stored name", async () => {
    const team = ok(await createAppTeam(input("  Padded  "), ctxAt()));
    expect(team.name).toBe("Padded");
    expect(await hasAppTeamName("padded")).toBe(true);
  });

  it.each([
    ["the same name", "Platform Guild"],
    ["a different case", "PLATFORM guild"],
    ["surrounding spaces", "  Platform Guild  "],
  ])(
    "returns CONFLICT for %s and writes no team and no audit record",
    async (_l, dup) => {
      const first = ok(await createAppTeam(input("Platform Guild"), ctxAt()));
      const before = await allItems();

      expect(
        await createAppTeam(input(dup), ctxAt(undefined, "req-2")),
      ).toEqual({
        ok: false,
        code: "CONFLICT",
      });

      expect(await allItems()).toEqual(before);
      expect(await listAppTeams()).toEqual([first]);
      expect(await auditRecords()).toHaveLength(1);
    },
  );

  it("generates a different appteam-<uuid> id on every create (T-MI3)", async () => {
    const a = ok(await createAppTeam(input("One"), ctxAt()));
    const b = ok(await createAppTeam(input("Two"), ctxAt(undefined, "req-2")));
    expect(a.teamId).toMatch(UUID_ID);
    expect(b.teamId).toMatch(UUID_ID);
    expect(a.teamId).not.toBe(b.teamId);
  });
});

describe("listAppTeams", () => {
  it("returns an empty list when none exist", async () => {
    expect(await listAppTeams()).toEqual([]);
  });

  it("returns every created team, looping on LastEvaluatedKey (Rule 20.6)", async () => {
    const created = [];
    for (let i = 0; i < 5; i += 1) {
      created.push(
        ok(
          await createAppTeam(input(`Team ${i}`), ctxAt(undefined, `req-${i}`)),
        ),
      );
    }
    queryCalls.count = 0;
    const listed = await listAppTeams();
    expect(listed.map((t) => t.teamId).sort()).toEqual(
      created.map((t) => t.teamId).sort(),
    );
    // Pages of 2 over 5 teams: more than one Query call proves the loop.
    expect(queryCalls.count).toBeGreaterThanOrEqual(3);
  });

  it("does not list name claims or other GSI1 entities", async () => {
    ok(await createAppTeam(input("Only"), ctxAt()));
    expect(await listAppTeams()).toHaveLength(1);
  });
});

describe("getAppTeam", () => {
  it("returns the team by id and null for a missing or registry id", async () => {
    const team = ok(await createAppTeam(input("Findable"), ctxAt()));
    expect(await getAppTeam(team.teamId)).toEqual(team);
    expect(
      await getAppTeam("appteam-00000000-0000-4000-8000-0000000000ff"),
    ).toBeNull();
    expect(await getAppTeam("team-payments")).toBeNull();
  });
});

describe("hasAppTeamName", () => {
  it("is case-insensitive and trimmed, and false for an unused name", async () => {
    ok(await createAppTeam(input("Platform Guild"), ctxAt()));
    expect(await hasAppTeamName("Platform Guild")).toBe(true);
    expect(await hasAppTeamName("  PLATFORM GUILD ")).toBe(true);
    expect(await hasAppTeamName("Platform")).toBe(false);
  });
});

// Source: docs/specs/2026-11-10-access-control.md - "Edit a created team"
// (unit TP1): name and department change, `appteam.update` audited with the
// old and new values, a stale version is a conflict (T-TP3); Data Model -
// "Entity: AppTeam" (the AppTeamNameClaim moves in the same
// TransactWriteItems; no new key shape). Planned guard: updateAppTeam in
// lib/data/access/app-teams.ts (versioned conditional Update, claim Delete +
// Put, one audit item through commitAudited).
const edit = (
  version: number,
  over: Partial<{
    name: string;
    departmentId: string;
    departmentName: string;
  }> = {},
) => ({
  name: "Renamed Guild",
  departmentId: "dept-ops",
  departmentName: "Ops",
  version,
  ...over,
});
const UPDATER = "00000000-0000-4000-8000-0000000000bb";
const updateCtx = (requestId = "req-2") => ({
  ...ctxAt(undefined, requestId),
  actor: UPDATER,
});

describe("updateAppTeam", () => {
  it("changes name and department, bumps the version and keeps id, creator and createdAt (T-TP4)", async () => {
    const team = ok(await createAppTeam(input("Platform Guild"), ctxAt()));
    const updated = ok(await updateAppTeam(team.teamId, edit(1), updateCtx()));
    expect(updated).toEqual({
      ...team,
      name: "Renamed Guild",
      departmentId: "dept-ops",
      departmentName: "Ops",
      version: 2,
    });
    expect(updated.createdBy).toBe(ctxAt().actor);
    expect(await getAppTeam(team.teamId)).toEqual(updated);
    expect(await listAppTeams()).toEqual([updated]);
  });

  it("trims the stored name", async () => {
    const team = ok(await createAppTeam(input("Platform Guild"), ctxAt()));
    const updated = ok(
      await updateAppTeam(
        team.teamId,
        edit(1, { name: "  Padded  " }),
        updateCtx(),
      ),
    );
    expect(updated.name).toBe("Padded");
    expect(await hasAppTeamName("padded")).toBe(true);
  });

  it("moves the name claim in the same write: old name free, new name owned, no extra item shape (T-TP4)", async () => {
    const team = ok(await createAppTeam(input("Platform Guild"), ctxAt()));
    ok(await updateAppTeam(team.teamId, edit(1), updateCtx()));

    expect(await hasAppTeamName("Platform Guild")).toBe(false);
    expect(await hasAppTeamName("renamed guild")).toBe(true);
    const items = await nonAudit();
    expect(items.map((i) => i.PK).sort()).toEqual(
      [`APPTEAM#${team.teamId}`, "APPTEAMNAME#renamed guild"].sort(),
    );
    expect(
      items.find((i) => i.PK === "APPTEAMNAME#renamed guild"),
    ).toMatchObject({ SK: "OWNER", teamId: team.teamId });
    // The old name can be taken by a new team; the new name cannot.
    ok(await createAppTeam(input("Platform Guild"), ctxAt(undefined, "req-3")));
    expect(
      await createAppTeam(input("Renamed Guild"), ctxAt(undefined, "req-4")),
    ).toEqual({ ok: false, code: "CONFLICT" });
  });

  it.each([
    ["its own name, department changed", "Platform Guild"],
    ["its own name in another case, department changed", "PLATFORM guild"],
  ])("keeps the claim when the name is %s", async (_l, name) => {
    const team = ok(await createAppTeam(input("Platform Guild"), ctxAt()));
    const updated = ok(
      await updateAppTeam(team.teamId, edit(1, { name }), updateCtx()),
    );
    expect(updated).toMatchObject({
      name,
      departmentId: "dept-ops",
      version: 2,
    });
    expect(await hasAppTeamName("platform guild")).toBe(true);
    expect((await nonAudit()).map((i) => i.PK).sort()).toEqual(
      [`APPTEAM#${team.teamId}`, "APPTEAMNAME#platform guild"].sort(),
    );
  });

  it("writes one appteam.update record with the old and new name and department (T-TP4)", async () => {
    const team = ok(await createAppTeam(input("Platform Guild"), ctxAt()));
    ok(await updateAppTeam(team.teamId, edit(1), updateCtx()));
    const records = (await auditRecords()).filter(
      (r) => r.action === "appteam.update",
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "appteam.update",
      category: "change",
      result: "success",
      actor: UPDATER,
      target: { type: "team", id: team.teamId },
      teamId: team.teamId,
      before: { name: "Platform Guild", departmentId: "dept-eng" },
      after: { name: "Renamed Guild", departmentId: "dept-ops" },
    });
  });

  it("returns CONFLICT for a stale version and changes nothing (T-TP3)", async () => {
    const team = ok(await createAppTeam(input("Platform Guild"), ctxAt()));
    ok(await updateAppTeam(team.teamId, edit(1), updateCtx()));
    const before = await allItems();
    const auditBefore = await auditRecords();

    expect(
      await updateAppTeam(
        team.teamId,
        edit(1, { name: "Third Name" }),
        updateCtx("req-3"),
      ),
    ).toEqual({ ok: false, code: "CONFLICT" });

    expect(await allItems()).toEqual(before);
    expect(await auditRecords()).toEqual(auditBefore);
  });

  it.each([
    ["another created team's name, other case", "  PLATFORM guild "],
    ["another created team's name", "Platform Guild"],
  ])(
    "returns CONFLICT for %s and changes nothing (T-TP3)",
    async (_l, name) => {
      ok(await createAppTeam(input("Platform Guild"), ctxAt()));
      const mine = ok(
        await createAppTeam(input("Mine"), ctxAt(undefined, "req-2")),
      );
      const before = await allItems();

      expect(
        await updateAppTeam(mine.teamId, edit(1, { name }), updateCtx("req-3")),
      ).toEqual({ ok: false, code: "CONFLICT" });

      expect(await allItems()).toEqual(before);
      expect(await hasAppTeamName("mine")).toBe(true);
    },
  );

  it("returns NOT_FOUND for a team that does not exist and writes nothing (T-TP3)", async () => {
    const before = await allItems();
    expect(
      await updateAppTeam(
        "appteam-00000000-0000-4000-8000-0000000000ff",
        edit(1),
        updateCtx(),
      ),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await allItems()).toEqual(before);
  });

  it("never scans the table (data-model access patterns: Get / Query only)", async () => {
    const team = ok(await createAppTeam(input("Platform Guild"), ctxAt()));
    queryCalls.scans = 0;
    ok(await updateAppTeam(team.teamId, edit(1), updateCtx()));
    expect(queryCalls.scans).toBe(0);
  });
});
