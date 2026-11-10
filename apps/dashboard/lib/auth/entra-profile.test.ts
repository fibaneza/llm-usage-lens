import { describe, expect, it } from "vitest";

import { parseEntraProfile } from "@/lib/auth/entra-profile";

// Source: docs/specs/2026-11-10-access-control.md — Identity, SSO mapping and
// defaults; Threat model T1 (a token for a foreign tenant or without a stable
// oid never gets a session). Contract R1 decision 3.
const TID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const base = {
  oid: "00000000-0000-0000-0000-0000000000aa",
  tid: TID,
  email: "Ada@Example.COM",
  preferred_username: "Ada.Lovelace@Example.com",
  name: "Ada Lovelace",
  roles: ["internal-auditor"],
  groups: ["g1", "g2"],
};

const omit = (obj: Record<string, unknown>, ...keys: string[]) =>
  Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));

describe("parseEntraProfile", () => {
  it("returns the normalised identity for a valid profile", () => {
    expect(parseEntraProfile(base, TID)).toEqual({
      oid: base.oid,
      tid: TID,
      email: "ada@example.com",
      upn: "ada.lovelace@example.com",
      displayName: "Ada Lovelace",
      roles: ["internal-auditor"],
      groups: ["g1", "g2"],
      groupsOverage: false,
    });
  });

  it("tolerates absent roles and groups", () => {
    const rest = omit(base, "roles", "groups");
    const out = parseEntraProfile(rest, TID);
    expect(out).not.toBeNull();
    expect(out?.groupsOverage).toBe(false);
  });

  it("has no email when the email claim is absent", () => {
    const rest = omit(base, "email");
    expect(parseEntraProfile(rest, TID)?.email).toBeUndefined();
  });

  it.each([
    ["missing oid", { ...base, oid: undefined }],
    ["empty oid", { ...base, oid: "" }],
    ["non-string oid", { ...base, oid: 42 }],
    ["foreign tid", { ...base, tid: "11111111-1111-1111-1111-111111111111" }],
    ["missing tid", { ...base, tid: undefined }],
    ["roles as a string", { ...base, roles: "internal-admin" }],
    ["roles as an object", { ...base, roles: {} }],
    ["groups as a string", { ...base, groups: "g1" }],
    ["groups as an object", { ...base, groups: {} }],
  ])("returns null (no session) for %s", (_n, profile) => {
    expect(parseEntraProfile(profile, TID)).toBeNull();
  });

  it("returns null for a non-object profile", () => {
    expect(parseEntraProfile(null, TID)).toBeNull();
    expect(parseEntraProfile("x", TID)).toBeNull();
    expect(parseEntraProfile(undefined, TID)).toBeNull();
  });

  it("flags groups overage via _claim_names.groups and empties groups", () => {
    const rest = omit(base, "groups");
    const out = parseEntraProfile(
      { ...rest, _claim_names: { groups: "src1" } },
      TID,
    );
    expect(out?.groupsOverage).toBe(true);
    expect(out?.groups).toEqual([]);
  });

  it("flags groups overage via hasgroups", () => {
    const rest = omit(base, "groups");
    const out = parseEntraProfile({ ...rest, hasgroups: true }, TID);
    expect(out?.groupsOverage).toBe(true);
    expect(out?.groups).toEqual([]);
  });
});
