import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { TeamEditDialog } from "./TeamEditDialog";

// Sources: Design System - Team page, round 3 (unit TP1), Edit team (a dialog
// with the name, 1-80 characters trimmed, and the department picker of New
// team; PATCH /api/teams/[id]); Access Control - Edit a created team (body
// carries the version the caller was shown; a stale version is 409; a name
// another team has is refused with the creation route's error, 409 CONFLICT
// "A team with this name already exists"; T-TP3); Data Model - AppTeam (name
// 1-80 trimmed); Rules 60.21, 60.24a.
//
// Contract for the developer (components/manage/TeamEditDialog.tsx, "use
// client", named export): <TeamEditDialog team={{ teamId, name, departmentId,
// version }} /> renders its own outline trigger button "Edit team" (as
// TeamCreateDialog does "New team") and a dialog titled "Edit team" with the
// fields labelled "Team name" and "Department" (departments from
// GET /api/access/org-units, as New team), pre-filled with the team's values,
// a "Cancel" and a "Save" button. Save PATCHes /api/teams/<teamId> with
// { name (trimmed), departmentId, version }. Success closes the dialog and
// calls router.refresh(). A 409 whose message is the creation route's
// duplicate-name message shows "A team with this name already exists" on the
// name field and keeps the dialog open; any other 409 (stale version) shows a
// role="alert" saying the team changed and calls router.refresh().
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

const TEAM = {
  teamId: "appteam-00000000-0000-4000-8000-000000000001",
  name: "Platform Guild",
  departmentId: "dept-eng",
  version: 3,
};
const UNITS = {
  teams: [],
  departments: [
    { id: "dept-eng", name: "Engineering" },
    { id: "dept-ops", name: "Operations" },
  ],
};
const UPDATED = {
  teamId: TEAM.teamId,
  name: "Renamed",
  departmentId: "dept-ops",
  departmentName: "Operations",
  createdBy: "oid-admin",
  createdAt: "2026-11-18T01:00:00.000Z",
  version: 4,
};
const PATH = `/api/teams/${TEAM.teamId}`;

type Handler = (body: unknown) => Response;

function stub(overrides: Record<string, Handler> = {}) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const routes: Record<string, Handler> = {
    "GET /api/access/org-units": () => apiResponse({ data: UNITS }),
    [`PATCH ${PATH}`]: () => apiResponse({ data: UPDATED }),
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
  return { patches: () => calls.filter((c) => c.method === "PATCH") };
}

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

async function openDialog() {
  const u = user();
  renderWithProviders(<TeamEditDialog team={TEAM} />);
  await u.click(screen.getByRole("button", { name: "Edit team" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit team" });
  await within(dialog).findByRole("option", { name: "Operations" });
  return { u, dialog };
}
const nameBox = () => screen.getByRole("textbox", { name: "Team name" });
const departmentBox = () =>
  screen.getByRole("combobox", { name: "Department" });

beforeEach(() => {
  refresh.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TeamEditDialog (Edit team, T-TP3, T-TP7)", () => {
  it("opens a dialog titled Edit team with the name and department pre-filled, Cancel and Save", async () => {
    stub();
    const { dialog } = await openDialog();
    expect(nameBox()).toHaveValue("Platform Guild");
    expect(departmentBox()).toHaveDisplayValue("Engineering");
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Save" }),
    ).toBeInTheDocument();
  });

  it("Save sends { name trimmed, departmentId, version } to PATCH /api/teams/<id>, then closes and refreshes", async () => {
    const api = stub();
    const { u, dialog } = await openDialog();
    await u.clear(nameBox());
    await u.type(nameBox(), "  Renamed  ");
    await u.selectOptions(departmentBox(), "Operations");
    await u.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.patches()).toEqual([
        {
          method: "PATCH",
          path: PATH,
          body: { name: "Renamed", departmentId: "dept-ops", version: 3 },
        },
      ]),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(refresh).toHaveBeenCalled();
  });

  it("an empty name is refused inline and nothing is sent", async () => {
    const api = stub();
    const { u, dialog } = await openDialog();
    await u.clear(nameBox());
    await u.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText("Enter a team name")).toBeVisible();
    expect(api.patches()).toEqual([]);
  });

  it("a name over 80 characters is refused inline and nothing is sent (Data Model - AppTeam)", async () => {
    const api = stub();
    const { u, dialog } = await openDialog();
    await u.clear(nameBox());
    await u.click(nameBox());
    await u.paste("x".repeat(81));
    await u.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(
      await within(dialog).findByText("Use 80 characters or fewer"),
    ).toBeVisible();
    expect(api.patches()).toEqual([]);
  });

  it("a taken name (409 with the creation message) shows the creation error on the name field and keeps the dialog open (T-TP3)", async () => {
    stub({
      [`PATCH ${PATH}`]: () =>
        apiError(409, "CONFLICT", "A team with this name already exists"),
    });
    const { u, dialog } = await openDialog();
    await u.clear(nameBox());
    await u.type(nameBox(), "Payments");
    await u.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(
      await within(dialog).findByText("A team with this name already exists"),
    ).toBeVisible();
    expect(screen.getByRole("dialog", { name: "Edit team" })).toBeVisible();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a stale version (any other 409) says the team changed and reloads the page data (T-TP3)", async () => {
    stub({
      [`PATCH ${PATH}`]: () =>
        apiError(409, "CONFLICT", "The resource changed or conflicts"),
    });
    const { u, dialog } = await openDialog();
    await u.clear(nameBox());
    await u.type(nameBox(), "Renamed");
    await u.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      /team changed/i,
    );
    expect(
      within(dialog).queryByText("A team with this name already exists"),
    ).toBeNull();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("another failure shows the server message and keeps the dialog open", async () => {
    stub({
      [`PATCH ${PATH}`]: () => apiError(500, "INTERNAL_ERROR", "Server broke"),
    });
    const { u, dialog } = await openDialog();
    await u.type(nameBox(), "!");
    await u.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText("Server broke")).toBeVisible();
    expect(refresh).not.toHaveBeenCalled();
  });

  // Rule 60.30 / WCAG 2.4.3: Escape closes the dialog and focus returns to
  // the trigger. Design System - Team page, round 3, Edit team (T-TP3).
  it("Escape closes the dialog and focus returns to the Edit team button", async () => {
    const api = stub();
    const { u } = await openDialog();
    await u.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Edit team" })).toHaveFocus();
    expect(api.patches()).toEqual([]);
  });

  it("Cancel closes the dialog without a request", async () => {
    const api = stub();
    const { u, dialog } = await openDialog();
    await u.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.patches()).toEqual([]);
  });
});
