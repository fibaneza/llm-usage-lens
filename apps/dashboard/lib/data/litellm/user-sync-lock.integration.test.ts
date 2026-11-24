import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { clearTable, ensureTestTable } from "@/test/support/test-support";

import { getItem } from "../access/store";

import {
  USER_SYNC_LEASE_MS,
  acquireUserSyncLease,
  releaseUserSyncLease,
  renewUserSyncLease,
} from "./user-sync-lock";

// Source: docs/specs/2026-11-10-litellm.md - "Data model additions"
// (UserSyncLock at LITELLM#USERSYNC / LOCK: `owner` the run id, `leaseUntil`
// an ISO time, `expiresAt` for clean-up only; taken when absent or when
// `leaseUntil` has passed, renewed before each batch with a condition on the
// owner, released by its owner with a conditional delete; 5 minutes; review
// change V3); Access Control - "LiteLLM user sync", Preview and apply; T-SY5
// (lease held -> SYNC_RUNNING, two applies at once -> one wins, a run that
// lost its lease stops). Against DynamoDB Local (Rule 60.22); time is passed
// in, never slept (Rule 60.24). Contract: lib/data/litellm/user-sync-lock.ts
// exports USER_SYNC_LEASE_MS, acquireUserSyncLease(runId, now) ->
// { owner, leaseUntil } | null (null: held), renewUserSyncLease(runId, now) ->
// boolean (false: the lease is lost), releaseUserSyncLease(runId) -> void.
const T0 = new Date("2026-11-24T10:00:00.000Z");
const after = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;

const lockItem = () => getItem("LITELLM#USERSYNC", "LOCK");

beforeAll(ensureTestTable);
beforeEach(clearTable);

describe("acquireUserSyncLease", () => {
  it("takes a free lease for 5 minutes and stores owner, leaseUntil and expiresAt", async () => {
    expect(USER_SYNC_LEASE_MS).toBe(5 * MIN);
    const lease = await acquireUserSyncLease("run-a", T0);
    expect(lease).toEqual({
      owner: "run-a",
      leaseUntil: after(5 * MIN).toISOString(),
    });
    const raw = await lockItem();
    expect(raw).toMatchObject({
      owner: "run-a",
      leaseUntil: after(5 * MIN).toISOString(),
    });
    expect(typeof raw?.expiresAt).toBe("number");
    expect(raw?.expiresAt as number).toBeGreaterThanOrEqual(
      Math.floor(after(5 * MIN).getTime() / 1000),
    );
  });

  it("refuses while another run holds an unexpired lease (SYNC_RUNNING)", async () => {
    await acquireUserSyncLease("run-a", T0);
    expect(await acquireUserSyncLease("run-b", after(4 * MIN))).toBeNull();
    expect((await lockItem())?.owner).toBe("run-a");
  });

  it("takes over once leaseUntil has passed, by the condition and not by TTL removal", async () => {
    await acquireUserSyncLease("run-a", T0);
    const lease = await acquireUserSyncLease("run-b", after(5 * MIN + 1));
    expect(lease?.owner).toBe("run-b");
    expect((await lockItem())?.owner).toBe("run-b");
  });

  it("lets exactly one of two applies at once win (T-SY5)", async () => {
    const results = await Promise.all([
      acquireUserSyncLease("run-a", T0),
      acquireUserSyncLease("run-b", T0),
    ]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    const winner = results.find((r) => r !== null)?.owner;
    expect((await lockItem())?.owner).toBe(winner);
  });
});

describe("renewUserSyncLease", () => {
  it("extends the lease of its own run by another 5 minutes", async () => {
    await acquireUserSyncLease("run-a", T0);
    expect(await renewUserSyncLease("run-a", after(3 * MIN))).toBe(true);
    expect((await lockItem())?.leaseUntil).toBe(after(8 * MIN).toISOString());
    // The renewed lease still blocks another run past the first deadline.
    expect(await acquireUserSyncLease("run-b", after(6 * MIN))).toBeNull();
  });

  it("returns false for a run that lost the lease to another run", async () => {
    await acquireUserSyncLease("run-a", T0);
    await acquireUserSyncLease("run-b", after(5 * MIN + 1));
    expect(await renewUserSyncLease("run-a", after(5 * MIN + 2))).toBe(false);
    expect((await lockItem())?.owner).toBe("run-b");
  });

  it("returns false when the lease item is gone", async () => {
    expect(await renewUserSyncLease("run-a", T0)).toBe(false);
    expect(await lockItem()).toBeNull();
  });
});

describe("releaseUserSyncLease", () => {
  it("deletes the lease of its own run, so the next run can take it at once", async () => {
    await acquireUserSyncLease("run-a", T0);
    await releaseUserSyncLease("run-a");
    expect(await lockItem()).toBeNull();
    expect((await acquireUserSyncLease("run-b", after(MIN)))?.owner).toBe(
      "run-b",
    );
  });

  it("never deletes a lease another run holds", async () => {
    await acquireUserSyncLease("run-a", T0);
    await acquireUserSyncLease("run-b", after(5 * MIN + 1));
    await releaseUserSyncLease("run-a");
    expect((await lockItem())?.owner).toBe("run-b");
  });

  it("is a no-op when there is no lease", async () => {
    await expect(releaseUserSyncLease("run-a")).resolves.toBeUndefined();
  });
});
