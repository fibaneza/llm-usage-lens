import { CfnOutput, Duration, Stack } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import type * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import type * as ec2 from "aws-cdk-lib/aws-ec2";
import type * as ecs from "aws-cdk-lib/aws-ecs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import type * as sns from "aws-cdk-lib/aws-sns";

import type { AppInputs } from "../inputs";

// Source: docs/specs/2026-11-10-platform.md - "Scheduled job - LiteLLM user
// sync", "Scheduler role", "Operations" (unit SYNC2). The job runs the same
// task definition as the web container with a command override; the override
// carries no secret (Rule 50.4, 50.6).

export const USER_SYNC_COMMAND = [
  "node",
  "apps/dashboard/jobs/sync-litellm-users.cjs",
];
// The job's fixed structured success line (Platform - Exit and deadline).
export const USER_SYNC_SUCCESS_EVENT = "litellm_user_sync.completed";

export type UserSyncScheduleProps = {
  inputs: AppInputs;
  expression: string;
  clusterName: string;
  taskDefinition: ecs.FargateTaskDefinition;
  taskSecurityGroup: ec2.ISecurityGroup;
  privateSubnetIds: string[];
  appLogGroup: logs.LogGroup;
  alarmTopic: sns.ITopic;
  alarmAction: cwActions.SnsAction;
};

export function addUserSyncSchedule(
  stack: Stack,
  props: UserSyncScheduleProps,
): void {
  const { taskDefinition, clusterName } = props;
  const clusterArn = stack.formatArn({
    service: "ecs",
    resource: "cluster",
    resourceName: clusterName,
  });
  const family = taskDefinition.family;
  const familyArn = stack.formatArn({
    service: "ecs",
    resource: "task-definition",
    resourceName: `${family}:*`,
  });

  const role = new iam.Role(stack, "UserSyncSchedulerRole", {
    assumedBy: new iam.PrincipalWithConditions(
      new iam.ServicePrincipal("scheduler.amazonaws.com"),
      {
        StringEquals: { "aws:SourceAccount": stack.account },
        // V12: only this account's default-group schedules (Platform - Scheduler role)
        ArnLike: {
          "aws:SourceArn": `arn:${stack.partition}:scheduler:${stack.region}:${stack.account}:schedule/default/*`,
        },
      },
    ),
  });
  role.addToPolicy(
    new iam.PolicyStatement({
      actions: ["ecs:RunTask"],
      resources: [familyArn],
      conditions: { ArnEquals: { "ecs:cluster": clusterArn } },
    }),
  );
  role.addToPolicy(
    new iam.PolicyStatement({
      actions: ["iam:PassRole"],
      resources: [
        taskDefinition.taskRole.roleArn,
        taskDefinition.obtainExecutionRole().roleArn,
      ],
      conditions: {
        StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" },
      },
    }),
  );

  new scheduler.CfnSchedule(stack, "UserSyncSchedule", {
    scheduleExpression: props.expression,
    flexibleTimeWindow: { mode: "OFF" },
    target: {
      arn: clusterArn,
      roleArn: role.roleArn,
      retryPolicy: { maximumRetryAttempts: 2, maximumEventAgeInSeconds: 3600 },
      input: JSON.stringify({
        containerOverrides: [
          {
            name: taskDefinition.defaultContainer?.containerName ?? "web",
            command: USER_SYNC_COMMAND,
          },
        ],
      }),
      ecsParameters: {
        taskDefinitionArn: taskDefinition.taskDefinitionArn,
        taskCount: 1,
        launchType: "FARGATE",
        networkConfiguration: {
          awsvpcConfiguration: {
            assignPublicIp: "DISABLED",
            subnets: props.privateSubnetIds,
            securityGroups: [props.taskSecurityGroup.securityGroupId],
          },
        },
      },
    },
  });

  // V11: stopped non-zero or failed to start, for this task definition only.
  // The web service's tasks share the definition, so the rule also matches a
  // web task that exits non-zero, which is an alert worth having.
  const failedRule = new events.Rule(stack, "UserSyncFailedRule", {
    eventPattern: {
      source: ["aws.ecs"],
      detailType: ["ECS Task State Change"],
      detail: {
        taskDefinitionArn: [{ prefix: familyArn.replace(/:\*$/, ":") }],
        lastStatus: ["STOPPED"],
        $or: [
          { containers: { exitCode: [{ "anything-but": 0 }] } },
          { stopCode: ["TaskFailedToStart"] },
        ],
      },
    },
    targets: [new targets.SnsTopic(props.alarmTopic)],
  });
  // CDK cannot attach a policy to an imported topic: the operator adds the
  // events.amazonaws.com publish statement conditioned on this ARN (Platform
  // - Inputs, alarmTopicArn; agent decision 2026-11-24).
  new CfnOutput(stack, "UserSyncFailedRuleArn", {
    value: failedRule.ruleArn,
  });

  const metricNamespace = `LlmUsageLens/${props.inputs.env}`;
  props.appLogGroup.addMetricFilter("UserSyncSuccessFilter", {
    filterPattern: logs.FilterPattern.stringValue(
      "$.event",
      "=",
      USER_SYNC_SUCCESS_EVENT,
    ),
    metricNamespace,
    metricName: "LiteLLMUserSyncSuccess",
    metricValue: "1",
  });
  new cloudwatch.Alarm(stack, "UserSyncMissingRunAlarm", {
    metric: new cloudwatch.Metric({
      namespace: metricNamespace,
      metricName: "LiteLLMUserSyncSuccess",
      statistic: "Sum",
      period: Duration.days(1),
    }),
    threshold: 1,
    evaluationPeriods: 2,
    comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    treatMissingData: cloudwatch.TreatMissingData.BREACHING,
  }).addAlarmAction(props.alarmAction);
}
