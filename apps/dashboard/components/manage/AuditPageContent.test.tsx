import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
