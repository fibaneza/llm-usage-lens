import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  AccountListSchema,
  AccountMetaSchema,
  CreateAccountInputSchema,
} from "@bedrock-usage/shared";

import {
  jsonData,
  jsonError,
  parseJsonBody,
  withRoute,
} from "@/lib/api/respond";
import { createAccount, getAllAccounts } from "@/lib/data/account-meta";

export const revalidate = 3600;

export const GET = withRoute(async () =>
  jsonData(AccountListSchema.parse(await getAllAccounts())),
);

const createHandler = withRoute(async (request) => {
  const input = await parseJsonBody(request, CreateAccountInputSchema);
  try {
    return jsonData(AccountMetaSchema.parse(await createAccount(input)));
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      return jsonError(400, "BAD_REQUEST", "Account already exists");
    }
    throw error;
  }
});

export const POST = (request: Request) =>
  createHandler(request, { params: Promise.resolve({}) });
