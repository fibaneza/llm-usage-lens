import { LITELLM_OPERATION_NAMES } from "@llm-usage-lens/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { LiteLLMGuardrailsSection } from "./LiteLLMGuardrailsSection";

// Source: LiteLLM spec LD24 (Guardrails edit: Admin and org-admin; Auditor
// read-only) and LD19 (toggles, source, "enforced in code" summary); Design
// System "Settings Page" - LiteLLM sub-tabs (unit A2: one section per route).
// Module under test: `components/settings/litellm-panel/LiteLLMGuardrailsSection.tsx`
//   <LiteLLMGuardrailsSection canEdit={boolean} />
// = the toggles plus the "Enforced in code" summary. Payload, grouping, reset,
// conflict, config.yaml-lock and loading/error behaviour moved here from the
// deleted LiteLLMPanel.guardrails.test.tsx (unit A2 part 2); LD19 toggles
// contract: PUT /api/litellm/toggles { version, toggles } | { version, reset }.
afterEach(() => {
  vi.unstubAllGlobals();
});

function stubOne() {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        apiResponse({
          data: {
            version: 2,
            edition: "oss",
            operations: { createTeam: { enabled: true, source: "spec" } },
          },
        }),
      ),
    ),
  );
}

describe("LiteLLMGuardrailsSection", () => {
  it("an editor gets switches and Reset to defaults, plus the enforced-in-code summary", async () => {
    stubOne();
    renderWithProviders(<LiteLLMGuardrailsSection canEdit />);
    expect(
      await screen.findByRole("switch", { name: "createTeam" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /reset to defaults/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /enforced in code/i }),
    ).toBeInTheDocument();
  });

  it("a read-only caller sees the values and the summary, no switch and no reset", async () => {
    stubOne();
    renderWithProviders(<LiteLLMGuardrailsSection canEdit={false} />);
    expect(
      await screen.findByTestId("litellm-op-createTeam"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /reset to defaults/i }),
    ).toBeNull();
    expect(
      screen.getByRole("region", { name: /enforced in code/i }),
    ).toBeInTheDocument();
  });
});

const READS = [
  "getTeam",
  "listProxyTeams",
  "getTeamDailySpend",
  "getUser",
  "findUserByEmail",
  "searchUsers",
  "getUserDailySpend",
  "listKeys",
  "getKey",
  "listSpendLogs",
  "listProxyModels",
  "listProxyAuditLog",
  "getGlobalSpendReport",
];
const WRITES = [
  "createTeam",
  "setTeamBudget",
  "setTeamLimits",
  "setTeamModels",
  "addTeamMember",
  "removeTeamMember",
  "setMemberBudget",
  "setMemberLimits",
  "resetMemberSpend",
  "resetMemberBudget",
  "disableMember",
  "enableMember",
  "generateMemberKey",
  "updateMemberKey",
  "blockKey",
  "unblockKey",
  "deleteKey",
  "rotateKey",
  // M4, MG-D11a: the route-less request toggle, default on (listed under
  // Member writes with the resets it asks for).
  "requestBudgetReset",
];
const OFF_BY_DEFAULT = new Set(["resetMemberSpend", "deleteKey"]);

type Source = "ui" | "file" | "spec";
type Ops = Record<string, { enabled: boolean; source: Source }>;
type Toggles = {
  version: number;
  edition: "oss" | "enterprise";
  operations: Ops;
};

function toggles(
  over: Partial<Omit<Toggles, "operations">> & {
    ops?: Record<string, { enabled: boolean; source: Source }>;
  } = {},
): Toggles {
  const operations: Ops = {};
  for (const n of [...WRITES, ...READS]) {
    operations[n] = { enabled: !OFF_BY_DEFAULT.has(n), source: "spec" };
  }
  Object.assign(operations, over.ops);
  return {
    version: over.version ?? 5,
    edition: over.edition ?? "oss",
    operations,
  };
}

const CONNECTION = {
  baseUrl: "https://litellm.example.internal",
  version: 3,
  edition: "oss",
  serviceKeyConfigured: true,
};

type Call = { url: string; method: string; body: unknown };

function stub(opts: {
  toggles?: Toggles;
  putResponse?: Response;
  test?: unknown;
  togglesResponse?: Response;
}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      if (url.includes("/api/litellm/toggles")) {
        if (method === "PUT" && opts.putResponse) {
          return Promise.resolve(opts.putResponse);
        }
        return Promise.resolve(
          opts.togglesResponse ??
            apiResponse({ data: opts.toggles ?? toggles() }),
        );
      }
      if (url.includes("/api/litellm/connection/test")) {
        return Promise.resolve(
          apiResponse({
            data: opts.test ?? { result: "ok", message: "Connection ok" },
          }),
        );
      }
      return Promise.resolve(apiResponse({ data: CONNECTION }));
    }),
  );
  return calls;
}

const putsOf = (calls: Call[]) =>
  calls.filter((c) => c.method === "PUT" && c.url.includes("/toggles"));

async function ready() {
  await screen.findByRole("switch", { name: "createTeam" });
}

describe("LiteLLMGuardrailsSection operation toggles", () => {
  it("every allowlisted operation is covered by the fixture (guards the G6 membership test)", () => {
    expect([...WRITES, ...READS].sort()).toEqual(
      [...LITELLM_OPERATION_NAMES].sort(),
    );
  });

  it("every operation has a labelled switch, and the switch count equals the operation count", async () => {
    stub({});
    renderWithProviders(<LiteLLMGuardrailsSection canEdit />);
    await ready();
    for (const n of [...WRITES, ...READS]) {
      expect(screen.getByRole("switch", { name: n })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("switch")).toHaveLength(
      WRITES.length + READS.length,
    );
  });
  it("shows each operation's effective value (aria-checked) from the API", async () => {
    stub({});
    renderWithProviders(<LiteLLMGuardrailsSection canEdit />);
    await ready();
    expect(screen.getByRole("switch", { name: "createTeam" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "getTeam" })).toBeChecked();
    expect(
      screen.getByRole("switch", { name: "resetMemberSpend" }),
    ).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "deleteKey" })).not.toBeChecked();
  });

  it("shows a source badge (ui | file | spec) per operation", async () => {
    stub({
      toggles: toggles({
        ops: {
          createTeam: { enabled: false, source: "ui" },
          getTeam: { enabled: true, source: "spec" },
        },
      }),
    });
    renderWithProviders(<LiteLLMGuardrailsSection canEdit />);
    await ready();
    expect(
      screen.getByTestId("litellm-op-source-createTeam"),
    ).toHaveTextContent(/^ui$/i);
    expect(screen.getByTestId("litellm-op-source-getTeam")).toHaveTextContent(
      /^spec$/i,
    );
    expect(screen.getByTestId("litellm-op-source-deleteKey")).toHaveTextContent(
      /^spec$/i,
    );
    expect(screen.getByTestId("litellm-op-createTeam")).toContainElement(
      screen.getByTestId("litellm-op-source-createTeam"),
    );
  });

  it("toggling a write off sends PUT with the current version and only that operation, then shows source ui", async () => {
    const after = toggles({
      version: 6,
      ops: { createTeam: { enabled: false, source: "ui" } },
    });
    const calls = stub({ putResponse: apiResponse({ data: after }) });
    renderWithProviders(<LiteLLMGuardrailsSection canEdit />);
    await ready();
    await userEvent.click(screen.getByRole("switch", { name: "createTeam" }));
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "createTeam" }),
      ).not.toBeChecked(),
    );
    expect(putsOf(calls)).toEqual([
      {
        url: "/api/litellm/toggles",
        method: "PUT",
        body: { version: 5, toggles: { createTeam: false } },
      },
    ]);
    expect(
      screen.getByTestId("litellm-op-source-createTeam"),
    ).toHaveTextContent(/^ui$/i);
  });

  it("toggling a read off works the same way, and a later toggle sends the new version", async () => {
    const afterRead = toggles({
      version: 6,
      ops: { listKeys: { enabled: false, source: "ui" } },
    });
    const afterDelete = toggles({
      version: 7,
      ops: {
        listKeys: { enabled: false, source: "ui" },
        deleteKey: { enabled: true, source: "ui" },
      },
    });
    const calls = stub({ putResponse: apiResponse({ data: afterRead }) });
    renderWithProviders(<LiteLLMGuardrailsSection canEdit />);
    await ready();
    await userEvent.click(screen.getByRole("switch", { name: "listKeys" }));
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "listKeys" }),
      ).not.toBeChecked(),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn((_i: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          url: "/api/litellm/toggles",
          method: (init?.method ?? "GET").toUpperCase(),
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return Promise.resolve(apiResponse({ data: afterDelete }));
      }),
    );
    await userEvent.click(screen.getByRole("switch", { name: "deleteKey" }));
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "deleteKey" })).toBeChecked(),
    );
    expect(putsOf(calls).map((c) => c.body)).toEqual([
      { version: 5, toggles: { listKeys: false } },
      { version: 6, toggles: { deleteKey: true } },
    ]);
  });

  it("shows a 409 conflict inline and keeps the previous value", async () => {
    stub({
      putResponse: apiResponse(
        { error: { code: "CONFLICT", message: "Toggles changed, reload" } },
        409,
      ),
    });
    renderWithProviders(<LiteLLMGuardrailsSection canEdit />);
    await ready();
    await userEvent.click(screen.getByRole("switch", { name: "createTeam" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Toggles changed, reload",
    );
    expect(screen.getByRole("switch", { name: "createTeam" })).toBeChecked();
  });
});

// G6 (implementation-phases unit A; LiteLLM spec -- Allowlist "Writes" and
// "Reads" tables, lines ~174-215): Guardrails groups operations by family, not
// by write/read. Each group is role="group" named by its heading, described by
// a one-line description (aria-describedby -> accessible description), empty
// groups are not rendered, unknown operations fall into a final "Other
// operations" group, and every row shows a description of its LiteLLM call
// (data-testid litellm-op-desc-<op>). Order inside a group follows the API.
const FAMILIES: Array<[string, string[]]> = [
  [
    "Team writes",
    ["createTeam", "setTeamBudget", "setTeamLimits", "setTeamModels"],
  ],
  [
    "Member writes",
    [
      "addTeamMember",
      "removeTeamMember",
      "setMemberBudget",
      "setMemberLimits",
      "resetMemberSpend",
      "resetMemberBudget",
      "disableMember",
      "enableMember",
      "requestBudgetReset",
    ],
  ],
  [
    "Key writes",
    [
      "generateMemberKey",
      "updateMemberKey",
      "blockKey",
      "unblockKey",
      "deleteKey",
      "rotateKey",
      "requestKey",
      "approveKeyRequest",
      "rejectKeyRequest",
      "revealKeyRequest",
    ],
  ],
  ["Team reads", ["getTeam", "listProxyTeams", "getTeamDailySpend"]],
  [
    "User reads",
    ["getUser", "findUserByEmail", "searchUsers", "getUserDailySpend"],
  ],
  ["Key and spend reads", ["listKeys", "getKey", "listSpendLogs"]],
  [
    "Proxy reads",
    ["listProxyModels", "listProxyAuditLog", "getGlobalSpendReport"],
  ],
];
const L7_OPS = [
  "requestKey",
  "approveKeyRequest",
  "rejectKeyRequest",
  "revealKeyRequest",
];
const UNKNOWN_OP = "someFutureOperation";
const OTHER = "Other operations";
const FAMILY_NAMES = [...FAMILIES.map(([name]) => name), OTHER];

function familyGroups() {
  return screen
    .getAllByRole("group")
    .filter((g) => FAMILY_NAMES.includes(g.getAttribute("aria-label") ?? ""));
}
const opsIn = (group: HTMLElement) =>
  within(group)
    .getAllByRole("switch")
    .map((s) => s.getAttribute("aria-label"));

describe("LiteLLMGuardrailsSection Guardrails grouped by operation family (G6)", () => {
  const extra = Object.fromEntries(
    [...L7_OPS, UNKNOWN_OP].map((n) => [
      n,
      { enabled: true, source: "spec" as Source },
    ]),
  );

  it("renders the seven families in order plus Other, each op in exactly one group, none dropped", async () => {
    stub({ toggles: toggles({ ops: extra }) });
    renderWithProviders(<LiteLLMGuardrailsSection canEdit />);
    await ready();
    const groups = familyGroups();
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(
      FAMILY_NAMES,
    );
    for (const [name, ops] of FAMILIES) {
      const group = screen.getByRole("group", { name });
      expect(opsIn(group).sort()).toEqual([...ops].sort());
    }
    expect(opsIn(screen.getByRole("group", { name: OTHER }))).toEqual([
      UNKNOWN_OP,
    ]);
    const all = groups.flatMap(opsIn);
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(
      Object.keys(toggles({ ops: extra }).operations).sort(),
    );
    expect(
      screen.queryByRole("group", { name: /^(write|read) operations$/i }),
    ).toBeNull();
  });

  it("each group has a heading equal to its label and a one-line description", async () => {
    stub({ toggles: toggles({ ops: extra }) });
    renderWithProviders(<LiteLLMGuardrailsSection canEdit />);
    await ready();
    expect(familyGroups()).toHaveLength(FAMILY_NAMES.length);
    for (const group of familyGroups()) {
      const label = group.getAttribute("aria-label") ?? "";
      expect(
        within(group).getByRole("heading", { name: label }),
      ).toBeInTheDocument();
      expect(group).toHaveAccessibleDescription(/\S/);
    }
  });

  it("does not render empty groups (no Other group when every op is known)", async () => {
    stub({
      toggles: {
        version: 1,
        edition: "oss",
        operations: {
          getTeam: { enabled: true, source: "spec" },
          createTeam: { enabled: true, source: "spec" },
        },
      },
    });
    renderWithProviders(<LiteLLMGuardrailsSection canEdit />);
    await screen.findByRole("switch", { name: "createTeam" });
    expect(familyGroups().map((g) => g.getAttribute("aria-label"))).toEqual([
      "Team writes",
      "Team reads",
    ]);
  });

  it("keeps the API's order inside a group", async () => {
    const t = toggles({ ops: extra });
    const reversed = {
      ...t,
      operations: Object.fromEntries(Object.entries(t.operations).reverse()),
    };
    stub({ toggles: reversed });
    renderWithProviders(<LiteLLMGuardrailsSection canEdit />);
    await ready();
    for (const [name, ops] of FAMILIES) {
      const expected = Object.keys(reversed.operations).filter((n) =>
        ops.includes(n),
      );
      expect(opsIn(screen.getByRole("group", { name }))).toEqual(expected);
    }
  });

  it("shows a description of the LiteLLM call on every row, in read-only mode too", async () => {
    stub({ toggles: toggles({ ops: extra }) });
    const { unmount } = renderWithProviders(
      <LiteLLMGuardrailsSection canEdit />,
    );
    await ready();
    for (const n of Object.keys(toggles({ ops: extra }).operations)) {
      const desc = screen.getByTestId(`litellm-op-desc-${n}`);
      expect(screen.getByTestId(`litellm-op-${n}`)).toContainElement(desc);
      if ((LITELLM_OPERATION_NAMES as readonly string[]).includes(n)) {
        expect(desc.textContent?.trim()).not.toBe("");
      }
    }
    unmount();
    stub({});
    renderWithProviders(<LiteLLMGuardrailsSection canEdit={false} />);
    expect(
      await screen.findByTestId("litellm-op-desc-createTeam"),
    ).toBeInTheDocument();
  });
});

describe("LiteLLMGuardrailsSection on a fresh deployment (nothing saved, GET reports version 0)", () => {
  it("the first save sends version null (create), never the literal 0 the route rejects", async () => {
    const after = toggles({
      version: 1,
      ops: { createTeam: { enabled: false, source: "ui" } },
    });
    const calls = stub({
      toggles: toggles({ version: 0 }),
      putResponse: apiResponse({ data: after }),
    });
    renderWithProviders(<LiteLLMGuardrailsSection canEdit />);
    await ready();
    await userEvent.click(screen.getByRole("switch", { name: "createTeam" }));
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "createTeam" }),
      ).not.toBeChecked(),
    );
    expect(putsOf(calls).map((c) => c.body)).toEqual([
      { version: null, toggles: { createTeam: false } },
    ]);
  });

  it("a second save after the first uses the returned version", async () => {
    const first = toggles({
      version: 1,
      ops: { createTeam: { enabled: false, source: "ui" } },
    });
    const second = toggles({
      version: 2,
      ops: {
        createTeam: { enabled: false, source: "ui" },
        getTeam: { enabled: false, source: "ui" },
      },
    });
    const calls = stub({
      toggles: toggles({ version: 0 }),
      putResponse: apiResponse({ data: first }),
    });
    renderWithProviders(<LiteLLMGuardrailsSection canEdit />);
    await ready();
    await userEvent.click(screen.getByRole("switch", { name: "createTeam" }));
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "createTeam" }),
      ).not.toBeChecked(),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn((_i: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          url: "/api/litellm/toggles",
          method: (init?.method ?? "GET").toUpperCase(),
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return Promise.resolve(apiResponse({ data: second }));
      }),
    );
    await userEvent.click(screen.getByRole("switch", { name: "getTeam" }));
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "getTeam" })).not.toBeChecked(),
    );
    expect(putsOf(calls).map((c) => c.body)).toEqual([
      { version: null, toggles: { createTeam: false } },
      { version: 1, toggles: { getTeam: false } },
    ]);
  });

  it("offers no usable Reset while nothing is saved (hidden or disabled)", async () => {
    stub({ toggles: toggles({ version: 0 }) });
    renderWithProviders(<LiteLLMGuardrailsSection canEdit />);
    await ready();
    const reset = screen.queryByRole("button", {
      name: /reset to defaults/i,
    });
    if (reset !== null) expect(reset).toBeDisabled();
  });
});

describe("LiteLLMGuardrailsSection reset to file defaults", () => {
  it("asks for confirmation without a browser dialog and sends nothing until confirmed", async () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    const calls = stub({});
    renderWithProviders(<LiteLLMGuardrailsSection canEdit />);
    await ready();
    await userEvent.click(
      screen.getByRole("button", { name: /reset to defaults/i }),
    );
    const confirm = screen.getByRole("group", { name: /confirm reset/i });
    expect(
      within(confirm).getByRole("button", { name: /^confirm reset$/i }),
    ).toBeInTheDocument();
    expect(putsOf(calls)).toHaveLength(0);
    await userEvent.click(
      within(confirm).getByRole("button", { name: /cancel/i }),
    );
    expect(screen.queryByRole("group", { name: /confirm reset/i })).toBeNull();
    expect(putsOf(calls)).toHaveLength(0);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("confirming sends { version, reset: true } and shows the refreshed values and sources", async () => {
    const before = toggles({
      version: 8,
      ops: { createTeam: { enabled: false, source: "ui" } },
    });
    const after = toggles({ version: 9 });
    const calls = stub({
      toggles: before,
      putResponse: apiResponse({ data: after }),
    });
    renderWithProviders(<LiteLLMGuardrailsSection canEdit />);
    await ready();
    expect(
      screen.getByTestId("litellm-op-source-createTeam"),
    ).toHaveTextContent(/^ui$/i);
    await userEvent.click(
      screen.getByRole("button", { name: /reset to defaults/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /^confirm reset$/i }),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("litellm-op-source-createTeam"),
      ).toHaveTextContent(/^spec$/i),
    );
    expect(screen.getByRole("switch", { name: "createTeam" })).toBeChecked();
    expect(putsOf(calls).map((c) => c.body)).toEqual([
      { version: 8, reset: true },
    ]);
  });

  it("shows a failed reset inline", async () => {
    stub({
      putResponse: apiResponse(
        { error: { code: "CONFLICT", message: "Toggles changed, reload" } },
        409,
      ),
    });
    renderWithProviders(<LiteLLMGuardrailsSection canEdit />);
    await ready();
    await userEvent.click(
      screen.getByRole("button", { name: /reset to defaults/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /^confirm reset$/i }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Toggles changed, reload",
    );
  });
});

describe("LiteLLMGuardrailsSection guardrail summary (not configurable)", () => {
  it("lists the code-only guardrails read-only, with no controls", async () => {
    stub({});
    renderWithProviders(<LiteLLMGuardrailsSection canEdit />);
    await ready();
    const region = screen.getByRole("region", { name: /enforced in code/i });
    for (const re of [
      /allowlist/i,
      /route templates?/i,
      /hard-limit/i,
      /path[- ]parameter/i,
      /exact request bodies/i,
      /edition gate/i,
      /litellm-changed-by/i,
      /inference/i,
    ]) {
      expect(within(region).getByText(re)).toBeInTheDocument();
    }
    expect(within(region).queryAllByRole("switch")).toHaveLength(0);
    expect(within(region).queryAllByRole("button")).toHaveLength(0);
    expect(within(region).queryAllByRole("textbox")).toHaveLength(0);
  });
});

// Source: LiteLLM spec LD18 -- the inference refusal is verified by L2 and the
// runbook, not yet by an automated check, so the list marks it "pending".
describe("LiteLLMGuardrailsSection guardrail summary - LD18 item", () => {
  it("marks the inference refusal item as pending", async () => {
    stub({});
    renderWithProviders(<LiteLLMGuardrailsSection canEdit />);
    await ready();
    const region = screen.getByRole("region", { name: /enforced in code/i });
    expect(within(region).getByText(/inference/i)).toHaveTextContent(
      /pending/i,
    );
  });
});

// A6 / T37: a file-set operation shows its effective value, the badge
// "Set in config.yaml" and a disabled switch; an unset one is editable.
describe("LiteLLMGuardrailsSection operations set in config.yaml (unit CFG, A6)", () => {
  const LOCKED = {
    deleteKey: { enabled: false, source: "file" as Source },
    getTeam: { enabled: false, source: "file" as Source },
  };

  it.each(["deleteKey", "getTeam"])(
    "%s: badge 'Set in config.yaml', value shown, switch disabled",
    async (name) => {
      stub({ toggles: toggles({ ops: LOCKED }) });
      renderWithProviders(<LiteLLMGuardrailsSection canEdit />);
      await ready();
      expect(screen.getByTestId(`litellm-op-source-${name}`)).toHaveTextContent(
        "Set in config.yaml",
      );
      const sw = screen.getByRole("switch", { name });
      expect(sw).not.toBeChecked();
      expect(sw).toBeDisabled();
    },
  );

  // Review W1 (review-blockers.md; WCAG 1.3.1/4.1.2): the disabled switch
  // names why it is disabled by pointing at the badge element.
  it.each(["deleteKey", "getTeam"])(
    "%s: the disabled switch's aria-describedby is the id of its 'Set in config.yaml' badge",
    async (name) => {
      stub({ toggles: toggles({ ops: LOCKED }) });
      renderWithProviders(<LiteLLMGuardrailsSection canEdit />);
      await ready();
      const sw = screen.getByRole("switch", { name });
      const badge = screen.getByTestId(`litellm-op-source-${name}`);
      expect(badge.id).not.toBe("");
      expect(sw.getAttribute("aria-describedby")).toBe(badge.id);
      expect(sw).toHaveAccessibleDescription("Set in config.yaml");
    },
  );

  it("an unlocked switch has no aria-describedby to a config.yaml badge", async () => {
    stub({ toggles: toggles({ ops: LOCKED }) });
    renderWithProviders(<LiteLLMGuardrailsSection canEdit />);
    await ready();
    expect(
      screen.getByRole("switch", { name: "createTeam" }),
    ).not.toHaveAttribute("aria-describedby", expect.stringMatching(/\S/));
  });

  it("an operation with source ui or spec is editable and has no config.yaml badge", async () => {
    stub({
      toggles: toggles({
        ops: { ...LOCKED, listKeys: { enabled: true, source: "ui" } },
      }),
    });
    renderWithProviders(<LiteLLMGuardrailsSection canEdit />);
    await ready();
    for (const name of ["createTeam", "listKeys"]) {
      expect(screen.getByRole("switch", { name })).toBeEnabled();
      expect(
        screen.getByTestId(`litellm-op-source-${name}`),
      ).not.toHaveTextContent(/config\.yaml/i);
    }
  });

  it("clicking a locked switch sends no PUT; an unset one still does", async () => {
    const calls = stub({
      toggles: toggles({ ops: LOCKED }),
      putResponse: apiResponse({
        data: toggles({
          version: 6,
          ops: { ...LOCKED, createTeam: { enabled: false, source: "ui" } },
        }),
      }),
    });
    renderWithProviders(<LiteLLMGuardrailsSection canEdit />);
    await ready();
    await userEvent.click(screen.getByRole("switch", { name: "deleteKey" }));
    expect(putsOf(calls)).toHaveLength(0);
    await userEvent.click(screen.getByRole("switch", { name: "createTeam" }));
    await waitFor(() => expect(putsOf(calls)).toHaveLength(1));
    expect(putsOf(calls)[0]?.body).toEqual({
      version: 5,
      toggles: { createTeam: false },
    });
  });

  it("a read-only viewer sees the badge too", async () => {
    stub({ toggles: toggles({ ops: LOCKED }) });
    renderWithProviders(<LiteLLMGuardrailsSection canEdit={false} />);
    expect(
      await screen.findByTestId("litellm-op-source-deleteKey"),
    ).toHaveTextContent("Set in config.yaml");
  });
});

describe("LiteLLMGuardrailsSection loading and error states", () => {
  it("shows a skeleton while the toggles load", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    renderWithProviders(<LiteLLMGuardrailsSection canEdit />);
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.getByTestId("litellm-toggles-loading")).toBeInTheDocument();
  });

  it("shows an inline error when the toggles request fails", async () => {
    stub({
      togglesResponse: apiResponse(
        { error: { code: "INTERNAL_ERROR", message: "Toggles unavailable" } },
        500,
      ),
    });
    renderWithProviders(<LiteLLMGuardrailsSection canEdit />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Toggles unavailable",
    );
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
  });
});

// LD24: a read-only (Auditor) section never issues a write; role x section
// edit flags are asserted once in app/dashboard/settings/litellm/[section]/page.test.tsx.
describe("LiteLLMGuardrailsSection read-only issues no write (LD24)", () => {
  it("renders values and sources, and sends only GET requests", async () => {
    const calls = stub({
      toggles: toggles({
        ops: {
          createTeam: { enabled: false, source: "ui" },
          getTeam: { enabled: true, source: "spec" },
        },
      }),
    });
    renderWithProviders(<LiteLLMGuardrailsSection canEdit={false} />);
    const row = await screen.findByTestId("litellm-op-createTeam");
    expect(row).toHaveTextContent(/off/i);
    expect(screen.getByTestId("litellm-op-getTeam")).toHaveTextContent(/on/i);
    expect(
      screen.getByTestId("litellm-op-source-createTeam"),
    ).toHaveTextContent(/^ui$/);
    expect(screen.getByTestId("litellm-op-source-getTeam")).toHaveTextContent(
      /^spec$/,
    );
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });
});
