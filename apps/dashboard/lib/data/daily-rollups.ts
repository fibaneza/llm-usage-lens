import "server-only";

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  DailyRollupSchema,
  GSI1_NAME,
  accountPk,
  dailySk,
  datePk,
} from "@bedrock-usage/shared";
import type { DailyRollup } from "@bedrock-usage/shared";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";

// Source: docs/specs/2026-05-15-data-model.md — "Entity: DailyRollup" access
// patterns + "Query Pagination"; Rules 20.1 (UTC days), 20.6, 60.17.

type QueryInput = ConstructorParameters<typeof QueryCommand>[0];

async function queryAllRollups(
  input: Omit<QueryInput, "TableName" | "ExclusiveStartKey">,
): Promise<DailyRollup[]> {
  const rollups: DailyRollup[] = [];
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
      rollups.push(DailyRollupSchema.parse(item));
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return rollups;
}

export function getDailyRollups(
  accountId: string,
  dateFrom: string,
  dateTo: string,
): Promise<DailyRollup[]> {
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

export function getRollupsByDate(date: string): Promise<DailyRollup[]> {
  return queryAllRollups({
    IndexName: GSI1_NAME,
    KeyConditionExpression: "gsi1pk = :pk",
    ExpressionAttributeValues: { ":pk": datePk(date) },
  });
}
