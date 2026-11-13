import "server-only";

import { randomBytes } from "node:crypto";

import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { auditCategory } from "@llm-usage-lens/shared";
import type {
  AdminScope,
  AuditRecord,
  GroupMapping,
  MemberAffiliation,
  PendingItem,
} from "@llm-usage-lens/shared";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";
import type { SignedInIdentity } from "@/lib/auth/master-user";
import { resolveSignIn } from "@/lib/auth/sign-in-resolution";
import type {
  ScopeRef,
  SignInPlan,
  SsoFlags,
} from "@/lib/auth/sign-in-resolution";

import { auditPutItem } from "./audit";
import type { TransactItem } from "./audit";
import { deliverAuditLine } from "./audit-delivery";
import { listAdminScopes } from "./admin-scopes";
import { getAffiliation } from "./affiliations";
import { listGroupMappings } from "./group-mappings";
import {
  AFFILIATION_SK,
  adminScopeSk,
  adminsGsi1pk,
  identPk,
  membersGsi1pk,
  pendingPk,
} from "./keys";
import { listPendingFor } from "./pending";
import type { AccessResult, AuditContext, Page } from "./result";
import { getItem } from "./store";
import { bindPasswordUserOnEntraSignIn } from "./sso-binding";

// Source: docs/specs/2026-11-10-access-control.md — "Identity, SSO mapping and
// defaults" (resolution at every sign-in), "Membership" Joiner (bind on the
// tenant and the lower-cased UPN), "Audit log" (one record per change, actor
// `system`, same transaction; D18 auth.signin.success), "Sign-in methods" D25
// (an Entra sign-in first binds a password user); threats T2, T8, T18, T26;
// contract R2 decision 11: one transaction, more than 100 items throws, and
// one retry after a condition failure.
const MAX_TRANSACTION_ITEMS = 100;
const SYSTEM = "system";
// Internal paging only: the cursor never leaves this module.
const CURSOR_SECRET = randomBytes(32).toString("hex");

const EMPTY_PLAN: SignInPlan = {
  affiliation: { op: "keep" },
  scopePuts: [],
  scopeDeletes: [],
  pendingDeletes: [],
  flags: { ambiguousMembership: false, groupsOverage: false },
};

type Planned = {
  items: TransactItem[];
  record: Omit<AuditRecord, "timestamp" | "requestId" | "category"> & {
    category?: AuditRecord["category"];
  };
};

async function readAll<T>(
  fetchPage: (cursor?: string) => Promise<AccessResult<Page<T>>>,
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    if (!page.ok) throw new Error(`sign-in read failed: ${page.code}`);
    all.push(...page.value.items);
    cursor = page.value.cursor;
  } while (cursor);
  return all;
}

const options = (cursor?: string) => ({
  cursorSecret: CURSOR_SECRET,
  ...(cursor ? { cursor } : {}),
});

const affiliationSnapshot = (a: MemberAffiliation) => ({
  oid: a.oid,
  teamId: a.teamId,
  source: a.source,
  version: a.version,
});
const scopeSnapshot = (s: AdminScope) => ({
  oid: s.oid,
  scopeType: s.scopeType,
  scopeId: s.scopeId,
  source: s.source,
  version: s.version,
});

const pendingSk = (item: PendingItem): string =>
  item.kind === "affiliation"
    ? AFFILIATION_SK
    : adminScopeSk(item.scopeType, item.scopeId);

const versionGuard = (version: number) => ({
  ConditionExpression: "version = :v",
  ExpressionAttributeValues: { ":v": version },
});
const createGuard = { ConditionExpression: "attribute_not_exists(PK)" };

type Snapshot = {
  affiliation: MemberAffiliation | null;
  scopes: AdminScope[];
  flags: SsoFlags;
};

function buildChanges(
  identity: SignedInIdentity,
  plan: SignInPlan,
  current: Snapshot,
  now: Date,
): Planned[] {
  const table = getTableName();
  const nowIso = now.toISOString();
  const target = { type: "identity", id: identity.oid };
  const changes: Planned[] = [];

  const op = plan.affiliation;
  if (op.op === "put") {
    const prev = current.affiliation;
    const value: MemberAffiliation = {
      oid: identity.oid,
      teamId: op.teamId,
      source: op.source,
      version: (prev?.version ?? 0) + 1,
      createdAt: prev?.createdAt ?? nowIso,
      updatedAt: nowIso,
      createdBy: SYSTEM,
    };
    changes.push({
      items: [
        {
          Put: {
            TableName: table,
            Item: {
              PK: identPk(identity.oid),
              SK: AFFILIATION_SK,
              gsi1pk: membersGsi1pk(op.teamId),
              gsi1sk: identPk(identity.oid),
              ...value,
            },
            ...(prev ? versionGuard(prev.version) : createGuard),
          },
        },
      ],
      record: {
        actor: SYSTEM,
        action: op.source === "ui" ? "affiliation.bind" : "affiliation.sso.set",
        target,
        teamId: op.teamId,
        ...(prev ? { before: affiliationSnapshot(prev) } : {}),
        after: {
          ...affiliationSnapshot(value),
          ...(op.source === "ui" ? { boundFrom: op.boundFrom } : {}),
        },
        result: "success",
      },
    });
  } else if (op.op === "delete" && current.affiliation) {
    const prev = current.affiliation;
    changes.push({
      items: [
        {
          Delete: {
            TableName: table,
            Key: { PK: identPk(identity.oid), SK: AFFILIATION_SK },
            ...versionGuard(prev.version),
          },
        },
      ],
      record: {
        actor: SYSTEM,
        action: "affiliation.sso.remove",
        target,
        teamId: prev.teamId,
        before: affiliationSnapshot(prev),
        result: "success",
      },
    });
  }

  const scopeOf = (ref: ScopeRef) =>
    current.scopes.find(
      (s) => s.scopeType === ref.scopeType && s.scopeId === ref.scopeId,
    );
  const teamIdOf = (ref: ScopeRef) =>
    ref.scopeType === "team" ? { teamId: ref.scopeId } : {};

  for (const put of plan.scopePuts) {
    const prev = scopeOf(put);
    const value: AdminScope = {
      oid: identity.oid,
      scopeType: put.scopeType,
      scopeId: put.scopeId,
      source: put.source,
      version: (prev?.version ?? 0) + 1,
      createdAt: prev?.createdAt ?? nowIso,
      createdBy: SYSTEM,
    };
    changes.push({
      items: [
        {
          Put: {
            TableName: table,
            Item: {
              PK: identPk(identity.oid),
              SK: adminScopeSk(put.scopeType, put.scopeId),
              gsi1pk: adminsGsi1pk(put.scopeType, put.scopeId),
              gsi1sk: identPk(identity.oid),
              ...value,
            },
            ...(prev ? versionGuard(prev.version) : createGuard),
          },
        },
      ],
      record: {
        actor: SYSTEM,
        action: put.source === "ui" ? "adminscope.bind" : "adminscope.sso.add",
        target,
        ...teamIdOf(put),
        ...(prev ? { before: scopeSnapshot(prev) } : {}),
        after: {
          ...scopeSnapshot(value),
          ...(put.source === "ui" ? { boundFrom: put.boundFrom } : {}),
        },
        result: "success",
      },
    });
  }

  for (const ref of plan.scopeDeletes) {
    const prev = scopeOf(ref);
    if (!prev) continue;
    changes.push({
      items: [
        {
          Delete: {
            TableName: table,
            Key: {
              PK: identPk(identity.oid),
              SK: adminScopeSk(ref.scopeType, ref.scopeId),
            },
            ...versionGuard(prev.version),
          },
        },
      ],
      record: {
        actor: SYSTEM,
        action: "adminscope.sso.remove",
        target,
        ...teamIdOf(ref),
        before: scopeSnapshot(prev),
        result: "success",
      },
    });
  }

  for (const { item, reason } of plan.pendingDeletes) {
    const del: TransactItem = {
      Delete: {
        TableName: table,
        Key: { PK: pendingPk(item.emailOrUpn), SK: pendingSk(item) },
        ...versionGuard(item.version),
      },
    };
    // A bound item's deletion is part of its bind record.
    if (reason === "bound") {
      const owner = changes.find(
        (c) =>
          (item.kind === "affiliation" &&
            c.record.action === "affiliation.bind") ||
          (item.kind === "adminScope" &&
            c.record.action === "adminscope.bind" &&
            c.record.after?.scopeId === item.scopeId &&
            c.record.after.scopeType === item.scopeType),
      );
      if (owner) {
        owner.items.push(del);
        continue;
      }
    }
    changes.push({
      items: [del],
      record: {
        actor: SYSTEM,
        action: "pending.discard",
        target: { type: "pending", id: item.emailOrUpn },
        ...(item.kind === "affiliation"
          ? { teamId: item.teamId }
          : teamIdOf({ scopeType: item.scopeType, scopeId: item.scopeId })),
        before: {
          kind: item.kind,
          version: item.version,
          ...(item.kind === "affiliation"
            ? { teamId: item.teamId }
            : { scopeType: item.scopeType, scopeId: item.scopeId }),
        },
        result: "success",
      },
    });
  }

  const flags = plan.flags;
  if (
    flags.ambiguousMembership !== current.flags.ambiguousMembership ||
    flags.groupsOverage !== current.flags.groupsOverage
  ) {
    changes.push({
      items: [
        {
          Update: {
            TableName: table,
            Key: { PK: identPk(identity.oid), SK: "META" },
            UpdateExpression:
              "SET ambiguousMembership = :a, groupsOverage = :g",
            ConditionExpression: "attribute_exists(PK)",
            ExpressionAttributeValues: {
              ":a": flags.ambiguousMembership,
              ":g": flags.groupsOverage,
            },
          },
        },
      ],
      record: {
        actor: SYSTEM,
        action: "identity.flags.update",
        target,
        before: { ...current.flags },
        after: { ...flags },
        result: "success",
      },
    });
  }
  return changes;
}

function isConditionFailure(error: unknown): boolean {
  return (
    error instanceof TransactionCanceledException &&
    (error.CancellationReasons ?? []).some(
      (r) => r.Code === "ConditionalCheckFailed",
    )
  );
}

export async function applySignInResolution(input: {
  identity: SignedInIdentity;
  groups: readonly string[];
  groupsOverage: boolean;
  expectedTid: string;
  requestId: string;
  now: Date;
}): Promise<SignInPlan> {
  const { identity, expectedTid, requestId, now } = input;
  const inTenant = identity.tid === expectedTid;
  const ctx: AuditContext = {
    actor: SYSTEM,
    requestId,
    now,
    sequence: { next: 0 },
  };

  if (inTenant) {
    // Fail closed: a binding failure fails the sign-in.
    await bindPasswordUserOnEntraSignIn(
      {
        oid: identity.oid,
        tid: identity.tid,
        ...(identity.upn ? { preferredUsername: identity.upn } : {}),
      },
      ctx,
    );
  }

  for (let attempt = 0; ; attempt += 1) {
    const [mappings, affiliation, scopes, pending, stored] = await Promise.all([
      inTenant
        ? readAll<GroupMapping>((c) => listGroupMappings(options(c)))
        : Promise.resolve([]),
      getAffiliation(identity.oid),
      readAll<AdminScope>((c) => listAdminScopes(identity.oid, options(c))),
      inTenant && identity.upn
        ? listPendingFor([identity.upn])
        : Promise.resolve([]),
      getItem(identPk(identity.oid), "META"),
    ]);
    const current: Snapshot = {
      affiliation,
      scopes,
      flags: {
        ambiguousMembership: stored?.ambiguousMembership === true,
        groupsOverage: stored?.groupsOverage === true,
      },
    };

    const plan = inTenant
      ? resolveSignIn({
          oid: identity.oid,
          tid: identity.tid,
          expectedTid,
          email: identity.email,
          upn: identity.upn,
          groups: input.groups,
          groupsOverage: input.groupsOverage,
          mappings,
          affiliation,
          adminScopes: scopes,
          pending,
        })
      : { ...EMPTY_PLAN, flags: current.flags };

    const changes = buildChanges(identity, plan, current, now);
    const base = ctx.sequence.next;
    const records: AuditRecord[] = [
      ...changes.map((c) => c.record),
      {
        actor: identity.oid,
        action: "auth.signin.success" as const,
        target: { type: "identity", id: identity.oid },
        after: { method: identity.authMethod },
        result: "success" as const,
      },
    ].map((r) => ({
      ...r,
      category: auditCategory(r.action, r.result),
      timestamp: now.toISOString(),
      requestId,
    }));
    const items: TransactItem[] = [
      ...changes.flatMap((c) => c.items),
      ...records.map((r, i) => auditPutItem(r, base + i)),
    ];
    if (items.length > MAX_TRANSACTION_ITEMS) {
      throw new Error(
        `sign-in plan needs ${items.length} transaction items (limit ${MAX_TRANSACTION_ITEMS})`,
      );
    }

    try {
      await getDocumentClient().send(
        new TransactWriteCommand({ TransactItems: items }),
      );
    } catch (error) {
      if (attempt === 0 && isConditionFailure(error)) continue;
      throw error;
    }
    ctx.sequence.next = base + records.length;
    for (const record of records) await deliverAuditLine(record);
    return plan;
  }
}
