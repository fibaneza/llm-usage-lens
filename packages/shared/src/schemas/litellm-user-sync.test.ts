import { describe, expect, it } from "vitest";

import {
  LITELLM_SYNC_ERROR_CODES,
  LITELLM_SYNC_SKIP_REASONS,
  LiteLLMSyncBodySchema,
  LiteLLMSyncMembershipReasonSchema,
  LiteLLMSyncPlanResponseSchema,
  LiteLLMSyncResultSchema,
  LiteLLMSyncTriggerSchema,
  LiteLLMSyncUserRowSchema,
  PendingLiteLLMLinkSchema,
  PendingLinkDeleteBodySchema,
  PendingLinkRemovedSchema,
  PendingLinkRowSchema,
} from "./litellm-user-sync";

// Source: docs/specs/2026-11-10-access-control.md - "LiteLLM user sync"
// (Users table, Pending LiteLLM links, Teams, Preview and apply, Records),
// "Data model additions" (PendingLiteLLMLink fields), T-SY1, T-SY5, T-SY7,
// T-SY10; Rule 60.22 (valid and invalid inputs); Rule 20.11 (shape validated
// on both ends). Contract: packages/shared/src/schemas/litellm-user-sync.ts
// exports the names imported above; field names below are the contract.

const accepts =
  (schema: { safeParse: (v: unknown) => { success: boolean } }) =>
  (v: unknown) =>
    expect(schema.safeParse(v).success).toBe(true);
const rejects =
  (schema: { safeParse: (v: unknown) => { success: boolean } }) =>
  (v: unknown) =>
    expect(schema.safeParse(v).success).toBe(false);

const HASH = "a".repeat(64);
const NOW = "2026-11-24T10:00:00.000Z";

describe("LiteLLMSyncBodySchema (POST { planHash }, T-SY5)", () => {
  it("accepts a SHA-256 hex plan hash", () => {
    accepts(LiteLLMSyncBodySchema)({ planHash: HASH });
  });

  it.each([
    ["no hash", {}],
    ["an empty hash", { planHash: "" }],
    ["a non-hex hash", { planHash: "z".repeat(64) }],
    ["a short hash", { planHash: "abc" }],
    ["an unknown field (strict body)", { planHash: HASH, placeTeams: true }],
  ])("rejects %s", (_n, body) => rejects(LiteLLMSyncBodySchema)(body));
});

describe("trigger, skip reasons and error codes", () => {
  it("allows the trigger manual or schedule only (Records)", () => {
    accepts(LiteLLMSyncTriggerSchema)("manual");
    accepts(LiteLLMSyncTriggerSchema)("schedule");
    rejects(LiteLLMSyncTriggerSchema)("system");
  });

  it("lists exactly the user skip reasons of the Users table", () => {
    expect([...LITELLM_SYNC_SKIP_REASONS].sort()).toEqual(
      [
        "no-email",
        "duplicate-email",
        "ambiguous-identity",
        "privileged",
        "service-user",
        "claimed",
        "identity-linked-elsewhere",
        "own-identity",
      ].sort(),
    );
  });

  it("lists the team reasons of Teams and the removal guard of the clean-up", () => {
    for (const reason of [
      "multiple-teams",
      "other-team",
      "own-identity",
      "removal-guard",
    ]) {
      accepts(LiteLLMSyncMembershipReasonSchema)(reason);
    }
    rejects(LiteLLMSyncMembershipReasonSchema)("privileged");
  });

  it("names the three 409 codes of Preview and apply", () => {
    expect([...LITELLM_SYNC_ERROR_CODES].sort()).toEqual(
      ["PLAN_CHANGED", "PLAN_TRUNCATED", "SYNC_RUNNING"].sort(),
    );
  });
});

describe("LiteLLMSyncUserRowSchema (Users table; T-SY1)", () => {
  const base = { litellmUserId: "lu-1", email: "ada@example.com" };

  it.each([
    [
      "link-existing by the Entra id",
      { outcome: "link-existing", oid: "oid-1", matchedKey: "oid" },
    ],
    [
      "link-existing by the email",
      { outcome: "link-existing", oid: "oid-1", matchedKey: "email" },
    ],
    ["create-pending", { outcome: "create-pending" }],
    ["already-linked", { outcome: "already-linked" }],
    ["already-pending", { outcome: "already-pending" }],
    ["a skip with a reason", { outcome: "skip", reason: "claimed" }],
  ])("accepts %s", (_n, extra) =>
    accepts(LiteLLMSyncUserRowSchema)({ ...base, ...extra }),
  );

  it.each([
    ["a skip with no reason", { outcome: "skip" }],
    [
      "a skip with a team reason",
      { outcome: "skip", reason: "multiple-teams" },
    ],
    ["an unknown outcome", { outcome: "unlink" }],
    [
      "a link-existing with no matched key",
      { outcome: "link-existing", oid: "oid-1" },
    ],
    [
      "a matched key other than oid or email",
      { outcome: "link-existing", oid: "oid-1", matchedKey: "name" },
    ],
    [
      "an empty LiteLLM user id",
      { outcome: "create-pending", litellmUserId: "" },
    ],
  ])("rejects %s", (_n, extra) =>
    rejects(LiteLLMSyncUserRowSchema)({ ...base, ...extra }),
  );

  it.each(["sso_user_id", "ssoUserId"])(
    "rejects a row that carries %s: it is never returned (S20, T-SY1)",
    (key) =>
      rejects(LiteLLMSyncUserRowSchema)({
        ...base,
        outcome: "create-pending",
        [key]: "entra-oid-9",
      }),
  );
});

describe("PendingLiteLLMLinkSchema (Data model additions)", () => {
  const link = {
    emailOrOid: "ada@example.com",
    litellmUserId: "lu-1",
    source: "sync",
    version: 1,
    createdAt: NOW,
    createdBy: "system",
    lastValidatedAt: NOW,
  };

  it("accepts a link keyed by an email and one keyed by an oid", () => {
    accepts(PendingLiteLLMLinkSchema)(link);
    accepts(PendingLiteLLMLinkSchema)({
      ...link,
      emailOrOid: "00000000-0000-4000-8000-000000000001",
    });
  });

  it.each([
    ["a missing LiteLLM user id", { litellmUserId: undefined }],
    ["a source other than sync", { source: "ui" }],
    ["version 0", { version: 0 }],
    ["a bad createdAt", { createdAt: "yesterday" }],
    ["a missing lastValidatedAt", { lastValidatedAt: undefined }],
    ["an empty key", { emailOrOid: "" }],
    [
      "an upper-case email key (the key is lower-cased)",
      { emailOrOid: "Ada@Example.com" },
    ],
  ])("rejects %s", (_n, patch) =>
    rejects(PendingLiteLLMLinkSchema)({ ...link, ...patch }),
  );
});

describe("LiteLLMSyncPlanResponseSchema (GET, LD37)", () => {
  const counts = {
    toLink: 1,
    toPend: 2,
    alreadyLinked: 3,
    skipped: 4,
    memberships: 5,
  };
  const plan = {
    users: [
      {
        litellmUserId: "lu-1",
        email: "ada@example.com",
        outcome: "create-pending",
      },
    ],
    memberships: [
      {
        litellmUserId: "lu-1",
        teamId: "t1",
        outcome: "skip",
        reason: "multiple-teams",
      },
    ],
    drift: [{ kind: "not-in-litellm-team", teamId: "t1", oid: "oid-1" }],
    notPlaced: [{ litellmUserId: "lu-1", reason: "multiple-teams" }],
    counts,
    truncated: false,
    planHash: HASH,
  };

  it("accepts a plan with its counts, truncated flag and hash", () => {
    accepts(LiteLLMSyncPlanResponseSchema)({ configured: true, ...plan });
    accepts(LiteLLMSyncPlanResponseSchema)({
      configured: true,
      ...plan,
      truncated: true,
    });
  });

  it("accepts configured: false with no plan (LD37: no LiteLLM call)", () => {
    accepts(LiteLLMSyncPlanResponseSchema)({ configured: false });
  });

  it.each([
    ["no plan hash", { planHash: undefined }],
    ["no truncated flag", { truncated: undefined }],
    ["no counts", { counts: undefined }],
    ["a negative count", { counts: { ...counts, skipped: -1 } }],
    [
      "a drift kind it does not know",
      { drift: [{ kind: "removed", oid: "oid-1" }] },
    ],
    [
      "a user row with sso_user_id",
      { users: [{ ...plan.users[0], sso_user_id: "x" }] },
    ],
  ])("rejects a configured plan with %s", (_n, patch) =>
    rejects(LiteLLMSyncPlanResponseSchema)({
      configured: true,
      ...plan,
      ...patch,
    }),
  );
});

describe("LiteLLMSyncResultSchema (POST, T-SY5, T-SY10)", () => {
  const result = {
    runId: "run-1",
    results: { users: [], memberships: [], notPlaced: [] },
    remaining: 0,
  };

  it("accepts the results, the run id and the remaining changes", () => {
    accepts(LiteLLMSyncResultSchema)(result);
    accepts(LiteLLMSyncResultSchema)({ ...result, remaining: 120 });
  });

  it.each([
    ["no run id", { runId: undefined }],
    ["no remaining", { remaining: undefined }],
    ["a negative remaining", { remaining: -1 }],
    ["a fractional remaining", { remaining: 1.5 }],
  ])("rejects %s", (_n, patch) =>
    rejects(LiteLLMSyncResultSchema)({ ...result, ...patch }),
  );
});

// Access Control - LiteLLM user sync, ~line 1033 (S20, T-SY1): a pending-link
// row carries an email only when the placeholder key is an email; the DELETE
// body addresses a row by exactly one of `email` or `litellmUserId`.
describe("pending link row and DELETE body (S20)", () => {
  const row = {
    litellmUserId: "lu-1",
    version: 1,
    createdAt: "2026-11-20T10:00:00.000Z",
  };
  it("accepts a row with an email and a row without one", () => {
    accepts(PendingLinkRowSchema)({ ...row, email: "a@b.co" });
    accepts(PendingLinkRowSchema)(row);
  });
  it("rejects a row carrying an SSO field", () => {
    rejects(PendingLinkRowSchema)({ ...row, sso_user_id: "x" });
  });
  it.each([
    ["an email", { email: "a@b.co", version: 1 }, true],
    ["a litellmUserId", { litellmUserId: "lu-1", version: 1 }, true],
    ["neither", { version: 1 }, false],
    ["both", { email: "a@b.co", litellmUserId: "lu-1", version: 1 }, false],
    ["no version", { litellmUserId: "lu-1" }, false],
  ])("DELETE body with %s", (_n, body, valid) =>
    expect(PendingLinkDeleteBodySchema.safeParse(body).success).toBe(valid),
  );
  it("the removed response names the email or the litellmUserId", () => {
    accepts(PendingLinkRemovedSchema)({ email: "a@b.co" });
    accepts(PendingLinkRemovedSchema)({ litellmUserId: "lu-1" });
    rejects(PendingLinkRemovedSchema)({});
  });
});
