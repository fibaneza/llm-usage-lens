import type { BrowserContext } from "@playwright/test";

// Test-only (Rule 60.24: no real LiteLLM). Cost by team, Cost by user and Cost
// by service read LiteLLM through three routes (Design System - Source panels,
// M5): the combined organisation figure, the Organisation read and the LiteLLM
// users list. With a stored but unreachable connection each answers 503 and
// the browser logs a console error, so specs about the shell or a Bedrock
// table answer the quiet shapes:
//   - /api/litellm/combined/*   the hidden head (combined.ts)
//   - /api/litellm/org          not configured (litellm-views.ts)
//   - /api/litellm/users        an empty page
export async function stubUsageSourceReads(
  context: BrowserContext,
): Promise<void> {
  await context.route(/\/api\/litellm\/combined\//, (route) =>
    route.fulfill({
      json: {
        data: {
          visibility: "hidden",
          configured: true,
          gatewayConfigured: false,
        },
      },
    }),
  );
  await context.route(/\/api\/litellm\/org(\?|$)/, (route) =>
    route.fulfill({
      json: {
        data: {
          configured: false,
          totals: { spend: 0 },
          daily: [],
          litellmTeams: [],
          appTeams: [],
          enabledOperations: [],
        },
      },
    }),
  );
  await context.route(/\/api\/litellm\/users(\?|$)/, (route) =>
    route.fulfill({
      json: {
        data: { users: [], page: 1, pageSize: 25, enabledOperations: [] },
      },
    }),
  );
}
