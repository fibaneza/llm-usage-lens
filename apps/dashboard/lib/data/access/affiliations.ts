import "server-only";

import { MemberAffiliationSchema } from "@llm-usage-lens/shared";
import type { MemberAffiliation } from "@llm-usage-lens/shared";

import { getTableName } from "@/lib/dynamodb";

import { AFFILIATION_SK, adminScopeSk, identPk, membersGsi1pk } from "./keys";
import { queryPage } from "./paging";
import type { AccessResult, AuditContext, ListOptions, Page } from "./result";
import { commitAudited, getItem } from "./store";

// Source: docs/specs/2026-11-10-access-control.md — "Membership, admin scopes
// and lifecycle" (Joiner/Mover/Leaver), threat T9; contract R2 decisions 9, 19.

const snapshot = (a: MemberAffiliation) => ({
  oid: a.oid,
  teamId: a.teamId,
  source: a.source,
  version: a.version,
});

const affiliationItem = (a: MemberAffiliation) => ({
  PK: identPk(a.oid),
  SK: AFFILIATION_SK,
  gsi1pk: membersGsi1pk(a.teamId),
  gsi1sk: identPk(a.oid),
  ...a,
});

export async function getAffiliation(
  oid: string,
): Promise<MemberAffiliation | null> {
  const item = await getItem(identPk(oid), AFFILIATION_SK);
  return item ? MemberAffiliationSchema.parse(item) : null;
}

export async function addMember(
  input: { oid: string; teamId: string },
  ctx: AuditContext,
): Promise<AccessResult<MemberAffiliation>> {
  const now = ctx.now.toISOString();
  const value: MemberAffiliation = {
    oid: input.oid,
    teamId: input.teamId,
    source: "ui",
    version: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: ctx.actor,
  };
  const result = await commitAudited({
    items: [
      {
        Put: {
          TableName: getTableName(),
          Item: affiliationItem(value),
          ConditionExpression: "attribute_not_exists(PK)",
        },
      },
    ],
    audit: {
      action: "affiliation.add",
      target: { type: "identity", id: input.oid },
      teamId: input.teamId,
      after: snapshot(value),
    },
    ctx,
    conflictCodes: { 0: "ALREADY_AFFILIATED" },
  });
  return result.ok ? { ok: true, value } : result;
}

type Verdict =
  | { ok: true; current: MemberAffiliation }
  | { ok: false; code: "NOT_FOUND" | "MANAGED_BY_SSO" | "CONFLICT" };

async function checkChangeable(
  oid: string,
  teamId: string,
  version: number,
): Promise<Verdict> {
  const current = await getAffiliation(oid);
  if (!current || current.teamId !== teamId) {
    return { ok: false, code: "NOT_FOUND" };
  }
  if (current.source === "sso") return { ok: false, code: "MANAGED_BY_SSO" };
  if (current.version !== version) return { ok: false, code: "CONFLICT" };
  return { ok: true, current };
}

export async function removeMember(
  input: { oid: string; teamId: string; version: number },
  ctx: AuditContext,
): Promise<AccessResult<void>> {
  const verdict = await checkChangeable(input.oid, input.teamId, input.version);
  if (!verdict.ok) return verdict;
  const result = await commitAudited({
    items: [
      {
        Delete: {
          TableName: getTableName(),
          Key: { PK: identPk(input.oid), SK: AFFILIATION_SK },
          ConditionExpression: "version = :v AND teamId = :t",
          ExpressionAttributeValues: {
            ":v": input.version,
            ":t": input.teamId,
          },
        },
      },
    ],
    audit: {
      action: "affiliation.remove",
      target: { type: "identity", id: input.oid },
      teamId: input.teamId,
      before: snapshot(verdict.current),
    },
    ctx,
  });
  return result.ok ? { ok: true, value: undefined } : result;
}

export async function moveMember(
  input: {
    oid: string;
    fromTeamId: string;
    toTeamId: string;
    version: number;
  },
  ctx: AuditContext,
): Promise<AccessResult<MemberAffiliation>> {
  if (input.fromTeamId === input.toTeamId) {
    return { ok: false, code: "CONFLICT" };
  }
  const verdict = await checkChangeable(
    input.oid,
    input.fromTeamId,
    input.version,
  );
  if (!verdict.ok) return verdict;
  const { current } = verdict;
  const scopeKey = {
    PK: identPk(input.oid),
    SK: adminScopeSk("team", input.fromTeamId),
  };
  const hadScope = (await getItem(scopeKey.PK, scopeKey.SK)) !== null;
  const value: MemberAffiliation = {
    ...current,
    teamId: input.toTeamId,
    version: current.version + 1,
    updatedAt: ctx.now.toISOString(),
  };
  // T9: the source team's admin scope goes in the same transaction. The
  // condition pins what was read, so a concurrent grant cancels the move
  // instead of going unrecorded.
  const result = await commitAudited({
    items: [
      {
        Put: {
          TableName: getTableName(),
          Item: affiliationItem(value),
          ConditionExpression: "version = :v AND teamId = :t",
          ExpressionAttributeValues: {
            ":v": current.version,
            ":t": input.fromTeamId,
          },
        },
      },
      {
        Delete: {
          TableName: getTableName(),
          Key: scopeKey,
          ConditionExpression: hadScope
            ? "attribute_exists(PK)"
            : "attribute_not_exists(PK)",
        },
      },
    ],
    audit: {
      action: "affiliation.move",
      target: { type: "identity", id: input.oid },
      teamId: input.toTeamId,
      before: { ...snapshot(current), removedAdminScope: hadScope },
      after: snapshot(value),
    },
    ctx,
  });
  return result.ok ? { ok: true, value } : result;
}

export async function listTeamMembers(
  teamId: string,
  options: ListOptions,
): Promise<AccessResult<Page<MemberAffiliation>>> {
  return queryPage({
    schema: MemberAffiliationSchema,
    options,
    index: "GSI1",
    partition: membersGsi1pk(teamId),
    sortPrefix: "IDENT#",
  });
}
