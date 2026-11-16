import { TeamsResponseSchema, apiSuccessSchema } from "@llm-usage-lens/shared";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/auth";
import { buildRollup } from "@/test/fixtures/rollup-builder";
import {
  clearTable,
  ensureTestTable,
  loadFixtures,
  makeAccount,
} from "@/test/support/test-support";

import { GET as getTeams } from "../teams/route";

// Source: docs/specs/2026-05-15-data-model.md -- "Zod Validation Schemas"
// (`GET /api/teams` rows carry `serviceCount`: distinct `byService` keys across
// every model entry in the range excluding `_untagged`; `userCount`: distinct
// `byUser` keys; both 0 with no attributed usage); implementation-phases
// Phase 4.5 ("Connect to Route Handler: GET /api/teams"); Rules 20.10, 60.22.
// Runs against DynamoDB Local; only the session is mocked.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const RANGE = "dateFrom=2026-10-01&dateTo=2026-10-03";

const payments = makeAccount(1);
const idle = makeAccount(2, { teamId: "team-idle", teamName: "Idle" });

beforeAll(ensureTestTable);
beforeEach(async () => {
  (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: {
      oid: "oid-test",
      name: "Test",
      email: "t@company.com",
      roles: ["internal-admin"],
    },
  });
  await clearTable();
  await loadFixtures({
    accounts: [payments, idle],
    rollups: [
      buildRollup({
        date: "2026-10-01",
        accountId: payments.accountId,
        models: {
          "claude-sonnet": {
            cost: 10,
            byUser: { "a@x.com": 6, "b@x.com": 4 },
            byService: { "payments-api": 7, _untagged: 3 },
          },
          "claude-haiku": { cost: 2, byUser: { "a@x.com": 2 } },
        },
      }),
      buildRollup({
        date: "2026-10-02",
        accountId: payments.accountId,
        models: {
          "claude-opus": {
            cost: 5,
            byUser: { "c@x.com": 5 },
            byService: { "payments-api": 2, "billing-svc": 3 },
          },
        },
      }),
      buildRollup({
        date: "2026-10-02",
        accountId: idle.accountId,
        teamId: "team-idle",
        teamName: "Idle",
        models: {},
        nonModel: { "provisioned-throughput": { cost: 20, recurring: true } },
      }),
    ],
  });
});

async function listTeams() {
  const res = await (
    getTeams as unknown as (
      request: Request,
      ctx: { params: Promise<Record<string, string>> },
    ) => Promise<Response>
  )(new Request(`http://localhost/api/teams?${RANGE}`), {
    params: Promise.resolve({}),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(apiSuccessSchema(TeamsResponseSchema).safeParse(body).success).toBe(
    true,
  );
  return TeamsResponseSchema.parse(body.data).teams;
}

describe("GET /api/teams -- serviceCount and userCount", () => {
  it("counts distinct services (excluding _untagged) and users across models and days", async () => {
    const teams = await listTeams();
    const row = teams.find((t) => t.teamId !== "team-idle");
    expect(row).toMatchObject({ serviceCount: 2, userCount: 3 });
  });

  it("returns 0 and 0 for a team with only non-model charges", async () => {
    const teams = await listTeams();
    expect(teams.find((t) => t.teamId === "team-idle")).toMatchObject({
      serviceCount: 0,
      userCount: 0,
    });
  });
});
