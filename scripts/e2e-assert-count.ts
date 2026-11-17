import { readFileSync } from "node:fs";

import { z } from "zod";

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

const count = z.number().int().nonnegative();
const ReportSchema = z.object({
  stats: z.object({
    expected: count,
    skipped: count,
    unexpected: count,
    flaky: count,
  }),
});

/** The report's `stats`, or undefined when the report is not the expected shape. */
export function parseStats(report: unknown): PlaywrightStats | undefined {
  const parsed = ReportSchema.safeParse(report);
  return parsed.success ? parsed.data.stats : undefined;
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
  let report: unknown;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `cannot read a JSON report at ${reportPath}: ${reason}\n`,
    );
    return 1;
  }
  const stats = parseStats(report);
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
