import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { clearTable, ensureTestTable } from "@/test/test-support";

vi.mock("@/lib/dynamodb", () =>
  import("./access-test-support").then((m) => m.faultyDynamodb()),
);

import {
  NOW,
  auditRecords,
  ctxAt,
  faults,
  ok,
  resetFaults,
} from "./access-test-support";
import {
  getVisibility,
  putDepartmentVisibility,
  putTeamVisibility,
} from "./visibility";

// Source: docs/specs/2026-11-10-access-control.md — "Visibility" defaults
// (team: visible/own, department: hidden/own; applied when no item exists),
// "Audit log" (visibility.update, one change record in the same transaction;
// stale version -> 409 and no record); contract R2 §3 `visibility`.
beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetFaults();
});

describe("getVisibility defaults", () => {
  it("returns the team default (visible, own) at version 0 for a team with no item", async () => {
    const { teams } = await getVisibility({
      teamIds: ["team-a"],
      departmentIds: [],
    });
    expect(teams.get("team-a")).toMatchObject({
      teamId: "team-a",
      teamLevel: "visible",
      userLevel: "own",
      version: 0,
    });
  });

  it("returns the department default (hidden, own) at version 0 for a department with no item", async () => {
    const { departments } = await getVisibility({
      teamIds: [],
      departmentIds: ["dept-a"],
    });
    expect(departments.get("dept-a")).toMatchObject({
      departmentId: "dept-a",
      departmentLevel: "hidden",
      maxUserLevel: "own",
      version: 0,
    });
  });

  it("returns an empty result for empty requests", async () => {
    const { teams, departments } = await getVisibility({
      teamIds: [],
      departmentIds: [],
    });
    expect(teams.size).toBe(0);
    expect(departments.size).toBe(0);
  });

  it("covers every requested id (more than one batch) and mixes stored with default", async () => {
    ok(
      await putTeamVisibility(
        {
          teamId: "team-007",
          teamLevel: "hidden",
          userLevel: "none",
          version: null,
        },
        ctxAt(),
      ),
    );
    const ids = Array.from(
      { length: 130 },
      (_, i) => `team-${String(i).padStart(3, "0")}`,
    );
    const { teams } = await getVisibility({ teamIds: ids, departmentIds: [] });
    expect(teams.size).toBe(130);
    expect(teams.get("team-007")).toMatchObject({
      teamLevel: "hidden",
      userLevel: "none",
      version: 1,
    });
    expect(teams.get("team-008")).toMatchObject({
      teamLevel: "visible",
      userLevel: "own",
      version: 0,
    });
  });
});

describe("putTeamVisibility", () => {
  it("creates the item with version null and writes one visibility.update record", async () => {
    const created = ok(
      await putTeamVisibility(
        {
          teamId: "team-a",
          teamLevel: "hidden",
          userLevel: "all",
          version: null,
        },
        ctxAt(),
      ),
    );
    expect(created).toMatchObject({
      teamId: "team-a",
      teamLevel: "hidden",
      userLevel: "all",
      version: 1,
      updatedAt: NOW.toISOString(),
    });
    const { teams } = await getVisibility({
      teamIds: ["team-a"],
      departmentIds: [],
    });
    expect(teams.get("team-a")).toEqual(created);
    const records = await auditRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "visibility.update",
      category: "change",
      result: "success",
      target: { type: "team", id: "team-a" },
      teamId: "team-a",
    });
  });

  it("updates with the current version and bumps it", async () => {
    const v1 = ok(
      await putTeamVisibility(
        {
          teamId: "team-a",
          teamLevel: "visible",
          userLevel: "own",
          version: null,
        },
        ctxAt(),
      ),
    );
    const v2 = ok(
      await putTeamVisibility(
        {
          teamId: "team-a",
          teamLevel: "visible",
          userLevel: "none",
          version: v1.version,
        },
        ctxAt(NOW, "r2"),
      ),
    );
    expect(v2).toMatchObject({ userLevel: "none", version: v1.version + 1 });
    expect(await auditRecords()).toHaveLength(2);
  });

  it("returns CONFLICT when creating over an existing item, no record", async () => {
    ok(
      await putTeamVisibility(
        {
          teamId: "team-a",
          teamLevel: "visible",
          userLevel: "own",
          version: null,
        },
        ctxAt(),
      ),
    );
    expect(
      await putTeamVisibility(
        {
          teamId: "team-a",
          teamLevel: "hidden",
          userLevel: "own",
          version: null,
        },
        ctxAt(NOW, "r2"),
      ),
    ).toEqual({ ok: false, code: "CONFLICT" });
    expect(await auditRecords()).toHaveLength(1);
  });

  it("returns a failure for a stale version, no record", async () => {
    const v1 = ok(
      await putTeamVisibility(
        {
          teamId: "team-a",
          teamLevel: "visible",
          userLevel: "own",
          version: null,
        },
        ctxAt(),
      ),
    );
    ok(
      await putTeamVisibility(
        {
          teamId: "team-a",
          teamLevel: "hidden",
          userLevel: "own",
          version: v1.version,
        },
        ctxAt(NOW, "r2"),
      ),
    );
    expect(
      await putTeamVisibility(
        {
          teamId: "team-a",
          teamLevel: "visible",
          userLevel: "all",
          version: v1.version,
        },
        ctxAt(NOW, "r3"),
      ),
    ).toEqual({ ok: false, code: "CONFLICT" });
    expect(await auditRecords()).toHaveLength(2);
  });

  it("fails (no write) when a version is supplied for an item that does not exist", async () => {
    const result = await putTeamVisibility(
      { teamId: "team-a", teamLevel: "hidden", userLevel: "own", version: 3 },
      ctxAt(),
    );
    expect(result.ok).toBe(false);
    expect(await auditRecords()).toEqual([]);
  });

  it("writes one failed record and rethrows when the transaction fails", async () => {
    faults.transact = true;
    await expect(
      putTeamVisibility(
        {
          teamId: "team-a",
          teamLevel: "hidden",
          userLevel: "own",
          version: null,
        },
        ctxAt(),
      ),
    ).rejects.toThrow();
    faults.transact = false;
    const records = await auditRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "visibility.update",
      result: "failed",
    });
  });
});

describe("putDepartmentVisibility", () => {
  it("creates, reads back and audits a department item", async () => {
    const created = ok(
      await putDepartmentVisibility(
        {
          departmentId: "dept-a",
          departmentLevel: "visible",
          maxUserLevel: "all",
          version: null,
        },
        ctxAt(),
      ),
    );
    expect(created).toMatchObject({
      departmentId: "dept-a",
      departmentLevel: "visible",
      maxUserLevel: "all",
      version: 1,
    });
    const { departments } = await getVisibility({
      teamIds: [],
      departmentIds: ["dept-a"],
    });
    expect(departments.get("dept-a")).toEqual(created);
    const records = await auditRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "visibility.update",
      target: { type: "department", id: "dept-a" },
    });
  });

  it("returns CONFLICT for a stale version", async () => {
    const v1 = ok(
      await putDepartmentVisibility(
        {
          departmentId: "dept-a",
          departmentLevel: "visible",
          maxUserLevel: "own",
          version: null,
        },
        ctxAt(),
      ),
    );
    ok(
      await putDepartmentVisibility(
        {
          departmentId: "dept-a",
          departmentLevel: "hidden",
          maxUserLevel: "own",
          version: v1.version,
        },
        ctxAt(NOW, "r2"),
      ),
    );
    expect(
      await putDepartmentVisibility(
        {
          departmentId: "dept-a",
          departmentLevel: "visible",
          maxUserLevel: "none",
          version: v1.version,
        },
        ctxAt(NOW, "r3"),
      ),
    ).toEqual({ ok: false, code: "CONFLICT" });
  });
});
