import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  reserveMasterAttempt,
  resetMasterFailures,
  upsertIdentity,
} from "@/lib/data/identity";
import { getDocumentClient } from "@/lib/dynamodb";

import {
  TEST_TABLE_NAME,
  clearTable,
  ensureTestTable,
  testDoc,
} from "@/test/support/test-support";

// Source: docs/specs/2026-11-10-access-control.md — "Data model additions"
// (Identity row), "Sign-in methods" (lockout), "Threat model" T20; contract r1
// decisions 5-6. Rule 60.22 (DynamoDB Local, no mocks).
// Assumed signatures: getMasterLockout(oid), recordMasterFailure(oid, now),
// resetMasterFailures(oid); lockout shape { failedAttempts, lockedUntil? }.
const NOW = new Date("2026-11-10T10:00:00.000Z");
const OID = "00000000-0000-0000-0000-000000000001";
const MASTER = "master:master-admin";

async function item(oid: string) {
  const r = await testDoc().send(
    new GetCommand({
      TableName: TEST_TABLE_NAME,
      Key: { PK: `IDENT#${oid}`, SK: "META" },
    }),
  );
  return r.Item;
}

async function getMasterLockout(oid: string) {
  const i = await item(oid);
  return {
    failedAttempts: Number(i?.failedAttempts ?? 0),
    lockedUntil: i?.lockedUntil as string | undefined,
  };
}

beforeAll(ensureTestTable);
beforeEach(clearTable);

describe("upsertIdentity", () => {
  const entra = {
    oid: OID,
    tid: "00000000-0000-0000-0000-000000000002",
    email: "Ada@Example.COM",
    upn: "Ada@Example.COM",
    displayName: "Ada",
    roles: ["internal-viewer"],
    authMethod: "entra" as const,
  };

  it("writes IDENT#{oid}/META with GSI1 IDENTS and normalised attributes", async () => {
    await upsertIdentity(entra, NOW);
    expect(await item(OID)).toMatchObject({
      PK: `IDENT#${OID}`,
      SK: "META",
      gsi1pk: "IDENTS",
      gsi1sk: `IDENT#${OID}`,
      oid: OID,
      tid: entra.tid,
      email: "ada@example.com",
      upn: "ada@example.com",
      displayName: "Ada",
      lastSignInAt: NOW.toISOString(),
      lastSeenRoles: ["internal-viewer"],
      authMethod: "entra",
      version: 1,
    });
  });

  it("updates in place on the second sign-in and increments version", async () => {
    await upsertIdentity(entra, NOW);
    const later = new Date("2026-11-11T09:00:00.000Z");
    await upsertIdentity({ ...entra, roles: ["internal-admin"] }, later);
    expect(await item(OID)).toMatchObject({
      lastSignInAt: later.toISOString(),
      lastSeenRoles: ["internal-admin"],
      version: 2,
    });
  });

  // Design System - "The user page" 2026-11-24 rulings (Q-B2): createdAt is
  // written at the first sign-in (`if_not_exists`) and never changes.
  it("sets createdAt at the first sign-in and keeps that value on a later one", async () => {
    await upsertIdentity(entra, NOW);
    expect((await item(OID))?.createdAt).toBe(NOW.toISOString());
    const later = new Date("2026-11-20T09:00:00.000Z");
    await upsertIdentity({ ...entra, roles: ["internal-admin"] }, later);
    expect(await item(OID)).toMatchObject({
      createdAt: NOW.toISOString(),
      lastSignInAt: later.toISOString(),
    });
  });

  it("stores a master identity without email", async () => {
    await upsertIdentity(
      {
        oid: MASTER,
        tid: "master",
        roles: ["internal-admin"],
        authMethod: "master",
      },
      NOW,
    );
    const it_ = await item(MASTER);
    expect(it_).toMatchObject({ authMethod: "master", tid: "master" });
    expect(it_).not.toHaveProperty("email");
  });

  it("does not clobber the master lockout counters on sign-in", async () => {
    await reserveMasterAttempt(MASTER, NOW);
    await upsertIdentity(
      {
        oid: MASTER,
        tid: "master",
        roles: ["internal-admin"],
        authMethod: "master",
      },
      NOW,
    );
    expect((await getMasterLockout(MASTER)).failedAttempts).toBe(1);
  });
});

describe("master lockout store (atomic reservation)", () => {
  const FIFTEEN = 15 * 60000;

  it("reports zero failures and no lock when no item exists", async () => {
    const l = await getMasterLockout(MASTER);
    expect(l.failedAttempts).toBe(0);
    expect(l.lockedUntil).toBeUndefined();
  });

  it("allows the first reservation and counts it", async () => {
    await expect(reserveMasterAttempt(MASTER, NOW)).resolves.toEqual({
      allowed: true,
      lockedNow: false,
    });
    expect((await getMasterLockout(MASTER)).failedAttempts).toBe(1);
  });

  it("10 parallel reservations from zero allow exactly 5 and lock exactly once", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => reserveMasterAttempt(MASTER, NOW)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(results.filter((r) => r.lockedNow)).toHaveLength(1);
    expect(results.filter((r) => r.lockedNow && !r.allowed)).toHaveLength(0);
    const l = await getMasterLockout(MASTER);
    expect(l.failedAttempts).toBe(5);
    expect(l.lockedUntil).toBe(new Date(NOW.getTime() + FIFTEEN).toISOString());
  });

  it("sets lockedUntil on the 5th reservation, which reports lockedNow", async () => {
    for (let i = 0; i < 4; i++) {
      await expect(reserveMasterAttempt(MASTER, NOW)).resolves.toEqual({
        allowed: true,
        lockedNow: false,
      });
    }
    expect((await getMasterLockout(MASTER)).lockedUntil).toBeUndefined();
    await expect(reserveMasterAttempt(MASTER, NOW)).resolves.toEqual({
      allowed: true,
      lockedNow: true,
    });
  });

  it("denies the 6th reservation while locked and does not extend the lock", async () => {
    for (let i = 0; i < 5; i++) await reserveMasterAttempt(MASTER, NOW);
    const later = new Date(NOW.getTime() + 60000);
    const r = await reserveMasterAttempt(MASTER, later);
    expect(r.allowed).toBe(false);
    const l = await getMasterLockout(MASTER);
    expect(l.failedAttempts).toBe(5);
    expect(l.lockedUntil).toBe(new Date(NOW.getTime() + FIFTEEN).toISOString());
  });

  it("clears an expired lock: the next reservation is allowed with failedAttempts 1", async () => {
    for (let i = 0; i < 5; i++) await reserveMasterAttempt(MASTER, NOW);
    const after = new Date(NOW.getTime() + FIFTEEN + 1000);
    await expect(reserveMasterAttempt(MASTER, after)).resolves.toMatchObject({
      allowed: true,
    });
    const l = await getMasterLockout(MASTER);
    expect(l.failedAttempts).toBe(1);
    expect(l.lockedUntil).toBeUndefined();
  });

  it("reset clears the counter and the lock", async () => {
    for (let i = 0; i < 5; i++) await reserveMasterAttempt(MASTER, NOW);
    await resetMasterFailures(MASTER);
    const l = await getMasterLockout(MASTER);
    expect(l.failedAttempts).toBe(0);
    expect(l.lockedUntil).toBeUndefined();
    await expect(reserveMasterAttempt(MASTER, NOW)).resolves.toMatchObject({
      allowed: true,
    });
  });

  // Access Control — Master user, Lockout (5 failures lock for 15 minutes,
  // every lockout is audited and alarms); Threat model T20. The interleaving
  // is forced by pausing the 5th reservation between its ADD and its lock
  // SET; real DynamoDB Local, the spy only controls order.
  describe("the 5th reservation's lock write loses to the 6th's repair (T20)", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    // Pauses the first "SET lockedUntil = :until" (the 5th's lock write) until
    // released; every call still goes to real DynamoDB Local.
    function holdFirstLockWrite() {
      const client = getDocumentClient();
      const realSend = client.send.bind(client) as (
        c: unknown,
      ) => Promise<unknown>;
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let paused: () => void = () => undefined;
      const reachedLockWrite = new Promise<void>((resolve) => {
        paused = resolve;
      });
      let held = false;
      vi.spyOn(client, "send").mockImplementation((async (command: unknown) => {
        const expr = (command as { input?: { UpdateExpression?: string } })
          .input?.UpdateExpression;
        if (!held && expr === "SET lockedUntil = :until") {
          held = true;
          paused();
          await gate;
        }
        return realSend(command);
      }) as unknown as typeof client.send);
      return { reachedLockWrite, release };
    }

    it("reports lockedNow exactly once, on the allowed 5th, and sets one 15-minute lock", async () => {
      for (let i = 0; i < 4; i++) await reserveMasterAttempt(MASTER, NOW);

      const { reachedLockWrite, release } = holdFirstLockWrite();

      const fifth = reserveMasterAttempt(MASTER, NOW);
      await reachedLockWrite;
      const sixth = await reserveMasterAttempt(MASTER, NOW);
      release();
      const fifthResult = await fifth;

      expect(sixth).toEqual({ allowed: false, lockedNow: false });
      expect(fifthResult).toEqual({ allowed: true, lockedNow: true });
      const l = await getMasterLockout(MASTER);
      expect(l.failedAttempts).toBe(5);
      expect(l.lockedUntil).toBe(
        new Date(NOW.getTime() + FIFTEEN).toISOString(),
      );

      vi.restoreAllMocks();
      await expect(
        reserveMasterAttempt(MASTER, new Date(NOW.getTime() + 60000)),
      ).resolves.toEqual({ allowed: false, lockedNow: false });
      expect((await getMasterLockout(MASTER)).lockedUntil).toBe(l.lockedUntil);
    });

    // Access Control — Master user, Lockout ("success resets it"); T20. A
    // sign-in reset between the 5th's ADD and its lock write leaves no lock,
    // so no lockout may be reported.
    it("a reset between the 5th's ADD and its lock write reports no lockout and leaves no lock", async () => {
      for (let i = 0; i < 4; i++) await reserveMasterAttempt(MASTER, NOW);

      const { reachedLockWrite, release } = holdFirstLockWrite();
      const fifth = reserveMasterAttempt(MASTER, NOW);
      await reachedLockWrite;
      await resetMasterFailures(MASTER);
      release();

      await expect(fifth).resolves.toEqual({ allowed: true, lockedNow: false });
      const l = await getMasterLockout(MASTER);
      expect(l.lockedUntil).toBeUndefined();
      expect(l.failedAttempts).toBe(0);
      vi.restoreAllMocks();
      await expect(reserveMasterAttempt(MASTER, NOW)).resolves.toEqual({
        allowed: true,
        lockedNow: false,
      });
    });
  });

  // Threat model T20: a crash between the counter write and the lock write
  // leaves failedAttempts = 5 with no lockedUntil; it must self-repair.
  describe("stuck state: failedAttempts 5 without lockedUntil", () => {
    async function seedStuck() {
      await testDoc().send(
        new PutCommand({
          TableName: TEST_TABLE_NAME,
          Item: { PK: `IDENT#${MASTER}`, SK: "META", failedAttempts: 5 },
        }),
      );
    }
    const lockIso = new Date(NOW.getTime() + FIFTEEN).toISOString();

    it("denies and repairs into a normal 15-minute lock", async () => {
      await seedStuck();
      await expect(reserveMasterAttempt(MASTER, NOW)).resolves.toEqual({
        allowed: false,
        lockedNow: false,
      });
      const l = await getMasterLockout(MASTER);
      expect(l.lockedUntil).toBe(lockIso);
      expect(l.failedAttempts).toBe(5);
    });

    it("stays denied until the repaired lock expires, then allows with failedAttempts 1", async () => {
      await seedStuck();
      await reserveMasterAttempt(MASTER, NOW);
      const justBefore = new Date(NOW.getTime() + FIFTEEN - 1);
      const denied = await reserveMasterAttempt(MASTER, justBefore);
      expect(denied.allowed).toBe(false);
      expect((await getMasterLockout(MASTER)).lockedUntil).toBe(lockIso);

      const justAfter = new Date(NOW.getTime() + FIFTEEN + 1);
      await expect(reserveMasterAttempt(MASTER, justAfter)).resolves.toEqual({
        allowed: true,
        lockedNow: false,
      });
      const l = await getMasterLockout(MASTER);
      expect(l.failedAttempts).toBe(1);
      expect(l.lockedUntil).toBeUndefined();
    });

    it("5 parallel reservations are all denied and set one lock without throwing", async () => {
      await seedStuck();
      const results = await Promise.all(
        Array.from({ length: 5 }, () => reserveMasterAttempt(MASTER, NOW)),
      );
      expect(results.every((r) => !r.allowed)).toBe(true);
      const l = await getMasterLockout(MASTER);
      expect(l.lockedUntil).toBe(lockIso);
      expect(l.failedAttempts).toBe(5);
    });
  });
});
