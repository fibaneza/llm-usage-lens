// @vitest-environment node
// Source: docs/specs/2026-11-10-litellm.md — "Security architecture" items 3-5
// and "Cloud permissions" (service key in task-definition `secrets`, execution
// role only, one parameter ARN, no ssm:PutParameter, TaskSecurityGroupId
// output); decision LD6 (project CMK, kms:ViaService); threats LT1, LT2;
// implementation-phases L1 Verify (CDK assertions). Rule 50.
import type { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { actionsOf, synthApp } from "./support";
import type { Mode } from "./support";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- CFN template JSON is untyped
const str = (v: unknown) => JSON.stringify(v);

function taskDef(t: Template): Json {
  const [td] = Object.values(t.findResources("AWS::ECS::TaskDefinition"));
  return td?.Properties as Json;
}

function container(t: Template): Json {
  return (taskDef(t).ContainerDefinitions as Json[])[0] as Json;
}

function roleStatements(t: Template, prop: "ExecutionRoleArn" | "TaskRoleArn") {
  const roleId = ((taskDef(t)[prop] as Json)["Fn::GetAtt"] as string[])[0];
  const out: Json[] = [];
  for (const res of Object.values(t.findResources("AWS::IAM::Policy"))) {
    const p = res.Properties as Json;
    if (!str(p.Roles).includes(`"${roleId}"`)) continue;
    out.push(...(p.PolicyDocument.Statement as Json[]));
  }
  return out;
}

const PARAM = (env: string) => `/llm-usage-lens/${env}/litellm/service-key`;

describe.each(["import", "create"] as Mode[])(
  "DashboardServiceStack LiteLLM service key (%s)",
  (mode) => {
    describe.each(["dev", "prod"] as const)("%s", (env) => {
      const t = synthApp(mode, env);

      it("declares LITELLM_SERVICE_KEY under secrets, valueFrom the service-key parameter ARN", () => {
        const secrets = container(t).Secrets as Json[];
        const entry = secrets.find((s) => s.Name === "LITELLM_SERVICE_KEY");
        expect(entry).toBeDefined();
        expect(str(entry?.ValueFrom)).toContain(PARAM(env));
        expect(str(entry?.ValueFrom)).toContain("arn:");
      });

      it("never puts the service key (or any LITELLM secret) in environment", () => {
        const names = ((container(t).Environment as Json[]) ?? []).map(
          (e) => e.Name as string,
        );
        expect(names).not.toContain("LITELLM_SERVICE_KEY");
        expect(names.filter((n) => /KEY|SECRET/.test(n))).toEqual([]);
      });

      it("grants the execution role ssm:GetParameters on exactly the one parameter ARN, among the existing secret ARNs", () => {
        const ssm = roleStatements(t, "ExecutionRoleArn").filter((s) =>
          actionsOf(s).some((a) => a.startsWith("ssm:")),
        );
        expect(ssm).toHaveLength(1);
        expect(actionsOf(ssm[0] ?? {})).toEqual(["ssm:GetParameters"]);
        const resources = JSON.parse(str(ssm[0]?.Resource)) as unknown;
        const list = Array.isArray(resources) ? resources : [resources];
        expect(list.filter((r) => str(r).includes("litellm"))).toHaveLength(1);
        expect(str(list)).toContain(PARAM(env));
        expect(str(list)).not.toMatch(/litellm\/\*|litellm\*|parameter\/\*/);
      });

      it("keeps kms:Decrypt on the CMK conditioned on kms:ViaService for SSM", () => {
        const kms = roleStatements(t, "ExecutionRoleArn").filter((s) =>
          actionsOf(s).includes("kms:Decrypt"),
        );
        expect(kms).toHaveLength(1);
        expect(kms[0]?.Condition).toEqual({
          StringEquals: {
            "kms:ViaService": "ssm.ap-southeast-2.amazonaws.com",
          },
        });
      });

      it("adds nothing LiteLLM-related to the task role (no SSM, no KMS)", () => {
        const stmts = roleStatements(t, "TaskRoleArn");
        expect(str(stmts)).not.toMatch(/litellm/i);
        for (const a of stmts.flatMap(actionsOf)) {
          expect(a).not.toMatch(/^ssm:/);
          expect(a).not.toMatch(/^kms:Decrypt$/);
        }
      });

      it("no policy anywhere grants ssm:PutParameter and no parameter or secret is created", () => {
        expect(str(t.toJSON())).not.toMatch(/ssm:PutParameter/);
        t.resourceCountIs("AWS::SSM::Parameter", 0);
        t.resourceCountIs("AWS::SecretsManager::Secret", 0);
      });

      it("references no master key variable, parameter or context (LT2)", () => {
        expect(str(t.toJSON())).not.toMatch(/master[-_ ]?key/i);
        expect(str(t.toJSON())).not.toMatch(/LITELLM_MASTER/i);
      });

      it("does not give the CI deploy role access to the parameter", () => {
        const policies = Object.values(t.findResources("AWS::IAM::Policy"));
        const ciGrants = policies.filter((p) =>
          str((p.Properties as Json).Roles)
            .toLowerCase()
            .includes("deploy"),
        );
        expect(str(ciGrants)).not.toContain("litellm");
      });

      it("exports the task security group id as a TaskSecurityGroupId output (no Export)", () => {
        const outputs = (t.toJSON().Outputs ?? {}) as Record<string, Json>;
        const out = outputs.TaskSecurityGroupId;
        expect(out).toBeDefined();
        expect(str(out?.Value)).toMatch(/TaskSg/);
        expect(out?.Export).toBeUndefined();
      });

      it("adds no egress rule or new network resource for LiteLLM", () => {
        t.resourceCountIs("AWS::EC2::VPC", 0);
        t.resourceCountIs("AWS::EC2::Subnet", 0);
        expect(str(t.toJSON())).not.toMatch(/litellmEgressCidrs/);
      });
    });
  },
);
