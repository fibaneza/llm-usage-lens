import { ApiErrorBodySchema } from "@llm-usage-lens/shared";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/auth";
import {
  clearTable,
  ensureTestTable,
  loadFixtures,
  makeAccount,
} from "@/test/test-support";

import { GET as getDepartmentDetail } from "./departments/[id]/route";
import { GET as getTeamDetail } from "./teams/[id]/route";

// Source: docs/specs/2026-05-15-data-model.md — "API Routes", rows
// /api/departments/[id] and /api/teams/[id]: the `id` path parameter is
// validated before any read (1-128 characters, no control characters U+0000-
// U+001F / U+007F; 400 BAD_REQUEST otherwise). A valid but unknown id is still
// 404 NOT_FOUND. Security review 2026-11-11 (L3); Rule 50.8.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});
const reads = vi.hoisted(() => ({
  rollups: vi.fn(),
  accounts: vi.fn(),
  byDepartment: vi.fn(),
}));
vi.mock("@/lib/api/load-range-rollups", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/load-range-rollups")
  >("@/lib/api/load-range-rollups");
  return {
    ...actual,
    loadRangeRollups: (...args: Parameters<typeof actual.loadRangeRollups>) => {
      reads.rollups(...args);
      return actual.loadRangeRollups(...args);
    },
  };
});
vi.mock("@/lib/api/cached-reads", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/cached-reads")>(
    "@/lib/api/cached-reads",
  );
  return {
    ...actual,
    getAllAccountsCached: (
      ...args: Parameters<typeof actual.getAllAccountsCached>
    ) => {
      reads.accounts(...args);
      return actual.getAllAccountsCached(...args);
    },
    getAccountsByDepartmentCached: (
      ...args: Parameters<typeof actual.getAccountsByDepartmentCached>
    ) => {
      reads.byDepartment(...args);
      return actual.getAccountsByDepartmentCached(...args);
    },
  };
});

const RANGE = "dateFrom=2026-10-01&dateTo=2026-10-02";
type Handler = (
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) => Promise<Response>;
const call = (handler: unknown, path: string, id: string) =>
  (handler as Handler)(
    new Request(`http://localhost${path}/${encodeURIComponent(id)}?${RANGE}`),
    { params: Promise.resolve({ id }) },
  );

const ROUTES = [
  ["departments/[id]", getDepartmentDetail, "/api/departments"],
  ["teams/[id]", getTeamDetail, "/api/teams"],
] as const;

const INVALID_IDS: [string, string][] = [
  ["129 characters", "a".repeat(129)],
  ["a very long id", "x".repeat(5000)],
  ["a newline", "team\nx"],
  ["a trailing newline", "team-payments\n"],
  ["a NUL", "team\u0000x"],
  ["a tab", "team\tx"],
  ["a carriage return", "team\rx"],
  ["U+001F", "team\u001fx"],
  ["DEL (U+007F)", "team\u007fx"],
  ["only control characters", "\n"],
  ["an empty string", ""],
];

const VALID_IDS: [string, string][] = [
  ["a typical id", "team-payments"],
  ["a department id", "dept-finance"],
  ["a single character", "a"],
  ["exactly 128 characters", "a".repeat(128)],
  ["spaces", "team with spaces"],
  ["a #", "team#1"],
];

beforeAll(ensureTestTable);
beforeEach(async () => {
  (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: {
      oid: "oid-test",
      name: "t",
      email: "t@company.com",
      roles: ["internal-admin"],
    },
  });
  for (const fn of Object.values(reads)) fn.mockClear();
  await clearTable();
});

describe.each(ROUTES)("GET /api/%s id validation", (_name, handler, path) => {
  it.each(INVALID_IDS)(
    "400 BAD_REQUEST for an id with %s, before any data read",
    async (_label, id) => {
      const res = await call(handler, path, id);
      expect(res.status).toBe(400);
      expect(ApiErrorBodySchema.parse(await res.json()).error.code).toBe(
        "BAD_REQUEST",
      );
      expect(reads.rollups).not.toHaveBeenCalled();
      expect(reads.accounts).not.toHaveBeenCalled();
      expect(reads.byDepartment).not.toHaveBeenCalled();
    },
  );

  it("the 400 body does not echo the id", async () => {
    const id = `secret\n${"z".repeat(200)}`;
    const text = await (await call(handler, path, id)).text();
    expect(text).not.toContain("zzzzzzzz");
  });

  it.each(VALID_IDS)(
    "a valid id (%s) that does not exist is still 404 NOT_FOUND",
    async (_label, id) => {
      const res = await call(handler, path, id);
      expect(res.status).toBe(404);
      expect(ApiErrorBodySchema.parse(await res.json()).error.code).toBe(
        "NOT_FOUND",
      );
    },
  );

  it("an invalid id is 401 without a session (session check first)", async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await call(handler, path, "a".repeat(129));
    expect(res.status).toBe(401);
  });
});

describe("existing valid ids are still accepted", () => {
  it.each([
    ["a typical team id", "team-payments"],
    ["a team id with a #", "team#1"],
    ["a team id with spaces", "Team With Spaces"],
  ])("GET /api/teams/[id] returns 200 for %s", async (_label, teamId) => {
    await loadFixtures({ accounts: [makeAccount(1, { teamId })] });
    const res = await call(getTeamDetail, "/api/teams", teamId);
    // Unknown to rollups but present in AccountMeta: a team with no usage.
    expect(res.status).toBe(200);
  });

  it.each([["dept#1"], ["Dept With Spaces"]])(
    "GET /api/departments/[id] returns 200 for %s",
    async (departmentId) => {
      await loadFixtures({
        accounts: [
          makeAccount(1, { departmentId, departmentName: "A department" }),
        ],
      });
      const res = await call(
        getDepartmentDetail,
        "/api/departments",
        departmentId,
      );
      expect(res.status).toBe(200);
    },
  );
});
