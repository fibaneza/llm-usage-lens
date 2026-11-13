import { ArnFormat, Stack } from "aws-cdk-lib";
import type { StackProps } from "aws-cdk-lib";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";

import { addCiDeployRole } from "./ci-deploy-role";
import { addDashboardAlarms } from "./dashboard-alarms";
import { addDashboardIngress } from "./dashboard-ingress";
import { addDashboardTask } from "./dashboard-task";
import { ssmPrefix } from "./inputs";
import type { AppInputs } from "./inputs";

// Source: docs/specs/2026-11-10-platform.md — "Created resources" (DashboardServiceStack).
// The stack wires the dashboard's Fargate service; its parts live beside it:
// dashboard-task.ts (task role, task definition, container),
// dashboard-ingress.ts (target group, load balancer), dashboard-alarms.ts
// (alarms, metric filters) and ci-deploy-role.ts (GitHub OIDC deploy role).
// Each part takes the stack as its construct scope, so logical IDs stay flat.

export type DashboardServiceStackProps = StackProps & { inputs: AppInputs };

export class DashboardServiceStack extends Stack {
  constructor(scope: Construct, id: string, props: DashboardServiceStackProps) {
    super(scope, id, props);
    const { inputs } = props;
    const prefix = ssmPrefix(inputs.env);
    const desiredCount = inputs.env === "prod" ? 2 : 1;

    const infraParam = (name: string) =>
      ssm.StringParameter.valueForStringParameter(
        this,
        `${prefix}/infra/${name}`,
      );
    const tableName = infraParam("table-name");
    const tableArn = infraParam("table-arn");
    const keyArn = infraParam("kms-key-arn");
    const clusterName = infraParam("cluster-name");
    const repositoryName = infraParam("repository-name");

    const vpc = ec2.Vpc.fromVpcAttributes(this, "Vpc", {
      vpcId: inputs.vpcId,
      availabilityZones: inputs.availabilityZones,
      privateSubnetIds: inputs.privateSubnetIds,
    });
    const key = kms.Key.fromKeyArn(this, "Cmk", keyArn);
    const cluster = ecs.Cluster.fromClusterAttributes(this, "Cluster", {
      clusterName,
      vpc,
      securityGroups: [],
    });
    const repository = ecr.Repository.fromRepositoryAttributes(
      this,
      "Repository",
      {
        repositoryName,
        repositoryArn: this.formatArn({
          service: "ecr",
          resource: "repository",
          resourceName: repositoryName,
          arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
        }),
      },
    );
    const alarmTopic = sns.Topic.fromTopicArn(
      this,
      "AlarmTopic",
      inputs.alarmTopicArn,
    );
    const alarmAction = new cwActions.SnsAction(alarmTopic);

    const appLogGroup = new logs.LogGroup(this, "AppLogs", {
      retention: logs.RetentionDays.ONE_MONTH,
    });
    const auditLogGroup = new logs.LogGroup(this, "AuditLogs", {
      logGroupName: `${prefix}/audit`,
      retention: logs.RetentionDays.THIRTEEN_MONTHS,
      encryptionKey: key,
    });

    const taskDefinition = addDashboardTask(this, {
      inputs,
      tableName,
      tableArn,
      keyArn,
      repository,
      appLogGroup,
    });

    const taskSecurityGroup = new ec2.SecurityGroup(this, "TaskSg", {
      vpc,
      description: "LLM Usage Lens dashboard tasks",
    });
    const service = new ecs.FargateService(this, "Service", {
      cluster,
      taskDefinition,
      desiredCount,
      assignPublicIp: false,
      vpcSubnets: { subnets: vpc.privateSubnets },
      securityGroups: [taskSecurityGroup],
      circuitBreaker: { enable: true, rollback: true },
      minHealthyPercent: 100,
    });

    addDashboardIngress(this, {
      inputs,
      vpc,
      service,
      taskSecurityGroup,
      alarmAction,
    });
    addDashboardAlarms(this, {
      env: inputs.env,
      clusterName,
      service,
      desiredCount,
      appLogGroup,
      auditLogGroup,
      alarmAction,
    });
    addCiDeployRole(this, { inputs, service, repository });
  }
}
