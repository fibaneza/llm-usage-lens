import {
  DepartmentsResponseSchema,
  OverviewResponseSchema,
  RankingResponseSchema,
  TeamsResponseSchema,
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

import { GET as getDepartments } from "./departments/route";
import { GET as getOverview } from "./overview/route";
import { GET as getRanking } from "./ranking/route";
import { GET as getTeams } from "./teams/route";

// Source: docs/specs/2026-05-15-data-model.md — "Historical Snapshots for
// Department/Team Names": a renamed id shows its latest name in the range in
// aggregate rows (list and detail routes).
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

type Handler = (
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) => Promise<Response>;

const call = (handler: unknown, url: string, id = "x") =>
  (handler as Handler)(new Request(`http://localhost${url}`), {
    params: Promise.resolve({ id }),
  });

const RANGE = "dateFrom=2026-10-01&dateTo=2026-10-02";
const acct = (n: number) => String(n).padStart(12, "0");

const day = (
  date: string,
  deptId: string,
  deptName: string,
  teamName: string,
) =>
  buildRollup({
    date,
    accountId: acct(99),
    departmentId: deptId,
    departmentName: deptName,
    teamId: "team-x",
    teamName,
    models: { "claude-sonnet": { cost: 3, byUser: { "a@x.com": 3 } } },
  });

beforeAll(ensureTestTable);
beforeEach(async () => {
  (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: { name: "t", email: "t@company.com" },
  });
  await clearTable();
});

describe("list and summary routes show the latest name in range", () => {
  it("GET /api/departments row shows the latest department name", async () => {
    await loadFixtures({
      accounts: [makeAccount(1)],
      rollups: [
        day("2026-10-01", "dept-x", "Old Dept", "Old Team"),
        day("2026-10-02", "dept-x", "New Dept", "New Team"),
      ],
    });
    const res = await call(getDepartments, `/api/departments?${RANGE}`);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const rows = DepartmentsResponseSchema.parse(data).departments.filter(
      (d) => d.departmentId === "dept-x",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.departmentName).toBe("New Dept");
  });

  it("GET /api/overview topDepartments shows the latest department name", async () => {
    await loadFixtures({
      accounts: [makeAccount(1)],
      rollups: [
        day("2026-10-01", "dept-x", "Old Dept", "Old Team"),
        day("2026-10-02", "dept-x", "New Dept", "New Team"),
      ],
    });
    const res = await call(getOverview, `/api/overview?${RANGE}`);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const rows = OverviewResponseSchema.parse(data).topDepartments.filter(
      (d) => d.departmentId === "dept-x",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.departmentName).toBe("New Dept");
  });

  it("GET /api/teams row shows the latest team and department names", async () => {
    await loadFixtures({
      accounts: [makeAccount(1)],
      rollups: [
        day("2026-10-01", "dept-old", "Old Dept", "Old Team"),
        day("2026-10-02", "dept-new", "New Dept", "New Team"),
      ],
    });
    const res = await call(getTeams, `/api/teams?${RANGE}`);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const rows = TeamsResponseSchema.parse(data).teams.filter(
      (t) => t.teamId === "team-x",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.teamName).toBe("New Team");
    expect(rows[0]?.departmentId).toBe("dept-new");
    expect(rows[0]?.departmentName).toBe("New Dept");
  });

  it.each([
    { tab: "departments", id: "dept-x", expected: "New Dept" },
    { tab: "teams", id: "team-x", expected: "New Team" },
  ])(
    "GET /api/ranking?tab=$tab row shows the latest name ($expected)",
    async ({ tab, id, expected }) => {
      await loadFixtures({
        accounts: [makeAccount(1)],
        rollups: [
          day("2026-10-01", "dept-x", "Old Dept", "Old Team"),
          day("2026-10-02", "dept-x", "New Dept", "New Team"),
        ],
      });
      const res = await call(getRanking, `/api/ranking?tab=${tab}&${RANGE}`);
      expect(res.status).toBe(200);
      const { data } = await res.json();
      const rows = RankingResponseSchema.parse(data).rows.filter(
        (r) => r.id === id,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.name).toBe(expected);
    },
  );
});
