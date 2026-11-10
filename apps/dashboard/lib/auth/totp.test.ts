import { describe, expect, it } from "vitest";

import { base32Decode, verifyTotp } from "@/lib/auth/totp";

// Source: RFC 6238 Appendix B (SHA-1, secret "12345678901234567890");
// docs/specs/2026-11-10-access-control.md — "Sign-in methods" (TOTP, 30 s,
// 6 digits, ±1 step). Contract r1 decision 6.
// Assumed API: verifyTotp(secretBase32, code, now: Date): boolean;
// base32Decode(s): Uint8Array | Buffer.
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const at = (unixSeconds: number) => new Date(unixSeconds * 1000);

const VECTORS: [number, string][] = [
  [59, "287082"],
  [1111111109, "081804"],
  [1234567890, "005924"],
  [2000000000, "279037"],
];

describe("base32Decode", () => {
  it("decodes the RFC 6238 secret to its ASCII bytes", () => {
    expect(Buffer.from(base32Decode(SECRET)).toString("ascii")).toBe(
      "12345678901234567890",
    );
  });

  it("is case-insensitive and ignores padding", () => {
    expect(Buffer.from(base32Decode("mzxw6===")).toString("ascii")).toBe("foo");
    expect(Buffer.from(base32Decode("MZXW6")).toString("ascii")).toBe("foo");
  });

  it("rejects characters outside the base32 alphabet", () => {
    expect(() => base32Decode("MZXW1!")).toThrow();
  });
});

describe("verifyTotp", () => {
  it.each(VECTORS)("accepts the RFC vector at T=%i", (t, code) => {
    expect(verifyTotp(SECRET, code, at(t))).toBe(true);
  });

  it("accepts the previous and next 30 s step (±1)", () => {
    expect(verifyTotp(SECRET, "287082", at(59 + 30))).toBe(true);
    expect(verifyTotp(SECRET, "287082", at(59 - 30))).toBe(true);
  });

  it("rejects codes two steps away (±2)", () => {
    expect(verifyTotp(SECRET, "287082", at(59 + 60))).toBe(false);
    expect(verifyTotp(SECRET, "081804", at(1111111109 - 60))).toBe(false);
  });

  it("rejects a wrong code", () => {
    expect(verifyTotp(SECRET, "000000", at(59))).toBe(false);
  });

  it.each(["", "12345", "1234567", "abcdef", "28708 ", "28708a", "287082\n"])(
    "rejects non-6-digit input %j",
    (code) => {
      expect(verifyTotp(SECRET, code, at(59))).toBe(false);
    },
  );

  it("rejects the 8-digit RFC code", () => {
    expect(verifyTotp(SECRET, "94287082", at(59))).toBe(false);
  });
});
