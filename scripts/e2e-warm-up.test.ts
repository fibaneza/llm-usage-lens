import { describe, expect, it } from "vitest";

import { devServerWarmUp } from "../apps/dashboard/e2e/support/constants";

// Coordinator decision (ci/e2e-dev-followups): only the CI e2e-dev job, which
// starts `next dev` cold, warms /sign-in and /dashboard before the suite
// (.github/ACTIONS.md — e2e-dev job). Local runs and production servers never
// do. The Vitest unit project excludes e2e/, so the gate is tested here.
describe("devServerWarmUp (playwright globalSetup gate)", () => {
  it.each([
    [{ CI: "true", E2E_SERVERS: "dev" }, true],
    [{ CI: "1", E2E_SERVERS: "dev" }, true],
    [{ CI: "true" }, false],
    [{}, false],
    [{ E2E_SERVERS: "dev" }, false],
  ])("%j -> %s", (env, expected) => {
    expect(devServerWarmUp(env)).toBe(expected);
  });
});
