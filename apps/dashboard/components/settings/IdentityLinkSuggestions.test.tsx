import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse } from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

import { IdentityLinkSuggestions } from "./IdentityLinkSuggestions";

// Source: docs/specs/2026-11-10-access-control.md - "Usage-identity mapping
// rules (D27)": the Identity links section SUGGESTS a link for each non-person
// usage key that a rule maps to an existing identity's email; the admin confirms
// each suggestion (or confirms all for one rule); the confirmed key is stored as
// an exact alias with its UsageKeyClaim (409 on a duplicate); nothing is ever
// linked automatically; rules never grant access. "Identity links" (internal-admin
// only; the auditor reads), Data Model - DateRangeQuerySchema (90-day cap),
// Rule 60.17 (no silent failures), Rule 60.24 (time is controlled).
// Module under test (new, a client component):
// `components/settings/IdentityLinkSuggestions.tsx`,
// `IdentityLinkSuggestions({ isAdmin }: { isAdmin: boolean })`, for the Identity
// links section to embed. It fetches
// GET /api/governance/identity-map-rules/suggestions?dateFrom&dateTo for the
// widest allowed range (90 inclusive UTC days ending today) and confirms through
// the existing link routes: GET /api/identities/[oid]/links (current version and
// keys) then PUT { usageIdentities, aliases (+ the key), litellmUserId?, version }.
// Suggestions are grouped under their rule's pattern. Control names: "Confirm
// link <usageKey>" per suggestion, "Confirm all for <pattern>" per group.
// "Confirm all" is a client-side sequence of those same PUTs (no bulk route), one
// per suggestion, each using the freshly read link version.
const NOW = new Date("2026-11-15T09:30:00.000Z");
const PATH = "/api/governance/identity-map-rules/suggestions";
const OID_A = "oid-alice";
const OID_B = "oid-bob";

type Suggestion = {
  pattern: string;
  usageKey: string;
  email: string;
  oid: string;
};
const alice: Suggestion = {
  pattern: "{name}-sso",
  usageKey: "alice-sso",
  email: "alice@company.com",
  oid: OID_A,
};
const bob: Suggestion = {
  pattern: "{name}-sso",
  usageKey: "bob-sso",
  email: "bob@company.com",
  oid: OID_B,
};
const aliceSvc: Suggestion = {
  pattern: "svc-{name}",
  usageKey: "svc-alice",
  email: "alice@company.com",
  oid: OID_A,
};

type Link = {
  oid: string;
  usageIdentities: string[];
  aliases: string[];
  litellmUserId?: string;
  version: number;
  updatedAt: string;
};
type Put = { path: string; body: Record<string, unknown> };

function stub(
  suggestions: Suggestion[],
  options: {
    links?: Record<string, Partial<Link>>;
    putResult?: (put: Put) => Response | undefined;
  } = {},
) {
  let remaining = suggestions;
  const links: Record<string, Link> = {};
  const linkOf = (oid: string): Link =>
    (links[oid] ??= {
      oid,
      usageIdentities: [],
      aliases: [],
      version: 0,
      updatedAt: "1970-01-01T00:00:00.000Z",
      ...options.links?.[oid],
    });
  const puts: Put[] = [];
  const requests: { method: string; url: URL }[] = [];
  let listFetches = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const method = init?.method ?? "GET";
      requests.push({ method, url });
      if (url.pathname === PATH) {
        listFetches += 1;
        return apiResponse({ data: { items: remaining } });
      }
      const match = /^\/api\/identities\/([^/]+)\/links$/.exec(url.pathname);
      if (!match?.[1]) throw new Error(`unexpected fetch ${url.pathname}`);
      const oid = match[1];
      if (method === "GET") return apiResponse({ data: linkOf(oid) });
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const put: Put = { path: url.pathname, body };
      puts.push(put);
      const custom = options.putResult?.(put);
      if (custom) return custom;
      const next: Link = {
        ...linkOf(oid),
        usageIdentities: body.usageIdentities as string[],
        aliases: body.aliases as string[],
        version: linkOf(oid).version + 1,
        updatedAt: NOW.toISOString(),
      };
      links[oid] = next;
      remaining = remaining.filter(
        (s) => !(s.oid === oid && next.aliases.includes(s.usageKey)),
      );
      return apiResponse({ data: next });
    }),
  );
  return {
    puts: () => [...puts],
    listFetches: () => listFetches,
    listUrls: () =>
      requests.filter((r) => r.url.pathname === PATH).map((r) => r.url),
    nonGets: () => requests.filter((r) => r.method !== "GET"),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("IdentityLinkSuggestions -- list", () => {
  it("groups suggestions under their rule, each showing the usage key and the email it maps to", async () => {
    stub([alice, bob, aliceSvc]);
    renderWithProviders(<IdentityLinkSuggestions isAdmin />);
    const sso = await screen.findByRole("group", { name: /\{name\}-sso/ });
    expect(within(sso).getByText("alice-sso")).toBeVisible();
    expect(within(sso).getByText("alice@company.com")).toBeVisible();
    expect(within(sso).getByText("bob-sso")).toBeVisible();
    expect(within(sso).queryByText("svc-alice")).not.toBeInTheDocument();
    const svc = screen.getByRole("group", { name: /svc-\{name\}/ });
    expect(within(svc).getByText("svc-alice")).toBeVisible();
  });

  it("asks for the widest allowed range: 90 inclusive UTC days ending today", async () => {
    const api = stub([alice]);
    renderWithProviders(<IdentityLinkSuggestions isAdmin />);
    await screen.findByText("alice-sso");
    const [url] = api.listUrls();
    expect(url?.searchParams.get("dateFrom")).toBe("2026-08-18");
    expect(url?.searchParams.get("dateTo")).toBe("2026-11-15");
  });

  it("shows an empty state when no rule maps a usage key to an existing identity", async () => {
    stub([]);
    renderWithProviders(<IdentityLinkSuggestions isAdmin />);
    expect(await screen.findByText(/no suggested links/i)).toBeInTheDocument();
  });

  it("shows a skeleton while loading", () => {
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    const { container } = renderWithProviders(
      <IdentityLinkSuggestions isAdmin />,
    );
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryByText(/no suggested links/i)).not.toBeInTheDocument();
  });

  it("shows a readable error when suggestions cannot be loaded", async () => {
    vi.stubGlobal("fetch", async () => apiError(500, "INTERNAL", "boom"));
    renderWithProviders(<IdentityLinkSuggestions isAdmin />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("never links anything on its own: rendering sends no write and no link read", async () => {
    const api = stub([alice, bob]);
    renderWithProviders(<IdentityLinkSuggestions isAdmin />);
    await screen.findByText("alice-sso");
    expect(api.nonGets()).toEqual([]);
    expect(api.puts()).toEqual([]);
  });
});

describe("IdentityLinkSuggestions -- role gating", () => {
  it("shows the suggestions to a non-admin (the auditor) with no confirm control", async () => {
    stub([alice, bob]);
    renderWithProviders(<IdentityLinkSuggestions isAdmin={false} />);
    expect(await screen.findByText("alice-sso")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /confirm/i }),
    ).not.toBeInTheDocument();
  });

  it("gives an admin one confirm per suggestion and one confirm-all per rule", async () => {
    stub([alice, bob, aliceSvc]);
    renderWithProviders(<IdentityLinkSuggestions isAdmin />);
    await screen.findByText("alice-sso");
    for (const name of [
      "Confirm link alice-sso",
      "Confirm link bob-sso",
      "Confirm link svc-alice",
      "Confirm all for {name}-sso",
      "Confirm all for svc-{name}",
    ]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
  });
});

describe("IdentityLinkSuggestions -- confirm one", () => {
  it("reads the person's link, then PUTs it with the key added as an alias at the read version, and the suggestion goes away", async () => {
    const api = stub([alice, bob]);
    renderWithProviders(<IdentityLinkSuggestions isAdmin />);
    const user = userEvent.setup();
    await screen.findByText("alice-sso");
    await user.click(
      screen.getByRole("button", { name: "Confirm link alice-sso" }),
    );

    await waitFor(() => expect(api.puts()).toHaveLength(1));
    expect(api.puts()[0]).toMatchObject({
      path: `/api/identities/${OID_A}/links`,
      body: { usageIdentities: [], aliases: ["alice-sso"], version: 0 },
    });
    await waitFor(() =>
      expect(screen.queryByText("alice-sso")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("bob-sso")).toBeVisible();
    expect(api.listFetches()).toBeGreaterThanOrEqual(2);
  });

  it("keeps the person's existing usage identities, aliases and LiteLLM user", async () => {
    const api = stub([alice], {
      links: {
        [OID_A]: {
          usageIdentities: ["alice@company.com"],
          aliases: ["alice-old"],
          litellmUserId: "u-alice",
          version: 4,
        },
      },
    });
    renderWithProviders(<IdentityLinkSuggestions isAdmin />);
    const user = userEvent.setup();
    await screen.findByText("alice-sso");
    await user.click(
      screen.getByRole("button", { name: "Confirm link alice-sso" }),
    );
    await waitFor(() => expect(api.puts()).toHaveLength(1));
    expect(api.puts()[0]?.body).toMatchObject({
      usageIdentities: ["alice@company.com"],
      aliases: ["alice-old", "alice-sso"],
      litellmUserId: "u-alice",
      version: 4,
    });
  });

  it("a duplicate claim (409 CONFLICT) names the key in an alert, keeps the suggestion and reloads", async () => {
    const api = stub([alice, bob], {
      putResult: () =>
        apiError(409, "CONFLICT", "That key already belongs to someone else"),
    });
    renderWithProviders(<IdentityLinkSuggestions isAdmin />);
    const user = userEvent.setup();
    await screen.findByText("alice-sso");
    await user.click(
      screen.getByRole("button", { name: "Confirm link alice-sso" }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/alice-sso/);
    expect(alert).toHaveTextContent(/already belongs to someone else/);
    expect(screen.getByText("alice-sso")).toBeVisible();
    await waitFor(() => expect(api.listFetches()).toBeGreaterThanOrEqual(2));
  });

  it("surfaces a 403 FORBIDDEN message", async () => {
    stub([alice], {
      putResult: () =>
        apiError(403, "FORBIDDEN", "internal-admin role required"),
    });
    renderWithProviders(<IdentityLinkSuggestions isAdmin />);
    const user = userEvent.setup();
    await screen.findByText("alice-sso");
    await user.click(
      screen.getByRole("button", { name: "Confirm link alice-sso" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /internal-admin role required/,
    );
  });

  it("shows a generic readable message, not raw parser text, for a non-JSON error body", async () => {
    stub([alice], {
      putResult: () =>
        new Response("<html>", {
          status: 500,
          headers: { "content-type": "text/html" },
        }),
    });
    renderWithProviders(<IdentityLinkSuggestions isAdmin />);
    const user = userEvent.setup();
    await screen.findByText("alice-sso");
    await user.click(
      screen.getByRole("button", { name: "Confirm link alice-sso" }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/request failed/i);
    expect(alert).not.toHaveTextContent(/JSON|Unexpected token|<html>/i);
  });
});

describe("IdentityLinkSuggestions -- confirm all for one rule", () => {
  it("links every suggestion of that rule only, one PUT each", async () => {
    const api = stub([alice, bob, aliceSvc]);
    renderWithProviders(<IdentityLinkSuggestions isAdmin />);
    const user = userEvent.setup();
    await screen.findByText("alice-sso");
    await user.click(
      screen.getByRole("button", { name: "Confirm all for {name}-sso" }),
    );

    await waitFor(() => expect(api.puts()).toHaveLength(2));
    expect(
      api
        .puts()
        .map((p) => p.path)
        .sort(),
    ).toEqual([
      `/api/identities/${OID_A}/links`,
      `/api/identities/${OID_B}/links`,
    ]);
    expect(
      api
        .puts()
        .flatMap((p) => p.body.aliases as string[])
        .sort(),
    ).toEqual(["alice-sso", "bob-sso"]);
    await waitFor(() =>
      expect(screen.queryByText("bob-sso")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("svc-alice")).toBeVisible();
  });

  it("two keys for the same person: the second PUT re-reads the link, so it carries both aliases at the new version", async () => {
    const second: Suggestion = {
      ...alice,
      usageKey: "alice-sso-2",
    };
    const api = stub([alice, second]);
    renderWithProviders(<IdentityLinkSuggestions isAdmin />);
    const user = userEvent.setup();
    await screen.findByText("alice-sso");
    await user.click(
      screen.getByRole("button", { name: "Confirm all for {name}-sso" }),
    );
    await waitFor(() => expect(api.puts()).toHaveLength(2));
    expect(api.puts()[0]?.body).toMatchObject({
      aliases: ["alice-sso"],
      version: 0,
    });
    expect(api.puts()[1]?.body).toMatchObject({
      aliases: ["alice-sso", "alice-sso-2"],
      version: 1,
    });
  });

  it("a failure names the key that failed in an alert and the list reloads (nothing fails silently)", async () => {
    const api = stub([alice, bob], {
      putResult: (put) =>
        put.path.includes(OID_B)
          ? apiError(
              409,
              "CONFLICT",
              "That key already belongs to someone else",
            )
          : undefined,
    });
    renderWithProviders(<IdentityLinkSuggestions isAdmin />);
    const user = userEvent.setup();
    await screen.findByText("alice-sso");
    await user.click(
      screen.getByRole("button", { name: "Confirm all for {name}-sso" }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/bob-sso/);
    await waitFor(() => expect(api.listFetches()).toBeGreaterThanOrEqual(2));
    expect(screen.getByText("bob-sso")).toBeVisible();
  });
});
