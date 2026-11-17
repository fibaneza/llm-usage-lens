// Source: docs/specs/2026-11-10-platform.md — "Created resources" (FoundationStack:
// table, CMK, cluster, ECR, SSM name parameters); contract rp-contract.md.
import {
  AuditItemSchema,
  DailyRollupItemSchema,
  GSI1_NAME,
} from "@llm-usage-lens/shared";
import { App } from "aws-cdk-lib";
import { Match } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { FoundationStack } from "../lib/foundation-stack";

import { ACCOUNT, REGION, synthInfra } from "./support";

describe.each(["dev", "prod"] as const)("FoundationStack (%s)", (env) => {
  const t = synthInfra(env);

  it("creates exactly one retained, PITR, CMK-encrypted on-demand table", () => {
    t.resourceCountIs("AWS::DynamoDB::Table", 1);
    t.hasResource("AWS::DynamoDB::Table", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
      Properties: {
        TableName: "bedrock-usage",
        BillingMode: "PAY_PER_REQUEST",
        KeySchema: [
          { AttributeName: "PK", KeyType: "HASH" },
          { AttributeName: "SK", KeyType: "RANGE" },
        ],
        AttributeDefinitions: Match.arrayWith([
          { AttributeName: "PK", AttributeType: "S" },
          { AttributeName: "SK", AttributeType: "S" },
          { AttributeName: "gsi1pk", AttributeType: "S" },
          { AttributeName: "gsi1sk", AttributeType: "S" },
        ]),
        GlobalSecondaryIndexes: [
          Match.objectLike({
            IndexName: GSI1_NAME,
            KeySchema: [
              { AttributeName: "gsi1pk", KeyType: "HASH" },
              { AttributeName: "gsi1sk", KeyType: "RANGE" },
            ],
            Projection: { ProjectionType: "ALL" },
          }),
        ],
        TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
        SSESpecification: Match.objectLike({
          SSEEnabled: true,
          SSEType: "KMS",
          KMSMasterKeyId: Match.anyValue(),
        }),
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      },
    });
  });

  it("creates exactly one retained CMK with rotation", () => {
    t.resourceCountIs("AWS::KMS::Key", 1);
    t.hasResource("AWS::KMS::Key", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
      Properties: { EnableKeyRotation: true },
    });
  });

  // data-model spec — "TTL attribute `expiresAt`" (2026-11-17): the table's one
  // TTL attribute must be the one the rollup and audit items write.
  it("table TTL attribute is the attribute the rollup and audit items write", () => {
    const tables = Object.values(t.findResources("AWS::DynamoDB::Table"));
    const ttlAttribute = tables[0]?.Properties.TimeToLiveSpecification
      .AttributeName as string;
    expect(Object.keys(DailyRollupItemSchema.shape)).toContain(ttlAttribute);
    expect(Object.keys(AuditItemSchema.shape)).toContain(ttlAttribute);
    expect(Object.keys(DailyRollupItemSchema.shape)).not.toContain("ttl");
  });

  it("creates one ECS cluster with Container Insights", () => {
    t.resourceCountIs("AWS::ECS::Cluster", 1);
    t.hasResourceProperties("AWS::ECS::Cluster", {
      ClusterSettings: Match.arrayWith([
        {
          Name: "containerInsights",
          Value: Match.stringLikeRegexp("enabled|enhanced"),
        },
      ]),
    });
  });

  it("creates one ECR repository, scan on push, immutable tags", () => {
    t.resourceCountIs("AWS::ECR::Repository", 1);
    t.hasResourceProperties("AWS::ECR::Repository", {
      ImageScanningConfiguration: { ScanOnPush: true },
      ImageTagMutability: "IMMUTABLE",
    });
  });

  it("publishes the five SSM name parameters under the env prefix", () => {
    const names = [
      "table-name",
      "table-arn",
      "kms-key-arn",
      "cluster-name",
      "repository-name",
    ];
    const params = t.findResources("AWS::SSM::Parameter");
    expect(Object.keys(params)).toHaveLength(names.length);
    for (const name of names) {
      t.hasResourceProperties("AWS::SSM::Parameter", {
        Name: `/llm-usage-lens/${env}/infra/${name}`,
        Type: "String",
      });
    }
  });

  it("has termination protection on", () => {
    // Stack-level flag is read from the synthesized stack artifact.
    const stack = new FoundationStack(new App(), "Infra", {
      appEnv: env,
      env: { account: ACCOUNT, region: REGION },
    });
    expect(stack.terminationProtection).toBe(true);
  });
});
