import {
  ServicesResponseSchema,
  apiSuccessSchema,
} from "@llm-usage-lens/shared";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/auth";
import { buildRollup } from "@/test/rollup-builder";
import {
  clearTable,
  ensureTestTable,
  loadFixtures,
  makeAccount,
} from "@/test/test-support";

import { GET as getServices } from "./services/route";

// Source: docs/specs/2026-05-15-data-model.md -- "Zod Validation Schemas"
// (`GET /api/services`: one row per team and service, merged across the team's
// accounts, with the team's latest team and department names; decided
// 2026-11-06) and "Non-model cost is account-level only"; implementation-phases
// Phase 4.7; Rules 20.3, 20.10, 60.22. 401 / 400 paths are covered for this
// route by aggregation.integration.test.ts. Runs against DynamoDB Local.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

const RANGE = "dateFrom=2026-10-01&dateTo=2026-10-03";

const payA = makeAccount(1);
const payB = makeAccount(2);
const ledger = makeAccount(3, {
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
    accounts: [payA, payB, ledger],
    rollups: [
      buildRollup({
        date: "2026-10-01",
        accountId: payA.accountId,
        models: {
          "claude-sonnet": {
            cost: 10,
            byService: { "payments-api": 6, _untagged: 4 },
          },
        },
      }),
      buildRollup({
        date: "2026-10-02",
        accountId: payB.accountId,
        teamName: "Payments Renamed",
        models: {
          "claude-haiku": { cost: 5, byService: { "payments-api": 5 } },
        },
        nonModel: { guardrails: { cost: 9, recurring: false } },
      }),
      buildRollup({
        date: "2026-10-02",
        accountId: ledger.accountId,
        departmentId: "dept-finance",
        departmentName: "Finance",
        teamId: "team-ledger",
        teamName: "Ledger",
        models: {
          "claude-opus": {
            cost: 30,
            byService: { "payments-api": 30, _untagged: 1 },
          },
        },
      }),
    ],
  });
});

async function listServices() {
  const res = await (
    getServices as unknown as (
      request: Request,
      ctx: { params: Promise<Record<string, string>> },
    ) => Promise<Response>
  )(new Request(`http://localhost/api/services?${RANGE}`), {
    params: Promise.resolve({}),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(apiSuccessSchema(ServicesResponseSchema).safeParse(body).success).toBe(
    true,
  );
  return ServicesResponseSchema.parse(body.data).services;
}

describe("GET /api/services -- per-team rows", () => {
  it("merges a team's service across accounts and keeps teams separate", async () => {
    const rows = await listServices();
    expect(rows.map((r) => [r.serviceName, r.teamId, r.cost])).toEqual([
      ["payments-api", "team-ledger", 30],
      ["payments-api", "team-payments", 11],
      ["_untagged", "team-payments", 4],
      ["_untagged", "team-ledger", 1],
    ]);
  });

  it("carries the team's latest names, estimated flag and no non-model cost", async () => {
    const rows = await listServices();
    const pay = rows.find(
      (r) => r.teamId === "team-payments" && r.serviceName === "payments-api",
    );
    expect(pay).toMatchObject({
      teamName: "Payments Renamed",
      departmentId: "dept-engineering",
      departmentName: "Engineering",
      costEstimated: true,
    });
    expect(rows.reduce((s, r) => s + r.cost, 0)).toBeCloseTo(46);
  });
});
