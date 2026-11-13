// @vitest-environment node
// Source: docs/specs/2026-11-10-platform.md — "Task-role policy" table and
// "Operations" alarms; docs/specs/2026-11-10-access-control.md — Audit log,
// threats T19 (append-only audit, never SYSTEM) and T20 (security alarm).
// Contract R2 decisions 12-14 and §6. Placeholder ids only (Rule 50.9).
import { describe, expect, it } from "vitest";

import { actionsOf, synthApp } from "./support";
import type { Mode } from "./support";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- CFN template JSON is untyped

const WRITE_PREFIXES = [
  "ACCT#*",
  "GOVERNANCE",
  "GROUPMAP#*",
  "IDENT#*",
  "LOCALUSER#*",
  "PENDING#*",
  "SETUPLINK#*",
  "SSOEXPECT#*",
  "SSOREF#*",
  "USAGEKEY#*",
  "VIS#*",
];
const DDB_WRITES = [
  "dynamodb:PutItem",
  "dynamodb:UpdateItem",
  "dynamodb:DeleteItem",
  "dynamodb:ConditionCheckItem",
];

function statements(t: ReturnType<typeof synthApp>): Json[] {
  return Object.values(t.findResources("AWS::IAM::Policy")).flatMap(
    (r) => (r.Properties as Json).PolicyDocument.Statement as Json[],
  );
}
const leadingKeys = (st: Json): string[] =>
  [].concat(
    st.Condition?.["ForAllValues:StringLike"]?.["dynamodb:LeadingKeys"] ?? [],
  );
const writeStatements = (t: ReturnType<typeof synthApp>) =>
  statements(t).filter((st) =>
    actionsOf(st).some((a) => DDB_WRITES.includes(a)),
  );
const isAudit = (st: Json) => leadingKeys(st).includes("AUDIT#*");

describe.each<Mode>(["import", "create"])(
  "DashboardServiceStack audit (%s)",
  (mode) => {
    const t = synthApp(mode, "dev");

    it("T19: the write statement is limited to exactly the eleven key prefixes (Platform — Task role policy)", () => {
      const write = writeStatements(t).filter((st) => !isAudit(st));
      expect(write).toHaveLength(1);
      expect([...leadingKeys(write[0] as Json)].sort()).toEqual(WRITE_PREFIXES);
      expect(actionsOf(write[0] as Json).sort()).toEqual(
        [...DDB_WRITES].sort(),
      );
    });

    it("T19: no write statement exists without a LeadingKeys condition, and none reaches SYSTEM", () => {
      for (const st of writeStatements(t)) {
        expect(leadingKeys(st).length).toBeGreaterThan(0);
        for (const key of leadingKeys(st)) {
          expect(key).not.toMatch(/^(SYSTEM|\*)/);
        }
      }
    });

    it("T19: AUDIT#* is PutItem only on the table", () => {
      const audit = writeStatements(t).filter(isAudit);
      expect(audit).toHaveLength(1);
      expect(actionsOf(audit[0] as Json)).toEqual(["dynamodb:PutItem"]);
      expect(leadingKeys(audit[0] as Json)).toEqual(["AUDIT#*"]);
    });

    it("T19: no statement grants UpdateItem or DeleteItem on AUDIT#", () => {
      for (const st of statements(t)) {
        if (!isAudit(st)) continue;
        expect(actionsOf(st)).not.toContain("dynamodb:UpdateItem");
        expect(actionsOf(st)).not.toContain("dynamodb:DeleteItem");
      }
    });

    it("T19: the logs actions are limited to the audit log group", () => {
      const logGroups = t.findResources("AWS::Logs::LogGroup");
      const byName = (suffix: string) =>
        Object.entries(logGroups).find(([, r]) =>
          String((r.Properties as Json).LogGroupName).endsWith(suffix),
        )?.[0] as string;
      const auditId = byName("/audit");
      expect(auditId).toBeTruthy();
      const logs = statements(t).filter((st) =>
        actionsOf(st).some((a) => a === "logs:PutLogEvents"),
      );
      const taskLogs = logs.filter((st) =>
        JSON.stringify(st.Resource).includes(auditId),
      );
      expect(taskLogs).toHaveLength(1);
      expect(actionsOf(taskLogs[0] as Json).sort()).toEqual([
        "logs:CreateLogStream",
        "logs:PutLogEvents",
      ]);
      const other = Object.keys(logGroups).filter((id) => id !== auditId);
      for (const id of other) {
        expect(JSON.stringify(taskLogs[0]?.Resource)).not.toContain(id);
      }
    });

    it("the task environment carries AUDIT_LOG_GROUP_NAME", () => {
      const [td] = Object.values(t.findResources("AWS::ECS::TaskDefinition"));
      const container = (
        (td?.Properties as Json).ContainerDefinitions as Json[]
      )[0] as Json;
      const env = (container.Environment as Json[]).find(
        (e) => e.Name === "AUDIT_LOG_GROUP_NAME",
      );
      expect(env).toBeDefined();
      expect(JSON.stringify(env?.Value)).toContain("/llm-usage-lens/dev/audit");
    });

    it("T20: keeps the SecurityEventsFilter on $.category", () => {
      const filters = Object.values(t.findResources("AWS::Logs::MetricFilter"));
      const security = filters.find(
        (f) =>
          (f.Properties as Json).MetricTransformations[0].MetricName ===
          "SecurityEvents",
      );
      expect(String((security?.Properties as Json).FilterPattern)).toContain(
        "$.category",
      );
    });

    it("has an AuditDeliveryFailures metric filter on the app log group", () => {
      const filters = Object.values(t.findResources("AWS::Logs::MetricFilter"));
      const filter = filters.find(
        (f) =>
          (f.Properties as Json).MetricTransformations[0].MetricName ===
          "AuditDeliveryFailures",
      );
      expect(filter).toBeDefined();
      const props = filter?.Properties as Json;
      expect(String(props.FilterPattern)).toContain("audit.delivery_failed");
      expect(props.MetricTransformations[0].MetricNamespace).toBe(
        "LlmUsageLens/dev",
      );
      expect(JSON.stringify(props.LogGroupName)).not.toContain("audit");
    });

    it("has an AuditDeliveryAlarm wired to the alarm topic", () => {
      const alarm = Object.values(
        t.findResources("AWS::CloudWatch::Alarm"),
      ).find(
        (a) => (a.Properties as Json).MetricName === "AuditDeliveryFailures",
      );
      expect(alarm).toBeDefined();
      const props = alarm?.Properties as Json;
      expect(props.Namespace).toBe("LlmUsageLens/dev");
      expect(props.Threshold).toBe(1);
      expect(props.ComparisonOperator).toBe("GreaterThanOrEqualToThreshold");
      expect(props.TreatMissingData).toBe("notBreaching");
      expect(props.AlarmActions).toHaveLength(1);
    });
  },
);
