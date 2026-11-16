import "server-only";

import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";

import type { SignedInIdentity } from "@/lib/auth/master-user";

// Source: docs/specs/2026-11-10-access-control.md — "Data model additions"
// (Identity row), "Sign-in methods" (lockout), "Threat model" T20.

const LOCK_AFTER_FAILURES = 5;
const LOCK_MS = 15 * 60_000;

const key = (oid: string) => ({ PK: `IDENT#${oid}`, SK: "META" });

export async function upsertIdentity(
  identity: SignedInIdentity,
  now: Date,
): Promise<void> {
  const email = identity.email?.toLowerCase();
  const upn = identity.upn?.toLowerCase();
  const names: Record<string, string> = {
    "#oid": "oid",
    "#tid": "tid",
    "#lsa": "lastSignInAt",
    "#lsr": "lastSeenRoles",
    "#am": "authMethod",
    "#g1pk": "gsi1pk",
    "#g1sk": "gsi1sk",
    "#v": "version",
  };
  const values: Record<string, unknown> = {
    ":oid": identity.oid,
    ":tid": identity.tid,
    ":lsa": now.toISOString(),
    ":lsr": identity.roles,
    ":am": identity.authMethod,
    ":g1pk": "IDENTS",
    ":g1sk": `IDENT#${identity.oid}`,
    ":one": 1,
    ":zero": 0,
  };
  const sets = [
    "#oid = :oid",
    "#tid = :tid",
    "#lsa = :lsa",
    "#lsr = :lsr",
    "#am = :am",
    "#g1pk = :g1pk",
    "#g1sk = :g1sk",
    "#v = if_not_exists(#v, :zero) + :one",
  ];
  const removes: string[] = [];
  for (const [attr, val] of [
    ["email", email],
    ["upn", upn],
    ["displayName", identity.displayName],
  ] as const) {
    if (val === undefined) {
      names[`#${attr}`] = attr;
      removes.push(`#${attr}`);
    } else {
      names[`#${attr}`] = attr;
      values[`:${attr}`] = val;
      sets.push(`#${attr} = :${attr}`);
    }
  }
  const isLocal = identity.authMethod === "local";
  try {
    await getDocumentClient().send(
      new UpdateCommand({
        TableName: getTableName(),
        Key: key(identity.oid),
        UpdateExpression: `SET ${sets.join(", ")}${removes.length ? ` REMOVE ${removes.join(", ")}` : ""}`,
        ...(isLocal
          ? { ConditionExpression: "attribute_not_exists(PK) OR #am = :am" }
          : {}),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
  } catch (error) {
    if (!isLocal || !(error instanceof ConditionalCheckFailedException)) {
      throw error;
    }
    // Dev login as a stored identity (Access Control spec - Dev login): the
    // record keeps its own provenance; only the sign-in time moves.
    await getDocumentClient().send(
      new UpdateCommand({
        TableName: getTableName(),
        Key: key(identity.oid),
        UpdateExpression:
          "SET #lsa = :lsa, #v = if_not_exists(#v, :zero) + :one",
        ExpressionAttributeNames: { "#lsa": "lastSignInAt", "#v": "version" },
        ExpressionAttributeValues: {
          ":lsa": now.toISOString(),
          ":zero": 0,
          ":one": 1,
        },
      }),
    );
  }
}

export type MasterReservation = { allowed: boolean; lockedNow: boolean };

// One attempt is reserved atomically before the password is verified, so
// concurrent guesses cannot exceed the limit (Threat model T20).
export async function reserveMasterAttempt(
  oid: string,
  now: Date,
): Promise<MasterReservation> {
  const doc = getDocumentClient();
  const nowIso = now.toISOString();
  const reserve = () =>
    doc.send(
      new UpdateCommand({
        TableName: getTableName(),
        Key: key(oid),
        UpdateExpression: "ADD failedAttempts :one",
        ConditionExpression:
          "(attribute_not_exists(lockedUntil) OR lockedUntil <= :now) AND (attribute_not_exists(failedAttempts) OR failedAttempts < :limit)",
        ExpressionAttributeValues: {
          ":one": 1,
          ":now": nowIso,
          ":limit": LOCK_AFTER_FAILURES,
        },
        ReturnValues: "UPDATED_NEW",
      }),
    );
  let added;
  try {
    added = await reserve();
  } catch (error) {
    if (!(error instanceof ConditionalCheckFailedException)) throw error;
    const cleared = await clearExpiredLock(oid, nowIso);
    if (!cleared) {
      await repairMissingLock(oid, now);
      return { allowed: false, lockedNow: false };
    }
    try {
      added = await reserve();
    } catch (retryError) {
      if (!(retryError instanceof ConditionalCheckFailedException)) {
        throw retryError;
      }
      return { allowed: false, lockedNow: false };
    }
  }
  if (Number(added.Attributes?.failedAttempts ?? 0) < LOCK_AFTER_FAILURES) {
    return { allowed: true, lockedNow: false };
  }
  try {
    await doc.send(
      new UpdateCommand({
        TableName: getTableName(),
        Key: key(oid),
        UpdateExpression: "SET lockedUntil = :until",
        ConditionExpression:
          "failedAttempts = :limit AND attribute_not_exists(lockedUntil)",
        ExpressionAttributeValues: {
          ":until": new Date(now.getTime() + LOCK_MS).toISOString(),
          ":limit": LOCK_AFTER_FAILURES,
        },
      }),
    );
    return { allowed: true, lockedNow: true };
  } catch (error) {
    if (!(error instanceof ConditionalCheckFailedException)) throw error;
    return { allowed: true, lockedNow: false };
  }
}

// A fifth failure whose lock write never landed would otherwise lock out forever (T20).
async function repairMissingLock(oid: string, now: Date): Promise<void> {
  try {
    await getDocumentClient().send(
      new UpdateCommand({
        TableName: getTableName(),
        Key: key(oid),
        UpdateExpression: "SET lockedUntil = :until",
        ConditionExpression:
          "attribute_not_exists(lockedUntil) AND failedAttempts >= :limit",
        ExpressionAttributeValues: {
          ":until": new Date(now.getTime() + LOCK_MS).toISOString(),
          ":limit": LOCK_AFTER_FAILURES,
        },
      }),
    );
  } catch (error) {
    if (!(error instanceof ConditionalCheckFailedException)) throw error;
  }
}

async function clearExpiredLock(oid: string, nowIso: string): Promise<boolean> {
  try {
    await getDocumentClient().send(
      new UpdateCommand({
        TableName: getTableName(),
        Key: key(oid),
        UpdateExpression: "REMOVE lockedUntil SET failedAttempts = :zero",
        ConditionExpression: "lockedUntil <= :now",
        ExpressionAttributeValues: { ":zero": 0, ":now": nowIso },
      }),
    );
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return false;
    throw error;
  }
}

export async function resetMasterFailures(oid: string): Promise<void> {
  try {
    await getDocumentClient().send(
      new UpdateCommand({
        TableName: getTableName(),
        Key: key(oid),
        UpdateExpression: "REMOVE failedAttempts, lockedUntil",
        ConditionExpression: "attribute_exists(PK)",
      }),
    );
  } catch (error) {
    // No item yet means nothing to reset (the master has never failed).
    if (!(error instanceof ConditionalCheckFailedException)) throw error;
  }
}
