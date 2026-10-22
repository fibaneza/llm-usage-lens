import "server-only";

import { GetCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import {
  AccountMetaSchema,
  GSI1_NAME,
  META_SK,
  accountPk,
  deptPk,
} from "@bedrock-usage/shared";
import type { AccountMeta } from "@bedrock-usage/shared";

import { getDocumentClient, getTableName } from "@/lib/dynamodb";

// Source: docs/specs/2026-05-15-data-model.md — "Entity: AccountMeta" access
// patterns; Rule 20.6 (paginate), Rule 60.17 (parse failures propagate).

export async function getAccountMeta(
  accountId: string,
): Promise<AccountMeta | null> {
  const { Item } = await getDocumentClient().send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: accountPk(accountId), SK: META_SK },
    }),
  );
  return Item ? AccountMetaSchema.parse(Item) : null;
}

export async function getAllAccounts(): Promise<AccountMeta[]> {
  const accounts: AccountMeta[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await getDocumentClient().send(
      new ScanCommand({
        TableName: getTableName(),
        FilterExpression: "SK = :meta",
        ExpressionAttributeValues: { ":meta": META_SK },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of page.Items ?? []) {
      accounts.push(AccountMetaSchema.parse(item));
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return accounts;
}

export async function getAccountsByDepartment(
  departmentId: string,
): Promise<AccountMeta[]> {
  const accounts: AccountMeta[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await getDocumentClient().send(
      new QueryCommand({
        TableName: getTableName(),
        IndexName: GSI1_NAME,
        KeyConditionExpression: "gsi1pk = :pk",
        ExpressionAttributeValues: { ":pk": deptPk(departmentId) },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of page.Items ?? []) {
      accounts.push(AccountMetaSchema.parse(item));
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return accounts;
}
