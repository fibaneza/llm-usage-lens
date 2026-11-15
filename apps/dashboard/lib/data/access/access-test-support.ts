// Test-only helpers for the R2a access data layer suites (not imported by
// production code). Rule 60.22: tests run against DynamoDB Local, no mocks of
// the data layer; the only injected behaviour is a client wrapper that fails a
// chosen command so the `failed` audit path can be exercised.
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { vi } from "vitest";

import { TEST_TABLE_NAME, putRaw, testDoc } from "@/test/test-support";

import {
  adminScopeSk,
  adminsGsi1pk,
  identPk,
  membersGsi1pk,
  AFFILIATION_SK,
} from "./keys";
import type { AccessResult, AuditContext, Page } from "./result";

export { GOVERNANCE_PK } from "./keys";

export const NOW = new Date("2026-11-14T10:00:00.000Z");
export const DAY = "2026-11-14";
export const ACTOR = "00000000-0000-4000-8000-0000000000aa";
export const OID_A = "00000000-0000-4000-8000-000000000001";
export const OID_B = "00000000-0000-4000-8000-000000000002";
export const CURSOR_SECRET = "test-cursor-secret";

// `sequence` is the per-request audit index counter (spec: "Audit log" {nn} is
// the index within the request): domain functions take their record's index
// from it, so several calls sharing one context never collide.
export const ctxAt = (now: Date = NOW, requestId = "req-1"): AuditContext => ({
  actor: ACTOR,
  requestId,
  now,
  sequence: { next: 0 },
});

export function ok<T>(result: AccessResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.code}`);
  return result.value;
}

// Lazy import: the suites' vi.mock("@/lib/dynamodb") factory loads this file,
// and ./audit imports @/lib/dynamodb, so a static import would deadlock.
export async function auditRecords(day: string = DAY) {
  const { listAuditRecords } = await import("./audit");
  return listAuditRecords(day);
}

// Follows opaque cursors to the end; fails the test on an error result.
export async function collectPages<T>(
  fetchPage: (cursor?: string) => Promise<AccessResult<Page<T>>>,
): Promise<{ items: T[]; pages: number }> {
  const items: T[] = [];
  let pages = 0;
  let cursor: string | undefined;
  do {
    const page = ok(await fetchPage(cursor));
    items.push(...page.items);
    pages += 1;
    cursor = page.cursor;
  } while (cursor && pages < 100);
  return { items, pages };
}

// Fixtures for SSO-sourced items: no R2a domain function creates them (sign-in
// sync is R2b), so they are written through the key builders.
export async function seedSsoAffiliation(
  oid: string,
  teamId: string,
): Promise<void> {
  await putRaw({
    PK: identPk(oid),
    SK: AFFILIATION_SK,
    gsi1pk: membersGsi1pk(teamId),
    gsi1sk: identPk(oid),
    oid,
    teamId,
    source: "sso",
    version: 1,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    createdBy: "system",
  });
}

export async function seedSsoAdminScope(
  oid: string,
  scopeType: "team" | "department",
  scopeId: string,
): Promise<void> {
  await putRaw({
    PK: identPk(oid),
    SK: adminScopeSk(scopeType, scopeId),
    gsi1pk: adminsGsi1pk(scopeType, scopeId),
    gsi1sk: identPk(oid),
    oid,
    scopeType,
    scopeId,
    source: "sso",
    version: 1,
    createdAt: NOW.toISOString(),
    createdBy: "system",
  });
}

// Fault injection: set a flag, the next matching command throws. Used from
// `vi.mock("@/lib/dynamodb", () => import("./access-test-support").then(m => m.faultyDynamodb()))`.
export const faults = { transact: false, put: false };

export function resetFaults(): void {
  faults.transact = false;
  faults.put = false;
}

export async function faultyDynamodb() {
  const actual =
    await vi.importActual<typeof import("@/lib/dynamodb")>("@/lib/dynamodb");
  return {
    ...actual,
    getDocumentClient: () => {
      const real = actual.getDocumentClient();
      return new Proxy(real, {
        get(target, prop) {
          if (prop === "send") {
            return async (command: { constructor: { name: string } }) => {
              const name = command.constructor.name;
              if (faults.transact && name === "TransactWriteCommand") {
                throw new Error("injected transaction failure");
              }
              if (faults.put && name === "PutCommand") {
                throw new Error("injected put failure");
              }
              return (target.send as (c: unknown) => Promise<unknown>).call(
                target,
                command,
              );
            };
          }
          const value = Reflect.get(target, prop, target) as unknown;
          return typeof value === "function"
            ? (value as (...a: unknown[]) => unknown).bind(target)
            : value;
        },
      });
    },
  };
}

// Whole-table dump as one string, for "never stored" assertions (T24, T27).
export async function dumpTable(): Promise<string> {
  const items: unknown[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await testDoc().send(
      new ScanCommand({
        TableName: TEST_TABLE_NAME,
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...(page.Items ?? []));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return JSON.stringify(items);
}
