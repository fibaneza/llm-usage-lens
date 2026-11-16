import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceInUseException,
  ResourceNotFoundException,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

import {
  AFFILIATION_SK,
  META_SK,
  adminScopeSk,
  adminsGsi1pk,
  identPk,
  membersGsi1pk,
} from "../lib/data/access/keys-test-support";
import { E2E_PROBE_TABLE } from "../e2e/support/constants";

// Test-only (Playwright e2e cannot import the AWS SDK itself - Rule 10.5; this
// file sits under test/**). Seeds the per-role probe of Phase 4R.5 Verify
// ("seeded probe per role") into DynamoDB Local: one identity per role with the
// affiliation or admin scope that role needs, on top of `pnpm db:seed` data.
// Local endpoint only; refuses anything else. Writes to its own table so the
// shared bedrock-usage table (other worktrees' e2e) is never touched
// (coordinator rule, 2026-11-16); the playwright.config.ts `role-probe` project points its own dev server at
// this table.
const ENDPOINT = "http://localhost:8000";
export const PROBE_TABLE = E2E_PROBE_TABLE;
const TABLE = PROBE_TABLE;
const NOW = "2026-11-16T00:00:00.000Z";

export type ProbeRole = {
  name: string;
  oid: string;
  roles: string[];
  memberTeam?: string;
  teamAdmin?: string;
  departmentAdmin?: string;
};

export const PROBE_TEAM = "team-payments";
export const PROBE_DEPARTMENT = "dept-engineering";

export const PROBE_ROLES: readonly ProbeRole[] = [
  { name: "internal-admin", oid: "r5-admin", roles: ["internal-admin"] },
  { name: "internal-org-admin", oid: "r5-org", roles: ["internal-org-admin"] },
  { name: "internal-auditor", oid: "r5-auditor", roles: ["internal-auditor"] },
  { name: "viewer-no-team", oid: "r5-viewer", roles: ["internal-viewer"] },
  {
    name: "member",
    oid: "r5-member",
    roles: ["internal-viewer"],
    memberTeam: PROBE_TEAM,
  },
  {
    name: "team-admin",
    oid: "r5-team-admin",
    roles: ["internal-viewer"],
    teamAdmin: PROBE_TEAM,
  },
  {
    name: "department-admin",
    oid: "r5-dept-admin",
    roles: ["internal-viewer"],
    departmentAdmin: PROBE_DEPARTMENT,
  },
];

const client = new DynamoDBClient({
  endpoint: ENDPOINT,
  region: "us-east-1",
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
});
const doc = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});
const put = (Item: Record<string, unknown>) =>
  doc.send(new PutCommand({ TableName: TABLE, Item }));

// Playwright's loader cannot import the repo-root scripts/ package, so the
// table definition is copied from scripts/create-table.ts (Data Model spec -
// "Table Definition") and the base data comes from the `pnpm db:seed` CLI run
// as a child process aimed at the probe table.
async function ensureTable(): Promise<void> {
  try {
    await client.send(new DescribeTableCommand({ TableName: TABLE }));
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) throw error;
    try {
      await client.send(
        new CreateTableCommand({
          TableName: TABLE,
          BillingMode: "PAY_PER_REQUEST",
          AttributeDefinitions: [
            { AttributeName: "PK", AttributeType: "S" },
            { AttributeName: "SK", AttributeType: "S" },
            { AttributeName: "gsi1pk", AttributeType: "S" },
            { AttributeName: "gsi1sk", AttributeType: "S" },
          ],
          KeySchema: [
            { AttributeName: "PK", KeyType: "HASH" },
            { AttributeName: "SK", KeyType: "RANGE" },
          ],
          GlobalSecondaryIndexes: [
            {
              IndexName: "GSI1",
              KeySchema: [
                { AttributeName: "gsi1pk", KeyType: "HASH" },
                { AttributeName: "gsi1sk", KeyType: "RANGE" },
              ],
              Projection: { ProjectionType: "ALL" },
            },
          ],
        }),
      );
    } catch (createError) {
      if (!(createError instanceof ResourceInUseException)) throw createError;
    }
  }
  await waitUntilTableExists({ client, maxWaitTime: 30 }, { TableName: TABLE });
}

export async function seedRoleProbe(): Promise<void> {
  // Overlay, no reset: idempotent, every worker may run this. Endpoint is the
  // hard-coded local one; the seed CLI refuses non-local endpoints too.
  await ensureTable();
  await promisify(execFile)("pnpm", ["db:seed"], {
    // ESM-safe: this file is loaded as ESM by Playwright, so __dirname is undefined.
    // From apps/dashboard/test/ three levels up is the repo root.
    cwd: resolve(fileURLToPath(new URL("../../..", import.meta.url))),
    env: {
      ...process.env,
      DYNAMODB_ENDPOINT: ENDPOINT,
      DYNAMODB_TABLE_NAME: TABLE,
    },
  });
  for (const r of PROBE_ROLES) {
    await put({
      PK: identPk(r.oid),
      SK: META_SK,
      gsi1pk: "IDENTS",
      gsi1sk: identPk(r.oid),
      oid: r.oid,
      tid: "e2e-tenant",
      email: `${r.oid}@example.com`,
      displayName: r.name,
      lastSignInAt: NOW,
      lastSeenRoles: r.roles,
      authMethod: "entra",
      version: 1,
    });
    if (r.memberTeam) {
      await put({
        PK: identPk(r.oid),
        SK: AFFILIATION_SK,
        gsi1pk: membersGsi1pk(r.memberTeam),
        gsi1sk: identPk(r.oid),
        oid: r.oid,
        teamId: r.memberTeam,
        source: "ui",
        version: 1,
        createdAt: NOW,
        updatedAt: NOW,
        createdBy: "probe",
      });
    }
    for (const [type, id] of [
      ["team", r.teamAdmin],
      ["department", r.departmentAdmin],
    ] as const) {
      if (!id) continue;
      await put({
        PK: identPk(r.oid),
        SK: adminScopeSk(type, id),
        gsi1pk: adminsGsi1pk(type, id),
        gsi1sk: identPk(r.oid),
        oid: r.oid,
        scopeType: type,
        scopeId: id,
        source: "ui",
        version: 1,
        createdAt: NOW,
        createdBy: "probe",
      });
    }
  }
}
