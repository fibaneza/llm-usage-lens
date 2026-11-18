import "server-only";

import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { env } from "@/env";
import { getDocumentClient, getTableName } from "@/lib/dynamodb";

import type { TransactItem } from "./audit";
import {
  LINK_SK,
  META_SK,
  OWNER_SK,
  identPk,
  setupLinkPk,
  ssoExpectPk,
  ssoRefPk,
  usageKeyPk,
} from "./keys";
import { userKey } from "./password-users";
import type { AuditContext } from "./result";
import { commitAudited, getItem } from "./store";

// Source: docs/specs/2026-11-10-access-control.md — "SSO reference and
// binding" (D25), threats T2, T7, T26, T28. The `email` claim is never a bind
// key and guest UPNs (`#EXT#`) never match. One TransactWriteItems moves every
// item under the `local:` identity to the Entra `oid`; a person whose items do
// not fit one transaction, or whose Entra `oid` already owns items, is not
// merged and is flagged for an internal-admin instead.
const MAX_TRANSACTION_ITEMS = 100;
const TENANT_PATTERN = /\/([0-9a-f]{8}-[0-9a-f-]{27})\/v2\.0\/?$/i;

type Claims = { oid: string; tid: string; preferredUsername?: string };
export type BindResult =
  | { bound: false }
  | { bound: true; fromIdentityId: string };

export function configuredTenant(): string | null {
  const issuer = env.AUTH_MICROSOFT_ENTRA_ID_ISSUER;
  const match = issuer ? TENANT_PATTERN.exec(issuer) : null;
  return match?.[1]?.toLowerCase() ?? null;
}

async function reservedEmail(
  kind: "OID" | "UPN",
  value: string,
): Promise<string | null> {
  const item = await getItem(ssoExpectPk(kind, value), OWNER_SK);
  return typeof item?.email === "string" ? item.email : null;
}

async function findCandidate(
  claims: Claims,
): Promise<Record<string, unknown> | null> {
  let email = await reservedEmail("OID", claims.oid);
  const upn = claims.preferredUsername?.toLowerCase();
  if (!email && upn && !upn.includes("#ext#")) {
    email = await reservedEmail("UPN", upn);
  }
  if (!email) return null;
  const key = userKey(email);
  const item = await getItem(key.PK, key.SK);
  if (!item || item.status === "sso-bound") return null;
  const sso = (item.sso ?? {}) as Record<string, unknown>;
  // With an expectedOid set the UPN is never a fallback (D25).
  if (typeof sso.expectedOid === "string" && sso.expectedOid !== claims.oid) {
    return null;
  }
  return item;
}

async function partitionItems(oid: string): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await getDocumentClient().send(
      new QueryCommand({
        TableName: getTableName(),
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": identPk(oid) },
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...(page.Items ?? []));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return items;
}

async function flagConflict(email: string): Promise<void> {
  await getDocumentClient().send(
    new UpdateCommand({
      TableName: getTableName(),
      Key: userKey(email),
      UpdateExpression: "SET ssoConflict = :t",
      ConditionExpression: "attribute_exists(PK)",
      ExpressionAttributeValues: { ":t": true },
    }),
  );
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

export async function bindPasswordUserOnEntraSignIn(
  claims: Claims,
  ctx: AuditContext,
): Promise<BindResult> {
  const tenant = configuredTenant();
  if (!tenant || claims.tid.toLowerCase() !== tenant) return { bound: false };
  const user = await findCandidate(claims);
  if (!user) return { bound: false };

  const email = String(user.email);
  const localOid = String(user.oid);
  const version = Number(user.version);
  const sso = (user.sso ?? {}) as Record<string, unknown>;

  const owned = (await partitionItems(claims.oid)).some(
    (item) => item.SK !== META_SK,
  );
  // The identity record (META) is the sign-in sync's, not the person's data: it stays put.
  const local = (await partitionItems(localOid)).filter(
    (item) => item.SK !== META_SK,
  );
  const link = local.find((item) => item.SK === LINK_SK);
  const claimKeys = link
    ? [...strings(link.usageIdentities), ...strings(link.aliases)]
    : [];
  const fixed = 6 + (typeof user.setupTokenHash === "string" ? 1 : 0);
  if (
    owned ||
    local.length * 2 + claimKeys.length + fixed > MAX_TRANSACTION_ITEMS
  ) {
    if (user.ssoConflict !== true) await flagConflict(email);
    return { bound: false };
  }

  const table = getTableName();
  const from = identPk(localOid);
  const to = identPk(claims.oid);
  const moves: TransactItem[] = local.flatMap((item): TransactItem[] => {
    const moved: Record<string, unknown> = {
      ...item,
      PK: to,
      oid: claims.oid,
    };
    if (typeof item.gsi1sk === "string") {
      moved.gsi1sk = item.gsi1sk.replace(from, to);
    }
    return [
      {
        Delete: {
          TableName: table,
          Key: { PK: item.PK, SK: item.SK },
          ConditionExpression: "attribute_exists(PK)",
        },
      },
      {
        Put: {
          TableName: table,
          Item: moved,
          ConditionExpression: "attribute_not_exists(PK)",
        },
      },
    ];
  });
  const claimMoves: TransactItem[] = claimKeys.map((key) => ({
    Put: {
      TableName: table,
      Item: { PK: usageKeyPk(key), SK: OWNER_SK, key, oid: claims.oid },
      ConditionExpression: "#oid = :old",
      ExpressionAttributeNames: { "#oid": "oid" },
      ExpressionAttributeValues: { ":old": localOid },
    },
  }));
  const drop = (PK: string): TransactItem => ({
    Delete: { TableName: table, Key: { PK, SK: OWNER_SK } },
  });
  const reservations: string[] = [];
  if (typeof sso.expectedUpn === "string") {
    reservations.push(ssoExpectPk("UPN", sso.expectedUpn));
  }
  if (typeof sso.expectedOid === "string") {
    reservations.push(ssoExpectPk("OID", sso.expectedOid));
  }
  if (typeof user.setupTokenHash === "string") {
    reservations.push(setupLinkPk(user.setupTokenHash));
  }

  const result = await commitAudited({
    items: [
      {
        Update: {
          TableName: table,
          Key: userKey(email),
          UpdateExpression:
            "SET #s = :bound, sso.tid = :tid, sso.oid = :oid, sso.boundAt = :at, version = version + :one, updatedAt = :at REMOVE passwordHash, totpCipher, totpLastStep, setupTokenHash, setupExpiresAt, ssoConflict",
          ConditionExpression: "#s <> :bound AND version = :v",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: {
            ":bound": "sso-bound",
            ":tid": tenant,
            ":oid": claims.oid,
            ":at": ctx.now.toISOString(),
            ":one": 1,
            ":v": version,
          },
        },
      },
      {
        Put: {
          TableName: table,
          Item: {
            PK: ssoRefPk(tenant, claims.oid),
            SK: OWNER_SK,
            email,
            localOid,
            tid: tenant,
            oid: claims.oid,
          },
          ConditionExpression: "attribute_not_exists(PK)",
        },
      },
      ...reservations.map(drop),
      ...moves,
      ...claimMoves,
    ],
    audit: {
      action: "identity.bind.sso",
      target: { type: "identity", id: claims.oid },
      after: { oid: claims.oid, boundFrom: localOid },
    },
    ctx: { ...ctx, actor: "system" },
  });
  return result.ok
    ? { bound: true, fromIdentityId: localOid }
    : { bound: false };
}
