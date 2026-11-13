import { ArnFormat } from "aws-cdk-lib";
import type { Stack } from "aws-cdk-lib";
import type * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import type * as logs from "aws-cdk-lib/aws-logs";
import { COLLECTOR_REGION, GSI1_NAME } from "@llm-usage-lens/shared";

import { ssmPrefix } from "./inputs";
import type { AppInputs } from "./inputs";

// Source: docs/specs/2026-11-10-platform.md — "Runtime", "Task role policy".

export const CONTAINER_PORT = 3000;

// An SSM parameter injected as a container secret. The execution-role grant is
// written explicitly below (ssm:GetParameters only), so the CDK helper's
// broader default grant is dropped here.
class ParameterSecret extends ecs.Secret {
  readonly hasField = false;
  constructor(readonly arn: string) {
    super();
  }
  grantRead(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.drop(grantee, "granted explicitly on the execution role");
  }
}

export type DashboardTaskProps = {
  inputs: AppInputs;
  tableName: string;
  tableArn: string;
  keyArn: string;
  repository: ecr.IRepository;
  appLogGroup: logs.ILogGroup;
};

// The task role, the Fargate task definition and its `web` container.
export function addDashboardTask(
  stack: Stack,
  props: DashboardTaskProps,
): ecs.FargateTaskDefinition {
  const { inputs, tableName, tableArn, keyArn, repository, appLogGroup } =
    props;
  const prefix = ssmPrefix(inputs.env);
  const prod = inputs.env === "prod";

  const secretArn = (name: string) =>
    stack.formatArn({
      service: "ssm",
      resource: "parameter",
      resourceName: `${prefix.slice(1)}/app/${name}`,
      arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
    });
  const authSecretArn = secretArn("auth-secret");
  const entraSecretArn = secretArn("entra-client-secret");
  // Hand-managed SecureStrings, never created by CDK (Access Control spec —
  // "Sign-in methods"; Platform spec — "Runtime").
  const authSecretParamArn = (name: string) =>
    stack.formatArn({
      service: "ssm",
      resource: "parameter",
      resourceName: `${prefix.slice(1)}/auth/${name}`,
      arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
    });
  const masterHashArn = authSecretParamArn("master-password-hash");
  const masterTotpArn = authSecretParamArn("master-totp-secret");
  const masterEnabled = !!inputs.masterUsername;

  // Only the RP statements; 4R.2 adds the access-control keys and audit
  // (Platform spec — "Ownership").
  const taskRole = new iam.Role(stack, "TaskRole", {
    assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
  });
  taskRole.addToPolicy(
    new iam.PolicyStatement({
      actions: [
        "dynamodb:GetItem",
        "dynamodb:BatchGetItem",
        "dynamodb:Query",
        "dynamodb:DescribeTable",
      ],
      resources: [tableArn, `${tableArn}/index/${GSI1_NAME}`],
    }),
  );
  taskRole.addToPolicy(
    new iam.PolicyStatement({
      actions: [
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:ConditionCheckItem",
      ],
      resources: [tableArn],
      conditions: {
        "ForAllValues:StringLike": {
          "dynamodb:LeadingKeys": ["ACCT#*", "IDENT#*"],
        },
      },
    }),
  );
  taskRole.addToPolicy(
    new iam.PolicyStatement({
      actions: ["kms:Decrypt", "kms:GenerateDataKey"],
      resources: [keyArn],
    }),
  );

  const taskDefinition = new ecs.FargateTaskDefinition(stack, "TaskDef", {
    cpu: 512,
    memoryLimitMiB: 1024,
    taskRole,
  });
  taskDefinition.addToExecutionRolePolicy(
    new iam.PolicyStatement({
      actions: ["ssm:GetParameters"],
      resources: [
        authSecretArn,
        entraSecretArn,
        ...(masterEnabled ? [masterHashArn] : []),
        ...(masterEnabled && prod ? [masterTotpArn] : []),
      ],
    }),
  );
  taskDefinition.addToExecutionRolePolicy(
    new iam.PolicyStatement({
      actions: ["kms:Decrypt"],
      resources: [keyArn],
      conditions: {
        StringEquals: {
          "kms:ViaService": `ssm.${COLLECTOR_REGION}.amazonaws.com`,
        },
      },
    }),
  );
  taskDefinition.addContainer("web", {
    image: ecs.ContainerImage.fromEcrRepository(repository, inputs.imageTag),
    portMappings: [{ containerPort: CONTAINER_PORT }],
    logging: ecs.LogDrivers.awsLogs({
      logGroup: appLogGroup,
      streamPrefix: "web",
    }),
    environment: {
      DYNAMODB_TABLE_NAME: tableName,
      AWS_REGION: COLLECTOR_REGION,
      APP_ENV: inputs.env,
      AUTH_ACCESS_MODE: "enforce",
      ...(inputs.masterUsername
        ? { AUTH_MASTER_USERNAME: inputs.masterUsername }
        : {}),
      NODE_ENV: "production",
      NEXT_PUBLIC_APP_URL: `https://${inputs.dashboardHostname}`,
      AUTH_URL: `https://${inputs.dashboardHostname}`,
      AUTH_MICROSOFT_ENTRA_ID_ID: inputs.entraClientId,
      AUTH_MICROSOFT_ENTRA_ID_ISSUER: inputs.entraIssuer,
    },
    secrets: {
      AUTH_SECRET: new ParameterSecret(authSecretArn),
      AUTH_MICROSOFT_ENTRA_ID_SECRET: new ParameterSecret(entraSecretArn),
      ...(masterEnabled
        ? {
            AUTH_MASTER_PASSWORD_HASH: new ParameterSecret(masterHashArn),
          }
        : {}),
      ...(masterEnabled && prod
        ? { AUTH_MASTER_TOTP_SECRET: new ParameterSecret(masterTotpArn) }
        : {}),
    },
  });

  return taskDefinition;
}
