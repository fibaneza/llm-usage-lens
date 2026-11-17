import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { LiteLLMConnectionSection } from "./LiteLLMConnectionSection";

// Source: LiteLLM spec LD24 (Connection edit: Admin only; org-admin and Auditor
// read it) and "Security architecture" item 6 (URL, edition, key status; no key
// input); Design System "Settings Page" - LiteLLM sub-tabs (unit A2: one
// section per route). Module under test:
// `components/settings/litellm-panel/LiteLLMConnectionSection.tsx`
//   <LiteLLMConnectionSection canEdit={boolean} />
// Status, connection test, wildcard warning, Base URL write payload and error
// cases moved here from the deleted LiteLLMPanel.test.tsx (unit A2 part 2);
// Security architecture item 7 (Admin-set base URL, test-before-save,
// versioned); LD19 (wildcard warning from the test result, code-only).
afterEach(() => {
  vi.unstubAllGlobals();
});

function stub() {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        apiResponse({
          data: {
            baseUrl: "https://litellm.example.internal",
            version: 1,
            edition: "oss",
            serviceKeyConfigured: true,
          },
        }),
      ),
    ),
  );
}

describe("LiteLLMConnectionSection", () => {
  it("an editor sees the status, the Base URL form and Test connection", async () => {
    stub();
    renderWithProviders(<LiteLLMConnectionSection canEdit />);
    expect(
      await screen.findByText("https://litellm.example.internal"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/base url/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /test connection/i }),
    ).toBeInTheDocument();
  });

  it("a read-only caller sees the status and no write control", async () => {
    stub();
    renderWithProviders(<LiteLLMConnectionSection canEdit={false} />);
    expect(
      await screen.findByText("https://litellm.example.internal"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/base url/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^save/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /test connection/i }),
    ).toBeNull();
  });

  it("does not render the other sections' content or tabs", async () => {
    stub();
    renderWithProviders(<LiteLLMConnectionSection canEdit />);
    await screen.findByText("https://litellm.example.internal");
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });
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

function stubLiteLLM(status: Status, testData?: unknown) {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ url, method });
      if (url.includes("/api/litellm/connection/test")) {
        return Promise.resolve(apiResponse({ data: testData }));
      }
      return Promise.resolve(apiResponse({ data: status }));
    }),
  );
  return calls;
}

describe("LiteLLMConnectionSection status (Security architecture item 6)", () => {
  it("shows the base URL, a read-only edition and 'service key configured: yes'", async () => {
    stubLiteLLM(CONFIGURED);
    renderWithProviders(<LiteLLMConnectionSection canEdit />);
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
    renderWithProviders(<LiteLLMConnectionSection canEdit />);
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
    renderWithProviders(<LiteLLMConnectionSection canEdit />);
    await screen.findByText("https://litellm.example.internal");
    expect(
      screen.queryByLabelText(/service key|api key|secret|token/i),
    ).toBeNull();
    expect(screen.queryByLabelText(/edition/i)).toBeNull();
    expect(screen.queryByDisplayValue(/sk-/)).not.toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("never renders a service key value, even if one were present in a response", async () => {
    stubLiteLLM({ ...CONFIGURED, serviceKey: "sk-fake-key-000" } as Status);
    const { container } = renderWithProviders(
      <LiteLLMConnectionSection canEdit />,
    );
    await screen.findByText("https://litellm.example.internal");
    expect(container.textContent).not.toContain("sk-fake-key-000");
  });

  it("shows a loading skeleton before the status arrives", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const { container } = renderWithProviders(
      <LiteLLMConnectionSection canEdit />,
    );
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
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
    renderWithProviders(<LiteLLMConnectionSection canEdit />);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/./)).toBeInTheDocument();
  });
});

describe("LiteLLMConnectionSection read-only (LD24: Connection edit is Admin only)", () => {
  it("shows the details but no URL form, Save or test, and sends only GET requests", async () => {
    const calls = stubLiteLLM(CONFIGURED);
    renderWithProviders(<LiteLLMConnectionSection canEdit={false} />);
    expect(
      await screen.findByText("https://litellm.example.internal"),
    ).toBeInTheDocument();
    expect(screen.getByText(/service key configured/i)).toHaveTextContent(
      /yes/i,
    );
    expect(screen.queryByLabelText(/base url/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^save/i })).toBeNull();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });
});

describe("LiteLLMConnectionSection connection test (Security architecture item 7)", () => {
  it.each([
    ["ok", "Connection ok"],
    ["unauthorised", "Service key rejected - rotate and redeploy"],
    ["routes_out_of_date", "Service key routes out of date"],
    ["unreachable", "LiteLLM unreachable"],
  ])(
    "runs the connection test and shows the %s result",
    async (result, message) => {
      const calls = stubLiteLLM(CONFIGURED, { result, message });
      renderWithProviders(<LiteLLMConnectionSection canEdit />);
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
});

describe("LiteLLMConnectionSection base URL entry (Security architecture item 7)", () => {
  const NEW_URL = "https://litellm-b.example.internal";

  function stubWithPut(putResponse: Response, status: Status = CONFIGURED) {
    const puts: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? "GET").toUpperCase() === "PUT") {
          puts.push({
            url: String(input),
            body: JSON.parse(String(init?.body ?? "null")),
          });
          return Promise.resolve(putResponse);
        }
        return Promise.resolve(apiResponse({ data: status }));
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

  it("offers a labelled base URL input prefilled with the stored URL, and a Save button", async () => {
    stubLiteLLM(CONFIGURED);
    renderWithProviders(<LiteLLMConnectionSection canEdit />);
    await screen.findByText("https://litellm.example.internal");
    expect(screen.getByLabelText(/base url/i)).toHaveValue(
      "https://litellm.example.internal",
    );
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
  });

  it("sends PUT /api/litellm/connection with the URL and the current version, and shows the new URL", async () => {
    const puts = stubWithPut(
      apiResponse({ data: { ...CONFIGURED, baseUrl: NEW_URL, version: 4 } }),
    );
    renderWithProviders(<LiteLLMConnectionSection canEdit />);
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
    const puts = stubWithPut(
      apiResponse({ data: { ...CONFIGURED, baseUrl: NEW_URL, version: 1 } }),
      {
        baseUrl: null,
        version: 0,
        edition: "oss",
        serviceKeyConfigured: true,
      },
    );
    renderWithProviders(<LiteLLMConnectionSection canEdit />);
    await screen.findByText(/not configured/i);
    await userEvent.type(screen.getByLabelText(/base url/i), NEW_URL);
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(NEW_URL)).toBeInTheDocument();
    expect(puts.map((p) => p.body)).toEqual([
      { baseUrl: NEW_URL, version: null },
    ]);
  });

  it.each([
    [400, "BAD_REQUEST", "Base URL host is not allowed"],
    [409, "CONFLICT", "Connection changed, reload and retry"],
    [503, "LITELLM_UNAVAILABLE", "LiteLLM unreachable"],
  ])(
    "shows the %i error message inline and keeps the stored URL",
    async (status, code, message) => {
      stubWithPut(apiResponse({ error: { code, message } }, status));
      renderWithProviders(<LiteLLMConnectionSection canEdit />);
      await enterAndSave(NEW_URL);
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(
        screen.getByText("https://litellm.example.internal"),
      ).toBeInTheDocument();
    },
  );
});

// LiteLLM spec "Gateway guardrails" item 6 / LD19 (amended 2026-11-15): the
// temporary-wildcards warning comes from the connection test result only.
describe("LiteLLMConnectionSection wildcard warning", () => {
  const WILDCARD = "service key uses temporary wildcards (`/team/*`, `/key/*`)";

  async function runTest() {
    await userEvent.click(
      await screen.findByRole("button", { name: /test connection/i }),
    );
  }

  it("is absent before the test and when the result has no warnings", async () => {
    stubLiteLLM(CONFIGURED, {
      result: "ok",
      message: "Connection ok",
      warnings: [],
    });
    renderWithProviders(<LiteLLMConnectionSection canEdit />);
    await screen.findByRole("button", { name: /test connection/i });
    expect(screen.queryByTestId("litellm-wildcard-warning")).toBeNull();
    await runTest();
    expect(await screen.findByText("Connection ok")).toBeInTheDocument();
    expect(screen.queryByTestId("litellm-wildcard-warning")).toBeNull();
    expect(screen.queryByText(/temporary wildcards/i)).toBeNull();
  });

  it("is shown as a status region (not an alert) when the test returns the warning", async () => {
    stubLiteLLM(CONFIGURED, {
      result: "ok",
      message: "Connection ok",
      warnings: [WILDCARD],
    });
    renderWithProviders(<LiteLLMConnectionSection canEdit />);
    await runTest();
    const w = await screen.findByTestId("litellm-wildcard-warning");
    expect(w).toHaveTextContent(/temporary wildcards/i);
    expect(w).toHaveTextContent("/team/*");
    expect(w).toHaveTextContent("/key/*");
    expect(w).toHaveAttribute("role", "status");
    expect(within(w).queryByRole("alert")).toBeNull();
  });
});
