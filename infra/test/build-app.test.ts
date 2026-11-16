// Source: docs/specs/2026-11-10-platform.md — "IaC layout" (two stacks,
// region from COLLECTOR_REGION; Rule 50.7); contract rp-contract.md.
import { App } from "aws-cdk-lib";
import { COLLECTOR_REGION } from "@llm-usage-lens/shared";
import { describe, expect, it } from "vitest";

import { buildApp } from "../lib/build-app";

import { ACCOUNT, contextFor } from "./support";
import type { Mode } from "./support";

describe.each(["import", "create"] as Mode[])("buildApp (%s)", (mode) => {
  it.each(["dev", "prod"] as const)("builds the two stacks for %s", (env) => {
    const app = new App();
    const { infra, app: appStack } = buildApp(app, contextFor(mode, env));
    expect(infra.stackName).toBe(`LlmUsageLens-${env}-Infra`);
    expect(appStack.stackName).toBe(`LlmUsageLens-${env}-App`);
    expect(infra.region).toBe(COLLECTOR_REGION);
    expect(infra.region).toBe("ap-southeast-2");
    expect(appStack.region).toBe("ap-southeast-2");
    expect(infra.account).toBe(ACCOUNT);
    expect(appStack.account).toBe(ACCOUNT);
    expect(infra.terminationProtection).toBe(true);
  });

  it("synthesises without AWS lookups", () => {
    const app = new App();
    buildApp(app, contextFor(mode));
    const assembly = app.synth();
    expect(assembly.stacks.map((s) => s.stackName).sort()).toEqual([
      "LlmUsageLens-dev-App",
      "LlmUsageLens-dev-Infra",
    ]);
    expect(assembly.manifest.missing ?? []).toEqual([]);
  });

  it("makes the App stack depend on the Infra stack", () => {
    const app = new App();
    const { infra, app: appStack } = buildApp(app, contextFor(mode));
    expect(appStack.dependencies).toContain(infra);
  });
});

describe("buildApp - bad context", () => {
  it("throws on an empty context", () => {
    expect(() => buildApp(new App(), {})).toThrow();
  });

  it("throws on an invalid env", () => {
    expect(() =>
      buildApp(new App(), contextFor("import", "staging" as "dev")),
    ).toThrow();
  });

  it("throws on an open company CIDR", () => {
    expect(() =>
      buildApp(new App(), {
        ...contextFor("create"),
        companyCidrs: "0.0.0.0/0",
      }),
    ).toThrow();
  });
});
