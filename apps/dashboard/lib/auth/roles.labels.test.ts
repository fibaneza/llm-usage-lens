import { describe, expect, it } from "vitest";

import {
  AUTH_METHOD_LABELS,
  GLOBAL_ROLES,
  ROLE_LABELS,
} from "@/lib/auth/roles";

// Source: docs/specs/2026-05-15-design-system.md — Authentication, *User menu*
// (role labels and sign-in method labels come from `lib/auth/roles.ts`;
// Rule 50.3). The exact strings are the spec's.

describe("ROLE_LABELS", () => {
  it("maps each global role to its display label", () => {
    expect(ROLE_LABELS).toEqual({
      "internal-admin": "Admin",
      "internal-org-admin": "Org admin",
      "internal-auditor": "Auditor",
      "internal-viewer": "Viewer",
    });
  });

  it("has a label for every global role and nothing else", () => {
    expect(Object.keys(ROLE_LABELS).sort()).toEqual([...GLOBAL_ROLES].sort());
  });

  it("does not label the scoped team-admin grant (authorization data, not session data)", () => {
    expect(Object.keys(ROLE_LABELS)).not.toContain("internal-team-admin");
  });
});

describe("AUTH_METHOD_LABELS", () => {
  it("maps each sign-in method to its display label", () => {
    expect(AUTH_METHOD_LABELS).toEqual({
      entra: "Microsoft Entra ID",
      master: "Master user (break-glass)",
      local: "Local login (dev)",
    });
  });
});
