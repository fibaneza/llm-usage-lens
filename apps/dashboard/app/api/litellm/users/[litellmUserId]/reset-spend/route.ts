import { userResetSpendRoute } from "@/lib/litellm/litellm-id-write";

// Source: docs/specs/2026-11-10-litellm.md - LD39, "Writes" (resetUserSpend:
// POST /user/update with exactly { user_id, spend: 0 }; default off), "API
// routes"; Access Control - "Reset by LiteLLM ids".

export const dynamic = "force-dynamic";

export const POST = userResetSpendRoute({
  action: "litellm.user.reset-spend",
  pattern: "/api/litellm/users/[litellmUserId]/reset-spend",
  toggle: "resetUserSpend",
});
