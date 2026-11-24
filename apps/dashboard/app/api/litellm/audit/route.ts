import {
  DateRangeQuerySchema,
  LiteLLMAuditResponseSchema,
  liteLLMEdition,
} from "@llm-usage-lens/shared";

import { env } from "@/env";
import {
  jsonData,
  jsonError,
  parseSearchParams,
  withRoute,
} from "@/lib/api/respond";
import { recordLiteLLMAuditView } from "@/lib/data/litellm/audit-view";
import { listProxyAuditLog } from "@/lib/litellm/operations";
import {
  AuditQuerySchema,
  enabledOperations,
  liteLLMResponse,
  requireEnabled,
} from "@/lib/litellm/read-views";
import {
  adminOrAuditorRefusal,
  openModeRefusal,
} from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-litellm.md — "API routes" (/api/litellm/audit
// GET Admin, Auditor; audited view), "Audit" item 3 (LD15: only the allowlisted
// fields and the names of changed fields; entries from the dashboard are
// labelled), "Reads" (listProxyAuditLog bounds), "Audit" D-LF2 (OSS edition state), threat LT20.

export const dynamic = "force-dynamic";

const DASHBOARD_ACTOR_PREFIX = "llm-usage-lens:";

export const GET = withRoute(async (request, _ctx, session) => {
  const refused = openModeRefusal() ?? (await adminOrAuditorRefusal(session));
  if (refused) return refused;
  // D-LF2: the edition is checked before requireEnabled, which leaves an
  // Enterprise-only operation out on OSS and would answer OPERATION_DISABLED.
  if (liteLLMEdition(env.APP_ENV) === "oss") {
    return jsonError(
      403,
      "OPERATION_UNAVAILABLE",
      "This LiteLLM operation is unavailable on this edition",
    );
  }
  const { dateFrom, dateTo } = parseSearchParams(request, DateRangeQuerySchema);
  const { dir, ...query } = parseSearchParams(request, AuditQuerySchema);
  return liteLLMResponse(async () => {
    requireEnabled(await enabledOperations(), ["listProxyAuditLog"]);
    const res = await listProxyAuditLog({
      startDate: dateFrom,
      endDate: dateTo,
      ...query,
      sortOrder: dir,
    });
    // A view that cannot be recorded is not served (fail closed).
    await recordLiteLLMAuditView(session.user.oid);
    return jsonData(
      LiteLLMAuditResponseSchema.parse({
        items: res.audit_logs.map((row) => ({
          ...row,
          viaDashboard:
            row.changedBy?.startsWith(DASHBOARD_ACTOR_PREFIX) ?? false,
        })),
        page: res.page ?? query.page ?? 1,
        totalPages: res.total_pages ?? 1,
        total: res.total ?? res.audit_logs.length,
      }),
    );
  });
});
