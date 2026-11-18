import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

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
});
