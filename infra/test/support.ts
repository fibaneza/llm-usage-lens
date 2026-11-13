// Test-only helpers for the infra suite. Placeholder ids only (Rule 50.9).
// Source: docs/specs/2026-11-10-platform.md — "Inputs".
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";

import { DashboardServiceStack } from "../lib/dashboard-service-stack";
import { FoundationStack } from "../lib/foundation-stack";
import { parseAppInputs } from "../lib/inputs";

export const ACCOUNT = "123456789012";
export const REGION = "ap-southeast-2";
export const CERT_ARN = `arn:aws:acm:${REGION}:${ACCOUNT}:certificate/00000000-0000-0000-0000-000000000000`;
export const LISTENER_ARN = `arn:aws:elasticloadbalancing:${REGION}:${ACCOUNT}:listener/app/shared/0000000000000000/0000000000000000`;
export const TOPIC_ARN = `arn:aws:sns:${REGION}:${ACCOUNT}:alarms`;
export const HOST = "llm-usage-lens.example.internal";
export const ENTRA_ID = "00000000-0000-0000-0000-000000000000";
export const ENTRA_ISSUER =
  "https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0";
export const CIDR = "10.0.0.0/8";
export const ALB_SG = "sg-00000000000000000";

export const baseContext = {
  env: "dev",
  account: ACCOUNT,
  vpcId: "vpc-00000000000000000",
  availabilityZones: "ap-southeast-2a,ap-southeast-2b",
  privateSubnetIds: "subnet-00000000000000001,subnet-00000000000000002",
  certificateArn: CERT_ARN,
  dashboardHostname: HOST,
  alarmTopicArn: TOPIC_ARN,
  githubRepository: "example-org/llm-usage-lens",
  entraClientId: ENTRA_ID,
  entraIssuer: ENTRA_ISSUER,
} as const;

export const importContext = {
  ...baseContext,
  listenerArn: LISTENER_ARN,
  listenerRulePriority: "100",
  albSecurityGroupId: ALB_SG,
};

export const createContext = {
  ...baseContext,
  companyCidrs: CIDR,
};

export type Mode = "import" | "create";

export function contextFor(
  mode: Mode,
  env: "dev" | "prod" = "dev",
): Record<string, unknown> {
  return { ...(mode === "import" ? importContext : createContext), env };
}

export function synthInfra(env: "dev" | "prod" = "dev"): Template {
  const app = new App();
  const stack = new FoundationStack(app, "Infra", {
    appEnv: env,
    env: { account: ACCOUNT, region: REGION },
  });
  return Template.fromStack(stack);
}

export function synthApp(mode: Mode, env: "dev" | "prod" = "dev"): Template {
  const app = new App();
  const stack = new DashboardServiceStack(app, "App", {
    inputs: parseAppInputs(contextFor(mode, env)),
    env: { account: ACCOUNT, region: REGION },
  });
  return Template.fromStack(stack);
}

export const NOT_CREATED_TYPES = [
  "AWS::EC2::VPC",
  "AWS::EC2::Subnet",
  "AWS::EC2::NatGateway",
  "AWS::EC2::VPCEndpoint",
  "AWS::ElastiCache::CacheCluster",
  "AWS::ElastiCache::ReplicationGroup",
  "AWS::ElastiCache::ServerlessCache",
  "AWS::WAFv2::WebACL",
  "AWS::WAFv2::WebACLAssociation",
  "AWS::CertificateManager::Certificate",
  "AWS::CloudFront::Distribution",
  "AWS::SNS::Topic",
  "AWS::RDS::DBInstance",
  "AWS::RDS::DBCluster",
  "AWS::IAM::OIDCProvider",
] as const;

// Flatten a policy Action field to an array.
export function actionsOf(statement: { Action?: unknown }): string[] {
  const a = statement.Action;
  return Array.isArray(a) ? (a as string[]) : typeof a === "string" ? [a] : [];
}

type Statement = {
  Effect?: string;
  Action?: unknown;
  Resource?: unknown;
  Condition?: Record<string, unknown>;
};

export function statementsOfPolicies(
  template: Template,
  roleLogicalIdPrefix?: string,
): Statement[] {
  const policies = template.findResources("AWS::IAM::Policy");
  const out: Statement[] = [];
  for (const [id, res] of Object.entries(policies)) {
    if (roleLogicalIdPrefix && !id.startsWith(roleLogicalIdPrefix)) continue;
    const props = res.Properties as {
      PolicyDocument: { Statement: Statement[] };
    };
    out.push(...props.PolicyDocument.Statement);
  }
  return out;
}
