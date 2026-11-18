import "server-only";

import { randomUUID } from "node:crypto";

import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { NotificationSchema } from "@llm-usage-lens/shared";
import type { Notification, NotificationKind } from "@llm-usage-lens/shared";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";

import { decodeCursor, encodeCursor } from "./access/cursor";
import type { AccessResult, ListOptions, Page } from "./access/result";
import { notifPk, notifSk } from "./notifications-keys";

// Source: docs/specs/2026-05-15-data-model.md — "Budget reset entities (unit
// M4)" (Notification, Access patterns); LiteLLM spec MG-D13; Access Control
// BR4/BR8 (a notification stores ids only). Never cached (Rule 60.10).
const TTL_SECONDS = 90 * 86_400;
const BATCH_SIZE = 25;
const MAX_RETRIES = 3;
const DEFAULT_LIMIT = 20;

export type NewNotification = {
  recipientOid: string;
  kind: NotificationKind;
  requestId: string;
  teamId: string;
};

type PutRequest = { PutRequest: { Item: Record<string, unknown> } };

function toPutRequest(entry: NewNotification, now: Date): PutRequest {
  const createdAt = now.toISOString();
  const notificationId = randomUUID();
  return {
    PutRequest: {
      Item: {
        PK: notifPk(entry.recipientOid),
        SK: notifSk(createdAt, notificationId),
        notificationId,
        recipientOid: entry.recipientOid,
        kind: entry.kind,
        requestId: entry.requestId,
        teamId: entry.teamId,
        createdAt,
        expiresAt: Math.floor(now.getTime() / 1000) + TTL_SECONDS,
      },
    },
  };
}

export async function createNotifications(
  entries: readonly NewNotification[],
  now: Date,
): Promise<void> {
  const table = getTableName();
  const puts = entries.map((entry) => toPutRequest(entry, now));
  for (let i = 0; i < puts.length; i += BATCH_SIZE) {
    let pending: PutRequest[] = puts.slice(i, i + BATCH_SIZE);
    for (let attempt = 0; pending.length > 0; attempt += 1) {
      if (attempt > MAX_RETRIES) {
        throw new Error("notifications could not be written");
      }
      const res = await getDocumentClient().send(
        new BatchWriteCommand({ RequestItems: { [table]: pending } }),
      );
      pending = (res.UnprocessedItems?.[table] ?? []) as PutRequest[];
    }
  }
}

function toNotification(item: Record<string, unknown>): Notification {
  return NotificationSchema.parse({
    notificationId: item.notificationId,
    recipientOid: item.recipientOid,
    kind: item.kind,
    requestId: item.requestId,
    teamId: item.teamId,
    createdAt: item.createdAt,
    readAt: item.readAt ?? null,
  });
}

export async function listNotifications(
  oid: string,
  options: ListOptions,
): Promise<AccessResult<Page<Notification>>> {
  const partition = notifPk(oid);
  let startKey: Record<string, string> | undefined;
  if (options.cursor !== undefined) {
    const decoded = decodeCursor(options.cursor, options.cursorSecret);
    if (!decoded.ok || decoded.value.PK !== partition) {
      return { ok: false, code: "BAD_CURSOR" };
    }
    startKey = decoded.value;
  }
  const res = await getDocumentClient().send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": partition },
      ScanIndexForward: false,
      Limit: Math.min(
        DEFAULT_LIMIT,
        Math.max(1, Math.floor(options.limit ?? DEFAULT_LIMIT)),
      ),
      ExclusiveStartKey: startKey,
    }),
  );
  const items = (res.Items ?? []).map(toNotification);
  const last = res.LastEvaluatedKey;
  if (!last) return { ok: true, value: { items } };
  const key: Record<string, string> = {};
  for (const [k, v] of Object.entries(last)) {
    if (typeof v !== "string") throw new Error(`non-string key attribute ${k}`);
    key[k] = v;
  }
  return {
    ok: true,
    value: { items, cursor: encodeCursor(key, options.cursorSecret) },
  };
}

async function* unreadKeyPages(oid: string): AsyncGenerator<string[]> {
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await getDocumentClient().send(
      new QueryCommand({
        TableName: getTableName(),
        KeyConditionExpression: "PK = :pk",
        FilterExpression: "attribute_not_exists(readAt)",
        ExpressionAttributeValues: { ":pk": notifPk(oid) },
        ProjectionExpression: "SK",
        ExclusiveStartKey: startKey,
      }),
    );
    yield (res.Items ?? []).map((item) => String(item.SK));
    startKey = res.LastEvaluatedKey;
  } while (startKey);
}

export async function countUnread(oid: string): Promise<number> {
  let total = 0;
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await getDocumentClient().send(
      new QueryCommand({
        TableName: getTableName(),
        KeyConditionExpression: "PK = :pk",
        FilterExpression: "attribute_not_exists(readAt)",
        ExpressionAttributeValues: { ":pk": notifPk(oid) },
        Select: "COUNT",
        ExclusiveStartKey: startKey,
      }),
    );
    total += res.Count ?? 0;
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return total;
}

// The key always carries the caller's PK, so another person's item is out of
// reach; a missing, foreign or already-read id counts 0 and is not an error.
async function markOne(oid: string, sk: string, now: Date): Promise<number> {
  try {
    await getDocumentClient().send(
      new UpdateCommand({
        TableName: getTableName(),
        Key: { PK: notifPk(oid), SK: sk },
        UpdateExpression: "SET readAt = :now",
        ConditionExpression:
          "attribute_exists(PK) AND attribute_not_exists(readAt)",
        ExpressionAttributeValues: { ":now": now.toISOString() },
      }),
    );
    return 1;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return 0;
    throw error;
  }
}

export async function markNotificationsRead(
  oid: string,
  target: { ids: readonly string[] } | { all: true },
  now: Date,
): Promise<number> {
  let updated = 0;
  if ("ids" in target) {
    for (const id of target.ids) updated += await markOne(oid, id, now);
    return updated;
  }
  for await (const keys of unreadKeyPages(oid)) {
    for (const sk of keys) updated += await markOne(oid, sk, now);
  }
  return updated;
}
