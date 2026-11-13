import { randomBytes } from "node:crypto";

import { argon2id } from "hash-wasm";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { authorizeMasterUser } from "@/lib/auth/master-user";
import type { MasterUserConfig } from "@/lib/auth/master-user";
import type { SecurityEvent } from "@/lib/auth/security-events";

// Source: docs/specs/2026-11-10-access-control.md — threat T20 (a master
// sign-in whose security record cannot be persisted must fail; failures and
// lockouts still return the generic null); contract R2 §1 decision 15,
// `MasterUserDeps.recordEvent` becomes `(event) => Promise<void>`.
const PASSWORD = "correct horse battery staple";
const T0 = new Date("2026-11-14T10:00:00.000Z");
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

const config = (): MasterUserConfig => ({
  username: "Master-Admin",
  passwordHash: hash,
});
const deps = (recordEvent: (e: SecurityEvent) => Promise<void>) => ({
  now: () => T0,
  lockout: {
    reserve: async () => ({ allowed: true, lockedNow: false }),
    reset: async () => {},
  },
  recordEvent,
});
const good = { username: "Master-Admin", password: PASSWORD };

describe("authorizeMasterUser event persistence (T20)", () => {
  it("awaits the sign-in record and returns the identity when it persists", async () => {
    const recordEvent = vi.fn().mockResolvedValue(undefined);
    const id = await authorizeMasterUser(good, config(), deps(recordEvent));
    expect(id).toMatchObject({
      oid: "master:master-admin",
      authMethod: "master",
    });
    expect(recordEvent).toHaveBeenCalledTimes(1);
    expect(recordEvent.mock.calls[0]?.[0]).toMatchObject({
      action: "auth.master.signin",
      result: "success",
    });
  });

  it("returns null (the sign-in fails) when the sign-in record cannot be persisted", async () => {
    const recordEvent = vi.fn().mockRejectedValue(new Error("put failed"));
    await expect(
      authorizeMasterUser(good, config(), deps(recordEvent)),
    ).resolves.toBeNull();
  });

  it("returns null for a wrong password even when the failure record cannot be persisted", async () => {
    const recordEvent = vi.fn().mockRejectedValue(new Error("put failed"));
    await expect(
      authorizeMasterUser(
        { ...good, password: "wrong wrong wrong wrong" },
        config(),
        deps(recordEvent),
      ),
    ).resolves.toBeNull();
    expect(recordEvent.mock.calls[0]?.[0]).toMatchObject({
      action: "auth.master.failure",
    });
  });
});
