import "server-only";

import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";

import { OWNER_SK, identPk, setupLinkPk } from "./keys";
import { userKey } from "./password-users";
import type { AccessResult, AuditContext } from "./result";
import { commitAudited, getItem } from "./store";

// Source: docs/specs/2026-11-10-access-control.md — "Password users" (Setup
// D22, Passwords, TOTP D23, Sign-in lockout), threats T23, T24, T27. The only
// module that reads or writes a password hash, a TOTP secret ciphertext or a
// setup-token hash; lib/auth calls these and never sees a key or an item.
const LOCK_AFTER_FAILURES = 5;
const LOCK_MS = 15 * 60_000;

export type PasswordCredential = {
  email: string;
  oid: string;
  displayName: string;
  status: "enabled" | "disabled" | "sso-bound";
  passwordHash?: string;
  totpCipher?: string;
  totpLastStep?: number;
  // Spec - Password users, Credential version (D29): absent reads as 0.
  credentialVersion: number;
  selfChangeSignedInAt?: number;
};

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

function toCredential(item: Record<string, unknown>): PasswordCredential {
  const passwordHash = str(item.passwordHash);
  const totpCipher = str(item.totpCipher);
  return {
    email: String(item.email),
    oid: String(item.oid),
    displayName: String(item.displayName),
    status: item.status as PasswordCredential["status"],
    ...(passwordHash ? { passwordHash } : {}),
    ...(totpCipher ? { totpCipher } : {}),
    ...(typeof item.totpLastStep === "number"
      ? { totpLastStep: item.totpLastStep }
      : {}),
    credentialVersion:
      typeof item.credentialVersion === "number" ? item.credentialVersion : 0,
    ...(typeof item.selfChangeSignedInAt === "number"
      ? { selfChangeSignedInAt: item.selfChangeSignedInAt }
      : {}),
  };
}

export async function getPasswordCredential(
  email: string,
): Promise<PasswordCredential | null> {
  const key = userKey(email);
  const item = await getItem(key.PK, key.SK);
  return item ? toCredential(item) : null;
}

export type SetupLink = PasswordCredential & { expiresAt: string };

// A token hash resolves to its user only while the user still holds that hash
// (a reset or delete invalidates the older link, T24).
export async function findSetupLink(
  tokenHash: string,
): Promise<SetupLink | null> {
  const link = await getItem(setupLinkPk(tokenHash), OWNER_SK);
  const email = str(link?.email);
  if (!email) return null;
  const key = userKey(email);
  const item = await getItem(key.PK, key.SK);
  const expiresAt = str(item?.setupExpiresAt);
  if (!item || item.setupTokenHash !== tokenHash || !expiresAt) return null;
  return { ...toCredential(item), expiresAt };
}

export async function completePasswordSetupWrite(
  input: {
    email: string;
    tokenHash: string;
    passwordHash: string;
    totp?: { cipher: string; step: number };
  },
  ctx: AuditContext,
): Promise<AccessResult<void>> {
  const result = await commitAudited({
    items: [
      {
        Update: {
          TableName: getTableName(),
          Key: userKey(input.email),
          UpdateExpression: `SET passwordHash = :p, updatedAt = :now${
            input.totp ? ", totpCipher = :c, totpLastStep = :s" : ""
          }, failedAttempts = :zero ADD version :one, credentialVersion :one REMOVE setupTokenHash, setupExpiresAt, lockedUntil, selfChangeSignedInAt`,
          ConditionExpression: "setupTokenHash = :h",
          ExpressionAttributeValues: {
            ":p": input.passwordHash,
            ":h": input.tokenHash,
            ":now": ctx.now.toISOString(),
            ":zero": 0,
            ":one": 1,
            ...(input.totp
              ? { ":c": input.totp.cipher, ":s": input.totp.step }
              : {}),
          },
        },
      },
      {
        Delete: {
          TableName: getTableName(),
          Key: { PK: setupLinkPk(input.tokenHash), SK: OWNER_SK },
          ConditionExpression: "attribute_exists(PK)",
        },
      },
    ],
    audit: {
      action: "localuser.update",
      target: { type: "identity", id: ctx.actor },
    },
    ctx,
  });
  return result.ok ? { ok: true, value: undefined } : result;
}

// Spec - Password users (Passwords): a signed-in password user changes their
// own password. The condition keeps a user disabled or bound to Entra since the
// check from being written; success also clears the failure count (Sign-in).
export async function changePasswordWrite(
  input: { email: string; passwordHash: string; signedInAt?: number },
  ctx: AuditContext,
): Promise<AccessResult<void>> {
  const result = await commitAudited({
    items: [
      {
        Update: {
          TableName: getTableName(),
          Key: userKey(input.email),
          UpdateExpression: `SET passwordHash = :p, updatedAt = :now, failedAttempts = :zero${
            input.signedInAt !== undefined
              ? ", selfChangeSignedInAt = :sia"
              : ""
          } ADD version :one, credentialVersion :one REMOVE lockedUntil${
            input.signedInAt === undefined ? ", selfChangeSignedInAt" : ""
          }`,
          ConditionExpression:
            "attribute_exists(PK) AND #s = :enabled AND attribute_exists(passwordHash)",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: {
            ":p": input.passwordHash,
            ":now": ctx.now.toISOString(),
            ":zero": 0,
            ":one": 1,
            ":enabled": "enabled",
            ...(input.signedInAt !== undefined
              ? { ":sia": input.signedInAt }
              : {}),
          },
        },
      },
    ],
    audit: {
      action: "localuser.update",
      target: { type: "identity", id: ctx.actor },
    },
    ctx,
  });
  return result.ok ? { ok: true, value: undefined } : result;
}

// Spec - Password users, TOTP D23: an admin reset clears the enrolment so the
// user re-enrols at the next sign-in; the password hash is kept.
export async function resetPasswordUserTotp(
  emailInput: string,
  ctx: AuditContext,
): Promise<AccessResult<void>> {
  const email = emailInput.toLowerCase();
  const key = userKey(email);
  const item = await getItem(key.PK, key.SK);
  if (!item) return { ok: false, code: "NOT_FOUND" };
  if (item.status === "sso-bound") return { ok: false, code: "CONFLICT" };
  const version = Number(item.version);
  const result = await commitAudited({
    items: [
      {
        Update: {
          TableName: getTableName(),
          Key: key,
          UpdateExpression:
            "SET version = :next, updatedAt = :now ADD credentialVersion :one REMOVE totpCipher, totpLastStep, selfChangeSignedInAt",
          ConditionExpression: "version = :v",
          ExpressionAttributeValues: {
            ":v": version,
            ":next": version + 1,
            ":now": ctx.now.toISOString(),
            ":one": 1,
          },
        },
      },
    ],
    audit: {
      action: "localuser.update",
      target: { type: "identity", id: String(item.oid) },
      before: { version },
      after: { version: version + 1 },
    },
    ctx,
  });
  return result.ok ? { ok: true, value: undefined } : result;
}

async function lockUser(email: string, now: Date): Promise<void> {
  await getDocumentClient().send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: userKey(email),
      UpdateExpression: "SET lockedUntil = :until, failedAttempts = :zero",
      ConditionExpression: "attribute_exists(PK)",
      ExpressionAttributeValues: {
        ":until": new Date(now.getTime() + LOCK_MS).toISOString(),
        ":zero": 0,
      },
    }),
  );
}

// Atomic ADD shared by every task (spec — Sign-in). The attempt that reaches
// the limit still verifies; the lock refuses the next ones for 15 minutes.
export async function reservePasswordAttempt(
  email: string,
  now: Date,
): Promise<{ allowed: boolean }> {
  try {
    const res = await getDocumentClient().send(
      new UpdateCommand({
        TableName: getTableName(),
        Key: userKey(email),
        UpdateExpression: "ADD failedAttempts :one",
        ConditionExpression:
          "attribute_exists(PK) AND (attribute_not_exists(lockedUntil) OR lockedUntil <= :now) AND (attribute_not_exists(failedAttempts) OR failedAttempts < :limit)",
        ExpressionAttributeValues: {
          ":one": 1,
          ":now": now.toISOString(),
          ":limit": LOCK_AFTER_FAILURES,
        },
        ReturnValues: "UPDATED_NEW",
      }),
    );
    if (Number(res.Attributes?.failedAttempts ?? 0) >= LOCK_AFTER_FAILURES) {
      await lockUser(email, now);
    }
    return { allowed: true };
  } catch (error) {
    if (!(error instanceof ConditionalCheckFailedException)) throw error;
    const key = userKey(email);
    const item = await getItem(key.PK, key.SK);
    const until = str(item?.lockedUntil);
    const locked = until !== undefined && until > now.toISOString();
    if (
      item &&
      !locked &&
      Number(item.failedAttempts ?? 0) >= LOCK_AFTER_FAILURES
    ) {
      await lockUser(email, now);
    }
    return { allowed: false };
  }
}

export async function resetPasswordFailures(email: string): Promise<void> {
  await getDocumentClient().send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: userKey(email),
      UpdateExpression: "SET failedAttempts = :zero REMOVE lockedUntil",
      ConditionExpression: "attribute_exists(PK)",
      ExpressionAttributeValues: { ":zero": 0 },
    }),
  );
}

// T27: a time step is accepted once; false means it was already used.
export async function claimTotpStep(
  email: string,
  step: number,
): Promise<boolean> {
  try {
    await getDocumentClient().send(
      new UpdateCommand({
        TableName: getTableName(),
        Key: userKey(email),
        UpdateExpression: "SET totpLastStep = :s",
        ConditionExpression:
          "attribute_exists(PK) AND (attribute_not_exists(totpLastStep) OR totpLastStep < :s)",
        ExpressionAttributeValues: { ":s": step },
      }),
    );
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return false;
    throw error;
  }
}

// What the TOTP requirement (D23) needs: the identity's in-app role grants and
// whether it holds any admin scope. The decision itself lives in lib/auth.
export async function getAccessSummary(
  oid: string,
): Promise<{ roles: string[]; hasAdminScope: boolean }> {
  const roles: string[] = [];
  let hasAdminScope = false;
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await getDocumentClient().send(
      new QueryCommand({
        TableName: getTableName(),
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": identPk(oid) },
        ProjectionExpression: "SK",
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of page.Items ?? []) {
      const sk = String(item.SK);
      if (sk.startsWith("ROLEGRANT#"))
        roles.push(sk.slice("ROLEGRANT#".length));
      if (sk.startsWith("ADMINSCOPE#")) hasAdminScope = true;
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return { roles, hasAdminScope };
}
