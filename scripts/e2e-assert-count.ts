import { readFileSync } from "node:fs";

// The CI e2e-dev job (.github/ACTIONS.md) must run exactly its dev-login
// cases: a dropped --grep selects more, production servers skip them all.
// Reads Playwright's JSON report `stats` and fails unless exactly `expected`
// cases ran with none skipped.
export type PlaywrightStats = {
  expected: number;
  skipped: number;
  unexpected: number;
  flaky: number;
};

export type CountResult = { ok: true } | { ok: false; message: string };

export function checkSelectedCount(
  stats: PlaywrightStats,
  expected: number,
): CountResult {
  const selected =
    stats.expected + stats.skipped + stats.unexpected + stats.flaky;
  if (selected === expected && stats.skipped === 0) return { ok: true };
  return {
    ok: false,
    message: `expected exactly ${expected} e2e cases with none skipped; selected ${selected}, skipped ${stats.skipped}`,
  };
}

const STAT_KEYS = ["expected", "skipped", "unexpected", "flaky"] as const;

/** The report's `stats`, or undefined when any count is missing or not a number. */
export function parseStats(report: unknown): PlaywrightStats | undefined {
  if (typeof report !== "object" || report === null) return undefined;
  const stats = (report as { stats?: unknown }).stats;
  if (typeof stats !== "object" || stats === null) return undefined;
  const record = stats as Record<string, unknown>;
  if (!STAT_KEYS.every((k) => Number.isInteger(record[k]))) return undefined;
  return {
    expected: record.expected as number,
    skipped: record.skipped as number,
    unexpected: record.unexpected as number,
    flaky: record.flaky as number,
  };
}

/** CLI body: 0 ok, 1 wrong count or malformed report, 2 bad arguments. */
export function runAssertCount(argv: readonly string[]): number {
  const [reportPath, expectedArg] = argv;
  const expected = Number(expectedArg);
  if (reportPath === undefined || !Number.isInteger(expected)) {
    process.stderr.write(
      "usage: e2e-assert-count-cli <playwright-json-report> <expected-count>\n",
    );
    return 2;
  }
  const stats = parseStats(JSON.parse(readFileSync(reportPath, "utf8")));
  if (stats === undefined) {
    process.stderr.write(`no numeric stats in the report at ${reportPath}\n`);
    return 1;
  }
  const result = checkSelectedCount(stats, expected);
  if (!result.ok) {
    process.stderr.write(`${result.message}\n`);
    return 1;
  }
  process.stdout.write(`e2e case count ok: ${expected}\n`);
  return 0;
}
