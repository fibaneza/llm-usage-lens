// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import { Suspense, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BudgetLimitsPanel } from "@/components/litellm/team/BudgetLimitsPanel";
import { KeysPanel } from "@/components/litellm/team/KeysPanel";
import { MembersPanel } from "@/components/litellm/team/MembersPanel";
import { ModelsPanel } from "@/components/litellm/team/ModelsPanel";
import { ProxyTeamPageContent } from "@/components/litellm/proxy-team/ProxyTeamPageContent";
import { ProxyUserPageContent } from "@/components/litellm/proxy-user/ProxyUserPageContent";
import { TeamSpendPanel } from "@/components/manage/TeamSpendPanel";

// LiteLLM spec - Design System integration notes, "No server-side fetch of
// /api/*": a client component that renders during SSR must not run a relative
// fetch (it cannot resolve on the server). Rule 60.8, 60.9 (server data comes
// from Server Components, client reads happen in the browser) and Rule 40.4
// (one failing section must not break the page).
const capabilities = { canRaiseLimits: true };

const surfaces: [string, () => ReactElement][] = [
  [
    "LiteLLM user page (LP2: summary, daily, teams, link panels)",
    () => (
      <ProxyUserPageContent litellmUserId="ll-ada" canWrite ownOid={null} />
    ),
  ],
  [
    "LiteLLM team page (LP1: summary, members, link panels)",
    () => <ProxyTeamPageContent litellmTeamId="ll-t1" canReset />,
  ],
  [
    "team panel: Members",
    () => <MembersPanel teamId="t1" capabilities={capabilities} />,
  ],
  [
    "team panel: Keys",
    () => <KeysPanel teamId="t1" capabilities={capabilities} />,
  ],
  [
    "team panel: Models",
    () => <ModelsPanel teamId="t1" capabilities={capabilities} />,
  ],
  [
    "team panel: Budget and limits",
    () => <BudgetLimitsPanel teamId="t1" capabilities={capabilities} />,
  ],
  [
    "team spend panel (already gated; control)",
    () => <TeamSpendPanel teamId="t1" includeMemberSum={false} />,
  ],
];

describe("LiteLLM client sections during server rendering", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn(() =>
      Promise.reject(new TypeError("Failed to parse URL from a relative path")),
    );
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(surfaces)("%s: no fetch and no throw in SSR", (_name, build) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const Nuqs = withNuqsTestingAdapter({ searchParams: {} });
    expect(() =>
      renderToString(
        <QueryClientProvider client={client}>
          <Nuqs>
            <Suspense fallback={null}>{build()}</Suspense>
          </Nuqs>
        </QueryClientProvider>,
      ),
    ).not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
