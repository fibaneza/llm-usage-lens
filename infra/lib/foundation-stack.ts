import { RemovalPolicy, Stack } from "aws-cdk-lib";
import type { StackProps } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import { GSI1_NAME, TABLE_NAME_DEFAULT } from "@llm-usage-lens/shared";

import { ssmPrefix } from "./inputs";
import type { AppEnv } from "./inputs";

// Source: docs/specs/2026-11-10-platform.md — "Created resources" (FoundationStack:
// shared, stateful) and "IaC layout" (values shared through SSM, never exports).

export type FoundationStackProps = StackProps & { appEnv: AppEnv };

export class FoundationStack extends Stack {
  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, { ...props, terminationProtection: true });
    const prefix = `${ssmPrefix(props.appEnv)}/infra`;

    const key = new kms.Key(this, "Cmk", {
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    // CloudWatch Logs encrypts the audit log group with this key
    // (Platform spec — DashboardServiceStack audit log group).
    key.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [
          new iam.ServicePrincipal(`logs.${this.region}.amazonaws.com`),
        ],
        actions: ["kms:Encrypt*", "kms:Decrypt*", "kms:GenerateDataKey*"],
        resources: ["*"],
        conditions: {
          ArnLike: {
            "kms:EncryptionContext:aws:logs:arn": `arn:${this.partition}:logs:${this.region}:${this.account}:log-group:/llm-usage-lens/*`,
          },
        },
      }),
    );

    const table = new dynamodb.Table(this, "Table", {
      tableName: TABLE_NAME_DEFAULT,
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: key,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      timeToLiveAttribute: "expiresAt",
      removalPolicy: RemovalPolicy.RETAIN,
    });
    table.addGlobalSecondaryIndex({
      indexName: GSI1_NAME,
      partitionKey: { name: "gsi1pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "gsi1sk", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const cluster = new ecs.CfnCluster(this, "Cluster", {
      clusterSettings: [{ name: "containerInsights", value: "enabled" }],
    });

    const repository = new ecr.Repository(this, "Repository", {
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
    });

    const published: Record<string, string> = {
      "table-name": table.tableName,
      "table-arn": table.tableArn,
      "kms-key-arn": key.keyArn,
      "cluster-name": cluster.ref,
      "repository-name": repository.repositoryName,
    };
    for (const [name, value] of Object.entries(published)) {
      new ssm.StringParameter(this, `Param-${name}`, {
        parameterName: `${prefix}/${name}`,
        stringValue: value,
      });
    }
  }
}
