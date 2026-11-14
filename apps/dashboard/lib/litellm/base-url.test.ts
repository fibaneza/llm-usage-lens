import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseAllowedHosts, validateLiteLLMBaseUrl } from "./base-url";

// Source: docs/specs/2026-11-10-litellm.md — "Security architecture" item 7
// (host or host:port in LITELLM_ALLOWED_HOSTS, https when APP_ENV=prod, no
// userinfo/query/fragment), LD17 (http://localhost:4000 in dev), threat LT6.
const HOSTS = parseAllowedHosts("litellm.example.internal, localhost:4000");

describe("parseAllowedHosts", () => {
  it("splits, trims and lower-cases a comma list; empty or unset is an empty list", () => {
    expect(parseAllowedHosts("A.example, b.example:8080 ")).toEqual([
      "a.example",
      "b.example:8080",
    ]);
    expect(parseAllowedHosts(undefined)).toEqual([]);
    expect(parseAllowedHosts("")).toEqual([]);
  });
});

describe("validateLiteLLMBaseUrl", () => {
  const ok = (raw: string, appEnv: "dev" | "prod" = "dev") =>
    validateLiteLLMBaseUrl(raw, { allowedHosts: HOSTS, appEnv });

  it("accepts an allowed https host in prod and returns the normalised URL without a trailing slash", () => {
    expect(ok("https://litellm.example.internal/", "prod")).toEqual({
      ok: true,
      baseUrl: "https://litellm.example.internal",
    });
  });

  it("accepts http://localhost:4000 in dev (LD17) but not in prod", () => {
    expect(ok("http://localhost:4000")).toMatchObject({ ok: true });
    expect(ok("http://localhost:4000", "prod")).toMatchObject({ ok: false });
  });

  it("matches host:port entries exactly: a different port is refused", () => {
    expect(ok("http://localhost:4001")).toMatchObject({ ok: false });
    expect(ok("http://localhost")).toMatchObject({ ok: false });
  });

  it.each([
    ["a host outside the allowlist", "https://evil.example"],
    [
      "a lookalike suffix host",
      "https://litellm.example.internal.evil.example",
    ],
    ["userinfo", "https://user:pass@litellm.example.internal"],
    ["a username only", "https://user@litellm.example.internal"],
    ["a query string", "https://litellm.example.internal?x=1"],
    ["a fragment", "https://litellm.example.internal#frag"],
    ["a non-http scheme", "ftp://litellm.example.internal"],
    ["file scheme", "file:///etc/passwd"],
    ["an unparseable string", "not a url"],
    ["an empty string", ""],
    ["a cloud metadata address", "http://169.254.169.254"],
  ])("rejects %s", (_name, raw) => {
    expect(ok(raw, "dev")).toMatchObject({ ok: false });
    expect(ok(raw, "prod")).toMatchObject({ ok: false });
  });

  it("rejects everything when LITELLM_ALLOWED_HOSTS is empty", () => {
    expect(
      validateLiteLLMBaseUrl("https://litellm.example.internal", {
        allowedHosts: [],
        appEnv: "prod",
      }),
    ).toMatchObject({ ok: false });
  });

  it("never echoes credentials from a rejected URL", () => {
    const result = ok("https://user:secretpw@litellm.example.internal");
    expect(JSON.stringify(result)).not.toContain("secretpw");
  });
});
