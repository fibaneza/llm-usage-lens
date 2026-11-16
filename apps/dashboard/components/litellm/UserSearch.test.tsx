import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse } from "@/test/fakes/api-stubs";
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

function setup() {
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
  renderWithProviders(<UserSearch />);
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
});
