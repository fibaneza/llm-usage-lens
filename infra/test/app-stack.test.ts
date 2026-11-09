// @vitest-environment node
// Source: docs/specs/2026-11-10-platform.md — "Runtime", "Task role policy",
// "Ownership", "Load balancer" (import vs create), "Alarms", "CI deploy role",
// "Not created"; docs/specs/2026-11-10-access-control.md — "API routes"
// (health path). Contract: temp/run/rp-contract.md. Rule 50 (no static keys,
// least privilege).
import { GSI1_NAME } from "@llm-usage-lens/shared";
import { App } from "aws-cdk-lib";
import { Match } from "aws-cdk-lib/assertions";
import type { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { AppStack } from "../lib/app-stack";
import { parseAppInputs } from "../lib/inputs";

import {
  ACCOUNT,
  ALB_SG,
  CERT_ARN,
  CIDR,
  ENTRA_ID,
  ENTRA_ISSUER,
  HOST,
  LISTENER_ARN,
  REGION,
  TOPIC_ARN,
  actionsOf,
  contextFor,
  synthApp,
} from "./support";
import type { Mode } from "./support";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- CFN template JSON is untyped
type Stmt = {
  Effect?: string;
  Action?: unknown;
  Resource?: unknown;
  Condition?: Json;
};

const str = (v: unknown) => JSON.stringify(v);

function policyStatementsFor(t: Template, roleId: string): Stmt[] {
  const out: Stmt[] = [];
  for (const res of Object.values(t.findResources("AWS::IAM::Policy"))) {
    const props = res.Properties as Json;
    if (str(props.Roles).includes(`"${roleId}"`)) {
      out.push(...(props.PolicyDocument.Statement as Stmt[]));
    }
  }
  return out;
}

function roleIdFromTaskDef(
  t: Template,
  key: "TaskRoleArn" | "ExecutionRoleArn",
) {
  const [td] = Object.values(t.findResources("AWS::ECS::TaskDefinition"));
  const arn = (td?.Properties as Json)[key] as Json;
  return (arn["Fn::GetAtt"] as string[])[0] as string;
}

const sorted = (xs: string[]) => [...xs].sort();
const resourcesOf = (s: Stmt) =>
  Array.isArray(s.Resource) ? s.Resource : [s.Resource];

function ingressRulesFor(t: Template, sgId: string): Json[] {
  const rules: Json[] = [];
  const sg = t.toJSON().Resources[sgId] as Json;
  rules.push(
    ...((sg.Properties.SecurityGroupIngress as Json[] | undefined) ?? []),
  );
  for (const r of Object.values(
    t.findResources("AWS::EC2::SecurityGroupIngress"),
  )) {
    const p = r.Properties as Json;
    if (str(p.GroupId).includes(`"${sgId}"`)) rules.push(p);
  }
  return rules;
}

function serviceSgId(t: Template): string {
  const [svc] = Object.values(t.findResources("AWS::ECS::Service"));
  const sgs = (svc?.Properties as Json).NetworkConfiguration.AwsvpcConfiguration
    .SecurityGroups as Json[];
  return (sgs[0]?.["Fn::GetAtt"] as string[])[0] as string;
}

describe.each(["import", "create"] as Mode[])("AppStack (%s mode)", (mode) => {
  const t = synthApp(mode, "dev");

  describe("imports, never creates, shared infrastructure", () => {
    it("uses SSM parameter references for the InfraStack resources", () => {
      const params = Object.keys(t.toJSON().Parameters ?? {});
      for (const n of [
        "tablename",
        "tablearn",
        "kmskeyarn",
        "clustername",
        "repositoryname",
      ]) {
        expect(params.some((p) => p.includes("infra" + n))).toBe(true);
      }
    });

    it("creates no data-plane or topic resources", () => {
      t.resourceCountIs("AWS::DynamoDB::Table", 0);
      t.resourceCountIs("AWS::KMS::Key", 0);
      t.resourceCountIs("AWS::ECS::Cluster", 0);
      t.resourceCountIs("AWS::ECR::Repository", 0);
      t.resourceCountIs("AWS::SNS::Topic", 0);
      t.resourceCountIs("AWS::SSM::Parameter", 0);
      t.resourceCountIs("AWS::SecretsManager::Secret", 0);
    });
  });

  describe("task definition and service", () => {
    it("runs one container on port 3000 from the ECR repo at the image tag", () => {
      t.hasResourceProperties("AWS::ECS::TaskDefinition", {
        RequiresCompatibilities: ["FARGATE"],
        NetworkMode: "awsvpc",
        ContainerDefinitions: [
          Match.objectLike({
            PortMappings: [Match.objectLike({ ContainerPort: 3000 })],
          }),
        ],
      });
      const [td] = Object.values(t.findResources("AWS::ECS::TaskDefinition"));
      const image = str(
        ((td?.Properties as Json).ContainerDefinitions as Json[])[0]?.Image,
      );
      expect(image).toContain("dkr.ecr");
      expect(image).toContain("latest");
    });

    it("sets the non-secret environment", () => {
      t.hasResourceProperties("AWS::ECS::TaskDefinition", {
        ContainerDefinitions: [
          Match.objectLike({
            Environment: Match.arrayWith([
              Match.objectLike({ Name: "DYNAMODB_TABLE_NAME" }),
              { Name: "AWS_REGION", Value: "ap-southeast-2" },
              { Name: "APP_ENV", Value: "dev" },
              { Name: "NODE_ENV", Value: "production" },
              { Name: "NEXT_PUBLIC_APP_URL", Value: `https://${HOST}` },
              { Name: "AUTH_URL", Value: `https://${HOST}` },
              { Name: "AUTH_MICROSOFT_ENTRA_ID_ID", Value: ENTRA_ID },
              { Name: "AUTH_MICROSOFT_ENTRA_ID_ISSUER", Value: ENTRA_ISSUER },
            ]),
          }),
        ],
      });
    });

    it("injects exactly the two secrets from SSM and no secret as plain environment", () => {
      const [td] = Object.values(t.findResources("AWS::ECS::TaskDefinition"));
      const c = (
        (td?.Properties as Json).ContainerDefinitions as Json[]
      )[0] as Json;
      const secrets = c.Secrets as Json[];
      expect(sorted(secrets.map((s) => s.Name as string))).toEqual([
        "AUTH_MICROSOFT_ENTRA_ID_SECRET",
        "AUTH_SECRET",
      ]);
      const byName = Object.fromEntries(
        secrets.map((s) => [s.Name, str(s.ValueFrom)]),
      );
      expect(byName.AUTH_SECRET).toContain(
        "/llm-usage-lens/dev/app/auth-secret",
      );
      expect(byName.AUTH_MICROSOFT_ENTRA_ID_SECRET).toContain(
        "/llm-usage-lens/dev/app/entra-client-secret",
      );
      const envNames = (c.Environment as Json[]).map((e) => e.Name);
      expect(envNames).not.toContain("AUTH_SECRET");
      expect(envNames).not.toContain("AUTH_MICROSOFT_ENTRA_ID_SECRET");
      expect(str(c.Environment)).not.toMatch(
        /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/,
      );
    });

    it("is a plain Fargate service with no public IP and a rollback circuit breaker", () => {
      t.resourceCountIs("AWS::ECS::Service", 1);
      t.hasResourceProperties("AWS::ECS::Service", {
        LaunchType: "FARGATE",
        DesiredCount: 1,
        NetworkConfiguration: {
          AwsvpcConfiguration: Match.objectLike({ AssignPublicIp: "DISABLED" }),
        },
        DeploymentConfiguration: Match.objectLike({
          DeploymentCircuitBreaker: { Enable: true, Rollback: true },
        }),
      });
    });

    it("never drops below the desired count during a deploy", () => {
      t.hasResourceProperties("AWS::ECS::Service", {
        DeploymentConfiguration: Match.objectLike({
          MinimumHealthyPercent: 100,
        }),
      });
    });

    it("runs 2 tasks in prod", () => {
      synthApp(mode, "prod").hasResourceProperties("AWS::ECS::Service", {
        DesiredCount: 2,
      });
    });

    it("honours a custom image tag", () => {
      const stack = new AppStack(new App(), "AppTag", {
        inputs: parseAppInputs({ ...contextFor(mode), imageTag: "abc123" }),
        env: { account: ACCOUNT, region: REGION },
      });
      expect(str(Template_fromStack(stack))).toContain("abc123");
    });
  });

  describe("log groups", () => {
    it("has an app log group with retention and an audit group with 400 days under the CMK", () => {
      t.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: "/llm-usage-lens/dev/audit",
        RetentionInDays: 400,
        KmsKeyId: Match.anyValue(),
      });
      const groups = Object.values(t.findResources("AWS::Logs::LogGroup"));
      expect(groups.length).toBeGreaterThanOrEqual(2);
      for (const g of groups) {
        expect((g.Properties as Json).RetentionInDays).toBeTypeOf("number");
      }
      const audit = groups.find(
        (g) =>
          (g.Properties as Json).LogGroupName === "/llm-usage-lens/dev/audit",
      );
      expect(str((audit?.Properties as Json).KmsKeyId)).toContain("kmskeyarn");
    });
  });

  describe("task role (Task role policy)", () => {
    const stmts = policyStatementsFor(t, roleIdFromTaskDef(t, "TaskRoleArn"));

    it("has exactly the read, scoped-write and CMK statements", () => {
      expect(stmts).toHaveLength(3);
      for (const s of stmts) expect(s.Effect).toBe("Allow");
    });

    it("reads: Get/BatchGet/Query/DescribeTable on the table and the GSI1 index only", () => {
      const read = stmts.find((s) => actionsOf(s).includes("dynamodb:GetItem"));
      expect(sorted(actionsOf(read ?? {}))).toEqual(
        sorted([
          "dynamodb:GetItem",
          "dynamodb:BatchGetItem",
          "dynamodb:Query",
          "dynamodb:DescribeTable",
        ]),
      );
      const res = resourcesOf(read ?? {});
      expect(res).toHaveLength(2);
      expect(
        res.some(
          (r) => str(r).includes("tablearn") && !str(r).includes("/index/"),
        ),
      ).toBe(true);
      expect(
        res.some(
          (r) =>
            str(r).includes("tablearn") &&
            str(r).includes(`/index/${GSI1_NAME}`),
        ),
      ).toBe(true);
      expect(read?.Condition).toBeUndefined();
    });

    it("writes: only on the table, restricted to ACCT# leading keys", () => {
      const write = stmts.find((s) =>
        actionsOf(s).includes("dynamodb:PutItem"),
      );
      expect(sorted(actionsOf(write ?? {}))).toEqual(
        sorted([
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:ConditionCheckItem",
        ]),
      );
      expect(write?.Condition).toEqual({
        "ForAllValues:StringLike": { "dynamodb:LeadingKeys": ["ACCT#*"] },
      });
      const res = resourcesOf(write ?? {});
      expect(res).toHaveLength(1);
      expect(str(res[0])).not.toContain("/index/");
    });

    it("grants kms:Decrypt and GenerateDataKey on the CMK", () => {
      const kms = stmts.find((s) =>
        actionsOf(s).some((a) => a.startsWith("kms:")),
      );
      expect(sorted(actionsOf(kms ?? {}))).toEqual(
        sorted(["kms:Decrypt", "kms:GenerateDataKey"]),
      );
      expect(str(kms?.Resource)).toContain("kmskeyarn");
    });

    it("grants nothing else: no wildcards, Scan, TransactWriteItems, ssm or secretsmanager", () => {
      const all = stmts.flatMap(actionsOf);
      expect(all).not.toContain("dynamodb:Scan");
      expect(all).not.toContain("dynamodb:TransactWriteItems");
      for (const a of all) {
        expect(a).not.toMatch(/\*/);
        expect(a).not.toMatch(/^(ssm|secretsmanager|iam|s3|sts):/);
      }
      for (const s of stmts) {
        for (const r of resourcesOf(s)) expect(r).not.toBe("*");
      }
      expect(str(stmts)).not.toContain("SYSTEM");
      expect(str(stmts)).not.toContain("AUDIT#");
    });
  });

  describe("execution role", () => {
    const stmts = policyStatementsFor(
      t,
      roleIdFromTaskDef(t, "ExecutionRoleArn"),
    );

    it("reads only the two secret parameters", () => {
      const ssm = stmts.filter((s) =>
        actionsOf(s).some((a) => a.startsWith("ssm:")),
      );
      expect(ssm).toHaveLength(1);
      expect(actionsOf(ssm[0] ?? {})).toEqual(["ssm:GetParameters"]);
      const res = resourcesOf(ssm[0] ?? {});
      expect(res).toHaveLength(2);
      expect(str(res)).toContain("/llm-usage-lens/dev/app/auth-secret");
      expect(str(res)).toContain("/llm-usage-lens/dev/app/entra-client-secret");
    });

    it("decrypts with the CMK and has no wildcard SSM or broad Resource *", () => {
      const kms = stmts.find((s) => actionsOf(s).includes("kms:Decrypt"));
      expect(str(kms?.Resource)).toContain("kmskeyarn");
      for (const s of stmts) {
        for (const a of actionsOf(s)) expect(a).not.toMatch(/^ssm:\*|^\*$/);
        if (resourcesOf(s).includes("*")) {
          expect(actionsOf(s)).toEqual(["ecr:GetAuthorizationToken"]);
        }
      }
    });

    it("can pull from ECR and write logs", () => {
      const all = stmts.flatMap(actionsOf);
      expect(all).toEqual(
        expect.arrayContaining([
          "ecr:GetAuthorizationToken",
          "ecr:BatchGetImage",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]),
      );
    });
  });

  describe("network", () => {
    it("task security group admits only 3000/tcp from the ALB security group", () => {
      const rules = ingressRulesFor(t, serviceSgId(t));
      expect(rules.length).toBeGreaterThanOrEqual(1);
      for (const r of rules) {
        expect(r.IpProtocol).toBe("tcp");
        expect(r.FromPort).toBe(3000);
        expect(r.ToPort).toBe(3000);
        expect(r.CidrIp).toBeUndefined();
        expect(r.CidrIpv6).toBeUndefined();
        expect(r.SourceSecurityGroupId).toBeDefined();
      }
      if (mode === "import") {
        expect(rules.every((r) => r.SourceSecurityGroupId === ALB_SG)).toBe(
          true,
        );
      }
    });

    it("has no world-open ingress anywhere (egress is deliberately unrestricted)", () => {
      const resources = t.toJSON().Resources as Record<string, Json>;
      const ingress: Json[] = [];
      for (const r of Object.values(resources)) {
        if (r.Type === "AWS::EC2::SecurityGroupIngress") {
          ingress.push(r.Properties as Json);
        }
        if (r.Type === "AWS::EC2::SecurityGroup") {
          ingress.push(
            ...((r.Properties.SecurityGroupIngress as Json[]) ?? []),
          );
        }
      }
      expect(ingress.length).toBeGreaterThan(0);
      for (const rule of ingress) {
        expect(rule.CidrIp).not.toBe("0.0.0.0/0");
        expect(rule.CidrIpv6).not.toBe("::/0");
      }
    });

    it("target group is ip/HTTP 3000 with the /api/health check", () => {
      t.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
        TargetType: "ip",
        Port: 3000,
        Protocol: "HTTP",
        HealthCheckPath: "/api/health",
      });
    });
  });

  describe("alarms", () => {
    const alarms = Object.values(t.findResources("AWS::CloudWatch::Alarm")).map(
      (a) => a.Properties as Json,
    );

    it("has the four platform alarms and every one notifies the existing topic", () => {
      expect(alarms.length).toBeGreaterThanOrEqual(4);
      for (const a of alarms) {
        expect(a.AlarmActions).toContain(TOPIC_ARN);
      }
    });

    it("alarms when running tasks fall below desired (Container Insights)", () => {
      const running = alarms.find(
        (a) =>
          a.Namespace === "ECS/ContainerInsights" &&
          a.MetricName === "RunningTaskCount",
      );
      expect(running).toBeDefined();
      expect(running?.ComparisonOperator).toBe("LessThanThreshold");
      expect(running?.Threshold).toBe(1);
    });

    it("alarms on prod desired count of 2", () => {
      const prod = Object.values(
        synthApp(mode, "prod").findResources("AWS::CloudWatch::Alarm"),
      ).map((a) => a.Properties as Json);
      const running = prod.find((a) => a.MetricName === "RunningTaskCount");
      expect(running?.Threshold).toBe(2);
    });

    it("has metric filters on the app log group (5xx) and the audit log group (security events), each alarmed", () => {
      const filters = Object.values(
        t.findResources("AWS::Logs::MetricFilter"),
      ).map((f) => f.Properties as Json);
      expect(filters).toHaveLength(2);
      const groups = filters.map((f) => str(f.LogGroupName));
      expect(new Set(groups).size).toBe(2);
      const logGroups = t.findResources("AWS::Logs::LogGroup");
      const auditId = Object.keys(logGroups).find(
        (id) =>
          (logGroups[id]?.Properties as Json).LogGroupName ===
          "/llm-usage-lens/dev/audit",
      );
      expect(auditId).toBeDefined();
      expect(filters.some((f) => f.LogGroupName?.Ref === auditId)).toBe(true);
      for (const f of filters) expect(typeof f.LogGroupName).toBe("object");
      for (const f of filters) {
        const mt = (f.MetricTransformations as Json[])[0] as Json;
        expect(
          alarms.some(
            (a) =>
              a.MetricName === mt.MetricName &&
              a.Namespace === mt.MetricNamespace,
          ),
        ).toBe(true);
      }
    });

    it("alarms on tasks that fail to start or keep restarting (PendingTaskCount)", () => {
      const pending = alarms.find(
        (a) =>
          a.Namespace === "ECS/ContainerInsights" &&
          a.MetricName === "PendingTaskCount",
      );
      expect(pending).toBeDefined();
      expect(pending?.AlarmActions).toContain(TOPIC_ARN);
    });
  });

  describe("CI deploy role (GitHub OIDC)", () => {
    const roles = Object.entries(t.findResources("AWS::IAM::Role")).filter(
      ([, r]) =>
        str((r.Properties as Json).AssumeRolePolicyDocument).includes(
          "AssumeRoleWithWebIdentity",
        ),
    );

    it("exists exactly once", () => {
      expect(roles).toHaveLength(1);
    });

    it("trusts the existing GitHub OIDC provider, scoped to the repo, audience sts", () => {
      const doc = (roles[0]?.[1].Properties as Json)
        .AssumeRolePolicyDocument as Json;
      const [s] = doc.Statement as Json[];
      expect(s?.Action).toBe("sts:AssumeRoleWithWebIdentity");
      expect(str(s?.Principal.Federated)).toContain(
        "oidc-provider/token.actions.githubusercontent.com",
      );
      expect(str(s?.Principal.Federated)).toContain(ACCOUNT);
      expect(
        s?.Condition.StringEquals["token.actions.githubusercontent.com:aud"],
      ).toBe("sts.amazonaws.com");
      const key = "token.actions.githubusercontent.com:sub";
      const sub =
        s?.Condition.StringEquals?.[key] ?? s?.Condition.StringLike?.[key];
      expect(sub).toBe("repo:example-org/llm-usage-lens:environment:dev");
      expect(String(sub)).not.toContain("*");
      t.resourceCountIs("AWS::IAM::OIDCProvider", 0);
    });

    it("can push images, update the service, deploy its stack and assume CDK roles", () => {
      const stmts = policyStatementsFor(t, roles[0]?.[0] ?? "");
      const all = stmts.flatMap(actionsOf);
      expect(all).toEqual(
        expect.arrayContaining([
          "ecr:GetAuthorizationToken",
          "ecr:PutImage",
          "ecs:UpdateService",
          "ecs:DescribeServices",
          "sts:AssumeRole",
        ]),
      );
      expect(all.some((a) => a.startsWith("cloudformation:"))).toBe(true);
    });

    it("scopes ECR push actions to the dashboard repository only", () => {
      const stmts = policyStatementsFor(t, roles[0]?.[0] ?? "");
      const ecr = stmts.filter((x) =>
        actionsOf(x).some(
          (a) => a.startsWith("ecr:") && a !== "ecr:GetAuthorizationToken",
        ),
      );
      expect(ecr.length).toBeGreaterThanOrEqual(1);
      for (const x of ecr) {
        expect(actionsOf(x)).not.toContain("ecr:GetAuthorizationToken");
        for (const r of resourcesOf(x)) {
          expect(r).not.toBe("*");
          expect(str(r)).not.toContain("repository/*");
          expect(str(r)).toContain("repositoryname");
        }
      }
    });

    it("can never read secrets or escalate", () => {
      const stmts = policyStatementsFor(t, roles[0]?.[0] ?? "");
      for (const a of stmts.flatMap(actionsOf)) {
        expect(a).not.toMatch(/^ssm:(Get|\*)/);
        expect(a).not.toMatch(/^secretsmanager:/);
        expect(a).not.toMatch(/^kms:(Decrypt|\*)/);
        expect(a).not.toMatch(/^iam:\*/);
        expect(a).not.toBe("*");
      }
      for (const s of stmts) {
        if (resourcesOf(s).includes("*")) {
          expect(actionsOf(s)).toEqual(["ecr:GetAuthorizationToken"]);
        }
      }
      expect(str(stmts)).not.toMatch(/\/llm-usage-lens\/[a-z]+\/app\//);
    });
  });
});

describe("AppStack import mode - shared ALB", () => {
  const t = synthApp("import");

  it("creates no load balancer, listener or listener certificate", () => {
    t.resourceCountIs("AWS::ElasticLoadBalancingV2::LoadBalancer", 0);
    t.resourceCountIs("AWS::ElasticLoadBalancingV2::Listener", 0);
    t.resourceCountIs("AWS::ElasticLoadBalancingV2::ListenerCertificate", 0);
  });

  it("adds exactly one host-header rule on the existing listener", () => {
    t.resourceCountIs("AWS::ElasticLoadBalancingV2::ListenerRule", 1);
    t.hasResourceProperties("AWS::ElasticLoadBalancingV2::ListenerRule", {
      ListenerArn: LISTENER_ARN,
      Priority: 100,
      Conditions: [
        Match.objectLike({
          Field: "host-header",
          HostHeaderConfig: { Values: [HOST] },
        }),
      ],
      Actions: [Match.objectLike({ Type: "forward" })],
    });
  });

  it("creates no ALB-namespace alarm", () => {
    for (const a of Object.values(t.findResources("AWS::CloudWatch::Alarm"))) {
      expect((a.Properties as Json).Namespace).not.toBe("AWS/ApplicationELB");
    }
  });

  it("admits the container port from the supplied ALB security group", () => {
    const rules = ingressRulesFor(t, serviceSgId(t));
    expect(
      rules.some(
        (r) => r.SourceSecurityGroupId === ALB_SG && r.FromPort === 3000,
      ),
    ).toBe(true);
  });
});

describe("AppStack create mode - own internal ALB", () => {
  const t = synthApp("create");

  it("creates one internal load balancer in the imported subnets", () => {
    t.resourceCountIs("AWS::ElasticLoadBalancingV2::LoadBalancer", 1);
    t.hasResourceProperties("AWS::ElasticLoadBalancingV2::LoadBalancer", {
      Scheme: "internal",
      Subnets: ["subnet-00000000000000001", "subnet-00000000000000002"],
    });
  });

  it("has a single HTTPS 443 listener with the imported certificate and TLS 1.2+ policy", () => {
    t.resourceCountIs("AWS::ElasticLoadBalancingV2::Listener", 1);
    t.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
      Protocol: "HTTPS",
      Port: 443,
      Certificates: [{ CertificateArn: CERT_ARN }],
      SslPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06",
      DefaultActions: Match.anyValue(),
    });
    t.resourceCountIs("AWS::ElasticLoadBalancingV2::ListenerRule", 0);
  });

  it("ALB security group admits 443 from the company CIDR only", () => {
    const lb = Object.values(
      t.findResources("AWS::ElasticLoadBalancingV2::LoadBalancer"),
    )[0];
    const sgRef = (
      (lb?.Properties as Json).SecurityGroups as Json[]
    )[0] as Json;
    const sgId = (sgRef["Fn::GetAtt"] as string[])[0] as string;
    const rules = ingressRulesFor(t, sgId);
    expect(rules.length).toBeGreaterThanOrEqual(1);
    for (const r of rules) {
      expect(r.CidrIp).toBe(CIDR);
      expect(r.FromPort).toBe(443);
      expect(r.ToPort).toBe(443);
      expect(r.CidrIpv6).toBeUndefined();
    }
  });

  it("alarms on unhealthy hosts and target 5xx", () => {
    const alarms = Object.values(t.findResources("AWS::CloudWatch::Alarm")).map(
      (a) => a.Properties as Json,
    );
    for (const metric of ["UnHealthyHostCount", "HTTPCode_Target_5XX_Count"]) {
      const a = alarms.find(
        (x) => x.Namespace === "AWS/ApplicationELB" && x.MetricName === metric,
      );
      expect(a, metric).toBeDefined();
      expect(a?.AlarmActions).toContain(TOPIC_ARN);
    }
  });
});

function Template_fromStack(stack: AppStack): unknown {
  return App.of(stack)?.synth().getStackArtifact(stack.artifactId).template;
}
