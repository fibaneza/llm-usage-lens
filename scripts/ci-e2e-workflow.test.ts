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

  // Coordinator follow-up: runs at 39fa452 and 5e8a5a5 on main were cancelled
  // by the next push, so no full e2e on main completed. .github/ACTIONS.md
  // (the concurrency note) documents that only PR runs are superseded.
  it("triggers on push to main and pull_request, cancelling superseded pull-request runs only, never runs on main (coordinator follow-up; ACTIONS.md concurrency)", () => {
    expect(block(workflow, "on", 0)).toMatch(
      /^ {2}push:\n {4}branches: \[main\]\n {2}pull_request:/m,
    );
    const concurrency = block(workflow, "concurrency", 0);
    expect(concurrency).not.toBe("");
    expect(concurrency).not.toMatch(/^ {2}cancel-in-progress:\s*true\s*$/m);
    expect(concurrency).toMatch(
      /^ {2}cancel-in-progress:\s*\$\{\{\s*github\.event_name\s*==\s*['"]pull_request['"]\s*\}\}\s*$/m,
    );
    expect(concurrency).toMatch(/^ {2}group:.*github\.ref/m);
  });

  // Run 43878743673: on ubuntu-latest (26.04) Playwright 1.60 cannot install
  // Chromium. .github/ACTIONS.md (e2e job, Runner note) documents the pin.
  it("pins runs-on to a versioned ubuntu image, not ubuntu-latest (run 43878743673; ACTIONS.md Runner)", () => {
    expect(e2e).not.toBe("");
    const runsOn = /^ {4}runs-on:\s*(\S+)\s*$/m.exec(e2e)?.[1];
    expect(runsOn).toMatch(/^ubuntu-\d{2}\.\d{2}$/);
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

// Coordinator follow-up to ci-e2e-speed: the main e2e job serves production
// builds, which refuse the dev-only login, so the dev-login specs run in their
// own job on `next dev` (.github/ACTIONS.md — e2e-dev job).
describe("ci e2e-dev job (llm-usage-lens-build.yml)", () => {
  const job = jobBlock("e2e-dev");
  const steps = stepsOf(job);
  const run = steps.find((s) => /^ {8}run:\s*pnpm test:e2e\b/m.test(s)) ?? "";

  it("needs quality, runs on a pinned ubuntu image with a short timeout (ACTIONS.md e2e-dev)", () => {
    expect(job).not.toBe("");
    expect(job).toMatch(/^ {4}needs:\s*\[quality\]\s*$/m);
    expect(/^ {4}runs-on:\s*(\S+)\s*$/m.exec(job)?.[1]).toMatch(
      /^ubuntu-\d{2}\.\d{2}$/,
    );
    const minutes = Number(/^ {4}timeout-minutes:\s*(\d+)\s*$/m.exec(job)?.[1]);
    expect(minutes).toBeGreaterThan(0);
    expect(minutes).toBeLessThanOrEqual(20);
  });

  it("forces next dev servers and turns the e2e lock off in the job env (ACTIONS.md e2e-dev)", () => {
    const env = block(job, "env", 4);
    expect(env).toMatch(/^\s+E2E_SERVERS:\s*"?dev"?\s*$/m);
    expect(env).toMatch(/^\s+E2E_LOCK:\s*"?off"?\s*$/m);
  });

  it("runs only the three dev-login specs after the table is seeded (ACTIONS.md e2e-dev)", () => {
    expect(run).not.toBe("");
    for (const spec of [
      "e2e/dev-login.spec.ts",
      "e2e/sign-in-role-choice.spec.ts",
      "e2e/settings-tabs.spec.ts",
    ]) {
      expect(run).toContain(spec);
    }
    expect(run).toMatch(/--grep/);
    const seed = steps.findIndex((s) =>
      /^ {8}run:\s*pnpm db:seed\s*$/m.test(s),
    );
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(steps.indexOf(run));
  });

  it("shares the dynamodb-local image, uses no secrets and SHA-pins remote actions (Rule 50)", () => {
    expect(serviceImage(job)).toBe(serviceImage(jobBlock("test")));
    expect(job).not.toMatch(/secrets\./);
    const uses = [...job.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1] ?? "");
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses.filter((x) => !x.startsWith("./"))) {
      expect(u).toMatch(/@[0-9a-f]{40}$/);
    }
  });
});
