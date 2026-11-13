import { describe, expect, it } from "vitest";

import {
  AuthConfigError,
  resolveRuntimeAccessMode,
} from "@/lib/auth/auth-config";

// Source: docs/specs/2026-11-10-access-control.md — Rollout / Environment:
// unset or invalid -> enforce; `open` never when APP_ENV=prod. Contract R2 §3
// `resolveRuntimeAccessMode` and §6 carry-in (throws for open + prod at
// runtime). The build phase runs with placeholder env, so it must not throw.
describe("resolveRuntimeAccessMode", () => {
  it("returns open for open in dev at runtime", () => {
    expect(
      resolveRuntimeAccessMode({
        isBuildPhase: false,
        raw: "open",
        appEnv: "dev",
      }),
    ).toBe("open");
  });

  it("throws for open in prod at runtime", () => {
    expect(() =>
      resolveRuntimeAccessMode({
        isBuildPhase: false,
        raw: "open",
        appEnv: "prod",
      }),
    ).toThrow(AuthConfigError);
  });

  it.each([undefined, "", "enforce", "bogus"])(
    "returns enforce for raw=%j",
    (raw) => {
      expect(
        resolveRuntimeAccessMode({ isBuildPhase: false, raw, appEnv: "prod" }),
      ).toBe("enforce");
    },
  );

  it("does not throw during the build phase", () => {
    expect(() =>
      resolveRuntimeAccessMode({
        isBuildPhase: true,
        raw: "open",
        appEnv: "prod",
      }),
    ).not.toThrow();
  });
});
