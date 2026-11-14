// Test-only helpers shared by the 4R.4 slice 1 route suites (group mappings,
// governance, role grants). Not imported by production code. Rule 60.22: the
// routes run against DynamoDB Local; only `@/auth` is mocked by the suites.
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ApiErrorBodySchema, ApiErrorCodeSchema } from "@llm-usage-lens/shared";
import { expect, vi } from "vitest";

import { auth } from "@/auth";
import { listAuditRecords } from "@/lib/data/access/audit";
import { TEST_TABLE_NAME, testDoc } from "@/test/test-support";

export const HOST = "localhost:3000";
export const SAME_ORIGIN = `http://${HOST}`;

export const SESSIONS = {
  admin: { oid: "oid-admin", name: "A", roles: ["internal-admin"] },
  auditor: { oid: "oid-auditor", name: "U", roles: ["internal-auditor"] },
  orgAdmin: { oid: "oid-orgadmin", name: "O", roles: ["internal-org-admin"] },
  viewer: { oid: "oid-viewer", name: "V", roles: ["internal-viewer"] },
  noRoles: { oid: "oid-noroles", name: "N", roles: [] },
} as const;
export type Caller = keyof typeof SESSIONS;

export function signInAs(caller: Caller | null): void {
  vi.mocked(auth).mockResolvedValue(
    (caller === null
      ? null
      : {
          user: { ...SESSIONS[caller], roles: [...SESSIONS[caller].roles] },
        }) as never,
  );
}

type Handler = (
  request: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

export type Call = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  params?: Record<string, string>;
  // An object is JSON-encoded; a string is sent verbatim.
  body?: unknown;
  // `null` omits the header.
  origin?: string | null;
  contentType?: string | null;
};

export function invoke(handler: unknown, call: Call): Promise<Response> {
  const isWrite = call.method !== "GET";
  const contentType =
    call.contentType === undefined ? "application/json" : call.contentType;
  const origin = call.origin === undefined ? SAME_ORIGIN : call.origin;
  const body =
    call.body === undefined
      ? undefined
      : typeof call.body === "string"
        ? call.body
        : JSON.stringify(call.body);
  return (handler as Handler)(
    new Request(`http://${HOST}${call.path}`, {
      method: call.method,
      headers: {
        host: HOST,
        ...(isWrite && origin !== null ? { origin } : {}),
        ...(contentType !== null ? { "content-type": contentType } : {}),
      },
      body,
    }),
    { params: Promise.resolve(call.params ?? {}) },
  );
}

export function expectNoStore(res: Response): void {
  expect(res.headers.get("cache-control")).toBe("private, no-store");
}

// Asserts the `{ error: { code, message } }` envelope, the registry code, the
// status and the no-store header; returns the parsed body.
export async function expectError(
  res: Response,
  status: number,
  code: string,
): Promise<{ error: { code: string; message: string } }> {
  expect(res.status).toBe(status);
  expectNoStore(res);
  const raw: unknown = await res.json();
  const parsed = ApiErrorBodySchema.parse(raw);
  expect(ApiErrorCodeSchema.parse(parsed.error.code)).toBe(code);
  expect((raw as { data?: unknown }).data).toBeUndefined();
  return parsed;
}

// Asserts a 2xx `{ data }` envelope with the no-store header; returns data.
export async function expectData<T = unknown>(
  res: Response,
  statuses: number[] = [200],
): Promise<T> {
  expect(statuses).toContain(res.status);
  expectNoStore(res);
  const raw = (await res.json()) as { data?: T; error?: unknown };
  expect(raw.error).toBeUndefined();
  expect(raw).toHaveProperty("data");
  return raw.data as T;
}

// Every stored item except audit records: the "nothing was read or written"
// check for a refusal (the denied record itself is an audit item).
export async function nonAuditItems(): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await testDoc().send(
      new ScanCommand({
        TableName: TEST_TABLE_NAME,
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of page.Items ?? []) {
      if (!String(item.PK).startsWith("AUDIT#")) items.push(item);
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return items.sort((a, b) =>
    `${String(a.PK)}|${String(a.SK)}`.localeCompare(
      `${String(b.PK)}|${String(b.SK)}`,
    ),
  );
}

// Audit records written today (UTC). The routes stamp them with the real clock.
export async function auditToday() {
  return listAuditRecords(new Date().toISOString().slice(0, 10));
}

export async function deniedToday() {
  return (await auditToday()).filter((r) => r.result === "denied");
}
