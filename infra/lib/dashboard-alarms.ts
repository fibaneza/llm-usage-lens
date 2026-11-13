import { Duration } from "aws-cdk-lib";
import type { Stack } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import type * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import type * as ecs from "aws-cdk-lib/aws-ecs";
import * as logs from "aws-cdk-lib/aws-logs";

import type { AppInputs } from "./inputs";

// Source: docs/specs/2026-11-10-platform.md — "Operations".

export type DashboardAlarmsProps = {
  env: AppInputs["env"];
  clusterName: string;
  service: ecs.FargateService;
  desiredCount: number;
  appLogGroup: logs.LogGroup;
  auditLogGroup: logs.LogGroup;
  alarmAction: cwActions.SnsAction;
};

// Service alarms common to both load-balancer modes, plus the log metric
// filters that feed the application-5xx and security-event alarms.
export function addDashboardAlarms(
  stack: Stack,
  props: DashboardAlarmsProps,
): void {
  const { clusterName, service, desiredCount, alarmAction } = props;

  const insightsMetric = (metricName: string) =>
    new cloudwatch.Metric({
      namespace: "ECS/ContainerInsights",
      metricName,
      dimensionsMap: {
        ClusterName: clusterName,
        ServiceName: service.serviceName,
      },
      statistic: "Minimum",
      period: Duration.minutes(1),
    });
  const addAlarm = (alarmId: string, alarmProps: cloudwatch.AlarmProps) => {
    new cloudwatch.Alarm(stack, alarmId, alarmProps).addAlarmAction(
      alarmAction,
    );
  };
  addAlarm("RunningTasksAlarm", {
    metric: insightsMetric("RunningTaskCount"),
    threshold: desiredCount,
    evaluationPeriods: 3,
    comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    treatMissingData: cloudwatch.TreatMissingData.BREACHING,
  });
  // Replacement tasks that keep failing to start sit in PENDING.
  addAlarm("PendingTasksAlarm", {
    metric: insightsMetric("PendingTaskCount"),
    threshold: 1,
    evaluationPeriods: 5,
    comparisonOperator:
      cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  });

  const metricNamespace = `LlmUsageLens/${props.env}`;
  props.appLogGroup.addMetricFilter("App5xxFilter", {
    filterPattern: logs.FilterPattern.numberValue("$.status", ">=", 500),
    metricNamespace,
    metricName: "Application5xx",
    metricValue: "1",
  });
  props.auditLogGroup.addMetricFilter("SecurityEventsFilter", {
    filterPattern: logs.FilterPattern.stringValue(
      "$.category",
      "=",
      "security",
    ),
    metricNamespace,
    metricName: "SecurityEvents",
    metricValue: "1",
  });
  for (const [alarmId, metricName] of [
    ["App5xxAlarm", "Application5xx"],
    ["SecurityEventsAlarm", "SecurityEvents"],
  ] as const) {
    addAlarm(alarmId, {
      metric: new cloudwatch.Metric({
        namespace: metricNamespace,
        metricName,
        statistic: "Sum",
        period: Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  }
}
