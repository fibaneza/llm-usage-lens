import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { clearTable, ensureTestTable } from "@/test/support/test-support";

// Pages of 2 items so GSI1 pagination is exercised with a handful of teams
// (Rule 20.6); every other command goes to DynamoDB Local unchanged.
const queryCalls = vi.hoisted(() => ({ count: 0 }));
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
import { ScanCommand } from "@aws-sdk/lib-dynamodb";

import {
  createAppTeam,
  getAppTeam,
  hasAppTeamName,
  listAppTeams,
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
