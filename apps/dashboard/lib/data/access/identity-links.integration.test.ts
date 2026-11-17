import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { clearTable, ensureTestTable } from "@/test/support/test-support";

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
  getUsageKeysClaimedWith,
  putIdentityLink,
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
