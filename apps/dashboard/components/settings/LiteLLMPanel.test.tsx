import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

import { LiteLLMPanel } from "./LiteLLMPanel";

// Source: docs/specs/2026-11-10-litellm.md -- "Page and Settings" (Settings
// gains an Admin LiteLLM panel: connection URL, edition read-only,
// service-key status, connection test), "Security architecture" item 6 (admins
// see only "service key configured: yes/no" and the test result; no UI for the
// key), "API routes" (/api/litellm/connection, /connection/test);
// implementation-phases L1 (panel: status, URL, edition, test; no key entry).
// Module under test: `components/settings/LiteLLMPanel.tsx`, a client
// component with no props. `fetch` is stubbed (Rule 60.24).
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Status = {
  baseUrl: string | null;
  version: number;
  edition: "oss" | "enterprise";
  serviceKeyConfigured: boolean;
};
const CONFIGURED: Status = {
  baseUrl: "https://litellm.example.internal",
  version: 3,
  edition: "enterprise",
  serviceKeyConfigured: true,
};

// L2 (LD19): the panel also reads GET /api/litellm/toggles.
const TOGGLES = {
  version: 0,
  edition: "oss",
  operations: { createTeam: { enabled: true, source: "file" } },
};

function stubLiteLLM(status: Status, testData?: unknown) {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ url, method });
      if (url.includes("/api/litellm/toggles")) {
        return Promise.resolve(apiResponse({ data: TOGGLES }));
      }
      if (url.includes("/api/litellm/connection/test")) {
        return Promise.resolve(apiResponse({ data: testData }));
      }
      return Promise.resolve(apiResponse({ data: status }));
    }),
  );
  return calls;
}

describe("LiteLLMPanel", () => {
  it("shows the base URL, a read-only edition and 'service key configured: yes'", async () => {
    stubLiteLLM(CONFIGURED);
    renderWithProviders(<LiteLLMPanel />);
    expect(
      await screen.findByText("https://litellm.example.internal"),
    ).toBeInTheDocument();
    expect(screen.getByText(/enterprise/i)).toBeInTheDocument();
    expect(screen.getByText(/service key configured/i)).toHaveTextContent(
      /yes/i,
    );
  });

  it("shows 'service key configured: no' and 'not configured' when nothing is set", async () => {
    stubLiteLLM({
      baseUrl: null,
      version: 0,
      edition: "oss",
      serviceKeyConfigured: false,
    });
    renderWithProviders(<LiteLLMPanel />);
    expect(
      await screen.findByText(/service key configured/i),
    ).toHaveTextContent(/no/i);
    expect(
      screen.getByText(/not configured|not connected/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/oss/i)).toBeInTheDocument();
  });

  it("has no input for the service key or the edition anywhere (no UI for the key)", async () => {
    stubLiteLLM(CONFIGURED);
    renderWithProviders(<LiteLLMPanel />);
    await screen.findByText("https://litellm.example.internal");
    expect(
      screen.queryByLabelText(/service key|api key|secret|token/i),
    ).toBeNull();
    expect(screen.queryByLabelText(/edition/i)).toBeNull();
    expect(screen.queryByDisplayValue(/sk-/)).not.toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("shows a loading skeleton before the status arrives", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const { container } = renderWithProviders(<LiteLLMPanel />);
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  });

  it.each([
    ["ok", "Connection ok"],
    ["unauthorised", "Service key rejected - rotate and redeploy"],
    ["routes_out_of_date", "Service key routes out of date"],
    ["unreachable", "LiteLLM unreachable"],
  ])(
    "runs the connection test and shows the %s result",
    async (result, message) => {
      const calls = stubLiteLLM(CONFIGURED, { result, message });
      renderWithProviders(<LiteLLMPanel />);
      await screen.findByText("https://litellm.example.internal");
      await userEvent.click(
        screen.getByRole("button", { name: /test connection/i }),
      );
      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(
        calls.some(
          (c) => c.method === "POST" && c.url.includes("/connection/test"),
        ),
      ).toBe(true);
    },
  );

  it("never renders a service key value, even if one were present in a response", async () => {
    stubLiteLLM({ ...CONFIGURED, serviceKey: "sk-fake-key-000" } as Status);
    const { container } = renderWithProviders(<LiteLLMPanel />);
    await screen.findByText("https://litellm.example.internal");
    expect(container.textContent).not.toContain("sk-fake-key-000");
  });

  it("shows an inline error, not a crash, when the status request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          apiResponse(
            {
              error: {
                code: "FORBIDDEN",
                message: "internal-admin role required",
              },
            },
            403,
          ),
        ),
      ),
    );
    renderWithProviders(<LiteLLMPanel />);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/./)).toBeInTheDocument();
  });
});

// LiteLLM spec "Security architecture" item 7 (base URL "Admin-set in
// Settings", test-before-save, versioned) and implementation-phases L1 (panel:
// status, URL, edition, test; no key entry). The panel is mounted for admins
// only, so it offers the URL form unconditionally.
describe("LiteLLMPanel base URL entry", () => {
  const NEW_URL = "https://litellm-b.example.internal";

  function stubWithPut(putResponse: Response) {
    const puts: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "PUT") {
          puts.push({
            url: String(input),
            body: JSON.parse(String(init?.body ?? "null")),
          });
          return Promise.resolve(putResponse);
        }
        if (String(input).includes("/api/litellm/toggles")) {
          return Promise.resolve(apiResponse({ data: TOGGLES }));
        }
        return Promise.resolve(apiResponse({ data: CONFIGURED }));
      }),
    );
    return puts;
  }

  async function enterAndSave(url: string) {
    await screen.findByText("https://litellm.example.internal");
    const input = screen.getByLabelText(/base url/i);
    await userEvent.clear(input);
    await userEvent.type(input, url);
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
  }

  it("offers a labelled base URL input (prefilled with the stored URL) and a Save button", async () => {
    stubLiteLLM(CONFIGURED);
    renderWithProviders(<LiteLLMPanel />);
    await screen.findByText("https://litellm.example.internal");
    expect(screen.getByLabelText(/base url/i)).toHaveValue(
      "https://litellm.example.internal",
    );
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/service key|api key|secret/i)).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("sends PUT /api/litellm/connection with the URL and the current version, and shows the new URL", async () => {
    const saved = { ...CONFIGURED, baseUrl: NEW_URL, version: 4 };
    const puts = stubWithPut(apiResponse({ data: saved }));
    renderWithProviders(<LiteLLMPanel />);
    await enterAndSave(NEW_URL);
    expect(puts).toEqual([
      {
        url: "/api/litellm/connection",
        body: { baseUrl: NEW_URL, version: 3 },
      },
    ]);
    expect(await screen.findByText(NEW_URL)).toBeInTheDocument();
  });

  it("sends version null when nothing is stored yet", async () => {
    const puts: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (String(_input).includes("/api/litellm/toggles")) {
          return Promise.resolve(apiResponse({ data: TOGGLES }));
        }
        if ((init?.method ?? "GET").toUpperCase() === "PUT") {
          puts.push(JSON.parse(String(init?.body)));
          return Promise.resolve(
            apiResponse({
              data: { ...CONFIGURED, baseUrl: NEW_URL, version: 1 },
            }),
          );
        }
        return Promise.resolve(
          apiResponse({
            data: {
              baseUrl: null,
              version: 0,
              edition: "oss",
              serviceKeyConfigured: true,
            },
          }),
        );
      }),
    );
    renderWithProviders(<LiteLLMPanel />);
    await screen.findByText(/not configured/i);
    await userEvent.type(screen.getByLabelText(/base url/i), NEW_URL);
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(NEW_URL)).toBeInTheDocument();
    expect(puts).toEqual([{ baseUrl: NEW_URL, version: null }]);
  });

  it.each([
    [400, "BAD_REQUEST", "Base URL host is not allowed"],
    [409, "CONFLICT", "Connection changed, reload and retry"],
    [503, "LITELLM_UNAVAILABLE", "LiteLLM unreachable"],
  ])(
    "shows the %i error message inline and keeps the stored URL",
    async (status, code, message) => {
      stubWithPut(apiResponse({ error: { code, message } }, status));
      renderWithProviders(<LiteLLMPanel />);
      await enterAndSave(NEW_URL);
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(
        screen.getByText("https://litellm.example.internal"),
      ).toBeInTheDocument();
    },
  );
});

// L3b (LiteLLM spec -- Views by role: "Settings -> LiteLLM is tabbed the same
// way"; Design System -- Settings -> LiteLLM): tabs Connection, Guardrails,
// Team links (with a team search), Users (the shared UserSearch). Assumed:
// GET /api/litellm/team-links -> { items: [{ teamId, litellmTeamId, version,
// updatedAt }] }; Team links tab has a searchbox "Search teams" filtering the
// list by teamId or litellmTeamId (case-insensitive, client side) and a
// "No matching teams" empty state; tab state is local (not the URL).
describe("LiteLLMPanel tabs (L3b)", () => {
  const LINKS = {
    items: [
      {
        teamId: "payments",
        litellmTeamId: "ll-111",
        version: 1,
        updatedAt: "2026-11-01T00:00:00Z",
      },
      {
        teamId: "search",
        litellmTeamId: "ll-222",
        version: 2,
        updatedAt: "2026-11-02T00:00:00Z",
      },
    ],
  };

  function stubAll() {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://localhost").pathname;
        calls.push(path);
        if (path === "/api/litellm/team-links") {
          return Promise.resolve(apiResponse({ data: LINKS }));
        }
        if (path === "/api/litellm/toggles") {
          return Promise.resolve(apiResponse({ data: TOGGLES }));
        }
        return Promise.resolve(apiResponse({ data: CONFIGURED }));
      }),
    );
    return calls;
  }

  it("offers the four tabs in order, Connection selected first", async () => {
    stubAll();
    renderWithProviders(<LiteLLMPanel />);
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Connection",
      "Guardrails",
      "Team links",
      "Users",
    ]);
    expect(screen.getByRole("tab", { name: "Connection" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      await screen.findByText("https://litellm.example.internal"),
    ).toBeInTheDocument();
  });

  it("keeps connection details and the test off the other tabs, and requests team links only on its tab", async () => {
    const calls = stubAll();
    renderWithProviders(<LiteLLMPanel />);
    await screen.findByText("https://litellm.example.internal");
    expect(calls).not.toContain("/api/litellm/team-links");
    await userEvent.click(screen.getByRole("tab", { name: "Team links" }));
    expect(await screen.findByText("ll-111")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /test connection/i }),
    ).toBeNull();
  });

  it("the team search box filters the link list and shows an empty state", async () => {
    stubAll();
    renderWithProviders(<LiteLLMPanel />);
    await userEvent.click(
      await screen.findByRole("tab", { name: "Team links" }),
    );
    await screen.findByText("ll-111");
    const box = screen.getByRole("searchbox", { name: /search teams/i });
    await userEvent.type(box, "SEAR");
    expect(screen.queryByText("ll-111")).toBeNull();
    expect(screen.getByText("ll-222")).toBeInTheDocument();
    await userEvent.clear(box);
    await userEvent.type(box, "nomatch");
    expect(screen.getByText(/no matching teams/i)).toBeInTheDocument();
  });

  it("the Users tab hosts the shared user search and requests nothing until a term is typed", async () => {
    const calls = stubAll();
    renderWithProviders(<LiteLLMPanel />);
    await userEvent.click(await screen.findByRole("tab", { name: "Users" }));
    expect(
      await screen.findByRole("searchbox", { name: /search users/i }),
    ).toBeInTheDocument();
    expect(calls).not.toContain("/api/litellm/users");
  });
});
