import { createHmac, randomBytes } from "node:crypto";

import { argon2id } from "hash-wasm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const verifySpy = vi.hoisted(() => vi.fn());
vi.mock("hash-wasm", async (orig) => {
  const actual = await orig<typeof import("hash-wasm")>();
  verifySpy.mockImplementation(actual.argon2Verify);
  return { ...actual, argon2Verify: verifySpy };
});

import {
  MASTER_USER_PROVIDER_ID,
  authorizeMasterUser,
} from "@/lib/auth/master-user";
import type { MasterUserConfig } from "@/lib/auth/master-user";

// Source: docs/specs/2026-11-10-access-control.md — "Sign-in methods" (master
// user), "Threat model" T1, T20; contract r1 decision 6.
// Assumed deps shape: { now: () => Date;
//   lockout: { reserve(oid, now: Date): Promise<{allowed:boolean; lockedNow:boolean}>;
//              reset(oid): Promise<void> };
//   recordEvent(event): void }. The attempt is reserved BEFORE verification (T20).
const USERNAME = "Master-Admin";
const OID = "master:master-admin";
const PASSWORD = "correct horse battery staple";
const TOTP_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const T0 = new Date("2026-11-10T10:00:00.000Z");

function b32(s: string): Buffer {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of s) bits += A.indexOf(ch).toString(2).padStart(5, "0");
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function totp(at: Date): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at.getTime() / 30000)));
  const h = createHmac("sha1", b32(TOTP_SECRET)).update(counter).digest();
  const o = (h[19] ?? 0) & 0xf;
  const n =
    (((h[o] ?? 0) & 0x7f) << 24) |
    (((h[o + 1] ?? 0) & 0xff) << 16) |
    (((h[o + 2] ?? 0) & 0xff) << 8) |
    ((h[o + 3] ?? 0) & 0xff);
  return String(n % 1_000_000).padStart(6, "0");
}

let hash: string;
beforeAll(async () => {
  hash = await argon2id({
    password: PASSWORD,
    salt: randomBytes(16),
    iterations: 1,
    memorySize: 8,
    parallelism: 1,
    hashLength: 32,
    outputType: "encoded",
  });
});

type Lock = { failedAttempts: number; lockedUntil?: number };
function makeDeps() {
  const store = new Map<string, Lock>();
  let now = T0;
  const events: Record<string, unknown>[] = [];
  const lockout = {
    reserve: vi.fn(
      async (
        oid: string,
        at: Date,
      ): Promise<{ allowed: boolean; lockedNow: boolean }> => {
        let cur = store.get(oid) ?? { failedAttempts: 0 };
        if (cur.lockedUntil !== undefined && cur.lockedUntil <= at.getTime()) {
          cur = { failedAttempts: 0 };
        }
        if (cur.lockedUntil !== undefined || cur.failedAttempts >= 5) {
          store.set(oid, cur);
          return { allowed: false, lockedNow: false };
        }
        const failedAttempts = cur.failedAttempts + 1;
        const lockedNow = failedAttempts >= 5;
        store.set(oid, {
          failedAttempts,
          ...(lockedNow ? { lockedUntil: at.getTime() + 15 * 60000 } : {}),
        });
        return { allowed: true, lockedNow };
      },
    ),
    reset: vi.fn(async (oid: string) => {
      store.delete(oid);
    }),
  };
  return {
    deps: {
      now: () => now,
      lockout,
      recordEvent: (e: Record<string, unknown>) => events.push(e),
    },
    events,
    lockout,
    store,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

const config = (over: Partial<MasterUserConfig> = {}): MasterUserConfig => ({
  username: USERNAME,
  passwordHash: hash,
  totpSecret: TOTP_SECRET,
  ...over,
});
const good = (at: Date = T0) => ({
  username: USERNAME,
  password: PASSWORD,
  totp: totp(at),
});

let h: ReturnType<typeof makeDeps>;
beforeEach(() => {
  h = makeDeps();
  verifySpy.mockClear();
});

describe("authorizeMasterUser", () => {
  it("exposes the provider id", () => {
    expect(MASTER_USER_PROVIDER_ID).toBe("master-user");
  });

  it("returns the master identity on success and emits exactly one signin event", async () => {
    const id = await authorizeMasterUser(good(), config(), h.deps);
    expect(id).toMatchObject({
      oid: OID,
      tid: "master",
      roles: ["internal-admin"],
      authMethod: "master",
    });
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({
      action: "auth.master.signin",
      result: "success",
    });
  });

  it("works without TOTP when no secret is configured", async () => {
    const id = await authorizeMasterUser(
      { username: USERNAME, password: PASSWORD },
      config({ totpSecret: undefined }),
      h.deps,
    );
    expect(id?.oid).toBe(OID);
  });

  it.each([
    ["wrong username", { ...good(), username: "attacker" }],
    ["wrong password", { ...good(), password: "wrong-password" }],
    ["wrong TOTP", { ...good(), totp: "000000" }],
    [
      "missing TOTP when configured",
      { username: USERNAME, password: PASSWORD },
    ],
  ])("%s returns null and emits one failure event", async (_n, creds) => {
    await expect(
      authorizeMasterUser(creds, config(), h.deps),
    ).resolves.toBeNull();
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({
      action: "auth.master.failure",
      result: "failed",
    });
  });

  it("reserves the attempt before verifying, then resets on success", async () => {
    await authorizeMasterUser(good(), config(), h.deps);
    expect(h.lockout.reserve).toHaveBeenCalledWith(OID, T0);
    expect(h.lockout.reserve.mock.invocationCallOrder[0]).toBeLessThan(
      verifySpy.mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(h.lockout.reset).toHaveBeenCalledWith(OID);
    expect(h.lockout.reset.mock.invocationCallOrder[0]).toBeGreaterThan(
      h.lockout.reserve.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it("a denied reservation returns null without verifying the password and emits one lockout event", async () => {
    h.lockout.reserve.mockResolvedValueOnce({
      allowed: false,
      lockedNow: false,
    });
    await expect(
      authorizeMasterUser(good(), config(), h.deps),
    ).resolves.toBeNull();
    expect(verifySpy).not.toHaveBeenCalled();
    expect(h.lockout.reset).not.toHaveBeenCalled();
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({
      action: "auth.master.lockout",
      result: "failed",
    });
  });

  it("the attempt that triggers the lock emits lockout (not failure), exactly one event per attempt", async () => {
    for (let i = 0; i < 4; i++) {
      await authorizeMasterUser(
        { ...good(), password: "nope" },
        config(),
        h.deps,
      );
    }
    expect(h.events.map((e) => e.action)).toEqual(
      Array(4).fill("auth.master.failure"),
    );
    await authorizeMasterUser(
      { ...good(), password: "nope" },
      config(),
      h.deps,
    );
    expect(h.events).toHaveLength(5);
    expect(h.events[4]).toMatchObject({ action: "auth.master.lockout" });
  });

  it("after 5 failures the right password is refused without verification", async () => {
    for (let i = 0; i < 5; i++) {
      await authorizeMasterUser(
        { ...good(), password: "nope" },
        config(),
        h.deps,
      );
    }
    verifySpy.mockClear();
    h.events.length = 0;
    await expect(
      authorizeMasterUser(good(), config(), h.deps),
    ).resolves.toBeNull();
    expect(verifySpy).not.toHaveBeenCalled();
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({ action: "auth.master.lockout" });
  });

  it("stays locked just before 15 minutes and unlocks after", async () => {
    for (let i = 0; i < 5; i++) {
      await authorizeMasterUser(
        { ...good(), password: "nope" },
        config(),
        h.deps,
      );
    }
    h.advance(15 * 60000 - 1000);
    await expect(
      authorizeMasterUser(good(h.deps.now()), config(), h.deps),
    ).resolves.toBeNull();
    h.advance(2000);
    await expect(
      authorizeMasterUser(good(h.deps.now()), config(), h.deps),
    ).resolves.toMatchObject({ oid: OID });
  });

  it("resets the failure counter on success", async () => {
    for (let i = 0; i < 4; i++) {
      await authorizeMasterUser(
        { ...good(), password: "nope" },
        config(),
        h.deps,
      );
    }
    await authorizeMasterUser(good(), config(), h.deps);
    expect(h.lockout.reset).toHaveBeenCalledWith(OID);
    for (let i = 0; i < 4; i++) {
      await authorizeMasterUser(
        { ...good(), password: "nope" },
        config(),
        h.deps,
      );
    }
    await expect(
      authorizeMasterUser(good(), config(), h.deps),
    ).resolves.toMatchObject({
      oid: OID,
    });
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "admin"],
    ["an array", []],
    ["missing password", { username: USERNAME, totp: "123456" }],
    [
      "non-string username",
      { username: 1, password: PASSWORD, totp: "123456" },
    ],
    [
      "over-long username",
      { username: "a".repeat(10_000), password: PASSWORD, totp: "123456" },
    ],
    [
      "over-long password",
      { username: USERNAME, password: "p".repeat(100_000), totp: "123456" },
    ],
  ])("returns null for malformed credentials: %s", async (_n, creds) => {
    await expect(
      authorizeMasterUser(creds, config(), h.deps),
    ).resolves.toBeNull();
  });

  it("never puts the username, password, code or hash in an event", async () => {
    await authorizeMasterUser(
      { username: "attacker", password: "hunter2-secret", totp: "654321" },
      config(),
      h.deps,
    );
    await authorizeMasterUser(
      { ...good(), password: "hunter3-secret" },
      config(),
      h.deps,
    );
    await authorizeMasterUser(good(), config(), h.deps);
    const blob = JSON.stringify(h.events);
    for (const secret of [
      "attacker",
      "hunter2-secret",
      "hunter3-secret",
      PASSWORD,
      "654321",
      good().totp,
      hash,
      "$argon2id",
    ]) {
      expect(blob).not.toContain(secret);
    }
    expect(h.events).toHaveLength(3);
  });
});
