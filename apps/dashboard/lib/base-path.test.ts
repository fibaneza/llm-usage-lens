// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  BASE_PATH,
  parseBasePath,
  stripBasePath,
  withBasePath,
} from "./base-path";

// Source: docs/specs/2026-11-10-platform.md - Base path: BP-D2 (format; an
// invalid value fails), BP-D3 and BP-D13 (one helper: parseBasePath,
// BASE_PATH, withBasePath, stripBasePath). Test T1 and T2 of the BP brief.
const PREFIX = "/llm-lens";

describe("parseBasePath (BP-D2)", () => {
  it.each([
    ["undefined", undefined, ""],
    ["empty", "", ""],
    ["one segment", "/llm-lens", "/llm-lens"],
    ["two segments with hyphen and digit", "/a/b-2", "/a/b-2"],
  ])("accepts %s", (_name, value, expected) => {
    expect(parseBasePath(value)).toBe(expected);
  });

  it.each([
    ["no leading slash", "llm-lens"],
    ["trailing slash", "/llm-lens/"],
    ["upper case", "/Llm"],
    ["empty first segment", "//x"],
    ["a space", "/a b"],
    ["a full URL", "https://x/y"],
    ["a lone slash", "/"],
    ["an underscore", "/llm_lens"],
    ["a dot segment", "/.."],
    ["a query", "/a?b=1"],
  ])("rejects %s", (_name, value) => {
    expect(() => parseBasePath(value)).toThrow();
  });
});

describe("withBasePath (BP-D3)", () => {
  it("prefixes a root-relative path once", () => {
    expect(withBasePath("/api/x", PREFIX)).toBe("/llm-lens/api/x");
    expect(withBasePath("/api/x?a=1#h", PREFIX)).toBe("/llm-lens/api/x?a=1#h");
  });

  it("does not prefix twice", () => {
    expect(withBasePath("/llm-lens/api/x", PREFIX)).toBe("/llm-lens/api/x");
    expect(withBasePath("/llm-lens", PREFIX)).toBe("/llm-lens");
  });

  it("treats a sibling that only starts with the prefix as another path", () => {
    expect(withBasePath("/llm-lens-other/x", PREFIX)).toBe(
      "/llm-lens/llm-lens-other/x",
    );
  });

  it.each(["https://a.test/x", "http://a.test/x", "//cdn.test/x"])(
    "leaves the absolute URL %s alone",
    (url) => {
      expect(withBasePath(url, PREFIX)).toBe(url);
    },
  );

  it("is a no-op with an empty prefix", () => {
    expect(withBasePath("/api/x", "")).toBe("/api/x");
    expect(withBasePath("https://a.test/x", "")).toBe("https://a.test/x");
  });
});

describe("stripBasePath (BP-D10)", () => {
  it("removes the prefix from a pathname", () => {
    expect(stripBasePath("/llm-lens/api/echo", PREFIX)).toBe("/api/echo");
    expect(stripBasePath("/llm-lens/dashboard", PREFIX)).toBe("/dashboard");
  });

  it("maps the bare prefix to the root path", () => {
    expect(stripBasePath("/llm-lens", PREFIX)).toBe("/");
  });

  it("leaves a pathname outside the prefix alone", () => {
    expect(stripBasePath("/api/echo", PREFIX)).toBe("/api/echo");
    expect(stripBasePath("/llm-lens-other/x", PREFIX)).toBe(
      "/llm-lens-other/x",
    );
  });

  it("is a no-op with an empty prefix", () => {
    expect(stripBasePath("/api/echo", "")).toBe("/api/echo");
  });
});

describe("BASE_PATH (BP-D13: reads NEXT_PUBLIC_BASE_PATH directly)", () => {
  it("defaults to empty", () => {
    expect(BASE_PATH).toBe("");
  });

  it("follows the env value, and the defaulted helpers use it", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", PREFIX);
    const mod = await import("./base-path");
    expect(mod.BASE_PATH).toBe(PREFIX);
    expect(mod.withBasePath("/api/x")).toBe("/llm-lens/api/x");
    expect(mod.stripBasePath("/llm-lens/api/x")).toBe("/api/x");
  });

  it("fails to load on an invalid value", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "llm-lens/");
    await expect(import("./base-path")).rejects.toThrow();
  });
});
