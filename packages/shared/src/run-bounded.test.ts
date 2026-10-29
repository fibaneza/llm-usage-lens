import { describe, expect, it } from "vitest";

import { runBounded } from "./run-bounded";

type Deferred = {
  input: number;
  resolve: () => void;
  reject: (error: unknown) => void;
};

// Drains the microtask queue deterministically (no timers).
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}

function controlledTask() {
  const started: number[] = [];
  const pending: Deferred[] = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const task = (input: number): Promise<void> => {
    started.push(input);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    return new Promise<void>((resolve, reject) => {
      pending.push({
        input,
        resolve: () => {
          inFlight -= 1;
          resolve();
        },
        reject: (error) => {
          inFlight -= 1;
          reject(error);
        },
      });
    });
  };

  return {
    task,
    started,
    pending,
    maxInFlight: () => maxInFlight,
  };
}

describe("runBounded", () => {
  it("runs every input and never exceeds the concurrency limit", async () => {
    const inputs = Array.from({ length: 10 }, (_, i) => i);
    const ctl = controlledTask();

    const run = runBounded(inputs, 3, ctl.task);
    await flush();
    expect(ctl.started).toEqual([0, 1, 2]);

    while (ctl.pending.length > 0) {
      ctl.pending.shift()?.resolve();
      await flush();
    }
    await run;

    expect([...ctl.started].sort((a, b) => a - b)).toEqual(inputs);
    expect(ctl.maxInFlight()).toBe(3);
  });

  it("resolves immediately for an empty input list", async () => {
    const ctl = controlledTask();
    await expect(runBounded([], 4, ctl.task)).resolves.toBeUndefined();
    expect(ctl.started).toEqual([]);
  });

  it("starts no new input after a task has rejected (fail-fast)", async () => {
    const inputs = Array.from({ length: 10 }, (_, i) => i);
    const ctl = controlledTask();
    const failure = new Error("boom");

    let settled = false;
    const run = runBounded(inputs, 2, ctl.task).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await flush();
    expect(ctl.started).toEqual([0, 1]);

    const second = ctl.pending.find((p) => p.input === 1);
    second?.reject(failure);
    await flush();
    expect(settled).toBe(true);

    // The surviving worker finishes its in-flight task after the rejection
    // was observed; it must not pull another input.
    ctl.pending.find((p) => p.input === 0)?.resolve();
    await flush();
    await run;

    expect(ctl.started).toEqual([0, 1]);
  });

  it("rejects with the original error", async () => {
    const ctl = controlledTask();
    const failure = new Error("original failure");

    const run = runBounded([0, 1, 2, 3], 2, ctl.task);
    const assertion = expect(run).rejects.toBe(failure);
    await flush();
    ctl.pending.find((p) => p.input === 0)?.reject(failure);
    await assertion;
  });

  it.each([0, -1])(
    "rejects with a RangeError when limit is %i",
    async (limit) => {
      const ctl = controlledTask();
      await expect(
        runBounded([1, 2, 3], limit, ctl.task),
      ).rejects.toBeInstanceOf(RangeError);
      expect(ctl.started).toEqual([]);
    },
  );
});
