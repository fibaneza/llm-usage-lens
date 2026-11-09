import { readdirSync } from "node:fs";
import { join, sep } from "node:path";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/auth";
import type { RouteContext } from "@/lib/api/respond";
import { ensureTestTable } from "@/test/test-support";

// Source: docs/specs/2026-11-10-access-control.md — "API routes": every
// /api/* route requires a session except GET /api/health; Rule 10.3, 50.4.
// A new route cannot ship without a session check: every GET route file other
// than health and Auth.js's handler must answer 401 with no session.

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

const API_DIR = __dirname;
const AUTH_JS_HANDLER = "auth/[...nextauth]/route.ts";
const HEALTH = "health/route.ts";

type Handler = (request: Request, ctx: RouteContext) => Promise<Response>;

const files = readdirSync(API_DIR, { recursive: true, encoding: "utf8" })
  .map((entry) => entry.split(sep).join("/"))
  .filter((entry) => /(^|\/)route\.(ts|tsx|js|jsx|mjs)$/.test(entry))
  .sort();

function dummyParts(file: string) {
  const params: Record<string, string> = {};
  const segments = file
    .split("/")
    .slice(0, -1)
    .map((segment) => {
      const dynamic = /^\[([\w-]+)\]$/.exec(segment);
      if (dynamic?.[1]) {
        params[dynamic[1]] = "not-an-id";
        return "not-an-id";
      }
      return segment;
    });
  return { path: `/api${segments.map((s) => `/${s}`).join("")}`, params };
}

beforeAll(ensureTestTable);
beforeEach(() => {
  vi.mocked(auth).mockReset();
  vi.mocked(auth).mockResolvedValue(null as never);
});

describe("routes that serve without a session", () => {
  it("includes the health route file", () => {
    expect(files).toContain(HEALTH);
  });

  it("health/route.ts is the only route besides Auth.js's that answers without a session", async () => {
    const open: string[] = [];
    for (const file of files) {
      if (file === AUTH_JS_HANDLER) continue;
      const mod: Record<string, unknown> = await import(
        /* @vite-ignore */ join(API_DIR, file)
      );
      const get = mod.GET;
      if (typeof get !== "function") continue;
      const { path, params } = dummyParts(file);
      const res = await (get as Handler)(
        new Request(`http://localhost${path}`),
        { params: Promise.resolve(params) },
      );
      if (res.status !== 401) open.push(file);
    }
    expect(open).toEqual([HEALTH]);
  });

  it.each(files.filter((f) => f !== AUTH_JS_HANDLER && f !== HEALTH))(
    "%s: GET returns 401 UNAUTHORIZED without a session",
    async (file) => {
      const mod: Record<string, unknown> = await import(
        /* @vite-ignore */ join(API_DIR, file)
      );
      if (typeof mod.GET !== "function") return;
      const { path, params } = dummyParts(file);
      const res = await (mod.GET as Handler)(
        new Request(`http://localhost${path}`),
        { params: Promise.resolve(params) },
      );
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe("UNAUTHORIZED");
    },
  );
});
