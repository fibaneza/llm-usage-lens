import { IdentityMapRulesInputSchema } from "@llm-usage-lens/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { IdentityMapRulesEditor } from "./IdentityMapRulesEditor";

// Source: docs/specs/2026-11-10-access-control.md - "Usage-identity mapping
// rules (D27)": an internal-admin defines rules in Settings (a pattern with one
// `{name}` placeholder over the session name, a template for the email), stored
// in one versioned, audited item; rules only suggest, never grant access.
// "Roles" (configuration is internal-admin only; the auditor reads), "Enforcement"
// item 6 (a stale version -> 409 CONFLICT), Rule 60.17 (errors surface), Rule
// 60.24, design system (Skeleton fallback, empty states, Dialog for add/edit,
// confirmation before delete).
// Module under test (new, a client component):
// `components/settings/IdentityMapRulesEditor.tsx`,
// `IdentityMapRulesEditor({ isAdmin }: { isAdmin: boolean })`, beside the other
// Settings panels (`AccountRegistry`, `SyncStatusPanel`, `LiteLLMPanel`). It
// reads GET /api/governance/identity-map-rules and writes the whole ordered
// list with PUT { rules, version } (routes derived from D27; the spec lists none).
// Control names it must expose: "Add rule" (button), labelled fields "Pattern"
// and "Email template", "Save rule" (submit), "Edit rule <pattern>", "Delete
// rule <pattern>" (then a confirmation "Delete"), "Move rule <pattern> up" and
// "Move rule <pattern> down". The first rule that matches decides; the panel
// says so ("first matching rule").
const RULES_PATH = "/api/governance/identity-map-rules";
const SSO = { pattern: "{name}-sso", template: "{name}@company.com" };
const SVC = { pattern: "svc-{name}", template: "{name}@company.com" };

type Rule = { pattern: string; template: string };
type Call = { method: string; path: string; body: unknown };

function stubRules(
  initial: Rule[],
  options: {
    version?: number;
    write?: (call: Call) => Response | undefined;
  } = {},
) {
  let rules = initial;
  let version = options.version ?? (initial.length > 0 ? 3 : 0);
  const writes: Call[] = [];
  let listFetches = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const method = init?.method ?? "GET";
      if (method === "GET") {
        expect(path).toBe(RULES_PATH);
        listFetches += 1;
        return apiResponse({ data: { rules, version } });
      }
      const call: Call = {
        method,
        path,
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      };
      writes.push(call);
      const custom = options.write?.(call);
      if (custom) return custom;
      const body = call.body as { rules: Rule[] };
      rules = body.rules;
      version += 1;
      return apiResponse({
        data: { rules, version, updatedAt: "2026-11-15T09:30:00.000Z" },
      });
    }),
  );
  return { writes: () => [...writes], listFetches: () => listFetches };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function pasteInto(
  user: ReturnType<typeof userEvent.setup>,
  field: HTMLElement,
  text: string,
) {
  // `{` starts a key descriptor in user-event's type(); paste inserts literally.
  await user.clear(field);
  await user.click(field);
  await user.paste(text);
}

describe("IdentityMapRulesEditor -- list", () => {
  it("lists every rule in order with its pattern and email template", async () => {
    stubRules([SSO, SVC]);
    renderWithProviders(<IdentityMapRulesEditor isAdmin />);
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(
      within(rows[0] as HTMLElement).getByText("{name}-sso"),
    ).toBeVisible();
    expect(
      within(rows[0] as HTMLElement).getByText("{name}@company.com"),
    ).toBeVisible();
    expect(
      within(rows[1] as HTMLElement).getByText("svc-{name}"),
    ).toBeVisible();
  });

  it("explains that the first matching rule decides and that a rule only suggests a link", async () => {
    stubRules([SSO]);
    renderWithProviders(<IdentityMapRulesEditor isAdmin />);
    await screen.findByRole("table");
    expect(screen.getByText(/first matching rule/i)).toBeInTheDocument();
    expect(screen.getAllByText(/suggest/i).length).toBeGreaterThan(0);
  });

  it("shows an empty state when there are no rules (an admin can still add one)", async () => {
    stubRules([]);
    renderWithProviders(<IdentityMapRulesEditor isAdmin />);
    expect(await screen.findByText(/no mapping rules/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add rule/i }),
    ).toBeInTheDocument();
  });

  it("shows a skeleton while loading", () => {
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    const { container } = renderWithProviders(
      <IdentityMapRulesEditor isAdmin />,
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  });

  it("shows a readable error when the list cannot be loaded", async () => {
    vi.stubGlobal("fetch", async () => apiError(500, "INTERNAL", "boom"));
    renderWithProviders(<IdentityMapRulesEditor isAdmin />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("IdentityMapRulesEditor -- role gating", () => {
  it("shows the rules but renders no add, edit, delete or move control for a non-admin (the auditor)", async () => {
    stubRules([SSO, SVC]);
    renderWithProviders(<IdentityMapRulesEditor isAdmin={false} />);
    await screen.findByRole("table");
    expect(screen.getByText("{name}-sso")).toBeVisible();
    for (const name of [
      /add rule/i,
      /edit rule/i,
      /delete rule/i,
      /move rule/i,
    ]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("renders the controls for an admin; the first rule cannot move up and the last cannot move down", async () => {
    stubRules([SSO, SVC]);
    renderWithProviders(<IdentityMapRulesEditor isAdmin />);
    await screen.findByRole("table");
    expect(
      screen.getByRole("button", { name: "Edit rule {name}-sso" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Delete rule svc-{name}" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Move rule {name}-sso up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move rule {name}-sso down" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Move rule svc-{name} down" }),
    ).toBeDisabled();
  });

  it("disables Add at the 20-rule cap", async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => ({
      pattern: `p${i}-{name}`,
      template: "{name}@company.com",
    }));
    stubRules(twenty);
    renderWithProviders(<IdentityMapRulesEditor isAdmin />);
    await screen.findByRole("table");
    expect(screen.getByRole("button", { name: /add rule/i })).toBeDisabled();
  });
});

describe("IdentityMapRulesEditor -- add", () => {
  async function openAdd() {
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: /add rule/i }));
    const dialog = await screen.findByRole("dialog");
    return { user, dialog };
  }

  it("validates with the shared schema: field errors, invalid fields, and nothing is sent", async () => {
    const api = stubRules([SSO]);
    renderWithProviders(<IdentityMapRulesEditor isAdmin />);
    const { user, dialog } = await openAdd();
    await pasteInto(user, within(dialog).getByLabelText("Pattern"), "jane");
    await pasteInto(
      user,
      within(dialog).getByLabelText("Email template"),
      "{name}",
    );
    await user.click(within(dialog).getByRole("button", { name: "Save rule" }));

    expect(await within(dialog).findAllByRole("alert")).not.toHaveLength(0);
    expect(within(dialog).getByLabelText("Pattern")).toBeInvalid();
    expect(within(dialog).getByLabelText("Email template")).toBeInvalid();
    expect(api.writes()).toHaveLength(0);
  });

  it("rejects an empty form without sending", async () => {
    const api = stubRules([SSO]);
    renderWithProviders(<IdentityMapRulesEditor isAdmin />);
    const { user, dialog } = await openAdd();
    await user.click(within(dialog).getByRole("button", { name: "Save rule" }));
    expect(await within(dialog).findAllByRole("alert")).not.toHaveLength(0);
    expect(api.writes()).toHaveLength(0);
  });

  it("rejects a pattern that already exists (compared case-insensitively) without sending", async () => {
    const api = stubRules([SSO]);
    renderWithProviders(<IdentityMapRulesEditor isAdmin />);
    const { user, dialog } = await openAdd();
    await pasteInto(
      user,
      within(dialog).getByLabelText("Pattern"),
      "{name}-SSO",
    );
    await pasteInto(
      user,
      within(dialog).getByLabelText("Email template"),
      "{name}@other.example",
    );
    await user.click(within(dialog).getByRole("button", { name: "Save rule" }));
    expect(await within(dialog).findAllByRole("alert")).not.toHaveLength(0);
    expect(within(dialog).getByLabelText("Pattern")).toBeInvalid();
    expect(api.writes()).toHaveLength(0);
  });

  it("PUTs the whole list with the new rule last and the loaded version, closes the dialog and refetches", async () => {
    const api = stubRules([SSO], { version: 3 });
    renderWithProviders(<IdentityMapRulesEditor isAdmin />);
    const { user, dialog } = await openAdd();
    await pasteInto(
      user,
      within(dialog).getByLabelText("Pattern"),
      "svc-{name}",
    );
    await pasteInto(
      user,
      within(dialog).getByLabelText("Email template"),
      "{name}@company.com",
    );
    await user.click(within(dialog).getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    const [call] = api.writes();
    expect(call?.method).toBe("PUT");
    expect(call?.path).toBe(RULES_PATH);
    expect(call?.body).toMatchObject({ rules: [SSO, SVC], version: 3 });
    expect(
      IdentityMapRulesInputSchema.safeParse({
        rules: (call?.body as { rules: Rule[] }).rules,
      }).success,
    ).toBe(true);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(api.listFetches()).toBeGreaterThanOrEqual(2));
    expect(await screen.findByText("svc-{name}")).toBeVisible();
  });

  it("adds the first rule at version 0", async () => {
    const api = stubRules([]);
    renderWithProviders(<IdentityMapRulesEditor isAdmin />);
    const user = userEvent.setup();
    await screen.findByText(/no mapping rules/i);
    await user.click(screen.getByRole("button", { name: /add rule/i }));
    const dialog = await screen.findByRole("dialog");
    await pasteInto(
      user,
      within(dialog).getByLabelText("Pattern"),
      "{name}-sso",
    );
    await pasteInto(
      user,
      within(dialog).getByLabelText("Email template"),
      "{name}@company.com",
    );
    await user.click(within(dialog).getByRole("button", { name: "Save rule" }));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toMatchObject({ rules: [SSO], version: 0 });
  });
});

describe("IdentityMapRulesEditor -- edit, reorder, delete", () => {
  it("opens the rule prefilled and PUTs it replaced in place, keeping the order", async () => {
    const api = stubRules([SSO, SVC], { version: 5 });
    renderWithProviders(<IdentityMapRulesEditor isAdmin />);
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.click(
      screen.getByRole("button", { name: "Edit rule {name}-sso" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Pattern")).toHaveValue("{name}-sso");
    expect(within(dialog).getByLabelText("Email template")).toHaveValue(
      "{name}@company.com",
    );

    await pasteInto(
      user,
      within(dialog).getByLabelText("Email template"),
      "{name}@corp.example",
    );
    await user.click(within(dialog).getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toMatchObject({
      rules: [{ pattern: "{name}-sso", template: "{name}@corp.example" }, SVC],
      version: 5,
    });
  });

  it("editing a rule does not count its own pattern as a duplicate", async () => {
    const api = stubRules([SSO]);
    renderWithProviders(<IdentityMapRulesEditor isAdmin />);
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.click(
      screen.getByRole("button", { name: "Edit rule {name}-sso" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save rule" }));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
  });

  it("moves a rule down: PUTs the list with the two swapped", async () => {
    const api = stubRules([SSO, SVC], { version: 2 });
    renderWithProviders(<IdentityMapRulesEditor isAdmin />);
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.click(
      screen.getByRole("button", { name: "Move rule {name}-sso down" }),
    );
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toMatchObject({
      rules: [SVC, SSO],
      version: 2,
    });
    await waitFor(() =>
      expect(
        within(
          within(screen.getByRole("table")).getAllByRole(
            "row",
          )[1] as HTMLElement,
        ).getByText("svc-{name}"),
      ).toBeVisible(),
    );
  });

  it("moves a rule up: PUTs the list with the two swapped", async () => {
    const api = stubRules([SSO, SVC], { version: 2 });
    renderWithProviders(<IdentityMapRulesEditor isAdmin />);
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.click(
      screen.getByRole("button", { name: "Move rule svc-{name} up" }),
    );
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toMatchObject({ rules: [SVC, SSO] });
  });

  it("deletes only after a confirmation, PUTting the list without the rule", async () => {
    const api = stubRules([SSO, SVC], { version: 4 });
    renderWithProviders(<IdentityMapRulesEditor isAdmin />);
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.click(
      screen.getByRole("button", { name: "Delete rule {name}-sso" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(api.writes()).toHaveLength(0);
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toMatchObject({ rules: [SVC], version: 4 });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("cancelling the delete confirmation sends nothing", async () => {
    const api = stubRules([SSO]);
    renderWithProviders(<IdentityMapRulesEditor isAdmin />);
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.click(
      screen.getByRole("button", { name: "Delete rule {name}-sso" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));
    expect(api.writes()).toHaveLength(0);
    expect(screen.getByText("{name}-sso")).toBeVisible();
  });

  it("deleting the last rule PUTs an empty list and returns to the empty state", async () => {
    const api = stubRules([SSO], { version: 1 });
    renderWithProviders(<IdentityMapRulesEditor isAdmin />);
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.click(
      screen.getByRole("button", { name: "Delete rule {name}-sso" }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Delete",
      }),
    );
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toMatchObject({ rules: [], version: 1 });
    expect(await screen.findByText(/no mapping rules/i)).toBeInTheDocument();
  });
});

describe("IdentityMapRulesEditor -- failures", () => {
  async function fillAdd(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: /add rule/i }));
    const dialog = await screen.findByRole("dialog");
    await pasteInto(
      user,
      within(dialog).getByLabelText("Pattern"),
      "svc-{name}",
    );
    await pasteInto(
      user,
      within(dialog).getByLabelText("Email template"),
      "{name}@company.com",
    );
    await user.click(within(dialog).getByRole("button", { name: "Save rule" }));
    return dialog;
  }

  it("a version conflict (409 CONFLICT) surfaces the server message, keeps the dialog open and reloads the current rules", async () => {
    const api = stubRules([SSO], {
      write: () =>
        apiError(409, "CONFLICT", "The rules were changed by someone else"),
    });
    renderWithProviders(<IdentityMapRulesEditor isAdmin />);
    const user = userEvent.setup();
    const dialog = await fillAdd(user);

    expect(
      await within(dialog).findByText(/changed by someone else/),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(api.listFetches()).toBeGreaterThanOrEqual(2));
  });

  it("a conflict on delete or move surfaces the message too", async () => {
    stubRules([SSO, SVC], {
      write: () =>
        apiError(409, "CONFLICT", "The rules were changed elsewhere"),
    });
    renderWithProviders(<IdentityMapRulesEditor isAdmin />);
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.click(
      screen.getByRole("button", { name: "Move rule {name}-sso down" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /changed elsewhere/,
    );
  });

  it("surfaces a 403 FORBIDDEN message", async () => {
    stubRules([SSO], {
      write: () => apiError(403, "FORBIDDEN", "internal-admin role required"),
    });
    renderWithProviders(<IdentityMapRulesEditor isAdmin />);
    const user = userEvent.setup();
    const dialog = await fillAdd(user);
    expect(
      await within(dialog).findByText(/internal-admin role required/),
    ).toBeInTheDocument();
  });

  it("shows a generic readable message, not raw parser text, for a non-JSON error body", async () => {
    stubRules([SSO], {
      write: () =>
        new Response("<html>", {
          status: 500,
          headers: { "content-type": "text/html" },
        }),
    });
    renderWithProviders(<IdentityMapRulesEditor isAdmin />);
    const user = userEvent.setup();
    const dialog = await fillAdd(user);
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(/request failed/i);
    expect(alert).not.toHaveTextContent(/JSON|Unexpected token|<html>/i);
  });
});
