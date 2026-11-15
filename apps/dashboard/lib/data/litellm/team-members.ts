import "server-only";

import { getIdentityLink } from "../access/identity-links";
import {
  getIdentityRecord,
  listAllTeamMemberOids,
} from "../access/team-member-lookup";

// Source: docs/specs/2026-11-10-litellm.md — "Identity mapping and members"
// (members are dashboard members of the team; the user link is
// `IdentityLink.litellmUserId`, falling back to the usage identities) and
// Rule 20.6 (GSI1 queries loop on LastEvaluatedKey).

export type DashboardMember = { oid: string; name?: string };

// LiteLLM user id or email (lower-cased) -> the dashboard member it belongs to.
export async function mapTeamMembers(
  teamId: string,
): Promise<Map<string, DashboardMember>> {
  const oids = await listAllTeamMemberOids(teamId);

  const byKey = new Map<string, DashboardMember>();
  await Promise.all(
    oids.map(async (oid) => {
      const [link, identity] = await Promise.all([
        getIdentityLink(oid),
        getIdentityRecord(oid),
      ]);
      const member: DashboardMember = {
        oid,
        ...(identity?.displayName ? { name: identity.displayName } : {}),
      };
      const keys = [
        link?.litellmUserId,
        identity?.email,
        ...(link?.usageIdentities ?? []),
      ];
      for (const key of keys) {
        if (key) byKey.set(key.toLowerCase(), member);
      }
    }),
  );
  return byKey;
}
