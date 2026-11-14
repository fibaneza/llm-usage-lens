// @vitest-environment node
// Source: docs/specs/2026-11-10-access-control.md — "Sign-in methods" (master
// user), "Rollout"; docs/specs/2026-11-10-platform.md — "Runtime" (secrets via
// task-definition `secrets`; hand-managed SecureStrings, never created by CDK).
// Contract: temp/run/r1-contract.md decision 12; threat T20. Rule 50.
import { App } from "aws-cdk-lib";
import type { Template } from "aws-cdk-lib/assertions";
import { Template as T } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { DashboardServiceStack } from "../lib/dashboard-service-stack";
import { parseAppInputs } from "../lib/inputs";

import { ACCOUNT, REGION, actionsOf, contextFor } from "./support";
import type { Mode } from "./support";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- CFN template JSON is untyped
const str = (v: unknown) => JSON.stringify(v);

function synth(
  mode: Mode,
  env: "dev" | "prod",
  extra: Record<string, unknown> = {},
): Template {
  const app = new App();
  const stack = new DashboardServiceStack(app, "App", {
    inputs: parseAppInputs({ ...contextFor(mode, env), ...extra }),
    env: { account: ACCOUNT, region: REGION },
  });
  return T.fromStack(stack);
}

function container(t: Template): Json {
  const [td] = Object.values(t.findResources("AWS::ECS::TaskDefinition"));
  return ((td?.Properties as Json).ContainerDefinitions as Json[])[0] as Json;
}

const envMap = (c: Json) =>
  Object.fromEntries(
    (c.Environment as Json[]).map((e) => [e.Name, e.Value as string]),
  );

const secretMap = (c: Json) =>
  Object.fromEntries(
    (c.Secrets as Json[]).map((s) => [s.Name as string, str(s.ValueFrom)]),
  );

function executionSsmResources(t: Template): string {
  const [td] = Object.values(t.findResources("AWS::ECS::TaskDefinition"));
  const roleId = (
    ((td?.Properties as Json).ExecutionRoleArn as Json)[
      "Fn::GetAtt"
    ] as string[]
  )[0] as string;
  const ssm: Json[] = [];
  for (const res of Object.values(t.findResources("AWS::IAM::Policy"))) {
    const p = res.Properties as Json;
    if (!str(p.Roles).includes(`"${roleId}"`)) continue;
    for (const st of p.PolicyDocument.Statement as Json[]) {
      if (actionsOf(st).some((a) => a.startsWith("ssm:"))) ssm.push(st);
    }
  }
  expect(ssm).toHaveLength(1);
  expect(actionsOf(ssm[0] ?? {})).toEqual(["ssm:GetParameters"]);
  return str(ssm[0]?.Resource);
}

const resCount = (t: Template) => {
  const j = JSON.parse(executionSsmResources(t)) as unknown;
  return Array.isArray(j) ? j.length : 1;
};

const HASH = "/auth/master-password-hash";
const TOTP = "/auth/master-totp-secret";

describe.each(["import", "create"] as Mode[])(
  "DashboardServiceStack master user (%s)",
  (mode) => {
    describe("masterUsername unset", () => {
      const t = synth(mode, "dev");
      const c = container(t);

      it("omits AUTH_MASTER_USERNAME but still sets APP_ENV and AUTH_ACCESS_MODE=enforce", () => {
        const e = envMap(c);
        expect(e).not.toHaveProperty("AUTH_MASTER_USERNAME");
        expect(e.APP_ENV).toBe("dev");
        expect(e.AUTH_ACCESS_MODE).toBe("enforce");
      });

      it("wires neither master secret and lists only the two original ARNs plus the LiteLLM service key", () => {
        expect(Object.keys(secretMap(c)).sort()).toEqual([
          "AUTH_MICROSOFT_ENTRA_ID_SECRET",
          "AUTH_SECRET",
          "LITELLM_SERVICE_KEY",
        ]);
        const all = executionSsmResources(t);
        expect(resCount(t)).toBe(3);
        expect(all).not.toContain(HASH);
        expect(all).not.toContain(TOTP);
      });
    });

    describe("masterUsername set, dev", () => {
      const t = synth(mode, "dev", { masterUsername: "master-admin" });
      const c = container(t);

      it("sets AUTH_MASTER_USERNAME in environment", () => {
        expect(envMap(c).AUTH_MASTER_USERNAME).toBe("master-admin");
        expect(envMap(c).AUTH_ACCESS_MODE).toBe("enforce");
        expect(envMap(c).APP_ENV).toBe("dev");
      });

      it("wires the hash secret but not the TOTP secret", () => {
        const s = secretMap(c);
        expect(s.AUTH_MASTER_PASSWORD_HASH).toContain(
          "/llm-usage-lens/dev/auth/master-password-hash",
        );
        expect(s).not.toHaveProperty("AUTH_MASTER_TOTP_SECRET");
      });

      it("lists exactly four ARNs: no TOTP ARN", () => {
        const all = executionSsmResources(t);
        expect(resCount(t)).toBe(4);
        expect(all).toContain("/llm-usage-lens/dev/app/auth-secret");
        expect(all).toContain("/llm-usage-lens/dev/app/entra-client-secret");
        expect(all).toContain("/llm-usage-lens/dev/auth/master-password-hash");
        expect(all).not.toContain(TOTP);
      });
    });

    describe("masterUsername set, prod", () => {
      const t = synth(mode, "prod", { masterUsername: "master-admin" });
      const c = container(t);

      it("sets APP_ENV=prod, enforce and the username", () => {
        expect(envMap(c).APP_ENV).toBe("prod");
        expect(envMap(c).AUTH_ACCESS_MODE).toBe("enforce");
        expect(envMap(c).AUTH_MASTER_USERNAME).toBe("master-admin");
      });

      it("wires both secrets from the prod prefix, never as plain environment", () => {
        const s = secretMap(c);
        expect(s.AUTH_MASTER_PASSWORD_HASH).toContain(
          "/llm-usage-lens/prod/auth/master-password-hash",
        );
        expect(s.AUTH_MASTER_TOTP_SECRET).toContain(
          "/llm-usage-lens/prod/auth/master-totp-secret",
        );
        const names = Object.keys(envMap(c));
        expect(names).not.toContain("AUTH_MASTER_PASSWORD_HASH");
        expect(names).not.toContain("AUTH_MASTER_TOTP_SECRET");
      });

      it("lists exactly the five secret ARNs", () => {
        const all = executionSsmResources(t);
        expect(resCount(t)).toBe(5);
        for (const p of [
          "/llm-usage-lens/prod/litellm/service-key",
          "/llm-usage-lens/prod/app/auth-secret",
          "/llm-usage-lens/prod/app/entra-client-secret",
          "/llm-usage-lens/prod/auth/master-password-hash",
          "/llm-usage-lens/prod/auth/master-totp-secret",
        ]) {
          expect(all).toContain(p);
        }
      });
    });

    it("no policy grants ssm:PutParameter and no SSM parameter is created", () => {
      for (const env of ["dev", "prod"] as const) {
        const t = synth(mode, env, { masterUsername: "master-admin" });
        expect(str(t.toJSON())).not.toMatch(/ssm:PutParameter/);
        t.resourceCountIs("AWS::SSM::Parameter", 0);
      }
    });
  },
);
