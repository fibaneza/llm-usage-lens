import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { TeamCreateDialog } from "./TeamCreateDialog";

// Sources: Design System - Management pages, *New team (D5, D6; unit M2)*
// (name 1-80 characters trimmed; department picker of the registry
// departments from GET /api/access/org-units; on success the new team is
// handed to the page); Access Control - *Created app teams* (POST /api/teams
// body { name, departmentId }, 409 CONFLICT on a duplicate name); Data Model
// - Entity: AppTeam (name 1-80 trimmed); Design System - Settings Page forms
// (inline error tied to the field with aria-describedby); Rules 60.21, 60.24a.
// The route's own rules (who may create, uniqueness, audit) are tested with
// the route; here only what the dialog renders and sends.
const TEAM = {
  teamId: "appteam-00000000-0000-4000-8000-000000000001",
  name: "Platform Guild",
  departmentId: "dept-eng",
  departmentName: "Engineering",
  createdBy: "oid-admin",
  createdAt: "2026-11-18T01:00:00.000Z",
  version: 1,
};

const UNITS = {
  teams: [],
  departments: [
    { id: "dept-eng", name: "Engineering" },
    { id: "dept-ops", name: "Operations" },
  ],
};

type Call = { method: string; path: string; body: unknown };
type Handler = (body: unknown) => Response;

function stub(overrides: Record<string, Handler> = {}) {
  const calls: Call[] = [];
  const routes: Record<string, Handler> = {
    "GET /api/access/org-units": () => apiResponse({ data: UNITS }),
    "POST /api/teams": () => apiResponse({ data: TEAM }, 201),
    ...overrides,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const method = init?.method ?? "GET";
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, body });
      const route = routes[`${method} ${path}`];
      if (!route) throw new Error(`unexpected ${method} ${path}`);
      return route(body);
    }),
  );
  return { posts: () => calls.filter((c) => c.method === "POST") };
}

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

async function openDialog(onCreated = vi.fn()) {
  const u = user();
  renderWithProviders(<TeamCreateDialog onCreated={onCreated} />);
  await u.click(screen.getByRole("button", { name: "New team" }));
  const dialog = await screen.findByRole("dialog", { name: "New team" });
  return { u, dialog, onCreated };
}

const nameBox = () => screen.getByRole("textbox", { name: "Team name" });
const departmentBox = () =>
  screen.getByRole("combobox", { name: "Department" });
const loaded = () => screen.findByRole("option", { name: "Engineering" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TeamCreateDialog (New team, D5/D6)", () => {
  it("opens a dialog titled New team with the name box, the department picker and Cancel / Create team", async () => {
    stub();
    const { dialog } = await openDialog();
    expect(
      within(dialog).getByRole("textbox", { name: "Team name" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("combobox", { name: "Department" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Create team" }),
    ).toBeInTheDocument();
  });

  it("lists the departments from org-units after the placeholder 'Select a department'", async () => {
    stub();
    await openDialog();
    await loaded();
    expect(
      within(departmentBox())
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Select a department", "Engineering", "Operations"]);
  });

  it("a failed department load says so and creates nothing", async () => {
    const api = stub({
      "GET /api/access/org-units": () => apiError(500),
    });
    const { u } = await openDialog();
    expect(
      await screen.findByText("Couldn't load departments"),
    ).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Create team" }));
    expect(api.posts()).toEqual([]);
  });

  describe("validation (Data Model: name 1-80 trimmed; a department is required)", () => {
    it.each([
      ["an empty name", "", "Enter a team name"],
      ["a blank name", "   ", "Enter a team name"],
      [
        "a name over 80 characters",
        "x".repeat(81),
        "Use 80 characters or fewer",
      ],
    ])(
      "%s shows '%s' tied to the name box and sends nothing",
      async (_n, value, message) => {
        const api = stub();
        const { u } = await openDialog();
        await loaded();
        await u.selectOptions(departmentBox(), "Engineering");
        if (value) await u.type(nameBox(), value);
        await u.click(screen.getByRole("button", { name: "Create team" }));

        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent(message);
        expect(nameBox()).toHaveAttribute("aria-invalid", "true");
        expect(nameBox().getAttribute("aria-describedby")).toContain(alert.id);
        expect(api.posts()).toEqual([]);
      },
    );

    it("no department shows 'Choose a department' tied to the picker and sends nothing", async () => {
      const api = stub();
      const { u } = await openDialog();
      await loaded();
      await u.type(nameBox(), "Platform Guild");
      await u.click(screen.getByRole("button", { name: "Create team" }));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Choose a department");
      expect(departmentBox().getAttribute("aria-describedby")).toContain(
        alert.id,
      );
      expect(api.posts()).toEqual([]);
    });

    it("a name of exactly 80 characters, padded with spaces, is accepted (boundary, trimmed)", async () => {
      const api = stub();
      const { u } = await openDialog();
      await loaded();
      await u.type(nameBox(), ` ${"x".repeat(80)} `);
      await u.selectOptions(departmentBox(), "Engineering");
      await u.click(screen.getByRole("button", { name: "Create team" }));

      await waitFor(() => expect(api.posts()).toHaveLength(1));
      expect(api.posts()[0]?.body).toEqual({
        name: "x".repeat(80),
        departmentId: "dept-eng",
      });
    });
  });

  it("creates with POST /api/teams { name (trimmed), departmentId }, hands the created team to onCreated and closes", async () => {
    const api = stub();
    const { u, onCreated } = await openDialog();
    await loaded();
    await u.type(nameBox(), "  Platform Guild  ");
    await u.selectOptions(departmentBox(), "Engineering");
    await u.click(screen.getByRole("button", { name: "Create team" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(onCreated).toHaveBeenCalledWith(TEAM);
    expect(api.posts()).toEqual([
      {
        method: "POST",
        path: "/api/teams",
        body: { name: "Platform Guild", departmentId: "dept-eng" },
      },
    ]);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("a 409 CONFLICT shows 'A team with this name already exists' on the name box; the dialog stays open and onCreated is not called", async () => {
    stub({
      "POST /api/teams": () => apiError(409, "CONFLICT", "name taken"),
    });
    const { u, dialog, onCreated } = await openDialog();
    await loaded();
    await u.type(nameBox(), "Payments");
    await u.selectOptions(departmentBox(), "Engineering");
    await u.click(screen.getByRole("button", { name: "Create team" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("A team with this name already exists");
    expect(nameBox().getAttribute("aria-describedby")).toContain(alert.id);
    expect(
      screen.getByRole("dialog", { name: "New team" }),
    ).toBeInTheDocument();
    expect(nameBox()).toHaveValue("Payments");
    expect(onCreated).not.toHaveBeenCalled();
  });

  // Same reset as the Escape / success paths (Radix onOpenChange); Settings
  // Page forms: a dismissed form leaves no stale draft or error behind.
  it("Cancel closes the dialog without a request and a reopened dialog starts empty", async () => {
    const api = stub();
    const { u } = await openDialog();
    await loaded();
    await u.type(nameBox(), "Draft");
    await u.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(api.posts()).toEqual([]);

    await u.click(screen.getByRole("button", { name: "New team" }));
    await screen.findByRole("dialog", { name: "New team" });
    expect(nameBox()).toHaveValue("");
  });
});
