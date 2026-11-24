import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";
import { holdFetch } from "@/test/support/fetch-hold";
import { renderWithProviders } from "@/test/support/render-providers";

import { LiteLLMSyncDialog } from "./LiteLLMSyncDialog";

// Source: Design System - "Sync from LiteLLM" (unit SYNC1; the dialog loads the
// preview and shows the counts, the rows by outcome with the first 25 of each
// and "Show more", each skip with its reason in words, the drift list; Apply
// runs it and shows the result per outcome; Continue appears while changes
// remain; a truncated plan cannot be applied; the result names the people the
// sync did not place with a link to the Users list; "LiteLLM not configured"
// and "A sync is already running" are states; PLAN_CHANGED, SYNC_RUNNING and
// PLAN_TRUNCATED are the error states; Apply is the one primary button; the
// text says "clean-up of dashboard placeholders" and never that LiteLLM users
// are removed). Access Control - "LiteLLM user sync" (Preview and apply, the
// three 409 codes; Teams; T-SY3, T-SY5, T-SY7, T-SY11 read only) and its UI row
// in the Tests table. The routes have their own tests (Rule 60.24a); this file
// asserts what the dialog shows and sends.
//
// Contract (components/manage/users/LiteLLMSyncDialog.tsx):
//   <LiteLLMSyncDialog onClose={() => void} />  (rendered only while open)
// GET /api/identities/litellm-sync on mount; Apply and Continue POST
// { planHash }. Elements the tests find:
//   role=dialog named "Sync from LiteLLM"; while loading a role=status holding
//   "Loading"; data-testid sync-count-<toLink|toPend|alreadyLinked|skipped|
//   memberships> holding the label and the number; one role=group per
//   non-empty list named "To link", "To add as pending", "Already linked",
//   "Skipped", "Memberships to add", "Drift" (rows are listitems); after
//   Apply a group "Result" and a group "Not placed in a team".
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

type User = Record<string, unknown>;
const user = (over: User): User => ({
  litellmUserId: "lu-x",
  email: "x@example.com",
  outcome: "already-linked",
  ...over,
});

const COUNTS = {
  toLink: 2,
  toPend: 3,
  alreadyLinked: 4,
  skipped: 5,
  memberships: 6,
};

function plan(over: Record<string, unknown> = {}) {
  return {
    configured: true,
    users: [
      user({
        litellmUserId: "lu-ada",
        email: "ada@example.com",
        outcome: "link-existing",
        oid: "oid-ada",
        matchedKey: "oid",
      }),
      user({
        litellmUserId: "lu-bob",
        email: "bob@example.com",
        outcome: "create-pending",
      }),
      user({
        litellmUserId: "lu-cy",
        email: "cy@example.com",
        outcome: "already-linked",
      }),
      user({
        litellmUserId: "lu-dee",
        email: "dee@example.com",
        outcome: "already-linked",
      }),
    ],
    memberships: [
      {
        litellmUserId: "lu-ada",
        teamId: "team-a",
        outcome: "add-member",
      },
    ],
    drift: [{ kind: "not-in-litellm-team", teamId: "team-a", oid: "oid-old" }],
    notPlaced: [],
    counts: COUNTS,
    truncated: false,
    planHash: HASH_A,
    ...over,
  };
}

// Rows exactly as LiteLLMSyncResultSchema allows: no email (the dialog names a
// person from the preview by litellmUserId) and the required status.
const APPLIED = {
  runId: "run-1",
  results: {
    users: [
      {
        litellmUserId: "lu-ada",
        outcome: "link-existing",
        status: "applied",
      },
      {
        litellmUserId: "lu-bob",
        outcome: "create-pending",
        status: "applied",
      },
    ],
    memberships: [
      { litellmUserId: "lu-ada", outcome: "add-member", status: "applied" },
    ],
    notPlaced: [{ litellmUserId: "lu-dee", reason: "multiple-teams" }],
  },
  remaining: 0,
};

type Call = { method: string; path: string; body: unknown };
type Reply = { status?: number; body: unknown };

function stub(opts: { gets: unknown[]; posts?: Reply[] }) {
  const calls: Call[] = [];
  const gets = [...opts.gets];
  const posts = [...(opts.posts ?? [])];
  const lastGet = () =>
    gets[Math.min(calls.filter(isGet).length - 1, gets.length - 1)];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const method = init?.method ?? "GET";
      calls.push({
        method,
        path: url.pathname,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url.pathname !== "/api/identities/litellm-sync") {
        return Promise.resolve(apiResponse({ data: {} }));
      }
      if (method === "GET") {
        return Promise.resolve(apiResponse({ data: lastGet() }));
      }
      const reply = posts.shift() ?? { body: { data: APPLIED } };
      return Promise.resolve(apiResponse(reply.body, reply.status ?? 200));
    }),
  );
  return calls;
}
const isGet = (c: Call) => c.method === "GET";
const posts = (calls: Call[]) => calls.filter((c) => c.method === "POST");

const conflict = (code: string, message: string): Reply => ({
  status: 409,
  body: { error: { code, message } },
});

function open() {
  const onClose = vi.fn();
  renderWithProviders(<LiteLLMSyncDialog onClose={onClose} />);
  return onClose;
}
const dialog = () => screen.findByRole("dialog", { name: "Sync from LiteLLM" });
const apply = () => screen.getByRole("button", { name: "Apply" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LiteLLMSyncDialog preview (Design System - Sync from LiteLLM)", () => {
  it("shows a loading state, then the five counts, the rows by outcome and the drift list", async () => {
    stub({ gets: [plan()] });
    const held = holdFetch(
      (u) => u.pathname === "/api/identities/litellm-sync",
    );
    open();
    await held.arrived;
    expect(await screen.findByRole("status")).toHaveTextContent(/loading/i);
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    held.release();

    const root = await dialog();
    for (const [key, label, n] of [
      ["toLink", /to link/i, "2"],
      ["toPend", /to add as pending/i, "3"],
      ["alreadyLinked", /already linked/i, "4"],
      ["skipped", /skipped/i, "5"],
      ["memberships", /memberships to add/i, "6"],
    ] as const) {
      const count = within(root).getByTestId(`sync-count-${key}`);
      expect(count).toHaveTextContent(label);
      expect(count).toHaveTextContent(n);
    }
    const toLink = within(root).getByRole("group", { name: "To link" });
    expect(within(toLink).getByText("ada@example.com")).toBeInTheDocument();
    const pending = within(root).getByRole("group", {
      name: "To add as pending",
    });
    expect(within(pending).getByText("bob@example.com")).toBeInTheDocument();
    const already = within(root).getByRole("group", { name: "Already linked" });
    expect(within(already).getByText("cy@example.com")).toBeInTheDocument();
    expect(
      within(root).getByRole("group", { name: "Memberships to add" }),
    ).toBeInTheDocument();
    const drift = within(root).getByRole("group", { name: "Drift" });
    expect(within(drift).getAllByRole("listitem")).toHaveLength(1);
  });

  it("only reads: one GET of the sync route, no write and no /api/litellm call (S16, T-SY11)", async () => {
    const calls = stub({ gets: [plan()] });
    open();
    await dialog();
    await screen.findByTestId("sync-count-toLink");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /api/identities/litellm-sync",
    ]);
  });

  it("calls the deletion 'clean-up of dashboard placeholders' and never says LiteLLM users are removed", async () => {
    stub({ gets: [plan()] });
    open();
    const root = await dialog();
    await screen.findByTestId("sync-count-toLink");
    expect(root.textContent).toMatch(/clean-up of dashboard placeholders/i);
    expect(root.textContent).not.toMatch(
      /(remov|delet)\w*\W+(\w+\W+){0,4}LiteLLM users?/i,
    );
  });

  // Skips in words (Design System: "each skip with its reason in words";
  // Access Control - Users table). Representative classes, not every reason.
  it.each([
    ["no-email", /no email/i],
    ["duplicate-email", /(same|shar(e|ed)( this)?) email/i],
    ["ambiguous-identity", /ambiguous|different people/i],
    ["claimed", /claimed|linked to (someone|another)/i],
    ["own-identity", /your own/i],
  ])(
    "a skip with reason %s reads in words, not as the code",
    async (reason, words) => {
      stub({
        gets: [
          plan({
            users: [
              user({
                litellmUserId: "lu-s",
                email: "skip@example.com",
                outcome: "skip",
                reason,
              }),
            ],
          }),
        ],
      });
      open();
      const group = await screen.findByRole("group", { name: "Skipped" });
      const item = within(group).getByText("skip@example.com").closest("li");
      expect(item?.textContent).toMatch(words);
      expect(item?.textContent).not.toContain(reason);
    },
  );

  it("lists the first 25 of an outcome and reveals the rest with Show more", async () => {
    const many = Array.from({ length: 30 }, (_v, i) =>
      user({
        litellmUserId: `lu-${i}`,
        email: `p${String(i).padStart(2, "0")}@example.com`,
        outcome: "create-pending",
      }),
    );
    stub({ gets: [plan({ users: many })] });
    open();
    const group = await screen.findByRole("group", {
      name: "To add as pending",
    });
    expect(within(group).getAllByRole("listitem")).toHaveLength(25);
    await userEvent.click(
      within(group).getByRole("button", { name: /show more/i }),
    );
    expect(within(group).getAllByRole("listitem")).toHaveLength(30);
    expect(
      within(group).queryByRole("button", { name: /show more/i }),
    ).toBeNull();
  });

  it("LiteLLM not configured is a state: no counts, no Apply, no alert (LD37)", async () => {
    stub({ gets: [{ configured: false }] });
    open();
    expect(
      await screen.findByText(/litellm not configured/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("LiteLLMSyncDialog truncated plan (review change V1, T-SY7)", () => {
  it("says the plan is truncated and Apply is disabled and sends nothing", async () => {
    const calls = stub({ gets: [plan({ truncated: true })] });
    open();
    await screen.findByTestId("sync-count-toLink");
    expect((await dialog()).textContent).toMatch(/truncated/i);
    expect(apply()).toBeDisabled();
    await userEvent.click(apply());
    expect(posts(calls)).toHaveLength(0);
  });
});

describe("LiteLLMSyncDialog apply (T-SY5, T-SY3)", () => {
  it("Apply posts the previewed planHash and shows the result per outcome", async () => {
    const calls = stub({ gets: [plan()] });
    open();
    await screen.findByTestId("sync-count-toLink");
    await userEvent.click(apply());

    const result = await screen.findByRole("group", { name: "Result" });
    expect(posts(calls)).toEqual([
      {
        method: "POST",
        path: "/api/identities/litellm-sync",
        body: { planHash: HASH_A },
      },
    ]);
    expect(within(result).getByText("ada@example.com")).toBeInTheDocument();
    expect(within(result).getByText("bob@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
  });

  it("sends one POST while the first is in flight: Apply is disabled meanwhile (T-SY5)", async () => {
    const calls = stub({ gets: [plan()] });
    open();
    await screen.findByTestId("sync-count-toLink");
    const held = holdFetch(
      (u) => u.pathname === "/api/identities/litellm-sync",
    );
    await userEvent.click(apply());
    await held.arrived;
    expect(apply()).toBeDisabled();
    await userEvent.click(apply());
    held.release();
    await held.settled;
    await screen.findByRole("group", { name: "Result" });
    expect(posts(calls)).toHaveLength(1);
  });

  it("names the people not placed with their reason in words and a link to the Users list (S15)", async () => {
    stub({ gets: [plan()] });
    open();
    await screen.findByTestId("sync-count-toLink");
    await userEvent.click(apply());

    const group = await screen.findByRole("group", {
      name: "Not placed in a team",
    });
    const item = within(group).getByText("dee@example.com").closest("li");
    expect(item?.textContent).toMatch(/more than one team|two or more teams/i);
    expect(item?.textContent).not.toContain("multiple-teams");
    expect(
      within(group).getByRole("link", { name: /users list/i }),
    ).toHaveAttribute(
      "href",
      expect.stringMatching(/\/dashboard\/manage\/users$/),
    );
  });

  it("shows Continue while changes remain, and it applies again against the latest preview's hash", async () => {
    const calls = stub({
      gets: [plan(), plan({ planHash: HASH_B })],
      posts: [
        { body: { data: { ...APPLIED, remaining: 120 } } },
        { body: { data: APPLIED } },
      ],
    });
    open();
    await screen.findByTestId("sync-count-toLink");
    await userEvent.click(apply());
    const more = await screen.findByRole("button", { name: "Continue" });
    expect(screen.getByRole("dialog").textContent).toMatch(/120/);
    await userEvent.click(more);
    await waitFor(() => expect(posts(calls)).toHaveLength(2));
    const lastGets = calls.filter(isGet).length;
    const expected = lastGets >= 2 ? HASH_B : HASH_A;
    expect(posts(calls)[1]?.body).toEqual({ planHash: expected });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Continue" })).toBeNull(),
    );
  });
});

describe("LiteLLMSyncDialog 409 states (Design System: PLAN_CHANGED, SYNC_RUNNING, PLAN_TRUNCATED)", () => {
  it("PLAN_CHANGED says to review again and reloads the preview", async () => {
    const calls = stub({
      gets: [plan(), plan({ planHash: HASH_B })],
      posts: [conflict("PLAN_CHANGED", "plan changed")],
    });
    open();
    await screen.findByTestId("sync-count-toLink");
    await userEvent.click(apply());
    expect(
      await screen.findByText("The plan changed — review it again"),
    ).toBeInTheDocument();
    await waitFor(() => expect(calls.filter(isGet)).toHaveLength(2));
  });

  it("SYNC_RUNNING says a sync is already running; a state, not an error alert", async () => {
    stub({
      gets: [plan()],
      posts: [conflict("SYNC_RUNNING", "locked")],
    });
    open();
    await screen.findByTestId("sync-count-toLink");
    await userEvent.click(apply());
    expect(
      await screen.findByText(/a sync is already running/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("PLAN_TRUNCATED at apply says the plan is truncated and leaves Apply disabled", async () => {
    stub({
      gets: [plan()],
      posts: [conflict("PLAN_TRUNCATED", "truncated")],
    });
    open();
    await screen.findByTestId("sync-count-toLink");
    await userEvent.click(apply());
    // Design System - Sync from LiteLLM: "A truncated plan says so" - one message, not two.
    await waitFor(() =>
      expect(
        within(screen.getByRole("dialog")).getAllByText(/truncated/i),
      ).toHaveLength(1),
    );
    expect(apply()).toBeDisabled();
  });
});
