// Test-only columns for the L5 role x operation matrix
// (app/api/litellm/__tests__/role-operation-matrix.integration.test.ts); not
// imported by production code.
// Source: docs/specs/2026-11-10-litellm.md - "Polish and verification (L5)",
// Role x operation matrix: the seven spec columns, with the spec's two named
// variants made explicit (Lead by team scope and by department scope; "Viewer,
// no team" is also a session with no role claim) and Rule 50.4 (org-admin
// reached through a stored RoleGrant).
import { signInWithRoles } from "@/test/fakes/fake-litellm-views";
import { grantRole } from "@/lib/data/access/role-grants";
import { ctxAt, ok } from "@/test/support/access-test-support";
import { signInAs } from "@/test/fixtures/scope-fixtures";

// The oid `signInWithRoles` signs in with.
const NO_ROLE_OID = "00000000-0000-4000-8000-0000000009ff";

// Position of the column in a spec row's cells.
export const SPEC_COLUMN = {
  admin: 0,
  orgAdmin: 1,
  auditor: 2,
  lead: 3,
  leadOtherTeam: 4,
  member: 5,
  viewerNoTeam: 6,
} as const;
export type SpecColumn = keyof typeof SPEC_COLUMN;

export type MatrixColumn = {
  name: string;
  column: SpecColumn;
  // The team a team-scoped route is addressed to: the Lead's own team, or one
  // the Lead holds no scope on.
  team: "team-a" | "team-b" | "team-c";
  signIn: () => Promise<void>;
};

const claim = (
  name: string,
  column: SpecColumn,
  who: Parameters<typeof signInAs>[0],
  team: MatrixColumn["team"] = "team-a",
): MatrixColumn => ({
  name,
  column,
  team,
  signIn: async () => {
    signInAs(who);
  },
});

export const COLUMNS: MatrixColumn[] = [
  claim("Admin", "admin", "admin"),
  claim("org-admin (role claim)", "orgAdmin", "orgAdmin"),
  {
    name: "org-admin (stored RoleGrant, no claim; Rule 50.4)",
    column: "orgAdmin",
    team: "team-a",
    signIn: async () => {
      await signInWithRoles([]);
      ok(
        await grantRole(
          { oid: NO_ROLE_OID, role: "internal-org-admin", reason: "matrix" },
          ctxAt(),
        ),
      );
    },
  },
  claim("Auditor", "auditor", "auditor"),
  claim("Lead (team scope)", "lead", "teamAdminA"),
  claim("Lead (department scope)", "lead", "deptAdminEng"),
  claim(
    "Lead, other team (team scope)",
    "leadOtherTeam",
    "teamAdminA",
    "team-b",
  ),
  claim(
    "Lead, other team (department scope)",
    "leadOtherTeam",
    "deptAdminEng",
    "team-c",
  ),
  claim("member", "member", "memberA"),
  claim("Viewer, no team", "viewerNoTeam", "viewerNone"),
  {
    name: "no role claim (resolves to Viewer, no team)",
    column: "viewerNoTeam",
    team: "team-a",
    signIn: () => signInWithRoles([]),
  },
];
