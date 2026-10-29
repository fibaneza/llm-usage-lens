import {
  ApiErrorBodySchema,
  DepartmentDetailResponseSchema,
  TeamDetailResponseSchema,
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
import { GET as getTeamDetail } from "./teams/[id]/route";

const acct = (n: number) => String(n).padStart(12, "0");

// Source: docs/specs/2026-05-15-data-model.md — "API Routes" (404 when the
// entity does not exist), "Historical Snapshots" and the rollup's denormalised
// dept/team fields. A department/team that left AccountMeta (or whose account is
// inactive) but has rollups in the requested range is historical: 200, not 404.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

const RANGE = "dateFrom=2026-10-01&dateTo=2026-10-02";
type Handler = (
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) => Promise<Response>;
const call = (handler: unknown, path: string, id: string, qs = RANGE) =>
  (handler as Handler)(new Request(`http://localhost${path}/${id}?${qs}`), {
    params: Promise.resolve({ id }),
  });

const legacyRollup = buildRollup({
  date: "2026-10-01",
  accountId: acct(99),
  departmentId: "dept-legacy",
  departmentName: "Legacy Dept",
  teamId: "team-legacy",
  teamName: "Legacy Team",
  models: { "claude-sonnet": { cost: 7, byUser: { "a@x.com": 7 } } },
});

beforeAll(ensureTestTable);
beforeEach(async () => {
  (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: { name: "t", email: "t@company.com" },
  });
  await clearTable();
});

describe("GET /api/departments/[id] historical fallback", () => {
  it("200 when no AccountMeta references the department but rollups do", async () => {
    await loadFixtures({ accounts: [makeAccount(1)], rollups: [legacyRollup] });
    const res = await call(
      getDepartmentDetail,
      "/api/departments",
      "dept-legacy",
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const detail = DepartmentDetailResponseSchema.parse(data);
    expect(detail.departmentId).toBe("dept-legacy");
    expect(detail.departmentName).toBe("Legacy Dept");
    expect(detail.cost).toBeGreaterThan(0);
  });

  it("200 when the department's only account is inactive and has rollups", async () => {
    await loadFixtures({
      accounts: [
        makeAccount(99, {
          active: false,
          departmentId: "dept-legacy",
          departmentName: "Legacy Dept",
        }),
      ],
      rollups: [legacyRollup],
    });
    const res = await call(
      getDepartmentDetail,
      "/api/departments",
      "dept-legacy",
    );
    expect(res.status).toBe(200);
  });

  it("404 NOT_FOUND when neither AccountMeta nor rollups reference it", async () => {
    await loadFixtures({ accounts: [makeAccount(1)], rollups: [legacyRollup] });
    const res = await call(
      getDepartmentDetail,
      "/api/departments",
      "dept-ghost",
    );
    expect(res.status).toBe(404);
    expect(ApiErrorBodySchema.parse(await res.json()).error.code).toBe(
      "NOT_FOUND",
    );
  });

  it("404 when the department has no meta and no rollups in the requested range", async () => {
    await loadFixtures({ rollups: [legacyRollup] });
    const res = await call(
      getDepartmentDetail,
      "/api/departments",
      "dept-legacy",
      "dateFrom=2026-09-01&dateTo=2026-09-02",
    );
    expect(res.status).toBe(404);
  });

  it("still 200 for a department that exists in AccountMeta with no rollups", async () => {
    await loadFixtures({ accounts: [makeAccount(1)] });
    const res = await call(
      getDepartmentDetail,
      "/api/departments",
      "dept-engineering",
    );
    expect(res.status).toBe(200);
  });
});

describe("GET /api/teams/[id] historical fallback", () => {
  it("200 when no AccountMeta references the team but rollups do", async () => {
    await loadFixtures({ accounts: [makeAccount(1)], rollups: [legacyRollup] });
    const res = await call(getTeamDetail, "/api/teams", "team-legacy");
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const detail = TeamDetailResponseSchema.parse(data);
    expect(detail.teamId).toBe("team-legacy");
    expect(detail.teamName).toBe("Legacy Team");
    expect(detail.departmentId).toBe("dept-legacy");
    expect(detail.cost).toBeGreaterThan(0);
  });

  it("404 NOT_FOUND when neither AccountMeta nor rollups reference it", async () => {
    await loadFixtures({ accounts: [makeAccount(1)], rollups: [legacyRollup] });
    const res = await call(getTeamDetail, "/api/teams", "team-ghost");
    expect(res.status).toBe(404);
    expect(ApiErrorBodySchema.parse(await res.json()).error.code).toBe(
      "NOT_FOUND",
    );
  });

  it("404 when the team has no meta and no rollups in the requested range", async () => {
    await loadFixtures({ rollups: [legacyRollup] });
    const res = await call(
      getTeamDetail,
      "/api/teams",
      "team-legacy",
      "dateFrom=2026-09-01&dateTo=2026-09-02",
    );
    expect(res.status).toBe(404);
  });
});

describe("historical name uses the latest rollup in range", () => {
  const renamed = (date: string, dept: string, team: string) =>
    buildRollup({
      date,
      accountId: acct(99),
      departmentId: "dept-legacy",
      departmentName: dept,
      teamId: "team-legacy",
      teamName: team,
      models: { "claude-sonnet": { cost: 3, byUser: { "a@x.com": 3 } } },
    });
  const rollups = [
    renamed("2026-10-01", "Old Dept", "Old Team"),
    renamed("2026-10-02", "New Dept", "New Team"),
  ];

  it("department detail shows the name from the latest day in range", async () => {
    await loadFixtures({ accounts: [makeAccount(1)], rollups });
    const res = await call(
      getDepartmentDetail,
      "/api/departments",
      "dept-legacy",
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(DepartmentDetailResponseSchema.parse(data).departmentName).toBe(
      "New Dept",
    );
  });

  it("team detail shows the name from the latest day in range", async () => {
    await loadFixtures({ accounts: [makeAccount(1)], rollups });
    const res = await call(getTeamDetail, "/api/teams", "team-legacy");
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(TeamDetailResponseSchema.parse(data).teamName).toBe("New Team");
  });
});
