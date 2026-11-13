import "server-only";

import { randomUUID } from "node:crypto";

import {
  CloudWatchLogsClient,
  CreateLogStreamCommand,
  PutLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { sanitizeAuditSnapshot } from "@llm-usage-lens/shared";
import type { AuditRecord } from "@llm-usage-lens/shared";

import { env } from "@/env";

// Source: docs/specs/2026-11-10-access-control.md — "Audit log" Storage (one
// JSON line per record in the KMS-encrypted CloudWatch Logs group, best-effort
// after the commit) and threat T19; Platform spec — task role
// (`logs:CreateLogStream`, `logs:PutLogEvents` on the audit group only). A
// delivery failure prints one stdout line that the metric filter counts; the
// line carries the request id only (Rule 50.6).
let client: CloudWatchLogsClient | undefined;
let stream: { name: string; ready: Promise<void> } | undefined;

function ensureStream(logGroupName: string): {
  name: string;
  ready: Promise<void>;
} {
  if (stream) return stream;
  const name = `dashboard-${randomUUID()}`;
  client ??= new CloudWatchLogsClient({ region: env.AWS_REGION });
  const ready = client
    .send(new CreateLogStreamCommand({ logGroupName, logStreamName: name }))
    .then(() => undefined);
  const created = { name, ready };
  stream = created;
  // A failed create must not poison later deliveries.
  ready.catch(() => {
    if (stream === created) stream = undefined;
  });
  return created;
}

export async function deliverAuditLine(record: AuditRecord): Promise<void> {
  const logGroupName = env.AUDIT_LOG_GROUP_NAME;
  if (!logGroupName) return;
  try {
    const { name, ready } = ensureStream(logGroupName);
    await ready;
    const message = JSON.stringify({
      ...record,
      before: sanitizeAuditSnapshot(record.before),
      after: sanitizeAuditSnapshot(record.after),
    });
    client ??= new CloudWatchLogsClient({ region: env.AWS_REGION });
    await client.send(
      new PutLogEventsCommand({
        logGroupName,
        logStreamName: name,
        logEvents: [{ message, timestamp: Date.parse(record.timestamp) }],
      }),
    );
  } catch {
    process.stdout.write(
      `${JSON.stringify({ event: "audit.delivery_failed", requestId: record.requestId })}\n`,
    );
  }
}
