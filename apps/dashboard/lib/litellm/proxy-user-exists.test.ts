// @vitest-environment node
import { trace } from "@opentelemetry/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Sources: Design System - LiteLLM user page (unit LP2), T-LP8 (an unknown
// user id is the missing page; only a LiteLLM 404 means unknown); LiteLLM spec
// - LD19 (a read whose toggle is off makes no LiteLLM call), LD37 (LiteLLM not
// configured: no call), LT11 (open access mode: no LiteLLM call).
// Outcome in every "no call" case is true: the page renders and its panels
// show their own states. Outage is not "not found".
const getUser = vi.fn();
vi.mock("./operations", () => ({
  getUser: (input: unknown) => getUser(input),
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
import { proxyUserExists } from "./proxy-user-exists";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  envMock.AUTH_ACCESS_MODE = "entra";
  enabledOperations.mockResolvedValue(["getUser"]);
  configured.mockResolvedValue(true);
  getUser.mockResolvedValue({});
});

describe("proxyUserExists (T-LP4, LD19, LD37)", () => {
  it("a found user is true, read with the id", async () => {
    expect((await proxyUserExists("ll-ada")).exists).toBe(true);
    expect(getUser).toHaveBeenCalledWith({ litellmUserId: "ll-ada" });
  });

  it("a LiteLLM 404 is false (the one 'not found')", async () => {
    getUser.mockRejectedValue(new LiteLLMError("upstream_error", 404));
    expect(await proxyUserExists("ll-unknown")).toEqual({
      exists: false,
      name: null,
    });
  });

  it.each([
    ["5xx", new LiteLLMError("upstream_error", 503)],
    ["unreachable", new LiteLLMError("unreachable")],
    ["timeout", new LiteLLMError("timeout")],
  ])("a LiteLLM outage (%s) is not 'not found': true", async (_n, error) => {
    getUser.mockRejectedValue(error);
    expect((await proxyUserExists("ll-ada")).exists).toBe(true);
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
      getUser.mockRejectedValue(error);
      expect((await proxyUserExists("ll-ada")).exists).toBe(true);
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
    getUser.mockRejectedValue(new LiteLLMError("upstream_error", 404));
    expect(await proxyUserExists("ll-x")).toEqual({
      exists: false,
      name: null,
    });
    expect(addEvent).not.toHaveBeenCalled();
  });

  it("LD19: getUser toggled off makes no LiteLLM call and returns true", async () => {
    enabledOperations.mockResolvedValue([]);
    expect((await proxyUserExists("ll-ada")).exists).toBe(true);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("LD37: LiteLLM not configured makes no LiteLLM call and returns true", async () => {
    configured.mockResolvedValue(false);
    expect((await proxyUserExists("ll-ada")).exists).toBe(true);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("LT11: open access mode makes no LiteLLM call and returns true", async () => {
    envMock.AUTH_ACCESS_MODE = "open";
    expect((await proxyUserExists("ll-ada")).exists).toBe(true);
    expect(getUser).not.toHaveBeenCalled();
  });
});

// Source: Design System - LiteLLM user page, "Name and spend over time (unit
// LP3)", T-LP13: the breadcrumb name is the trimmed alias, else the trimmed
// email, else null (the page then shows the id); null wherever no call is made
// or the call fails; still one getUser call; a name is text, never markup.
describe("proxyUserExists name (T-LP13)", () => {
  const info = (user_info: Record<string, unknown> | null | undefined) =>
    getUser.mockResolvedValue({ user_id: "ll-ada", user_info });

  it.each([
    [
      "the alias",
      { user_alias: "  Ada L.  ", user_email: "ada@x.test" },
      "Ada L.",
    ],
    [
      "the email when the alias is absent",
      { user_email: " ada@x.test " },
      "ada@x.test",
    ],
    [
      "the email when the alias is null",
      { user_alias: null, user_email: "ada@x.test" },
      "ada@x.test",
    ],
    [
      "the email when the alias is blank",
      { user_alias: "   ", user_email: "ada@x.test" },
      "ada@x.test",
    ],
  ])("the name is %s, trimmed", async (_n, user_info, name) => {
    info(user_info);
    expect(await proxyUserExists("ll-ada")).toEqual({ exists: true, name });
  });

  it.each([
    ["neither alias nor email", { user_id: "ll-ada" }],
    ["both blank", { user_alias: " ", user_email: "" }],
    ["no user_info object", null],
  ])(
    "the name is null with %s (the page shows the id)",
    async (_n, user_info) => {
      info(user_info);
      expect(await proxyUserExists("ll-ada")).toEqual({
        exists: true,
        name: null,
      });
    },
  );

  it("the name is returned as text, not interpreted: markup stays a string (no HTML)", async () => {
    info({ user_alias: "<img src=x onerror=alert(1)>" });
    expect((await proxyUserExists("ll-ada")).name).toBe(
      "<img src=x onerror=alert(1)>",
    );
  });

  it("exactly one getUser call per check", async () => {
    info({ user_alias: "Ada" });
    await proxyUserExists("ll-ada");
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a 5xx", new LiteLLMError("upstream_error", 503)],
    ["an unreachable gateway", new LiteLLMError("unreachable")],
    ["an unexpected error", new Error("boom")],
  ])("%s answers exists true with a null name", async (_n, error) => {
    getUser.mockRejectedValue(error);
    expect(await proxyUserExists("ll-ada")).toEqual({
      exists: true,
      name: null,
    });
  });

  it("LD19, LD37, LT11: every path that makes no call answers exists true, name null", async () => {
    info({ user_alias: "Ada" });
    enabledOperations.mockResolvedValue([]);
    expect(await proxyUserExists("ll-ada")).toEqual({
      exists: true,
      name: null,
    });
    enabledOperations.mockResolvedValue(["getUser"]);
    configured.mockResolvedValue(false);
    expect(await proxyUserExists("ll-ada")).toEqual({
      exists: true,
      name: null,
    });
    configured.mockResolvedValue(true);
    envMock.AUTH_ACCESS_MODE = "open";
    expect(await proxyUserExists("ll-ada")).toEqual({
      exists: true,
      name: null,
    });
    expect(getUser).not.toHaveBeenCalled();
  });

  it("a LiteLLM 404 still answers exists false with a null name and no span event", async () => {
    const addEvent = vi.fn();
    vi.spyOn(trace, "getActiveSpan").mockReturnValue({
      addEvent,
    } as unknown as ReturnType<typeof trace.getActiveSpan>);
    getUser.mockRejectedValue(new LiteLLMError("upstream_error", 404));
    expect(await proxyUserExists("ll-x")).toEqual({
      exists: false,
      name: null,
    });
    expect(addEvent).not.toHaveBeenCalled();
  });
});
