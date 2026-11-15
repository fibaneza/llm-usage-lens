import { jsonData, withRoute } from "@/lib/api/respond";
import { listTeamLinks } from "@/lib/data/litellm/team-links";
import {
  adminOrAuditorRefusal,
  openModeRefusal,
} from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-litellm.md — "API routes"
// (/api/litellm/team-links GET Admin + Auditor) and "Data model additions"
// (TeamLink, listed from GSI1).

export const dynamic = "force-dynamic";

export const GET = withRoute(async (_request, _ctx, session) => {
  const refused = openModeRefusal() ?? (await adminOrAuditorRefusal(session));
  if (refused) return refused;
  return jsonData({ items: await listTeamLinks() });
});
