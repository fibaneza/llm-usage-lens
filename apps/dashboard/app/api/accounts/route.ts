import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  AccountListSchema,
  AccountMetaSchema,
  CreateAccountInputSchema,
} from "@llm-usage-lens/shared";

import { revalidateAccounts } from "@/lib/api/revalidate-accounts";
import {
  jsonData,
  jsonError,
  parseJsonBody,
  withRoute,
} from "@/lib/api/respond";
import { getAllAccountsCached } from "@/lib/api/cached-reads";
import { scopeFor } from "@/lib/api/scoped-rollups";
import { can } from "@/lib/auth/policy";
import { createAccount } from "@/lib/data/account-meta";

export const revalidate = 3600;

export const GET = withRoute(async (_request, _ctx, session) => {
  const accounts = AccountListSchema.parse(await getAllAccountsCached());
  const scope = await scopeFor(session, accounts);
  return jsonData(
    accounts.filter((account) =>
      can(scope, "read", {
        kind: "team",
        teamId: account.teamId,
        departmentId: account.departmentId,
        date: account.createdAt,
      }),
    ),
  );
});

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
  {
    requireAdmin: true,
    denied: { action: "account.create", pattern: "/api/accounts" },
  },
);

export const POST = (request: Request) =>
  createHandler(request, { params: Promise.resolve({}) });
