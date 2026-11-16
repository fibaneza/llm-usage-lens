import { describe, expect, it } from "vitest";

import type { NavScope } from "./nav";
import { scopeLabelFor } from "./scope-labels";

// Source: Design System - Layout, Page frame (a `ScopeLine` states the scope,
// "omitted for callers who see everything"; example "Showing teams you lead")
// and Access states and scoped labels; slice B1 brief B1-10 (one helper in
// lib/scope-labels.ts that returns null for a global caller; the 4R.5
// scopeNoticeFor "Showing your teams only." is removed).
const scope = (over: Partial<NavScope> = {}): NavScope => ({
  global: false,
  memberTeamId: null,
  teamScopes: new Set<string>(),
  departmentScopes: new Set<string>(),
  ...over,
});

describe("scopeLabelFor", () => {
  it("is null for a global reader, even one that also holds admin scopes", () => {
    expect(scopeLabelFor(scope({ global: true }))).toBeNull();
    expect(
      scopeLabelFor(
        scope({
          global: true,
          teamScopes: new Set(["team-a"]),
          departmentScopes: new Set(["dept-eng"]),
        }),
      ),
    ).toBeNull();
  });

  it("labels a team lead's page with the spec wording", () => {
    expect(scopeLabelFor(scope({ teamScopes: new Set(["team-a"]) }))).toBe(
      "Showing teams you lead",
    );
  });

  it("labels a department lead's page as departments they lead", () => {
    expect(
      scopeLabelFor(scope({ departmentScopes: new Set(["dept-eng"]) })),
    ).toMatch(/departments you lead/i);
  });

  it("gives a member a non-empty label", () => {
    const label = scopeLabelFor(scope({ memberTeamId: "team-a" }));
    expect(typeof label).toBe("string");
    expect(label).not.toBe("");
  });
});
