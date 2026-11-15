import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

import { LiteLLMPanel } from "./LiteLLMPanel";

// Source: docs/specs/2026-11-10-litellm.md -- "Guardrail configuration" (LD19:
// each operation, writes and reads, shows its effective value and source
// ui|file|spec; "reset to file defaults" deletes the saved values, Admin,
// versioned; the not-configurable guardrails are shown read-only), "Gateway
// guardrails" item 6 (the connection test warning about the temporary
// wildcards is shown on the panel), "Page and Settings", "API routes"
// (/api/litellm/toggles GET Admin+Auditor, PUT Admin), implementation-phases
// L2, Rules 40 (UI) and 60.24 (no real network).
//
// Contract for the developer (component):
//   <LiteLLMPanel canEdit?: boolean />   canEdit defaults to true (the panel
//   is mounted for Admins); canEdit={false} renders values read-only.
//   Calls: GET /api/litellm/toggles -> { version, edition,
//     operations: { [op]: { enabled, source } } }
//   PUT /api/litellm/toggles { version, toggles: { [op]: boolean } } (only the
//     changed operation) or { version, reset: true }; the response has the GET
//     shape and replaces the shown values.
//   Markup: group "Write operations" and group "Read operations"; per
//   operation a role="switch" named exactly the operation name (aria-checked =
//   effective value); a source badge data-testid="litellm-op-source-<op>"
//   whose text is ui|file|spec; row data-testid="litellm-op-<op>".
//   Button "Reset to file defaults" opens an inline confirm group named
//   "Confirm reset" with buttons "Confirm reset" and "Cancel" (no
//   window.confirm). Region "Enforced in code" lists the read-only guardrails.
//   Wildcard warning: data-testid="litellm-wildcard-warning", from
//   ConnectionTestResult.warnings; always shown when the test returns it
//   (code-only, LD19 amended 2026-11-15; no toggles field gates it).
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const READS = [
  "getTeam",
  "listProxyTeams",
  "getTeamDailySpend",
  "getUser",
  "findUserByEmail",
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
    operations[n] = { enabled: !OFF_BY_DEFAULT.has(n), source: "file" };
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
const WILDCARD = "service key uses temporary wildcards (`/team/*`, `/key/*`)";

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

// L3b: the toggles and the guardrail summary moved to the Guardrails tab
// (LiteLLM spec -- Views by role, Settings tabs); behaviour is unchanged.
async function openGuardrails() {
  await userEvent.click(await screen.findByRole("tab", { name: "Guardrails" }));
}

async function ready() {
  await openGuardrails();
  await screen.findByRole("switch", { name: "createTeam" });
}

describe("LiteLLMPanel operation toggles", () => {
  it("lists every write and read operation in its own group with a labelled switch", async () => {
    stub({});
    renderWithProviders(<LiteLLMPanel />);
    await ready();
    const writes = screen.getByRole("group", { name: /write operations/i });
    const reads = screen.getByRole("group", { name: /read operations/i });
    for (const n of WRITES) {
      expect(
        within(writes).getByRole("switch", { name: n }),
      ).toBeInTheDocument();
    }
    for (const n of READS) {
      expect(
        within(reads).getByRole("switch", { name: n }),
      ).toBeInTheDocument();
    }
    expect(screen.getAllByRole("switch")).toHaveLength(
      WRITES.length + READS.length,
    );
  });

  it("shows each operation's effective value (aria-checked) from the API", async () => {
    stub({});
    renderWithProviders(<LiteLLMPanel />);
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
    renderWithProviders(<LiteLLMPanel />);
    await ready();
    expect(
      screen.getByTestId("litellm-op-source-createTeam"),
    ).toHaveTextContent(/^ui$/i);
    expect(screen.getByTestId("litellm-op-source-getTeam")).toHaveTextContent(
      /^spec$/i,
    );
    expect(screen.getByTestId("litellm-op-source-deleteKey")).toHaveTextContent(
      /^file$/i,
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
    renderWithProviders(<LiteLLMPanel />);
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
    renderWithProviders(<LiteLLMPanel />);
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
    renderWithProviders(<LiteLLMPanel />);
    await ready();
    await userEvent.click(screen.getByRole("switch", { name: "createTeam" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Toggles changed, reload",
    );
    expect(screen.getByRole("switch", { name: "createTeam" })).toBeChecked();
  });
});

describe("LiteLLMPanel on a fresh deployment (nothing saved, GET reports version 0)", () => {
  it("the first save sends version null (create), never the literal 0 the route rejects", async () => {
    const after = toggles({
      version: 1,
      ops: { createTeam: { enabled: false, source: "ui" } },
    });
    const calls = stub({
      toggles: toggles({ version: 0 }),
      putResponse: apiResponse({ data: after }),
    });
    renderWithProviders(<LiteLLMPanel />);
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
    renderWithProviders(<LiteLLMPanel />);
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
    renderWithProviders(<LiteLLMPanel />);
    await ready();
    const reset = screen.queryByRole("button", {
      name: /reset to file defaults/i,
    });
    if (reset !== null) expect(reset).toBeDisabled();
  });
});

describe("LiteLLMPanel reset to file defaults", () => {
  it("asks for confirmation without a browser dialog and sends nothing until confirmed", async () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    const calls = stub({});
    renderWithProviders(<LiteLLMPanel />);
    await ready();
    await userEvent.click(
      screen.getByRole("button", { name: /reset to file defaults/i }),
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
    renderWithProviders(<LiteLLMPanel />);
    await ready();
    expect(
      screen.getByTestId("litellm-op-source-createTeam"),
    ).toHaveTextContent(/^ui$/i);
    await userEvent.click(
      screen.getByRole("button", { name: /reset to file defaults/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /^confirm reset$/i }),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("litellm-op-source-createTeam"),
      ).toHaveTextContent(/^file$/i),
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
    renderWithProviders(<LiteLLMPanel />);
    await ready();
    await userEvent.click(
      screen.getByRole("button", { name: /reset to file defaults/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /^confirm reset$/i }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Toggles changed, reload",
    );
  });
});

describe("LiteLLMPanel guardrail summary (not configurable)", () => {
  it("lists the code-only guardrails read-only, with no controls", async () => {
    stub({});
    renderWithProviders(<LiteLLMPanel />);
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
describe("LiteLLMPanel guardrail summary - LD18 item", () => {
  it("marks the inference refusal item as pending", async () => {
    stub({});
    renderWithProviders(<LiteLLMPanel />);
    await ready();
    const region = screen.getByRole("region", { name: /enforced in code/i });
    expect(within(region).getByText(/inference/i)).toHaveTextContent(
      /pending/i,
    );
  });
});

describe("LiteLLMPanel wildcard warning", () => {
  async function runTest() {
    await screen.findByRole("button", { name: /test connection/i });
    await userEvent.click(
      screen.getByRole("button", { name: /test connection/i }),
    );
  }

  it("is absent before the test and when the result has no warnings", async () => {
    stub({ test: { result: "ok", message: "Connection ok", warnings: [] } });
    renderWithProviders(<LiteLLMPanel />);
    await screen.findByRole("button", { name: /test connection/i });
    expect(screen.queryByTestId("litellm-wildcard-warning")).toBeNull();
    await runTest();
    expect(await screen.findByText("Connection ok")).toBeInTheDocument();
    expect(screen.queryByTestId("litellm-wildcard-warning")).toBeNull();
    expect(screen.queryByText(/temporary wildcards/i)).toBeNull();
  });

  it("is shown when the connection test returns the temporary-wildcards warning", async () => {
    stub({
      test: { result: "ok", message: "Connection ok", warnings: [WILDCARD] },
    });
    renderWithProviders(<LiteLLMPanel />);
    await runTest();
    const w = await screen.findByTestId("litellm-wildcard-warning");
    expect(w).toHaveTextContent(/temporary wildcards/i);
    expect(w).toHaveTextContent("/team/*");
    expect(w).toHaveTextContent("/key/*");
  });

  it("is announced as a status region (role=status), not an alert", async () => {
    stub({
      test: { result: "ok", message: "Connection ok", warnings: [WILDCARD] },
    });
    renderWithProviders(<LiteLLMPanel />);
    await runTest();
    const w = await screen.findByTestId("litellm-wildcard-warning");
    expect(w).toHaveAttribute("role", "status");
    expect(within(w).queryByRole("alert")).toBeNull();
  });

  it("is shown whenever the test returns it: the toggles payload has no wildcardWarning field", async () => {
    const t = toggles();
    expect(t).not.toHaveProperty("wildcardWarning");
    stub({
      toggles: t,
      test: { result: "ok", message: "Connection ok", warnings: [WILDCARD] },
    });
    renderWithProviders(<LiteLLMPanel />);
    await runTest();
    expect(
      await screen.findByTestId("litellm-wildcard-warning"),
    ).toBeInTheDocument();
  });
});

describe("LiteLLMPanel without edit rights", () => {
  it("shows values and sources but no switches and no reset action", async () => {
    stub({
      toggles: toggles({
        ops: { createTeam: { enabled: false, source: "ui" } },
      }),
    });
    renderWithProviders(<LiteLLMPanel canEdit={false} />);
    await openGuardrails();
    const row = await screen.findByTestId("litellm-op-createTeam");
    expect(row).toHaveTextContent("createTeam");
    expect(row).toHaveTextContent(/off/i);
    expect(screen.getByTestId("litellm-op-getTeam")).toHaveTextContent(/on/i);
    expect(
      screen.getByTestId("litellm-op-source-createTeam"),
    ).toHaveTextContent(/^ui$/i);
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: /reset to file defaults/i }),
    ).toBeNull();
    expect(
      screen.getByRole("region", { name: /enforced in code/i }),
    ).toBeVisible();
  });
});

describe("LiteLLMPanel toggles loading and error states", () => {
  it("shows a skeleton in the toggles section while it loads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        String(input).includes("/api/litellm/toggles")
          ? new Promise<Response>(() => {})
          : Promise.resolve(apiResponse({ data: CONNECTION })),
      ),
    );
    renderWithProviders(<LiteLLMPanel />);
    await screen.findByText("https://litellm.example.internal");
    await openGuardrails();
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(
      document.querySelector('[data-testid="litellm-toggles-loading"]') ??
        document.querySelector('[data-slot="skeleton"]'),
    ).not.toBeNull();
  });

  it("shows an inline error when the toggles request fails, keeping the connection details", async () => {
    stub({
      togglesResponse: apiResponse(
        { error: { code: "INTERNAL_ERROR", message: "Toggles unavailable" } },
        500,
      ),
    });
    renderWithProviders(<LiteLLMPanel />);
    expect(
      await screen.findByText("https://litellm.example.internal"),
    ).toBeInTheDocument();
    await openGuardrails();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Toggles unavailable",
    );
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
  });
});
