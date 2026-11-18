import "server-only";

import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import {
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  BudgetResetRequestSchema,
  GSI1_NAME,
  auditCategory,
} from "@llm-usage-lens/shared";
import type {
  AuditRecord,
  BudgetReset,
  BudgetResetRequest,
  BudgetResetRequestStatus,
  BudgetResetRequestView,
} from "@llm-usage-lens/shared";
import { randomUUID } from "node:crypto";

import type { Scope } from "@/lib/auth/policy";
import { INTERNAL_AUDITOR_ROLE } from "@/lib/auth/roles";
import { decideWrite, isMatrixWriter } from "@/lib/auth/write-policy";
import type { WriteActor } from "@/lib/auth/write-policy";
import { getDocumentClient, getTableName } from "@/lib/dynamodb";
import { enabledOperations } from "@/lib/litellm/read-views";

import { auditPutItem } from "./access/audit";
import type { TransactItem } from "./access/audit";
import { deliverAuditLine } from "./access/audit-delivery";
import { decodeCursor, encodeCursor } from "./access/cursor";
import { personNamesOf } from "./access/identities";
import type { PersonNames } from "./access/identities";
import type { AccessResult, AuditContext, Page } from "./access/result";
import { commitAudited, getItem } from "./access/store";
import { getAllAccounts } from "./account-meta";
import { budgetResetPutItem } from "./budget-resets";
import {
  BRREQ_CLAIM_SK,
  BRREQ_META_SK,
  brReqGsi1sk,
  brReqOpenPk,
  brReqPk,
  brReqsGsi1pk,
} from "./budget-resets-keys";
import { createNotifications } from "./notifications";

// Source: docs/specs/2026-05-15-data-model.md — "Budget reset entities (unit
// M4)" and its access patterns; docs/specs/2026-11-10-litellm.md — "Budget
// reset requests", MG-D8 to MG-D13; Access Control BR1-BR9. Read per request,
// never cached (Rule 60.10).

const DAY_MS = 86_400_000;
const REQUEST_TTL_DAYS = 90;
const REQUEST_EXPIRY_DAYS = 7;
const LIST_LIMIT = 50;
const RECENT_LIMIT = 10;

export type DecideCheck =
  | { ok: true }
  | { ok: false; reason: "not-found" | "forbidden" | "self" };

// MG-D11a: the registered `requestBudgetReset` toggle (file, saved, default on).
export async function requestBudgetResetEnabled(): Promise<boolean> {
  return (await enabledOperations()).includes("requestBudgetReset");
}

const REQUEST_KEYS = Object.keys(BudgetResetRequestSchema.shape);

function toRequest(item: Record<string, unknown>): BudgetResetRequest {
  const picked: Record<string, unknown> = {};
  for (const key of REQUEST_KEYS) picked[key] = item[key];
  return BudgetResetRequestSchema.parse(picked);
}

const epochSeconds = (iso: string, plusMs = 0) =>
  Math.floor((Date.parse(iso) + plusMs) / 1000);

function requestItem(r: BudgetResetRequest) {
  return {
    PK: brReqPk(r.requestId),
    SK: BRREQ_META_SK,
    gsi1pk: brReqsGsi1pk(r.teamId),
    gsi1sk: brReqGsi1sk(r.status, r.createdAt, r.requestId),
    ...r,
    expiresAt: epochSeconds(r.createdAt, REQUEST_TTL_DAYS * DAY_MS),
  };
}

function claimKey(r: Pick<BudgetResetRequest, "teamId" | "requesterOid">) {
  return { PK: brReqOpenPk(r.teamId, r.requesterOid), SK: BRREQ_CLAIM_SK };
}

// Removes the claim only while it still belongs to this request: a stale claim
// may already have been taken over by a newer request.
function claimDelete(r: BudgetResetRequest): TransactItem {
  return {
    Delete: {
      TableName: getTableName(),
      Key: claimKey(r),
      ConditionExpression: "attribute_not_exists(PK) OR requestId = :rid",
      ExpressionAttributeValues: { ":rid": r.requestId },
    },
  };
}

type Transition = {
  from: BudgetResetRequestStatus;
  to: BudgetResetRequestStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  resetId?: string | null;
  notExpiredAt?: string;
};

function transitionItem(r: BudgetResetRequest, t: Transition): TransactItem {
  const values: Record<string, unknown> = {
    ":from": t.from,
    ":to": t.to,
    ":v": r.version,
    ":nv": r.version + 1,
    ":g": brReqGsi1sk(t.to, r.createdAt, r.requestId),
    ":db": t.decidedBy,
    ":da": t.decidedAt,
  };
  if (t.resetId !== undefined) values[":rs"] = t.resetId;
  return {
    Update: {
      TableName: getTableName(),
      Key: { PK: brReqPk(r.requestId), SK: BRREQ_META_SK },
      UpdateExpression: `SET #s = :to, version = :nv, gsi1sk = :g, decidedBy = :db, decidedAt = :da${
        t.resetId !== undefined ? ", resetId = :rs" : ""
      }`,
      ConditionExpression: t.notExpiredAt
        ? "#s = :from AND version = :v AND requestExpiresAt > :now"
        : "#s = :from AND version = :v",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: t.notExpiredAt
        ? { ...values, ":now": t.notExpiredAt }
        : values,
    },
  };
}

function applied(r: BudgetResetRequest, t: Transition): BudgetResetRequest {
  return {
    ...r,
    status: t.to,
    version: r.version + 1,
    decidedBy: t.decidedBy,
    decidedAt: t.decidedAt,
    resetId: t.resetId === undefined ? r.resetId : t.resetId,
  };
}

async function readRequest(
  requestId: string,
): Promise<BudgetResetRequest | null> {
  const item = await getItem(brReqPk(requestId), BRREQ_META_SK);
  return item ? toRequest(item) : null;
}

const isDue = (r: BudgetResetRequest, now: Date) =>
  r.status === "open" && Date.parse(r.requestExpiresAt) <= now.getTime();

// Lazy expiry: the first read that sees an overdue open request moves it
// open -> expired and notifies the requester once; the condition makes the
// move (and so the notification) happen for one caller only.
async function expireIfDue(
  request: BudgetResetRequest,
  now: Date,
): Promise<BudgetResetRequest> {
  if (!isDue(request, now)) return request;
  const transition: Transition = {
    from: "open",
    to: "expired",
    decidedBy: null,
    decidedAt: now.toISOString(),
  };
  // A claim that now belongs to a newer request counts as released: only this
  // request's own claim is deleted with it.
  for (let attempt = 0; ; attempt += 1) {
    const claim = await getItem(
      brReqOpenPk(request.teamId, request.requesterOid),
      BRREQ_CLAIM_SK,
    );
    const foreign = claim != null && claim.requestId !== request.requestId;
    try {
      await getDocumentClient().send(
        new TransactWriteCommand({
          TransactItems: foreign
            ? [transitionItem(request, transition)]
            : [transitionItem(request, transition), claimDelete(request)],
        }),
      );
      break;
    } catch (error) {
      if (!(error instanceof TransactionCanceledException)) throw error;
      const current = (await readRequest(request.requestId)) ?? request;
      if (attempt >= 1 || !isDue(current, now)) return current;
    }
  }
  await createNotifications(
    [
      {
        recipientOid: request.requesterOid,
        kind: "budget-reset.expired",
        requestId: request.requestId,
        teamId: request.teamId,
      },
    ],
    now,
  );
  return applied(request, transition);
}

export async function getBudgetResetRequest(
  requestId: string,
  now: Date = new Date(),
): Promise<BudgetResetRequest | null> {
  const request = await readRequest(requestId);
  return request ? expireIfDue(request, now) : null;
}

export async function createBudgetResetRequest(
  input: {
    requesterOid: string;
    teamId: string;
    departmentId: string;
    litellmTeamId: string;
    reason: string | null;
  },
  ctx: AuditContext,
): Promise<AccessResult<BudgetResetRequest>> {
  const now = ctx.now.toISOString();
  const request: BudgetResetRequest = BudgetResetRequestSchema.parse({
    requestId: randomUUID(),
    teamId: input.teamId,
    departmentId: input.departmentId,
    litellmTeamId: input.litellmTeamId,
    requesterOid: input.requesterOid,
    reason: input.reason,
    status: "open",
    createdAt: now,
    requestExpiresAt: new Date(
      ctx.now.getTime() + REQUEST_EXPIRY_DAYS * DAY_MS,
    ).toISOString(),
    decidedBy: null,
    decidedAt: null,
    resetId: null,
    version: 1,
  });
  const result = await commitAudited({
    items: [
      {
        Put: {
          TableName: getTableName(),
          Item: requestItem(request),
          ConditionExpression: "attribute_not_exists(PK)",
        },
      },
      {
        Put: {
          TableName: getTableName(),
          Item: {
            ...claimKey(request),
            requestId: request.requestId,
            requestExpiresAt: request.requestExpiresAt,
            expiresAt: epochSeconds(request.requestExpiresAt),
          },
          ConditionExpression:
            "attribute_not_exists(PK) OR requestExpiresAt < :now",
          ExpressionAttributeValues: { ":now": now },
        },
      },
    ],
    audit: {
      action: "budgetreset.request.create",
      target: { type: "budget-reset-request", id: request.requestId },
      teamId: request.teamId,
      after: {
        oid: request.requesterOid,
        teamId: request.teamId,
        litellmTeamId: request.litellmTeamId,
      },
    },
    ctx,
  });
  return result.ok ? { ok: true, value: request } : result;
}

export async function getOpenRequestFor(
  teamId: string,
  oid: string,
  now: Date = new Date(),
): Promise<BudgetResetRequest | null> {
  const claim = await getItem(brReqOpenPk(teamId, oid), BRREQ_CLAIM_SK);
  if (!claim || typeof claim.requestId !== "string") return null;
  const request = await getBudgetResetRequest(claim.requestId, now);
  return request &&
    (request.status === "open" || request.status === "approving")
    ? request
    : null;
}

async function queryTeamRequests(
  teamId: string,
  options: {
    prefix?: string;
    limit: number;
    startKey?: Record<string, string>;
  },
) {
  return getDocumentClient().send(
    new QueryCommand({
      TableName: getTableName(),
      IndexName: GSI1_NAME,
      KeyConditionExpression: options.prefix
        ? "gsi1pk = :pk AND begins_with(gsi1sk, :sk)"
        : "gsi1pk = :pk",
      ExpressionAttributeValues: {
        ":pk": brReqsGsi1pk(teamId),
        ...(options.prefix ? { ":sk": options.prefix } : {}),
      },
      ScanIndexForward: false,
      Limit: options.limit,
      ExclusiveStartKey: options.startKey,
    }),
  );
}

export async function listRecentRequestsFor(
  teamId: string,
  oid: string,
): Promise<BudgetResetRequest[]> {
  const found: BudgetResetRequest[] = [];
  let startKey: Record<string, string> | undefined;
  do {
    const res = await getDocumentClient().send(
      new QueryCommand({
        TableName: getTableName(),
        IndexName: GSI1_NAME,
        KeyConditionExpression: "gsi1pk = :pk",
        FilterExpression: "requesterOid = :oid",
        ExpressionAttributeValues: {
          ":pk": brReqsGsi1pk(teamId),
          ":oid": oid,
        },
        ScanIndexForward: false,
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of res.Items ?? []) found.push(toRequest(item));
    startKey = res.LastEvaluatedKey as Record<string, string> | undefined;
  } while (startKey);
  return found
    .filter((r) => r.status !== "open" && r.status !== "approving")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, RECENT_LIMIT);
}

export async function listTeamBudgetResetRequests(
  teamId: string,
  options: {
    status: "open" | "all";
    cursorSecret: string;
    cursor?: string;
    now?: Date;
  },
): Promise<AccessResult<Page<BudgetResetRequest>>> {
  const partition = brReqsGsi1pk(teamId);
  const prefix = options.status === "open" ? "open#" : undefined;
  let startKey: Record<string, string> | undefined;
  if (options.cursor !== undefined) {
    const decoded = decodeCursor(options.cursor, options.cursorSecret);
    if (
      !decoded.ok ||
      decoded.value.gsi1pk !== partition ||
      (prefix !== undefined && !decoded.value.gsi1sk?.startsWith(prefix))
    ) {
      return { ok: false, code: "BAD_CURSOR" };
    }
    startKey = decoded.value;
  }
  const res = await queryTeamRequests(teamId, {
    ...(prefix ? { prefix } : {}),
    limit: LIST_LIMIT,
    ...(startKey ? { startKey } : {}),
  });
  const now = options.now ?? new Date();
  const items: BudgetResetRequest[] = [];
  for (const item of res.Items ?? []) {
    const request = await expireIfDue(toRequest(item), now);
    if (options.status === "open" && request.status !== "open") continue;
    items.push(request);
  }
  const last = res.LastEvaluatedKey;
  if (!last) return { ok: true, value: { items } };
  const key: Record<string, string> = {};
  for (const [k, v] of Object.entries(last)) {
    if (typeof v !== "string") throw new Error(`non-string key attribute ${k}`);
    key[k] = v;
  }
  return {
    ok: true,
    value: { items, cursor: encodeCursor(key, options.cursorSecret) },
  };
}

export async function beginApproval(
  request: BudgetResetRequest,
  deciderOid: string,
  now: Date,
): Promise<AccessResult<BudgetResetRequest>> {
  const transition: Transition = {
    from: "open",
    to: "approving",
    decidedBy: deciderOid,
    decidedAt: now.toISOString(),
    notExpiredAt: now.toISOString(),
  };
  try {
    await getDocumentClient().send(
      new TransactWriteCommand({
        TransactItems: [transitionItem(request, transition)],
      }),
    );
  } catch (error) {
    if (error instanceof TransactionCanceledException) {
      return { ok: false, code: "CONFLICT" };
    }
    throw error;
  }
  return { ok: true, value: applied(request, transition) };
}

// `request` is the value beginApproval returned (status approving).
export async function abortApproval(
  request: BudgetResetRequest,
): Promise<void> {
  const transition: Transition = {
    from: "approving",
    to: "open",
    decidedBy: null,
    decidedAt: null,
  };
  const item = transitionItem(request, transition);
  if (!item.Update) throw new Error("transition is an update");
  await getDocumentClient().send(new UpdateCommand(item.Update));
}

export async function completeApproval(
  args: { request: BudgetResetRequest; reset: BudgetReset },
  ctx: AuditContext,
): Promise<BudgetResetRequest> {
  const { request, reset } = args;
  const transition: Transition = {
    from: "approving",
    to: "approved",
    decidedBy: ctx.actor,
    decidedAt: ctx.now.toISOString(),
    resetId: reset.resetId,
  };
  const resetRecord: AuditRecord = {
    actor: ctx.actor,
    action: "litellm.member.reset-spend",
    category: auditCategory("litellm.member.reset-spend", "success"),
    result: "success",
    timestamp: ctx.now.toISOString(),
    requestId: ctx.requestId,
    teamId: request.teamId,
    target: { type: "litellm-user", id: reset.litellmUserId },
    before: {
      litellmUserId: reset.litellmUserId,
      spend: reset.amount,
      ...(reset.budget !== null ? { maxBudget: reset.budget } : {}),
    },
    after: { litellmUserId: reset.litellmUserId, spend: 0 },
  };
  const resetIndex = ctx.sequence.next;
  ctx.sequence.next += 1;
  let result;
  try {
    result = await commitAudited({
      items: [
        budgetResetPutItem(reset),
        transitionItem(request, transition),
        claimDelete(request),
        auditPutItem(resetRecord, resetIndex),
      ],
      audit: {
        action: "budgetreset.request.approve",
        target: { type: "budget-reset-request", id: request.requestId },
        teamId: request.teamId,
        after: {
          oid: request.requesterOid,
          teamId: request.teamId,
          litellmTeamId: request.litellmTeamId,
        },
      },
      ctx,
    });
  } catch (error) {
    ctx.sequence.next = resetIndex;
    throw error;
  }
  if (!result.ok) {
    ctx.sequence.next = resetIndex;
    throw new Error(
      `budget reset was applied in LiteLLM but its ledger write failed: ${result.code}`,
    );
  }
  await deliverAuditLine(resetRecord);
  return applied(request, transition);
}

export async function denyBudgetResetRequest(
  request: BudgetResetRequest,
  deciderOid: string,
  ctx: AuditContext,
): Promise<AccessResult<BudgetResetRequest>> {
  const transition: Transition = {
    from: "open",
    to: "denied",
    decidedBy: deciderOid,
    decidedAt: ctx.now.toISOString(),
  };
  const result = await commitAudited({
    items: [transitionItem(request, transition), claimDelete(request)],
    audit: {
      action: "budgetreset.request.deny",
      target: { type: "budget-reset-request", id: request.requestId },
      teamId: request.teamId,
      after: {
        oid: request.requesterOid,
        teamId: request.teamId,
      },
    },
    ctx,
  });
  return result.ok ? { ok: true, value: applied(request, transition) } : result;
}

const personOf = (oid: string, names: Map<string, PersonNames>) => ({
  oid,
  displayName: names.get(oid)?.displayName ?? null,
  email: names.get(oid)?.email ?? null,
});

export async function toRequestViews(
  requests: readonly BudgetResetRequest[],
): Promise<BudgetResetRequestView[]> {
  if (requests.length === 0) return [];
  const [names, accounts] = await Promise.all([
    personNamesOf(
      requests.flatMap((r) =>
        r.decidedBy ? [r.requesterOid, r.decidedBy] : [r.requesterOid],
      ),
    ),
    getAllAccounts(),
  ]);
  const teamNames = new Map(accounts.map((a) => [a.teamId, a.teamName]));
  return requests.map((r) => ({
    id: r.requestId,
    teamId: r.teamId,
    teamName: teamNames.get(r.teamId) ?? null,
    requester: personOf(r.requesterOid, names),
    reason: r.reason,
    status: r.status,
    createdAt: r.createdAt,
    requestExpiresAt: r.requestExpiresAt,
    decidedAt: r.decidedAt,
    decidedBy: r.decidedBy ? personOf(r.decidedBy, names) : null,
  }));
}

// The `member` matrix write of the reset routes, minus the requester (BR1,
// BR2). Authorization data comes from the caller, never from a notification.
export function mayDecideTeam(
  actor: WriteActor,
  team: { teamId: string; departmentId: string } | null,
): boolean {
  return decideWrite(actor, { operation: "member", team }) === "allow";
}

export function mayDecide(
  actor: WriteActor,
  request: BudgetResetRequest,
  team: { teamId: string; departmentId: string } | null,
): boolean {
  return mayDecideTeam(actor, team) && actor.oid !== request.requesterOid;
}

// Roles x operation, `POST /api/budget-reset-requests` column "Auditor": the
// auditor stays read-only; an Admin or org-admin who is also an auditor keeps
// the writer's right. A null actor (no valid identity) never requests.
export function mayRequestBudgetReset(actor: WriteActor | null): boolean {
  if (!actor) return false;
  return (
    !actor.roles.includes(INTERNAL_AUDITOR_ROLE) || isMatrixWriter(actor.roles)
  );
}

// BR8: a request is shown to its requester and to whoever's scope covers it.
export function mayReadRequest(
  scope: Scope,
  request: BudgetResetRequest,
  callerOid: string,
): boolean {
  return (
    request.requesterOid === callerOid ||
    scope.global ||
    scope.teamScopes.has(request.teamId) ||
    scope.departmentScopes.has(request.departmentId)
  );
}
