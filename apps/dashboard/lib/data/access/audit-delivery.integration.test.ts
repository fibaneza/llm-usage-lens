import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { clearTable, ensureTestTable } from "@/test/test-support";

vi.mock("@/lib/dynamodb", () =>
  import("./access-test-support").then((m) => m.faultyDynamodb()),
);
const cw = vi.hoisted(() => ({
  send: vi.fn(),
  inputs: [] as Array<{ kind: string; input: Record<string, unknown> }>,
}));
vi.mock("@aws-sdk/client-cloudwatch-logs", () => {
  class CloudWatchLogsClient {
    send = cw.send;
  }
  const command = (kind: string) =>
    class {
      readonly kind = kind;
      constructor(readonly input: Record<string, unknown>) {
        cw.inputs.push({ kind, input });
      }
    };
  return {
    CloudWatchLogsClient,
    PutLogEventsCommand: command("PutLogEvents"),
    CreateLogStreamCommand: command("CreateLogStream"),
  };
});
const envMock = vi.hoisted(() => ({
  env: { AUDIT_LOG_GROUP_NAME: undefined as string | undefined },
}));
vi.mock("@/env", async (orig) => {
  const actual = await orig<typeof import("@/env")>();
  return {
    env: new Proxy(actual.env, {
      get: (target, prop, receiver) =>
        prop === "AUDIT_LOG_GROUP_NAME"
          ? envMock.env.AUDIT_LOG_GROUP_NAME
          : Reflect.get(target, prop, receiver),
    }),
  };
});

import {
  NOW,
  OID_A,
  ctxAt,
  faults,
  ok,
  resetFaults,
} from "./access-test-support";
import { appendDeniedAudit, resetDeniedAudit } from "./audit";
import { deliverAuditLine } from "./audit-delivery";
import { createGroupMapping } from "./group-mappings";
import type { AuditRecord } from "@llm-usage-lens/shared";

// Source: docs/specs/2026-11-10-access-control.md — "Audit log" Storage (one
// JSON line per record in the KMS-encrypted CloudWatch Logs group, best-effort
// after commit; a delivery failure increments a metric that alarms), threat
// T19; contract R2 §1 decisions 12-13 (AUDIT_LOG_GROUP_NAME unset means skip;
// one stdout JSON line {"event":"audit.delivery_failed","requestId"} and
// nothing else). Delivery runs from every write path that stores a record
// (committed transactions, failed records, denied records).
const GROUP = "/llm-usage-lens/dev/audit";
const RECORD: AuditRecord = {
  actor: OID_A,
  action: "groupmap.create",
  category: "change",
  result: "success",
  target: { type: "groupmap", id: "g-1" },
  timestamp: NOW.toISOString(),
  requestId: "req-deliver",
};
const putEvents = () => cw.inputs.filter((c) => c.kind === "PutLogEvents");

let stdout: string[];
beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetFaults();
  resetDeniedAudit();
  cw.send.mockReset().mockResolvedValue({});
  cw.inputs.length = 0;
  envMock.env.AUDIT_LOG_GROUP_NAME = GROUP;
  stdout = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    stdout.push(args.map(String).join(" "));
  });
});
afterEach(() => vi.restoreAllMocks());

const failureLines = () =>
  stdout.filter((l) => l.includes("audit.delivery_failed"));

describe("deliverAuditLine", () => {
  it("puts one log event to the configured group carrying the record as JSON", async () => {
    await deliverAuditLine(RECORD);
    const events = putEvents();
    expect(events).toHaveLength(1);
    const input = events[0]?.input as {
      logGroupName: string;
      logStreamName: string;
      logEvents: Array<{ message: string; timestamp: number }>;
    };
    expect(input.logGroupName).toBe(GROUP);
    expect(input.logStreamName).toEqual(expect.any(String));
    expect(input.logEvents).toHaveLength(1);
    expect(JSON.parse(input.logEvents[0]?.message ?? "")).toMatchObject({
      actor: OID_A,
      action: "groupmap.create",
      requestId: "req-deliver",
      category: "change",
    });
    expect(input.logEvents[0]?.timestamp).toBe(NOW.getTime());
  });

  it("makes no call and prints nothing when AUDIT_LOG_GROUP_NAME is unset", async () => {
    envMock.env.AUDIT_LOG_GROUP_NAME = undefined;
    await deliverAuditLine(RECORD);
    expect(cw.send).not.toHaveBeenCalled();
    expect(failureLines()).toEqual([]);
  });

  it("on a delivery failure resolves and prints exactly one line with only event and requestId (T19)", async () => {
    cw.send.mockRejectedValue(new Error("AccessDenied: secret-detail"));
    await expect(deliverAuditLine(RECORD)).resolves.toBeUndefined();
    const lines = failureLines();
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse((lines[0] ?? "").trim()) as Record<
      string,
      unknown
    >;
    expect(parsed).toEqual({
      event: "audit.delivery_failed",
      requestId: "req-deliver",
    });
    expect(stdout.join("")).not.toContain("secret-detail");
  });
});

describe("delivery wiring", () => {
  it("a committed domain write delivers its record once, after the commit", async () => {
    ok(
      await createGroupMapping(
        {
          groupId: "g-1",
          target: { type: "team", id: "t" },
          scopedRole: "member",
        },
        ctxAt(NOW, "req-wired"),
      ),
    );
    const events = putEvents();
    expect(events).toHaveLength(1);
    const message = (
      events[0]?.input as { logEvents: Array<{ message: string }> }
    ).logEvents[0]?.message;
    expect(JSON.parse(message ?? "")).toMatchObject({
      action: "groupmap.create",
      requestId: "req-wired",
    });
  });

  it("a 409 writes no record and delivers nothing", async () => {
    const input = {
      groupId: "g-1",
      target: { type: "team", id: "t" },
      scopedRole: "member",
    } as const;
    ok(await createGroupMapping(input, ctxAt()));
    cw.inputs.length = 0;
    await createGroupMapping(input, ctxAt(NOW, "req-2"));
    expect(putEvents()).toEqual([]);
  });

  it("a failed write delivers its failed record", async () => {
    faults.transact = true;
    await expect(
      createGroupMapping(
        {
          groupId: "g-1",
          target: { type: "team", id: "t" },
          scopedRole: "member",
        },
        ctxAt(NOW, "req-fail"),
      ),
    ).rejects.toThrow();
    const events = putEvents();
    expect(events).toHaveLength(1);
    const message = (
      events[0]?.input as { logEvents: Array<{ message: string }> }
    ).logEvents[0]?.message;
    expect(JSON.parse(message ?? "")).toMatchObject({ result: "failed" });
  });

  it("a denied record is delivered", async () => {
    await appendDeniedAudit({
      actor: OID_A,
      action: "account.update",
      requestId: "req-denied",
      code: "FORBIDDEN",
      now: NOW,
    });
    expect(putEvents()).toHaveLength(1);
  });

  it("a delivery failure does not fail the committed write and prints one failure line", async () => {
    cw.send.mockRejectedValue(new Error("throttled"));
    const created = await createGroupMapping(
      {
        groupId: "g-1",
        target: { type: "team", id: "t" },
        scopedRole: "member",
      },
      ctxAt(NOW, "req-late"),
    );
    expect(created.ok).toBe(true);
    const lines = failureLines();
    expect(lines).toHaveLength(1);
    expect(JSON.parse((lines[0] ?? "").trim())).toEqual({
      event: "audit.delivery_failed",
      requestId: "req-late",
    });
  });

  it("with the group unset a committed write makes no CloudWatch call", async () => {
    envMock.env.AUDIT_LOG_GROUP_NAME = undefined;
    ok(
      await createGroupMapping(
        {
          groupId: "g-1",
          target: { type: "team", id: "t" },
          scopedRole: "member",
        },
        ctxAt(),
      ),
    );
    expect(cw.send).not.toHaveBeenCalled();
  });
});
