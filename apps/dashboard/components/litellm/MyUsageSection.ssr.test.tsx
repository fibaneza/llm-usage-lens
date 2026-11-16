// @vitest-environment node
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MyUsageSection } from "./MyUsageSection";

// Source: docs/specs/2026-11-10-litellm.md -- Cost visualisation and
// provenance, "No server-side fetch of /api/*": a client component rendered
// during SSR must not run a relative fetch (CI logged "Failed to parse URL
// from /api/litellm/me"). Own file: this case needs the node environment (the
// unit project defaults to jsdom); there is no other SSR test pattern.
afterEach(() => vi.restoreAllMocks());

describe("MyUsageSection server render", () => {
  it("runs no relative /api/ fetch and logs no URL parse error during SSR", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("Failed to parse URL from /api/x"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    try {
      renderToString(
        <QueryClientProvider client={client}>
          <NuqsTestingAdapter>
            <MyUsageSection />
          </NuqsTestingAdapter>
        </QueryClientProvider>,
      );
    } catch {
      // a suspended boundary-less render may throw; only fetches matter here
    }
    // Let any started queryFn settle so a rejected fetch would be logged.
    await new Promise((resolve) => setImmediate(resolve));

    const relative = fetchSpy.mock.calls.filter(([input]) =>
      String(input).startsWith("/api/"),
    );
    expect(relative).toEqual([]);
    const logged = errSpy.mock.calls.flat().map(String).join("\n");
    expect(logged).not.toMatch(/Failed to parse URL/);
  });
});
