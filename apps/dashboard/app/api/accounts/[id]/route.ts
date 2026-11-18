import {
  AccountIdSchema,
  AccountMetaSchema,
  UpdateAccountPatchSchema,
  appTeamNameKey,
} from "@llm-usage-lens/shared";

import {
  NotFoundError,
  jsonData,
  jsonError,
  parseInput,
  parseJsonBody,
  withRoute,
} from "@/lib/api/respond";
import { revalidateAccounts } from "@/lib/api/revalidate-accounts";
import {
  deactivateAccount,
  getAccountMeta,
  updateAccount,
} from "@/lib/data/account-meta";
import { hasAppTeamName } from "@/lib/data/access/app-teams";

export const revalidate = 3600;

type IdContext = { params: Promise<{ id: string }> };

const notFound = (id: string) => new NotFoundError(`Account ${id} not found`);

const patchHandler = withRoute(
  async (request, ctx) => {
    const id = parseInput((await ctx.params).id, AccountIdSchema);
    const patch = await parseJsonBody(request, UpdateAccountPatchSchema);
    if (patch.teamName !== undefined) {
      const stored = await getAccountMeta(id);
      const keepsName =
        stored !== null &&
        (patch.teamId === undefined || patch.teamId === stored.teamId) &&
        appTeamNameKey(patch.teamName) === appTeamNameKey(stored.teamName);
      if (!keepsName && (await hasAppTeamName(patch.teamName))) {
        return jsonError(
          409,
          "CONFLICT",
          "A created team already has this name",
        );
      }
    }
    const updated = await updateAccount(id, patch);
    if (!updated) throw notFound(id);
    const parsed = AccountMetaSchema.parse(updated);
    revalidateAccounts();
    return jsonData(parsed);
  },
  {
    requireAdmin: true,
    denied: { action: "account.update", pattern: "/api/accounts/[id]" },
  },
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
  {
    requireAdmin: true,
    denied: { action: "account.deactivate", pattern: "/api/accounts/[id]" },
  },
);

export const PATCH = (request: Request, ctx: IdContext) =>
  patchHandler(request, ctx);

export const DELETE = (request: Request, ctx: IdContext) =>
  deleteHandler(request, ctx);
