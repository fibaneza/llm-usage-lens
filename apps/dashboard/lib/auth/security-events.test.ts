import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Source: docs/specs/2026-11-10-access-control.md — "Threat model" T20;
// contract r1 decision 6 (id-only OpenTelemetry event; Rule 50.6).
const m = vi.hoisted(() => ({
  addEvent: vi.fn(),
  startSpan: vi.fn(),
  spanEnd: vi.fn(),
  activeSpan: undefined as { addEvent: () => void } | undefined,
}));
const { addEvent, startSpan, spanEnd } = m;
vi.mock("@opentelemetry/api", async (orig) => {
  const actual = await orig<typeof import("@opentelemetry/api")>();
  return {
    ...actual,
    trace: {
      ...actual.trace,
      getActiveSpan: () => m.activeSpan,
      getTracer: () => ({ startSpan }),
    },
  };
});

import { recordSecurityEvent } from "@/lib/auth/security-events";

beforeEach(() => {
  m.activeSpan = { addEvent };
  startSpan.mockReset().mockReturnValue({ addEvent, end: spanEnd });
  spanEnd.mockReset();
});
afterEach(() => addEvent.mockReset());

describe("recordSecurityEvent default sink", () => {
  it("emits one event whose attributes are only action, result, oid and at", () => {
    recordSecurityEvent({
      action: "auth.master.failure",
      result: "failed",
      oid: "master:master-admin",
      at: "2026-11-10T10:00:00.000Z",
    });
    expect(addEvent).toHaveBeenCalledTimes(1);
    const [name, attrs] = addEvent.mock.calls[0] ?? [];
    expect(String(name)).toContain("auth.master.failure");
    expect(Object.keys(attrs ?? {}).sort()).toEqual(
      ["action", "at", "oid", "result"].sort(),
    );
    expect(attrs).toMatchObject({
      action: "auth.master.failure",
      result: "failed",
      oid: "master:master-admin",
    });
  });

  it("still emits an id-only event through its own span when no span is active", () => {
    m.activeSpan = undefined;
    recordSecurityEvent({
      action: "auth.master.signin",
      result: "success",
      oid: "master:x",
      at: "2026-11-10T10:00:00.000Z",
    });
    expect(startSpan).toHaveBeenCalledTimes(1);
    expect(addEvent).toHaveBeenCalledTimes(1);
    const [, attrs] = addEvent.mock.calls[0] ?? [];
    expect(Object.keys(attrs ?? {}).sort()).toEqual(
      ["action", "at", "oid", "result"].sort(),
    );
    expect(spanEnd).toHaveBeenCalled();
  });

  it("accepts the auth.signin.error action without an oid", () => {
    recordSecurityEvent({
      action: "auth.signin.error",
      result: "failed",
      at: "2026-11-10T10:00:00.000Z",
    });
    const [, attrs] = addEvent.mock.calls[0] ?? [];
    expect(attrs).not.toHaveProperty("oid");
  });
});
