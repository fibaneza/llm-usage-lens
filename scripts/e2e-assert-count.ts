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

function main(argv: readonly string[]): number {
  const [reportPath, expectedArg] = argv;
  const expected = Number(expectedArg);
  if (reportPath === undefined || !Number.isInteger(expected)) {
    process.stderr.write(
      "usage: e2e-assert-count <playwright-json-report> <expected-count>\n",
    );
    return 2;
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
    stats: PlaywrightStats;
  };
  const result = checkSelectedCount(report.stats, expected);
  if (!result.ok) {
    process.stderr.write(`${result.message}\n`);
    return 1;
  }
  process.stdout.write(`e2e case count ok: ${expected}\n`);
  return 0;
}

if (process.argv[1]?.endsWith("e2e-assert-count.ts")) {
  process.exitCode = main(process.argv.slice(2));
}
