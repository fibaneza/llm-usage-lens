import {
  AccountIdSchema,
  AccountMetaSchema,
  UpdateAccountPatchSchema,
} from "@bedrock-usage/shared";

import {
  NotFoundError,
  jsonData,
  parseInput,
  parseJsonBody,
  withRoute,
} from "@/lib/api/respond";
import { revalidateAccounts } from "@/lib/api/revalidate-accounts";
import { deactivateAccount, updateAccount } from "@/lib/data/account-meta";

export const revalidate = 3600;

type IdContext = { params: Promise<{ id: string }> };

const notFound = (id: string) => new NotFoundError(`Account ${id} not found`);

const patchHandler = withRoute(
  async (request, ctx) => {
    const id = parseInput((await ctx.params).id, AccountIdSchema);
    const patch = await parseJsonBody(request, UpdateAccountPatchSchema);
    const updated = await updateAccount(id, patch);
    if (!updated) throw notFound(id);
    const parsed = AccountMetaSchema.parse(updated);
    revalidateAccounts();
    return jsonData(parsed);
  },
  { requireAdmin: true },
);

const deleteHandler = withRoute(
  async (_request, ctx) => {
    const id = parseInput((await ctx.params).id, AccountIdSchema);
    const deactivated = await deactivateAccount(id);
    if (!deactivated) throw notFound(id);
    const parsed = AccountMetaSchema.parse(deactivated);
    revalidateAccounts();
    return jsonData(parsed);
  },
  { requireAdmin: true },
);

export const PATCH = (request: Request, ctx: IdContext) =>
  patchHandler(request, ctx);

export const DELETE = (request: Request, ctx: IdContext) =>
  deleteHandler(request, ctx);
