import "server-only";

import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  AccountMetaSchema,
  GSI1_NAME,
  META_SK,
  UpdateAccountPatchSchema,
  accountPk,
  deptPk,
} from "@llm-usage-lens/shared";
import type {
  AccountMeta,
  CreateAccountInput,
  UpdateAccountPatch,
} from "@llm-usage-lens/shared";

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

export async function createAccount(
  input: CreateAccountInput,
): Promise<AccountMeta> {
  const now = new Date().toISOString();
  const account = AccountMetaSchema.parse({
    ...input,
    active: true,
    createdAt: now,
    updatedAt: now,
  });
  await getDocumentClient().send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        ...account,
        PK: accountPk(account.accountId),
        SK: META_SK,
        gsi1pk: deptPk(account.departmentId),
        gsi1sk: accountPk(account.accountId),
      },
      ConditionExpression: "attribute_not_exists(PK)",
    }),
  );
  return account;
}

async function updateExisting(
  accountId: string,
  fields: Record<string, unknown>,
): Promise<AccountMeta | null> {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets: string[] = [];
  Object.entries({ ...fields, updatedAt: new Date().toISOString() }).forEach(
    ([key, value], i) => {
      names[`#f${i}`] = key;
      values[`:v${i}`] = value;
      sets.push(`#f${i} = :v${i}`);
    },
  );
  if (typeof fields.departmentId === "string") {
    names["#g"] = "gsi1pk";
    values[":g"] = deptPk(fields.departmentId);
    sets.push("#g = :g");
  }
  try {
    const { Attributes } = await getDocumentClient().send(
      new UpdateCommand({
        TableName: getTableName(),
        Key: { PK: accountPk(accountId), SK: META_SK },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ConditionExpression: "attribute_exists(PK)",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      }),
    );
    return AccountMetaSchema.parse(Attributes);
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return null;
    throw error;
  }
}

export async function updateAccount(
  accountId: string,
  patch: UpdateAccountPatch,
): Promise<AccountMeta | null> {
  return updateExisting(accountId, UpdateAccountPatchSchema.parse(patch));
}

export async function deactivateAccount(
  accountId: string,
): Promise<AccountMeta | null> {
  return updateExisting(accountId, { active: false });
}
