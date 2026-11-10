import { z } from "zod";

// Access Control spec — Identity, SSO mapping and defaults; Threat model T1.
// `null` means no session: no stable oid, a foreign tenant, or a malformed
// roles/groups claim.
const OptionalArray = z.array(z.unknown()).optional();

const ProfileSchema = z.object({
  oid: z.string().min(1),
  tid: z.string(),
  email: z.string().optional(),
  preferred_username: z.string().optional(),
  name: z.string().optional(),
  roles: OptionalArray,
  groups: OptionalArray,
  hasgroups: z.unknown().optional(),
  _claim_names: z.object({ groups: z.unknown().optional() }).optional(),
});

export type EntraProfile = {
  oid: string;
  tid: string;
  email: string | undefined;
  upn: string | undefined;
  displayName: string | undefined;
  roles: unknown[] | undefined;
  groups: string[];
  groupsOverage: boolean;
};

export function parseEntraProfile(
  profile: unknown,
  expectedTid: string,
): EntraProfile | null {
  const parsed = ProfileSchema.safeParse(profile);
  if (!parsed.success || parsed.data.tid !== expectedTid) return null;
  const p = parsed.data;
  const groupsOverage =
    p._claim_names?.groups !== undefined || p.hasgroups !== undefined;
  return {
    oid: p.oid,
    tid: p.tid,
    email: p.email?.toLowerCase(),
    upn: p.preferred_username?.toLowerCase(),
    displayName: p.name,
    roles: p.roles,
    groups: groupsOverage
      ? []
      : (p.groups ?? []).filter((g): g is string => typeof g === "string"),
    groupsOverage,
  };
}
