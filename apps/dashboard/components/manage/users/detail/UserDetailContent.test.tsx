import type { IdentityDetail } from "@llm-usage-lens/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { UserDetailContent } from "./UserDetailContent";

// Sources: Design System - "The user page (unit US2)": D-US6 (what it shows),
// D-US7 (every edit uses an existing route; a caller sees only the actions
// they may use), D-US8 (name and email), D-US9 (no LiteLLM user or member is
// created or removed), D-US10 (sign-in modes), D-US11 and D-US12 (blocks by
// role), and its 2026-11-24 rulings (version on the name edit, "unknown" /
// "Never signed in", Make team lead by exact identity); Access Control -
// T-US1 and the API row /api/identities/[oid]. The role rules
// that decide the `allowed` flags and the per-role blocks are proved once, in
// app/api/identities/[oid]/route.integration.test.ts; here the flags and
// blocks are inputs (Rule 60.24a). Each panel is rendered through the content
// component; the panels are UserProfilePanel, UserSignInPanel, UserLinksPanel
// (LiteLLM link, Unlink, Reset spend), UserTeamPanel (membership and lead),
// UserRolesPanel (global roles) and UserIdentitiesPanel (usage identities and
// aliases), one per file (Rule 60.26).
//
// Contract (components/manage/users/detail/UserDetailContent.tsx, "use client"):
//   props { detail: IdentityDetail; canOpenPasswordUsers: boolean;
//           authMethod: AccessViewer["authMethod"]; stepUp: StepUpActions }.
//   Regions (Panel titles): "Profile", "Sign-in", "LiteLLM", "Team",
//   "Global roles" (only when detail.roleGrants is present), "Usage identities"
//   (only when detail.usageIdentities is present).
//   Versions the existing write routes need ride on the detail (gap, see the
//   run report): `linkVersion` (identity link, 0 = none), `memberVersion`
//   (affiliation), `leadScopes[].version`, `roleGrants[].version`.
//   After a successful write the panel calls router.refresh().
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

const OID = "oid-alice";
const stepUp = {
  entra: vi.fn(),
  credentials: vi.fn(),
  devLogin: vi.fn(),
};

const ORG_UNITS = {
  teams: [
    { id: "team-a", name: "Payments", departmentId: "dept-eng" },
    { id: "team-b", name: "Ledger", departmentId: "dept-fin" },
  ],
  departments: [{ id: "dept-eng", name: "Engineering" }],
};

type Allowed = IdentityDetail["allowed"];
const NONE_ALLOWED: Allowed = {
  editDisplayName: false,
  linkLiteLLM: false,
  unlinkLiteLLM: false,
  resetSpend: false,
  changeMembership: false,
  changeLead: false,
  editRoles: false,
  editUsageIdentities: false,
};
const ALL_ALLOWED: Allowed = Object.fromEntries(
  Object.keys(NONE_ALLOWED).map((k) => [k, true]),
) as Allowed;

function detailOf(over: Record<string, unknown> = {}): IdentityDetail {
  return {
    oid: OID,
    displayName: "Alice Anderson",
    email: "alice@company.com",
    upn: "alice@corp.example.com",
    authMethod: "entra",
    createdAt: "2025-06-01T00:00:00.000Z",
    lastSignInAt: "2026-01-01T00:00:00.000Z",
    memberTeamId: "team-a",
    memberVersion: 2,
    leadScopes: [{ scopeType: "team", scopeId: "team-b", version: 5 }],
    litellm: { state: "linked", litellmUserId: "lu-alice" },
    linkVersion: 4,
    usageIdentities: ["alice@company.com"],
    aliases: ["alice-sandbox-key"],
    roleGrants: [
      {
        oid: OID,
        role: "internal-org-admin",
        reason: "quarterly review",
        grantedBy: "oid-admin",
        grantedAt: "2026-02-01T00:00:00.000Z",
        version: 3,
      },
    ],
    allowed: ALL_ALLOWED,
    ...over,
  } as unknown as IdentityDetail;
}

const PAM_SSO = {
  expectedUpn: "pam@corp.example.com",
  expectedOid: "00000000-0000-4000-8000-00000000ee01",
};
function pamOf(over: Record<string, unknown> = {}): IdentityDetail {
  return detailOf({
    oid: "oid-pam",
    displayName: "Pam",
    email: "pam@company.com",
    upn: null,
    authMethod: "password",
    memberTeamId: null,
    leadScopes: [],
    litellm: { state: "none" },
    linkVersion: 0,
    usageIdentities: [],
    aliases: [],
    roleGrants: [],
    sso: PAM_SSO,
    allowed: NONE_ALLOWED,
    ...over,
  });
}

type Call = { method: string; path: string; body: unknown };
let calls: Call[] = [];
let overrides: Record<string, () => Response> = {};

function stubFetch() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const call: Call = {
        method: init?.method ?? "GET",
        path: decodeURIComponent(url.pathname),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      const hit = overrides[`${call.method} ${call.path}`];
      if (hit) return Promise.resolve(hit());
      if (call.path === "/api/access/org-units") {
        return Promise.resolve(apiResponse({ data: ORG_UNITS }));
      }
      if (call.path.endsWith("/memberships")) {
        return Promise.resolve(
          apiResponse({ data: { items: [], configured: true } }),
        );
      }
      return Promise.resolve(apiResponse({ data: {} }));
    }),
  );
}

function show(
  detail: IdentityDetail,
  over: Partial<{ canOpenPasswordUsers: boolean }> = {},
) {
  return renderWithProviders(
    <UserDetailContent
      detail={detail}
      canOpenPasswordUsers={over.canOpenPasswordUsers ?? true}
      authMethod="entra"
      stepUp={stepUp}
    />,
  );
}
const region = (name: string) => screen.getByRole("region", { name });
const writes = () => calls.filter((c) => c.method !== "GET");

// D-US9: no action here creates or removes a LiteLLM user or a team
// member. Reset spend (POST .../members/<oid>/reset-spend) and the link routes
// are the only LiteLLM-facing writes allowed.
function expectNoLiteLLMUserOrMemberWrite() {
  const bad = writes().filter(
    (c) =>
      (c.path === "/api/litellm/users" && c.method === "POST") ||
      /^\/api\/litellm\/users\/[^/]+$/.test(c.path) ||
      (/^\/api\/litellm\/teams\/[^/]+\/members(\/[^/]+)?$/.test(c.path) &&
        ["POST", "DELETE", "PUT", "PATCH"].includes(c.method)),
  );
  expect(bad).toEqual([]);
}

beforeEach(() => {
  overrides = {};
  stubFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockReset();
  for (const fn of Object.values(stepUp)) fn.mockReset();
});

describe("what the page shows (D-US6)", () => {
  it("an Entra person: profile, sign-in, LiteLLM link, team and lead, roles, usage identities and aliases", async () => {
    show(detailOf());
    const profile = region("Profile");
    expect(within(profile).getByText("Alice Anderson")).toBeInTheDocument();
    expect(within(profile).getByText("alice@company.com")).toBeInTheDocument();
    expect(
      within(profile).getByText("alice@corp.example.com"),
    ).toBeInTheDocument();
    expect(within(profile).getByText(/2025-06-01|1 Jun 2025/)).toBeVisible();
    expect(within(profile).getByText(/2026-01-01|1 Jan 2026/)).toBeVisible();
    expect(within(region("Sign-in")).getByText(/entra/i)).toBeInTheDocument();
    expect(within(region("LiteLLM")).getByText("lu-alice")).toBeVisible();
    const team = region("Team");
    expect(await within(team).findByText(/Payments/)).toBeVisible();
    expect(within(team).getByText(/member/i)).toBeVisible();
    expect(await within(team).findByText(/Ledger/)).toBeVisible();
    expect(within(team).getByText(/lead/i)).toBeVisible();
    expect(within(region("Global roles")).getByText("Org admin")).toBeVisible();
    const ids = region("Usage identities");
    expect(within(ids).getByText("alice@company.com")).toBeVisible();
    expect(within(ids).getByText("alice-sandbox-key")).toBeVisible();
  });

  it("a person with no team, no roles and no identities shows the empty states, not an error", () => {
    show(
      detailOf({
        memberTeamId: null,
        leadScopes: [],
        litellm: { state: "none" },
        usageIdentities: [],
        aliases: [],
        roleGrants: [],
        allowed: NONE_ALLOWED,
      }),
    );
    expect(within(region("Team")).getByText(/no team/i)).toBeVisible();
    expect(region("Global roles")).toBeInTheDocument();
    expect(region("Usage identities")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a block the response leaves out is absent from the page, not empty (D-US11)", () => {
    show(
      detailOf({
        usageIdentities: undefined,
        aliases: undefined,
        roleGrants: undefined,
        allowed: NONE_ALLOWED,
      }),
    );
    expect(screen.queryByRole("region", { name: "Global roles" })).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Usage identities" }),
    ).toBeNull();
    expect(screen.getByRole("region", { name: "Profile" })).toBeVisible();
  });
});

describe("each action appears only when its allowed flag is true (D-US7)", () => {
  type Row = [
    flag: keyof Allowed,
    person: () => IdentityDetail,
    controls: RegExp[],
  ];
  const ENTRA = () => detailOf();
  const UNLINKED = () => detailOf({ litellm: { state: "none" } });
  const ROWS: Row[] = [
    ["unlinkLiteLLM", ENTRA, [/^unlink$/i]],
    ["resetSpend", ENTRA, [/^reset spend for/i]],
    ["linkLiteLLM", UNLINKED, [/^link to an existing litellm user/i]],
    ["changeMembership", ENTRA, [/^move/i, /^remove from team/i]],
    ["changeLead", ENTRA, [/^make team lead/i, /^revoke lead/i]],
    ["editRoles", ENTRA, [/^grant role/i, /^revoke org admin/i]],
    ["editUsageIdentities", ENTRA, [/^save links/i, /^add usage identity/i]],
    ["editDisplayName", () => pamOf(), [/^edit name/i]],
  ];

  it.each(ROWS)(
    "%s: its controls show with it true and every other flag false, and are absent with all false",
    async (flag, person, controls) => {
      const only = { ...NONE_ALLOWED, [flag]: true };
      const on = show({ ...person(), allowed: only });
      for (const name of controls) {
        expect(await screen.findAllByRole("button", { name })).not.toHaveLength(
          0,
        );
      }
      // none of the other rows' controls is rendered
      for (const [other, , otherControls] of ROWS) {
        if (other === flag) continue;
        for (const name of otherControls) {
          expect(
            screen.queryByRole("button", { name }),
            `${String(other)} control ${name} with only ${flag}`,
          ).toBeNull();
        }
      }
      on.unmount();
      show({ ...person(), allowed: NONE_ALLOWED });
      for (const name of controls) {
        expect(screen.queryByRole("button", { name })).toBeNull();
      }
    },
  );

  it("an auditor's page (every flag false) shows all the data and no button or field that writes", async () => {
    show(detailOf({ allowed: NONE_ALLOWED }));
    expect(await screen.findByText(/Payments/)).toBeVisible();
    expect(screen.getByText("lu-alice")).toBeVisible();
    expect(screen.getByText("Org admin")).toBeVisible();
    expect(screen.getByText("alice-sandbox-key")).toBeVisible();
    for (const panel of screen.getAllByRole("region")) {
      expect(within(panel).queryByRole("textbox")).toBeNull();
      expect(within(panel).queryByRole("combobox")).toBeNull();
    }
    for (const name of [
      /unlink/i,
      /reset spend/i,
      /link to/i,
      /move/i,
      /remove/i,
      /make team lead/i,
      /revoke/i,
      /grant role/i,
      /save links/i,
      /edit name/i,
    ]) {
      expect(screen.queryByRole("button", { name }), String(name)).toBeNull();
    }
  });

  it("D-US9: no Create and link, and no control that creates a LiteLLM user, even when linking is allowed on an unlinked person", () => {
    show(detailOf({ litellm: { state: "none" }, allowed: ALL_ALLOWED }));
    expect(
      screen.getByRole("button", { name: /link to an existing litellm user/i }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: /create/i })).toBeNull();
  });
});

describe("name and email (D-US8)", () => {
  it("an SSO person's name and email are read-only, with the note that they come from Entra at every sign-in", () => {
    show(detailOf());
    expect(
      within(region("Profile")).getByText(/comes from Entra at every sign-in/i),
    ).toBeVisible();
    expect(screen.queryByRole("textbox", { name: /name|email/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
  });

  it("a password user's name edit PATCHes /api/password-users/<email> with { displayName, version } (the version the read carried, Q-B1) and shows the result; the email is never editable", async () => {
    overrides["PATCH /api/password-users/pam@company.com"] = () =>
      apiResponse({
        data: {
          email: "pam@company.com",
          displayName: "Pamela",
          status: "enabled",
          totpEnrolled: true,
          createdAt: "2025-07-01T00:00:00.000Z",
          version: 2,
        },
      });
    const user = userEvent.setup();
    show(
      pamOf({
        passwordUserVersion: 4,
        allowed: { ...NONE_ALLOWED, editDisplayName: true },
      }),
    );
    const profile = region("Profile");
    expect(
      within(profile).queryByText(/comes from Entra at every sign-in/i),
    ).toBeNull();

    await user.click(
      within(profile).getByRole("button", { name: /^edit name/i }),
    );
    expect(
      within(profile).queryByRole("textbox", { name: /email/i }),
    ).toBeNull();
    const field = within(profile).getByRole("textbox", {
      name: /display name|name/i,
    });
    expect(field).toHaveValue("Pam");
    await user.clear(field);
    await user.type(field, "Pamela");
    await user.click(within(profile).getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "PATCH",
      path: "/api/password-users/pam@company.com",
      body: { displayName: "Pamela", version: 4 },
    });
    expect(await within(profile).findByText("Pamela")).toBeVisible();
    expect(within(profile).getByText("pam@company.com")).toBeVisible();
    expect(
      within(profile).queryByRole("textbox", { name: /email/i }),
    ).toBeNull();
    expectNoLiteLLMUserOrMemberWrite();
  });

  // R1: the name comes from Entra after binding; no dead control (D-US7).
  it("a password user bound to SSO has no name edit control (editDisplayName false)", () => {
    show(
      pamOf({
        sso: { ...PAM_SSO, boundAt: "2026-10-05T01:02:03.000Z" },
        allowed: { ...NONE_ALLOWED, editDisplayName: false },
      }),
    );
    expect(
      within(region("Profile")).queryByRole("button", { name: /edit name/i }),
    ).toBeNull();
  });

  // U-B4: a missing createdAt is "unknown"; a missing last sign-in is
  // "Never signed in" (Design System - The user page, 2026-11-24 rulings).
  it("a missing createdAt shows 'unknown', not a dash", () => {
    show(detailOf({ createdAt: null }));
    const profile = region("Profile");
    expect(within(profile).getByText("unknown")).toBeVisible();
    expect(within(profile).queryByText("-")).toBeNull();
  });

  it("a missing lastSignInAt shows 'Never signed in', not a dash", () => {
    show(detailOf({ lastSignInAt: null }));
    const profile = region("Profile");
    expect(within(profile).getByText("Never signed in")).toBeVisible();
    expect(within(profile).queryByText("-")).toBeNull();
  });

  it("a refused name edit shows the error and keeps the old name", async () => {
    overrides["PATCH /api/password-users/pam@company.com"] = () =>
      apiResponse({ error: { code: "CONFLICT", message: "stale" } }, 409);
    const user = userEvent.setup();
    show(pamOf({ allowed: { ...NONE_ALLOWED, editDisplayName: true } }));
    const profile = region("Profile");
    await user.click(
      within(profile).getByRole("button", { name: /^edit name/i }),
    );
    const field = within(profile).getByRole("textbox", {
      name: /display name|name/i,
    });
    await user.clear(field);
    await user.type(field, "Nope");
    await user.click(within(profile).getByRole("button", { name: /^save$/i }));
    expect(await within(profile).findByRole("alert")).toBeVisible();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("sign-in modes (D-US10, D-US12)", () => {
  it("a bound password user shows the expected UPN, the expected Entra id and 'Signs in with SSO since <date>', read-only", () => {
    show(
      pamOf({
        sso: { ...PAM_SSO, boundAt: "2026-10-05T01:02:03.000Z" },
      }),
    );
    const signIn = region("Sign-in");
    expect(within(signIn).getByText("pam@corp.example.com")).toBeVisible();
    expect(within(signIn).getByText(PAM_SSO.expectedOid)).toBeVisible();
    expect(
      within(signIn).getByText(
        /Signs in with SSO since.*(2026-10-05|5 Oct 2026|Oct 5, 2026)/i,
      ),
    ).toBeVisible();
    expect(within(signIn).queryByRole("textbox")).toBeNull();
    expect(within(signIn).queryByRole("button")).toBeNull();
  });

  it("an unbound password user shows the reference and no 'Signs in with SSO since'", () => {
    show(pamOf());
    const signIn = region("Sign-in");
    expect(within(signIn).getByText("pam@corp.example.com")).toBeVisible();
    expect(within(signIn).queryByText(/Signs in with SSO since/i)).toBeNull();
  });

  it("a password user whose response has no sso block (an org-admin's) shows only 'Signs in with a password'", () => {
    show(pamOf({ sso: undefined }));
    const signIn = region("Sign-in");
    expect(within(signIn).getByText(/Signs in with a password/i)).toBeVisible();
    expect(within(signIn).queryByText(/UPN|SSO/i)).toBeNull();
    expect(screen.queryByText(PAM_SSO.expectedOid)).toBeNull();
  });

  it.each([
    [true, 1],
    [false, 0],
  ])(
    "the link to Settings -> Access -> Password users, canOpenPasswordUsers=%s: %s link(s)",
    (canOpen, count) => {
      show(pamOf(), { canOpenPasswordUsers: canOpen });
      const links = screen.queryAllByRole("link", { name: /password users/i });
      expect(links).toHaveLength(count);
      if (count > 0) {
        expect(links[0]).toHaveAttribute(
          "href",
          expect.stringMatching(/\/dashboard\/settings\/access/),
        );
      }
    },
  );

  it("no credential text is rendered for a password user", () => {
    const view = show(
      pamOf({ sso: { ...PAM_SSO, boundAt: "2026-10-05T01:02:03.000Z" } }),
    );
    expect(view.container.textContent ?? "").not.toMatch(
      /argon|hash|totp|secret|setup token|lockout|failed attempts/i,
    );
  });
});

describe("an org-admin reads roles and usage identities and edits neither (D-US11)", () => {
  it("both blocks show, no edit control, no sso", () => {
    show(
      pamOf({
        usageIdentities: ["pam@company.com"],
        aliases: ["pam-key"],
        roleGrants: [
          {
            oid: "oid-pam",
            role: "internal-auditor",
            reason: "r",
            grantedBy: "oid-admin",
            grantedAt: "2026-02-01T00:00:00.000Z",
            version: 1,
          },
        ],
        sso: undefined,
        allowed: {
          ...NONE_ALLOWED,
          linkLiteLLM: true,
          unlinkLiteLLM: true,
          changeMembership: true,
          changeLead: true,
        },
      }),
      { canOpenPasswordUsers: false },
    );
    expect(within(region("Global roles")).getByText("Auditor")).toBeVisible();
    expect(
      within(region("Usage identities")).getByText("pam-key"),
    ).toBeVisible();
    expect(
      within(region("Global roles")).queryByRole("button"),
    ).not.toBeInTheDocument();
    expect(
      within(region("Usage identities")).queryByRole("button"),
    ).not.toBeInTheDocument();
    expect(
      within(region("Usage identities")).queryByRole("textbox"),
    ).not.toBeInTheDocument();
  });
});

describe("every edit calls the existing route (D-US7, D-US9)", () => {
  it("Unlink: DELETE /api/identities/<oid>/litellm-link with the link version, then the page refreshes", async () => {
    const user = userEvent.setup();
    overrides["DELETE /api/identities/oid-alice/litellm-link"] = () =>
      apiResponse({
        data: { oid: "oid-alice", litellmUserId: null, version: 5 },
      });
    show(detailOf());
    await user.click(screen.getByRole("button", { name: /^unlink$/i }));
    await user.click(
      await screen.findByRole("button", { name: /remove link/i }),
    );
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "DELETE",
      path: "/api/identities/oid-alice/litellm-link",
      body: { version: 4 },
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expectNoLiteLLMUserOrMemberWrite();
  });

  it("Reset spend opens RS1's dialog for the linked LiteLLM user (memberships read), and writes nothing by itself", async () => {
    const user = userEvent.setup();
    show(detailOf());
    await user.click(
      screen.getByRole("button", { name: "Reset spend for Alice Anderson" }),
    );
    expect(
      await screen.findByText("Reset spend for Alice Anderson?"),
    ).toBeVisible();
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === "GET" &&
            c.path === "/api/litellm/users/lu-alice/memberships",
        ),
      ).toBe(true),
    );
    expect(writes()).toEqual([]);
  });

  it("Move: POST /api/affiliations/<oid>/move from the current team to the chosen one with the membership version", async () => {
    const user = userEvent.setup();
    show(detailOf());
    await user.click(await screen.findByRole("button", { name: /^move/i }));
    await user.selectOptions(
      await screen.findByRole("combobox", { name: /destination team/i }),
      "team-b",
    );
    await user.click(screen.getByRole("button", { name: /^move$/i }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "POST",
      path: "/api/affiliations/oid-alice/move",
      body: { fromTeamId: "team-a", toTeamId: "team-b", version: 2 },
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expectNoLiteLLMUserOrMemberWrite();
  });

  it("Remove from team: DELETE /api/teams/<team>/members/<oid> with the membership version", async () => {
    const user = userEvent.setup();
    show(detailOf());
    await user.click(
      await screen.findByRole("button", { name: /^remove from team/i }),
    );
    await user.click(await screen.findByRole("button", { name: /^remove$/i }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "DELETE",
      path: "/api/teams/team-a/members/oid-alice",
      body: { version: 2 },
    });
    expectNoLiteLLMUserOrMemberWrite();
  });

  it("Make team lead: POST /api/teams/<member team>/admins with { oid }, never an email or UPN (R2 ruling 2026-11-24)", async () => {
    const user = userEvent.setup();
    show(detailOf({ leadScopes: [] }));
    await user.click(
      await screen.findByRole("button", { name: /^make team lead/i }),
    );
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "POST",
      path: "/api/teams/team-a/admins",
      body: { oid: "oid-alice" },
    });
    expectNoLiteLLMUserOrMemberWrite();
  });

  it("Make team lead is present for an Entra person with no UPN and sends the oid (R2 ruling 2026-11-24)", async () => {
    const user = userEvent.setup();
    show(
      detailOf({
        upn: null,
        leadScopes: [],
        allowed: { ...NONE_ALLOWED, changeLead: true },
      }),
    );
    await user.click(
      await screen.findByRole("button", { name: /^make team lead/i }),
    );
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "POST",
      path: "/api/teams/team-a/admins",
      body: { oid: "oid-alice" },
    });
  });

  it("Make team lead for a password user sends the oid too (R2 ruling 2026-11-24)", async () => {
    const user = userEvent.setup();
    const detail = pamOf({
      memberTeamId: "team-a",
      upn: null,
      allowed: { ...NONE_ALLOWED, changeLead: true },
    });
    show(detail);
    await user.click(
      await screen.findByRole("button", { name: /^make team lead/i }),
    );
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "POST",
      path: "/api/teams/team-a/admins",
      body: { oid: detail.oid },
    });
  });

  it("Revoke lead: DELETE /api/teams/<team>/admins/<oid> with the scope version", async () => {
    const user = userEvent.setup();
    show(detailOf());
    await user.click(
      await screen.findByRole("button", { name: /^revoke lead/i }),
    );
    await user.click(await screen.findByRole("button", { name: /^revoke$/i }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "DELETE",
      path: "/api/teams/team-b/admins/oid-alice",
      body: { version: 5 },
    });
    expectNoLiteLLMUserOrMemberWrite();
  });

  it("Grant role: POST /api/role-grants for this person with the chosen role and a required reason, no person picker", async () => {
    const user = userEvent.setup();
    show(detailOf({ roleGrants: [] }));
    await user.click(screen.getByRole("button", { name: /^grant role/i }));
    expect(screen.queryByLabelText("Person")).toBeNull();
    await user.click(screen.getByRole("button", { name: /^grant$/i }));
    expect(writes()).toEqual([]);
    await user.selectOptions(
      screen.getByLabelText("Role"),
      "internal-org-admin",
    );
    await user.type(screen.getByLabelText("Reason"), "audit cover");
    await user.click(screen.getByRole("button", { name: /^grant$/i }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "POST",
      path: "/api/role-grants",
      body: {
        oid: "oid-alice",
        role: "internal-org-admin",
        reason: "audit cover",
      },
    });
    expectNoLiteLLMUserOrMemberWrite();
  });

  it("Revoke role: DELETE /api/role-grants/<oid>/<role> with the grant version", async () => {
    const user = userEvent.setup();
    show(detailOf());
    await user.click(
      screen.getByRole("button", { name: /^revoke org admin/i }),
    );
    await user.click(await screen.findByRole("button", { name: /^revoke$/i }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "DELETE",
      path: "/api/role-grants/oid-alice/internal-org-admin",
      body: { version: 3 },
    });
    expectNoLiteLLMUserOrMemberWrite();
  });

  it("a role write answered REAUTH_REQUIRED opens 'Confirm it's you' and is not replayed (Access Control - Recent authentication)", async () => {
    overrides["POST /api/role-grants"] = () =>
      apiResponse(
        { error: { code: "REAUTH_REQUIRED", message: "sign in again" } },
        403,
      );
    const user = userEvent.setup();
    show(detailOf({ roleGrants: [] }));
    await user.click(screen.getByRole("button", { name: /^grant role/i }));
    await user.type(screen.getByLabelText("Reason"), "needed");
    await user.click(screen.getByRole("button", { name: /^grant$/i }));
    expect(
      await screen.findByRole("heading", { name: /confirm it.s you/i }),
    ).toBeVisible();
    expect(writes()).toHaveLength(1);
  });

  it("Save links: PUT /api/identities/<oid>/links with both lists, the LiteLLM user id and the link version", async () => {
    overrides["PUT /api/identities/oid-alice/links"] = () =>
      apiResponse({
        data: {
          oid: "oid-alice",
          usageIdentities: ["alice@company.com", "alice.a@company.com"],
          aliases: ["alice-sandbox-key"],
          litellmUserId: "lu-alice",
          version: 5,
          updatedAt: "2026-11-23T00:00:00.000Z",
        },
      });
    const user = userEvent.setup();
    show(detailOf());
    const ids = region("Usage identities");
    await user.type(
      within(ids).getByLabelText("New usage identity"),
      "Alice.A@company.com",
    );
    await user.click(
      within(ids).getByRole("button", { name: /^add usage identity/i }),
    );
    await user.click(within(ids).getByRole("button", { name: /^save links/i }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      method: "PUT",
      path: "/api/identities/oid-alice/links",
      body: {
        usageIdentities: ["alice@company.com", "alice.a@company.com"],
        aliases: ["alice-sandbox-key"],
        litellmUserId: "lu-alice",
        version: 4,
      },
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expectNoLiteLLMUserOrMemberWrite();
  });
});
