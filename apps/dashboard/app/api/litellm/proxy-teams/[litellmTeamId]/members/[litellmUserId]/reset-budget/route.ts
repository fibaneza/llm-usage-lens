import { proxyMemberResetRoute } from "@/lib/litellm/litellm-id-write";

// Source: docs/specs/2026-11-10-litellm.md - LD39, "Writes" (resetMemberBudget by
// LiteLLM ids), "API routes"; Access Control - "Reset by LiteLLM ids".

export const dynamic = "force-dynamic";

export const POST = proxyMemberResetRoute({
  action: "litellm.member.reset-budget",
  pattern:
    "/api/litellm/proxy-teams/[litellmTeamId]/members/[litellmUserId]/reset-budget",
  toggle: "resetMemberBudget",
  operation: "budget",
});
