import "server-only";

import { IdentityLinkSchema, runBounded } from "@llm-usage-lens/shared";
import type { IdentityLink } from "@llm-usage-lens/shared";

import { getTableName } from "@/lib/dynamodb";

import { LINK_SK, OWNER_SK, identPk, usageKeyPk } from "./keys";
import type { AccessResult, AuditContext } from "./result";
import type { TransactItem } from "./audit";
import { commitAudited, getItem } from "./store";

const CLAIM_READ_CONCURRENCY = 10;

// Source: docs/specs/2026-11-10-access-control.md — "Data model additions"
// (IdentityLink; a usage key is unique to one person, claimed in the same
// TransactWriteItems); contract R2 §4 (duplicate claim = CONFLICT).
export async function getIdentityLink(
  oid: string,
): Promise<IdentityLink | null> {
  const item = await getItem(identPk(oid), LINK_SK);
  return item ? IdentityLinkSchema.parse(item) : null;
}

// The subset of `keys` that some person already claims (USAGEKEY# owner item).
export async function getClaimedKeys(keys: string[]): Promise<string[]> {
  const claimed: string[] = [];
  await runBounded(keys, CLAIM_READ_CONCURRENCY, async (key) => {
    if (await getItem(usageKeyPk(key), OWNER_SK)) claimed.push(key);
  });
  return claimed;
}

// Every usage key of the person who claims `key` (the key itself when nobody
// does): the canonical email plus the link's usage identities and aliases.
// Read-only; used for another person's combined figure (LiteLLM spec - L6).
export async function getUsageKeysClaimedWith(key: string): Promise<string[]> {
  const owner = await getItem(usageKeyPk(key), OWNER_SK);
  const link =
    owner && typeof owner.oid === "string"
      ? await getIdentityLink(owner.oid)
      : null;
  return [
    ...new Set([
      key,
      ...(link?.usageIdentities ?? []),
      ...(link?.aliases ?? []),
    ]),
  ];
}

const snapshot = (
  l: Pick<IdentityLink, "usageIdentities" | "aliases" | "version">,
) => ({
  usageIdentities: l.usageIdentities,
  aliases: l.aliases,
  version: l.version,
});

export async function putIdentityLink(
  input: Pick<
    IdentityLink,
    "oid" | "usageIdentities" | "aliases" | "litellmUserId"
  > & { version: number | null },
  ctx: AuditContext,
): Promise<AccessResult<IdentityLink>> {
  const existing = await getIdentityLink(input.oid);
  if (input.version === null) {
    if (existing) return { ok: false, code: "CONFLICT" };
  } else {
    if (!existing) return { ok: false, code: "NOT_FOUND" };
    if (existing.version !== input.version) {
      return { ok: false, code: "CONFLICT" };
    }
  }

  const value: IdentityLink = {
    oid: input.oid,
    usageIdentities: input.usageIdentities,
    aliases: input.aliases,
    ...(input.litellmUserId ? { litellmUserId: input.litellmUserId } : {}),
    version: (existing?.version ?? 0) + 1,
    updatedAt: ctx.now.toISOString(),
  };

  const previous = new Set([
    ...(existing?.usageIdentities ?? []),
    ...(existing?.aliases ?? []),
  ]);
  const next = new Set([...value.usageIdentities, ...value.aliases]);
  const claims: TransactItem[] = [...next]
    .filter((key) => !previous.has(key))
    .map((key) => ({
      Put: {
        TableName: getTableName(),
        Item: { PK: usageKeyPk(key), SK: OWNER_SK, key, oid: input.oid },
        ConditionExpression: "attribute_not_exists(PK) OR #oid = :oid",
        ExpressionAttributeNames: { "#oid": "oid" },
        ExpressionAttributeValues: { ":oid": input.oid },
      },
    }));
  const releases: TransactItem[] = [...previous]
    .filter((key) => !next.has(key))
    .map((key) => ({
      Delete: {
        TableName: getTableName(),
        Key: { PK: usageKeyPk(key), SK: OWNER_SK },
        ConditionExpression: "#oid = :oid",
        ExpressionAttributeNames: { "#oid": "oid" },
        ExpressionAttributeValues: { ":oid": input.oid },
      },
    }));

  const linkPut: TransactItem = {
    Put: {
      TableName: getTableName(),
      Item: { PK: identPk(input.oid), SK: LINK_SK, ...value },
      ...(existing
        ? {
            ConditionExpression: "version = :v",
            ExpressionAttributeValues: { ":v": existing.version },
          }
        : { ConditionExpression: "attribute_not_exists(PK)" }),
    },
  };

  const result = await commitAudited({
    items: [linkPut, ...claims, ...releases],
    audit: {
      action: "identity.link.update",
      target: { type: "identity", id: input.oid },
      ...(existing ? { before: snapshot(existing) } : {}),
      after: snapshot(value),
    },
    ctx,
  });
  return result.ok ? { ok: true, value } : result;
}
