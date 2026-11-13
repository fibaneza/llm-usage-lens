import { describe, expect, it } from "vitest";

import { decodeCursor, encodeCursor } from "./cursor";

// Source: docs/specs/2026-11-10-access-control.md — "Storage boundary (D26.4)":
// list functions return an opaque, signed cursor, never a raw LastEvaluatedKey;
// contract addendum B.5 (HMAC-signed base64url, a tampered or foreign cursor is
// BAD_CURSOR). encodeCursor(key, secret) / decodeCursor(cursor, secret).
const SECRET = "test-cursor-secret";
const KEY = { PK: "IDENT#abc", SK: "ADMINSCOPE#TEAM#t1", gsi1pk: "X" };

describe("list cursor", () => {
  it("round-trips a key", () => {
    const cursor = encodeCursor(KEY, SECRET);
    expect(decodeCursor(cursor, SECRET)).toEqual({ ok: true, value: KEY });
  });

  it("is opaque and URL-safe", () => {
    const cursor = encodeCursor(KEY, SECRET);
    expect(cursor).toMatch(/^[A-Za-z0-9_.-]+$/);
    expect(cursor).not.toContain("IDENT#");
    expect(cursor).not.toContain("abc");
  });

  it("rejects a tampered payload", () => {
    const cursor = encodeCursor(KEY, SECRET);
    const flipped = (cursor[0] === "A" ? "B" : "A") + cursor.slice(1);
    expect(decodeCursor(flipped, SECRET)).toEqual({
      ok: false,
      code: "BAD_CURSOR",
    });
  });

  it("rejects a truncated cursor", () => {
    const cursor = encodeCursor(KEY, SECRET);
    expect(decodeCursor(cursor.slice(0, -4), SECRET)).toEqual({
      ok: false,
      code: "BAD_CURSOR",
    });
  });

  it("rejects a cursor signed with a different secret", () => {
    const cursor = encodeCursor(KEY, "other-test-cursor-secret");
    expect(decodeCursor(cursor, SECRET)).toEqual({
      ok: false,
      code: "BAD_CURSOR",
    });
  });

  it.each(["", "garbage", "a.b.c", "!!!", "e30"])(
    "rejects arbitrary input %j",
    (input) => {
      expect(decodeCursor(input, SECRET)).toEqual({
        ok: false,
        code: "BAD_CURSOR",
      });
    },
  );
});
