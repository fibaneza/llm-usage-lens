import { IdParamSchema } from "@/lib/api/id-param";
import { notFoundResponse } from "@/lib/api/matrix-route";
import { jsonData, parseInput, withRoute } from "@/lib/api/respond";
import { withLiteLLMSuggestion } from "@/lib/manage/litellm-email-suggestion";
import {
  loadIdentityDetail,
  mayReadIdentityDetail,
} from "@/lib/manage/user-detail";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (`GET /api/identities/[oid]`: internal-admin, internal-org-admin,
// internal-auditor, D-US11; everyone else 403 before the lookup; an unknown
// oid 404; from UP1, 2026-11-25, `litellm.state` "match" only to a caller who
// may link), threat T-US1. Read per request, never cached (Rule 60.10).

export const dynamic = "force-dynamic";

export const GET = withRoute(
  async (_request, ctx, session) => {
    const oid = parseInput((await ctx.params).oid, IdParamSchema);
    const detail = await loadIdentityDetail(session, oid);
    if (!detail) return notFoundResponse();
    return jsonData(await withLiteLLMSuggestion(detail));
  },
  { permit: async (_request, session) => mayReadIdentityDetail(session) },
);
