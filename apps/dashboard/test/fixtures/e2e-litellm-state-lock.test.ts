import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { withLiteLLMStateLock } from "./e2e-litellm-state-lock";

// Source: RS1 review U-W1 - the specs that change the one stored LiteLLM
// connection must not overlap across Playwright workers.
const lockDir = () => join(mkdtempSync(join(tmpdir(), "e2e-lock-")), "lock");

describe("withLiteLLMStateLock", () => {
  it("runs holders one at a time and releases after a failure", async () => {
    const dir = lockDir();
    const events: string[] = [];
    const hold = (name: string, fail = false) =>
      withLiteLLMStateLock(
        async () => {
          events.push(`${name}:start`);
          await new Promise((resolve) => setTimeout(resolve, 20));
          events.push(`${name}:end`);
          if (fail) throw new Error("boom");
        },
        { dir, pollMs: 5 },
      );

    const results = await Promise.allSettled([hold("a", true), hold("b")]);

    expect(results.map((r) => r.status)).toEqual(["rejected", "fulfilled"]);
    expect(events).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("takes over a lock whose owner process is gone", async () => {
    const dir = lockDir();
    mkdirSync(dir);
    writeFileSync(
      join(dir, "owner.json"),
      JSON.stringify({ pid: 2 ** 22 + 7 }),
    );

    await expect(
      withLiteLLMStateLock(async () => "ran", { dir, timeoutMs: 500 }),
    ).resolves.toBe("ran");
  });

  it("gives up with an error when a live holder never releases", async () => {
    const dir = lockDir();
    mkdirSync(dir);
    writeFileSync(
      join(dir, "owner.json"),
      JSON.stringify({ pid: process.pid }),
    );

    await expect(
      withLiteLLMStateLock(async () => "ran", {
        dir,
        timeoutMs: 40,
        pollMs: 5,
      }),
    ).rejects.toThrow(/state lock/);
  });

  // Rule 60.24: fake timers, no wall-clock sleep. The e2e run that failed held
  // the lock past the 5 minute stale age and a second worker took it over.
  describe("heartbeat", () => {
    afterEach(() => vi.useRealTimers());

    it("does not let a waiter take a lock held by a live owner for longer than the stale age", async () => {
      vi.useFakeTimers();
      const dir = lockDir();
      let releaseA!: () => void;
      const events: string[] = [];
      const a = withLiteLLMStateLock(
        () =>
          new Promise<void>((resolve) => {
            events.push("a:start");
            releaseA = resolve;
          }),
        { dir },
      );
      await vi.advanceTimersByTimeAsync(0);
      const b = withLiteLLMStateLock(
        async () => {
          events.push("b:start");
        },
        { dir, timeoutMs: 20 * 60_000, pollMs: 1_000 },
      );

      await vi.advanceTimersByTimeAsync(7 * 60_000);
      expect(events).toEqual(["a:start"]);

      releaseA();
      await vi.advanceTimersByTimeAsync(2_000);
      await Promise.all([a, b]);
      expect(events).toEqual(["a:start", "b:start"]);
    });
  });
});
