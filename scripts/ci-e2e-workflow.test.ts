import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Source: implementation-phases Phase 5 "Add Playwright to GitHub Actions CI"
// and temp/run-ci-e2e/goal.md. The workflow is parsed by indentation: no YAML
// library is a root dependency. Every assertion is anchored to its block.
const workflow = readFileSync(
  join(__dirname, "..", ".github", "workflows", "llm-usage-lens-build.yml"),
  "utf8",
);

const indentOf = (line: string) => line.length - line.trimStart().length;

/** Lines of `key:` at `indent` plus its children (deeper-indented lines). */
const block = (text: string, key: string, indent: number): string => {
  const lines = text.split("\n");
  const head = `${" ".repeat(indent)}${key}:`;
  const start = lines.findIndex((l) => l.trimEnd() === head);
  if (start === -1) return "";
  const out = [lines[start] ?? ""];
  for (const l of lines.slice(start + 1)) {
    if (l.trim() !== "" && indentOf(l) <= indent) break;
    out.push(l);
  }
  return out.join("\n");
};

const jobBlock = (name: string) =>
  block(workflow.slice(workflow.indexOf("\njobs:")), name, 2);

/** The job's `steps:` split into items at the 6-space `- ` indentation. */
const stepsOf = (job: string): string[] => {
  const items: string[] = [];
  for (const l of block(job, "steps", 4).split("\n").slice(1)) {
    if (/^ {6}- /.test(l)) items.push(l);
    else if (items.length > 0) items[items.length - 1] += `\n${l}`;
  }
  return items;
};

const serviceImage = (job: string) =>
  /^\s+image:\s*(\S+)/m.exec(
    block(block(job, "services", 4), "dynamodb-local", 6),
  )?.[1];

describe("ci e2e job (llm-usage-lens-build.yml)", () => {
  const e2e = jobBlock("e2e");
  const steps = stepsOf(e2e);
  const step = (re: RegExp) => steps.find((s) => re.test(s)) ?? "";

  it("triggers on push to main and pull_request, cancelling superseded runs (goal: trigger)", () => {
    expect(block(workflow, "on", 0)).toMatch(
      /^ {2}push:\n {4}branches: \[main\]\n {2}pull_request:/m,
    );
    expect(block(workflow, "concurrency", 0)).toMatch(
      /^ {2}cancel-in-progress: true$/m,
    );
  });

  it("has a dynamodb-local service on the same image as the test job (goal: service)", () => {
    expect(e2e).not.toBe("");
    const testImage = serviceImage(jobBlock("test"));
    expect(testImage).toMatch(/^amazon\/dynamodb-local:/);
    expect(serviceImage(e2e)).toBe(testImage);
  });

  it("installs chromium with deps in its own step (goal: steps)", () => {
    expect(step(/playwright install/)).toMatch(
      /^ {8}run:\s*pnpm (exec )?playwright install --with-deps chromium\s*$/m,
    );
  });

  it("creates the table in its own step (goal: steps)", () => {
    expect(step(/db:create-table/)).toMatch(
      /^ {8}run:\s*pnpm db:create-table\s*$/m,
    );
  });

  it("runs pnpm test:e2e with E2E_LOCK off in the step or the job env (goal: steps)", () => {
    const run = step(/^ {8}run:\s*pnpm test:e2e\s*$/m);
    expect(run).not.toBe("");
    const lockOff = /^\s+E2E_LOCK:\s*"?off"?\s*$/m;
    const stepEnv = block(run, "env", 8);
    const jobEnv = block(e2e, "env", 4);
    expect(lockOff.test(stepEnv) || lockOff.test(jobEnv)).toBe(true);
  });

  it("caches Playwright browsers keyed on the Playwright version (goal: cache)", () => {
    const cache = step(/uses:\s*actions\/cache@/);
    expect(cache).not.toBe("");
    expect(block(cache, "with", 8)).toMatch(/^\s+path:.*ms-playwright/m);
    expect(block(cache, "with", 8)).toMatch(/^\s+key:.*playwright/im);
    // Coordinator review follow-up: the key must carry the resolved version.
    expect(block(cache, "with", 8)).toMatch(
      /^\s+key:.*steps\.playwright\.outputs\.version/m,
    );
    const idIndex = steps.findIndex((s) => /^\s+id:\s*playwright\s*$/m.test(s));
    expect(idIndex).toBeGreaterThanOrEqual(0);
    expect(idIndex).toBeLessThan(steps.indexOf(cache));
  });

  // Coordinator review follow-up; implementation-phases Phase 5 (CI e2e).
  it("waits for DynamoDB, then creates the table, seeds, then runs e2e, in that order", () => {
    const idx = (re: RegExp) => steps.findIndex((s) => re.test(s));
    const wait = idx(/^ {6}- name:.*Wait for DynamoDB/m);
    const create = idx(/^ {8}run:\s*pnpm db:create-table\s*$/m);
    const seed = idx(/^ {8}run:\s*pnpm db:seed\s*$/m);
    const e2eRun = idx(/^ {8}run:\s*pnpm test:e2e\s*$/m);
    expect(wait).toBeGreaterThanOrEqual(0);
    expect(steps[wait]).toMatch(/curl[^\n]*http:\/\/localhost:8000/);
    expect(wait).toBeLessThan(create);
    expect(create).toBeLessThan(seed);
    expect(seed).toBeLessThan(e2eRun);
  });

  it("uploads test-results and playwright-report on failure for 7 days (goal: artifacts)", () => {
    const upload = step(/uses:\s*actions\/upload-artifact@/);
    expect(upload).not.toBe("");
    expect(upload).toMatch(/^ {8}if:\s*(\$\{\{\s*)?failure\(\)/m);
    const withBlock = block(upload, "with", 8);
    expect(withBlock).toMatch(/^\s+retention-days:\s*7\s*$/m);
    expect(withBlock).toContain("apps/dashboard/test-results");
    expect(withBlock).toContain("apps/dashboard/playwright-report");
  });

  it("uses no secrets and pins every remote action to a full SHA (Rule 50; repo pinning convention)", () => {
    expect(steps.length).toBeGreaterThan(0);
    expect(e2e).not.toMatch(/secrets\./);
    const uses = [...e2e.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1] ?? "");
    for (const u of uses.filter((x) => !x.startsWith("./"))) {
      expect(u).toMatch(/@[0-9a-f]{40}$/);
    }
  });
});
