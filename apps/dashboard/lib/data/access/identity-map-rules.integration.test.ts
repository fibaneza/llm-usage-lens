import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TEST_TABLE_NAME,
  clearTable,
  ensureTestTable,
  testDoc,
} from "@/test/test-support";

vi.mock("@/lib/dynamodb", () =>
  import("./access-test-support").then((m) => m.faultyDynamodb()),
);

import {
  ACTOR,
  GOVERNANCE_PK,
  NOW,
  auditRecords,
  ctxAt,
  faults,
  ok,
  resetFaults,
} from "./access-test-support";
import {
  IDENTITY_MAP_RULES_SK,
  getIdentityMapRules,
  setIdentityMapRules,
} from "./identity-map-rules";

// Source: docs/specs/2026-11-10-access-control.md - "Usage-identity mapping
// rules (D27)": rules are stored in one GOVERNANCE/IDENTITY_MAP_RULES item
// (versioned, audited; no new key prefix) and "never grant access and never map
// to a person automatically"; "Data model additions" (every mutable item carries
// `version`), "Enforcement" item 4 (authorization data, including mappings, is
// never cached: a change applies on the next read), item 6 (version -> CONFLICT),
// "Audit log" (a success commits its record in the same transaction; a condition
// failure writes none; any other failure writes one `failed` record), "Storage
// boundary" (D26: one domain function owns its transaction). Pattern as
// per-user-approval: `version` is the stored version (0 when nothing is
// recorded); the whole ordered list is replaced on each write (a deleted rule is
// a list without it). Module under test: `identity-map-rules.ts` (new).
const SSO = { pattern: "{name}-sso", template: "{name}@company.com" };
const SVC = { pattern: "svc-{name}", template: "{name}@company.com" };

async function allItems(): Promise<Record<string, unknown>[]> {
  const out = await testDoc().send(
    new ScanCommand({ TableName: TEST_TABLE_NAME }),
  );
  return (out.Items ?? []).filter((i) => !String(i.PK).startsWith("AUDIT#"));
}

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetFaults();
});

describe("getIdentityMapRules", () => {
  it("returns null when nothing is stored (no rules yet is a state, not an error)", async () => {
    expect(await getIdentityMapRules()).toBeNull();
  });

  it("is under the GOVERNANCE partition with the IDENTITY_MAP_RULES sort key", () => {
    expect(GOVERNANCE_PK).toBe("GOVERNANCE");
    expect(IDENTITY_MAP_RULES_SK).toBe("IDENTITY_MAP_RULES");
  });
});

describe("setIdentityMapRules", () => {
  it("creates the item at version 0: ordered rules, version 1, updatedAt = ctx.now, one identity.map.update record", async () => {
    const value = ok(
      await setIdentityMapRules({ rules: [SSO, SVC], version: 0 }, ctxAt()),
    );
    expect(value).toEqual({
      rules: [SSO, SVC],
      version: 1,
      updatedAt: NOW.toISOString(),
    });
    expect(await getIdentityMapRules()).toEqual(value);

    const records = await auditRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "identity.map.update",
      category: "change",
      result: "success",
      actor: ACTOR,
      target: { type: "governance", id: IDENTITY_MAP_RULES_SK },
    });
    expect(records[0]?.after).toMatchObject({ version: 1 });
    expect(records[0]?.after?.rules).toEqual([
      expect.stringContaining("{name}-sso"),
      expect.stringContaining("svc-{name}"),
    ]);
    expect(String(records[0]?.after?.rules)).toContain("{name}@company.com");
  });

  it("replaces the list at the current version, keeps the new order and bumps the version; the audit record shows before and after", async () => {
    ok(await setIdentityMapRules({ rules: [SSO, SVC], version: 0 }, ctxAt()));
    const later = new Date("2026-11-20T08:00:00.000Z");
    const value = ok(
      await setIdentityMapRules(
        { rules: [SVC], version: 1 },
        ctxAt(later, "req-2"),
      ),
    );
    expect(value).toEqual({
      rules: [SVC],
      version: 2,
      updatedAt: later.toISOString(),
    });
    expect(await getIdentityMapRules()).toEqual(value);

    const records = await auditRecords("2026-11-20");
    expect(records).toHaveLength(1);
    expect(records[0]?.before).toMatchObject({ version: 1 });
    expect(records[0]?.before?.rules).toHaveLength(2);
    expect(records[0]?.after).toMatchObject({ version: 2 });
    expect(records[0]?.after?.rules).toHaveLength(1);
  });

  it("an empty list is valid (deleting the last rule) and is still a versioned, audited write", async () => {
    ok(await setIdentityMapRules({ rules: [SSO], version: 0 }, ctxAt()));
    const value = ok(
      await setIdentityMapRules({ rules: [], version: 1 }, ctxAt(NOW, "req-2")),
    );
    expect(value).toMatchObject({ rules: [], version: 2 });
    expect(await getIdentityMapRules()).toMatchObject({
      rules: [],
      version: 2,
    });
    expect(await auditRecords()).toHaveLength(2);
  });

  it("a write is visible to the next read (authorization data is never cached)", async () => {
    ok(await setIdentityMapRules({ rules: [SSO], version: 0 }, ctxAt()));
    expect((await getIdentityMapRules())?.rules).toEqual([SSO]);
    ok(
      await setIdentityMapRules(
        { rules: [SVC], version: 1 },
        ctxAt(NOW, "req-2"),
      ),
    );
    expect((await getIdentityMapRules())?.rules).toEqual([SVC]);
  });

  it.each([
    ["a non-zero version when nothing is stored", 3, false],
    ["version 0 once rules are stored", 0, true],
    ["an older version", 1, true],
    ["a newer version", 9, true],
  ])(
    "returns CONFLICT for %s; state unchanged, no audit record",
    async (_name, version, seed) => {
      if (seed) {
        ok(await setIdentityMapRules({ rules: [SSO], version: 0 }, ctxAt()));
        ok(
          await setIdentityMapRules(
            { rules: [SSO, SVC], version: 1 },
            ctxAt(NOW, "req-1b"),
          ),
        );
      }
      const before = await getIdentityMapRules();
      const records0 = (await auditRecords()).length;
      expect(
        await setIdentityMapRules(
          { rules: [SVC], version },
          ctxAt(NOW, "req-9"),
        ),
      ).toEqual({ ok: false, code: "CONFLICT" });
      expect(await getIdentityMapRules()).toEqual(before);
      expect(await auditRecords()).toHaveLength(records0);
    },
  );

  it("two concurrent writers at the same version: exactly one wins (the condition is in the transaction)", async () => {
    const results = await Promise.all([
      setIdentityMapRules({ rules: [SSO], version: 0 }, ctxAt(NOW, "req-a")),
      setIdentityMapRules({ rules: [SVC], version: 0 }, ctxAt(NOW, "req-b")),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, code: "CONFLICT" },
    ]);
    expect(await auditRecords()).toHaveLength(1);
  });

  it("writes one failed record and rethrows on a downstream failure; nothing is stored", async () => {
    faults.transact = true;
    await expect(
      setIdentityMapRules({ rules: [SSO], version: 0 }, ctxAt()),
    ).rejects.toThrow();
    faults.transact = false;
    expect(await getIdentityMapRules()).toBeNull();
    const records = await auditRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "identity.map.update",
      result: "failed",
    });
  });

  it("rules never grant access or link anyone: the only item written is the rules item", async () => {
    ok(await setIdentityMapRules({ rules: [SSO, SVC], version: 0 }, ctxAt()));
    const items = await allItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      PK: "GOVERNANCE",
      SK: "IDENTITY_MAP_RULES",
    });
    expect(
      items.filter((i) =>
        /^(IDENT#|USAGEKEY#|PENDING#|MEMBERS#|ADMINS#)/.test(String(i.PK)),
      ),
    ).toEqual([]);
  });

  it("does not store the actor's credentials or anything beyond rules, version and updatedAt in the audit snapshots", async () => {
    ok(await setIdentityMapRules({ rules: [SSO], version: 0 }, ctxAt()));
    const [record] = await auditRecords();
    expect(Object.keys(record?.after ?? {}).sort()).toEqual([
      "rules",
      "version",
    ]);
  });
});
