import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OnUrlUpdateFunction } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuditLogSection } from "@/components/settings/access/AuditLogSection";
import {
  ALICE,
  auditItem,
  ok,
  page,
  stubAccessApi,
} from "@/test/fakes/access-ui-stubs";
import { apiError, apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { AuditPageContent } from "./AuditPageContent";

// Sources: Design System - Management pages, Audit ("one page with a source
// filter - App and Gateway - shown as a segmented toggle in the toolbar (nuqs
// `source`) ... composition, not a merged store ... a source the caller may not
// read is not offered ... Default source App when the caller may read it, else
// Gateway; with one readable source the toggle is not shown"); slice B2 brief
// B2-8 (`aria-pressed`, App = the dashboard audit sections, Gateway =
// AuditSection in LiteLLMSection); LiteLLM spec - Audit (LD15, LT20: field
// names only, "via dashboard" on dashboard entries) and LD20 (timestamps in
// Australia/Sydney with the zone label); Rule 40.5 (URL state), Rule 40.4.
// The audit table behaviour moved here from LiteLLMContent.test.tsx; the
// readable-sources decision per role is asserted at manage/audit/page.test.tsx.
//
// Contract (components/manage/AuditPageContent.tsx, "use client"):
//   props { sources: readonly ("app" | "gateway")[]; app?: ReactNode }
//   `sources` is the server's readable subset in display order; `app` is the
//   server-rendered App source (the dashboard audit sections). A segmented
//   toggle of buttons named "App" and "Gateway" (aria-pressed) renders only
//   when sources has two entries. The selected source is nuqs `source`; an
//   absent or unreadable value falls back to the first readable source. Only
//   the selected source mounts (the Gateway source requests
//   /api/litellm/audit and renders inside a "LiteLLM audit" region).
const AUDIT = {
  items: [
    {
      id: "a1",
      updatedAt: "2026-11-15T13:00:00Z",
      changedBy: "llm-usage-lens:lead@example.test",
      action: "update",
      tableName: "LiteLLM_TeamTable",
      objectId: "t1",
      changedFields: ["max_budget"],
      viaDashboard: true,
    },
    {
      id: "a2",
      updatedAt: "2026-11-15T14:00:00Z",
      changedBy: "ops@example.test",
      action: "create",
      tableName: "LiteLLM_VerificationToken",
      objectId: "tok-9",
      changedFields: ["models"],
      viaDashboard: false,
    },
  ],
};

function stubAudit(reply: () => Response = () => apiResponse({ data: AUDIT })) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      calls.push(new URL(String(input), "http://localhost").pathname);
      return Promise.resolve(reply());
    }),
  );
  return calls;
}

const APP = <div data-testid="app-source">dashboard audit log</div>;
const BOTH = ["app", "gateway"] as const;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// T-ST6 (unit ST1, D-ST6; Design System - Audit page header; Rule 40.9): the
// access review export moves to the page header as a secondary button.
describe("AuditPageContent export (T-ST6, D-ST6)", () => {
  it("T-ST6: Export access review (CSV) is in the page header as a secondary, not filled primary, control", () => {
    stubAudit();
    renderWithProviders(<AuditPageContent sources={BOTH} app={APP} />);

    const exportControl = screen.getByRole("link", {
      name: /export access review \(csv\)/i,
    });
    expect(exportControl).toHaveAttribute(
      "href",
      expect.stringMatching(/\/api\/access-review$/),
    );
    expect(["outline", "secondary", "ghost"]).toContain(
      exportControl.getAttribute("data-variant"),
    );
    // The header, not the bottom: outside the App source content and before it.
    expect(screen.getByTestId("app-source")).not.toContainElement(
      exportControl,
    );
    expect(
      exportControl.compareDocumentPosition(screen.getByTestId("app-source")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("T-ST6: the App source keeps its own content below the header", () => {
    stubAudit();
    renderWithProviders(<AuditPageContent sources={BOTH} app={APP} />);
    expect(screen.getByTestId("app-source")).toHaveTextContent(
      "dashboard audit log",
    );
  });
});

describe("AuditPageContent source toggle (Management pages - Audit)", () => {
  it("offers App and Gateway as a segmented toggle with App pressed by default, and mounts only App", async () => {
    const calls = stubAudit();
    renderWithProviders(<AuditPageContent sources={BOTH} app={APP} />);

    expect(screen.getByRole("button", { name: "App" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Gateway" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByTestId("app-source")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "LiteLLM audit" }),
    ).not.toBeInTheDocument();
    expect(calls).not.toContain("/api/litellm/audit");
  });

  it("?source=gateway selects Gateway: the LiteLLM audit region, no App source", async () => {
    stubAudit();
    renderWithProviders(<AuditPageContent sources={BOTH} app={APP} />, {
      searchParams: { source: "gateway" },
    });

    expect(
      await screen.findByRole("region", { name: "LiteLLM audit" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gateway" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByTestId("app-source")).not.toBeInTheDocument();
  });

  it("choosing Gateway writes ?source=gateway (Rule 40.5)", async () => {
    stubAudit();
    const onUrlUpdate = vi.fn();
    renderWithProviders(<AuditPageContent sources={BOTH} app={APP} />, {
      onUrlUpdate,
    });

    await userEvent.click(screen.getByRole("button", { name: "Gateway" }));

    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get("source")).toBe(
      "gateway",
    );
  });

  it("with one readable source there is no toggle: Gateway only", async () => {
    stubAudit();
    renderWithProviders(<AuditPageContent sources={["gateway"]} />);

    expect(
      await screen.findByRole("region", { name: "LiteLLM audit" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "App" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Gateway" })).toBeNull();
  });

  it("with one readable source there is no toggle: App only, and Gateway is never requested", async () => {
    const calls = stubAudit();
    renderWithProviders(<AuditPageContent sources={["app"]} app={APP} />);

    expect(screen.getByTestId("app-source")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gateway" })).toBeNull();
    expect(calls).not.toContain("/api/litellm/audit");
  });

  it("a source the caller may not read is never selected, even by ?source=", async () => {
    const calls = stubAudit();
    renderWithProviders(<AuditPageContent sources={["app"]} app={APP} />, {
      searchParams: { source: "gateway" },
    });

    expect(screen.getByTestId("app-source")).toBeInTheDocument();
    expect(calls).not.toContain("/api/litellm/audit");
  });

  it("an unknown ?source= falls back to the default source", async () => {
    stubAudit();
    renderWithProviders(<AuditPageContent sources={BOTH} app={APP} />, {
      searchParams: { source: "bogus" },
    });

    expect(screen.getByTestId("app-source")).toBeInTheDocument();
  });
});

describe("AuditPageContent Gateway source (LiteLLM spec - Audit, LD15, LD20, LT20)", () => {
  it("shows actor, object and changed field names, with via dashboard on dashboard entries only", async () => {
    stubAudit();
    renderWithProviders(<AuditPageContent sources={["gateway"]} />);

    const audit = await screen.findByRole("region", { name: "LiteLLM audit" });
    expect(await within(audit).findByText("ops@example.test")).toBeVisible();
    expect(within(audit).getByText("max_budget")).toBeInTheDocument();
    expect(within(audit).getByText("tok-9")).toBeInTheDocument();
    expect(within(audit).getAllByText(/via dashboard/i)).toHaveLength(1);
  });

  it("renders audit timestamps in Australia/Sydney with the zone label", async () => {
    stubAudit();
    renderWithProviders(<AuditPageContent sources={["gateway"]} />);

    const audit = await screen.findByRole("region", { name: "LiteLLM audit" });
    expect(
      await within(audit).findByText(/16 Nov 2026,? 00:00 AEDT/),
    ).toBeInTheDocument();
  });

  it("shows an inline 'LiteLLM unavailable' on an outage and keeps the page up", async () => {
    stubAudit(() =>
      apiError(503, "LITELLM_UNAVAILABLE", "LiteLLM is unavailable"),
    );
    renderWithProviders(<AuditPageContent sources={BOTH} app={APP} />, {
      searchParams: { source: "gateway" },
    });

    const audit = await screen.findByRole("region", { name: "LiteLLM audit" });
    expect(
      await within(audit).findByText(/LiteLLM unavailable/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "App" })).toBeInTheDocument();
  });
});

// Source: Design System - "Sorting in the other tables (unit SRT1, 2026-11-24;
// D-SR1, D-SR2)": the audit log, app and gateway sources, sorts by time in
// both directions with the shared `SortableHeader`, "newest first on the
// gateway source and oldest first on the app source by default, as today"; the
// sort is server-side (`dir` on /api/audit and /api/litellm/audit) and lives
// in the URL (nuqs `sort`, `dir`). Access Control - API routes (`/api/audit`
// `dir`); LiteLLM spec - API routes (`/api/litellm/audit` `dir`).
describe("AuditPageContent sorting by time (unit SRT1, D-SR1)", () => {
  const APP_ROWS = [
    auditItem({ requestId: "r1", timestamp: "2026-11-15T10:00:00.000Z" }),
    auditItem({
      requestId: "r2",
      action: "role.grant",
      timestamp: "2026-11-15T10:05:00.000Z",
    }),
  ];
  const routes = () => ({
    "GET /api/audit": page(APP_ROWS),
    "GET /api/identities": page([ALICE]),
    "GET /api/litellm/audit": () => ok(AUDIT),
  });
  const withApp = (
    searchParams: Record<string, string> = {},
    onUrlUpdate?: OnUrlUpdateFunction,
  ) =>
    renderWithProviders(
      <AuditPageContent sources={BOTH} app={<AuditLogSection />} />,
      { searchParams, ...(onUrlUpdate ? { onUrlUpdate } : {}) },
    );
  const dirOf = (search: string, fallback: string) =>
    new URLSearchParams(search).get("dir") ?? fallback;

  describe("App source (oldest first by default)", () => {
    it("the Time header is a sort button, ascending by default, and the request is oldest first", async () => {
      const api = stubAccessApi(routes());
      withApp();
      const th = await screen.findByRole("columnheader", {
        name: "Time (UTC)",
      });
      expect(
        within(th).getByRole("button", { name: "Time (UTC)" }),
      ).toBeInTheDocument();
      expect(th).toHaveAttribute("aria-sort", "ascending");
      await vi.waitFor(() =>
        expect(api.to("GET /api/audit")).not.toHaveLength(0),
      );
      expect(dirOf(api.to("GET /api/audit")[0]!.search, "asc")).toBe("asc");
    });

    it("?sort=time&dir=desc: the header says descending and the request carries dir=desc", async () => {
      const api = stubAccessApi(routes());
      withApp({ sort: "time", dir: "desc" });
      const th = await screen.findByRole("columnheader", {
        name: "Time (UTC)",
      });
      expect(th).toHaveAttribute("aria-sort", "descending");
      expect(
        new URLSearchParams(api.to("GET /api/audit")[0]!.search).get("dir"),
      ).toBe("desc");
    });

    it("clicking Time on the default order writes dir=desc to the URL and refetches newest first", async () => {
      const onUrlUpdate = vi.fn();
      const api = stubAccessApi(routes());
      withApp({}, onUrlUpdate);
      await userEvent
        .setup()
        .click(await screen.findByRole("button", { name: "Time (UTC)" }));
      await vi.waitFor(() =>
        expect(
          api
            .to("GET /api/audit")
            .some((c) => new URLSearchParams(c.search).get("dir") === "desc"),
        ).toBe(true),
      );
      expect(onUrlUpdate.mock.calls.at(-1)?.[0]?.queryString).toContain(
        "dir=desc",
      );
    });
  });

  describe("Gateway source (newest first by default)", () => {
    const gateway = { source: "gateway" };

    it("the Time header is a sort button, descending by default, and the request is newest first", async () => {
      const api = stubAccessApi(routes());
      withApp(gateway);
      const th = await screen.findByRole("columnheader", { name: "Time" });
      expect(
        within(th).getByRole("button", { name: "Time" }),
      ).toBeInTheDocument();
      expect(th).toHaveAttribute("aria-sort", "descending");
      await vi.waitFor(() =>
        expect(api.to("GET /api/litellm/audit")).not.toHaveLength(0),
      );
      expect(dirOf(api.to("GET /api/litellm/audit")[0]!.search, "desc")).toBe(
        "desc",
      );
    });

    it("?sort=time&dir=asc: the header says ascending and the request carries dir=asc", async () => {
      const api = stubAccessApi(routes());
      withApp({ ...gateway, sort: "time", dir: "asc" });
      const th = await screen.findByRole("columnheader", { name: "Time" });
      expect(th).toHaveAttribute("aria-sort", "ascending");
      expect(
        new URLSearchParams(api.to("GET /api/litellm/audit")[0]!.search).get(
          "dir",
        ),
      ).toBe("asc");
    });

    it("clicking Time on the default order writes dir=asc to the URL and refetches oldest first", async () => {
      const onUrlUpdate = vi.fn();
      const api = stubAccessApi(routes());
      withApp(gateway, onUrlUpdate);
      await userEvent
        .setup()
        .click(await screen.findByRole("button", { name: "Time" }));
      await vi.waitFor(() =>
        expect(
          api
            .to("GET /api/litellm/audit")
            .some((c) => new URLSearchParams(c.search).get("dir") === "asc"),
        ).toBe(true),
      );
      expect(onUrlUpdate.mock.calls.at(-1)?.[0]?.queryString).toContain(
        "dir=asc",
      );
    });
  });

  // Design System - "Sorting in the other tables (unit SRT1": newest first on
  // the gateway and oldest first on the app by default. The two sources share
  // the URL `sort`/`dir`, so switching source clears them and each view opens
  // in its own default (review W-U1).
  describe("switching source resets the order to that source's default (review W-U1)", () => {
    it("app sorted dir=desc, then Gateway: sort and dir leave the URL and the Gateway shows newest first", async () => {
      const onUrlUpdate = vi.fn();
      const api = stubAccessApi(routes());
      withApp({ sort: "time", dir: "desc" }, onUrlUpdate);
      await screen.findByRole("columnheader", { name: "Time (UTC)" });
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "Gateway" }));
      const th = await screen.findByRole("columnheader", { name: "Time" });
      const last = new URLSearchParams(
        onUrlUpdate.mock.calls.at(-1)?.[0]?.queryString,
      );
      expect(last.get("source")).toBe("gateway");
      expect(last.has("sort")).toBe(false);
      expect(last.has("dir")).toBe(false);
      expect(th).toHaveAttribute("aria-sort", "descending");
      await vi.waitFor(() =>
        expect(api.to("GET /api/litellm/audit")).not.toHaveLength(0),
      );
      expect(
        dirOf(api.to("GET /api/litellm/audit").at(-1)!.search, "desc"),
      ).toBe("desc");
    });

    it("Gateway sorted dir=asc, then App: dir leaves the URL and the App shows oldest first", async () => {
      const onUrlUpdate = vi.fn();
      const api = stubAccessApi(routes());
      withApp({ source: "gateway", sort: "time", dir: "asc" }, onUrlUpdate);
      await screen.findByRole("columnheader", { name: "Time" });
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "App" }));
      const th = await screen.findByRole("columnheader", {
        name: "Time (UTC)",
      });
      const last = new URLSearchParams(
        onUrlUpdate.mock.calls.at(-1)?.[0]?.queryString,
      );
      expect(last.has("sort")).toBe(false);
      expect(last.has("dir")).toBe(false);
      expect(th).toHaveAttribute("aria-sort", "ascending");
      await vi.waitFor(() =>
        expect(api.to("GET /api/audit")).not.toHaveLength(0),
      );
      expect(dirOf(api.to("GET /api/audit").at(-1)!.search, "asc")).toBe("asc");
    });
  });
});
