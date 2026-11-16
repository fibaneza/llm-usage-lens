import "server-only";

import { BatchGetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { BatchGetCommandOutput } from "@aws-sdk/lib-dynamodb";
import {
  AdminScopeSchema,
  GSI1_NAME,
  IdentityRecordSchema,
  MemberAffiliationSchema,
  PendingItemSchema,
  RoleGrantSchema,
} from "@llm-usage-lens/shared";
import type { PendingItem, StaleAccessRow } from "@llm-usage-lens/shared";
import type { z } from "zod";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";

import { decodeCursor, encodeCursor } from "./cursor";
import {
  META_SK,
  ROLEGRANTS_GSI1PK,
  adminsGsi1pk,
  identPk,
  membersGsi1pk,
} from "./keys";
import type { AccessResult, ListOptions, Page } from "./result";

// Source: docs/specs/2026-11-10-access-control.md - "Membership, admin scopes
// and lifecycle" (Leaver: stale = pending items not bound after 30 days, and
// affiliations, admin scopes and in-app grants whose user has not signed in for
// 90 days, D2), D34 (reversed by the user 2026-11-15), D37, "Data model
// additions" (the members and admins partitions of GSI1 hold both the bound and
// the pending items), Enforcement item 4 (read per request, never cached) and
// Rule 20.6 (paginate). The caller names the teams and departments it may read;
// this module reads only those partitions.
const PENDING_STALE_AFTER_MS = 30 * 86_400_000;
const INACTIVE_AFTER_MS = 90 * 86_400_000;
const DEFAULT_LIMIT = 100;
const IDENT_PREFIX = "IDENT#";
const PENDING_PREFIX = "PENDING#";

export type ReadableUnits = {
  teamIds: readonly string[];
  departmentIds: readonly string[];
};

type Source<T> = {
  name: string;
  partition: string;
  prefix: string;
  map: (items: Record<string, unknown>[]) => Promise<T[]>;
};

type Position = { index: number; startKey?: Record<string, unknown> };

function positionOf<T>(
  sources: readonly Source<T>[],
  options: ListOptions,
): Position | null {
  if (options.cursor === undefined) return { index: 0 };
  const decoded = decodeCursor(options.cursor, options.cursorSecret);
  if (!decoded.ok) return null;
  const index = sources.findIndex((s) => s.name === decoded.value.src);
  if (index < 0) return null;
  const raw = decoded.value.key;
  if (raw === undefined) return { index };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return { index, startKey: parsed as Record<string, unknown> };
  } catch {
    return null;
  }
}

// Reads the sources in order behind one signed cursor: {source name, the
// source's LastEvaluatedKey}. A source's cost is bounded by the items in one
// team or department partition.
async function readSources<T>(
  sources: readonly Source<T>[],
  options: ListOptions,
): Promise<AccessResult<Page<T>>> {
  const start = positionOf(sources, options);
  if (start === null) return { ok: false, code: "BAD_CURSOR" };
  const limit = Math.min(
    DEFAULT_LIMIT,
    Math.max(1, Math.floor(options.limit ?? DEFAULT_LIMIT)),
  );
  const items: T[] = [];
  let index = start.index;
  let startKey = start.startKey;
  while (index < sources.length) {
    const source = sources[index];
    if (!source) break;
    const res = await getDocumentClient().send(
      new QueryCommand({
        TableName: getTableName(),
        IndexName: GSI1_NAME,
        KeyConditionExpression: "gsi1pk = :pk AND begins_with(gsi1sk, :sk)",
        ExpressionAttributeValues: {
          ":pk": source.partition,
          ":sk": source.prefix,
        },
        // Mapped rows never outnumber the items read, so the page never
        // overshoots the limit.
        Limit: limit - items.length,
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...(await source.map(res.Items ?? [])));
    const last = res.LastEvaluatedKey;
    if (items.length >= limit) {
      const next = last ? source : sources[index + 1];
      if (!next) return { ok: true, value: { items } };
      return {
        ok: true,
        value: {
          items,
          cursor: encodeCursor(
            {
              src: next.name,
              ...(last ? { key: JSON.stringify(last) } : {}),
            },
            options.cursorSecret,
          ),
        },
      };
    }
    if (last) {
      startKey = last;
    } else {
      index += 1;
      startKey = undefined;
    }
  }
  return { ok: true, value: { items } };
}

const sorted = (ids: readonly string[]) => [...new Set(ids)].sort();

// The team members, team admins and department admins partitions, each with
// the item prefix to read.
function partitions(units: ReadableUnits, prefix: string) {
  return [
    ...sorted(units.teamIds).flatMap((id) => [
      { name: `m:${id}:${prefix}`, partition: membersGsi1pk(id), prefix },
      {
        name: `at:${id}:${prefix}`,
        partition: adminsGsi1pk("team", id),
        prefix,
      },
    ]),
    ...sorted(units.departmentIds).map((id) => ({
      name: `ad:${id}:${prefix}`,
      partition: adminsGsi1pk("department", id),
      prefix,
    })),
  ];
}

const pendingSources = <T>(
  units: ReadableUnits,
  map: (items: PendingItem[]) => T[],
): Source<T>[] =>
  partitions(units, PENDING_PREFIX).map((p) => ({
    ...p,
    map: async (items) => map(items.map((i) => PendingItemSchema.parse(i))),
  }));

export function listPendingAccess(
  units: ReadableUnits,
  options: ListOptions,
): Promise<AccessResult<Page<PendingItem>>> {
  return readSources(
    pendingSources(units, (items) => items),
    options,
  );
}

const placeOf = (
  item:
    | { kind: "affiliation"; teamId: string }
    | { kind: "adminScope"; scopeType: "team" | "department"; scopeId: string },
) =>
  item.kind === "affiliation"
    ? { teamId: item.teamId }
    : { scopeType: item.scopeType, scopeId: item.scopeId };

const BATCH_GET_MAX = 100;

const BATCH_GET_MAX_ATTEMPTS = 5;
const BATCH_GET_BACKOFF_MS = 50;

// One BatchGetItem per 100 distinct identities; UnprocessedKeys are retried
// with backoff, at most 5 attempts, then the read fails (Rule 60.17: no silent
// partial result). The result is keyed by oid.
async function identitiesOf(
  oids: readonly string[],
): Promise<Map<string, z.infer<typeof IdentityRecordSchema>>> {
  const found = new Map<string, z.infer<typeof IdentityRecordSchema>>();
  const unique = [...new Set(oids)];
  const table = getTableName();
  for (let i = 0; i < unique.length; i += BATCH_GET_MAX) {
    let keys: Record<string, unknown>[] | undefined = unique
      .slice(i, i + BATCH_GET_MAX)
      .map((oid) => ({ PK: identPk(oid), SK: META_SK }));
    for (let attempt = 1; keys && keys.length > 0; attempt++) {
      if (attempt > BATCH_GET_MAX_ATTEMPTS) {
        throw new Error(
          `BatchGetItem left keys unprocessed after ${BATCH_GET_MAX_ATTEMPTS} attempts`,
        );
      }
      if (attempt > 1) {
        await new Promise((r) =>
          setTimeout(r, BATCH_GET_BACKOFF_MS * 2 ** (attempt - 2)),
        );
      }
      const res: BatchGetCommandOutput = await getDocumentClient().send(
        new BatchGetCommand({ RequestItems: { [table]: { Keys: keys } } }),
      );
      for (const item of res.Responses?.[table] ?? []) {
        const identity = IdentityRecordSchema.parse(item);
        found.set(identity.oid, identity);
      }
      keys = res.UnprocessedKeys?.[table]?.Keys;
    }
  }
  return found;
}

// An identity record is required: no record means never seen, not stale.
async function inactiveRows<R extends { oid: string }>(
  items: readonly R[],
  now: Date,
  describe: (item: R) => Partial<StaleAccessRow> & Pick<StaleAccessRow, "kind">,
): Promise<StaleAccessRow[]> {
  const identities = await identitiesOf(items.map((item) => item.oid));
  const rows = items.map((item): StaleAccessRow | null => {
    const identity = identities.get(item.oid);
    if (!identity) return null;
    if (
      now.getTime() - Date.parse(identity.lastSignInAt) <=
      INACTIVE_AFTER_MS
    ) {
      return null;
    }
    return {
      reason: "inactive",
      subject: item.oid,
      displayName: identity.displayName ?? null,
      email: identity.email ?? null,
      since: identity.lastSignInAt,
      ...describe(item),
    };
  });
  return rows.filter((row) => row !== null);
}

export function listStaleAccess(
  input: ReadableUnits & { roleGrants: boolean; now: Date },
  options: ListOptions,
): Promise<AccessResult<Page<StaleAccessRow>>> {
  const { now } = input;
  const unbound = pendingSources<StaleAccessRow>(input, (items) =>
    items
      .filter(
        (item) =>
          now.getTime() - Date.parse(item.createdAt) > PENDING_STALE_AFTER_MS,
      )
      .map((item) => ({
        reason: "pending",
        kind: item.kind,
        subject: item.emailOrUpn,
        ...placeOf(item),
        since: item.createdAt,
      })),
  );
  const bound: Source<StaleAccessRow>[] = partitions(input, IDENT_PREFIX).map(
    (p) => ({
      ...p,
      map: (items) =>
        p.name.startsWith("m:")
          ? inactiveRows(
              items.map((i) => MemberAffiliationSchema.parse(i)),
              now,
              (a) => ({ kind: "affiliation", teamId: a.teamId }),
            )
          : inactiveRows(
              items.map((i) => AdminScopeSchema.parse(i)),
              now,
              (s) => ({
                kind: "adminScope",
                scopeType: s.scopeType,
                scopeId: s.scopeId,
              }),
            ),
    }),
  );
  const grants: Source<StaleAccessRow>[] = input.roleGrants
    ? [
        {
          name: "grants",
          partition: ROLEGRANTS_GSI1PK,
          prefix: IDENT_PREFIX,
          map: (items) =>
            inactiveRows(
              items.map((i) => RoleGrantSchema.parse(i)),
              now,
              (g) => ({ kind: "roleGrant", role: g.role }),
            ),
        },
      ]
    : [];
  return readSources([...unbound, ...bound, ...grants], options);
}
