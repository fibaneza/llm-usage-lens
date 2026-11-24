import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { clearTable, ensureTestTable } from "@/test/support/test-support";

vi.mock("@/lib/dynamodb", () =>
  import("@/test/support/access-test-support").then((m) => m.faultyDynamodb()),
);

import {
  ACTOR,
  NOW,
  OID_A,
  OID_B,
  auditRecords,
  ctxAt,
  faults,
  ok,
  resetFaults,
} from "@/test/support/access-test-support";

import { getLiteLLMUserOwner, writeLiteLLMUserLink } from "./identity-links";
import { createPendingItem, listPendingFor } from "./pending";
import {
  createPendingLiteLLMLink,
  getPendingLiteLLMLink,
  listPendingLiteLLMLinks,
  removePendingLiteLLMLink,
} from "./pending-litellm-links";
import { getItem } from "./store";

// Source: docs/specs/2026-11-10-access-control.md - "Data model additions"
// (PendingLiteLLMLink: PENDING#{email} or PENDING#{oid} / LITELLMLINK, GSI1
// PENDINGLITELLMLINKS; fields; its LiteLLMUserClaim names the pending key as
// owner; shares the pending partition, so readers skip SK = LITELLMLINK),
// "LiteLLM user sync" - Pending LiteLLM links and Records (one
// identity.litellm-pending.set / .remove record per change, carrying the
// run's runId), "LiteLLM user links" (one-to-one claim); T-SY1, T-SY6, T-SY10.
// Against DynamoDB Local (Rule 60.22). Contract: lib/data/access/
// pending-litellm-links.ts exports createPendingLiteLLMLink({ emailOrOid,
// litellmUserId, runId }, ctx), getPendingLiteLLMLink(key),
// listPendingLiteLLMLinks(), removePendingLiteLLMLink({ emailOrOid, version,
// runId }, ctx); all but get/list return an AccessResult.
const ctx = ctxAt();
const RUN = "run-0001";
const create = (emailOrOid: string, litellmUserId = "lu-1") =>
  createPendingLiteLLMLink({ emailOrOid, litellmUserId, runId: RUN }, ctx);

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetFaults();
});

describe("createPendingLiteLLMLink", () => {
  it("stores a lower-cased email key with its claim and writes one identity.litellm-pending.set record carrying the runId", async () => {
    const link = ok(await create("Ada@Example.COM"));
    expect(link).toMatchObject({
      emailOrOid: "ada@example.com",
      litellmUserId: "lu-1",
      source: "sync",
      version: 1,
      createdBy: ACTOR,
      createdAt: NOW.toISOString(),
      lastValidatedAt: NOW.toISOString(),
    });
    const raw = await getItem("PENDING#ada@example.com", "LITELLMLINK");
    expect(raw).toMatchObject({
      gsi1pk: "PENDINGLITELLMLINKS",
      gsi1sk: "PENDING#ada@example.com",
    });
    const records = await auditRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "identity.litellm-pending.set",
      category: "change",
      result: "success",
      after: { runId: RUN, litellmUserId: "lu-1" },
    });
  });

  it("accepts an oid key (PENDING#{oid}), the second placeholder key", async () => {
    const link = ok(await create(OID_A, "lu-2"));
    expect(link.emailOrOid).toBe(OID_A);
    expect(await getItem(`PENDING#${OID_A}`, "LITELLMLINK")).toMatchObject({
      litellmUserId: "lu-2",
    });
  });

  it("claims the LiteLLM user for the pending key until the bind moves it", async () => {
    ok(await create("ada@example.com"));
    expect(await getLiteLLMUserOwner("lu-1")).toBe("ada@example.com");
  });

  it("returns CONFLICT for a second link on the same key or for a LiteLLM user already claimed, with no record", async () => {
    ok(await create("ada@example.com"));
    const r2 = ctxAt(NOW, "req-2");
    expect(
      await createPendingLiteLLMLink(
        { emailOrOid: "ADA@example.com", litellmUserId: "lu-9", runId: RUN },
        r2,
      ),
    ).toEqual({ ok: false, code: "CONFLICT" });
    expect(
      await createPendingLiteLLMLink(
        { emailOrOid: "bob@example.com", litellmUserId: "lu-1", runId: RUN },
        r2,
      ),
    ).toEqual({ ok: false, code: "CONFLICT" });
    expect(await getPendingLiteLLMLink("bob@example.com")).toBeNull();
    expect(await auditRecords()).toHaveLength(1);
  });

  it("returns CONFLICT for a LiteLLM user an identity already holds (one-to-one, T-SY1)", async () => {
    ok(
      await writeLiteLLMUserLink(
        {
          oid: OID_B,
          version: null,
          write: { kind: "set", litellmUserId: "lu-1", mode: "sync" },
        },
        ctxAt(NOW, "req-link"),
      ),
    );
    expect(await create("ada@example.com")).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(await getPendingLiteLLMLink("ada@example.com")).toBeNull();
  });

  it("makes an identity link to the placeholder's LiteLLM user a CONFLICT (never overwritten)", async () => {
    ok(await create("ada@example.com"));
    expect(
      await writeLiteLLMUserLink(
        {
          oid: OID_B,
          version: null,
          write: { kind: "set", litellmUserId: "lu-1", mode: "match" },
        },
        ctxAt(NOW, "req-2"),
      ),
    ).toEqual({ ok: false, code: "CONFLICT" });
  });

  it("writes one failed record, no item and no claim on a downstream failure", async () => {
    faults.transact = true;
    await expect(create("ada@example.com")).rejects.toThrow();
    faults.transact = false;
    expect(await getPendingLiteLLMLink("ada@example.com")).toBeNull();
    expect(await getLiteLLMUserOwner("lu-1")).toBeNull();
    const records = await auditRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "identity.litellm-pending.set",
      result: "failed",
    });
  });

  it("stores no Entra id field of LiteLLM (sso_user_id is never stored, S20)", async () => {
    ok(await create("ada@example.com"));
    const raw = await getItem("PENDING#ada@example.com", "LITELLMLINK");
    expect(Object.keys(raw ?? {}).sort()).toEqual(
      [
        "PK",
        "SK",
        "gsi1pk",
        "gsi1sk",
        "emailOrOid",
        "litellmUserId",
        "source",
        "version",
        "createdAt",
        "createdBy",
        "lastValidatedAt",
      ].sort(),
    );
  });
});

describe("getPendingLiteLLMLink and listPendingLiteLLMLinks", () => {
  it("gets a link by its key in any case and returns null for none", async () => {
    ok(await create("ada@example.com"));
    expect(await getPendingLiteLLMLink("ADA@example.com")).toMatchObject({
      emailOrOid: "ada@example.com",
      litellmUserId: "lu-1",
    });
    expect(await getPendingLiteLLMLink("nobody@example.com")).toBeNull();
  });

  it("lists every link, both key kinds, and no pending member or admin item", async () => {
    ok(await create("ada@example.com", "lu-1"));
    ok(await create(OID_A, "lu-2"));
    ok(
      await createPendingItem(
        { kind: "affiliation", emailOrUpn: "eve@example.com", teamId: "t1" },
        ctxAt(NOW, "req-2"),
      ),
    );
    const links = await listPendingLiteLLMLinks();
    expect(links.map((l) => l.emailOrOid).sort()).toEqual(
      ["ada@example.com", OID_A].sort(),
    );
  });

  it("lists nothing when none exists", async () => {
    expect(await listPendingLiteLLMLinks()).toEqual([]);
  });
});

// Access Control - Data model additions: the item shares PENDING#{key}, so the
// readers of a pending partition skip SK = LITELLMLINK instead of failing
// PendingItemSchema (agent decision, 2026-11-24).
describe("existing pending readers ignore the LITELLMLINK item", () => {
  it("listPendingFor returns only the pending affiliation next to a link on the same key", async () => {
    ok(await create("ada@example.com"));
    ok(
      await createPendingItem(
        { kind: "affiliation", emailOrUpn: "ada@example.com", teamId: "t1" },
        ctxAt(NOW, "req-2"),
      ),
    );
    const found = await listPendingFor(["ada@example.com"]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "affiliation", teamId: "t1" });
  });

  it("listPendingFor returns [] and does not throw when the key holds only a link", async () => {
    ok(await create("ada@example.com"));
    ok(await create(OID_A, "lu-2"));
    expect(await listPendingFor(["ada@example.com", OID_A])).toEqual([]);
  });
});

describe("removePendingLiteLLMLink", () => {
  it("deletes the link and its claim and writes one identity.litellm-pending.remove record carrying the runId", async () => {
    const link = ok(await create("ada@example.com"));
    expect(
      await removePendingLiteLLMLink(
        { emailOrOid: "ada@example.com", version: link.version, runId: RUN },
        ctxAt(NOW, "req-2"),
      ),
    ).toEqual({ ok: true, value: undefined });
    expect(await getPendingLiteLLMLink("ada@example.com")).toBeNull();
    expect(await getLiteLLMUserOwner("lu-1")).toBeNull();
    const records = await auditRecords();
    expect(records.map((r) => r.action)).toEqual([
      "identity.litellm-pending.set",
      "identity.litellm-pending.remove",
    ]);
    expect(records[1]).toMatchObject({
      result: "success",
      before: { litellmUserId: "lu-1" },
      after: { runId: RUN },
    });
  });

  it("returns CONFLICT on a stale version and NOT_FOUND when missing, with no record", async () => {
    const link = ok(await create("ada@example.com"));
    const r2 = ctxAt(NOW, "req-2");
    expect(
      await removePendingLiteLLMLink(
        {
          emailOrOid: "ada@example.com",
          version: link.version + 1,
          runId: RUN,
        },
        r2,
      ),
    ).toEqual({ ok: false, code: "CONFLICT" });
    expect(
      await removePendingLiteLLMLink(
        { emailOrOid: "ghost@example.com", version: 1, runId: RUN },
        r2,
      ),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await getPendingLiteLLMLink("ada@example.com")).not.toBeNull();
    expect(await getLiteLLMUserOwner("lu-1")).toBe("ada@example.com");
    expect(await auditRecords()).toHaveLength(1);
  });

  it("leaves a pending affiliation of the same key in place", async () => {
    const link = ok(await create("ada@example.com"));
    ok(
      await createPendingItem(
        { kind: "affiliation", emailOrUpn: "ada@example.com", teamId: "t1" },
        ctxAt(NOW, "req-2"),
      ),
    );
    ok(
      await removePendingLiteLLMLink(
        { emailOrOid: "ada@example.com", version: link.version, runId: RUN },
        ctxAt(NOW, "req-3"),
      ),
    );
    expect(await listPendingFor(["ada@example.com"])).toHaveLength(1);
  });
});
