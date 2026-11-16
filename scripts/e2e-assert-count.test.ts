import { describe, expect, it } from "vitest";

import { productionServers } from "../apps/dashboard/e2e/support/constants";
import { checkSelectedCount } from "./e2e-assert-count";

// Coordinator follow-up (ci/e2e-dev-guard); .github/ACTIONS.md — e2e-dev job:
// the job fails unless exactly the expected dev-login cases ran, none skipped.
describe("checkSelectedCount (e2e-dev guard)", () => {
  const stats = (s: Partial<Record<string, number>>) => ({
    expected: 0,
    skipped: 0,
    unexpected: 0,
    flaky: 0,
    ...s,
  });

  it("passes when exactly the expected count ran and none skipped", () => {
    expect(checkSelectedCount(stats({ expected: 9, flaky: 1 }), 10)).toEqual({
      ok: true,
    });
  });

  it.each([
    ["fewer selected", stats({ expected: 9 })],
    [
      "more selected (a filter dropped, e.g. `--` before --grep)",
      stats({ expected: 51 }),
    ],
    ["any skipped (production servers)", stats({ expected: 7, skipped: 3 })],
    ["nothing selected", stats({})],
  ])("fails on %s", (_label, s) => {
    const result = checkSelectedCount(s, 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/10/);
  });
});

// ACTIONS.md — e2e-dev job: E2E_SERVERS=dev forces next dev under CI.
describe("productionServers (playwright web-server mode)", () => {
  it.each([
    [{ CI: "1", E2E_SERVERS: "dev" }, false],
    [{ CI: "true", E2E_SERVERS: "dev" }, false],
    [{ CI: "1" }, true],
    [{}, false],
    [{ E2E_SERVERS: "dev" }, false],
  ])("%j -> %s", (env, expected) => {
    expect(productionServers(env)).toBe(expected);
  });
});
