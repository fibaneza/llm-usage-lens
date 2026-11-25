// @vitest-environment node
import { trace } from "@opentelemetry/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Sources: Design System - LiteLLM team page (unit LP1), T-LP4 (an unknown
// team id is the missing page; only a LiteLLM 404 means unknown); LiteLLM spec
// - LD19 (a read whose toggle is off makes no LiteLLM call), LD37 (LiteLLM not
// configured: no call), LT11 (open access mode: no LiteLLM call).
// Outcome in every "no call" case is true: the page renders and its panels
// show their own states. Outage is not "not found".
const getTeam = vi.fn();
vi.mock("./operations", () => ({
  getTeam: (input: unknown) => getTeam(input),
}));
const enabledOperations = vi.fn();
vi.mock("./read-views", () => ({
  enabledOperations: () => enabledOperations(),
}));
const configured = vi.fn();
vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  return { ...actual, isLiteLLMConfigured: () => configured() };
});
const envMock = vi.hoisted(() => ({ AUTH_ACCESS_MODE: "entra" }));
vi.mock("@/env", () => ({ env: envMock }));

import { LiteLLMError } from "./client";
import { proxyTeamExists } from "./proxy-team-exists";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  envMock.AUTH_ACCESS_MODE = "entra";
  enabledOperations.mockResolvedValue(["getTeam"]);
  configured.mockResolvedValue(true);
  getTeam.mockResolvedValue({});
});

describe("proxyTeamExists (T-LP4, LD19, LD37)", () => {
  it("a found team is true, read with the id", async () => {
    expect(await proxyTeamExists("ll-team-1")).toBe(true);
    expect(getTeam).toHaveBeenCalledWith({ litellmTeamId: "ll-team-1" });
  });

  it("a LiteLLM 404 is false (the one 'not found')", async () => {
    getTeam.mockRejectedValue(new LiteLLMError("upstream_error", 404));
    expect(await proxyTeamExists("ll-unknown")).toBe(false);
  });

  it.each([
    ["5xx", new LiteLLMError("upstream_error", 503)],
    ["unreachable", new LiteLLMError("unreachable")],
    ["timeout", new LiteLLMError("timeout")],
  ])("a LiteLLM outage (%s) is not 'not found': true", async (_n, error) => {
    getTeam.mockRejectedValue(error);
    expect(await proxyTeamExists("ll-team-1")).toBe(true);
  });

  // Rule 60.17 (no silent failures; an outage is a handled state that still
  // surfaces to OpenTelemetry) and Rule 50.6 (no raw upstream message kept).
  it.each([
    ["a LiteLLM 5xx", new LiteLLMError("upstream_error", 503)],
    [
      "an unexpected error carrying a raw message",
      new Error("RAW-UPSTREAM-SENTINEL"),
    ],
  ])(
    "%s records one span event with no raw error message (Rule 60.17, 50.6)",
    async (_n, error) => {
      const addEvent = vi.fn();
      vi.spyOn(trace, "getActiveSpan").mockReturnValue({
        addEvent,
      } as unknown as ReturnType<typeof trace.getActiveSpan>);
      getTeam.mockRejectedValue(error);
      expect(await proxyTeamExists("ll-team-1")).toBe(true);
      expect(addEvent).toHaveBeenCalledTimes(1);
      const [name, attributes] = addEvent.mock.calls[0] ?? [];
      expect(typeof name).toBe("string");
      expect(JSON.stringify([name, attributes ?? {}])).not.toContain(
        "RAW-UPSTREAM-SENTINEL",
      );
    },
  );

  it("a LiteLLM 404 is the missing page, not an outage: no span event", async () => {
    const addEvent = vi.fn();
    vi.spyOn(trace, "getActiveSpan").mockReturnValue({
      addEvent,
    } as unknown as ReturnType<typeof trace.getActiveSpan>);
    getTeam.mockRejectedValue(new LiteLLMError("upstream_error", 404));
    expect(await proxyTeamExists("ll-x")).toBe(false);
    expect(addEvent).not.toHaveBeenCalled();
  });

  it("LD19: getTeam toggled off makes no LiteLLM call and returns true", async () => {
    enabledOperations.mockResolvedValue([]);
    expect(await proxyTeamExists("ll-team-1")).toBe(true);
    expect(getTeam).not.toHaveBeenCalled();
  });

  it("LD37: LiteLLM not configured makes no LiteLLM call and returns true", async () => {
    configured.mockResolvedValue(false);
    expect(await proxyTeamExists("ll-team-1")).toBe(true);
    expect(getTeam).not.toHaveBeenCalled();
  });

  it("LT11: open access mode makes no LiteLLM call and returns true", async () => {
    envMock.AUTH_ACCESS_MODE = "open";
    expect(await proxyTeamExists("ll-team-1")).toBe(true);
    expect(getTeam).not.toHaveBeenCalled();
  });
});
