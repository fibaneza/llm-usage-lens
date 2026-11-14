import "server-only";

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  AdminScopeSchema,
  IdentityRecordSchema,
  RoleGrantSchema,
} from "@llm-usage-lens/shared";
import type { AdminScope, RoleGrant } from "@llm-usage-lens/shared";
import type { z } from "zod";

import {
  globalRolesOf,
  hasSessionIdentity,
  isGlobalReader,
} from "@/lib/auth/policy";
import type { PolicySession, ResolveScopeInput } from "@/lib/auth/policy";
import { getDocumentClient, getTableName } from "@/lib/dynamodb";

import { getAffiliation } from "./affiliations";
import { getIdentityLink } from "./identity-links";
import { META_SK, identPk } from "./keys";
import { getPerUserApproval } from "./per-user-approval";
import { getItem } from "./store";
import { getVisibility } from "./visibility";

// Source: docs/specs/2026-11-10-access-control.md - "Enforcement" item 4
// (authorization data is never cached: every request reads it fresh) and
// "Evaluation order". The only reader of the per-request policy inputs; never
// call it inside unstable_cache.

async function queryByIdent<S extends z.ZodType>(
  oid: string,
  prefix: string,
  schema: S,
): Promise<z.infer<S>[]> {
  const out: z.infer<S>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await getDocumentClient().send(
      new QueryCommand({
        TableName: getTableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":pk": identPk(oid), ":sk": prefix },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of res.Items ?? []) out.push(schema.parse(item));
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return out;
}

export type AuthorizationRequest = {
  appEnv: "dev" | "prod";
  session: PolicySession;
  // The teams and departments whose visibility the request needs.
  teamIds: readonly string[];
  departmentIds: readonly string[];
};

export async function loadAuthorization(
  request: AuthorizationRequest,
): Promise<ResolveScopeInput> {
  const { appEnv, session } = request;
  const empty = { teams: new Map(), departments: new Map() };
  const base: ResolveScopeInput = {
    appEnv,
    session,
    affiliation: null,
    adminScopes: [],
    roleGrants: [],
    identity: null,
    identityLink: null,
    visibility: empty,
    perUserApproved: true,
  };
  if (!hasSessionIdentity(session)) return base;
  const oid = String(session?.user?.oid);

  const approvalRead =
    appEnv === "prod" ? getPerUserApproval() : Promise.resolve(null);
  const claimRoles = globalRolesOf(session, appEnv, []);
  // A session that already carries a global reader role needs no grant read.
  const roleGrants: RoleGrant[] =
    claimRoles !== null && isGlobalReader(claimRoles)
      ? []
      : await queryByIdent(oid, "ROLEGRANT#", RoleGrantSchema);
  const roles = globalRolesOf(session, appEnv, roleGrants);
  const approval = await approvalRead;
  const perUserApproved = appEnv !== "prod" || approval !== null;
  if (roles === null || isGlobalReader(roles)) {
    return { ...base, roleGrants, perUserApproved };
  }

  const [affiliation, adminScopes, identityLink] = await Promise.all([
    getAffiliation(oid),
    queryByIdent(oid, "ADMINSCOPE#", AdminScopeSchema) as Promise<AdminScope[]>,
    getIdentityLink(oid),
  ]);
  const identityItem = adminScopes.some((s) => s.source === "sso")
    ? await getItem(identPk(oid), META_SK)
    : null;
  const identity = identityItem
    ? IdentityRecordSchema.parse(identityItem)
    : null;
  const visibility = await getVisibility({
    teamIds: request.teamIds,
    departmentIds: request.departmentIds,
  });
  return {
    ...base,
    roleGrants,
    affiliation,
    adminScopes,
    identity,
    identityLink,
    visibility,
    perUserApproved,
  };
}
