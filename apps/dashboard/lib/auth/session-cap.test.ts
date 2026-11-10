import { describe, expect, it } from "vitest";

import {
  SESSION_MAX_AGE_SECONDS,
  isWithinSessionLifetime,
  sessionCapSeconds,
} from "./session-lifetime";

// Source: docs/specs/2026-11-10-access-control.md — Sign-in methods / Session
// lifetime: master 1 h, admin and org-admin 4 h, everyone else 8 h. Contract
// R1 decision 4. isWithinSessionLifetime(signedInAt, now, capSeconds?) gains a
// cap argument (default: the 8 h cap); `now` is a parameter, no clock faked.
const H = 3600;
const NOW = 1_793_000_000;

describe("sessionCapSeconds", () => {
  it("is 1 hour for the master user, whatever the roles", () => {
    expect(
      sessionCapSeconds({ roles: ["internal-admin"], authMethod: "master" }),
    ).toBe(H);
    expect(sessionCapSeconds({ roles: [], authMethod: "master" })).toBe(H);
  });

  it.each(["internal-admin", "internal-org-admin"])(
    "is 4 hours for %s",
    (role) => {
      expect(sessionCapSeconds({ roles: [role], authMethod: "entra" })).toBe(
        4 * H,
      );
    },
  );

  it("is 4 hours when any held role is admin or org-admin", () => {
    expect(
      sessionCapSeconds({
        roles: ["internal-auditor", "internal-org-admin"],
        authMethod: "entra",
      }),
    ).toBe(4 * H);
  });

  it.each(["internal-auditor", "internal-viewer"])("is 8 hours for %s", (r) => {
    expect(sessionCapSeconds({ roles: [r], authMethod: "entra" })).toBe(8 * H);
    expect(SESSION_MAX_AGE_SECONDS).toBe(8 * H);
  });
});

describe("isWithinSessionLifetime with a cap", () => {
  it("accepts a token younger than the cap and rejects one older", () => {
    expect(isWithinSessionLifetime(NOW - 3 * H, NOW, 4 * H)).toBe(true);
    expect(isWithinSessionLifetime(NOW - 4 * H, NOW, 4 * H)).toBe(true);
    expect(isWithinSessionLifetime(NOW - 4 * H - 1, NOW, 4 * H)).toBe(false);
    expect(isWithinSessionLifetime(NOW - H - 1, NOW, H)).toBe(false);
  });

  it("still applies the 60 s skew rule and rejects non-numbers", () => {
    expect(isWithinSessionLifetime(NOW + 61, NOW, 4 * H)).toBe(false);
    expect(isWithinSessionLifetime(NOW + 59, NOW, 4 * H)).toBe(true);
    expect(isWithinSessionLifetime("x", NOW, 4 * H)).toBe(false);
  });

  it("defaults to the 8 hour cap without a cap argument", () => {
    expect(isWithinSessionLifetime(NOW - 7 * H, NOW)).toBe(true);
    expect(isWithinSessionLifetime(NOW - 8 * H - 1, NOW)).toBe(false);
  });
});
