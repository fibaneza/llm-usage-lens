import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  DailyRollupItemSchema,
  META_SK,
  SYNC_SK,
  SYSTEM_PK,
  accountPk,
  dailySk,
  datePk,
  deptPk,
  runBounded,
} from "@llm-usage-lens/shared";

import {
  TEAM_LEAD_EMAIL,
  TEAM_LEAD_NAME,
  TEAM_LEAD_OID,
} from "../../apps/dashboard/lib/auth/team-lead-identity";
import {
  IDENTS_GSI1PK,
  adminScopeSk,
  adminsGsi1pk,
  identPk,
} from "../../apps/dashboard/lib/data/access/keys";
import type { SeedData } from "./seed-data";

// Source: docs/specs/2026-05-15-data-model.md — "Entity Map" (key layout).
const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 50;
const CONCURRENCY = 8;

type Item = Record<string, unknown>;
type WriteRequests = NonNullable<
  ConstructorParameters<typeof BatchWriteCommand>[0]["RequestItems"]
>[string];

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function writeBatch(
  doc: DynamoDBDocumentClient,
  tableName: string,
  items: Item[],
): Promise<void> {
  let pending: WriteRequests = items.map((Item) => ({ PutRequest: { Item } }));

  for (let attempt = 0; pending.length > 0; attempt += 1) {
    if (attempt >= MAX_ATTEMPTS) {
      throw new Error(
        `BatchWrite left ${pending.length} unprocessed items after ${MAX_ATTEMPTS} attempts`,
      );
    }
    if (attempt > 0) await sleep(BASE_BACKOFF_MS * 2 ** attempt);
    const response = await doc.send(
      new BatchWriteCommand({ RequestItems: { [tableName]: pending } }),
    );
    pending = response.UnprocessedItems?.[tableName] ?? [];
  }
}

// Dev sign-in as a lead (Access Control spec - "Dev sign-in as a lead", D14):
// a stored identity with a real team admin scope on the first seeded team,
// through the same items the app writes. Skipped when no team is seeded.
function teamLeadItems(data: SeedData): Item[] {
  const team = data.accounts[0]?.teamId;
  if (!team) return [];
  const at = data.accounts[0]?.createdAt ?? "2026-01-05T08:00:00.000Z";
  return [
    {
      PK: identPk(TEAM_LEAD_OID),
      SK: META_SK,
      gsi1pk: IDENTS_GSI1PK,
      gsi1sk: identPk(TEAM_LEAD_OID),
      oid: TEAM_LEAD_OID,
      tid: "local",
      email: TEAM_LEAD_EMAIL,
      displayName: TEAM_LEAD_NAME,
      lastSignInAt: at,
      lastSeenRoles: ["internal-viewer"],
      authMethod: "local",
      version: 1,
    },
    {
      PK: identPk(TEAM_LEAD_OID),
      SK: adminScopeSk("team", team),
      gsi1pk: adminsGsi1pk("team", team),
      gsi1sk: identPk(TEAM_LEAD_OID),
      oid: TEAM_LEAD_OID,
      scopeType: "team",
      scopeId: team,
      source: "ui",
      version: 1,
      createdAt: at,
      createdBy: "seed",
    },
  ];
}

export async function writeSeed(
  doc: DynamoDBDocumentClient,
  tableName: string,
  data: SeedData,
): Promise<{ accounts: number; rollups: number }> {
  const items: Item[] = [
    ...data.accounts.map((account) => ({
      ...account,
      PK: accountPk(account.accountId),
      SK: META_SK,
      gsi1pk: deptPk(account.departmentId),
      gsi1sk: accountPk(account.accountId),
    })),
    // parse() throws on a date/key mismatch or cost-invariant violation so a
    // bad seed never reaches the table (Rule 60.17).
    ...data.rollups.map((rollup) =>
      DailyRollupItemSchema.parse({
        ...rollup,
        PK: accountPk(rollup.accountId),
        SK: dailySk(rollup.date),
        gsi1pk: datePk(rollup.date),
        gsi1sk: accountPk(rollup.accountId),
      }),
    ),
  ];
  items.push(...teamLeadItems(data));
  if (data.syncStatus) {
    items.push({ ...data.syncStatus, PK: SYSTEM_PK, SK: SYNC_SK });
  }

  const batches: Item[][] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    batches.push(items.slice(i, i + BATCH_SIZE));
  }
  await runBounded(batches, CONCURRENCY, (batch) =>
    writeBatch(doc, tableName, batch),
  );

  return { accounts: data.accounts.length, rollups: data.rollups.length };
}
