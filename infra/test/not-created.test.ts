// @vitest-environment node
// Source: docs/specs/2026-11-10-platform.md — "Not created" (the platform
// reuses the existing VPC, certificate, topic and OIDC provider; no NAT, WAF,
// CloudFront, cache, RDS); contract rp-contract.md "Not created in any stack".
import { describe, expect, it } from "vitest";

import { NOT_CREATED_TYPES, synthApp, synthInfra } from "./support";
import type { Mode } from "./support";

const stacks = [
  ["FoundationStack dev", () => synthInfra("dev")],
  ["FoundationStack prod", () => synthInfra("prod")],
  ...(["import", "create"] as Mode[]).flatMap((m) => [
    [`DashboardServiceStack ${m} dev`, () => synthApp(m, "dev")] as const,
    [`DashboardServiceStack ${m} prod`, () => synthApp(m, "prod")] as const,
  ]),
] as const;

describe.each(stacks)("%s", (_name, build) => {
  const t = build();

  it.each(NOT_CREATED_TYPES)("does not create %s", (type) => {
    t.resourceCountIs(type, 0);
  });

  it("has no CloudFormation Export on any output", () => {
    const outputs = (t.toJSON().Outputs ?? {}) as Record<
      string,
      { Export?: unknown }
    >;
    for (const o of Object.values(outputs)) expect(o.Export).toBeUndefined();
  });

  it("does not create any wildcard-prefixed ElastiCache or WAF resource", () => {
    const types = Object.values(
      t.toJSON().Resources as Record<string, { Type: string }>,
    ).map((r) => r.Type);
    expect(
      types.filter((x) => /^AWS::(ElastiCache|WAFv2|RDS)::/.test(x)),
    ).toEqual([]);
  });
});
