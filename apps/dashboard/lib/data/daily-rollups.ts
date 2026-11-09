import "server-only";

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  DatedDailyRollupSchema,
  GSI1_NAME,
  accountPk,
  dailySk,
  datePk,
} from "@llm-usage-lens/shared";
import type { DatedDailyRollup } from "@llm-usage-lens/shared";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";

// Source: docs/specs/2026-05-15-data-model.md — "Entity: DailyRollup" access
// patterns + "Query Pagination"; Rules 20.1 (UTC days), 20.6, 60.17.

type QueryInput = ConstructorParameters<typeof QueryCommand>[0];

const DAILY_SK_PREFIX = dailySk("");

// Items stored before `date` existed carry the day only in SK, so derive it
// there (data-model spec, "`date` attribute" — no backfill required). A stored
// `date` that disagrees with the SK day fails the read rather than silently
// picking one (Rule 60.17); key attributes are stripped by the schema's object
// parsing.
function parseRollup(item: Record<string, unknown>): DatedDailyRollup {
  const sk = typeof item.SK === "string" ? item.SK : "";
  const derived = sk.startsWith(DAILY_SK_PREFIX)
    ? sk.slice(DAILY_SK_PREFIX.length)
    : undefined;
  if (
    derived !== undefined &&
    typeof item.date === "string" &&
    item.date !== derived
  ) {
    throw new Error(
      `DailyRollup stored date ${item.date} disagrees with SK day ${derived}`,
    );
  }
  return DatedDailyRollupSchema.parse({ date: derived, ...item });
}

async function queryAllRollups(
  input: Omit<QueryInput, "TableName" | "ExclusiveStartKey">,
): Promise<DatedDailyRollup[]> {
  const rollups: DatedDailyRollup[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await getDocumentClient().send(
      new QueryCommand({
        ...input,
        TableName: getTableName(),
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of page.Items ?? []) {
      rollups.push(parseRollup(item));
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return rollups;
}

export function getDailyRollups(
  accountId: string,
  dateFrom: string,
  dateTo: string,
): Promise<DatedDailyRollup[]> {
  return queryAllRollups({
    KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
    ExpressionAttributeValues: {
      ":pk": accountPk(accountId),
      ":from": dailySk(dateFrom),
      ":to": dailySk(dateTo),
    },
    ScanIndexForward: true,
  });
}

export function getRollupsByDate(date: string): Promise<DatedDailyRollup[]> {
  return queryAllRollups({
    IndexName: GSI1_NAME,
    KeyConditionExpression: "gsi1pk = :pk",
    ExpressionAttributeValues: { ":pk": datePk(date) },
  });
}
