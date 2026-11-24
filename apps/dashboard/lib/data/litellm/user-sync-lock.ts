import "server-only";

import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";

import { LITELLM_USERSYNC_LOCK_SK, LITELLM_USERSYNC_PK } from "./keys";

// Source: docs/specs/2026-11-10-litellm.md - "Data model additions"
// (UserSyncLock at LITELLM#USERSYNC / LOCK; review change V3) and Access
// Control - "LiteLLM user sync", Preview and apply (T-SY5). A lease of 5
// minutes: taken when absent or when `leaseUntil` has passed, renewed with a
// condition on the owner before each batch, released by its owner with a
// conditional delete. The caller passes the time (Rule 60.24).
export const USER_SYNC_LEASE_MS = 5 * 60_000;
// `expiresAt` is for clean-up only: the takeover is by the condition, never by
// TTL removal. One hour past the lease.
const CLEANUP_GRACE_S = 3600;

const key = { PK: LITELLM_USERSYNC_PK, SK: LITELLM_USERSYNC_LOCK_SK };

const leaseEnd = (now: Date): { leaseUntil: string; expiresAt: number } => {
  const until = now.getTime() + USER_SYNC_LEASE_MS;
  return {
    leaseUntil: new Date(until).toISOString(),
    expiresAt: Math.ceil(until / 1000) + CLEANUP_GRACE_S,
  };
};

export async function acquireUserSyncLease(
  runId: string,
  now: Date,
): Promise<{ owner: string; leaseUntil: string } | null> {
  const { leaseUntil, expiresAt } = leaseEnd(now);
  try {
    await getDocumentClient().send(
      new PutCommand({
        TableName: getTableName(),
        Item: { ...key, owner: runId, leaseUntil, expiresAt },
        ConditionExpression: "attribute_not_exists(PK) OR leaseUntil < :now",
        ExpressionAttributeValues: { ":now": now.toISOString() },
      }),
    );
    return { owner: runId, leaseUntil };
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return null;
    throw error;
  }
}

// False: the lease is lost (another run took it, or it is gone) and the run
// must stop.
export async function renewUserSyncLease(
  runId: string,
  now: Date,
): Promise<boolean> {
  const { leaseUntil, expiresAt } = leaseEnd(now);
  try {
    await getDocumentClient().send(
      new UpdateCommand({
        TableName: getTableName(),
        Key: key,
        UpdateExpression: "SET leaseUntil = :u, expiresAt = :e",
        ConditionExpression: "#owner = :o",
        ExpressionAttributeNames: { "#owner": "owner" },
        ExpressionAttributeValues: {
          ":u": leaseUntil,
          ":e": expiresAt,
          ":o": runId,
        },
      }),
    );
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return false;
    throw error;
  }
}

export async function releaseUserSyncLease(runId: string): Promise<void> {
  try {
    await getDocumentClient().send(
      new DeleteCommand({
        TableName: getTableName(),
        Key: key,
        ConditionExpression: "#owner = :o",
        ExpressionAttributeNames: { "#owner": "owner" },
        ExpressionAttributeValues: { ":o": runId },
      }),
    );
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return;
    throw error;
  }
}
