import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { productionServers } from "../apps/dashboard/e2e/support/constants";
import { checkSelectedCount, runAssertCount } from "./e2e-assert-count";

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

// Review warning (ci/e2e-dev-followups): the CLI always runs the check, and a
// report without numeric stats fails instead of passing silently.
describe("runAssertCount (e2e-dev guard CLI)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "e2e-count-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });
  const report = (name: string, body: unknown) => {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(body));
    return path;
  };
  const ok = { stats: { expected: 10, skipped: 0, unexpected: 0, flaky: 0 } };

  it("returns 0 for exactly the expected count", () => {
    expect(runAssertCount([report("ok.json", ok), "10"])).toBe(0);
  });

  it("returns 1 for a wrong count", () => {
    expect(runAssertCount([report("ok2.json", ok), "9"])).toBe(1);
  });

  it.each([
    ["no stats", {}],
    ["non-numeric stats", { stats: { ...ok.stats, skipped: "0" } }],
  ])("returns 1 for a malformed report (%s)", (_label, body) => {
    expect(runAssertCount([report(`bad-${_label}.json`, body), "10"])).toBe(1);
  });

  it.each([[[]], [["only-a-path.json"]], [["x.json", "ten"]]])(
    "returns 2 for bad arguments %j",
    (argv) => {
      expect(runAssertCount(argv)).toBe(2);
    },
  );

  // C1 item 3 (e2e-dev review nits): an unreadable or unparsable report is a
  // clear exit-1 failure naming the file, never an uncaught stack trace.
  const captureStderr = () => {
    const chunks: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    return chunks;
  };

  it("returns 1 with a message naming the file when the report is missing", () => {
    const stderr = captureStderr();
    const missing = join(dir, "missing.json");
    expect(runAssertCount([missing, "10"])).toBe(1);
    expect(stderr.join("")).toContain(missing);
  });

  it("returns 1 with a message naming the file when the report is not JSON", () => {
    const stderr = captureStderr();
    const path = join(dir, "garbage.json");
    writeFileSync(path, "{not json");
    expect(runAssertCount([path, "10"])).toBe(1);
    expect(stderr.join("")).toContain(path);
  });

  // The report is parsed with a Zod schema: shapes the hand-rolled check
  // let through are rejected too.
  it.each([
    ["an array", []],
    ["null stats", { stats: null }],
    [
      "a negative count that still sums to the expected total",
      { stats: { ...ok.stats, expected: 11, unexpected: -1 } },
    ],
    ["a fractional count", { stats: { ...ok.stats, flaky: 0.5 } }],
  ])("returns 1 for a report that is %s", (label, body) => {
    expect(runAssertCount([report(`shape-${label}.json`, body), "10"])).toBe(1);
  });
});
