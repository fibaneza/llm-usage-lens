import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { classifyLiteLLMUsers, planHash } from "./plan";

// Source: docs/specs/2026-11-10-access-control.md - "LiteLLM user sync" (the
// *Users* table, *Same person*, *Pending LiteLLM links*, *Preview and apply*:
// the plan hash), "Match keys per sign-in mode"; tests T-SY1 (match keys and
// refusals), T-SY4 (own identity), T-SY5 (hash), T-SM1/T-SM2 (keys per sign-in
// mode; the pairwise rules are in lib/data/access/litellm-match.test.ts).
//
// Contract for the developer (lib/litellm-user-sync/plan.ts, pure, no I/O):
//   classifyLiteLLMUsers(input) -> PlanRow[], one row per LiteLLM user, in the
//     input order:
//     { litellmUserId, outcome: "link-existing"|"create-pending"|
//       "already-linked"|"already-pending"|"skip", reason?, oid?, key?,
//       matchedKey? }
//     `matchedKey` is "oid" or "email" on link-existing; `key` is the
//     placeholder key on create-pending / already-pending; `reason` is one of
//     no-email, duplicate-email, ambiguous-identity, privileged, service-user,
//     claimed, identity-linked-elsewhere, own-identity.
//   planHash(rows) -> 64 hex characters (SHA-256), independent of row order.
// Input: users {userId,email,role,ssoUserId}, people {oid,authMethod,tid?,upn?,
// email?,expectedOid?,litellmUserId}, pending {key,litellmUserId}, claims
// (litellmUserId -> owner: an oid or a pending key), tenant, serviceUserId,
// callerOid. The pairwise comparison is `matchLiteLLMUser` (one function).
const TENANT = "11111111-1111-4111-8111-111111111111";
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b2";
const CAROL = "00000000-0000-4000-8000-0000000000c3";

type Input = Parameters<typeof classifyLiteLLMUsers>[0];
type User = Input["users"][number];
type Person = Input["people"][number];

const user = (userId: string, over: Partial<User> = {}): User => ({
  userId,
  email: `${userId}@corp.example`,
  role: "internal_user",
  ssoUserId: null,
  ...over,
});
const person = (
  oid: string,
  upn: string,
  over: Partial<Person> = {},
): Person => ({
  oid,
  authMethod: "entra",
  tid: TENANT,
  upn,
  email: upn,
  litellmUserId: null,
  ...over,
});
const classify = (over: Partial<Input>) =>
  classifyLiteLLMUsers({
    users: [],
    people: [],
    pending: [],
    claims: {},
    tenant: TENANT,
    serviceUserId: null,
    callerOid: null,
    ...over,
  });
const only = (over: Partial<Input>) => {
  const rows = classify(over);
  expect(rows).toHaveLength(over.users?.length ?? 0);
  const [row] = rows;
  if (!row) throw new Error("expected one classified row");
  return row;
};

describe("classifyLiteLLMUsers: the match keys (T-SY1, Same person)", () => {
  it("links on the email, compared case-folded and trimmed, and records the key", () => {
    const row = only({
      users: [user("lu-1", { email: "  Alice@Corp.Example " })],
      people: [person(ALICE, "alice@corp.example")],
    });
    expect(row).toMatchObject({
      litellmUserId: "lu-1",
      outcome: "link-existing",
      oid: ALICE,
      matchedKey: "email",
    });
  });

  it.each([
    ["user_id", { userId: ALICE, ssoUserId: null }],
    ["sso_user_id", { userId: "lu-2", ssoUserId: ALICE }],
  ])(
    "links on the Entra id when the LiteLLM %s equals the oid, whatever the email",
    (_name, over) => {
      const row = only({
        users: [user(over.userId, { ...over, email: "other@elsewhere.test" })],
        people: [person(ALICE, "alice@corp.example")],
      });
      expect(row).toMatchObject({
        outcome: "link-existing",
        oid: ALICE,
        matchedKey: "oid",
      });
    },
  );

  it("links on the Entra id when LiteLLM has no email at all", () => {
    const row = only({
      users: [user("lu-3", { email: null, ssoUserId: ALICE })],
      people: [person(ALICE, "alice@corp.example")],
    });
    expect(row).toMatchObject({ outcome: "link-existing", oid: ALICE });
  });

  it("prefers the Entra id when both keys name the same person", () => {
    const row = only({
      users: [user("lu-4", { email: "alice@corp.example", ssoUserId: ALICE })],
      people: [person(ALICE, "alice@corp.example")],
    });
    expect(row).toMatchObject({
      outcome: "link-existing",
      matchedKey: "oid",
    });
  });

  it.each([
    ["a prefix", "alice@corp.example.org"],
    ["a suffix", "malice@corp.example"],
    ["another domain", "alice@other.example"],
    ["a display name", "Alice Anderson"],
  ])("never links on %s (it becomes a pending link)", (_name, email) => {
    const row = only({
      users: [user("lu-5", { email })],
      people: [person(ALICE, "alice@corp.example")],
    });
    expect(row.outcome).not.toBe("link-existing");
  });

  it("the two keys pointing at different people link nothing: ambiguous-identity", () => {
    const row = only({
      users: [user("lu-6", { email: "bob@corp.example", ssoUserId: ALICE })],
      people: [
        person(ALICE, "alice@corp.example"),
        person(BOB, "bob@corp.example"),
      ],
    });
    expect(row).toMatchObject({
      outcome: "skip",
      reason: "ambiguous-identity",
    });
  });

  it("two identities sharing the key link neither: ambiguous-identity", () => {
    const row = only({
      users: [user("lu-7", { email: "shared@corp.example" })],
      people: [
        person(ALICE, "shared@corp.example"),
        person(BOB, "shared@corp.example"),
      ],
    });
    expect(row).toMatchObject({
      outcome: "skip",
      reason: "ambiguous-identity",
    });
  });

  it("two LiteLLM users sharing an email skip both sides: duplicate-email", () => {
    const rows = classify({
      users: [
        user("lu-8a", { email: "dup@corp.example" }),
        user("lu-8b", { email: "DUP@corp.example" }),
      ],
      people: [person(ALICE, "dup@corp.example")],
    });
    expect(rows.map((r) => [r.outcome, r.reason])).toEqual([
      ["skip", "duplicate-email"],
      ["skip", "duplicate-email"],
    ]);
  });

  it("a person nobody matches becomes a pending link keyed by the lower-cased email", () => {
    const row = only({
      users: [user("lu-9", { email: "New.Hire@Corp.Example" })],
    });
    expect(row).toMatchObject({
      outcome: "create-pending",
      key: "new.hire@corp.example",
    });
  });

  // Access Control - LiteLLM user sync, placeholder key: `PENDING#sso:<sha256 hex
  // of the trimmed, lower-cased sso_user_id>`; the reference is never stored in
  // clear (S20, T-SY1; amended 2026-11-24).
  it("a LiteLLM user that carries an Entra id is keyed by the hash of that id, never the id in clear", () => {
    const row = only({
      users: [user("lu-10", { email: "new@corp.example", ssoUserId: BOB })],
    });
    const expectedKey = `sso:${createHash("sha256")
      .update(BOB.trim().toLowerCase())
      .digest("hex")}`;
    expect(row).toMatchObject({ outcome: "create-pending", key: expectedKey });
    expect(JSON.stringify(row)).not.toContain(BOB);
  });

  it("no email and no identity with the Entra id: no-email", () => {
    expect(only({ users: [user("lu-11", { email: null })] })).toMatchObject({
      outcome: "skip",
      reason: "no-email",
    });
    expect(
      only({ users: [user("lu-12", { email: "not-an-email" })] }),
    ).toMatchObject({ outcome: "skip", reason: "no-email" });
  });
});

describe("classifyLiteLLMUsers: refusals write no link and no claim (T-SY1)", () => {
  it.each([
    ["proxy_admin", "privileged"],
    ["proxy_admin_viewer", "privileged"],
    ["a role nobody knows", "privileged"],
    [null, "privileged"],
  ])("role %s is skipped as %s even when the email matches", (role, reason) => {
    const row = only({
      users: [user("lu-20", { role, email: "alice@corp.example" })],
      people: [person(ALICE, "alice@corp.example")],
    });
    expect(row).toMatchObject({ outcome: "skip", reason });
    expect(row).not.toHaveProperty("oid");
    expect(row).not.toHaveProperty("key");
  });

  it.each(["internal_user", "internal_user_viewer"])(
    "role %s is a person",
    (role) => {
      expect(
        only({
          users: [user("lu-21", { role, email: "a@corp.example" })],
          people: [person(ALICE, "a@corp.example")],
        }).outcome,
      ).toBe("link-existing");
    },
  );

  it("the service user is skipped as service-user", () => {
    const row = only({
      users: [user("svc-1", { email: "alice@corp.example" })],
      people: [person(ALICE, "alice@corp.example")],
      serviceUserId: "svc-1",
    });
    expect(row).toMatchObject({ outcome: "skip", reason: "service-user" });
  });

  it("a LiteLLM user claimed by someone else is claimed, never overwritten", () => {
    const row = only({
      users: [user("lu-22", { email: "alice@corp.example" })],
      people: [person(ALICE, "alice@corp.example")],
      claims: { "lu-22": BOB },
    });
    expect(row).toMatchObject({ outcome: "skip", reason: "claimed" });
  });

  it("an identity with another LiteLLM user is identity-linked-elsewhere", () => {
    const row = only({
      users: [user("lu-23", { email: "alice@corp.example" })],
      people: [
        person(ALICE, "alice@corp.example", { litellmUserId: "lu-other" }),
      ],
      claims: { "lu-other": ALICE },
    });
    expect(row).toMatchObject({
      outcome: "skip",
      reason: "identity-linked-elsewhere",
    });
  });

  it("the caller's own identity is own-identity", () => {
    const row = only({
      users: [user("lu-24", { email: "alice@corp.example" })],
      people: [person(ALICE, "alice@corp.example")],
      callerOid: ALICE,
    });
    expect(row).toMatchObject({ outcome: "skip", reason: "own-identity" });
  });
});

describe("classifyLiteLLMUsers: nothing to do and pending links", () => {
  it("an identity that already holds this link is already-linked", () => {
    const row = only({
      users: [user("lu-30", { email: "alice@corp.example" })],
      people: [person(ALICE, "alice@corp.example", { litellmUserId: "lu-30" })],
      claims: { "lu-30": ALICE },
    });
    expect(row).toMatchObject({ outcome: "already-linked", oid: ALICE });
  });

  it("an existing pending link is already-pending", () => {
    const row = only({
      users: [user("lu-31", { email: "new@corp.example" })],
      pending: [{ key: "new@corp.example", litellmUserId: "lu-31" }],
      claims: { "lu-31": "new@corp.example" },
    });
    expect(row).toMatchObject({
      outcome: "already-pending",
      key: "new@corp.example",
    });
  });

  it("a person who signed in after the pending link was written is linked, not claimed", () => {
    const row = only({
      users: [user("lu-32", { email: "new@corp.example" })],
      people: [person(CAROL, "new@corp.example")],
      pending: [{ key: "new@corp.example", litellmUserId: "lu-32" }],
      claims: { "lu-32": "new@corp.example" },
    });
    expect(row).toMatchObject({ outcome: "link-existing", oid: CAROL });
  });
});

describe("classifyLiteLLMUsers: the keys per sign-in mode (T-SM1, T-SM2)", () => {
  it("an Entra identity matches its UPN, never the email claim", () => {
    const row = only({
      users: [user("lu-40", { email: "claim@corp.example" })],
      people: [
        person(ALICE, "alice@corp.example", { email: "claim@corp.example" }),
      ],
    });
    expect(row.outcome).toBe("create-pending");
  });

  it("a password user matches the sign-in email and its reserved expected oid", () => {
    const pw: Person = {
      oid: "local:11111111-2222-4333-8444-555555555555",
      authMethod: "password",
      email: "pw@corp.example",
      expectedOid: BOB,
      litellmUserId: null,
    };
    expect(
      only({
        users: [user("lu-41", { email: "PW@corp.example" })],
        people: [pw],
      }),
    ).toMatchObject({
      outcome: "link-existing",
      oid: pw.oid,
      matchedKey: "email",
    });
    expect(
      only({
        users: [user("lu-42", { email: "else@corp.example", ssoUserId: BOB })],
        people: [pw],
      }),
    ).toMatchObject({
      outcome: "link-existing",
      oid: pw.oid,
      matchedKey: "oid",
    });
  });

  it("a local: id is never compared with a LiteLLM id", () => {
    const pw: Person = {
      oid: "local:11111111-2222-4333-8444-555555555555",
      authMethod: "password",
      email: "pw@corp.example",
      litellmUserId: null,
    };
    const row = only({
      users: [user(pw.oid, { email: "someone@else.test" })],
      people: [pw],
    });
    expect(row.outcome).toBe("create-pending");
  });
});

describe("planHash (T-SY5)", () => {
  const rows = () =>
    classify({
      users: [
        user("lu-50", { email: "a@corp.example" }),
        user("lu-51", { email: "b@corp.example" }),
        user("lu-52", { email: "c@corp.example", role: "proxy_admin" }),
      ],
      people: [person(ALICE, "a@corp.example")],
    });

  it("is a SHA-256 hex digest", () => {
    expect(planHash(rows())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable for the same plan and independent of the row order", () => {
    const r = rows();
    expect(planHash(r)).toBe(planHash(rows()));
    expect(planHash([...r].reverse())).toBe(planHash(r));
  });

  it("changes when one outcome changes", () => {
    const changed = classify({
      users: [
        user("lu-50", { email: "a@corp.example" }),
        user("lu-51", { email: "b@corp.example" }),
        user("lu-52", { email: "c@corp.example", role: "proxy_admin" }),
      ],
      people: [person(ALICE, "a@corp.example"), person(BOB, "b@corp.example")],
    });
    expect(planHash(changed)).not.toBe(planHash(rows()));
  });
});
