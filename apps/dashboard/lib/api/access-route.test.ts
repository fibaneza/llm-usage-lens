import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
const envMock = vi.hoisted(() => ({ env: {} as { AUTH_SECRET?: string } }));
vi.mock("@/env", () => envMock);
vi.mock("@/lib/data/access/audit", () => ({ appendDeniedAudit: vi.fn() }));

import {
  GroupIdSchema,
  accessErrorResponse,
  cursorSecret,
} from "@/lib/api/access-route";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)",
// "Error-code registry": CONFLICT, MANAGED_BY_SSO and ALREADY_AFFILIATED are
// distinct codes (all 409), BAD_CURSOR is internal and surfaces as 400
// BAD_REQUEST, NOT_FOUND is 404. 4R.4 slice-1 review warning: the last two
// 409 codes were collapsed into a generic CONFLICT.
async function body(res: Response) {
  return (await res.json()) as { error: { code: string; message: string } };
}

describe("accessErrorResponse", () => {
  it.each([
    ["CONFLICT", 409, "CONFLICT"],
    ["MANAGED_BY_SSO", 409, "MANAGED_BY_SSO"],
    ["ALREADY_AFFILIATED", 409, "ALREADY_AFFILIATED"],
    ["NOT_FOUND", 404, "NOT_FOUND"],
    ["BAD_CURSOR", 400, "BAD_REQUEST"],
  ] as const)("maps %s to %i %s", async (input, status, code) => {
    const res = accessErrorResponse(input);
    expect(res.status).toBe(status);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const parsed = await body(res);
    expect(parsed.error.code).toBe(code);
    expect(parsed.error.message.length).toBeGreaterThan(0);
  });

  it("gives MANAGED_BY_SSO and ALREADY_AFFILIATED their own bodies, not CONFLICT's", async () => {
    const [conflict, managed, affiliated] = await Promise.all(
      (["CONFLICT", "MANAGED_BY_SSO", "ALREADY_AFFILIATED"] as const).map(
        async (c) => body(accessErrorResponse(c)),
      ),
    );
    expect(managed?.error.code).not.toBe(conflict?.error.code);
    expect(affiliated?.error.code).not.toBe(conflict?.error.code);
    expect(managed?.error.code).not.toBe(affiliated?.error.code);
  });
});

describe("GroupIdSchema", () => {
  it("is unchanged: 1-128 chars of letters, digits and ._:-", () => {
    expect(GroupIdSchema.safeParse("a".repeat(128)).success).toBe(true);
    expect(GroupIdSchema.safeParse("a".repeat(129)).success).toBe(false);
  });
});

// Source: docs/specs/2026-11-10-access-control.md - "Enforcement" (list cursors
// are HMAC-signed; the key is derived from AUTH_SECRET), Rule 60.19 (fail fast
// on misconfiguration). User decision 2026-11-15: AUTH_SECRET is required; a
// missing secret fails closed instead of a random per-process key.
describe("cursorSecret - AUTH_SECRET is required (fail closed)", () => {
  afterEach(() => {
    envMock.env = {};
  });

  it("derives a stable key from AUTH_SECRET that is not the secret itself", () => {
    envMock.env = { AUTH_SECRET: "s3cret-one" };
    const key = cursorSecret();
    expect(cursorSecret()).toBe(key);
    expect(key).not.toContain("s3cret-one");
    envMock.env = { AUTH_SECRET: "s3cret-two" };
    expect(cursorSecret()).not.toBe(key);
  });

  it.each([
    ["undefined", undefined],
    ["empty", ""],
  ])(
    "throws when AUTH_SECRET is %s, with no per-process fallback key",
    (_n, value) => {
      envMock.env = value === undefined ? {} : { AUTH_SECRET: value };
      expect(() => cursorSecret()).toThrow();
    },
  );
});
