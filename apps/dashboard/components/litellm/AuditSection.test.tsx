import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useQueryStates } from "nuqs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveUrlRange } from "@/lib/date-range";
import { dateRangeSearchParams } from "@/lib/date-range-search-params";
import { apiError, apiResponse } from "@/test/fakes/api-stubs";
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

// Source: docs/specs/2026-11-10-litellm.md - Audit, D-LF2; Design System -
// Management pages (Audit, Gateway source): the client maps 403
// OPERATION_UNAVAILABLE to the named Enterprise state; "LiteLLM unavailable"
// is for a real outage (503 LITELLM_UNAVAILABLE) only.
describe("AuditSection edition state (D-LF2)", () => {
  function answer(response: () => Response) {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(response())),
    );
  }

  it("shows the named Enterprise state on 403 OPERATION_UNAVAILABLE, not LiteLLM unavailable", async () => {
    answer(() =>
      apiError(403, "OPERATION_UNAVAILABLE", "Not available on this edition"),
    );
    renderWithProviders(<Subject />, { searchParams: RANGE });
    expect(
      await screen.findByText("The LiteLLM audit log needs LiteLLM Enterprise"),
    ).toBeTruthy();
    expect(screen.queryByText("LiteLLM unavailable")).toBeNull();
  });

  it("still shows LiteLLM unavailable on a real outage (503 LITELLM_UNAVAILABLE)", async () => {
    answer(() =>
      apiError(503, "LITELLM_UNAVAILABLE", "LiteLLM is unavailable"),
    );
    renderWithProviders(<Subject />, { searchParams: RANGE });
    expect(await screen.findByText("LiteLLM unavailable")).toBeTruthy();
    expect(
      screen.queryByText("The LiteLLM audit log needs LiteLLM Enterprise"),
    ).toBeNull();
  });

  it("renders entries, with neither state, on a 200", async () => {
    answer(() =>
      apiResponse({
        data: { items: [], page: 1, totalPages: 1, total: 0 },
      }),
    );
    renderWithProviders(<Subject />, { searchParams: RANGE });
    expect(await screen.findByText("No audit entries.")).toBeTruthy();
    expect(screen.queryByText("LiteLLM unavailable")).toBeNull();
  });
});

// Source: Design System - "Sorting in the other tables (unit SRT1, 2026-11-24;
// D-SR1)": the gateway audit table sorts by time with the shared
// `SortableHeader`, newest first by default; LiteLLM spec - API routes
// (`/api/litellm/audit` `dir`, default `desc`). The App source and the page
// composition are covered in components/manage/AuditPageContent.test.tsx.
describe("AuditSection sorting by time (unit SRT1, D-SR1)", () => {
  const ITEM = {
    id: "a1",
    updatedAt: "2026-11-15T13:00:00Z",
    changedBy: "ops@example.test",
    action: "update",
    tableName: "LiteLLM_TeamTable",
    objectId: "t1",
    changedFields: ["max_budget"],
    viaDashboard: false,
  };
  function seen() {
    const urls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        urls.push(new URL(String(input), "http://localhost"));
        return Promise.resolve(
          apiResponse({
            data: { items: [ITEM], page: 1, totalPages: 1, total: 1 },
          }),
        );
      }),
    );
    return urls;
  }

  it("keeps the date range in the request next to the direction", async () => {
    const urls = seen();
    renderWithProviders(<Subject />, {
      searchParams: { ...RANGE, sort: "time", dir: "asc" },
    });
    await screen.findByRole("columnheader", { name: "Time" });
    expect(urls[0]?.searchParams.get("dateFrom")).toBe("2026-10-01");
    expect(urls[0]?.searchParams.get("dir")).toBe("asc");
  });

  it("refetches with the new direction when the URL direction changes", async () => {
    const urls = seen();
    renderWithProviders(<Subject />, { searchParams: RANGE });
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Time" }));
    await vi.waitFor(() =>
      expect(urls.at(-1)?.searchParams.get("dir")).toBe("asc"),
    );
  });
});
