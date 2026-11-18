import {
  BudgetResetCountsQuerySchema,
  runBounded,
} from "@llm-usage-lens/shared";
import type { BudgetResetCounts } from "@llm-usage-lens/shared";

import { jsonData, parseSearchParams, withRoute } from "@/lib/api/respond";
import { scopeFor } from "@/lib/api/scoped-rollups";
import { can } from "@/lib/auth/policy";
import { getAllAccounts } from "@/lib/data/account-meta";
import { listResetsOf, listTeamResets } from "@/lib/data/budget-reset-counts";
import type { LedgerRow } from "@/lib/data/budget-reset-counts";

// Source: docs/specs/2026-11-10-litellm.md — MG-D9, MG-D10; Access Control —
// "Permission matrix" (`GET /api/budget-resets`). Global readers see every
// team, a Lead the teams in scope, anyone else only their own count. The
// policy module filters the teams and decides per-member rows (`user-rows`,
// which honours the per-user approval in prod).

export const dynamic = "force-dynamic";

const READ_CONCURRENCY = 5;

const tally = (rows: readonly LedgerRow[]) => ({
  count: rows.length,
  amount: rows.reduce((sum, row) => sum + row.amount, 0),
});

export const GET = withRoute(async (request, _ctx, session) => {
  const { dateFrom, dateTo, teamId } = parseSearchParams(
    request,
    BudgetResetCountsQuerySchema,
  );

  const departments = new Map<string, string>();
  for (const account of await getAllAccounts()) {
    if (!departments.has(account.teamId)) {
      departments.set(account.teamId, account.departmentId);
    }
  }
  const scope = await scopeFor(session, [], {
    teamIds: [...departments.keys()],
    departmentIds: [...new Set(departments.values())],
  });

  const visible = [...departments].filter(
    ([id, departmentId]) =>
      (teamId === undefined || id === teamId) &&
      (scope.global ||
        scope.teamScopes.has(id) ||
        scope.departmentScopes.has(departmentId)),
  );

  const teams: BudgetResetCounts["teams"] = [];
  await runBounded(visible, READ_CONCURRENCY, async ([id, departmentId]) => {
    const rows = await listTeamResets(id, dateFrom, dateTo);
    const perMember = can(scope, "read", {
      kind: "user-rows",
      teamId: id,
      departmentId,
    });
    const byOid = new Map<string, LedgerRow[]>();
    if (perMember) {
      for (const row of rows) {
        byOid.set(row.oid, [...(byOid.get(row.oid) ?? []), row]);
      }
    }
    teams.push({
      teamId: id,
      ...tally(rows),
      ...(perMember
        ? {
            members: [...byOid]
              .map(([oid, own]) => ({ oid, ...tally(own) }))
              .sort((a, b) => a.oid.localeCompare(b.oid)),
          }
        : {}),
    });
  });
  teams.sort((a, b) => a.teamId.localeCompare(b.teamId));

  const own = tally(await listResetsOf(session.user.oid, dateFrom, dateTo));
  return jsonData({ teams, own });
});
