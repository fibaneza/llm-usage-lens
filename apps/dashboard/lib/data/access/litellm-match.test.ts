import { describe, expect, it } from "vitest";

import { matchLiteLLMUser } from "./litellm-match";

// Source: docs/specs/2026-11-10-access-control.md - "LiteLLM user links"
// (Match: one comparison function shared by the link route's `match` mode and
// the sync, review change V6), "LiteLLM user sync" - *Match keys per sign-in
// mode* and *Same person*; tests T-SM1 (an Entra identity matches by `oid` and
// by UPN; the `email` claim and a guest UPN never match) and T-SM2 (a password
// user matches by sign-in email and by a reserved `expectedOid`; a `local:` id
// is never compared); T-SY1 (a prefix, a suffix, another domain and a display
// name never match); threat T2 (the `email` claim is not a bind key).
//
// Contract for the developer (lib/data/access/litellm-match.ts):
//   matchLiteLLMUser(identity, litellmUser, tenant) -> { entraId, email }
//   identity: { oid, authMethod, tid?, upn?, email?, expectedOid? }
//     (`expectedOid` is the password user's reserved `sso.expectedOid`)
//   litellmUser: { userId, email, ssoUserId }
//   tenant: the configured Entra tenant id, or null when none is configured.
const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const OID = "00000000-0000-4000-8000-0000000000a1";
const LOCAL_OID = "local:11111111-2222-4333-8444-555555555555";
const GUEST_UPN = "jane_example.com#EXT#@contoso.onmicrosoft.com";

type Identity = Parameters<typeof matchLiteLLMUser>[0];
type LUser = Parameters<typeof matchLiteLLMUser>[1];

const entra = (over: Partial<Identity> = {}): Identity => ({
  oid: OID,
  authMethod: "entra",
  tid: TENANT,
  upn: "alice@corp.example",
  email: "alice.claim@corp.example",
  ...over,
});
const password = (over: Partial<Identity> = {}): Identity => ({
  oid: LOCAL_OID,
  authMethod: "password",
  email: "pw@corp.example",
  ...over,
});
const lu = (over: Partial<LUser> = {}): LUser => ({
  userId: "lu-1",
  email: null,
  ssoUserId: null,
  ...over,
});
const match = (i: Identity, u: LUser, tenant: string | null = TENANT) =>
  matchLiteLLMUser(i, u, tenant);

describe("an Entra identity (T-SM1)", () => {
  it("matches the Entra id: the LiteLLM user_id or sso_user_id equals the oid", () => {
    expect(match(entra(), lu({ userId: OID })).entraId).toBe(true);
    expect(match(entra(), lu({ ssoUserId: OID })).entraId).toBe(true);
    expect(match(entra(), lu({ userId: "someone-else" })).entraId).toBe(false);
  });

  it("matches the UPN, trimmed and case-folded", () => {
    expect(match(entra(), lu({ email: " Alice@Corp.Example " })).email).toBe(
      true,
    );
  });

  it("never matches the email claim", () => {
    const claimOnly = match(entra(), lu({ email: "alice.claim@corp.example" }));
    expect(claimOnly.email).toBe(false);
  });

  it("never matches a guest UPN, even when LiteLLM holds the same text", () => {
    const guest = entra({ upn: GUEST_UPN });
    expect(match(guest, lu({ email: GUEST_UPN })).email).toBe(false);
    expect(match(guest, lu({ email: GUEST_UPN.toLowerCase() })).email).toBe(
      false,
    );
    expect(match(guest, lu({ email: "jane@example.com" })).email).toBe(false);
  });

  it("matches the email key only inside the configured tenant", () => {
    const u = lu({ email: "alice@corp.example" });
    expect(match(entra({ tid: OTHER_TENANT }), u).email).toBe(false);
    expect(match(entra(), u, null).email).toBe(false);
  });

  it("an identity without a UPN has no email key", () => {
    const noUpn: Identity = {
      oid: OID,
      authMethod: "entra",
      tid: TENANT,
      email: "alice.claim@corp.example",
    };
    expect(match(noUpn, lu({ email: "alice.claim@corp.example" })).email).toBe(
      false,
    );
  });
});

describe("a password user (T-SM2)", () => {
  it("matches the sign-in email, trimmed and case-folded", () => {
    expect(match(password(), lu({ email: " PW@corp.example" })).email).toBe(
      true,
    );
  });

  it("matches the reserved expected oid on user_id or sso_user_id", () => {
    const pw = password({ expectedOid: OID });
    expect(match(pw, lu({ userId: OID })).entraId).toBe(true);
    expect(match(pw, lu({ ssoUserId: OID })).entraId).toBe(true);
  });

  it("has no Entra id key when no expected oid is reserved", () => {
    expect(match(password(), lu({ userId: OID, ssoUserId: OID })).entraId).toBe(
      false,
    );
  });

  it("never compares a local: id with a LiteLLM id", () => {
    const pw = password();
    expect(match(pw, lu({ userId: LOCAL_OID })).entraId).toBe(false);
    expect(match(pw, lu({ ssoUserId: LOCAL_OID })).entraId).toBe(false);
    const withReserved = password({ expectedOid: OID });
    expect(match(withReserved, lu({ userId: LOCAL_OID })).entraId).toBe(false);
  });

  it("needs no tenant for the email key", () => {
    expect(
      match(password(), lu({ email: "pw@corp.example" }), null).email,
    ).toBe(true);
  });
});

describe("what never matches (T-SY1)", () => {
  it.each([
    ["a prefix", "pw@corp.example.org"],
    ["a suffix", "xpw@corp.example"],
    ["another domain", "pw@other.example"],
    ["a display name", "Pat Williams"],
    ["no email", null],
    ["an empty email", "   "],
  ])("%s", (_name, email) => {
    expect(match(password(), lu({ email })).email).toBe(false);
    expect(match(entra({ upn: "pw@corp.example" }), lu({ email })).email).toBe(
      false,
    );
  });
});
