// Source: docs/specs/2026-11-10-platform.md — "Inputs" (Entra pair optional,
// opsRoleArn, dynamodbVpcEndpointId), "Runtime", "Task role policy";
// docs/specs/2026-11-10-access-control.md — "Pre-SSO mode" (D19).
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";

import { DashboardServiceStack } from "../lib/dashboard-service-stack";
import { parseAppInputs } from "../lib/inputs";

import { ACCOUNT, REGION, actionsOf, contextFor } from "./support";
import type { Mode } from "./support";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- CFN template JSON is untyped

const WITHOUT_ENTRA = { entraClientId: undefined, entraIssuer: undefined };

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
  return Template.fromStack(stack);
}

describe("parseAppInputs: Entra pair and R2c optional inputs", () => {
  // Deploy workflow passes unset repository variables as "" (Access Control
  // spec - "Pre-SSO mode" D19; Platform spec - "Inputs").
  it("treats empty-string optional inputs as absent (pre-SSO)", () => {
    const inputs = parseAppInputs({
      ...contextFor("create"),
      entraClientId: "",
      entraIssuer: "",
      masterUsername: "breakglass",
      opsRoleArn: "",
      dynamodbVpcEndpointId: "",
    });
    expect(inputs.entraClientId).toBeUndefined();
    expect(inputs.entraIssuer).toBeUndefined();
    expect(inputs.opsRoleArn).toBeUndefined();
    expect(inputs.dynamodbVpcEndpointId).toBeUndefined();
    expect(inputs.masterUsername).toBe("breakglass");
  });

  it("treats an empty masterUsername as absent", () => {
    expect(() =>
      parseAppInputs({
        ...contextFor("create"),
        entraClientId: "",
        entraIssuer: "",
        masterUsername: "",
      }),
    ).toThrow();
  });

  it("still rejects an empty entraClientId with a set entraIssuer", () => {
    expect(() =>
      parseAppInputs({
        ...contextFor("create"),
        entraClientId: "",
        masterUsername: "breakglass",
      }),
    ).toThrow();
  });

  const ctx = (extra: Record<string, unknown>) => ({
    ...contextFor("create"),
    ...extra,
  });

  it("rejects entraClientId without entraIssuer", () => {
    expect(() =>
      parseAppInputs(
        ctx({ entraIssuer: undefined, masterUsername: "breakglass" }),
      ),
    ).toThrow();
  });

  it("rejects entraIssuer without entraClientId", () => {
    expect(() =>
      parseAppInputs(
        ctx({ entraClientId: undefined, masterUsername: "breakglass" }),
      ),
    ).toThrow();
  });

  it("accepts both Entra inputs absent when masterUsername is set", () => {
    const inputs = parseAppInputs(
      ctx({ ...WITHOUT_ENTRA, masterUsername: "breakglass" }),
    );
    expect(inputs.entraClientId).toBeUndefined();
    expect(inputs.entraIssuer).toBeUndefined();
  });

  it("rejects both Entra inputs absent without masterUsername", () => {
    expect(() => parseAppInputs(ctx(WITHOUT_ENTRA))).toThrow();
  });

  it("accepts both Entra inputs present with no masterUsername", () => {
    expect(() => parseAppInputs(ctx({}))).not.toThrow();
  });

  it("treats opsRoleArn and dynamodbVpcEndpointId as optional", () => {
    const inputs = parseAppInputs(ctx({}));
    expect(inputs.opsRoleArn).toBeUndefined();
    expect(inputs.dynamodbVpcEndpointId).toBeUndefined();
  });

  it("accepts a valid opsRoleArn and vpce id", () => {
    const inputs = parseAppInputs(
      ctx({
        opsRoleArn: "arn:aws:iam::123456789012:role/ops",
        dynamodbVpcEndpointId: "vpce-0123456789abcdef0",
      }),
    );
    expect(inputs.opsRoleArn).toBe("arn:aws:iam::123456789012:role/ops");
    expect(inputs.dynamodbVpcEndpointId).toBe("vpce-0123456789abcdef0");
  });

  it.each(["not-an-arn", "arn:aws:s3:::bucket", "arn:aws:iam::123:role/ops"])(
    "rejects opsRoleArn %s",
    (opsRoleArn) => {
      expect(() => parseAppInputs(ctx({ opsRoleArn }))).toThrow();
    },
  );

  it.each(["vpc-0123456789abcdef0", "vpce-", "endpoint", "vpce-XYZ"])(
    "rejects dynamodbVpcEndpointId %s",
    (dynamodbVpcEndpointId) => {
      expect(() => parseAppInputs(ctx({ dynamodbVpcEndpointId }))).toThrow();
    },
  );
});

describe.each<Mode>(["import", "create"])(
  "DashboardServiceStack without Entra (%s)",
  (mode) => {
    let t: Template;
    beforeAll(() => {
      t = synth(mode, "prod", {
        ...WITHOUT_ENTRA,
        masterUsername: "breakglass",
      });
    });

    it("sets no AUTH_MICROSOFT_ENTRA_ID_* environment entry or secret", () => {
      const [td] = Object.values(t.findResources("AWS::ECS::TaskDefinition"));
      const c = (
        (td?.Properties as Json).ContainerDefinitions as Json[]
      )[0] as Json;
      const names = [
        ...((c.Environment as Json[]) ?? []),
        ...((c.Secrets as Json[]) ?? []),
      ].map((e) => e.Name as string);
      expect(
        names.filter((n) => n.startsWith("AUTH_MICROSOFT_ENTRA_ID_")),
      ).toEqual([]);
      expect(names).toContain("AUTH_SECRET");
    });

    it("grants no ssm:GetParameters on entra-client-secret and creates no secret", () => {
      const ssmStatements = Object.values(t.findResources("AWS::IAM::Policy"))
        .flatMap(
          (r) => (r.Properties as Json).PolicyDocument.Statement as Json[],
        )
        .filter((st) => actionsOf(st).includes("ssm:GetParameters"));
      expect(ssmStatements.length).toBeGreaterThan(0);
      expect(JSON.stringify(ssmStatements)).not.toContain(
        "entra-client-secret",
      );
      expect(JSON.stringify(t.toJSON())).not.toContain("entra-client-secret");
      t.resourceCountIs("AWS::SecretsManager::Secret", 0);
    });
  },
);

describe.each(["dev", "prod"] as const)("task role (%s)", (env) => {
  const t = synth("create", env);

  it("has the fixed name llm-usage-lens-<env>-task", () => {
    const roles = Object.values(t.findResources("AWS::IAM::Role")).filter(
      (r) =>
        JSON.stringify(
          (r.Properties as Json).AssumeRolePolicyDocument,
        ).includes("ecs-tasks.amazonaws.com") &&
        (r.Properties as Json).RoleName !== undefined,
    );
    expect(roles.map((r) => (r.Properties as Json).RoleName)).toContain(
      `llm-usage-lens-${env}-task`,
    );
  });

  it("includes SSOEXPECT#* and SSOREF#* in the write LeadingKeys", () => {
    const write = Object.values(t.findResources("AWS::IAM::Policy"))
      .flatMap((r) => (r.Properties as Json).PolicyDocument.Statement as Json[])
      .filter(
        (st) =>
          actionsOf(st).includes("dynamodb:PutItem") &&
          actionsOf(st).includes("dynamodb:UpdateItem"),
      );
    expect(write).toHaveLength(1);
    const keys = [].concat(
      (write[0] as Json).Condition["ForAllValues:StringLike"][
        "dynamodb:LeadingKeys"
      ],
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        "SETUPLINK#*",
        "SSOEXPECT#*",
        "SSOREF#*",
        "ACCT#*",
        "IDENT#*",
      ]),
    );
  });
});
