import { describe, expect, it } from "vitest";

import { parsePageIdParam } from "./id-param";

// Sources: Data Model - API Routes (path ids: 1-128 characters, no C0 control
// characters or U+007F); Access Control T-US1. A page's `params` arrive
// percent-encoded in Next 16, so the page decodes once, then applies the rule.
describe("parsePageIdParam", () => {
  it("decodes a percent-encoded local id once", () => {
    expect(parsePageIdParam("local%3Aabc")).toBe("local:abc");
  });

  it("leaves a plain id unchanged", () => {
    expect(parsePageIdParam("oid-alice")).toBe("oid-alice");
  });

  it("refuses a malformed escape", () => {
    expect(parsePageIdParam("%E0%A4%A")).toBeNull();
  });

  it("refuses a decoded control character", () => {
    expect(parsePageIdParam("a%00b")).toBeNull();
    expect(parsePageIdParam("a%7Fb")).toBeNull();
  });

  it("refuses an empty id and one over 128 characters after decoding", () => {
    expect(parsePageIdParam("")).toBeNull();
    expect(parsePageIdParam("a".repeat(128))).toBe("a".repeat(128));
    expect(parsePageIdParam("a".repeat(129))).toBeNull();
    expect(parsePageIdParam("%61".repeat(129))).toBeNull();
  });
});
