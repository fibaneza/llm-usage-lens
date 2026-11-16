// Test-only session shapes shared by the route-contract suite and
// write-routes.integration.test.ts. Not imported by production code.
// Every non-admin session shape (Access Control spec - Enforcement item 2).
export const NON_ADMIN_SESSIONS: [string, unknown][] = [
  ["no roles claim", { user: { oid: "oid-test", name: "M" } }],
  ["an empty roles list", { user: { oid: "oid-test", roles: [] } }],
  [
    "other roles only",
    { user: { oid: "oid-test", roles: ["Reader", "Auditor"] } },
  ],
  [
    "the role in the wrong case",
    { user: { oid: "oid-test", roles: ["admin"] } },
  ],
  [
    "a role that merely contains Admin",
    { user: { oid: "oid-test", roles: ["SuperAdmin"] } },
  ],
  ["roles that is a string", { user: { oid: "oid-test", roles: "Admin" } }],
  [
    "internal-auditor",
    { user: { oid: "oid-test", roles: ["internal-auditor"] } },
  ],
  [
    "internal-org-admin",
    { user: { oid: "oid-test", roles: ["internal-org-admin"] } },
  ],
  [
    "internal-viewer",
    { user: { oid: "oid-test", roles: ["internal-viewer"] } },
  ],
  [
    "internal-auditor and internal-org-admin together",
    {
      user: {
        oid: "oid-test",
        roles: ["internal-auditor", "internal-org-admin"],
      },
    },
  ],
];
