import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QueryProvider } from "@/components/providers/QueryProvider";
import { useAccounts } from "@/hooks/useAccounts";
import { useSyncStatus } from "@/hooks/useSyncStatus";

// Source: Phase 3.3 contract — QueryProvider + client hooks; Rule 10.1 (hooks
// fetch same-origin Route Handlers); Rule 20.9 (never-synced is data);
// Rule 60.24 (stubbed fetch).
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryProvider>{children}</QueryProvider>
);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("QueryProvider + hooks", () => {
  it("useSyncStatus resolves the never-synced state through the provider", async () => {
    const fn = vi.fn<typeof fetch>(async () =>
      Response.json({ data: { state: "never-synced" } }),
    );
    vi.stubGlobal("fetch", fn);
    const { result } = renderHook(() => useSyncStatus(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ state: "never-synced" });
    expect(String(fn.mock.calls[0]?.[0])).toContain("/api/sync-status");
  });

  it("useSyncStatus surfaces an API error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { code: "UNAUTHORIZED", message: "no" } },
          { status: 401 },
        ),
      ),
    );
    const { result } = renderHook(() => useSyncStatus(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    });
  });

  it("useAccounts resolves an empty list", async () => {
    const fn = vi.fn<typeof fetch>(async () => Response.json({ data: [] }));
    vi.stubGlobal("fetch", fn);
    const { result } = renderHook(() => useAccounts(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(String(fn.mock.calls[0]?.[0])).toContain("/api/accounts");
  });
});
