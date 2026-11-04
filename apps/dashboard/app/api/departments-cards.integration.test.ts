import {
  DepartmentDetailResponseSchema,
  DepartmentsResponseSchema,
  apiSuccessSchema,
} from "@bedrock-usage/shared";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/auth";
import { buildRollup } from "@/test/rollup-builder";
import {
  clearTable,
  ensureTestTable,
  loadFixtures,
  makeAccount,
} from "@/test/test-support";

import { GET as getDepartmentDetail } from "./departments/[id]/route";
import { GET as getDepartments } from "./departments/route";

const acct = (n: number) => String(n).padStart(12, "0");

// Source: docs/specs/2026-05-15-data-model.md -- "Zod Validation Schemas"
// (`GET /api/departments` rows carry `teamCount`: distinct teams with rollups
// for the department in the range, and `topModel`: the model with the most
// invocations in the range or `null`), "Historical Snapshots" (a team that
// moved departments counts under each department its rollups name);
// implementation-phases Phase 4.3 ("Connect to Route Handler: all accounts
// grouped by department"); Rules 20.7, 60.22. Runs against DynamoDB Local; only
// the session (`@/auth`) is mocked.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

const RANGE = "dateFrom=2026-10-01&dateTo=2026-10-03";

type Handler = (
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) => Promise<Response>;

const call = (handler: unknown, url: string, id = "x") =>
  (handler as Handler)(new Request(`http://localhost${url}`), {
    params: Promise.resolve({ id }),
  });

// Engineering: team-payments (accounts 1 and 2), team-platform (account 4) and
// the roaming team on 10-01. Sonnet has the most invocations (3 + 3) even
// though Opus costs the most, so the top model is not the costliest one.
// Finance: team-ledger (idle Provisioned Throughput) and the roaming team on
// 10-02 after it moved (guardrails only) -- two teams, no model usage.
// 10-09 is outside the range: team-late and its 50 Opus invocations must not
// count, and Legal (rollups only out of range) must not appear at all.
const eng = makeAccount(1);
const eng2 = makeAccount(2);
const platform = makeAccount(4, { teamId: "team-platform" });
const roaming = makeAccount(5, { teamId: "team-roaming" });
const fin = makeAccount(3, {
  departmentId: "dept-finance",
  departmentName: "Finance",
  teamId: "team-ledger",
  teamName: "Ledger",
});

beforeAll(ensureTestTable);
beforeEach(async () => {
  (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: { name: "Test", email: "t@company.com" },
  });
  await clearTable();
  await loadFixtures({
    accounts: [eng, eng2, platform, roaming, fin],
    rollups: [
      buildRollup({
        date: "2026-10-01",
        accountId: eng.accountId,
        models: {
          "claude-sonnet": { cost: 10, invocations: 3 },
          "claude-opus": { cost: 30, invocations: 1 },
        },
      }),
      buildRollup({
        date: "2026-10-02",
        accountId: eng2.accountId,
        models: { "claude-sonnet": { cost: 10, invocations: 3 } },
      }),
      buildRollup({
        date: "2026-10-02",
        accountId: platform.accountId,
        teamId: "team-platform",
        teamName: "Platform",
        models: { "claude-haiku": { cost: 1, invocations: 1 } },
      }),
      buildRollup({
        date: "2026-10-01",
        accountId: roaming.accountId,
        teamId: "team-roaming",
        teamName: "Roaming",
        models: { "claude-haiku": { cost: 1, invocations: 1 } },
      }),
      buildRollup({
        date: "2026-10-02",
        accountId: roaming.accountId,
        departmentId: "dept-finance",
        departmentName: "Finance",
        teamId: "team-roaming",
        teamName: "Roaming",
        models: {},
        nonModel: { guardrails: { cost: 2, recurring: false } },
      }),
      buildRollup({
        date: "2026-10-03",
        accountId: fin.accountId,
        departmentId: "dept-finance",
        departmentName: "Finance",
        teamId: "team-ledger",
        teamName: "Ledger",
        models: {},
        nonModel: { "provisioned-throughput": { cost: 20, recurring: true } },
      }),
      buildRollup({
        date: "2026-10-09",
        accountId: acct(6),
        teamId: "team-late",
        teamName: "Late",
        models: { "claude-opus": { cost: 99, invocations: 50 } },
      }),
      buildRollup({
        date: "2026-10-09",
        accountId: acct(7),
        departmentId: "dept-legal",
        departmentName: "Legal",
        teamId: "team-contracts",
        teamName: "Contracts",
        models: { "claude-haiku": { cost: 5, invocations: 9 } },
      }),
    ],
  });
});

async function listRows() {
  const res = await call(getDepartments, `/api/departments?${RANGE}`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(
    apiSuccessSchema(DepartmentsResponseSchema).safeParse(body).success,
  ).toBe(true);
  return DepartmentsResponseSchema.parse(body.data).departments;
}

describe("GET /api/departments -- teamCount and topModel", () => {
  it("returns teamCount and topModel on every department row", async () => {
    const rows = await listRows();

    expect(rows.map((r) => r.departmentId)).toEqual([
      "dept-engineering",
      "dept-finance",
    ]);
    for (const r of rows) {
      expect(Number.isInteger(r.teamCount)).toBe(true);
      expect(r).toHaveProperty("topModel");
    }
  });

  it("counts distinct teams across accounts, days and a team that moved departments", async () => {
    const rows = await listRows();
    const byId = Object.fromEntries(rows.map((r) => [r.departmentId, r]));

    // payments (two accounts, two days), platform, roaming (before it moved).
    expect(byId["dept-engineering"]?.teamCount).toBe(3);
    // ledger and roaming (after it moved); roaming also counts under Engineering.
    expect(byId["dept-finance"]?.teamCount).toBe(2);
  });

  it("picks the model with the most invocations in the range, not the costliest", async () => {
    const rows = await listRows();
    const engineering = rows.find((r) => r.departmentId === "dept-engineering");

    expect(engineering?.topModel).toBe("claude-sonnet");
  });

  it("returns topModel null for a department with only non-model charges", async () => {
    const rows = await listRows();
    const finance = rows.find((r) => r.departmentId === "dept-finance");

    expect(finance?.topModel).toBeNull();
    expect(finance?.nonModelCost).toBeCloseTo(22);
  });

  it("ignores teams and invocations that fall outside the requested range", async () => {
    const rows = await listRows();

    expect(rows.find((r) => r.departmentId === "dept-legal")).toBeUndefined();
    expect(
      rows.find((r) => r.departmentId === "dept-engineering")?.teamCount,
    ).toBe(3);
    expect(
      rows.find((r) => r.departmentId === "dept-engineering")?.topModel,
    ).toBe("claude-sonnet");
  });

  it("derives the figures from the requested range alone", async () => {
    const res = await call(
      getDepartments,
      "/api/departments?dateFrom=2026-10-09&dateTo=2026-10-09",
    );
    const { data } = await res.json();
    const rows = DepartmentsResponseSchema.parse(data).departments;
    const byId = Object.fromEntries(rows.map((r) => [r.departmentId, r]));

    expect(byId["dept-engineering"]).toMatchObject({
      teamCount: 1,
      topModel: "claude-opus",
    });
    expect(byId["dept-legal"]).toMatchObject({
      teamCount: 1,
      topModel: "claude-haiku",
    });
  });

  it("keeps the existing totals alongside the new fields", async () => {
    const rows = await listRows();
    const engineering = rows.find((r) => r.departmentId === "dept-engineering");

    expect(engineering).toMatchObject({
      departmentName: "Engineering",
      cost: 52,
      modelCost: 52,
      nonModelCost: 0,
    });
  });

  it("returns an empty list, not an error, when no rollups fall in the range", async () => {
    const res = await call(
      getDepartments,
      "/api/departments?dateFrom=2026-08-01&dateTo=2026-08-02",
    );

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ departments: [] });
  });
});

describe("GET /api/departments/[id] -- teamCount and topModel", () => {
  it("carries the same teamCount and topModel as the list row", async () => {
    const rows = await listRows();
    for (const id of ["dept-engineering", "dept-finance"]) {
      const res = await call(
        getDepartmentDetail,
        `/api/departments/${id}?${RANGE}`,
        id,
      );
      expect(res.status).toBe(200);
      const detail = DepartmentDetailResponseSchema.parse(
        (await res.json()).data,
      );
      const listed = rows.find((r) => r.departmentId === id);

      expect(listed?.teamCount).toBeGreaterThan(0);
      expect(detail.teamCount).toBe(listed?.teamCount);
      expect(detail.topModel).toBe(listed?.topModel);
      expect(detail.teamCount).toBe(detail.teams.length);
    }
  });
});
