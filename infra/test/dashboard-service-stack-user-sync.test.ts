// Source: docs/specs/2026-11-10-platform.md - Inputs (litellmUserSyncSchedule),
// Created resources (SYNC2 row), Scheduled job - LiteLLM user sync, Task role
// policy (Scheduler role), Operations (scheduled sync alerts); Access Control
// spec - Tests table T-SY8 and threat T-SY8. Rule 50.4 (no secret in the job).
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";

import { DashboardServiceStack } from "../lib/dashboard-service-stack";
import { parseAppInputs } from "../lib/inputs";
import { ACCOUNT, REGION, TOPIC_ARN, contextFor } from "./support";
import type { Mode } from "./support";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- CFN template JSON is untyped
const str = (v: unknown) => JSON.stringify(v);

const CRON = "cron(0 18 * * ? *)";

function synth(mode: Mode, schedule?: string): Template {
  const app = new App();
  const context: Record<string, unknown> = contextFor(mode, "dev");
  if (schedule !== undefined) context.litellmUserSyncSchedule = schedule;
  const stack = new DashboardServiceStack(app, "App", {
    inputs: parseAppInputs(context),
    env: { account: ACCOUNT, region: REGION },
  });
  return Template.fromStack(stack);
}

function scheduleOf(t: Template): Json {
  const found = Object.values(t.findResources("AWS::Scheduler::Schedule"));
  expect(found).toHaveLength(1);
  return (found[0] as Json).Properties as Json;
}

function schedulerRole(t: Template): { id: string; role: Json } {
  const hit = Object.entries(t.findResources("AWS::IAM::Role")).find(([, r]) =>
    str((r.Properties as Json).AssumeRolePolicyDocument).includes(
      "scheduler.amazonaws.com",
    ),
  );
  expect(hit).toBeDefined();
  const [id, res] = hit as [string, Json];
  return { id, role: res.Properties as Json };
}

function statementsFor(t: Template, roleId: string): Json[] {
  const out: Json[] = [];
  for (const res of Object.values(t.findResources("AWS::IAM::Policy"))) {
    const p = res.Properties as Json;
    if (!str(p.Roles).includes(`"${roleId}"`)) continue;
    out.push(...(p.PolicyDocument.Statement as Json[]));
  }
  return out;
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [v]);

describe.each(["import", "create"] as Mode[])(
  "DashboardServiceStack LiteLLM user sync schedule (%s)",
  (mode) => {
    describe("input absent or off - Platform Inputs: no schedule, no scheduler role, no rule, no alarm; no default", () => {
      const baseline = synth(mode);

      it.each([
        ["off", "off"],
        ["absent", undefined],
      ])("creates nothing extra when %s", (_label, value) => {
        const t = synth(mode, value);
        expect(Object.keys(t.toJSON().Resources).sort()).toEqual(
          Object.keys(baseline.toJSON().Resources).sort(),
        );
        t.resourceCountIs("AWS::Scheduler::Schedule", 0);
        // review sync2 r1 B1: no rule, so no rule-ARN output either
        expect(Object.keys(t.toJSON().Outputs ?? {}).sort()).toEqual(
          Object.keys(baseline.toJSON().Outputs ?? {}).sort(),
        );
      });

      it("the baseline has no scheduler role", () => {
        expect(str(baseline.findResources("AWS::IAM::Role"))).not.toContain(
          "scheduler.amazonaws.com",
        );
      });
    });

    describe("input set - Platform Created resources (SYNC2 row)", () => {
      const baseline = synth(mode);
      const t = synth(mode, CRON);
      let sched: Json;
      let taskDef: Json;
      beforeAll(() => {
        sched = scheduleOf(t);
        const [td] = Object.values(t.findResources("AWS::ECS::TaskDefinition"));
        taskDef = (td as Json).Properties as Json;
      });

      it("one schedule with the given expression and the flexible time window off", () => {
        expect(sched.ScheduleExpression).toBe(CRON);
        expect(sched.FlexibleTimeWindow).toEqual({ Mode: "OFF" });
      });

      it("targets ECS RunTask on the dashboard cluster and this task definition, private, no public IP", () => {
        const target = sched.Target as Json;
        const ecsParams = target.EcsParameters as Json;
        // Platform - Scheduler role: the cluster is the dashboard cluster, an SSM-parameter
        // Ref whose logical id carries "infraclustername" (no hyphen; see dashboard-service-stack.test.ts)
        expect(str(target.Arn)).toContain("clustername");
        expect(ecsParams.LaunchType).toBe("FARGATE");
        expect(ecsParams.TaskCount ?? 1).toBe(1);
        expect(str(ecsParams.TaskDefinitionArn)).toContain("TaskDef");
        const vpc = (ecsParams.NetworkConfiguration as Json)
          .AwsvpcConfiguration as Json;
        expect(vpc.AssignPublicIp).toBe("DISABLED");
        expect(str(vpc.Subnets)).toContain("subnet-00000000000000001");
        expect(str(vpc.Subnets)).toContain("subnet-00000000000000002");
        expect(str(vpc.SecurityGroups)).toContain("TaskSg");
      });

      it("overrides the command to run the bundle and puts no secret or credential in it", () => {
        const target = sched.Target as Json;
        const input = str(target.Input);
        const containerName = (taskDef.ContainerDefinitions as Json[])[0]
          ?.Name as string;
        expect(input).toContain(containerName);
        expect(input).toContain("node");
        expect(input).toContain("apps/dashboard/jobs/sync-litellm-users.cjs");
        for (const word of [
          "KEY",
          "SECRET",
          "TOKEN",
          "PASSWORD",
          "AWS_ACCESS",
        ]) {
          expect(input.toUpperCase()).not.toContain(word);
        }
      });

      it("retries at most 2 times and drops an event older than 1 hour (V10)", () => {
        expect((sched.Target as Json).RetryPolicy).toEqual({
          MaximumRetryAttempts: 2,
          MaximumEventAgeInSeconds: 3600,
        });
      });

      it("scheduler role trust is scheduler.amazonaws.com limited by aws:SourceAccount (V12)", () => {
        const { role } = schedulerRole(t);
        const stmts = (role.AssumeRolePolicyDocument as Json)
          .Statement as Json[];
        expect(stmts).toHaveLength(1);
        const s = stmts[0] as Json;
        expect(s.Action).toBe("sts:AssumeRole");
        expect(s.Principal).toEqual({ Service: "scheduler.amazonaws.com" });
        expect(s.Condition.StringEquals["aws:SourceAccount"]).toBeDefined();
        expect(str(s.Condition)).toContain(ACCOUNT);
      });

      it("scheduler role trust also has ArnLike aws:SourceArn on this account's default-group schedules (V12; review sync2 r1 W1)", () => {
        const { role } = schedulerRole(t);
        const s = (
          (role.AssumeRolePolicyDocument as Json).Statement as Json[]
        )[0] as Json;
        const arnLike = s.Condition.ArnLike as Json | undefined;
        expect(arnLike).toBeDefined();
        const sourceArn = str((arnLike as Json)["aws:SourceArn"]);
        expect(sourceArn).toContain("scheduler");
        expect(sourceArn).toContain(":schedule/default/*");
        expect(sourceArn).toContain(ACCOUNT);
        expect(sourceArn).toContain(REGION);
        expect(s.Condition.StringEquals["aws:SourceAccount"]).toBeDefined();
      });

      it("the failed-run rule's ARN is a stack output for the topic policy (Platform - Operations; review sync2 r1 B1)", () => {
        const rules = t.findResources("AWS::Events::Rule");
        const [ruleId] = Object.entries(rules).find(([, r]) =>
          str((r.Properties as Json).EventPattern).includes(
            "ECS Task State Change",
          ),
        ) as [string, Json];
        const outputs = Object.values(
          (t.toJSON().Outputs ?? {}) as Record<string, Json>,
        ).filter((o) => {
          const v = o.Value as Json;
          return (
            v?.["Fn::GetAtt"]?.[0] === ruleId &&
            v?.["Fn::GetAtt"]?.[1] === "Arn"
          );
        });
        expect(outputs).toHaveLength(1);
      });

      it("scheduler role has exactly two statements: RunTask on the family with the cluster condition, and PassRole to ecs-tasks", () => {
        const { id } = schedulerRole(t);
        const stmts = statementsFor(t, id);
        expect(stmts).toHaveLength(2);
        const run = stmts.find((s) =>
          asArray(s.Action).includes("ecs:RunTask"),
        );
        const pass = stmts.find((s) =>
          asArray(s.Action).includes("iam:PassRole"),
        );
        expect(run).toBeDefined();
        expect(pass).toBeDefined();
        expect(run?.Effect).toBe("Allow");
        expect(asArray(run?.Action)).toEqual(["ecs:RunTask"]);
        // family ARN: any revision, so a new revision needs no policy change
        expect(str(run?.Resource)).toContain(":task-definition/");
        expect(str(run?.Resource)).toMatch(/:\*"/);
        expect(str(run?.Condition)).toContain("ecs:cluster");
        // Platform - Scheduler role: RunTask only on the dashboard cluster (ecs:cluster condition)
        expect(str(run?.Condition)).toContain("clustername");

        expect(pass?.Effect).toBe("Allow");
        expect(asArray(pass?.Action)).toEqual(["iam:PassRole"]);
        expect(pass?.Condition).toEqual({
          StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" },
        });
        const resources = asArray(pass?.Resource);
        expect(resources).toHaveLength(2);
        const taskRole = str(taskDef.TaskRoleArn);
        const execRole = str(taskDef.ExecutionRoleArn);
        expect(resources.map(str).sort()).toEqual([execRole, taskRole].sort());
      });

      it("the task role is unchanged by the schedule (Platform: adds no permission to the data)", () => {
        const [baseTd] = Object.values(
          baseline.findResources("AWS::ECS::TaskDefinition"),
        );
        const roleOf = (tpl: Template, def: Json) => {
          const id = (def.Properties.TaskRoleArn["Fn::GetAtt"] as string[])[0];
          const out: Json[] = [];
          for (const r of Object.values(
            tpl.findResources("AWS::IAM::Policy"),
          )) {
            const p = r.Properties as Json;
            if (str(p.Roles).includes(`"${id}"`))
              out.push(...(p.PolicyDocument.Statement as Json[]));
          }
          return out;
        };
        expect(roleOf(t, { Properties: taskDef })).toEqual(
          roleOf(baseline, baseTd as Json),
        );
      });

      it("an EventBridge rule on this job's ECS task state change publishes to the alarm topic (V11)", () => {
        const rules = Object.values(t.findResources("AWS::Events::Rule")).map(
          (r) => r.Properties as Json,
        );
        const rule = rules.find((r) =>
          str(r.EventPattern).includes("ECS Task State Change"),
        );
        expect(rule).toBeDefined();
        const pattern = str(rule?.EventPattern);
        expect(pattern).toContain("aws.ecs");
        expect(pattern).toContain("STOPPED");
        expect(pattern).toContain("exitCode");
        expect(pattern).toMatch(/stopCode|FailedToStart/);
        expect(pattern).toContain("TaskDef");
        const targets = rule?.Targets as Json[];
        expect(targets).toHaveLength(1);
        expect(targets[0]?.Arn).toBe(TOPIC_ARN);
      });

      it("a missing-run alarm on the job's success line: 2 days, missing data breaching, action on the topic (V11)", () => {
        const before = new Set(
          Object.keys(baseline.findResources("AWS::Logs::MetricFilter")),
        );
        const added = Object.entries(
          t.findResources("AWS::Logs::MetricFilter"),
        ).filter(([id]) => !before.has(id));
        expect(added).toHaveLength(1);
        const filter = (added[0] as [string, Json])[1].Properties as Json;
        expect(String(filter.FilterPattern).length).toBeGreaterThan(0);
        const metricName = (filter.MetricTransformations as Json[])[0]
          ?.MetricName as string;

        const alarms = Object.values(
          t.findResources("AWS::CloudWatch::Alarm"),
        ).filter((a) => (a.Properties as Json).MetricName === metricName);
        expect(alarms).toHaveLength(1);
        const alarm = (alarms[0] as Json).Properties as Json;
        expect(alarm.TreatMissingData).toBe("breaching");
        expect(alarm.ComparisonOperator).toBe("LessThanThreshold");
        expect(alarm.Threshold).toBe(1);
        expect(alarm.Period * alarm.EvaluationPeriods).toBe(2 * 24 * 3600);
        expect(str(alarm.AlarmActions)).toContain(TOPIC_ARN);
      });

      it("adds no resource besides the schedule, role, policy, rule, filter and alarm", () => {
        const before = new Set(Object.keys(baseline.toJSON().Resources));
        const added = Object.entries(t.toJSON().Resources as Json)
          .filter(([id]) => !before.has(id))
          .map(([, r]) => (r as Json).Type as string);
        const allowed = new Set([
          "AWS::Scheduler::Schedule",
          "AWS::IAM::Role",
          "AWS::IAM::Policy",
          "AWS::Events::Rule",
          "AWS::Logs::MetricFilter",
          "AWS::CloudWatch::Alarm",
        ]);
        expect(added.filter((type) => !allowed.has(type))).toEqual([]);
      });
    });
  },
);
