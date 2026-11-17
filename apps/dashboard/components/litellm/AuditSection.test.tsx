import { act, screen } from "@testing-library/react";
import { useQueryStates } from "nuqs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveUrlRange } from "@/lib/date-range";
import { dateRangeSearchParams } from "@/lib/date-range-search-params";
import { apiError } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { AuditSection } from "./AuditSection";
import { LiteLLMSection } from "./LiteLLMSection";

// Sources: Design System -- Management pages ("the global date range applies
// to every Management page"), Date Filtering; Rule 20.1 (UTC days), 20.8 (90-day
// cap). /api/litellm/audit parses DateRangeQuerySchema, so the request must carry the URL
// range (nuqs dateFrom/dateTo via resolveUrlRange), else the route answers 400.
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function urls() {
  const seen: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      seen.push(new URL(String(input), "http://localhost"));
      return Promise.resolve(
        apiError(503, "LITELLM_UNAVAILABLE", "LiteLLM is unavailable"),
      );
    }),
  );
  return seen;
}

function Change() {
  const [, set] = useQueryStates(dateRangeSearchParams);
  return (
    <button
      onClick={() => void set({ dateFrom: "2026-09-01", dateTo: "2026-09-10" })}
    >
      change range
    </button>
  );
}

function Subject() {
  return (
    <LiteLLMSection title="Audit">
      <AuditSection />
    </LiteLLMSection>
  );
}

const RANGE = { dateFrom: "2026-10-01", dateTo: "2026-10-31" };

describe("AuditSection date range", () => {
  it("sends the URL dateFrom and dateTo", async () => {
    const seen = urls();
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithProviders(<Subject />, { searchParams: RANGE });
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]?.pathname).toBe("/api/litellm/audit");
    expect(seen[0]?.searchParams.get("dateFrom")).toBe("2026-10-01");
    expect(seen[0]?.searchParams.get("dateTo")).toBe("2026-10-31");
  });

  it("sends the default range when the URL has none", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T10:00:00Z"));
    const expected = resolveUrlRange(null, null);
    const seen = urls();
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithProviders(<Subject />);
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]?.searchParams.get("dateFrom")).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
    expect(seen[0]?.searchParams.get("dateFrom")).toBe(expected.dateFrom);
    expect(seen[0]?.searchParams.get("dateTo")).toBe(expected.dateTo);
  });

  it("refetches with the new range when the URL range changes", async () => {
    const seen = urls();
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithProviders(
      <>
        <Change />
        <Subject />
      </>,
      { searchParams: RANGE },
    );
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    await act(async () => {
      screen.getByRole("button", { name: "change range" }).click();
    });
    await vi.waitFor(() =>
      expect(seen.at(-1)?.searchParams.get("dateFrom")).toBe("2026-09-01"),
    );
    expect(seen.at(-1)?.searchParams.get("dateTo")).toBe("2026-09-10");
  });
});
