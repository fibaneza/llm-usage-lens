import { runAssertCount } from "./e2e-assert-count";

// Entry point for the CI e2e-dev guard step (.github/ACTIONS.md). It always
// runs the check: no main-module detection that could skip it silently.
process.exitCode = runAssertCount(process.argv.slice(2));
