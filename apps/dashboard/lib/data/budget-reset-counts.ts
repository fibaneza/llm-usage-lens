import "server-only";

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { GSI1_NAME } from "@llm-usage-lens/shared";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";

import { bResetPk, bResetsGsi1pk } from "./budget-resets-keys";

// Source: docs/specs/2026-11-10-litellm.md — MG-D9: the ledger rows whose UTC
// timestamp falls in the range (Rule 20.1). Pages loop on LastEvaluatedKey
// (Rule 20.6). The key range is [dateFrom, dateTo + "U"): "U" sorts above the
// "T" of every timestamp on dateTo and below the next day.
export type LedgerRow = { oid: string; amount: number };

async function queryLedger(
  index: boolean,
  partition: string,
  dateFrom: string,
  dateTo: string,
): Promise<LedgerRow[]> {
  const pk = index ? "gsi1pk" : "PK";
  const sk = index ? "gsi1sk" : "SK";
  const rows: LedgerRow[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await getDocumentClient().send(
      new QueryCommand({
        TableName: getTableName(),
        ...(index ? { IndexName: GSI1_NAME } : {}),
        KeyConditionExpression: `${pk} = :pk AND ${sk} BETWEEN :from AND :to`,
        ExpressionAttributeValues: {
          ":pk": partition,
          ":from": dateFrom,
          ":to": `${dateTo}U`,
        },
        ProjectionExpression: "#oid, #amount",
        ExpressionAttributeNames: { "#oid": "oid", "#amount": "amount" },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of page.Items ?? []) {
      rows.push({ oid: String(item.oid), amount: Number(item.amount) });
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return rows;
}

export const listTeamResets = (
  teamId: string,
  dateFrom: string,
  dateTo: string,
) => queryLedger(false, bResetPk(teamId), dateFrom, dateTo);

export const listResetsOf = (oid: string, dateFrom: string, dateTo: string) =>
  queryLedger(true, bResetsGsi1pk(oid), dateFrom, dateTo);
