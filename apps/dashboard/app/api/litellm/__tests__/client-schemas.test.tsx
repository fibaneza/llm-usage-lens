import {
  BedrockGatewayViewSchema,
  CombinedMeResponseSchema,
  CombinedOrganisationResponseSchema,
  CombinedTeamResponseSchema,
  CombinedTeamsResponseSchema,
  DateRangeQuerySchema,
  LiteLLMAuditResponseSchema,
  LiteLLMConnectionStatusSchema,
  LiteLLMMeResponseSchema,
  LiteLLMMembersResponseSchema,
  LiteLLMModelsResponseSchema,
  LiteLLMOrgResponseSchema,
  LiteLLMProxyTeamResponseSchema,
  LiteLLMTeamDetailResponseSchema,
  LiteLLMUserMembershipsResponseSchema,
  OperationTogglesViewSchema,
  OrgUnitsResponseSchema,
  LiteLLMProxyTeamMembersResponseSchema,
  LiteLLMUserDetailResponseSchema,
  LiteLLMUserSearchResponseSchema,
  PendingLinksPageSchema,
  TeamLinkSchema,
  UsersListResponseSchema,
} from "@llm-usage-lens/shared";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Component, Suspense, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AuditSection } from "@/components/litellm/AuditSection";
import { useCombinedOrganisation } from "@/components/litellm/combined/use-combined-query";
import { OrganisationSection } from "@/components/litellm/OrganisationSection";
import { ResetMemberSpendDialog } from "@/components/litellm/ResetMemberSpendDialog";
import { useProxyTeam } from "@/components/litellm/proxy-team/use-proxy-team";
import { MembersPanel } from "@/components/litellm/team/MembersPanel";
import { ModelsPanel } from "@/components/litellm/team/ModelsPanel";
import { useMeQuery } from "@/components/litellm/use-me-query";
import {
  useTeamDetailState,
  useTeamSpendDetail,
} from "@/components/litellm/use-team-detail";
import { TeamSpendPanel } from "@/components/manage/TeamSpendPanel";
import { UserLiteLLMUsagePanel } from "@/components/manage/users/detail/UserLiteLLMUsagePanel";
import { LiteLLMLinkCell } from "@/components/manage/users/LiteLLMLinkCell";
import { UsersPeoplePanel } from "@/components/manage/users/UsersPeoplePanel";
import { LiteLLMConnectionSection } from "@/components/settings/litellm-panel/LiteLLMConnectionSection";
import { LiteLLMGatewaySection } from "@/components/settings/litellm-panel/LiteLLMGatewaySection";
import { LiteLLMGuardrailsSection } from "@/components/settings/litellm-panel/LiteLLMGuardrailsSection";
import { LiteLLMTeamLinksSection } from "@/components/settings/litellm-panel/LiteLLMTeamLinksSection";
import { LiteLLMTeamMembersPanel } from "@/components/settings/litellm-panel/LiteLLMTeamMembersPanel";
import { LiteLLMUsersSection } from "@/components/settings/litellm-panel/LiteLLMUsersSection";
import { TeamsLiteLLMPanel } from "@/components/teams/TeamsLiteLLMPanel";
import { TeamSumOfMembers } from "@/components/teams/TeamSumOfMembers";
import { UsersLiteLLMPanel } from "@/components/users/UsersLiteLLMPanel";
import { IdParamSchema } from "@/lib/api/id-param";
import { UserSearch } from "@/components/litellm/UserSearch";
import { PendingLinksList } from "@/components/manage/users/PendingLinksList";
import { LiteLLMUsersList } from "@/components/manage/users/LiteLLMUsersList";
import {
  apiError,
  apiResponse,
  DEFAULT_COMBINED_BODY,
  DEFAULT_LITELLM_ORG_BODY,
  DEFAULT_ORG_UNITS_BODY,
  defaultLiteLLMUsersBody,
} from "@/test/fakes/api-stubs";
import { PROXY_TEAM } from "@/test/fixtures/proxy-team";
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
      if (/^\/api\/litellm\/proxy-teams\/[^/]+$/.test(path)) {
        return Promise.resolve(apiResponse({ data: PROXY_TEAM }));
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

  // Rule 10.4 / D-LF1: GET /api/identities/pending-links is parsed with the
  // shared page schema, not a component-local copy (SYNC1, Green C finding 4).
  it("PendingLinksList: the pending-links page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(apiResponse({ data: { items: [] } }))),
    );
    renderWithProviders(<PendingLinksList canRemove />);
    await screen.findByRole("region", { name: "Not signed in yet" });
    expect(
      new Set(
        asked((u) => u.pathname === "/api/identities/pending-links").map(
          (s) => s.schema,
        ),
      ),
    ).toEqual(new Set([PendingLinksPageSchema]));
  });
});

// ---- T-FX4 ------------------------------------------------------------------
// Design System - LiteLLM client requests (unit FX1; D-R3-16, D-R3-18), T-FX4:
// for every component request to /api/litellm/** the query parses with the
// route's query schema and the client's schema is the route's answer schema
// for that query; a component that requests /api/litellm/** and is not listed
// below fails the structural case. One row per caller file: a completeness
// matrix (every caller is named), not a table of input classes.
const RANGE = { dateFrom: "2026-10-01", dateTo: "2026-10-31" };
const DASHBOARD = join(__dirname, "../../../..");

// The route's own query schemas. UsersQuerySchema is not exported by
// app/api/litellm/users/route.ts (a route module may export only handlers);
// this mirrors it field for field.
const UsersQuerySchema = z.object({
  q: z.string().trim().min(2).max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(25).optional(),
  team: IdParamSchema.optional(),
  sort: z.enum(["email", "spend"]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
});
const IncludeQuerySchema = z.object({
  include: z.literal("memberSum").optional(),
});
// AuditQuerySchema (lib/litellm/read-views.ts) cannot be imported here: the
// module pulls in next-auth. Mirrored for the fields the client sends.
const AuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  dir: z.enum(["asc", "desc"]).default("desc"),
});
const NoQuery = z.object({});

// T-FX4(b): the client schema is the route's answer schema (identity), or a
// narrower projection that parses a route-valid answer (agent decision, FX1):
// `fixture` must pass the route's schema and the client's schema.
type Answer = { route: z.ZodType; fixture?: unknown };
type RouteContract = {
  pattern: RegExp;
  query: (url: URL) => z.ZodType[];
  answer: (url: URL) => z.ZodType | Answer;
};

// The route's answer for GET /api/litellm/connection (route.ts: status()).
const CONNECTION_FIXTURE = {
  baseUrl: "https://litellm.example.com",
  version: 1,
  edition: "oss",
  serviceKeyConfigured: true,
  defaultBaseUrl: "https://litellm.example.com",
};
// app/api/litellm/team-links/route.ts has no exported answer schema (a route
// module exports only handlers); this mirrors its jsonData({ items, appTeams,
// ...litellm }) field for field, items by the shared TeamLinkSchema.
const TeamLinksRouteAnswerSchema = z.intersection(
  z.object({
    items: z.array(TeamLinkSchema),
    appTeams: z.array(
      z.object({
        teamId: z.string(),
        teamName: z.string(),
        spendSource: z.enum(["litellm-team", "member-sum"]),
      }),
    ),
  }),
  z.union([
    z.object({ configured: z.literal(false) }),
    z.object({
      configured: z.literal(true),
      litellmTeams: z.array(
        z.object({ litellmTeamId: z.string(), alias: z.string() }),
      ),
    }),
    z.object({
      configured: z.literal(true),
      litellmTeamsUnavailable: z.literal(true),
    }),
  ]),
);
const TEAM_LINKS_FIXTURE = {
  items: [
    {
      teamId: "team-a",
      litellmTeamId: "ll-team-alpha",
      version: 1,
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
  ],
  appTeams: [
    { teamId: "team-a", teamName: "Team A", spendSource: "litellm-team" },
  ],
  configured: true,
  litellmTeams: [{ litellmTeamId: "ll-team-alpha", alias: "Alpha" }],
};
// The list answer (no q, D-LF1) any caller of GET /api/litellm/users without q
// may project; rows are the list shape, not the search shape.
const USERS_LIST_FIXTURE = {
  page: 1,
  pageSize: 25,
  enabledOperations: ["createUser"],
  hasMore: false,
  users: [ADA],
};
const rangeQuery = () => [DateRangeQuerySchema, IncludeQuerySchema];
const ROUTES: RouteContract[] = [
  {
    pattern: /^\/api\/litellm\/users$/,
    query: () => [UsersQuerySchema],
    // users/route.ts: the search shape for q without team, the list otherwise.
    answer: (url) =>
      url.searchParams.has("q") && !url.searchParams.has("team")
        ? LiteLLMUserSearchResponseSchema
        : { route: UsersListResponseSchema, fixture: USERS_LIST_FIXTURE },
  },
  {
    pattern: /^\/api\/litellm\/users\/[^/]+$/,
    query: rangeQuery,
    answer: () => LiteLLMUserDetailResponseSchema,
  },
  {
    pattern: /^\/api\/litellm\/users\/[^/]+\/memberships$/,
    query: () => [NoQuery],
    answer: () => LiteLLMUserMembershipsResponseSchema,
  },
  {
    pattern: /^\/api\/litellm\/org$/,
    query: rangeQuery,
    answer: () => LiteLLMOrgResponseSchema,
  },
  {
    pattern: /^\/api\/litellm\/teams\/[^/]+$/,
    query: rangeQuery,
    answer: () => LiteLLMTeamDetailResponseSchema,
  },
  {
    pattern: /^\/api\/litellm\/teams\/[^/]+\/members$/,
    query: () => [NoQuery],
    answer: () => LiteLLMMembersResponseSchema,
  },
  // LP1, T-LP3/T-LP4: the LiteLLM team page's read.
  {
    pattern: /^\/api\/litellm\/proxy-teams\/[^/]+$/,
    query: () => [NoQuery],
    answer: () => LiteLLMProxyTeamResponseSchema,
  },
  {
    pattern: /^\/api\/litellm\/proxy-teams\/[^/]+\/members$/,
    query: () => [NoQuery],
    answer: () => LiteLLMProxyTeamMembersResponseSchema,
  },
  {
    pattern: /^\/api\/litellm\/me$/,
    query: () => [DateRangeQuerySchema],
    answer: () => LiteLLMMeResponseSchema,
  },
  {
    pattern: /^\/api\/litellm\/audit$/,
    query: () => [DateRangeQuerySchema, AuditQuerySchema],
    answer: () => LiteLLMAuditResponseSchema,
  },
  {
    pattern: /^\/api\/litellm\/combined\/organisation$/,
    query: () => [DateRangeQuerySchema],
    answer: () => CombinedOrganisationResponseSchema,
  },
  {
    pattern: /^\/api\/litellm\/models$/,
    query: () => [NoQuery],
    answer: () => LiteLLMModelsResponseSchema,
  },
  {
    pattern: /^\/api\/litellm\/gateway$/,
    query: () => [NoQuery],
    answer: () => BedrockGatewayViewSchema,
  },
  {
    pattern: /^\/api\/litellm\/toggles$/,
    query: () => [NoQuery],
    answer: () => OperationTogglesViewSchema,
  },
  {
    pattern: /^\/api\/litellm\/connection$/,
    query: () => [NoQuery],
    answer: () => ({
      route: LiteLLMConnectionStatusSchema,
      fixture: CONNECTION_FIXTURE,
    }),
  },
  {
    pattern: /^\/api\/litellm\/team-links$/,
    query: () => [NoQuery],
    answer: () => ({
      route: TeamLinksRouteAnswerSchema,
      fixture: TEAM_LINKS_FIXTURE,
    }),
  },
];

const TEAM_DETAIL = {
  connected: true,
  spendSource: "litellm-team",
  team: {
    alias: "Payments",
    spend: 1,
    maxBudget: null,
    softBudget: null,
    budgetDuration: null,
    models: ["claude-sonnet"],
    rpmLimit: null,
    tpmLimit: null,
  },
  daily: [],
  enabledOperations: ["getUserDailySpend"],
};
const TEAM_MEMBERS = {
  connected: true,
  candidates: [],
  items: [
    {
      userId: "u-ada",
      oid: "ada",
      name: "Ada Lovelace",
      email: "ada@example.test",
      spend: 1,
      maxBudget: null,
      rpmLimit: null,
      tpmLimit: null,
    },
  ],
};

function stubContract() {
  stubFetch();
  const base = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (path === "/api/litellm/teams/t1") {
      return Promise.resolve(apiResponse({ data: TEAM_DETAIL }));
    }
    if (path === "/api/litellm/teams/t1/members") {
      return Promise.resolve(apiResponse({ data: TEAM_MEMBERS }));
    }
    if (path === "/api/litellm/models") {
      return Promise.resolve(
        apiResponse({ data: { items: ["claude-sonnet"] } }),
      );
    }
    return base(input, init);
  });
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}
const harness = (node: ReactElement) => (
  <Boundary>
    <Suspense fallback={null}>{node}</Suspense>
  </Boundary>
);
function Probe({ use }: { use: () => unknown }) {
  use();
  return null;
}

type Driver = (user: ReturnType<typeof userEvent.setup>) => Promise<void>;
type Caller = {
  file: string;
  ui: ReactElement | null;
  // Paths (and a query predicate) the caller must have requested, so a caller
  // that silently stops asking cannot pass.
  expects: Array<(url: URL) => boolean>;
  drive?: Driver;
};
const at = (path: RegExp, has?: string) => (url: URL) =>
  path.test(url.pathname) && (has === undefined || url.search.includes(has));

const CALLERS: Caller[] = [
  {
    file: "components/litellm/AuditSection.tsx",
    ui: <AuditSection />,
    expects: [at(/\/audit$/)],
  },
  {
    file: "components/litellm/combined/use-combined-query.ts",
    ui: <Probe use={() => useCombinedOrganisation(RANGE)} />,
    expects: [at(/combined\/organisation$/)],
  },
  {
    file: "components/litellm/OrganisationSection.tsx",
    ui: <OrganisationSection />,
    expects: [at(/\/org$/)],
  },
  {
    file: "components/litellm/ResetMemberSpendDialog.tsx",
    ui: (
      <ResetMemberSpendDialog
        litellmUserId="ll-ada"
        name="Ada Lovelace"
        userReset
      />
    ),
    expects: [at(/users\/ll-ada\/memberships$/)],
    drive: async (user) => {
      await user.click(
        screen.getByRole("button", { name: "Reset spend for Ada Lovelace" }),
      );
    },
  },
  {
    file: "components/litellm/team/MembersPanel.tsx",
    ui: <MembersPanel teamId="t1" capabilities={{ canRaiseLimits: false }} />,
    expects: [at(/teams\/t1\/members$/), at(/users\/u-ada$/)],
    drive: async (user) => {
      await user.click(
        await screen.findByRole("button", {
          name: "Daily spend for Ada Lovelace",
        }),
      );
    },
  },
  {
    file: "components/litellm/team/ModelsPanel.tsx",
    ui: <ModelsPanel teamId="t1" capabilities={{ canRaiseLimits: false }} />,
    expects: [at(/teams\/t1$/), at(/\/models$/)],
  },
  {
    file: "components/litellm/proxy-team/use-proxy-team.ts",
    ui: <Probe use={() => useProxyTeam("ll-team-shared")} />,
    expects: [at(/proxy-teams\/ll-team-shared$/)],
  },
  {
    file: "components/litellm/use-me-query.ts",
    ui: <Probe use={useMeQuery} />,
    expects: [at(/\/me$/)],
  },
  {
    file: "components/litellm/use-team-detail.ts",
    ui: (
      <>
        <Probe use={() => useTeamDetailState("t1")} />
        <Probe use={() => useTeamSpendDetail("t1")} />
      </>
    ),
    expects: [at(/teams\/t1$/), at(/teams\/t1$/, "include=memberSum")],
  },
  {
    file: "components/litellm/UserSearch.tsx",
    ui: <UserSearch />,
    expects: [at(/\/users$/, "q="), at(/users\/ll-ada$/)],
    drive: async (user) => {
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
    },
  },
  {
    file: "components/manage/TeamSpendPanel.tsx",
    ui: <TeamSpendPanel teamId="t1" includeMemberSum />,
    expects: [at(/teams\/t1$/, "include=memberSum")],
  },
  {
    file: "components/manage/users/detail/UserLiteLLMUsagePanel.tsx",
    ui: <UserLiteLLMUsagePanel litellmUserId="ll-ada" />,
    expects: [at(/users\/ll-ada$/)],
  },
  {
    file: "components/manage/users/LiteLLMLinkCell.tsx",
    ui: (
      <LiteLLMLinkCell
        subject={{
          oid: "oid-ada",
          name: "Ada",
          email: "ada@example.com",
          version: 1,
        }}
        link={{ state: "none" }}
        canWrite
        canCreate
        onChanged={() => {}}
      />
    ),
    expects: [at(/\/users$/, "q=")],
    drive: async (user) => {
      await user.click(
        screen.getByRole("button", {
          name: "Link to an existing LiteLLM user",
        }),
      );
      const dialog = await screen.findByRole("dialog");
      await user.type(dialog.querySelector("input") as HTMLInputElement, "ada");
    },
  },
  {
    file: "components/manage/users/LiteLLMUsersList.tsx",
    ui: <LiteLLMUsersList canReset />,
    expects: [
      at(/\/users$/),
      at(/\/users$/, "q="),
      at(/\/org$/),
      at(/users\/ll-ada$/),
      at(/proxy-teams\/ll-team-shared\/members$/),
    ],
    drive: async (user) => {
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
      await user.click(
        screen.getByRole("radio", { name: "Members of one team" }),
      );
      const picker = await screen.findByLabelText("Team");
      await user.selectOptions(picker, "Shared platform");
    },
  },
  {
    file: "components/manage/users/UsersPeoplePanel.tsx",
    ui: (
      <UsersPeoplePanel
        steps={{ password: true, team: true, link: true }}
        ownOid="oid-me"
        authMethod="entra"
        stepUp={{ entra: vi.fn(), credentials: vi.fn(), devLogin: vi.fn() }}
      />
    ),
    expects: [at(/\/users$/, "pageSize=1")],
  },
  {
    file: "components/settings/litellm-panel/LiteLLMConnectionSection.tsx",
    ui: <LiteLLMConnectionSection canEdit />,
    expects: [at(/\/connection$/)],
  },
  {
    file: "components/settings/litellm-panel/LiteLLMGatewaySection.tsx",
    ui: <LiteLLMGatewaySection canEdit />,
    expects: [at(/\/gateway$/)],
  },
  {
    file: "components/settings/litellm-panel/LiteLLMGuardrailsSection.tsx",
    ui: <LiteLLMGuardrailsSection canEdit />,
    expects: [at(/\/toggles$/)],
  },
  {
    file: "components/settings/litellm-panel/LiteLLMTeamLinksSection.tsx",
    ui: <LiteLLMTeamLinksSection canEdit />,
    expects: [at(/\/team-links$/)],
  },
  {
    file: "components/settings/litellm-panel/LiteLLMTeamMembersPanel.tsx",
    ui: (
      <LiteLLMTeamMembersPanel
        litellmTeamId="ll-111"
        teamName="Alpha"
        canReset={false}
      />
    ),
    expects: [at(/proxy-teams\/ll-111\/members$/)],
  },
  {
    file: "components/settings/litellm-panel/LiteLLMUsersSection.tsx",
    ui: <LiteLLMUsersSection />,
    expects: [at(/\/team-links$/)],
  },
  {
    file: "components/teams/TeamsLiteLLMPanel.tsx",
    ui: <TeamsLiteLLMPanel range={RANGE} />,
    expects: [at(/\/org$/)],
  },
  {
    file: "components/teams/TeamSumOfMembers.tsx",
    ui: (
      <TeamSumOfMembers teamId="t1" teamName="Payments" range={RANGE} linked />
    ),
    expects: [at(/teams\/t1$/, "include=memberSum")],
    drive: async (user) => {
      await user.click(
        screen.getByRole("button", { name: "Sum of members for Payments" }),
      );
    },
  },
  {
    file: "components/users/UsersLiteLLMPanel.tsx",
    ui: <UsersLiteLLMPanel />,
    expects: [at(/\/users$/, "page=1")],
  },
];

// These only write (mutateApi, no GET), so there is no query or answer schema
// to compare; they are named so the structural case stays complete.
const WRITES_ONLY = [
  "components/litellm/team/use-team-write.ts",
  "components/settings/litellm-panel/TeamLinkForm.tsx",
  "components/settings/litellm-panel/TeamLinkNewTeamForm.tsx",
  "components/settings/litellm-panel/TeamLinkRow.tsx",
];

function sourcesRequestingLiteLLM(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "api" && dir.endsWith("app")) continue;
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(full);
      } else if (
        /\.tsx?$/.test(entry.name) &&
        !/\.(test|spec)\.tsx?$/.test(entry.name) &&
        readFileSync(full, "utf8").includes("/api/litellm/")
      ) {
        found.push(relative(DASHBOARD, full));
      }
    }
  };
  walk(join(DASHBOARD, "components"));
  walk(join(DASHBOARD, "app"));
  return found.sort();
}

describe("T-FX4: every LiteLLM client request matches its route (Design System - LiteLLM client requests)", () => {
  it("T-FX4 structural: a component that requests /api/litellm/** and is not covered fails", () => {
    const covered = new Set([...CALLERS.map((c) => c.file), ...WRITES_ONLY]);
    expect(sourcesRequestingLiteLLM().filter((f) => !covered.has(f))).toEqual(
      [],
    );
  });

  it.each(CALLERS.map((c) => [c.file, c] as const))(
    "T-FX4: %s asks with the route's query and parses with the route's answer schema",
    async (_file, caller) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      stubContract();
      const user = userEvent.setup();
      renderWithProviders(harness(caller.ui as ReactElement), {
        searchParams: RANGE,
      });
      await caller.drive?.(user);
      const sent = () => seen.filter((s) => s.path.startsWith("/api/litellm/"));
      for (const [index, wanted] of caller.expects.entries()) {
        await vi.waitFor(
          () =>
            expect(
              sent().some((s) => wanted(new URL(s.path, "http://localhost"))),
              `the caller never made expected request #${index}; saw ${sent()
                .map((s) => s.path)
                .join(", ")}`,
            ).toBe(true),
          { timeout: 4000 },
        );
      }

      for (const request of sent()) {
        const url = new URL(request.path, "http://localhost");
        const route = ROUTES.find((r) => r.pattern.test(url.pathname));
        expect(route, `no route contract for ${url.pathname}`).toBeDefined();
        if (!route) continue;
        const query = Object.fromEntries(url.searchParams);
        const parsed = route
          .query(url)
          .map((schema) => schema.safeParse(query).success);
        expect(parsed, `query of ${request.path}`).not.toContain(false);
        const answer = route.answer(url);
        if (
          request.schema ===
          (answer instanceof z.ZodType ? answer : answer.route)
        ) {
          continue;
        }
        const { route: routeAnswer, fixture } =
          answer instanceof z.ZodType
            ? { route: answer, fixture: undefined }
            : answer;
        expect(
          fixture,
          `answer schema of ${request.path} is not the route's and has no fixture`,
        ).toBeDefined();
        expect(
          routeAnswer.safeParse(fixture).success,
          `fixture is a route-valid answer for ${request.path}`,
        ).toBe(true);
        expect(
          request.schema.safeParse(fixture).success,
          `client schema of ${request.path} rejects a route-valid answer`,
        ).toBe(true);
      }
    },
  );
});

// T-FX4 (Design System - LiteLLM client requests): the shared api-stubs defaults
// are route-valid answers, so a page test that relies on a default renders the
// component, not its error boundary.
describe("T-FX4: api-stubs default answers parse with their route's answer schema", () => {
  const parses = (schema: z.ZodType, body: { data: unknown }) =>
    schema.safeParse(body.data).success;

  it("GET /api/litellm/users: the no-q default is the list shape, the q default the search shape (D-LF1)", () => {
    const list = defaultLiteLLMUsersBody(
      new URL("http://localhost/api/litellm/users?page=1"),
    );
    const search = defaultLiteLLMUsersBody(
      new URL("http://localhost/api/litellm/users?q=ad"),
    );
    expect(parses(UsersListResponseSchema, list)).toBe(true);
    expect(parses(LiteLLMUserSearchResponseSchema, search)).toBe(true);
  });

  it.each([
    ["/api/litellm/org", LiteLLMOrgResponseSchema, DEFAULT_LITELLM_ORG_BODY],
    [
      "/api/litellm/combined/organisation",
      CombinedOrganisationResponseSchema,
      DEFAULT_COMBINED_BODY,
    ],
    [
      "/api/litellm/combined/teams",
      CombinedTeamsResponseSchema,
      DEFAULT_COMBINED_BODY,
    ],
    [
      "/api/litellm/combined/teams/[teamId]",
      CombinedTeamResponseSchema,
      DEFAULT_COMBINED_BODY,
    ],
    [
      "/api/litellm/combined/me",
      CombinedMeResponseSchema,
      DEFAULT_COMBINED_BODY,
    ],
    ["/api/access/org-units", OrgUnitsResponseSchema, DEFAULT_ORG_UNITS_BODY],
  ] as const)("%s default", (_path, schema, body) => {
    expect(parses(schema, body)).toBe(true);
  });
});
