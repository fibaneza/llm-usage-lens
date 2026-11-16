import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  INTERNAL_ADMIN_ROLE,
  INTERNAL_AUDITOR_ROLE,
  INTERNAL_ORG_ADMIN_ROLE,
} from "@/lib/auth/roles";
import { litellmPanelCapabilities } from "@/lib/auth/litellm-panel";
import { apiResponse } from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

import { LiteLLMPanel } from "./LiteLLMPanel";

// Source: docs/specs/2026-11-10-litellm.md LD24 (org-admin edits Guardrails and
// Team links, Connection read-only; Auditor read-only), LT20 / LT22 (writes are
// Admin / org-admin only), "API routes" (/api/litellm/connection PUT Admin only;
// toggles and team-links writes Admin + org-admin); implementation-phases
// L3d2; Design System -- Settings -> LiteLLM (read-only for internal-auditor).
// One layer per behaviour (Rule 60.24a): the role x section matrix lives here;
// the toggle / connection write payloads are covered in the sibling files.
// `fetch` is stubbed (Rule 60.24).
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const CONNECTION = {
  baseUrl: "https://litellm.example.internal",
  version: 3,
  edition: "oss",
  serviceKeyConfigured: true,
};
const TOGGLES = {
  version: 5,
  edition: "oss",
  operations: {
    createTeam: { enabled: false, source: "ui" },
    getTeam: { enabled: true, source: "file" },
  },
};
const link = (teamId: string, litellmTeamId: string, version = 1) => ({
  teamId,
  litellmTeamId,
  version,
  updatedAt: "2026-11-01T00:00:00Z",
});

type Call = { path: string; method: string; body: unknown };

// Stateful stub: GET /team-links reflects earlier writes.
function stub(
  opts: { links?: ReturnType<typeof link>[]; put?: Response } = {},
) {
  let links = opts.links ?? [
    link("payments", "ll-111"),
    link("search", "ll-222", 2),
  ];
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({
        path,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (path.startsWith("/api/litellm/team-links/")) {
        const teamId = decodeURIComponent(path.split("/").pop() ?? "");
        if (method === "DELETE") {
          links = links.filter((l) => l.teamId !== teamId);
          return Promise.resolve(apiResponse({ data: { teamId } }));
        }
        if (method === "PUT") {
          if (opts.put) return Promise.resolve(opts.put);
          const body = JSON.parse(String(init?.body)) as {
            litellmTeamId: string;
            version: number | null;
          };
          const saved = link(
            teamId,
            body.litellmTeamId,
            (body.version ?? 0) + 1,
          );
          links = [...links.filter((l) => l.teamId !== teamId), saved];
          return Promise.resolve(apiResponse({ data: saved }));
        }
      }
      if (path === "/api/litellm/team-links") {
        return Promise.resolve(apiResponse({ data: { items: links } }));
      }
      if (path === "/api/litellm/toggles") {
        return Promise.resolve(apiResponse({ data: TOGGLES }));
      }
      return Promise.resolve(apiResponse({ data: CONNECTION }));
    }),
  );
  return calls;
}

const writesOf = (calls: Call[]) => calls.filter((c) => c.method !== "GET");

// [name, roles, editConnection, editGuardrails, editTeamLinks] -- LD24.
const ROLES: Array<[string, string[], boolean, boolean, boolean]> = [
  ["internal-admin", [INTERNAL_ADMIN_ROLE], true, true, true],
  ["internal-org-admin", [INTERNAL_ORG_ADMIN_ROLE], false, true, true],
  ["internal-auditor", [INTERNAL_AUDITOR_ROLE], false, false, false],
];

function renderFor(roles: string[]) {
  const { editConnection, editGuardrails, editTeamLinks } =
    litellmPanelCapabilities(roles);
  return renderWithProviders(
    <LiteLLMPanel
      capabilities={{ editConnection, editGuardrails, editTeamLinks }}
    />,
  );
}

describe("LiteLLMPanel role x section matrix (LD24)", () => {
  it.each(ROLES)(
    "%s: Connection shows details; URL form and test only when editable",
    async (_n, roles, editConnection) => {
      stub();
      renderFor(roles);
      expect(await screen.findByText(CONNECTION.baseUrl)).toBeInTheDocument();
      expect(screen.getByText(/service key configured/i)).toHaveTextContent(
        /yes/i,
      );
      expect(screen.getByText(/oss/i)).toBeInTheDocument();
      const present = (el: HTMLElement | null) => el !== null;
      expect(present(screen.queryByLabelText(/base url/i))).toBe(
        editConnection,
      );
      expect(present(screen.queryByRole("button", { name: /^save$/i }))).toBe(
        editConnection,
      );
      expect(
        present(screen.queryByRole("button", { name: /test connection/i })),
      ).toBe(editConnection);
    },
  );

  it.each(ROLES)(
    "%s: Guardrails shows values and sources; switches and reset only when editable",
    async (_n, roles, _c, editGuardrails) => {
      stub();
      renderFor(roles);
      await userEvent.click(
        await screen.findByRole("tab", { name: "Guardrails" }),
      );
      const row = await screen.findByTestId("litellm-op-createTeam");
      expect(
        screen.getByTestId("litellm-op-source-createTeam"),
      ).toHaveTextContent(/^ui$/);
      expect(screen.getByTestId("litellm-op-source-getTeam")).toHaveTextContent(
        /^file$/,
      );
      expect(
        screen.getByRole("region", { name: /enforced in code/i }),
      ).toBeVisible();
      if (editGuardrails) {
        expect(screen.getAllByRole("switch")).toHaveLength(2);
        expect(
          screen.getByRole("button", { name: /reset to file defaults/i }),
        ).toBeInTheDocument();
      } else {
        expect(screen.queryAllByRole("switch")).toHaveLength(0);
        expect(
          screen.queryByRole("button", { name: /reset to file defaults/i }),
        ).toBeNull();
        expect(row).toHaveTextContent(/off/i);
        expect(screen.getByTestId("litellm-op-getTeam")).toHaveTextContent(
          /on/i,
        );
      }
    },
  );

  it.each(ROLES)(
    "%s: Team links shows list and search; Unlink and the Link form only when editable",
    async (_n, roles, _c, _g, editTeamLinks) => {
      stub();
      renderFor(roles);
      await userEvent.click(
        await screen.findByRole("tab", { name: "Team links" }),
      );
      expect(await screen.findByText("ll-111")).toBeInTheDocument();
      expect(
        screen.getByRole("searchbox", { name: /search teams/i }),
      ).toBeInTheDocument();
      const unlinks = screen.queryAllByRole("button", { name: /^unlink /i });
      const form = screen.queryByLabelText("Dashboard team ID");
      if (editTeamLinks) {
        expect(
          unlinks.map((b) => b.getAttribute("aria-label") ?? b.textContent),
        ).toEqual(["Unlink payments", "Unlink search"]);
        expect(form).not.toBeNull();
        expect(screen.getByLabelText("LiteLLM team ID")).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: /^link$/i }),
        ).toBeInTheDocument();
      } else {
        expect(unlinks).toHaveLength(0);
        expect(form).toBeNull();
        expect(screen.queryByLabelText("LiteLLM team ID")).toBeNull();
        expect(screen.queryByRole("button", { name: /^link$/i })).toBeNull();
      }
    },
  );

  it.each(ROLES)(
    "%s: the Users tab is the same for every role",
    async (_n, roles) => {
      stub();
      renderFor(roles);
      await userEvent.click(await screen.findByRole("tab", { name: "Users" }));
      expect(
        await screen.findByRole("searchbox", { name: /search users/i }),
      ).toBeInTheDocument();
    },
  );

  // LT20 / LT22: a read-only panel never issues a write.
  it("a read-only panel issues only GET requests across every tab", async () => {
    const calls = stub();
    renderFor([INTERNAL_AUDITOR_ROLE]);
    await screen.findByText(CONNECTION.baseUrl);
    for (const tab of ["Guardrails", "Team links", "Users"]) {
      await userEvent.click(screen.getByRole("tab", { name: tab }));
    }
    await screen.findByText("ll-111");
    expect(calls.length).toBeGreaterThan(0);
    expect(writesOf(calls)).toEqual([]);
  });

  // Org-admin: the connection is Admin-only (LD24), so no connection write.
  it("an org-admin never requests a connection write or test", async () => {
    const calls = stub();
    renderFor([INTERNAL_ORG_ADMIN_ROLE]);
    await screen.findByText(CONNECTION.baseUrl);
    await userEvent.click(screen.getByRole("tab", { name: "Guardrails" }));
    await userEvent.click(
      await screen.findByRole("switch", { name: "getTeam" }),
    );
    await waitFor(() => expect(writesOf(calls).length).toBeGreaterThan(0));
    expect(
      writesOf(calls).every((c) => c.path === "/api/litellm/toggles"),
    ).toBe(true);
  });
});

// L3d2 / LD24: team-link writes in the Team links tab (editTeamLinks). The
// DELETE route (app/api/litellm/team-links/[teamId]/route.ts) reads no body,
// so Unlink sends DELETE with no body; PUT takes { litellmTeamId, version }
// with version null to create (PutBodySchema).
describe("LiteLLMPanel team link writes (editTeamLinks)", () => {
  async function openLinks() {
    renderFor([INTERNAL_ORG_ADMIN_ROLE]);
    await userEvent.click(
      await screen.findByRole("tab", { name: "Team links" }),
    );
    await screen.findByText("ll-111");
  }

  it("Unlink asks for inline confirmation (no browser dialog) and Cancel sends nothing", async () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    const calls = stub();
    await openLinks();
    await userEvent.click(
      screen.getByRole("button", { name: "Unlink payments" }),
    );
    expect(
      screen.getByRole("button", { name: /^confirm unlink$/i }),
    ).toBeInTheDocument();
    expect(writesOf(calls)).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(
      screen.queryByRole("button", { name: /^confirm unlink$/i }),
    ).toBeNull();
    expect(writesOf(calls)).toEqual([]);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("confirming sends DELETE /api/litellm/team-links/<teamId> with no body and the row disappears", async () => {
    const calls = stub();
    await openLinks();
    await userEvent.click(
      screen.getByRole("button", { name: "Unlink payments" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /^confirm unlink$/i }),
    );
    await waitFor(() => expect(screen.queryByText("ll-111")).toBeNull());
    expect(writesOf(calls)).toEqual([
      {
        path: "/api/litellm/team-links/payments",
        method: "DELETE",
        body: undefined,
      },
    ]);
    expect(screen.getByText("ll-222")).toBeInTheDocument();
  });

  it("an unlink failure shows inline and keeps the row", async () => {
    const calls = stub();
    await openLinks();
    const original = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        (init?.method ?? "GET") === "DELETE"
          ? Promise.resolve(
              apiResponse(
                {
                  error: {
                    code: "CONFLICT",
                    message: "The link was changed; reload",
                  },
                },
                409,
              ),
            )
          : original(input, init),
      ),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Unlink payments" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /^confirm unlink$/i }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The link was changed; reload",
    );
    expect(screen.getByText("ll-111")).toBeInTheDocument();
    expect(calls.length).toBeGreaterThan(0);
  });

  it("the Link form sends PUT /api/litellm/team-links/<teamId> with version null and the list shows the new link", async () => {
    const calls = stub();
    await openLinks();
    await userEvent.type(screen.getByLabelText("Dashboard team ID"), "growth");
    await userEvent.type(screen.getByLabelText("LiteLLM team ID"), "ll-333");
    await userEvent.click(screen.getByRole("button", { name: /^link$/i }));
    expect(await screen.findByText("ll-333")).toBeInTheDocument();
    expect(writesOf(calls)).toEqual([
      {
        path: "/api/litellm/team-links/growth",
        method: "PUT",
        body: { litellmTeamId: "ll-333", version: null },
      },
    ]);
  });

  it("re-linking an already linked team sends that link's current version", async () => {
    const calls = stub();
    await openLinks();
    await userEvent.type(screen.getByLabelText("Dashboard team ID"), "search");
    await userEvent.type(screen.getByLabelText("LiteLLM team ID"), "ll-999");
    await userEvent.click(screen.getByRole("button", { name: /^link$/i }));
    expect(await screen.findByText("ll-999")).toBeInTheDocument();
    expect(writesOf(calls).map((c) => c.body)).toEqual([
      { litellmTeamId: "ll-999", version: 2 },
    ]);
  });

  it.each([
    [404, "NOT_FOUND", "Not found"],
    [409, "CONFLICT", "The link was changed or is in use"],
  ])(
    "a %i from the server shows inline (role=alert)",
    async (status, code, message) => {
      stub({ put: apiResponse({ error: { code, message } }, status) });
      await openLinks();
      await userEvent.type(
        screen.getByLabelText("Dashboard team ID"),
        "growth",
      );
      await userEvent.type(screen.getByLabelText("LiteLLM team ID"), "ll-333");
      await userEvent.click(screen.getByRole("button", { name: /^link$/i }));
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(screen.queryByText("ll-333")).toBeNull();
    },
  );
});
