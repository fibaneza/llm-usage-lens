import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  GSI1_NAME,
  PasswordUserListItemSchema,
  PasswordUserSchema,
} from "@llm-usage-lens/shared";
import type {
  PasswordUser,
  PasswordUserListItem,
} from "@llm-usage-lens/shared";
import { z } from "zod";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";

import type { TransactItem } from "./audit";
import {
  GOVERNANCE_PK,
  LOCALUSERS_GSI1PK,
  META_SK,
  OWNER_SK,
  PASSWORD_SIGNIN_SK,
  localUserPk,
  setupLinkPk,
  ssoExpectPk,
  identPk,
  roleGrantSk,
  ssoRefPk,
  usageKeyPk,
} from "./keys";
import { queryPage } from "./paging";
import type { AccessResult, AuditContext, ListOptions, Page } from "./result";
import { commitAudited, getItem } from "./store";

// Source: docs/specs/2026-11-10-access-control.md — "Password users"
// (Accounts, Identity, Setup D22, Alongside Entra D24), "SSO reference and
// binding" (reservations D25), "Data model additions"; threats T24, T26, T28.
// The setup token is shown once; only its SHA-256 and the expiry are stored.
const SETUP_TTL_MS = 72 * 3_600_000;

export const sha256Hex = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export function toPasswordUser(item: Record<string, unknown>): PasswordUser {
  const sso = (item.sso ?? {}) as Record<string, unknown>;
  return PasswordUserSchema.parse({
    email: item.email,
    oid: item.oid,
    tid: item.tid,
    displayName: item.displayName,
    status: item.status,
    version: item.version,
    sso,
    ...(typeof item.setupExpiresAt === "string"
      ? { setup: { expiresAt: item.setupExpiresAt } }
      : {}),
    ...(item.ssoConflict === true ? { ssoConflict: true } : {}),
  });
}

export const userKey = (email: string) => ({
  PK: localUserPk(email),
  SK: META_SK,
});

export async function getPasswordUser(
  email: string,
): Promise<PasswordUser | null> {
  const key = userKey(email);
  const item = await getItem(key.PK, key.SK);
  return item ? toPasswordUser(item) : null;
}

// The list row is derived from the stored item; the hash and the TOTP
// ciphertext are read only to compute `pending-setup` and `totpEnrolled` and
// never leave this schema (spec - API routes (additions), Passwords, TOTP D23).
const ListRowSchema = z
  .object({
    email: z.string(),
    displayName: z.string(),
    status: z.enum(["enabled", "disabled", "sso-bound"]),
    version: z.number(),
    createdAt: z.string(),
    passwordHash: z.string().optional(),
    totpCipher: z.string().optional(),
  })
  .transform(
    (r): PasswordUserListItem => ({
      email: r.email,
      displayName: r.displayName,
      status:
        r.status === "enabled" && !r.passwordHash ? "pending-setup" : r.status,
      totpEnrolled: r.totpCipher !== undefined,
      createdAt: r.createdAt,
      version: r.version,
    }),
  )
  .pipe(PasswordUserListItemSchema);

export function listPasswordUsers(
  options: ListOptions,
): Promise<AccessResult<Page<PasswordUserListItem>>> {
  return queryPage({
    schema: ListRowSchema,
    options,
    index: "GSI1",
    partition: LOCALUSERS_GSI1PK,
  });
}

export async function getPasswordUserListItem(
  email: string,
): Promise<PasswordUserListItem | null> {
  const key = userKey(email);
  const item = await getItem(key.PK, key.SK);
  return item ? ListRowSchema.parse(item) : null;
}

export type OtherPasswordAdmin = { email: string; oid: string };

// Spec - Password users, Accounts: the last enabled password internal-admin
// cannot be disabled or deleted while Entra is not configured. Read live from
// the store; the caller decides whether Entra is configured. Returns
// `{ protected: false }` when the target is not an enabled admin, otherwise the
// lowest-email other enabled admin (null when the target is the only one). The
// write then re-checks that admin inside its transaction (F5).
export async function passwordAdminGuard(
  emailInput: string,
): Promise<
  { protected: false } | { protected: true; other: OtherPasswordAdmin | null }
> {
  const email = emailInput.toLowerCase();
  const enabled: OtherPasswordAdmin[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await getDocumentClient().send(
      new QueryCommand({
        TableName: getTableName(),
        IndexName: GSI1_NAME,
        KeyConditionExpression: "gsi1pk = :pk",
        FilterExpression: "#s = :enabled",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":pk": LOCALUSERS_GSI1PK,
          ":enabled": "enabled",
        },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of page.Items ?? []) {
      enabled.push({ email: String(item.email), oid: String(item.oid) });
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  if (!enabled.some((u) => u.email === email)) return { protected: false };
  const holders = await Promise.all(
    enabled.map(async (u) =>
      (await getItem(identPk(u.oid), roleGrantSk("internal-admin"))) ? u : null,
    ),
  );
  const admins = holders.filter((u) => u !== null);
  if (!admins.some((u) => u.email === email)) return { protected: false };
  const others = admins
    .filter((u) => u.email !== email)
    .sort((x, y) => (x.email < y.email ? -1 : 1));
  return { protected: true, other: others[0] ?? null };
}

// A ConditionCheck pair: the other admin is still enabled and still holds
// internal-admin when this write commits.
function otherAdminChecks(other: OtherPasswordAdmin): TransactItem[] {
  return [
    {
      ConditionCheck: {
        TableName: getTableName(),
        Key: userKey(other.email),
        ConditionExpression: "#s = :enabled",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":enabled": "enabled" },
      },
    },
    {
      ConditionCheck: {
        TableName: getTableName(),
        Key: { PK: identPk(other.oid), SK: roleGrantSk("internal-admin") },
        ConditionExpression: "attribute_exists(PK)",
      },
    },
  ];
}

type NewSetup = { token: string; hash: string; expiresAt: string };

function newSetup(now: Date): NewSetup {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    hash: sha256Hex(token),
    expiresAt: new Date(now.getTime() + SETUP_TTL_MS).toISOString(),
  };
}

const setupLinkPut = (setup: NewSetup, email: string): TransactItem => ({
  Put: {
    TableName: getTableName(),
    Item: {
      PK: setupLinkPk(setup.hash),
      SK: OWNER_SK,
      email,
      expiresAt: Math.floor(Date.parse(setup.expiresAt) / 1000),
    },
    ConditionExpression: "attribute_not_exists(PK)",
  },
});

const reservationPut = (
  kind: "OID" | "UPN",
  value: string,
  email: string,
): TransactItem => ({
  Put: {
    TableName: getTableName(),
    Item: { PK: ssoExpectPk(kind, value), SK: OWNER_SK, email },
    ConditionExpression: "attribute_not_exists(PK)",
  },
});

export async function createPasswordUser(
  input: {
    email: string;
    displayName: string;
    sso?: { expectedUpn?: string; expectedOid?: string };
  },
  ctx: AuditContext,
): Promise<AccessResult<{ user: PasswordUser; setupToken: string }>> {
  const email = input.email.toLowerCase();
  const expectedUpn = (input.sso?.expectedUpn ?? email).toLowerCase();
  const expectedOid = input.sso?.expectedOid;
  const oid = `local:${randomUUID()}`;
  const setup = newSetup(ctx.now);
  const now = ctx.now.toISOString();
  const key = userKey(email);
  const item = {
    ...key,
    gsi1pk: LOCALUSERS_GSI1PK,
    gsi1sk: key.PK,
    email,
    oid,
    tid: "local",
    displayName: input.displayName,
    status: "enabled",
    version: 1,
    sso: { expectedUpn, ...(expectedOid ? { expectedOid } : {}) },
    setupTokenHash: setup.hash,
    setupExpiresAt: setup.expiresAt,
    createdAt: now,
    updatedAt: now,
  };
  const result = await commitAudited({
    items: [
      {
        Put: {
          TableName: getTableName(),
          Item: item,
          ConditionExpression: "attribute_not_exists(PK)",
        },
      },
      {
        ConditionCheck: {
          TableName: getTableName(),
          Key: { PK: usageKeyPk(email), SK: OWNER_SK },
          ConditionExpression: "attribute_not_exists(PK)",
        },
      },
      reservationPut("UPN", expectedUpn, email),
      ...(expectedOid ? [reservationPut("OID", expectedOid, email)] : []),
      setupLinkPut(setup, email),
    ],
    audit: {
      action: "localuser.create",
      target: { type: "identity", id: oid },
      after: { oid, version: 1 },
    },
    ctx,
  });
  return result.ok
    ? {
        ok: true,
        value: { user: toPasswordUser(item), setupToken: setup.token },
      }
    : result;
}

async function loadMutable(
  email: string,
): Promise<
  | { ok: true; item: Record<string, unknown> }
  | { ok: false; code: "NOT_FOUND" | "CONFLICT" }
> {
  const key = userKey(email);
  const item = await getItem(key.PK, key.SK);
  if (!item) return { ok: false, code: "NOT_FOUND" };
  if (item.status === "sso-bound") return { ok: false, code: "CONFLICT" };
  return { ok: true, item };
}

async function setStatus(
  emailInput: string,
  status: "enabled" | "disabled",
  ctx: AuditContext,
  expectedVersion?: number,
  otherAdmin?: OtherPasswordAdmin,
): Promise<AccessResult<void>> {
  const email = emailInput.toLowerCase();
  const loaded = await loadMutable(email);
  if (!loaded.ok) return loaded;
  const version = Number(loaded.item.version);
  if (expectedVersion !== undefined && expectedVersion !== version) {
    return { ok: false, code: "CONFLICT" };
  }
  const oid = String(loaded.item.oid);
  const result = await commitAudited({
    items: [
      {
        Update: {
          TableName: getTableName(),
          Key: userKey(email),
          UpdateExpression:
            status === "enabled"
              ? "SET #s = :s, version = :next, updatedAt = :now, failedAttempts = :zero REMOVE lockedUntil"
              : "SET #s = :s, version = :next, updatedAt = :now ADD credentialVersion :one REMOVE selfChangeSignedInAt",
          ConditionExpression: "version = :v",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: {
            ":s": status,
            ":v": version,
            ":next": version + 1,
            ":now": ctx.now.toISOString(),
            ...(status === "enabled" ? { ":zero": 0 } : { ":one": 1 }),
          },
        },
      },
      ...(otherAdmin ? otherAdminChecks(otherAdmin) : []),
    ],
    audit: {
      action: "localuser.update",
      target: { type: "identity", id: oid },
      before: { active: loaded.item.status === "enabled", version },
      after: { active: status === "enabled", version: version + 1 },
    },
    ctx,
  });
  return result.ok ? { ok: true, value: undefined } : result;
}

export const disablePasswordUser = (
  email: string,
  ctx: AuditContext,
  expectedVersion?: number,
  otherAdmin?: OtherPasswordAdmin,
) => setStatus(email, "disabled", ctx, expectedVersion, otherAdmin);

export const enablePasswordUser = (
  email: string,
  ctx: AuditContext,
  expectedVersion?: number,
) => setStatus(email, "enabled", ctx, expectedVersion);

export async function issueSetupLink(
  emailInput: string,
  ctx: AuditContext,
): Promise<AccessResult<{ setupToken: string }>> {
  const email = emailInput.toLowerCase();
  const loaded = await loadMutable(email);
  if (!loaded.ok) return loaded;
  const version = Number(loaded.item.version);
  const previous = loaded.item.setupTokenHash;
  const setup = newSetup(ctx.now);
  const result = await commitAudited({
    items: [
      {
        Update: {
          TableName: getTableName(),
          Key: userKey(email),
          UpdateExpression:
            "SET setupTokenHash = :h, setupExpiresAt = :e, version = :next, updatedAt = :now ADD credentialVersion :one REMOVE selfChangeSignedInAt",
          ConditionExpression: "version = :v",
          ExpressionAttributeValues: {
            ":h": setup.hash,
            ":e": setup.expiresAt,
            ":v": version,
            ":next": version + 1,
            ":now": ctx.now.toISOString(),
            ":one": 1,
          },
        },
      },
      setupLinkPut(setup, email),
      ...(typeof previous === "string"
        ? [
            {
              Delete: {
                TableName: getTableName(),
                Key: { PK: setupLinkPk(previous), SK: OWNER_SK },
              },
            },
          ]
        : []),
    ],
    audit: {
      action: "localuser.update",
      target: { type: "identity", id: String(loaded.item.oid) },
      before: { version },
      after: { version: version + 1 },
    },
    ctx,
  });
  return result.ok ? { ok: true, value: { setupToken: setup.token } } : result;
}

export async function deletePasswordUser(
  emailInput: string,
  ctx: AuditContext,
  otherAdmin?: OtherPasswordAdmin,
): Promise<AccessResult<void>> {
  const email = emailInput.toLowerCase();
  const key = userKey(email);
  const item = await getItem(key.PK, key.SK);
  if (!item) return { ok: false, code: "NOT_FOUND" };
  const version = Number(item.version);
  const sso = (item.sso ?? {}) as Record<string, unknown>;
  const drop = (PK: string): TransactItem => ({
    Delete: { TableName: getTableName(), Key: { PK, SK: OWNER_SK } },
  });
  const bound = item.status === "sso-bound";
  const keys: string[] = [];
  if (bound) {
    if (typeof sso.tid === "string" && typeof sso.oid === "string") {
      keys.push(ssoRefPk(sso.tid, sso.oid));
    }
  } else {
    if (typeof sso.expectedUpn === "string") {
      keys.push(ssoExpectPk("UPN", sso.expectedUpn));
    }
    if (typeof sso.expectedOid === "string") {
      keys.push(ssoExpectPk("OID", sso.expectedOid));
    }
  }
  if (typeof item.setupTokenHash === "string") {
    keys.push(setupLinkPk(item.setupTokenHash));
  }
  const result = await commitAudited({
    items: [
      {
        Delete: {
          TableName: getTableName(),
          Key: key,
          ConditionExpression: "version = :v",
          ExpressionAttributeValues: { ":v": version },
        },
      },
      ...keys.map(drop),
      ...(otherAdmin ? otherAdminChecks(otherAdmin) : []),
    ],
    audit: {
      action: "localuser.delete",
      target: { type: "identity", id: String(item.oid) },
      before: { oid: String(item.oid), version },
    },
    ctx,
  });
  return result.ok ? { ok: true, value: undefined } : result;
}

export async function getPasswordSignIn(): Promise<{
  enabled: boolean;
  version: number;
}> {
  const item = await getItem(GOVERNANCE_PK, PASSWORD_SIGNIN_SK);
  return item
    ? { enabled: item.enabled === true, version: Number(item.version) }
    : { enabled: true, version: 0 };
}

export async function setPasswordSignIn(
  input: { enabled: boolean; entraConfigured: boolean; version?: number },
  ctx: AuditContext,
): Promise<AccessResult<{ enabled: boolean; version: number }>> {
  if (!input.enabled && !input.entraConfigured) {
    return { ok: false, code: "CONFLICT" };
  }
  const current = await getItem(GOVERNANCE_PK, PASSWORD_SIGNIN_SK);
  const before = current
    ? { enabled: current.enabled === true, version: Number(current.version) }
    : { enabled: true, version: 0 };
  if (input.version !== undefined && input.version !== before.version) {
    return { ok: false, code: "CONFLICT" };
  }
  const value = { enabled: input.enabled, version: before.version + 1 };
  const result = await commitAudited({
    items: [
      {
        Put: {
          TableName: getTableName(),
          Item: {
            PK: GOVERNANCE_PK,
            SK: PASSWORD_SIGNIN_SK,
            ...value,
            updatedAt: ctx.now.toISOString(),
          },
          ...(current
            ? {
                ConditionExpression: "version = :v",
                ExpressionAttributeValues: { ":v": before.version },
              }
            : { ConditionExpression: "attribute_not_exists(PK)" }),
        },
      },
    ],
    audit: {
      action: "governance.passwordsignin.update",
      target: { type: "governance", id: PASSWORD_SIGNIN_SK },
      before: { active: before.enabled, version: before.version },
      after: { active: value.enabled, version: value.version },
    },
    ctx,
  });
  return result.ok ? { ok: true, value } : result;
}
