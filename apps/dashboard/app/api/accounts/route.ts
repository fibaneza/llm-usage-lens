import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  AccountListSchema,
  AccountMetaSchema,
  CreateAccountInputSchema,
} from "@bedrock-usage/shared";

import { revalidateAccounts } from "@/lib/api/revalidate-accounts";
import {
  jsonData,
  jsonError,
  parseJsonBody,
  withRoute,
} from "@/lib/api/respond";
import { getAllAccountsCached } from "@/lib/api/cached-reads";
import { createAccount } from "@/lib/data/account-meta";

export const revalidate = 3600;

export const GET = withRoute(async () =>
  jsonData(AccountListSchema.parse(await getAllAccountsCached())),
);

const createHandler = withRoute(
  async (request) => {
    const input = await parseJsonBody(request, CreateAccountInputSchema);
    try {
      const created = AccountMetaSchema.parse(await createAccount(input));
      revalidateAccounts();
      return jsonData(created);
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return jsonError(400, "BAD_REQUEST", "Account already exists");
      }
      throw error;
    }
  },
  { requireAdmin: true },
);

export const POST = (request: Request) =>
  createHandler(request, { params: Promise.resolve({}) });
