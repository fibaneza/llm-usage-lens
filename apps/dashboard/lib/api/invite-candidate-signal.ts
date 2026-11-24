import "server-only";

import { z } from "zod";

import type {
  InviteCandidate,
  InviteCandidateIdentity,
} from "@llm-usage-lens/shared";

import { getIdentityLink } from "@/lib/data/access/identity-links";
import { guestUpnPrefix } from "@/lib/data/access/pending";
import { LiteLLMError, isLiteLLMConfigured } from "@/lib/litellm/client";
import { LiteLLMOperationRefused } from "@/lib/litellm/gateway";
import { findUserByEmail } from "@/lib/litellm/operations";
import { openModeRefusal } from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-access-control.md - "Placing a person by hand"
// (the dialog preselects only when a candidate's UPN equals the invite key, or
// it is the identity linked to the LiteLLM user that has this email; the link
// is a signal, never a bind key or a new candidate), T-IV2, threat R1 (only the
// boolean and the signal leave the server), LiteLLM LD37 (a gateway that is not
// configured, or refuses or fails, is a handled state: no link signal). Kept
// out of lib/api/invite-accept.ts: the accept route must not reach lib/litellm
// (T-IV7). Reads per request, never cached (Rule 60.10).
async function linkedLiteLLMUserIds(key: string): Promise<Set<string>> {
  if (!z.email().safeParse(key).success) return new Set();
  if (openModeRefusal() || !(await isLiteLLMConfigured())) return new Set();
  try {
    const { users } = await findUserByEmail({ email: key });
    return new Set(
      users
        .filter((u) => u.user_email?.toLowerCase() === key)
        .map((u) => u.user_id),
    );
  } catch (error) {
    if (
      error instanceof LiteLLMError ||
      error instanceof LiteLLMOperationRefused
    ) {
      return new Set();
    }
    throw error;
  }
}

export async function annotateKeyCandidates(
  rows: readonly InviteCandidateIdentity[],
  key: string,
): Promise<InviteCandidate[]> {
  const guest = guestUpnPrefix(key);
  const userIds = rows.length > 0 ? await linkedLiteLLMUserIds(key) : new Set();
  return Promise.all(
    rows.map(async (row): Promise<InviteCandidate> => {
      const upn = row.upn?.toLowerCase();
      if (upn === key) return { ...row, exact: true, signal: "upn" };
      if (userIds.size > 0) {
        const linked = (await getIdentityLink(row.oid))?.litellmUserId;
        if (linked !== undefined && userIds.has(linked)) {
          return { ...row, exact: true, signal: "litellm-link" };
        }
      }
      if (guest !== null && upn?.startsWith(guest)) {
        return { ...row, exact: false, signal: "guest-upn" };
      }
      return { ...row, exact: false, signal: "email" };
    }),
  );
}

export function annotateSearchRows(
  rows: readonly InviteCandidateIdentity[],
): InviteCandidate[] {
  return rows.map((row) => ({ ...row, exact: false, signal: null }));
}
