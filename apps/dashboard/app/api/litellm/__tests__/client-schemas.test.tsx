import {
  LiteLLMOrgResponseSchema,
  LiteLLMProxyTeamMembersResponseSchema,
  LiteLLMUserDetailResponseSchema,
  LiteLLMUserSearchResponseSchema,
  UsersListResponseSchema,
} from "@llm-usage-lens/shared";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import { UserSearch } from "@/components/litellm/UserSearch";
import { LiteLLMUsersList } from "@/components/manage/users/LiteLLMUsersList";
import { apiError, apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

// Source: Design System - Management pages, LiteLLM users tab, D-LF1 (one
// response schema per route response, exported from packages/shared and parsed
// by both the route and the client, Rule 10.4 and Rule 20.11) and T-LF2 ("a
// contract test fails when a client schema differs from its route's"). Items
// 2 and 3 were a client parsing a route's answer with another schema. The
// expected schema per request is the one the route parses its answer with:
// app/api/litellm/users/route.ts (list for no q or team=, search for q),
// users/[litellmUserId]/route.ts, proxy-teams/[litellmTeamId]/members/route.ts
// and org/route.ts; each route's own test proves it answers that shape.
const seen = vi.hoisted(() => [] as Array<{ path: string; schema: z.ZodType }>);
vi.mock("@/lib/query/fetch-api", async (original) => {
  const mod = await original<typeof import("@/lib/query/fetch-api")>();
  return {
    ...mod,
    fetchApi: (path: string, schema: z.ZodType) => {
      seen.push({ path, schema });
      return mod.fetchApi(path, schema);
    },
  };
});
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

const ADA = {
  key: "oid-ada",
  linkState: "linked",
  appUser: {
    oid: "oid-ada",
    displayName: "Ada Lovelace",
    email: "ada@example.com",
    version: 1,
  },
  litellmUser: {
    userId: "ll-ada",
    email: "ada@example.com",
    spend: 1,
    maxBudget: null,
    teams: [],
  },
};

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname;
      const base = { page: 1, pageSize: 25, enabledOperations: [] };
      if (path === "/api/me") return Promise.resolve(apiError(401));
      if (path === "/api/access/org-units") {
        return Promise.resolve(
          apiResponse({ data: { departments: [], teams: [] } }),
        );
      }
      if (path === "/api/litellm/org") {
        return Promise.resolve(
          apiResponse({
            data: {
              configured: true,
              totals: { spend: 1 },
              daily: [],
              litellmTeams: [
                {
                  litellmTeamId: "ll-team-alpha",
                  alias: "Alpha",
                  spend: 1,
                  maxBudget: null,
                  memberCount: 1,
                  linkedAppTeam: { teamId: "team-a", teamName: "Team A" },
                },
                {
                  litellmTeamId: "ll-team-shared",
                  alias: "Shared platform",
                  spend: 1,
                  maxBudget: null,
                  memberCount: 1,
                  linkedAppTeam: null,
                },
              ],
              appTeams: [],
              enabledOperations: [],
            },
          }),
        );
      }
      if (path.startsWith("/api/litellm/proxy-teams/")) {
        return Promise.resolve(
          apiResponse({
            data: {
              litellmTeamId: "ll-team-shared",
              ...base,
              items: [],
            },
          }),
        );
      }
      if (path === "/api/litellm/users") {
        const search =
          url.searchParams.has("q") && !url.searchParams.has("team");
        return Promise.resolve(
          apiResponse({
            data: search
              ? {
                  ...base,
                  users: [
                    {
                      userId: "ll-ada",
                      email: "ada@example.com",
                      spend: 1,
                      maxBudget: null,
                      teams: [],
                    },
                  ],
                }
              : { ...base, hasMore: false, users: [ADA] },
          }),
        );
      }
      return Promise.resolve(
        apiResponse({
          data: {
            userId: "ll-ada",
            email: "ada@example.com",
            enabledOperations: [],
          },
        }),
      );
    }),
  );
}

const asked = (match: (url: URL) => boolean) =>
  seen.filter((s) => match(new URL(s.path, "http://localhost")));
const userList = (url: URL) => url.pathname === "/api/litellm/users";

afterEach(() => {
  seen.length = 0;
  vi.unstubAllGlobals();
});

describe("LiteLLM clients parse each route's answer with the schema that route exports (D-LF1, T-LF2)", () => {
  it("LiteLLMUsersList: the list, the search and the detail", async () => {
    stubFetch();
    const user = userEvent.setup();
    renderWithProviders(<LiteLLMUsersList />);

    await user.click(
      await screen.findByRole("button", { name: "Ada Lovelace" }),
    );
    await screen.findByRole("heading", { name: "User usage" });
    await user.type(
      screen.getByRole("searchbox", { name: /search users/i }),
      "ad",
    );
    await vi.waitFor(
      () =>
        expect(
          asked((u) => userList(u) && u.searchParams.has("q")),
        ).not.toHaveLength(0),
      { timeout: 3000 },
    );

    const schemaOf = (match: (url: URL) => boolean) =>
      new Set(asked(match).map((s) => s.schema));
    expect(schemaOf((u) => userList(u) && !u.searchParams.has("q"))).toEqual(
      new Set([UsersListResponseSchema]),
    );
    expect(schemaOf((u) => userList(u) && u.searchParams.has("q"))).toEqual(
      new Set([LiteLLMUserSearchResponseSchema]),
    );
    expect(schemaOf((u) => u.pathname === "/api/litellm/users/ll-ada")).toEqual(
      new Set([LiteLLMUserDetailResponseSchema]),
    );
  });

  it("LiteLLMUsersList team picker: the org team list, ?team= and the proxy-team members", async () => {
    stubFetch();
    const user = userEvent.setup();
    renderWithProviders(<LiteLLMUsersList />);
    await screen.findByText("Ada Lovelace");
    await user.click(
      screen.getByRole("radio", { name: "Members of one team" }),
    );
    const picker = await screen.findByLabelText("Team");
    await user.selectOptions(picker, "Alpha");
    await user.selectOptions(picker, "Shared platform");
    await vi.waitFor(() =>
      expect(
        asked((u) => u.pathname.startsWith("/api/litellm/proxy-teams/")),
      ).not.toHaveLength(0),
    );

    const schemaOf = (match: (url: URL) => boolean) =>
      new Set(asked(match).map((s) => s.schema));
    expect(schemaOf((u) => userList(u) && u.searchParams.has("team"))).toEqual(
      new Set([UsersListResponseSchema]),
    );
    expect(schemaOf((u) => u.pathname === "/api/litellm/org")).toEqual(
      new Set([LiteLLMOrgResponseSchema]),
    );
    expect(
      schemaOf((u) => u.pathname.startsWith("/api/litellm/proxy-teams/")),
    ).toEqual(new Set([LiteLLMProxyTeamMembersResponseSchema]));
  });

  it("UserSearch: the search and the detail", async () => {
    stubFetch();
    const user = userEvent.setup();
    renderWithProviders(<UserSearch />);
    await user.type(
      screen.getByRole("searchbox", { name: /search users/i }),
      "ad",
    );
    await user.click(
      await screen.findByRole(
        "button",
        { name: "ada@example.com" },
        { timeout: 3000 },
      ),
    );
    await screen.findByRole("heading", { name: "User usage" });
    expect(new Set(asked(userList).map((s) => s.schema))).toEqual(
      new Set([LiteLLMUserSearchResponseSchema]),
    );
    expect(
      new Set(
        asked((u) => u.pathname === "/api/litellm/users/ll-ada").map(
          (s) => s.schema,
        ),
      ),
    ).toEqual(new Set([LiteLLMUserDetailResponseSchema]));
  });
});
