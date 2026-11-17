import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse, NEVER } from "@/test/fakes/api-stubs";
import {
  srOnlyMatches,
  stubSizedResizeObserver,
} from "@/test/support/chart-test-utils";
import { HIDDEN, personShow } from "@/test/fakes/combined-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import MePage from "./page";

// Source: implementation-phases Phase 4R.5 (My usage page /dashboard/me; "no
// team" and "not visible" states); Design System - "Access states and scoped
// labels" (No team: My usage plus "Ask your team lead for access"; Not
// visible: a neutral inline notice, never a zero); Access Control spec -
// Roles (My usage: any signed-in role) and "Canonical usage identity";
// Rule 40.4 / 60.12 (own skeleton and error state); Rule 60.7 (Server
// Component shell). Data: GET /api/me and GET /api/me/usage (existing 4R.3
// routes). Rule 60.24: fetch is stubbed.
afterEach(() => {
  vi.unstubAllGlobals();
});

const ME = {
  oid: "oid-1",
  email: "a1@company.com",
  roles: ["internal-viewer"],
  usageIdentities: ["a1@company.com"],
  global: false,
  memberTeamId: "team-a",
  memberTeamVisible: true,
  teamScopes: [] as string[],
  departmentScopes: [] as string[],
};
const USAGE = {
  totals: { cost: 12.5, inputTokens: 1200, outputTokens: 300, invocations: 42 },
  daily: [
    {
      date: "2026-01-11",
      cost: 12.5,
      inputTokens: 1200,
      outputTokens: 300,
      invocations: 42,
    },
  ],
  // Slice B2 B2-11: the spend-by-model breakdown (see lib/api/me.test.ts).
  byModel: [
    {
      model: "claude-sonnet",
      cost: 9.25,
      inputTokens: 900,
      outputTokens: 200,
      invocations: 30,
    },
    {
      model: "claude-haiku",
      cost: 3.25,
      inputTokens: 300,
      outputTokens: 100,
      invocations: 12,
    },
  ],
};
const EMPTY_USAGE = {
  totals: { cost: 0, inputTokens: 0, outputTokens: 0, invocations: 0 },
  daily: [],
  byModel: [],
};
// The LiteLLM My usage view now lives on this page (Design System - Management
// pages, My usage: "the 4R.5 own Bedrock usage and the LiteLLM My usage view,
// each labelled with its source"); an unlinked caller by default.
const LITELLM_UNLINKED = { linked: false, teams: [], enabledOperations: [] };
const SENTINEL_KEY_VALUE = "sk-SENTINEL-KEY-VALUE";
const LITELLM_LINKED = {
  linked: true,
  spend: 33.25,
  maxBudget: 100,
  daily: [{ date: "2026-01-12", spend: 4.5 }],
  keys: [
    {
      tokenId: "tok-me",
      keyAlias: "my-key",
      models: ["claude-sonnet"],
      maxBudget: 20,
      spend: 3.25,
      expires: "2026-12-31T00:00:00Z",
      blocked: false,
      key: SENTINEL_KEY_VALUE,
    },
  ],
  teams: [],
  enabledOperations: [],
};

function stub(
  me: () => Promise<Response>,
  usage: () => Promise<Response>,
  litellm: () => Promise<Response> = () =>
    Promise.resolve(apiResponse({ data: LITELLM_UNLINKED })),
  combined: () => Promise<Response> = () =>
    Promise.resolve(apiResponse({ data: HIDDEN })),
) {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      urls.push(url.pathname + url.search);
      if (url.pathname === "/api/me/usage") return usage();
      if (url.pathname === "/api/me") return me();
      if (url.pathname === "/api/litellm/me") return litellm();
      if (url.pathname === "/api/litellm/combined/me") return combined();
      return Promise.resolve(apiError(404, "NOT_FOUND", "unexpected"));
    }),
  );
  return urls;
}
const ok = (data: unknown) => () => Promise.resolve(apiResponse({ data }));
const RANGE = { dateFrom: "2026-01-11", dateTo: "2026-01-20" };

describe("MePage (/dashboard/me)", () => {
  it("stays a Server Component shell (Rule 60.7)", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "page.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/^\s*["']use client["']/m);
  });

  it("shows the caller's own Bedrock totals for the URL date range", async () => {
    const urls = stub(ok(ME), ok(USAGE));
    renderWithProviders(await Promise.resolve(MePage()), {
      searchParams: RANGE,
    });
    await waitFor(() => expect(screen.getByText("$12.50")).toBeInTheDocument());
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /your bedrock usage/i }),
    ).toBeInTheDocument();
    expect(urls).toContain(
      "/api/me/usage?dateFrom=2026-01-11&dateTo=2026-01-20",
    );
  });

  it("shows a skeleton and no figures while the requests are pending", () => {
    stub(NEVER, NEVER);
    const view = renderWithProviders(MePage());
    expect(
      view.container.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("$12.50")).not.toBeInTheDocument();
  });

  it("shows an empty state, not an error, when no usage matches the identities", async () => {
    stub(ok(ME), ok(EMPTY_USAGE));
    renderWithProviders(await Promise.resolve(MePage()), {
      searchParams: RANGE,
    });
    expect(
      await screen.findByText(/no bedrock usage/i, { exact: false }),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });

  it('shows "Ask your team lead for access" with the usage for a viewer with no team', async () => {
    stub(
      ok({ ...ME, memberTeamId: null, memberTeamVisible: false }),
      ok(USAGE),
    );
    renderWithProviders(await Promise.resolve(MePage()), {
      searchParams: RANGE,
    });
    expect(
      await screen.findByText(/ask your team lead for access/i),
    ).toBeInTheDocument();
    expect(await screen.findByText("$12.50")).toBeInTheDocument();
  });

  it("does not show the no-team prompt to someone with a member team, an admin scope or a global role", async () => {
    for (const me of [
      ME,
      { ...ME, memberTeamId: null, teamScopes: ["team-a"] },
      { ...ME, memberTeamId: null, departmentScopes: ["dept-eng"] },
      { ...ME, memberTeamId: null, global: true },
    ]) {
      stub(ok(me), ok(USAGE));
      const view = renderWithProviders(await Promise.resolve(MePage()), {
        searchParams: RANGE,
      });
      await screen.findByText("$12.50");
      expect(
        screen.queryByText(/ask your team lead for access/i),
      ).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it("shows a neutral not-visible notice, never a zero, when the member's team is hidden", async () => {
    stub(ok({ ...ME, memberTeamVisible: false }), ok(USAGE));
    renderWithProviders(await Promise.resolve(MePage()), {
      searchParams: RANGE,
    });
    expect(await screen.findByText(/not visible/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/ask your team lead for access/i),
    ).not.toBeInTheDocument();
  });

  it("contains a failing request in an alert instead of breaking the page (Rule 40.4)", async () => {
    stub(ok(ME), () => Promise.resolve(apiError(500)));
    renderWithProviders(await Promise.resolve(MePage()), {
      searchParams: RANGE,
    });
    expect((await screen.findAllByRole("alert")).length).toBeGreaterThan(0);
  });

  // Slice B1, B1-12 / Design System - Layout, Page frame: a PageHeader
  // description sits at the top of the page shell, rendered before any data
  // resolves; the h1 stays in the top bar.
  it("starts with a PageHeader description, before the requests resolve, and no page-level h1", () => {
    stub(NEVER, NEVER);
    const view = renderWithProviders(MePage());

    const description = view.container.querySelector("p");
    expect(description?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });
});

// Slice B2, B2-11. Sources: Design System - Management pages, My usage ("a
// spend-by-day chart and a spend-by-model breakdown of the caller's own data -
// lazy-loaded Recharts in ResponsiveContainer, series coloured by the model
// token from packages/shared (Rule 40.2, 40.3)"); the charts keep the
// screen-reader copy of their data (Rule 60.30, the sr-only table convention
// of components/charts). Contract (app/dashboard/me/MeContent.tsx): when the
// usage has days, a heading "Spend by day" with a daily cost chart and a
// heading "Spend by model" with a per-model breakdown from `byModel`; each
// carries an sr-only table copy of its values (model rows use the display
// name from packages/shared, "Claude Sonnet"). With no usage: the existing
// empty state, no chart headings.
describe("MePage charts (B2-11)", () => {
  it("draws a spend-by-day chart and a spend-by-model breakdown from the caller's own usage", async () => {
    stubSizedResizeObserver();
    stub(ok(ME), ok(USAGE));
    renderWithProviders(await Promise.resolve(MePage()), {
      searchParams: RANGE,
    });

    expect(
      await screen.findByRole("heading", { name: "Spend by day" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Spend by model" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(srOnlyMatches("2026-01-11").length).toBeGreaterThan(0);
      expect(srOnlyMatches("Claude Sonnet").length).toBeGreaterThan(0);
      expect(srOnlyMatches("Claude Haiku").length).toBeGreaterThan(0);
      expect(srOnlyMatches(/9\.25/).length).toBeGreaterThan(0);
    });
    vi.unstubAllGlobals();
  });

  it("shows neither chart for an empty range", async () => {
    stub(ok(ME), ok(EMPTY_USAGE));
    renderWithProviders(await Promise.resolve(MePage()), {
      searchParams: RANGE,
    });
    await screen.findByText(/no bedrock usage/i, { exact: false });

    expect(
      screen.queryByRole("heading", { name: "Spend by day" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Spend by model" }),
    ).not.toBeInTheDocument();
  });
});

// "A 'Request a budget increase' link addresses the caller's team lead as a
// mailto: link ... no outbound-message feature is added, and the link is absent
// when no lead is known" (Design System - My usage; B2-11: "no new route if the
// data is not available - then absent"). Contract: GET /api/me may carry an
// optional `leadEmail` (string | null); MeResponseSchema accepts it. The link
// renders only for a non-empty value, as a link named "Request a budget
// increase" whose href starts with mailto:<leadEmail>.
describe("MePage budget-increase link (B2-11)", () => {
  it("links to the team lead's address when one is known", async () => {
    stub(ok({ ...ME, leadEmail: "lead@company.com" }), ok(USAGE));
    renderWithProviders(await Promise.resolve(MePage()), {
      searchParams: RANGE,
    });

    const link = await screen.findByRole("link", {
      name: "Request a budget increase",
    });
    expect(link.getAttribute("href")).toMatch(
      new RegExp(`^mailto:${encodeURIComponent("lead@company.com")}(\\?|$)`),
    );
  });

  // B2 review: the address is encoded, so "+" and "&" cannot add recipients or
  // header fields to the mailto: URL.
  it("encodes the lead's address: '+' and '&' stay inside one recipient", async () => {
    const lead = "a+b&cc=x@company.com";
    stub(ok({ ...ME, leadEmail: lead }), ok(USAGE));
    renderWithProviders(await Promise.resolve(MePage()), {
      searchParams: RANGE,
    });

    const link = await screen.findByRole("link", {
      name: "Request a budget increase",
    });
    const href = link.getAttribute("href") ?? "";
    expect(href.startsWith(`mailto:${encodeURIComponent(lead)}?`)).toBe(true);
    const query = new URLSearchParams(href.split("?")[1]);
    expect([...query.keys()]).toEqual(["subject"]);
  });

  it.each([
    ["no lead field", ME],
    ["a null lead", { ...ME, leadEmail: null }],
    ["an empty lead", { ...ME, leadEmail: "" }],
  ])("is absent with %s", async (_n, me) => {
    stub(ok(me), ok(USAGE));
    renderWithProviders(await Promise.resolve(MePage()), {
      searchParams: RANGE,
    });
    await screen.findByText("$12.50");

    expect(
      screen.queryByRole("link", { name: "Request a budget increase" }),
    ).not.toBeInTheDocument();
  });
});

// Moved from LiteLLMContent.test.tsx (the My usage tab): the LiteLLM My usage
// view stays on this page now that the tab row is gone (LiteLLM spec - Views
// by role: My usage for every role; LT8 "LiteLLM-reported" labels; LD20 UTC
// day buckets; keys' metadata, never a key value). Contract: a region whose
// accessible name contains "LiteLLM" holds MyUsageSection, labelled
// LiteLLM-reported, next to the Bedrock "Your Bedrock usage" section.
describe("MePage LiteLLM My usage view (moved from the LiteLLM tab)", () => {
  const liteLLMRegion = () => screen.findByRole("region", { name: /litellm/i });

  it("shows the caller's LiteLLM spend and budget in USD, labelled LiteLLM-reported, with UTC-day buckets", async () => {
    stub(ok(ME), ok(USAGE), () =>
      Promise.resolve(apiResponse({ data: LITELLM_LINKED })),
    );
    renderWithProviders(await Promise.resolve(MePage()), {
      searchParams: RANGE,
    });

    const region = await liteLLMRegion();
    expect(await within(region).findByText("$33.25")).toBeInTheDocument();
    expect(within(region).getByText("$100.00")).toBeInTheDocument();
    expect(
      within(region).getAllByText("LiteLLM-reported").length,
    ).toBeGreaterThan(0);
    expect(within(region).getByText(/UTC days?/i)).toBeInTheDocument();
  });

  it("lists the caller's own keys' metadata and never a key value", async () => {
    stub(ok(ME), ok(USAGE), () =>
      Promise.resolve(apiResponse({ data: LITELLM_LINKED })),
    );
    const { container } = renderWithProviders(await Promise.resolve(MePage()), {
      searchParams: RANGE,
    });

    expect(
      await within(await liteLLMRegion()).findByText("my-key"),
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain(SENTINEL_KEY_VALUE);
  });

  it("sends the URL date range with the me request (Rule 20.8)", async () => {
    const urls = stub(ok(ME), ok(USAGE));
    renderWithProviders(await Promise.resolve(MePage()), {
      searchParams: RANGE,
    });
    await liteLLMRegion();

    const mine = urls.filter((u) => u.startsWith("/api/litellm/me"));
    expect(mine.length).toBeGreaterThan(0);
    for (const u of mine) {
      const q = new URL(u, "http://localhost").searchParams;
      expect(q.get("dateFrom")).toBe("2026-01-11");
      expect(q.get("dateTo")).toBe("2026-01-20");
    }
  });

  it("shows an unlinked caller an explanation, and an outage as 'LiteLLM unavailable' without breaking the Bedrock section", async () => {
    stub(ok(ME), ok(USAGE), () =>
      Promise.resolve(
        apiError(503, "LITELLM_UNAVAILABLE", "LiteLLM is unavailable"),
      ),
    );
    renderWithProviders(await Promise.resolve(MePage()), {
      searchParams: RANGE,
    });

    expect(
      await within(await liteLLMRegion()).findByText(/LiteLLM unavailable/i),
    ).toBeInTheDocument();
    expect(await screen.findByText("$12.50")).toBeInTheDocument();
  });

  it("an unlinked caller sees the not-linked state", async () => {
    stub(ok(ME), ok(USAGE));
    renderWithProviders(await Promise.resolve(MePage()), {
      searchParams: RANGE,
    });

    expect(
      await within(await liteLLMRegion()).findByText(/not linked to LiteLLM/i),
    ).toBeInTheDocument();
  });
});

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage
// (L6)": Where each figure appears (My usage: 'a "Your combined usage" card
// above the existing Bedrock and LiteLLM sections; per Visibility'), States
// ("hidden: no combined card, the source sections stay"; 503 -> that
// section's ErrorBoundary only), Visibility (Viewer/Lead: show when the
// gateway is configured, else hidden). Mount only (Rule 60.24a). Contract:
// MeContent renders <CombinedMeCard range={range} /> first in the page body
// (after the access notice), above "Your Bedrock usage".
describe("MePage - Your combined usage card mount (L6)", () => {
  const combinedOk = (data: unknown) => () =>
    Promise.resolve(apiResponse({ data }));

  it("without the gateway configured (hidden) there is no combined card and both source sections stay", async () => {
    const urls = stub(ok(ME), ok(USAGE), undefined, combinedOk(HIDDEN));
    renderWithProviders(await Promise.resolve(MePage()), {
      searchParams: RANGE,
    });
    await screen.findByText("$12.50");
    expect(
      screen.getByRole("heading", { name: /your bedrock usage/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /litellm usage/i }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(urls.some((u) => u.startsWith("/api/litellm/combined/me"))).toBe(
        true,
      ),
    );
    expect(
      screen.queryByRole("region", { name: "Your combined usage" }),
    ).toBeNull();
  });

  it("with the gateway configured the card shows above the Bedrock section, for the URL range", async () => {
    const urls = stub(ok(ME), ok(USAGE), undefined, combinedOk(personShow()));
    renderWithProviders(await Promise.resolve(MePage()), {
      searchParams: RANGE,
    });
    const card = await screen.findByRole("region", {
      name: "Your combined usage",
    });
    expect(card).toHaveTextContent("$15.00");
    const heading = screen.getByRole("heading", {
      name: /your bedrock usage/i,
    });
    expect(
      card.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(urls).toContain(
      "/api/litellm/combined/me?dateFrom=2026-01-11&dateTo=2026-01-20",
    );
  });

  it("a LiteLLM outage breaks only the combined card", async () => {
    stub(ok(ME), ok(USAGE), undefined, () =>
      Promise.resolve(apiError(503, "LITELLM_UNAVAILABLE", "unavailable")),
    );
    renderWithProviders(await Promise.resolve(MePage()), {
      searchParams: RANGE,
    });
    expect(
      await screen.findByText("Couldn't load your combined usage."),
    ).toBeInTheDocument();
    expect(await screen.findByText("$12.50")).toBeInTheDocument();
  });
});
