import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { TeamSummaryPanel } from "./TeamSummaryPanel";

// Sources: Design System - Team page, round 3 (unit TP1), Summary (a panel
// with the team name, department, kind "From an AWS account" or "Created
// here", lead names, member count, the LiteLLM team and the budget resets in
// the range; a lead sees "Linked" or "Not linked" and never the LiteLLM team
// id, ruling Q-B1; T-TP1) and Edit team (Edit team only on a created team for
// the roles that may; a registry team says "Edited in Settings -> AWS
// accounts"; T-TP7). Rules 60.21, 60.24a.
//
// Contract for the developer (components/manage/TeamSummaryPanel.tsx, "use
// client", named export TeamSummaryPanel). Props, computed on the server:
//   { name, departmentName, kind: "registry" | "created", leadNames: string[],
//     memberCount: number,
//     litellm: { linked: boolean; alias?: string; teamId?: string } | null,
//     budgetResetsInRange: number, canEdit: boolean,
//     editTarget?: { teamId, name, departmentId, version } }
// It renders a Panel titled "Summary" holding a <dl> whose <dt> labels are
// "Name", "Department", "Kind", "Team admins", "Members", "LiteLLM team" and
// "Budget resets in range", each with its <dd>. The server omits the LiteLLM
// alias and id for a caller who is not a global role; the panel shows what it
// is given. The Edit team control is <TeamEditDialog team={editTarget} />,
// rendered only when canEdit and kind is "created" and editTarget is given.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

type Props = Parameters<typeof TeamSummaryPanel>[0];

const BASE: Props = {
  name: "Platform Guild",
  departmentName: "Engineering",
  kind: "created",
  leadNames: ["Ada Lovelace", "Grace Hopper"],
  memberCount: 5,
  litellm: { linked: true, alias: "platform-guild", teamId: "ll-team-9f3" },
  budgetResetsInRange: 2,
  canEdit: true,
  editTarget: {
    teamId: "appteam-00000000-0000-4000-8000-000000000001",
    name: "Platform Guild",
    departmentId: "dept-eng",
    version: 3,
  },
};

const show = (over: Partial<Props> = {}) =>
  renderWithProviders(<TeamSummaryPanel {...BASE} {...over} />);

// The <dd> that follows the <dt> with this label.
function valueOf(label: string): HTMLElement {
  const term = screen
    .getAllByRole("term")
    .find((t) => t.textContent?.trim() === label);
  if (!term) throw new Error(`no term ${label}`);
  const value = term.nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error(`no value ${label}`);
  return value;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TeamSummaryPanel (T-TP1)", () => {
  it("is a region named Summary with the name, department, kind, leads, member count and budget resets", () => {
    show();
    const panel = screen.getByRole("region", { name: "Summary" });
    expect(panel).toBeInTheDocument();
    expect(valueOf("Name")).toHaveTextContent("Platform Guild");
    expect(valueOf("Department")).toHaveTextContent("Engineering");
    expect(valueOf("Kind")).toHaveTextContent("Created here");
    expect(valueOf("Team admins")).toHaveTextContent("Ada Lovelace");
    expect(valueOf("Team admins")).toHaveTextContent("Grace Hopper");
    expect(valueOf("Members")).toHaveTextContent("5");
    expect(valueOf("Budget resets in range")).toHaveTextContent("2");
  });

  it("a team from an AWS account reads 'From an AWS account'", () => {
    show({ kind: "registry", editTarget: undefined });
    expect(valueOf("Kind")).toHaveTextContent("From an AWS account");
  });

  it("a global caller sees the LiteLLM team's alias and id", () => {
    show();
    const value = valueOf("LiteLLM team");
    expect(value).toHaveTextContent("platform-guild");
    expect(value).toHaveTextContent("ll-team-9f3");
  });

  // T-TP1 security case; guard: the server page builds the summary with the
  // id and alias only for the global roles (lib/manage/team-summary.ts,
  // planned), and the panel prints nothing it was not given.
  it("a lead's summary says Linked and never shows an id (ruling Q-B1)", () => {
    show({ litellm: { linked: true } });
    const value = valueOf("LiteLLM team");
    expect(value).toHaveTextContent("Linked");
    expect(value).not.toHaveTextContent("Not linked");
    expect(document.body).not.toHaveTextContent("ll-team-9f3");
  });

  it("an unlinked team says Not linked", () => {
    show({ litellm: { linked: false } });
    expect(valueOf("LiteLLM team")).toHaveTextContent("Not linked");
  });

  it("zero budget resets and zero members read as 0, not blank", () => {
    show({ memberCount: 0, budgetResetsInRange: 0, leadNames: [] });
    expect(valueOf("Members")).toHaveTextContent("0");
    expect(valueOf("Budget resets in range")).toHaveTextContent("0");
  });
});

describe("TeamSummaryPanel Edit team (T-TP7)", () => {
  it("a caller who may edit a created team gets the Edit team button, which opens the dialog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        apiResponse({
          data: {
            teams: [],
            departments: [{ id: "dept-eng", name: "Engineering" }],
          },
        }),
      ),
    );
    show();
    await userEvent
      .setup({ pointerEventsCheck: 0 })
      .click(screen.getByRole("button", { name: "Edit team" }));
    expect(
      await screen.findByRole("dialog", { name: "Edit team" }),
    ).toBeVisible();
  });

  // Guard: the server page sets canEdit only for internal-admin and
  // internal-org-admin (app/dashboard/manage/team/[teamId]/page.tsx, planned).
  it("without canEdit (a lead, the auditor, a member) there is no Edit team button", () => {
    show({ canEdit: false });
    expect(screen.queryByRole("button", { name: "Edit team" })).toBeNull();
  });

  it("a team from an AWS account has no Edit team button even with canEdit, and says where it is edited", () => {
    show({ kind: "registry", canEdit: true, editTarget: undefined });
    expect(screen.queryByRole("button", { name: "Edit team" })).toBeNull();
    const panel = screen.getByRole("region", { name: "Summary" });
    expect(
      within(panel).getByText("Edited in Settings → AWS accounts"),
    ).toBeVisible();
  });

  it("a created team does not show the AWS accounts hint", () => {
    show();
    expect(screen.queryByText(/Edited in Settings/)).toBeNull();
  });
});
