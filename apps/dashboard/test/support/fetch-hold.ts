import { vi } from "vitest";

// Test-only gate over the stubbed global fetch (Rule 60.24: no wall-clock
// waits). Holds the first call that matches until `release()`, so a test
// decides the order in which in-flight LiteLLM reads finish. Call it after
// the fake is installed: it wraps whatever `fetch` is at that moment, and
// vi.unstubAllGlobals() in the suite's afterEach removes it.
export type FetchHold = {
  // Resolves when the matching call has reached the gate (not yet sent on).
  arrived: Promise<void>;
  // Resolves once the held call has been answered (or has failed) after release.
  settled: Promise<void>;
  release: () => void;
};

// Promise.withResolvers is ES2024; the project lib is ES2022 (tsconfig), so
// the resolver is captured without a non-null assertion (Rule 60.2).
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

export function holdFetch(match: (url: URL) => boolean): FetchHold {
  const inner = globalThis.fetch;
  const arrival = deferred();
  const gate = deferred();
  const done = deferred();
  let taken = false;
  vi.stubGlobal("fetch", (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
      // fetchApi sends relative /api/... paths; a base makes them parseable.
      "http://localhost",
    );
    if (taken || !match(url)) return inner(input, init);
    taken = true;
    arrival.resolve();
    await gate.promise;
    try {
      return await inner(input, init);
    } finally {
      done.resolve();
    }
  }) as typeof fetch);
  return {
    arrived: arrival.promise,
    settled: done.promise,
    release: gate.resolve,
  };
}

// One macrotask: every pending microtask (and process.nextTick) has run.
export const macrotask = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

export function trackSettled(promise: Promise<unknown>): () => boolean {
  let done = false;
  void promise.then(
    () => (done = true),
    () => (done = true),
  );
  return () => done;
}
