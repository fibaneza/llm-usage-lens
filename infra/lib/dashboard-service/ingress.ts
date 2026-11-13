import { Duration } from "aws-cdk-lib";
import type { Stack } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import type * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import type * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";

import { CONTAINER_PORT } from "./task";
import type { AppInputs } from "../inputs";

// Source: docs/specs/2026-11-10-platform.md — "Load balancer", "Operations".

const HEALTH_PATH = "/api/health";

export type DashboardIngressProps = {
  inputs: AppInputs;
  vpc: ec2.IVpc;
  service: ecs.FargateService;
  taskSecurityGroup: ec2.SecurityGroup;
  alarmAction: cwActions.SnsAction;
};

// The target group, and either a host rule on the shared ALB (`import`) or a
// dedicated internal ALB with its own alarms (`create`).
export function addDashboardIngress(
  stack: Stack,
  props: DashboardIngressProps,
): void {
  const { inputs, vpc, service, taskSecurityGroup, alarmAction } = props;

  const targetGroup = new elbv2.ApplicationTargetGroup(stack, "TargetGroup", {
    vpc,
    port: CONTAINER_PORT,
    protocol: elbv2.ApplicationProtocol.HTTP,
    targetType: elbv2.TargetType.IP,
    targets: [service],
    healthCheck: { path: HEALTH_PATH },
  });

  const lb = inputs.loadBalancer;
  if (lb.mode === "import") {
    const albSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
      stack,
      "AlbSg",
      lb.albSecurityGroupId,
    );
    const listener =
      elbv2.ApplicationListener.fromApplicationListenerAttributes(
        stack,
        "Listener",
        { listenerArn: lb.listenerArn, securityGroup: albSecurityGroup },
      );
    new elbv2.ApplicationListenerRule(stack, "HostRule", {
      listener,
      priority: lb.listenerRulePriority,
      conditions: [
        elbv2.ListenerCondition.hostHeaders([inputs.dashboardHostname]),
      ],
      action: elbv2.ListenerAction.forward([targetGroup]),
    });
    taskSecurityGroup.addIngressRule(
      albSecurityGroup,
      ec2.Port.tcp(CONTAINER_PORT),
      "Container port from the shared ALB",
    );
    return;
  }

  const albSecurityGroup = new ec2.SecurityGroup(stack, "AlbSg", {
    vpc,
    description: "LLM Usage Lens internal ALB",
    allowAllOutbound: false,
  });
  for (const cidr of lb.companyCidrs) {
    albSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(cidr),
      ec2.Port.tcp(443),
      "HTTPS from the company network",
    );
  }
  const alb = new elbv2.ApplicationLoadBalancer(stack, "Alb", {
    vpc,
    internetFacing: false,
    vpcSubnets: { subnets: vpc.privateSubnets },
    securityGroup: albSecurityGroup,
  });
  alb.addListener("Https", {
    port: 443,
    protocol: elbv2.ApplicationProtocol.HTTPS,
    certificates: [elbv2.ListenerCertificate.fromArn(inputs.certificateArn)],
    sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
    open: false,
    defaultTargetGroups: [targetGroup],
  });
  taskSecurityGroup.addIngressRule(
    albSecurityGroup,
    ec2.Port.tcp(CONTAINER_PORT),
    "Container port from the internal ALB",
  );
  const notify = (alarm: cloudwatch.Alarm) => alarm.addAlarmAction(alarmAction);
  notify(
    new cloudwatch.Alarm(stack, "UnhealthyHostsAlarm", {
      metric: targetGroup.metrics.unhealthyHostCount(),
      threshold: 1,
      evaluationPeriods: 3,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }),
  );
  notify(
    new cloudwatch.Alarm(stack, "Target5xxAlarm", {
      metric: targetGroup.metrics.httpCodeTarget(
        elbv2.HttpCodeTarget.TARGET_5XX_COUNT,
        { statistic: "Sum", period: Duration.minutes(5) },
      ),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }),
  );
}
