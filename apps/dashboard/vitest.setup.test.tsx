import { act, render } from "@testing-library/react";
import { Bar, BarChart } from "recharts";

import { teardownChartTest } from "@/test/chart-test-utils";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Regression: Recharts' store batches notifications with the Redux Toolkit
// raf enhancer, which arms a 100 ms fallback setTimeout whose callback calls
// the global cancelAnimationFrame. A real timer that outlives the test file
// fires after jsdom globals are torn down and surfaces as an Unhandled Error.
// Rule 60.24 -- no wall-clock waits.
//
// The "following test" cases deliberately couple to test order: the shared
// teardown runs after the previous test body, so only the next test can see
// what it left pending. Only 100 ms real timers are tracked, which is the
// toolkit's fallback delay; the wrapper cannot see callback identity.

const armed = new Set<unknown>();
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

beforeAll(() => {
  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    const id = realSetTimeout(...args);
    if (args[1] === 100) armed.add(id);
    return id;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id?: Parameters<typeof clearTimeout>[0]) => {
    armed.delete(id);
    return realClearTimeout(id);
  }) as typeof clearTimeout;
});

afterAll(() => {
  armed.forEach((id) => realClearTimeout(id as never));
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
});

function renderBar() {
  return render(
    <BarChart width={200} height={100} data={[{ name: "a", v: 1 }]}>
      <Bar dataKey="v" />
    </BarChart>,
  );
}

describe("vitest.setup teardown (real timers)", () => {
  it("queues a Recharts store notification and leaves unmounting to the shared cleanup", () => {
    renderBar();

    expect(armed.size).toBeGreaterThan(0);
  });

  it("leaves no toolkit fallback timer pending after the previous test's teardown", () => {
    expect(armed.size).toBe(0);
  });
});

describe("vitest.setup teardown (fake timers, chart-test pattern)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    teardownChartTest();
  });

  it("renders a chart under fake timers", async () => {
    renderBar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(armed.size).toBe(0);
  });

  it("leaves no real fallback timer pending after the previous fake-timer test", () => {
    vi.useRealTimers();

    expect(armed.size).toBe(0);
  });
});
