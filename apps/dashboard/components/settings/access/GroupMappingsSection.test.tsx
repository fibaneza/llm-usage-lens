import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ORG_ROUTES,
  ORG_UNITS,
  UNUSED_TEAM,
  fail,
  groupMappingItem,
  ok,
  page,
  stubAccessApi,
} from "@/test/access-ui-stubs";
import { renderWithProviders } from "@/test/render-providers";

import { GroupMappingsSection } from "./GroupMappingsSection";

// Source: docs/specs/2026-11-10-access-control.md - "Group mapping" (Settings;
// internal-admin only; audited: { groupId, target: { type, id }, scopedRole:
// internal-team-admin | member }; member targets must be teams - threat T4),
// "API routes (additions)" (/api/group-mappings GET POST; /api/group-mappings/
// [groupId] PATCH DELETE; GET also internal-auditor), "Enforcement" item 6
// (version -> 409; a body groupId must equal the path groupId). Design System
// - Settings Page. Rule 60.24.
//
// Module under test: `components/settings/access/GroupMappingsSection.tsx`
//   <GroupMappingsSection canEdit={boolean} />
// - Table of mappings (group id, target name, role) from GET /api/group-mappings;
//   target names and the Target options from GET /api/access/org-units (F10,
//   registry-backed, so a team with no usage is offered).
// - "Add mapping" opens a dialog: "Group ID" input, "Target type" and
//   "Target" and "Role" native selects, submit "Create mapping".
// - Icon buttons: "Edit mapping <groupId>" (sheet or dialog, group id
//   read-only, submit "Save mapping") and "Delete mapping <groupId>".
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const GROUP = "11111111-aaaa-bbbb-cccc-000000000001";

function routes(extra: Record<string, unknown> = {}) {
  return {
    ...ORG_ROUTES,
    "GET /api/group-mappings": page([
      groupMappingItem(),
      groupMappingItem({
        groupId: "22222222-aaaa-bbbb-cccc-000000000002",
        target: { type: "department", id: "dept-eng" },
        scopedRole: "internal-team-admin",
        version: 4,
      }),
    ]),
    ...extra,
  };
}

describe("GroupMappingsSection", () => {
  it("lists each mapping with the target's name and the role", async () => {
    stubAccessApi(routes());
    renderWithProviders(<GroupMappingsSection canEdit />);
    const row = await screen.findByRole("row", { name: new RegExp(GROUP) });
    expect(within(row).getByText("Payments")).toBeInTheDocument();
    expect(within(row).getByText(/team admin/i)).toBeInTheDocument();
    expect(
      screen.getByRole("row", { name: /22222222.*Engineering/ }),
    ).toBeInTheDocument();
  });

  // F10 (temp/run-r4b/decisions.md; coordinator ruling: Group mappings moves
  // too): the Target options are the registry, not teams with recent usage.
  it("offers team and department targets from /api/access/org-units, including a team with no usage, and never calls /api/teams or /api/departments", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "GET /api/access/org-units": {
          ...ORG_UNITS,
          teams: [...ORG_UNITS.teams, UNUSED_TEAM],
        },
      }),
    );
    renderWithProviders(<GroupMappingsSection canEdit />);
    await user.click(
      await screen.findByRole("button", { name: /add mapping/i }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(
      within(dialog).getByLabelText("Target type"),
      "Team",
    );
    expect(
      within(within(dialog).getByLabelText("Target")).getByRole("option", {
        name: "Treasury",
      }),
    ).toBeInTheDocument();
    await user.selectOptions(
      within(dialog).getByLabelText("Target type"),
      "Department",
    );
    expect(
      within(within(dialog).getByLabelText("Target")).getByRole("option", {
        name: "Finance",
      }),
    ).toBeInTheDocument();
    expect(api.to("GET /api/teams")).toEqual([]);
    expect(api.to("GET /api/departments")).toEqual([]);
  });

  it("shows an empty state", async () => {
    stubAccessApi(routes({ "GET /api/group-mappings": page([]) }));
    renderWithProviders(<GroupMappingsSection canEdit />);
    expect(await screen.findByText(/no group mappings/i)).toBeInTheDocument();
  });

  it("is read-only for an auditor: rows visible, no add, edit or delete controls", async () => {
    stubAccessApi(routes());
    renderWithProviders(<GroupMappingsSection canEdit={false} />);
    await screen.findByRole("row", { name: new RegExp(GROUP) });
    expect(
      screen.queryByRole("button", { name: /add mapping/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^(edit|delete) mapping/i }),
    ).not.toBeInTheDocument();
  });

  it("creates a mapping with the typed body", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({ "POST /api/group-mappings": () => ok(groupMappingItem(), 201) }),
    );
    renderWithProviders(<GroupMappingsSection canEdit />);
    await user.click(
      await screen.findByRole("button", { name: /add mapping/i }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Group ID"), "grp-new-1");
    await user.selectOptions(
      within(dialog).getByLabelText("Target type"),
      "Team",
    );
    await user.selectOptions(within(dialog).getByLabelText("Target"), "Risk");
    await user.selectOptions(within(dialog).getByLabelText("Role"), "Member");
    await user.click(
      within(dialog).getByRole("button", { name: "Create mapping" }),
    );
    await vi.waitFor(() =>
      expect(api.writes()).toEqual([
        expect.objectContaining({
          method: "POST",
          path: "/api/group-mappings",
          body: {
            groupId: "grp-new-1",
            target: { type: "team", id: "team-risk" },
            scopedRole: "member",
          },
        }),
      ]),
    );
    await vi.waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("requires a group id and rejects characters the route would refuse", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(routes());
    renderWithProviders(<GroupMappingsSection canEdit />);
    await user.click(
      await screen.findByRole("button", { name: /add mapping/i }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Create mapping" }),
    );
    expect(
      await within(dialog).findByText(/group id is required/i),
    ).toBeVisible();
    expect(within(dialog).getByLabelText("Group ID")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await user.type(within(dialog).getByLabelText("Group ID"), "bad id/!");
    await user.click(
      within(dialog).getByRole("button", { name: "Create mapping" }),
    );
    expect(
      await within(dialog).findByText(/letters, digits/i),
    ).toBeInTheDocument();
    expect(api.writes()).toEqual([]);
  });

  it("refuses a member mapping onto a department (threat T4) before sending", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(routes());
    renderWithProviders(<GroupMappingsSection canEdit />);
    await user.click(
      await screen.findByRole("button", { name: /add mapping/i }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Group ID"), "grp-new-1");
    await user.selectOptions(
      within(dialog).getByLabelText("Target type"),
      "Department",
    );
    await user.selectOptions(within(dialog).getByLabelText("Role"), "Member");
    await user.click(
      within(dialog).getByRole("button", { name: "Create mapping" }),
    );
    expect(
      await within(dialog).findByText(/member.*team only|team only/i),
    ).toBeVisible();
    expect(api.writes()).toEqual([]);
  });

  it("maps a 409 on create to the reload/conflict message and keeps the dialog open", async () => {
    const user = userEvent.setup();
    stubAccessApi(
      routes({ "POST /api/group-mappings": () => fail(409, "CONFLICT") }),
    );
    renderWithProviders(<GroupMappingsSection canEdit />);
    await user.click(
      await screen.findByRole("button", { name: /add mapping/i }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Group ID"), "grp-new-1");
    await user.click(
      within(dialog).getByRole("button", { name: "Create mapping" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      /reload/i,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("edits a mapping with PATCH carrying the whole input and the version; the group id is read-only", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        [`PATCH /api/group-mappings/${GROUP}`]: () =>
          ok(groupMappingItem({ scopedRole: "member", version: 2 })),
      }),
    );
    renderWithProviders(<GroupMappingsSection canEdit />);
    await user.click(
      await screen.findByRole("button", { name: `Edit mapping ${GROUP}` }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Group ID")).toHaveAttribute(
      "readonly",
    );
    await user.selectOptions(within(dialog).getByLabelText("Role"), "Member");
    await user.click(
      within(dialog).getByRole("button", { name: "Save mapping" }),
    );
    await vi.waitFor(() =>
      expect(api.writes()).toEqual([
        expect.objectContaining({
          method: "PATCH",
          path: `/api/group-mappings/${GROUP}`,
          body: {
            groupId: GROUP,
            target: { type: "team", id: "team-pay" },
            scopedRole: "member",
            version: 1,
          },
        }),
      ]),
    );
  });

  it("deletes a mapping only after confirming, with its version", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        [`DELETE /api/group-mappings/${GROUP}`]: () => ok({ groupId: GROUP }),
      }),
    );
    renderWithProviders(<GroupMappingsSection canEdit />);
    await user.click(
      await screen.findByRole("button", { name: `Delete mapping ${GROUP}` }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(api.writes()).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await vi.waitFor(() =>
      expect(api.writes()).toEqual([
        expect.objectContaining({
          method: "DELETE",
          path: `/api/group-mappings/${GROUP}`,
          body: { version: 1 },
        }),
      ]),
    );
  });

  it("shows a stale-version message when delete returns 409", async () => {
    const user = userEvent.setup();
    stubAccessApi(
      routes({
        [`DELETE /api/group-mappings/${GROUP}`]: () => fail(409, "CONFLICT"),
      }),
    );
    renderWithProviders(<GroupMappingsSection canEdit />);
    await user.click(
      await screen.findByRole("button", { name: `Delete mapping ${GROUP}` }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Delete",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/reload/i);
  });
});
