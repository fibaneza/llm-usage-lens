// Source: docs/specs/2026-11-10-platform.md — "Data isolation" (table resource
// policy, VPC endpoint constraint, CMK key policy) and "Inputs" (opsRoleArn:
// prod synth warns, never errors). Placeholder ids only (Rule 50.9).
import { App } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { FoundationStack } from "../lib/foundation-stack";

import { ACCOUNT, REGION, actionsOf } from "./support";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- CFN template JSON is untyped

const OPS = "arn:aws:iam::123456789012:role/ops";
const VPCE = "vpce-0123456789abcdef0";
const DATA_PLANE = [
  "dynamodb:GetItem",
  "dynamodb:BatchGetItem",
  "dynamodb:Query",
  "dynamodb:Scan",
  "dynamodb:PutItem",
  "dynamodb:UpdateItem",
  "dynamodb:DeleteItem",
  "dynamodb:BatchWriteItem",
  "dynamodb:ConditionCheckItem",
  "dynamodb:ExportTableToPointInTime",
  "dynamodb:RestoreTableToPointInTime",
];
const CONTROL_PLANE = [
  "dynamodb:CreateTable",
  "dynamodb:DeleteTable",
  "dynamodb:UpdateTable",
  "dynamodb:DescribeTable",
  "dynamodb:TagResource",
  "dynamodb:UpdateTimeToLive",
  "dynamodb:PutResourcePolicy",
  "dynamodb:DeleteResourcePolicy",
  "dynamodb:*",
];

type Opts = { opsRoleArn?: string; dynamodbVpcEndpointId?: string };

function build(env: "dev" | "prod", opts: Opts = {}) {
  const app = new App();
  const stack = new FoundationStack(app, "Infra", {
    appEnv: env,
    ...opts,
    env: { account: ACCOUNT, region: REGION },
  });
  return { stack, template: Template.fromStack(stack) };
}

function tablePolicyStatements(t: Template): Json[] {
  const [table] = Object.values(t.findResources("AWS::DynamoDB::Table"));
  const doc = (table?.Properties as Json).ResourcePolicy?.PolicyDocument as
    | Json
    | undefined;
  return (doc?.Statement as Json[]) ?? [];
}

const principalArns = (st: Json): string =>
  JSON.stringify(st.Condition?.ArnNotEquals ?? st.Condition?.ArnNotLike ?? {});

describe.each(["dev", "prod"] as const)(
  "FoundationStack table resource policy (%s)",
  (env) => {
    it("denies Principal * data-plane and export actions to all but the task role", () => {
      const { template } = build(env);
      const statements = tablePolicyStatements(template);
      const deny = statements.filter(
        (st) =>
          st.Effect === "Deny" &&
          (st.Principal === "*" || st.Principal?.AWS === "*") &&
          st.Condition?.ArnNotEquals?.["aws:PrincipalArn"] !== undefined,
      );
      expect(deny.length).toBeGreaterThanOrEqual(1);
      const denied = deny.flatMap((st) => actionsOf(st));
      for (const a of DATA_PLANE) expect(denied).toContain(a);
      expect(denied.some((a) => a.startsWith("dynamodb:PartiQL"))).toBe(true);
      expect(principalArns(deny[0] as Json)).toContain(
        `llm-usage-lens-${env}-task`,
      );
    });

    it("never denies control-plane actions", () => {
      const { template } = build(env, { opsRoleArn: OPS });
      const denied = tablePolicyStatements(template)
        .filter((st) => st.Effect === "Deny")
        .flatMap((st) => actionsOf(st));
      for (const a of CONTROL_PLANE) expect(denied).not.toContain(a);
    });

    it("does not list the ops role when opsRoleArn is unset", () => {
      const { template } = build(env);
      expect(JSON.stringify(tablePolicyStatements(template))).not.toContain(
        ":role/ops",
      );
    });

    it("lists opsRoleArn among the allowed principals when given", () => {
      const { template } = build(env, { opsRoleArn: OPS });
      const deny = tablePolicyStatements(template).find(
        (st) =>
          st.Effect === "Deny" &&
          st.Condition?.ArnNotEquals?.["aws:PrincipalArn"] !== undefined,
      ) as Json;
      expect(principalArns(deny)).toContain(OPS);
      expect(principalArns(deny)).toContain(`llm-usage-lens-${env}-task`);
    });

    it("adds no aws:SourceVpce constraint without dynamodbVpcEndpointId", () => {
      const { template } = build(env);
      expect(JSON.stringify(tablePolicyStatements(template))).not.toContain(
        "aws:SourceVpce",
      );
    });

    it("constrains the task role path by aws:SourceVpce when the endpoint is set", () => {
      const { template } = build(env, { dynamodbVpcEndpointId: VPCE });
      const vpce = tablePolicyStatements(template).filter(
        (st) =>
          st.Effect === "Deny" &&
          JSON.stringify(st.Condition ?? {}).includes("aws:SourceVpce"),
      );
      expect(vpce.length).toBeGreaterThanOrEqual(1);
      const text = JSON.stringify(vpce);
      expect(text).toContain(VPCE);
      expect(text).toContain(`llm-usage-lens-${env}-task`);
      // The ops role is not bound to the endpoint.
      const withOps = build(env, {
        dynamodbVpcEndpointId: VPCE,
        opsRoleArn: OPS,
      });
      const vpceOps = tablePolicyStatements(withOps.template).filter((st) =>
        JSON.stringify(st.Condition ?? {}).includes("aws:SourceVpce"),
      );
      expect(JSON.stringify(vpceOps)).not.toContain(OPS);
    });
  },
);

describe("FoundationStack prod ops-role warning", () => {
  const warning = Match.stringLikeRegexp("opsRoleArn");

  it("warns (not errors) in prod when opsRoleArn is unset", () => {
    const { stack } = build("prod");
    Annotations.fromStack(stack).hasWarning("*", warning);
    Annotations.fromStack(stack).hasNoError("*", Match.anyValue());
  });

  it("does not warn in prod when opsRoleArn is set", () => {
    const { stack } = build("prod", { opsRoleArn: OPS });
    Annotations.fromStack(stack).hasNoWarning("*", warning);
  });

  it("does not warn in dev", () => {
    const { stack } = build("dev");
    Annotations.fromStack(stack).hasNoWarning("*", warning);
  });
});

describe.each(["dev", "prod"] as const)(
  "FoundationStack key policy (%s)",
  (env) => {
    const { template } = build(env, { opsRoleArn: OPS });
    const [key] = Object.values(template.findResources("AWS::KMS::Key"));
    const statements = (key?.Properties as Json).KeyPolicy.Statement as Json[];
    const USE = ["kms:Decrypt", "kms:GenerateDataKey", "kms:Encrypt"];
    const grantsUse = (st: Json) =>
      actionsOf(st).some(
        (a) =>
          a === "kms:*" ||
          USE.some((u) => a === u || a === `${u}*`) ||
          a === "kms:GenerateDataKey*",
      );
    const isRoot = (st: Json) =>
      /:root/.test(JSON.stringify(st.Principal ?? {}));
    const isSsmOnly = (st: Json) =>
      !JSON.stringify(st.Condition ?? {}).includes("aws:PrincipalArn") &&
      JSON.stringify(st.Condition?.StringEquals?.["kms:ViaService"] ?? "") ===
        `"ssm.${REGION}.amazonaws.com"`;

    it("grants the account root administration only, never key use", () => {
      const root = statements.filter(
        (st) =>
          st.Effect === "Allow" &&
          isRoot(st) &&
          !isSsmOnly(st) &&
          !JSON.stringify(st.Condition ?? {}).includes("aws:PrincipalArn"),
      );
      expect(root.length).toBeGreaterThanOrEqual(1);
      for (const st of root) {
        expect(grantsUse(st)).toBe(false);
        expect(actionsOf(st)).not.toContain("kms:*");
      }
    });

    it("names the task role for decrypt/data-key and keeps the CloudWatch Logs grant", () => {
      const use = statements.filter(
        (st) => st.Effect === "Allow" && grantsUse(st),
      );
      const text = JSON.stringify(use);
      expect(text).toContain(`llm-usage-lens-${env}-task`);
      expect(text).toContain("logs.");
      const taskGrant = use.find((st) =>
        JSON.stringify(st.Condition ?? {}).includes(
          `llm-usage-lens-${env}-task`,
        ),
      ) as Json;
      expect(taskGrant).toBeDefined();
      expect(JSON.stringify(taskGrant.Condition)).toContain("aws:PrincipalArn");
    });

    // KMS rejects a key policy naming a non-existent principal, and the task
    // and execution roles are created later in DashboardServiceStack, so the
    // policy names the account root and narrows by aws:PrincipalArn.
    it("names no IAM role ARN directly in any Principal element", () => {
      for (const st of statements) {
        expect(JSON.stringify(st.Principal ?? {})).not.toMatch(/:role\//);
        expect(JSON.stringify(st.Principal ?? {})).not.toContain("-task");
      }
    });

    it("conditions every key-use Allow on aws:PrincipalArn (task role) or kms:ViaService", () => {
      const use = statements.filter(
        (st) =>
          st.Effect === "Allow" &&
          grantsUse(st) &&
          !JSON.stringify(st.Principal ?? {}).includes("logs.") &&
          !isSsmOnly(st),
      );
      expect(use.length).toBeGreaterThanOrEqual(2);
      for (const st of use) {
        expect(JSON.stringify(st.Principal)).toContain(":root");
        const cond = JSON.stringify(st.Condition ?? {});
        expect(cond).toContain("aws:PrincipalArn");
        expect(cond).toMatch(/ArnEquals|ArnLike/);
      }
      const text = JSON.stringify(use.map((st) => st.Condition));
      expect(text).toContain(`llm-usage-lens-${env}-task`);
      expect(text).toContain("kms:ViaService");
    });

    it("does not grant key use to every principal", () => {
      for (const st of statements) {
        if (st.Effect !== "Allow" || !grantsUse(st)) continue;
        expect(JSON.stringify(st.Principal)).not.toBe('"*"');
        expect(JSON.stringify(st.Principal ?? {})).not.toContain('"AWS":"*"');
      }
    });
    // Platform spec - "Data isolation", Encryption key row (88fc475): operators
    // create/rotate SecureStrings via SSM only; never Decrypt.
    it("lets the account root Encrypt/GenerateDataKey only via SSM, never Decrypt", () => {
      const ssm = statements.filter(
        (st) =>
          st.Effect === "Allow" &&
          isRoot(st) &&
          isSsmOnly(st) &&
          !JSON.stringify(st.Condition ?? {}).includes("aws:PrincipalArn"),
      );
      expect(ssm.length).toBeGreaterThanOrEqual(1);
      const actions = ssm.flatMap((st) => actionsOf(st));
      expect(actions).toContain("kms:Encrypt");
      expect(actions).toContain("kms:GenerateDataKey");
      expect(actions).not.toContain("kms:Decrypt");
      expect(actions).not.toContain("kms:*");
      expect(actions.some((a) => a.startsWith("kms:Decrypt"))).toBe(false);
    });

    it("keeps unconditioned root statements free of key use", () => {
      for (const st of statements) {
        if (st.Effect !== "Allow" || !isRoot(st) || st.Condition) continue;
        expect(grantsUse(st)).toBe(false);
      }
    });
  },
);
