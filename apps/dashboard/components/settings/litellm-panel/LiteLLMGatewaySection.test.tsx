import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { LiteLLMGatewaySection } from "./LiteLLMGatewaySection";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage
// (L6)" -> Gateway configuration (principals: iam-role | usage-key, accountIds
// 12 digits; versioned PUT, stale -> 409; both lists empty = clear; Route:
// GET Admin/org-admin/Auditor, PUT Admin), Where each figure appears
// ("Settings -> LiteLLM -> Gateway: Admin edits the principal and account
// lists; Auditor and org-admin read only (configuration writes are
// Admin-only, LD24). Save sends `version`; `409` shows 'Changed elsewhere —
// reload'"); Design System "Settings Page" (LiteLLM sub-tabs). Same
// `canEdit` prop contract as the other litellm-panel sections.
// Module under test: `components/settings/litellm-panel/LiteLLMGatewaySection.tsx`
//   <LiteLLMGatewaySection canEdit={boolean} />   (client)
// GET /api/litellm/gateway -> BedrockGatewayView; PUT body
// { version: number | null, principals, accountIds } (version null when the
// view's version is 0, i.e. nothing stored yet). Contract (canEdit):
//   a group "Principals": per row 1..n a select "Principal 1 type" (options
//   "IAM role" -> iam-role, "Usage key" -> usage-key), a textbox "Principal 1
//   value" and a button "Remove principal 1"; a button "Add principal"; a
//   group "Account IDs": per row a textbox "Account ID 1" and a button
//   "Remove account 1"; "Add account"; a "Save" button.
//   Saved -> role="status" "Saved". 409 -> role="alert" "Changed elsewhere —
//   reload". 400 -> role="alert" with the server's message. Read-only
//   (canEdit=false): values as text, no inputs, no Save/Add/Remove controls.
//   Empty and not editable -> role="status" "No gateway configured." (empty
//   and editable -> the same text plus the Add controls).
afterEach(() => {
  vi.unstubAllGlobals();
});

const VIEW = {
  gatewayConfigured: true,
  version: 3,
  principals: [
    { type: "iam-role", value: "litellm-gateway" },
    { type: "usage-key", value: "AROAEXAMPLE:svc" },
  ],
  accountIds: ["111122223333"],
  updatedAt: "2026-11-14T10:00:00.000Z",
  updatedBy: "oid-admin",
};
const EMPTY = {
  gatewayConfigured: false,
  version: 0,
  principals: [],
  accountIds: [],
};

type Put = {
  version: number | null;
  principals: unknown[];
  accountIds: string[];
};

function stub(view: unknown, put?: () => Response) {
  const puts: Put[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      expect(new URL(String(input), "http://localhost").pathname).toBe(
        "/api/litellm/gateway",
      );
      if (init?.method === "PUT") {
        puts.push(JSON.parse(String(init.body)) as Put);
        return Promise.resolve(
          put?.() ??
            apiResponse({
              data: { ...VIEW, version: 4 },
            }),
        );
      }
      return Promise.resolve(apiResponse({ data: view }));
    }),
  );
  return puts;
}

describe("LiteLLMGatewaySection - editor (Admin)", () => {
  it("shows the stored principals with their type and the account ids as editable rows", async () => {
    stub(VIEW);
    renderWithProviders(<LiteLLMGatewaySection canEdit />);
    expect(await screen.findByLabelText("Principal 1 value")).toHaveValue(
      "litellm-gateway",
    );
    expect(screen.getByLabelText("Principal 1 type")).toHaveDisplayValue(
      "IAM role",
    );
    expect(screen.getByLabelText("Principal 2 type")).toHaveDisplayValue(
      "Usage key",
    );
    expect(screen.getByLabelText("Principal 2 value")).toHaveValue(
      "AROAEXAMPLE:svc",
    );
    expect(screen.getByLabelText("Account ID 1")).toHaveValue("111122223333");
  });

  it("saves an edited list with the version it loaded", async () => {
    const puts = stub(VIEW);
    const user = userEvent.setup();
    renderWithProviders(<LiteLLMGatewaySection canEdit />);
    const value = await screen.findByLabelText("Principal 1 value");
    await user.clear(value);
    await user.type(value, "new-role");
    await user.selectOptions(screen.getByLabelText("Principal 2 type"), [
      "IAM role",
    ]);
    await user.click(screen.getByRole("button", { name: "Add account" }));
    await user.type(screen.getByLabelText("Account ID 2"), "000000000002");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
    expect(puts).toEqual([
      {
        version: 3,
        principals: [
          { type: "iam-role", value: "new-role" },
          { type: "iam-role", value: "AROAEXAMPLE:svc" },
        ],
        accountIds: ["111122223333", "000000000002"],
      },
    ]);
  });

  it("creates the first configuration with version null and removes rows", async () => {
    const puts = stub(EMPTY);
    const user = userEvent.setup();
    renderWithProviders(<LiteLLMGatewaySection canEdit />);
    await user.click(
      await screen.findByRole("button", { name: "Add principal" }),
    );
    await user.type(screen.getByLabelText("Principal 1 value"), "gw-role");
    await user.click(screen.getByRole("button", { name: "Add principal" }));
    await user.click(
      screen.getByRole("button", { name: "Remove principal 2" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({
      version: null,
      principals: [{ type: "iam-role", value: "gw-role" }],
      accountIds: [],
    });
  });

  it("can clear the configuration: both lists empty are sent", async () => {
    const puts = stub(VIEW);
    const user = userEvent.setup();
    renderWithProviders(<LiteLLMGatewaySection canEdit />);
    await user.click(
      await screen.findByRole("button", { name: "Remove principal 2" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Remove principal 1" }),
    );
    await user.click(screen.getByRole("button", { name: "Remove account 1" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ version: 3, principals: [], accountIds: [] });
  });

  it("409 shows 'Changed elsewhere — reload'", async () => {
    stub(VIEW, () =>
      apiResponse({ error: { code: "CONFLICT", message: "reload" } }, 409),
    );
    renderWithProviders(<LiteLLMGatewaySection canEdit />);
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Changed elsewhere — reload",
    );
  });

  it("400 shows the server's validation message", async () => {
    stub(VIEW, () =>
      apiResponse(
        { error: { code: "BAD_REQUEST", message: "Unknown account id" } },
        400,
      ),
    );
    renderWithProviders(<LiteLLMGatewaySection canEdit />);
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unknown account id",
    );
  });

  it("an empty configuration says so and still offers the Add controls", async () => {
    stub(EMPTY);
    renderWithProviders(<LiteLLMGatewaySection canEdit />);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "No gateway configured.",
    );
    expect(
      screen.getByRole("button", { name: "Add principal" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add account" }),
    ).toBeInTheDocument();
  });
});

describe("LiteLLMGatewaySection - read only (Auditor, org-admin)", () => {
  it("shows the values as text and offers no input or write control", async () => {
    stub(VIEW);
    renderWithProviders(<LiteLLMGatewaySection canEdit={false} />);
    const principals = await screen.findByRole("group", { name: "Principals" });
    expect(within(principals).getByText("litellm-gateway")).toBeInTheDocument();
    expect(within(principals).getByText("AROAEXAMPLE:svc")).toBeInTheDocument();
    expect(screen.getByText("111122223333")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    for (const name of [/^save$/i, /^add /i, /^remove /i]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("says nothing is configured when the view is empty", async () => {
    stub(EMPTY);
    renderWithProviders(<LiteLLMGatewaySection canEdit={false} />);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "No gateway configured.",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});
