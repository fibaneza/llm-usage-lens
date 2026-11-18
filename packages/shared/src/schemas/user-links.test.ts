import { describe, expect, it } from "vitest";

import {
  CreateLiteLLMUserBodySchema,
  DirectoryPageSchema,
  DirectoryQuerySchema,
  DirectoryRowSchema,
  LINK_REASON_MAX,
  LiteLLMLinkDeleteBodySchema,
  LiteLLMLinkPutBodySchema,
  LiteLLMLinkResultSchema,
  USER_LINKS_PAGE_SIZE,
} from "./user-links";

// Source: docs/specs/2026-11-10-access-control.md - "LiteLLM user links" (D16:
// match / manual, a manual link needs a reason of 1-280 characters, `400`
// without it), "API routes (additions)" (directory 25 a page, opaque cursor,
// `?include=litellmMatch`), T-MI1. Rule 60.22: valid and invalid inputs.

const accepts =
  (schema: { safeParse: (v: unknown) => { success: boolean } }) =>
  (v: unknown) =>
    expect(schema.safeParse(v).success).toBe(true);
const rejects =
  (schema: { safeParse: (v: unknown) => { success: boolean } }) =>
  (v: unknown) =>
    expect(schema.safeParse(v).success).toBe(false);

describe("LiteLLMLinkPutBodySchema (T-MI1)", () => {
  it("accepts a match link without a reason and a manual link with one", () => {
    accepts(LiteLLMLinkPutBodySchema)({
      litellmUserId: "lu-1",
      mode: "match",
      version: 0,
    });
    accepts(LiteLLMLinkPutBodySchema)({
      litellmUserId: "lu-1",
      mode: "manual",
      reason: "Same person, other email",
      version: 3,
    });
  });

  it("rejects a manual link with no reason or a blank one (reason required)", () => {
    rejects(LiteLLMLinkPutBodySchema)({
      litellmUserId: "lu-1",
      mode: "manual",
      version: 0,
    });
    rejects(LiteLLMLinkPutBodySchema)({
      litellmUserId: "lu-1",
      mode: "manual",
      reason: "   ",
      version: 0,
    });
  });

  it("bounds the reason at 280 characters", () => {
    const base = { litellmUserId: "lu-1", mode: "manual", version: 0 };
    accepts(LiteLLMLinkPutBodySchema)({
      ...base,
      reason: "x".repeat(LINK_REASON_MAX),
    });
    rejects(LiteLLMLinkPutBodySchema)({
      ...base,
      reason: "x".repeat(LINK_REASON_MAX + 1),
    });
  });

  it("rejects an unknown mode, a missing or empty id, a bad version and extra keys", () => {
    const ok = { litellmUserId: "lu-1", mode: "match", version: 0 };
    rejects(LiteLLMLinkPutBodySchema)({ ...ok, mode: "auto" });
    rejects(LiteLLMLinkPutBodySchema)({ ...ok, litellmUserId: "" });
    rejects(LiteLLMLinkPutBodySchema)({ mode: "match", version: 0 });
    rejects(LiteLLMLinkPutBodySchema)({ ...ok, version: -1 });
    rejects(LiteLLMLinkPutBodySchema)({ ...ok, version: 1.5 });
    rejects(LiteLLMLinkPutBodySchema)({ ...ok, version: undefined });
    rejects(LiteLLMLinkPutBodySchema)({ ...ok, email: "a@b.c" });
  });
});

describe("LiteLLMLinkDeleteBodySchema", () => {
  it("needs the stored version, at least 1 (a remove needs an existing link)", () => {
    accepts(LiteLLMLinkDeleteBodySchema)({ version: 1 });
    rejects(LiteLLMLinkDeleteBodySchema)({ version: 0 });
    rejects(LiteLLMLinkDeleteBodySchema)({});
    rejects(LiteLLMLinkDeleteBodySchema)({ version: 1, reason: "x" });
  });
});

describe("LiteLLMLinkResultSchema", () => {
  it("accepts a linked and an unlinked result and rejects a negative version", () => {
    accepts(LiteLLMLinkResultSchema)({
      oid: "o",
      litellmUserId: "lu",
      version: 2,
    });
    accepts(LiteLLMLinkResultSchema)({
      oid: "o",
      litellmUserId: null,
      version: 3,
    });
    rejects(LiteLLMLinkResultSchema)({
      oid: "o",
      litellmUserId: "lu",
      version: -1,
    });
    rejects(LiteLLMLinkResultSchema)({
      oid: "",
      litellmUserId: null,
      version: 1,
    });
  });
});

describe("directory schemas (API routes: 25 a page, opaque cursor, D15)", () => {
  const row = {
    oid: "o1",
    displayName: "Alice",
    email: "alice@company.com",
    authMethod: "entra",
    memberTeamId: null,
    litellm: { state: "none" },
    linkVersion: 0,
  };

  it("accepts an unlinked, a linked and a matched row", () => {
    accepts(DirectoryRowSchema)(row);
    accepts(DirectoryRowSchema)({
      ...row,
      litellm: { state: "linked", litellmUserId: "lu-1" },
      linkVersion: 4,
    });
    accepts(DirectoryRowSchema)({
      ...row,
      match: { litellmUserId: "lu-1", email: "alice@company.com" },
    });
    accepts(DirectoryRowSchema)({ ...row, match: null });
  });

  it("rejects a linked row with no LiteLLM id, an unknown state and a negative linkVersion", () => {
    rejects(DirectoryRowSchema)({ ...row, litellm: { state: "linked" } });
    rejects(DirectoryRowSchema)({ ...row, litellm: { state: "maybe" } });
    rejects(DirectoryRowSchema)({ ...row, linkVersion: -1 });
    rejects(DirectoryRowSchema)({ ...row, authMethod: "saml" });
  });

  it("caps a page at 25 rows", () => {
    expect(USER_LINKS_PAGE_SIZE).toBe(25);
    const items = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ ...row, oid: `o${i}` }));
    accepts(DirectoryPageSchema)({ items: items(25), cursor: "abc" });
    accepts(DirectoryPageSchema)({ items: [] });
    rejects(DirectoryPageSchema)({ items: items(26) });
  });

  it("accepts only the litellmMatch include and a bounded cursor", () => {
    accepts(DirectoryQuerySchema)({});
    accepts(DirectoryQuerySchema)({ include: "litellmMatch", cursor: "c" });
    rejects(DirectoryQuerySchema)({ include: "everything" });
    rejects(DirectoryQuerySchema)({ cursor: "" });
    rejects(DirectoryQuerySchema)({ cursor: "c".repeat(2049) });
  });
});

describe("CreateLiteLLMUserBodySchema (LiteLLM spec createUser: only the oid)", () => {
  it("takes the oid alone, so the body can never carry a role or email", () => {
    accepts(CreateLiteLLMUserBodySchema)({ oid: "o1" });
    rejects(CreateLiteLLMUserBodySchema)({});
    rejects(CreateLiteLLMUserBodySchema)({
      oid: "o1",
      user_role: "proxy_admin",
    });
    rejects(CreateLiteLLMUserBodySchema)({ oid: "" });
  });
});
