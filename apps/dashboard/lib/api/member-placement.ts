import "server-only";

import { trace } from "@opentelemetry/api";
import type { IdentityRecord } from "@llm-usage-lens/shared";

import { getAffiliation } from "@/lib/data/access/affiliations";
import { getLiteLLMUserOwner } from "@/lib/data/access/identity-links";
import { matchLiteLLMUser } from "@/lib/data/access/litellm-match";
import { configuredTenant } from "@/lib/data/access/sso-binding";
import { searchUsers } from "@/lib/litellm/operations";

// Source: Access Control - "Same person" and "Placing a person by hand"; T2,
// T-IV2, T-IV5. Used by the members GET for callers who may write members
// only. The accept and add-member routes import nothing from lib/litellm
// (T-IV7), so this stays out of them.

const SSO_PAGE_SIZE = 25;
const SSO_MAX_PAGES = 40;

// The `sso_user_id` of the team's LiteLLM users, by LiteLLM user id, read
// through the allowlisted identity search (GET only) as the user sync reads it
// (LD40). One paged read of the team's users, not one call per identity. Null
// when the read fails or refuses: the match then fails closed.
export type SsoIds = Map<string, string | null>;

export async function readSsoIds(
  litellmTeamId: string,
): Promise<SsoIds | null> {
  const ids: SsoIds = new Map();
  try {
    for (let page = 1; page <= SSO_MAX_PAGES; page += 1) {
      const result = await searchUsers({
        litellmTeamId,
        page,
        pageSize: SSO_PAGE_SIZE,
        withIdentity: true,
      });
      for (const u of result.users) ids.set(u.user_id, u.sso_user_id ?? null);
      const total = result.total_pages ?? page;
      if (page >= total || result.users.length < SSO_PAGE_SIZE) break;
    }
  } catch (error) {
    // Fail closed (T2): without the real sso_user_id an email-key-only match
    // is not trusted. The members read itself still answers. The event carries
    // the error name or code only (Rule 60.17, Rule 50.6).
    const code =
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : error instanceof Error
          ? error.name
          : "unknown";
    trace
      .getActiveSpan()
      ?.addEvent("litellm.sso-read.failed", { "error.type": code });
    return null;
  }
  return ids;
}

// Add to team needs exactly one identity: the stored link when an identity
// holds it, else the one comparison function over the Entra id, the
// tenant-checked UPN email key and the real sso_user_id (never a guest UPN or
// the `email` claim alone; two matches or disagreeing keys mean no match). The
// identity must have no team (any team).
export async function placeableIdentity(
  people: ReadonlyArray<IdentityRecord>,
  row: { userId: string; email: string },
  readIds: () => Promise<SsoIds | null>,
): Promise<IdentityRecord | null> {
  const owner = await getLiteLLMUserOwner(row.userId);
  if (owner) {
    const holder = people.find((p) => p.oid === owner);
    if (!holder) return null;
    return (await getAffiliation(holder.oid)) === null ? holder : null;
  }

  const ids = await readIds();
  const ssoKnown = ids !== null && ids.has(row.userId);
  const tenant = configuredTenant();
  const entra = new Set<string>();
  const byEmail = new Set<string>();
  for (const p of people) {
    const m = matchLiteLLMUser(
      { ...p, email: p.email ?? null, upn: p.upn ?? null },
      {
        userId: row.userId,
        email: row.email,
        ssoUserId: ids?.get(row.userId) ?? null,
      },
      tenant,
    );
    if (m.entraId) entra.add(p.oid);
    if (m.email) byEmail.add(p.oid);
  }
  if (!ssoKnown && entra.size === 0) return null;
  const matched = new Set([...entra, ...byEmail]);
  const [oid] = matched;
  const only = matched.size === 1 ? people.find((p) => p.oid === oid) : null;
  if (!only) return null;
  return (await getAffiliation(only.oid)) === null ? only : null;
}
