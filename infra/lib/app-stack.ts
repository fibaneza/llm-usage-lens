import { ArnFormat, Duration, Stack } from "aws-cdk-lib";
import type { StackProps } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import { COLLECTOR_REGION, GSI1_NAME } from "@llm-usage-lens/shared";

import { ssmPrefix } from "./inputs";
import type { AppInputs } from "./inputs";

// Source: docs/specs/2026-11-10-platform.md — "Load balancer", "Created
// resources" (AppStack), "Runtime", "Task role policy", "Operations".

const CONTAINER_PORT = 3000;
const HEALTH_PATH = "/api/health";

// An SSM parameter injected as a container secret. The execution-role grant is
// written explicitly in the stack (ssm:GetParameters only), so the CDK helper's
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

export type AppStackProps = StackProps & { inputs: AppInputs };

export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);
    const { inputs } = props;
    const prefix = ssmPrefix(inputs.env);
    const prod = inputs.env === "prod";
    const desiredCount = prod ? 2 : 1;

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
    const subnets = { subnets: vpc.privateSubnets };
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
    const auditLogGroupName = `${prefix}/audit`;
    const auditLogGroup = new logs.LogGroup(this, "AuditLogs", {
      logGroupName: auditLogGroupName,
      retention: logs.RetentionDays.THIRTEEN_MONTHS,
      encryptionKey: key,
    });

    const secretArn = (name: string) =>
      this.formatArn({
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
      this.formatArn({
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
    const taskRole = new iam.Role(this, "TaskRole", {
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

    const taskDefinition = new ecs.FargateTaskDefinition(this, "TaskDef", {
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

    const taskSecurityGroup = new ec2.SecurityGroup(this, "TaskSg", {
      vpc,
      description: "LLM Usage Lens dashboard tasks",
    });
    const service = new ecs.FargateService(this, "Service", {
      cluster,
      taskDefinition,
      desiredCount,
      assignPublicIp: false,
      vpcSubnets: subnets,
      securityGroups: [taskSecurityGroup],
      circuitBreaker: { enable: true, rollback: true },
      minHealthyPercent: 100,
    });

    const targetGroup = new elbv2.ApplicationTargetGroup(this, "TargetGroup", {
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
        this,
        "AlbSg",
        lb.albSecurityGroupId,
      );
      const listener =
        elbv2.ApplicationListener.fromApplicationListenerAttributes(
          this,
          "Listener",
          { listenerArn: lb.listenerArn, securityGroup: albSecurityGroup },
        );
      new elbv2.ApplicationListenerRule(this, "HostRule", {
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
    } else {
      const albSecurityGroup = new ec2.SecurityGroup(this, "AlbSg", {
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
      const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
        vpc,
        internetFacing: false,
        vpcSubnets: subnets,
        securityGroup: albSecurityGroup,
      });
      alb.addListener("Https", {
        port: 443,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        certificates: [
          elbv2.ListenerCertificate.fromArn(inputs.certificateArn),
        ],
        sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
        open: false,
        defaultTargetGroups: [targetGroup],
      });
      taskSecurityGroup.addIngressRule(
        albSecurityGroup,
        ec2.Port.tcp(CONTAINER_PORT),
        "Container port from the internal ALB",
      );
      const notify = (alarm: cloudwatch.Alarm) =>
        alarm.addAlarmAction(alarmAction);
      notify(
        new cloudwatch.Alarm(this, "UnhealthyHostsAlarm", {
          metric: targetGroup.metrics.unhealthyHostCount(),
          threshold: 1,
          evaluationPeriods: 3,
          comparisonOperator:
            cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        }),
      );
      notify(
        new cloudwatch.Alarm(this, "Target5xxAlarm", {
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

    // Alarms common to both modes (Platform spec — "Operations").
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
    const addAlarm = (alarmId: string, props: cloudwatch.AlarmProps) => {
      new cloudwatch.Alarm(this, alarmId, props).addAlarmAction(alarmAction);
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

    const metricNamespace = `LlmUsageLens/${inputs.env}`;
    appLogGroup.addMetricFilter("App5xxFilter", {
      filterPattern: logs.FilterPattern.numberValue("$.status", ">=", 500),
      metricNamespace,
      metricName: "Application5xx",
      metricValue: "1",
    });
    auditLogGroup.addMetricFilter("SecurityEventsFilter", {
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

    this.addCiDeployRole(inputs, service, repository);
  }

  private addCiDeployRole(
    inputs: AppInputs,
    service: ecs.FargateService,
    repository: ecr.IRepository,
  ) {
    const provider = `arn:${this.partition}:iam::${inputs.account}:oidc-provider/token.actions.githubusercontent.com`;
    const role = new iam.Role(this, "CiDeployRole", {
      assumedBy: new iam.WebIdentityPrincipal(provider, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          // The deploy job runs in the GitHub environment named after the
          // deploy env, so a branch or PR workflow cannot assume the role.
          "token.actions.githubusercontent.com:sub": `repo:${inputs.githubRepository}:environment:${inputs.env}`,
        },
      }),
      maxSessionDuration: Duration.hours(1),
    });
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecr:GetAuthorizationToken"],
        resources: ["*"],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "ecr:BatchCheckLayerAvailability",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
        ],
        resources: [repository.repositoryArn],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecs:UpdateService", "ecs:DescribeServices"],
        resources: [service.serviceArn],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "cloudformation:CreateChangeSet",
          "cloudformation:DescribeChangeSet",
          "cloudformation:ExecuteChangeSet",
          "cloudformation:DeleteChangeSet",
          "cloudformation:DescribeStacks",
          "cloudformation:DescribeStackEvents",
          "cloudformation:GetTemplate",
        ],
        resources: [this.stackId],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: ["deploy", "file-publishing", "image-publishing"].map(
          (kind) =>
            `arn:${this.partition}:iam::${inputs.account}:role/cdk-hnb659fds-${kind}-role-${inputs.account}-${COLLECTOR_REGION}`,
        ),
      }),
    );
  }
}
