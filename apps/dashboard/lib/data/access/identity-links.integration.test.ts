import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearTable,
  ensureTestTable,
  putRaw,
} from "@/test/support/test-support";

vi.mock("@/lib/dynamodb", () =>
  import("@/test/support/access-test-support").then((m) => m.faultyDynamodb()),
);

import {
  NOW,
  OID_A,
  OID_B,
  auditRecords,
  ctxAt,
  faults,
  ok,
  resetFaults,
} from "@/test/support/access-test-support";
import {
  getIdentityLink,
  getLiteLLMUserOwner,
  getUsageKeysClaimedWith,
  putIdentityLink,
  writeLiteLLMUserLink,
} from "./identity-links";

// Source: docs/specs/2026-11-10-access-control.md — "Data model additions"
// (IdentityLink, UsageKeyClaim: unique usage keys claimed in the same
// TransactWriteItems), "Audit log"; contract R2 §2-§4, addendum B.4.
// Claims cover usageIdentities AND aliases (review: aliases unique across
// people); a claim is released when the key leaves the link.
const ctx = ctxAt();
const link = (
  oid: string,
  usageIdentities: string[],
  version: number | null = null,
  extra: { aliases?: string[]; litellmUserId?: string } = {},
) => ({
  oid,
  usageIdentities,
  aliases: extra.aliases ?? [],
  ...extra,
  version,
});

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetFaults();
});

describe("putIdentityLink", () => {
  it("creates a link and one identity.link.update record", async () => {
    expect(await getIdentityLink(OID_A)).toBeNull();
    const created = ok(
      await putIdentityLink(
        link(OID_A, ["jane@example.com"], null, {
          aliases: ["jane.doe"],
          litellmUserId: "u-1",
        }),
        ctx,
      ),
    );
    expect(created).toMatchObject({
      oid: OID_A,
      usageIdentities: ["jane@example.com"],
      aliases: ["jane.doe"],
      litellmUserId: "u-1",
      version: 1,
      updatedAt: NOW.toISOString(),
    });
    expect(await getIdentityLink(OID_A)).toEqual(created);
    const records = await auditRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "identity.link.update",
      category: "change",
      result: "success",
    });
  });

  it("updates with the matching version and increments it", async () => {
    const v1 = ok(await putIdentityLink(link(OID_A, ["a@example.com"]), ctx));
    const v2 = ok(
      await putIdentityLink(
        link(OID_A, ["a@example.com", "b@example.com"], v1.version),
        ctxAt(NOW, "req-2"),
      ),
    );
    expect(v2.version).toBe(v1.version + 1);
    expect(v2.usageIdentities).toEqual(["a@example.com", "b@example.com"]);
    expect(await auditRecords()).toHaveLength(2);
  });

  it("returns CONFLICT for a stale version or a create over an existing link, no record", async () => {
    const v1 = ok(await putIdentityLink(link(OID_A, ["a@example.com"]), ctx));
    const r2 = ctxAt(NOW, "req-2");
    expect(
      await putIdentityLink(link(OID_A, ["a@example.com"], v1.version + 3), r2),
    ).toEqual({ ok: false, code: "CONFLICT" });
    expect(await putIdentityLink(link(OID_A, ["a@example.com"]), r2)).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(await auditRecords()).toHaveLength(1);
  });

  it("returns CONFLICT when another person already claims a usage key, writing nothing", async () => {
    ok(await putIdentityLink(link(OID_A, ["shared@example.com"]), ctx));
    const result = await putIdentityLink(
      link(OID_B, ["fresh@example.com", "shared@example.com"]),
      ctxAt(NOW, "req-2"),
    );
    expect(result).toEqual({ ok: false, code: "CONFLICT" });
    expect(await getIdentityLink(OID_B)).toBeNull();
    expect(await auditRecords()).toHaveLength(1);
    // The non-conflicting key was not claimed either.
    expect(
      await putIdentityLink(
        link(OID_A, ["a@example.com", "fresh@example.com"]),
        ctxAt(NOW, "req-3"),
      ),
    ).toMatchObject({ ok: false, code: "CONFLICT" });
  });

  it("releases a claim when the key leaves the link", async () => {
    const v1 = ok(await putIdentityLink(link(OID_A, ["old@example.com"]), ctx));
    ok(
      await putIdentityLink(
        link(OID_A, ["new@example.com"], v1.version),
        ctxAt(NOW, "req-2"),
      ),
    );
    ok(
      await putIdentityLink(
        link(OID_B, ["old@example.com"]),
        ctxAt(NOW, "req-3"),
      ),
    );
  });

  it("returns CONFLICT when an alias equals another person's alias or usage identity, writing nothing", async () => {
    ok(
      await putIdentityLink(
        link(OID_A, ["a@example.com"], null, { aliases: ["shared.alias"] }),
        ctx,
      ),
    );
    const r2 = ctxAt(NOW, "req-2");
    for (const attempt of [
      link(OID_B, ["b@example.com"], null, { aliases: ["shared.alias"] }),
      link(OID_B, ["b@example.com"], null, { aliases: ["a@example.com"] }),
      link(OID_B, ["shared.alias"]),
    ]) {
      expect(await putIdentityLink(attempt, r2)).toEqual({
        ok: false,
        code: "CONFLICT",
      });
      expect(await getIdentityLink(OID_B)).toBeNull();
    }
    expect(await auditRecords()).toHaveLength(1);
    // b@example.com was never claimed by the failed attempts.
    ok(await putIdentityLink(link(OID_B, ["b@example.com"]), ctxAt(NOW, "r3")));
  });

  it("releases alias claims when the alias leaves the link", async () => {
    const v1 = ok(
      await putIdentityLink(
        link(OID_A, ["a@example.com"], null, { aliases: ["old.alias"] }),
        ctx,
      ),
    );
    ok(
      await putIdentityLink(
        link(OID_A, ["a@example.com"], v1.version),
        ctxAt(NOW, "req-2"),
      ),
    );
    ok(
      await putIdentityLink(
        link(OID_B, ["b@example.com"], null, { aliases: ["old.alias"] }),
        ctxAt(NOW, "req-3"),
      ),
    );
  });

  it("writes one failed record, no link and no claim, and rethrows on a downstream failure", async () => {
    faults.transact = true;
    await expect(
      putIdentityLink(link(OID_A, ["a@example.com"]), ctx),
    ).rejects.toThrow();
    faults.transact = false;
    expect(await getIdentityLink(OID_A)).toBeNull();
    const records = await auditRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "identity.link.update",
      result: "failed",
    });
    ok(await putIdentityLink(link(OID_B, ["a@example.com"]), ctxAt(NOW, "r2")));
  });
});

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage
// (L6)" (Person P: for another person the key set is the canonical email plus
// that identity's usage identities and aliases); Rule 60.10 (authorization
// data is read per request, never cached).
describe("getUsageKeysClaimedWith", () => {
  it("returns the key plus every usage identity and alias of the identity that claims it", async () => {
    ok(
      await putIdentityLink(
        link(OID_A, ["jane@example.com", "jane2@example.com"], null, {
          aliases: ["jane.doe"],
        }),
        ctx,
      ),
    );
    expect(
      [...(await getUsageKeysClaimedWith("jane@example.com"))].sort(),
    ).toEqual(["jane.doe", "jane2@example.com", "jane@example.com"]);
    expect([...(await getUsageKeysClaimedWith("jane.doe"))].sort()).toContain(
      "jane@example.com",
    );
  });

  it("with no claim returns only the key itself", async () => {
    expect(await getUsageKeysClaimedWith("nobody@example.com")).toEqual([
      "nobody@example.com",
    ]);
  });

  it("never returns another identity's keys", async () => {
    ok(await putIdentityLink(link(OID_A, ["a@example.com"]), ctx));
    ok(
      await putIdentityLink(
        link(OID_B, ["b@example.com"], null, { aliases: ["bee"] }),
        ctx,
      ),
    );
    expect(await getUsageKeysClaimedWith("a@example.com")).toEqual([
      "a@example.com",
    ]);
  });

  it("sees a link change on the next call (read per request)", async () => {
    const v1 = ok(await putIdentityLink(link(OID_A, ["a@example.com"]), ctx));
    expect(await getUsageKeysClaimedWith("a@example.com")).toEqual([
      "a@example.com",
    ]);
    ok(
      await putIdentityLink(
        link(OID_A, ["a@example.com", "a2@example.com"], v1.version),
        ctx,
      ),
    );
    expect(
      [...(await getUsageKeysClaimedWith("a@example.com"))].sort(),
    ).toEqual(["a2@example.com", "a@example.com"]);
  });
});

// Source: docs/specs/2026-11-10-access-control.md - "LiteLLM user links"
// (D16, unit M3): one-to-one `LiteLLMUserClaim` written in the same
// transaction as the link and its audit record; duplicate -> CONFLICT; the
// audit record of a set and a remove carries mode, both ids and the reason;
// agent decisions 2026-11-18 (the link item keeps the last mode and reason;
// every write of a link holding a litellmUserId puts its claim, which adds
// the missing claim of a link stored before M3; releasing a claim that does
// not exist is not a conflict); T-MI1; Rule 60.10 (never cached).
const setOf = (
  oid: string,
  litellmUserId: string,
  version: number | null,
  over: { mode?: "match" | "manual"; reason?: string } = {},
) => ({
  oid,
  version,
  write: {
    kind: "set" as const,
    litellmUserId,
    mode: over.mode ?? ("match" as const),
    ...(over.reason ? { reason: over.reason } : {}),
  },
});
const legacyLink = (oid: string, litellmUserId: string) =>
  putRaw({
    PK: `IDENT#${oid}`,
    SK: "LINK",
    oid,
    usageIdentities: [],
    aliases: [],
    litellmUserId,
    version: 1,
    updatedAt: NOW.toISOString(),
  });
const recordsOf = async (action: string) =>
  (await auditRecords()).filter((r) => r.action === action);

describe("writeLiteLLMUserLink", () => {
  it("a set writes the link, its claim and one audit record with mode and both ids (match)", async () => {
    const link = ok(
      await writeLiteLLMUserLink(setOf(OID_A, "lu-1", null), ctx),
    );
    expect(link).toMatchObject({
      oid: OID_A,
      litellmUserId: "lu-1",
      version: 1,
    });
    expect(await getIdentityLink(OID_A)).toMatchObject({
      litellmUserId: "lu-1",
    });
    expect(await getLiteLLMUserOwner("lu-1")).toBe(OID_A);
    const records = await recordsOf("identity.litellm-link.set");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      category: "change",
      result: "success",
      target: { type: "identity", id: OID_A },
      after: { oid: OID_A, litellmUserId: "lu-1", mode: "match", version: 1 },
    });
    expect(records[0]?.after).not.toHaveProperty("reason");
  });

  it("a manual set stores the reason in the audit record (T-MI1: audited with the reason)", async () => {
    ok(
      await writeLiteLLMUserLink(
        setOf(OID_A, "lu-1", null, {
          mode: "manual",
          reason: "Same person, other email",
        }),
        ctx,
      ),
    );
    const [record] = await recordsOf("identity.litellm-link.set");
    expect(record?.after).toMatchObject({
      mode: "manual",
      reason: "Same person, other email",
      litellmUserId: "lu-1",
    });
  });

  it("returns CONFLICT when another identity claims the LiteLLM user, with no link, claim change or record (duplicate 409)", async () => {
    ok(await writeLiteLLMUserLink(setOf(OID_A, "lu-1", null), ctx));
    const result = await writeLiteLLMUserLink(
      setOf(OID_B, "lu-1", null),
      ctxAt(NOW, "req-2"),
    );
    expect(result).toEqual({ ok: false, code: "CONFLICT" });
    expect(await getIdentityLink(OID_B)).toBeNull();
    expect(await getLiteLLMUserOwner("lu-1")).toBe(OID_A);
    expect(await recordsOf("identity.litellm-link.set")).toHaveLength(1);
  });

  it("returns CONFLICT for a stale or missing version, writing nothing (stale version 409)", async () => {
    const v1 = ok(await writeLiteLLMUserLink(setOf(OID_A, "lu-1", null), ctx));
    const r2 = ctxAt(NOW, "req-2");
    expect(
      await writeLiteLLMUserLink(setOf(OID_A, "lu-2", v1.version + 2), r2),
    ).toEqual({ ok: false, code: "CONFLICT" });
    expect(await writeLiteLLMUserLink(setOf(OID_A, "lu-2", null), r2)).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(await getLiteLLMUserOwner("lu-2")).toBeNull();
    expect(await recordsOf("identity.litellm-link.set")).toHaveLength(1);
  });

  it("a remove releases the claim and audits mode, both ids and the reason in before (T-MI1)", async () => {
    const v1 = ok(
      await writeLiteLLMUserLink(
        setOf(OID_A, "lu-1", null, {
          mode: "manual",
          reason: "Contractor alias",
        }),
        ctx,
      ),
    );
    const removed = ok(
      await writeLiteLLMUserLink(
        { oid: OID_A, version: v1.version, write: { kind: "remove" } },
        ctxAt(NOW, "req-2"),
      ),
    );
    expect(removed.litellmUserId).toBeUndefined();
    expect(await getLiteLLMUserOwner("lu-1")).toBeNull();
    const [record] = await recordsOf("identity.litellm-link.remove");
    expect(record).toMatchObject({
      target: { type: "identity", id: OID_A },
      before: {
        oid: OID_A,
        litellmUserId: "lu-1",
        mode: "manual",
        reason: "Contractor alias",
      },
    });
    // The released LiteLLM user can be linked to another identity.
    ok(
      await writeLiteLLMUserLink(
        setOf(OID_B, "lu-1", null),
        ctxAt(NOW, "req-3"),
      ),
    );
  });

  it("replacing the LiteLLM user releases the old claim and takes the new one", async () => {
    const v1 = ok(await writeLiteLLMUserLink(setOf(OID_A, "lu-1", null), ctx));
    ok(
      await writeLiteLLMUserLink(
        setOf(OID_A, "lu-2", v1.version),
        ctxAt(NOW, "req-2"),
      ),
    );
    expect(await getLiteLLMUserOwner("lu-1")).toBeNull();
    expect(await getLiteLLMUserOwner("lu-2")).toBe(OID_A);
    const [, second] = await recordsOf("identity.litellm-link.set");
    expect(second?.before).toMatchObject({ litellmUserId: "lu-1" });
  });

  it("keeps the usage identities and aliases of the link it changes", async () => {
    const v1 = ok(
      await putIdentityLink(
        link(OID_A, ["a@example.com"], null, { aliases: ["a.alias"] }),
        ctx,
      ),
    );
    const next = ok(
      await writeLiteLLMUserLink(
        setOf(OID_A, "lu-1", v1.version),
        ctxAt(NOW, "req-2"),
      ),
    );
    expect(next).toMatchObject({
      usageIdentities: ["a@example.com"],
      aliases: ["a.alias"],
      litellmUserId: "lu-1",
    });
  });

  it("the stored mode and reason survive a later usage-identity update, so a remove still audits them (decision 2026-11-18)", async () => {
    const v1 = ok(
      await writeLiteLLMUserLink(
        setOf(OID_A, "lu-1", null, { mode: "manual", reason: "Why" }),
        ctx,
      ),
    );
    const v2 = ok(
      await putIdentityLink(
        link(OID_A, ["a@example.com"], v1.version, { litellmUserId: "lu-1" }),
        ctxAt(NOW, "req-2"),
      ),
    );
    ok(
      await writeLiteLLMUserLink(
        { oid: OID_A, version: v2.version, write: { kind: "remove" } },
        ctxAt(NOW, "req-3"),
      ),
    );
    const [record] = await recordsOf("identity.litellm-link.remove");
    expect(record?.before).toMatchObject({ mode: "manual", reason: "Why" });
  });

  it("writes one failed record, no link and no claim, and rethrows on a downstream failure (same transaction)", async () => {
    faults.transact = true;
    await expect(
      writeLiteLLMUserLink(setOf(OID_A, "lu-1", null), ctx),
    ).rejects.toThrow();
    faults.transact = false;
    expect(await getIdentityLink(OID_A)).toBeNull();
    expect(await getLiteLLMUserOwner("lu-1")).toBeNull();
    const records = await recordsOf("identity.litellm-link.set");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ result: "failed" });
  });

  it("a read after a write sees it (identity links are never cached, Rule 60.10)", async () => {
    const v1 = ok(await writeLiteLLMUserLink(setOf(OID_A, "lu-1", null), ctx));
    expect((await getIdentityLink(OID_A))?.litellmUserId).toBe("lu-1");
    ok(
      await writeLiteLLMUserLink(
        { oid: OID_A, version: v1.version, write: { kind: "remove" } },
        ctxAt(NOW, "req-2"),
      ),
    );
    expect((await getIdentityLink(OID_A))?.litellmUserId).toBeUndefined();
  });

  it("a link stored before M3 (no claim) gets its claim on the next write that keeps its LiteLLM user (decision 2026-11-18)", async () => {
    await legacyLink(OID_A, "lu-old");
    expect(await getLiteLLMUserOwner("lu-old")).toBeNull();
    ok(
      await putIdentityLink(
        link(OID_A, ["a@example.com"], 1, { litellmUserId: "lu-old" }),
        ctxAt(NOW, "req-2"),
      ),
    );
    expect(await getLiteLLMUserOwner("lu-old")).toBe(OID_A);
    expect(
      await writeLiteLLMUserLink(
        setOf(OID_B, "lu-old", null),
        ctxAt(NOW, "req-3"),
      ),
    ).toEqual({ ok: false, code: "CONFLICT" });
  });

  it("releasing a claim that does not exist is not a conflict (decision 2026-11-18)", async () => {
    await legacyLink(OID_A, "lu-old");
    ok(
      await writeLiteLLMUserLink(
        { oid: OID_A, version: 1, write: { kind: "remove" } },
        ctx,
      ),
    );
    expect((await getIdentityLink(OID_A))?.litellmUserId).toBeUndefined();
  });
});

describe("putIdentityLink with a litellmUserId (D16: both routes use one domain function)", () => {
  it("claims the LiteLLM user, and another identity cannot link it through either path", async () => {
    ok(
      await putIdentityLink(
        link(OID_A, [], null, { litellmUserId: "lu-1" }),
        ctx,
      ),
    );
    expect(await getLiteLLMUserOwner("lu-1")).toBe(OID_A);
    expect(
      await putIdentityLink(
        link(OID_B, [], null, { litellmUserId: "lu-1" }),
        ctxAt(NOW, "req-2"),
      ),
    ).toEqual({ ok: false, code: "CONFLICT" });
    expect(await getIdentityLink(OID_B)).toBeNull();
    expect(
      await writeLiteLLMUserLink(
        setOf(OID_B, "lu-1", null),
        ctxAt(NOW, "req-3"),
      ),
    ).toEqual({ ok: false, code: "CONFLICT" });
  });

  it("releases the claim when the update drops the LiteLLM user", async () => {
    const v1 = ok(
      await putIdentityLink(
        link(OID_A, [], null, { litellmUserId: "lu-1" }),
        ctx,
      ),
    );
    ok(await putIdentityLink(link(OID_A, [], v1.version), ctxAt(NOW, "req-2")));
    expect(await getLiteLLMUserOwner("lu-1")).toBeNull();
  });

  it("audits identity.link.update with the litellmUserId in before and after when set", async () => {
    const v1 = ok(
      await putIdentityLink(
        link(OID_A, ["a@example.com"], null, { litellmUserId: "lu-1" }),
        ctx,
      ),
    );
    ok(
      await putIdentityLink(
        link(OID_A, ["a@example.com", "b@example.com"], v1.version, {
          litellmUserId: "lu-1",
        }),
        ctxAt(NOW, "req-2"),
      ),
    );
    const records = await recordsOf("identity.link.update");
    expect(records[0]?.after).toMatchObject({ litellmUserId: "lu-1" });
    expect(records[1]?.before).toMatchObject({ litellmUserId: "lu-1" });
    expect(records[1]?.after).toMatchObject({ litellmUserId: "lu-1" });
  });
});
