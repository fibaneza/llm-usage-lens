import { describe, expect, it } from "vitest";

import { runBoundedSettled } from "./run-settled";

// Source: docs/specs/2026-11-10-litellm.md - LT25 ("on the first failed read
// no new LiteLLM read starts and the in-flight ones settle before the
// response, so no call outlives its request"), LD34 (bounded reads).

type Pending = {
  input: number;
  stopped: () => boolean;
  resolve: () => void;
  reject: (error: unknown) => void;
};

// Drains the microtask queue deterministically (no timers).
async function flush(): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    await Promise.resolve();
  }
}

function controlled() {
  const started: number[] = [];
  const pending = new Map<number, Pending>();
  let inFlight = 0;
  let maxInFlight = 0;
  const task = (input: number, stopped: () => boolean): Promise<void> => {
    started.push(input);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    return new Promise<void>((resolve, reject) => {
      pending.set(input, {
        input,
        stopped,
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
  const at = (input: number): Pending => {
    const entry = pending.get(input);
    if (!entry) throw new Error(`task ${input} has not started`);
    return entry;
  };
  return { task, started, at, maxInFlight: () => maxInFlight };
}

function watch(run: Promise<void>) {
  const state: { settled: boolean; error?: unknown; ok?: boolean } = {
    settled: false,
  };
  run.then(
    () => {
      state.settled = true;
      state.ok = true;
    },
    (error: unknown) => {
      state.settled = true;
      state.ok = false;
      state.error = error;
    },
  );
  return state;
}

describe("runBoundedSettled", () => {
  it("runs every input once and resolves when all succeed (LD34)", async () => {
    const ctl = controlled();
    const run = runBoundedSettled([0, 1, 2, 3], 2, ctl.task);
    const state = watch(run);
    await flush();
    expect(ctl.started).toEqual([0, 1]);
    ctl.at(1).resolve();
    await flush();
    ctl.at(0).resolve();
    await flush();
    ctl.at(3).resolve();
    ctl.at(2).resolve();
    await flush();
    expect(state).toMatchObject({ settled: true, ok: true });
    expect([...ctl.started].sort()).toEqual([0, 1, 2, 3]);
  });

  it("resolves for no inputs without starting a task", async () => {
    const ctl = controlled();
    await expect(runBoundedSettled([], 3, ctl.task)).resolves.toBeUndefined();
    expect(ctl.started).toEqual([]);
  });

  it("never has more than `limit` tasks in flight (LD34)", async () => {
    const ctl = controlled();
    const run = runBoundedSettled([0, 1, 2, 3, 4, 5], 2, ctl.task);
    await flush();
    for (let n = 0; n < 6; n += 1) {
      expect(ctl.started.length).toBeLessThanOrEqual(n + 2);
      ctl.at(n).resolve();
      await flush();
    }
    await run;
    expect(ctl.maxInFlight()).toBe(2);
    expect(ctl.started).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("stopped() is false until a task fails, then true for every task (LT25)", async () => {
    const ctl = controlled();
    const run = runBoundedSettled([0, 1], 2, ctl.task);
    const state = watch(run);
    await flush();
    expect(ctl.at(0).stopped()).toBe(false);
    expect(ctl.at(1).stopped()).toBe(false);
    ctl.at(0).reject(new Error("boom"));
    await flush();
    expect(ctl.at(0).stopped()).toBe(true);
    expect(ctl.at(1).stopped()).toBe(true);
    ctl.at(1).resolve();
    await flush();
    expect(state.settled).toBe(true);
  });

  it("starts no new input after the first failure, even with a free slot (LT25)", async () => {
    const ctl = controlled();
    const run = runBoundedSettled([0, 1, 2, 3, 4], 2, ctl.task);
    const state = watch(run);
    await flush();
    ctl.at(0).reject(new Error("boom"));
    await flush();
    ctl.at(1).resolve();
    await flush();
    expect(ctl.started).toEqual([0, 1]);
    expect(state.settled).toBe(true);
    expect(state.ok).toBe(false);
  });

  it("does not settle while a task is still in flight, then rejects (LT25: no call outlives its request)", async () => {
    const ctl = controlled();
    const failure = new Error("first");
    const run = runBoundedSettled([0, 1, 2], 3, ctl.task);
    const state = watch(run);
    await flush();
    ctl.at(0).reject(failure);
    await flush();
    expect(state.settled).toBe(false);
    ctl.at(1).resolve();
    await flush();
    expect(state.settled).toBe(false);
    ctl.at(2).resolve();
    await flush();
    expect(state).toMatchObject({ settled: true, ok: false });
    expect(state.error).toBe(failure);
  });

  it("rejects with the FIRST error when later in-flight tasks also fail (LT25)", async () => {
    const ctl = controlled();
    const first = new Error("first");
    const second = new Error("second");
    const run = runBoundedSettled([0, 1, 2], 3, ctl.task);
    const state = watch(run);
    await flush();
    ctl.at(1).reject(first);
    await flush();
    ctl.at(2).reject(second);
    await flush();
    expect(state.settled).toBe(false);
    ctl.at(0).reject(new Error("third"));
    await flush();
    expect(state.settled).toBe(true);
    expect(state.error).toBe(first);
  });

  it("rethrows a falsy first error rather than resolving", async () => {
    const ctl = controlled();
    const run = runBoundedSettled([0], 1, ctl.task);
    const state = watch(run);
    await flush();
    ctl.at(0).reject(undefined);
    await flush();
    expect(state).toMatchObject({ settled: true, ok: false });
  });
});
