import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse } from "@/test/fakes/api-stubs";
import { HIDDEN, personShow } from "@/test/fakes/combined-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { UserSearch } from "./UserSearch";

// Sources: docs/specs/2026-11-10-litellm.md -- Views by role (L3b: Users tab,
// search by email or user id, 2-character minimum, selecting a result shows
// spend, budget and daily spend), allowlist row `searchUsers` (2-100 chars),
// LT8 (LiteLLM-reported), LD20 (UTC days), LT21 (out-of-scope detail is the
// same 404 as a missing one); Design System -- LiteLLM Page (Users tab and
// Settings Users tab share one search component: labelled input, results as a
// table, selected user's spend and daily spend below). Scoping itself is
// tested with the routes (Rule 60.24a); this file tests rendering and the
// request rules only.
// Module under test: `components/litellm/UserSearch.tsx`, `<UserSearch />` (no
// props; client; owns its own loading/error states, no Suspense needed).
// Markup assumed: input type=search labelled "Search users" (role searchbox);
// results in a table, the email cell is a button named by the email; the
// selected user's details in a region named "User usage".
// Assumed GET /api/litellm/users?q= data:
//   { users: [{ userId, email, spend, maxBudget: number|null,
//     teams: [{ teamId, teamName }] }], page, pageSize, enabledOperations }
// GET /api/litellm/users/[litellmUserId] data:
//   { userId, email, spend, maxBudget: number|null, daily, enabledOperations }
const DEBOUNCE_PAST = 1000;

const USERS = {
  page: 1,
  pageSize: 25,
  enabledOperations: [],
  users: [
    {
      userId: "u-ada",
      email: "ada@example.test",
      spend: 77.1,
      maxBudget: 150,
      teams: [{ teamId: "t1", teamName: "Payments" }],
    },
    {
      userId: "u/bob",
      email: "bob@example.test",
      spend: 5,
      maxBudget: null,
      teams: [],
    },
  ],
};
const DETAIL = {
  userId: "u-ada",
  email: "ada@example.test",
  spend: 77.1,
  maxBudget: 150,
  daily: [{ date: "2026-11-14", spend: 4.5 }],
  enabledOperations: [],
};

type Routes = (url: URL) => Response;
function stub(routes: Routes) {
  const calls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      calls.push(url);
      return Promise.resolve(routes(url));
    }),
  );
  return calls;
}
const searches = (calls: URL[]) =>
  calls.filter((u) => u.pathname === "/api/litellm/users");

const defaultRoutes: Routes = (url) =>
  url.pathname === "/api/litellm/users"
    ? apiResponse({ data: USERS })
    : apiResponse({ data: DETAIL });

function setup(searchParams?: Record<string, string>) {
  // Only timers are faked (Rule 60.24); fetch and promises stay real.
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout"],
    shouldAdvanceTime: true,
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  const user = userEvent.setup({
    advanceTimers: (ms) => vi.advanceTimersByTime(ms),
    delay: null,
  });
  renderWithProviders(<UserSearch />, searchParams ? { searchParams } : {});
  return user;
}
const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(DEBOUNCE_PAST);
  });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("UserSearch input and request rules", () => {
  it("renders a labelled search input and requests nothing on mount", async () => {
    const calls = stub(defaultRoutes);
    setup();
    expect(
      screen.getByRole("searchbox", { name: /search users/i }),
    ).toBeInTheDocument();
    await settle();
    expect(calls).toHaveLength(0);
  });

  it("does not query for fewer than 2 characters (searchUsers 2-100)", async () => {
    const calls = stub(defaultRoutes);
    const user = setup();
    await user.type(
      screen.getByRole("searchbox", { name: /search users/i }),
      "a",
    );
    await settle();
    expect(searches(calls)).toHaveLength(0);
  });

  it("queries GET /api/litellm/users?q= from 2 characters, after a debounce", async () => {
    const calls = stub(defaultRoutes);
    const user = setup();
    await user.type(
      screen.getByRole("searchbox", { name: /search users/i }),
      "ad",
    );
    expect(searches(calls)).toHaveLength(0);
    await settle();
    expect(searches(calls)).toHaveLength(1);
    expect(searches(calls)[0]?.searchParams.get("q")).toBe("ad");
  });

  it("debounces: typing 'ada' key by key sends one request with the final value", async () => {
    const calls = stub(defaultRoutes);
    const user = setup();
    await user.type(
      screen.getByRole("searchbox", { name: /search users/i }),
      "ada",
    );
    await settle();
    expect(searches(calls).map((u) => u.searchParams.get("q"))).toEqual([
      "ada",
    ]);
  });

  it("trims the term: two spaces are not a query", async () => {
    const calls = stub(defaultRoutes);
    const user = setup();
    await user.type(
      screen.getByRole("searchbox", { name: /search users/i }),
      "  ",
    );
    await settle();
    expect(searches(calls)).toHaveLength(0);
  });
});

describe("UserSearch results", () => {
  it("lists results in a table with email, spend and budget in USD, null budget as No limit (LT8)", async () => {
    stub(defaultRoutes);
    const user = setup();
    await user.type(
      screen.getByRole("searchbox", { name: /search users/i }),
      "ex",
    );
    await settle();
    const ada = await screen.findByRole("row", { name: /ada@example\.test/ });
    expect(within(ada).getByText("$77.10")).toBeInTheDocument();
    expect(within(ada).getByText("$150.00")).toBeInTheDocument();
    expect(
      within(screen.getByRole("row", { name: /bob@example\.test/ })).getByText(
        /no limit/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("LiteLLM-reported").length).toBeGreaterThan(0);
  });

  it("shows an empty state when nothing matches", async () => {
    stub(() =>
      apiResponse({
        data: { users: [], page: 1, pageSize: 25, enabledOperations: [] },
      }),
    );
    const user = setup();
    await user.type(
      screen.getByRole("searchbox", { name: /search users/i }),
      "zz",
    );
    await settle();
    expect(await screen.findByText(/no users found/i)).toBeInTheDocument();
  });

  it("shows 'LiteLLM unavailable' on a 503 and keeps the input usable", async () => {
    stub(() => apiError(503, "LITELLM_UNAVAILABLE", "LiteLLM is unavailable"));
    const user = setup();
    const input = screen.getByRole("searchbox", { name: /search users/i });
    await user.type(input, "ad");
    await settle();
    expect(await screen.findByText(/LiteLLM unavailable/i)).toBeInTheDocument();
    expect(input).toBeEnabled();
  });
});

describe("UserSearch selected user", () => {
  async function pickAda() {
    const user = setup();
    await user.type(
      screen.getByRole("searchbox", { name: /search users/i }),
      "ad",
    );
    await settle();
    await user.click(
      await screen.findByRole("button", { name: "ada@example.test" }),
    );
    await settle();
  }

  it("selecting a row loads GET /api/litellm/users/[id] and shows spend, budget and UTC-day daily spend (L3b)", async () => {
    const calls = stub(defaultRoutes);
    await pickAda();
    const detail = await screen.findByRole("region", { name: /user usage/i });
    expect(within(detail).getByText("$77.10")).toBeInTheDocument();
    expect(within(detail).getByText("$150.00")).toBeInTheDocument();
    expect(within(detail).getByText("2026-11-14")).toBeInTheDocument();
    expect(within(detail).getByText(/UTC days?/i)).toBeInTheDocument();
    expect(
      within(detail).getAllByText("LiteLLM-reported").length,
    ).toBeGreaterThan(0);
    expect(calls.some((u) => u.pathname === "/api/litellm/users/u-ada")).toBe(
      true,
    );
  });

  it("percent-encodes the user id in the detail path (path-parameter safety, LT3)", async () => {
    const calls = stub(defaultRoutes);
    const user = setup();
    await user.type(
      screen.getByRole("searchbox", { name: /search users/i }),
      "bo",
    );
    await settle();
    await user.click(
      await screen.findByRole("button", { name: "bob@example.test" }),
    );
    await settle();
    expect(calls.some((u) => u.pathname === "/api/litellm/users/u%2Fbob")).toBe(
      true,
    );
  });

  it("shows a not-found message for a 404 detail, the same for missing and out of scope (LT21)", async () => {
    stub((url) =>
      url.pathname === "/api/litellm/users"
        ? apiResponse({ data: USERS })
        : apiError(404, "NOT_FOUND", "Not found"),
    );
    await pickAda();
    expect(await screen.findByText(/user not found/i)).toBeInTheDocument();
  });

  // Design System - Management pages, LiteLLM users tab, D-LF1 and T-LF1: a
  // user LiteLLM reports no usage for renders the usage section with "—" for
  // the absent value and no error. The route answers `spend: null` then (the
  // route's own test); a user under the Organisation cap has no `spend` key
  // and keeps the "Hidden until ..." text (LD23).
  it("a user with no reported usage shows an em dash for spend, no error and no $0 (D-LF1, T-LF1)", async () => {
    stub((url) =>
      url.pathname === "/api/litellm/users"
        ? apiResponse({ data: USERS })
        : apiResponse({
            data: { ...DETAIL, spend: null, maxBudget: null, daily: [] },
          }),
    );
    await pickAda();
    const detail = await screen.findByRole("region", { name: /user usage/i });
    expect(within(detail).queryByRole("alert")).toBeNull();
    expect(within(detail).getByText("ada@example.test")).toBeInTheDocument();
    expect(within(detail).getByText("\u2014")).toBeInTheDocument();
    expect(detail).not.toHaveTextContent("$0");
    expect(detail).not.toHaveTextContent(/hidden until/i);
  });
});

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage
// (L6)": Where each figure appears (Users: "the selected user's detail there
// shows that person's combined figure, under the cap"), Routes (GET
// /api/litellm/users/[litellmUserId] "adds `combined`; omitted while
// scope.userLevelCap is below all (LD23)"), States, Visibility (a Lead:
// show | hidden). Contract: when the detail's `combined` is present and not
// hidden, a region "Combined usage" (CombinedPersonCard) sits inside the
// "User usage" region; absent (cap) or hidden -> no such region. The figure
// is not re-fetched: it comes from the detail response.
describe("UserSearch selected user - combined figure (L6)", () => {
  const withCombined = (combined?: unknown) =>
    stub((url) =>
      url.pathname === "/api/litellm/users"
        ? apiResponse({ data: USERS })
        : apiResponse({
            data: combined === undefined ? DETAIL : { ...DETAIL, combined },
          }),
    );
  async function pick() {
    const user = setup();
    await user.type(
      screen.getByRole("searchbox", { name: /search users/i }),
      "ad",
    );
    await settle();
    await user.click(
      await screen.findByRole("button", { name: "ada@example.test" }),
    );
    await settle();
    return screen.findByRole("region", { name: /user usage/i });
  }

  it("shows the person's combined figure inside the user's detail, from the detail response", async () => {
    const calls = withCombined(personShow());
    const detail = await pick();
    const card = await within(detail).findByRole("region", {
      name: "Combined usage",
    });
    expect(within(card).getByTestId("combined-total")).toHaveTextContent(
      "$15.00",
    );
    expect(
      within(card).getByText("Direct Bedrock $10.00 · Via LiteLLM $5.00"),
    ).toBeInTheDocument();
    expect(calls.some((u) => u.pathname.includes("/combined/"))).toBe(false);
  });

  it("shows no combined region when the detail omits it (Organisation cap, LD23)", async () => {
    withCombined();
    const detail = await pick();
    await within(detail).findByText("$77.10");
    expect(
      within(detail).queryByRole("region", { name: "Combined usage" }),
    ).toBeNull();
  });

  it("shows no combined region for a hidden body (a Lead while the gateway is not configured)", async () => {
    withCombined(HIDDEN);
    const detail = await pick();
    await within(detail).findByText("$77.10");
    expect(
      within(detail).queryByRole("region", { name: "Combined usage" }),
    ).toBeNull();
    expect(within(detail).queryByTestId("combined-total")).toBeNull();
  });

  it("warn shows the gateway warning in the card", async () => {
    withCombined(personShow({ visibility: "warn", gatewayConfigured: false }));
    const detail = await pick();
    expect(await within(detail).findByRole("status")).toHaveTextContent(
      "gateway not configured — totals may double count",
    );
  });
});

// Design System - LiteLLM client requests (unit FX1; D-R3-16), T-FX2: the user
// detail route requires a date range (DateRangeQuerySchema), so the request
// carries the URL range and the detail renders. The stub refuses a request
// without dateFrom and dateTo with the standard 400 body.
describe("UserSearch detail request carries the URL date range (T-FX2)", () => {
  const RANGE = { dateFrom: "2026-10-01", dateTo: "2026-10-31" };

  it("T-FX2: GET /api/litellm/users/[id] has dateFrom and dateTo from the URL, and the detail renders", async () => {
    const calls = stub((url) => {
      if (url.pathname === "/api/litellm/users") {
        return apiResponse({ data: USERS });
      }
      return url.searchParams.has("dateFrom") && url.searchParams.has("dateTo")
        ? apiResponse({ data: DETAIL })
        : apiError(400, "BAD_REQUEST", "dateFrom and dateTo are required");
    });
    const user = setup(RANGE);
    await user.type(
      screen.getByRole("searchbox", { name: /search users/i }),
      "ad",
    );
    await settle();
    await user.click(
      await screen.findByRole("button", { name: "ada@example.test" }),
    );
    await settle();

    const detail = await screen.findByRole("region", { name: /user usage/i });
    expect(within(detail).getByText("$77.10")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    const asked = calls.find((u) => u.pathname === "/api/litellm/users/u-ada");
    expect(asked?.searchParams.get("dateFrom")).toBe(RANGE.dateFrom);
    expect(asked?.searchParams.get("dateTo")).toBe(RANGE.dateTo);
  });
});
