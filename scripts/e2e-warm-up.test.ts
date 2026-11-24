import { describe, expect, it } from "vitest";

import { devServerWarmUp } from "../apps/dashboard/e2e/support/constants";

// Amended 2026-11-24 (fix/e2e-stability; docs/guides/testing.md — E2E dev-server warm-up): every
// `next dev` run, local or CI, warms the cold routes before the suite
// (.github/ACTIONS.md — e2e-dev job); production servers (CI without
// E2E_SERVERS=dev) never do. The Vitest unit project excludes e2e/, so the
// gate is tested here.
describe("devServerWarmUp (playwright globalSetup gate)", () => {
  it.each([
    [{ CI: "true", E2E_SERVERS: "dev" }, true],
    [{ CI: "1", E2E_SERVERS: "dev" }, true],
    [{ CI: "true" }, false],
    [{ CI: "1" }, false],
    [{}, true],
    [{ E2E_SERVERS: "dev" }, true],
  ])("%j -> %s", (env, expected) => {
    expect(devServerWarmUp(env)).toBe(expected);
  });
});
