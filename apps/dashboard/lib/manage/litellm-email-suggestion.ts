import "server-only";

import { trace } from "@opentelemetry/api";
import type { IdentityDetail } from "@llm-usage-lens/shared";
import { z } from "zod";

import { isLiteLLMConfigured } from "@/lib/litellm/client";
import { findUserByEmail } from "@/lib/litellm/operations";
import {
  liteLLMErrorResponse,
  openModeRefusal,
} from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-access-control.md - "LiteLLM user links" (D27:
// a match is a suggestion, linked only after a click) and Design System -
// Users, round 3 (UP1, D-R3-13). Read only: this never links, places or writes
// anyone. The binding match rule stays `lib/data/access/litellm-match.ts`.
// The people list and the user page both call this, so they show one answer.
export async function suggestLiteLLMUserByEmail(
  rawEmail: string | null | undefined,
): Promise<{ litellmUserId: string; email: string } | null> {
  const email = rawEmail?.trim().toLowerCase();
  if (!email) return null;
  if (!z.email().safeParse(email).success) return null;
  const { users } = await findUserByEmail({ email });
  const found = users.find((u) => u.user_email?.toLowerCase() === email);
  return found ? { litellmUserId: found.user_id, email } : null;
}

// Source: Access Control - `/api/identities/[oid]` row incl. D-UP1a; Design
// System - Users, round 3, T-UP5. The one place the user page and the route
// apply the guards: unlinked, the session-derived detail allows linking,
// LiteLLM configured, not open mode. A match is only a suggestion and never
// binds; any other caller gets the detail unchanged (no match fields). A
// LiteLLM outage is a handled, degraded read; any other error rethrows.
export async function withLiteLLMSuggestion(
  detail: IdentityDetail,
): Promise<IdentityDetail> {
  if (
    detail.litellm.state !== "none" ||
    !detail.allowed.linkLiteLLM ||
    !(await isLiteLLMConfigured()) ||
    openModeRefusal()
  ) {
    return detail;
  }
  try {
    const match = await suggestLiteLLMUserByEmail(detail.email);
    return match
      ? { ...detail, litellm: { state: "match" as const, ...match } }
      : detail;
  } catch (error) {
    if (!liteLLMErrorResponse(error)) throw error;
    trace
      .getActiveSpan()
      ?.recordException(
        error instanceof Error ? error : new Error("LiteLLM lookup failed"),
      );
    return detail;
  }
}
