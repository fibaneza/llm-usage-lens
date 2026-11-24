import "server-only";

import { IdentityLinkSchema, runBounded } from "@llm-usage-lens/shared";
import type { IdentityLink } from "@llm-usage-lens/shared";

import { getTableName } from "@/lib/dynamodb";

import {
  LINK_SK,
  OWNER_SK,
  PENDING_LITELLMLINK_SK,
  identPk,
  litellmUserPk,
  pendingPk,
  usageKeyPk,
} from "./keys";
import type { AccessResult, AuditContext } from "./result";
import type { AuditSpec } from "./store";
import type { TransactItem } from "./audit";
import { commitAudited, getItem, recordAuditedRead } from "./store";

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
  l: Pick<
    IdentityLink,
    "usageIdentities" | "aliases" | "version" | "litellmUserId"
  >,
) => ({
  usageIdentities: l.usageIdentities,
  aliases: l.aliases,
  ...(l.litellmUserId ? { litellmUserId: l.litellmUserId } : {}),
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

  const result = await commitLink({
    existing,
    value,
    extra: [...claims, ...releases],
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

// The one place the `litellmUserId` of a link is written, with its
// `LiteLLMUserClaim` and the audit record in one transaction (management
// improvements D16, Access Control - LiteLLM user links; T-MI1). Both
// `PUT /api/identities/[oid]/links` and the litellm-link routes call it. A
// link written before M3 has no claim: any write that keeps its LiteLLM user
// adds the claim (residual-risk note, D16).
async function commitLink(args: {
  existing: IdentityLink | null;
  value: IdentityLink;
  extra: TransactItem[];
  audit: AuditSpec;
  ctx: AuditContext;
  // Mode and reason of the LiteLLM link, kept on the item so a remove can
  // audit them.
  linkMeta?: { mode: string; reason?: string };
  // The claim of a pending LiteLLM link moves to this identity: the pending
  // key that owns it may hold it too (Access Control - LiteLLM user sync,
  // Pending LiteLLM links).
  claimFrom?: string;
}) {
  const { existing, value, extra, audit, ctx, linkMeta, claimFrom } = args;
  const oid = value.oid;
  const claim: TransactItem[] = [];
  if (value.litellmUserId) {
    claim.push({
      Put: {
        TableName: getTableName(),
        Item: {
          PK: litellmUserPk(value.litellmUserId),
          SK: OWNER_SK,
          litellmUserId: value.litellmUserId,
          oid,
        },
        ConditionExpression: claimFrom
          ? "attribute_not_exists(PK) OR #oid = :oid OR #oid = :from"
          : "attribute_not_exists(PK) OR #oid = :oid",
        ExpressionAttributeNames: { "#oid": "oid" },
        ExpressionAttributeValues: {
          ":oid": oid,
          ...(claimFrom ? { ":from": claimFrom } : {}),
        },
      },
    });
  }
  if (
    existing?.litellmUserId &&
    existing.litellmUserId !== value.litellmUserId
  ) {
    claim.push({
      Delete: {
        TableName: getTableName(),
        Key: { PK: litellmUserPk(existing.litellmUserId), SK: OWNER_SK },
        ConditionExpression: "attribute_not_exists(PK) OR #oid = :oid",
        ExpressionAttributeNames: { "#oid": "oid" },
        ExpressionAttributeValues: { ":oid": oid },
      },
    });
  }
  const kept = await rawLinkMeta(oid);
  const meta =
    linkMeta ??
    (value.litellmUserId && value.litellmUserId === existing?.litellmUserId
      ? kept
      : undefined);
  const linkPut: TransactItem = {
    Put: {
      TableName: getTableName(),
      Item: {
        PK: identPk(oid),
        SK: LINK_SK,
        ...value,
        ...(meta ? { litellmLinkMode: meta.mode } : {}),
        ...(meta?.reason ? { litellmLinkReason: meta.reason } : {}),
      },
      ...(existing
        ? {
            ConditionExpression: "version = :v",
            ExpressionAttributeValues: { ":v": existing.version },
          }
        : { ConditionExpression: "attribute_not_exists(PK)" }),
    },
  };
  return commitAudited({
    items: [linkPut, ...extra, ...claim],
    audit,
    ctx,
  });
}

async function rawLinkMeta(
  oid: string,
): Promise<{ mode: string; reason?: string } | undefined> {
  const item = await getItem(identPk(oid), LINK_SK);
  if (!item || typeof item.litellmLinkMode !== "string") return undefined;
  return {
    mode: item.litellmLinkMode,
    ...(typeof item.litellmLinkReason === "string"
      ? { reason: item.litellmLinkReason }
      : {}),
  };
}

export type LiteLLMLinkWrite =
  | {
      kind: "set";
      litellmUserId: string;
      mode: "match" | "manual" | "sync";
      reason?: string;
      // The key the sync matched on (audit only; Access Control - LiteLLM
      // user sync, Records).
      matchedKey?: "oid" | "email";
      // The sync run that wrote the link (audit only; Access Control - Records).
      runId?: string;
    }
  | { kind: "remove" };

// `version` is the stored link version (null: no link item yet). A LiteLLM
// user already claimed by another identity is CONFLICT; so is a stale version.
export async function writeLiteLLMUserLink(
  input: {
    oid: string;
    version: number | null;
    write: LiteLLMLinkWrite;
    // A pending LiteLLM link bound by this write: deleted on its version, its
    // claim moves to the identity, in the same transaction.
    pending?: { key: string; version: number };
  },
  ctx: AuditContext,
): Promise<AccessResult<IdentityLink>> {
  const { oid, write } = input;
  const existing = await getIdentityLink(oid);
  if (input.version === null) {
    if (existing) return { ok: false, code: "CONFLICT" };
  } else {
    if (!existing) return { ok: false, code: "NOT_FOUND" };
    if (existing.version !== input.version) {
      return { ok: false, code: "CONFLICT" };
    }
  }
  if (write.kind === "remove" && !existing?.litellmUserId) {
    return { ok: false, code: "NOT_FOUND" };
  }

  const value: IdentityLink = {
    oid,
    usageIdentities: existing?.usageIdentities ?? [],
    aliases: existing?.aliases ?? [],
    ...(write.kind === "set" ? { litellmUserId: write.litellmUserId } : {}),
    version: (existing?.version ?? 0) + 1,
    updatedAt: ctx.now.toISOString(),
  };
  const kept = await rawLinkMeta(oid);
  const before = existing?.litellmUserId
    ? {
        oid,
        litellmUserId: existing.litellmUserId,
        version: existing.version,
        ...(write.kind === "remove" && kept
          ? {
              mode: kept.mode,
              ...(kept.reason ? { reason: kept.reason } : {}),
            }
          : {}),
      }
    : undefined;
  const pending = input.pending;
  const result = await commitLink({
    existing,
    value,
    extra: pending
      ? [
          {
            Delete: {
              TableName: getTableName(),
              Key: {
                PK: pendingPk(pending.key),
                SK: PENDING_LITELLMLINK_SK,
              },
              ConditionExpression: "version = :pv",
              ExpressionAttributeValues: { ":pv": pending.version },
            },
          },
        ]
      : [],
    ...(pending ? { claimFrom: pending.key.toLowerCase() } : {}),
    audit:
      write.kind === "set"
        ? {
            action: "identity.litellm-link.set",
            target: { type: "identity", id: oid },
            ...(before ? { before } : {}),
            after: {
              oid,
              litellmUserId: write.litellmUserId,
              mode: write.mode,
              ...(write.reason ? { reason: write.reason } : {}),
              ...(write.matchedKey ? { matchedKey: write.matchedKey } : {}),
              ...(write.runId ? { runId: write.runId } : {}),
              version: value.version,
            },
          }
        : {
            action: "identity.litellm-link.remove",
            target: { type: "identity", id: oid },
            ...(before ? { before } : {}),
            after: { oid, version: value.version },
          },
    ctx,
    ...(write.kind === "set"
      ? {
          linkMeta: {
            mode: write.mode,
            ...(write.reason ? { reason: write.reason } : {}),
          },
        }
      : {}),
  });
  return result.ok ? { ok: true, value } : result;
}

// The identity that claims a LiteLLM user (LiteLLMUserClaim), null when none.
// Read per request, never cached (Rule 60.10).
export async function getLiteLLMUserOwner(
  litellmUserId: string,
): Promise<string | null> {
  const item = await getItem(litellmUserPk(litellmUserId), OWNER_SK);
  return item && typeof item.oid === "string" ? item.oid : null;
}

// Source: docs/specs/2026-11-10-litellm.md - audit of LiteLLM user creation;
// the record is written after the gateway call created the user.
export async function recordLiteLLMUserCreated(
  litellmUserId: string,
  ctx: AuditContext,
): Promise<void> {
  await recordAuditedRead(
    {
      action: "litellm.user.create",
      target: { type: "litellm-user", id: litellmUserId },
      after: { litellmUserId },
    },
    ctx,
  );
}
