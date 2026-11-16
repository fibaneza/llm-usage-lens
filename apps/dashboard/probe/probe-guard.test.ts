import { describe, expect, it } from "vitest";

import { assertProbeAllowed, probeKeyName, probeRunId } from "./probe-guard";

// Source: docs/specs/2026-11-10-litellm.md - "Polish and verification (L5)",
// End-to-end probe: "runs only with LITELLM_PROBE=1, and refuses to start
// unless APP_ENV is not prod and the configured base URL's host is
// localhost:4000 (LD17). The service key ... is never committed, printed or
// logged"; "Per run" (keys named llmul-probe-<run id>); "Results" (a separate,
// named fake mode; the probe never falls back to it on its own); LD28; Rule
// 60.24 (no automatic fallback).
//
// Contract (apps/dashboard/probe/probe-guard.ts, pure, no I/O):
//   assertProbeAllowed(env): { mode: "real" | "fake" }
//   probeRunId(): string          lowercase [a-z0-9], 8+ chars, new per call
//   probeKeyName(runId): string   `llmul-probe-${runId}`
// Variables read: LITELLM_PROBE, LITELLM_PROBE_MODE ("fake" | "real" | unset),
// LITELLM_PROBE_BASE_URL (the stored connection lives in DynamoDB, not in the
// env, so the probe is told the URL it will call directly), APP_ENV.
const SERVICE_KEY = "sk-probe-service-key-SECRET-123";
const BASE: Record<string, string | undefined> = {
  LITELLM_PROBE: "1",
  LITELLM_PROBE_BASE_URL: "http://localhost:4000",
  APP_ENV: "dev",
  LITELLM_SERVICE_KEY: SERVICE_KEY,
};
const env = (over: Record<string, string | undefined> = {}) => ({
  ...BASE,
  ...over,
});

describe("assertProbeAllowed (LD28, LD17)", () => {
  it("allows real mode for LITELLM_PROBE=1, APP_ENV=dev and localhost:4000", () => {
    expect(assertProbeAllowed(env())).toEqual({ mode: "real" });
  });

  it.each([
    ["http://localhost:4000", "real"],
    ["http://localhost:4000/", "real"],
    ["http://localhost:4000/chat/completions", "real"],
  ])("accepts base URL %s", (url) => {
    expect(assertProbeAllowed(env({ LITELLM_PROBE_BASE_URL: url })).mode).toBe(
      "real",
    );
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["0", "0"],
    ["true", "true"],
    ["yes", "yes"],
    ["2", "2"],
  ])("refuses without LITELLM_PROBE=1 (%s)", (_name, value) => {
    expect(() => assertProbeAllowed(env({ LITELLM_PROBE: value }))).toThrow(
      /LITELLM_PROBE/,
    );
  });

  it("refuses when APP_ENV=prod, in real and in fake mode", () => {
    expect(() => assertProbeAllowed(env({ APP_ENV: "prod" }))).toThrow(
      /APP_ENV/,
    );
    expect(() =>
      assertProbeAllowed(env({ APP_ENV: "prod", LITELLM_PROBE_MODE: "fake" })),
    ).toThrow(/APP_ENV/);
  });

  it.each([
    "http://127.0.0.1:4000",
    "http://localhost:4001",
    "http://localhost",
    "http://localhost:40000",
    "http://localhost:4000.evil.example",
    "http://litellm.prod.example.com:4000",
    "https://litellm.company.com",
    // the userinfo trick: the host is evil.example, not localhost:4000
    "http://localhost:4000@evil.example",
    "http://localhost:4000:pw@evil.example:4000",
    "http://evil.example/?x=localhost:4000",
    "http://evil.example/localhost:4000",
    "not a url",
    "",
  ])("refuses the real-mode base URL %j (only localhost:4000)", (url) => {
    expect(() =>
      assertProbeAllowed(env({ LITELLM_PROBE_BASE_URL: url })),
    ).toThrow();
  });

  it("refuses real mode with no base URL configured", () => {
    expect(() =>
      assertProbeAllowed(env({ LITELLM_PROBE_BASE_URL: undefined })),
    ).toThrow();
  });

  it("refuses a base URL that carries credentials even when the host is localhost:4000", () => {
    expect(() =>
      assertProbeAllowed(
        env({ LITELLM_PROBE_BASE_URL: "http://user:pw@localhost:4000" }),
      ),
    ).toThrow();
  });

  it("LITELLM_PROBE_MODE=fake selects fake mode, named and explicit", () => {
    expect(assertProbeAllowed(env({ LITELLM_PROBE_MODE: "fake" }))).toEqual({
      mode: "fake",
    });
  });

  it("fake mode never contacts the base URL, so it does not require one", () => {
    expect(
      assertProbeAllowed(
        env({ LITELLM_PROBE_MODE: "fake", LITELLM_PROBE_BASE_URL: undefined }),
      ).mode,
    ).toBe("fake");
  });

  it("fake mode still needs the opt-in", () => {
    expect(() =>
      assertProbeAllowed(
        env({ LITELLM_PROBE_MODE: "fake", LITELLM_PROBE: undefined }),
      ),
    ).toThrow(/LITELLM_PROBE/);
  });

  it("an explicit real mode is real", () => {
    expect(assertProbeAllowed(env({ LITELLM_PROBE_MODE: "real" })).mode).toBe(
      "real",
    );
  });

  it.each(["Fake", "FAKE", "mock", "auto", "fallback", " fake"])(
    "an unknown mode %j is refused, never mapped to fake or real (Rule 60.24: no automatic fallback)",
    (mode) => {
      expect(() =>
        assertProbeAllowed(env({ LITELLM_PROBE_MODE: mode })),
      ).toThrow(/LITELLM_PROBE_MODE/);
    },
  );

  it("a real-mode refusal never switches to fake: a bad base URL throws even though fake would pass", () => {
    expect(() =>
      assertProbeAllowed(
        env({ LITELLM_PROBE_BASE_URL: "http://evil.example" }),
      ),
    ).toThrow();
  });

  // The service key stays out of every message (spec: never printed or
  // logged; Rule 50.6). Also the userinfo of a refused URL.
  it("no refusal message contains the service key, AUTH_SECRET or a URL password", () => {
    const secrets = [SERVICE_KEY, "auth-secret-VALUE-9", "hunter2-PASSWORD"];
    const cases = [
      env({ LITELLM_PROBE: undefined }),
      env({ APP_ENV: "prod" }),
      env({ LITELLM_PROBE_BASE_URL: "http://localhost:4001" }),
      env({ LITELLM_PROBE_BASE_URL: undefined }),
      env({
        LITELLM_PROBE_BASE_URL: "http://bob:hunter2-PASSWORD@evil.example:4000",
      }),
      env({ LITELLM_PROBE_MODE: "bogus" }),
    ].map((e) => ({ ...e, AUTH_SECRET: "auth-secret-VALUE-9" }));
    for (const e of cases) {
      let message = "";
      try {
        assertProbeAllowed(e);
      } catch (error) {
        message = String(error instanceof Error ? error.message : error);
      }
      expect(message).not.toBe("");
      for (const secret of secrets) expect(message).not.toContain(secret);
    }
  });

  it("does not mutate the env it is given", () => {
    const input = env();
    const copy = { ...input };
    assertProbeAllowed(input);
    expect(input).toEqual(copy);
  });
});

describe("probeRunId and probeKeyName (Per run: keys named llmul-probe-<run id>)", () => {
  it("a run id is lowercase alphanumeric, at least 8 characters, and new on every call", () => {
    const a = probeRunId();
    const b = probeRunId();
    expect(a).toMatch(/^[a-z0-9]{8,}$/);
    expect(b).toMatch(/^[a-z0-9]{8,}$/);
    expect(a).not.toBe(b);
  });

  it("names a key llmul-probe-<run id>", () => {
    expect(probeKeyName("abc12345")).toBe("llmul-probe-abc12345");
    const id = probeRunId();
    expect(probeKeyName(id)).toBe(`llmul-probe-${id}`);
  });

  it.each(["", "ABC12345", "has space", "a/b", "x".repeat(65)])(
    "refuses an unsafe run id %j",
    (id) => {
      expect(() => probeKeyName(id)).toThrow();
    },
  );
});
