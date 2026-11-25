import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ALICE,
  BOB,
  fail,
  groupMappingItem,
  memberItem,
  ok,
  page,
  passwordUserItem,
  roleGrantItem,
  ORG_UNITS,
  departmentsRoute,
  stubAccessApi,
  teamsRoute,
  type RouteTable,
} from "@/test/fakes/access-ui-stubs";
import {
  ADMIN,
  AUDITOR,
  DEPT_ADMIN,
  ORG_ADMIN,
  PLAIN_VIEWER,
  TEAM_ADMIN,
} from "@/test/fixtures/access-viewers";
import { NEVER } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";
import { expectFieldHelp } from "@/test/support/team-field-help";

import { AccessSections } from "./AccessSections";
import type { AccessViewer, StepUpActions } from "./types";

// Source: docs/specs/2026-11-10-access-control.md - "Permission matrix",
// "API routes (additions)" (reads: internal-admin and internal-auditor on the
// admin-only sections); design-system "Settings Page" ("Sections a caller
// cannot use are not rendered"); Rules 40.4 / 60.12 (each page section in its
// own Suspense + ErrorBoundary with a Skeleton fallback; one failing section
// never breaks the others), 10.3 / 50.3 (roles resolved on the server and
// passed down; the write routes enforce them again). "Recent authentication"
// (redirectTo is the fixed final tab URL
// `/dashboard/settings/access/roles#role-grants`: the Role grants section
// owns the `role-grants` anchor).
//
// Module under test: `components/settings/access/AccessSections.tsx`
//   <AccessSections viewer={AccessViewer} stepUp={StepUpActions} />
// Composes the ten sections, each `<section id="<slug>">` holding an `<h2>`
// and its own SectionBoundary. Slugs: members, team-admins, visibility,
// group-mappings, role-grants, identity-links, password-users,
// per-user-approval, audit-log, access-review. Which sections render, and
// whether they are editable, comes from `accessCapabilities(viewer)`.
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const stepUp: StepUpActions = {
  entra: async () => undefined,
  credentials: async () => undefined,
  devLogin: async () => undefined,
};

const HEADINGS = {
  members: "Members",
  "team-admins": "Team admins",
  visibility: "Visibility",
  "pending-access": "Pending and stale access",
  "group-mappings": "Group mappings",
  "role-grants": "Role grants",
  "identity-links": "Identity links",
  "password-users": "Password users",
  "per-user-approval": "Per-user approval",
  "audit-log": "Audit log",
  "access-review": "Access review",
} as const;
type Slug = keyof typeof HEADINGS;
const ALL = Object.keys(HEADINGS) as Slug[];
const MATRIX: Slug[] = [
  "members",
  "team-admins",
  "visibility",
  "pending-access",
];
const CONFIG: Slug[] = ALL.filter((s) => !MATRIX.includes(s));

function baseRoutes(): RouteTable {
  return {
    "GET /api/access/org-units": ORG_UNITS,
    "GET /api/teams": teamsRoute(),
    "GET /api/departments": departmentsRoute(),
    "GET /api/identities": page([ALICE, BOB]),
    "GET /api/teams/team-pay/members": page([memberItem()]),
    "GET /api/teams/team-pay/admins": page([]),
    "GET /api/teams/team-pay/visibility": {
      teamId: "team-pay",
      teamLevel: "visible",
      userLevel: "own",
      version: 0,
      updatedAt: "2026-11-10T09:00:00.000Z",
    },
    "GET /api/access/pending": page([]),
    "GET /api/access/stale": page([]),
    "GET /api/group-mappings": page([groupMappingItem()]),
    "GET /api/role-grants": page([roleGrantItem()]),
    // D-ST2: the Person picker searches the directory; nothing loads on mount.
    "GET /api/identities/directory": page([
      {
        oid: "oid-alice",
        email: "alice@example.com",
        displayName: "Alice Adams",
        authMethod: "entra",
        memberTeamId: null,
        litellm: { state: "none" },
        linkVersion: 0,
      },
    ]),
    "GET /api/identities/oid-alice/links": {
      oid: "oid-alice",
      usageIdentities: [],
      aliases: [],
      version: 0,
      updatedAt: "1970-01-01T00:00:00.000Z",
    },
    "GET /api/password-users": page([passwordUserItem()]),
    "GET /api/governance/password-sign-in": { enabled: true, version: 1 },
    "GET /api/governance/per-user-approval": { approved: false },
    "GET /api/audit": page([]),
  };
}

function renderSections(viewer: AccessViewer) {
  return renderWithProviders(
    <AccessSections viewer={viewer} stepUp={stepUp} />,
  );
}

// D-ST2: the links editor appears only after a pick from the search box.
async function pickAlice(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole("combobox", { name: "Person" }), "ali");
  await user.click(
    await screen.findByRole("option", { name: /alice@example\.com/ }),
  );
}

function headingOf(slug: Slug) {
  return screen.queryByRole("heading", { level: 2, name: HEADINGS[slug] });
}

describe("AccessSections - role gating", () => {
  it.each([
    ["internal-admin", ADMIN, ALL],
    ["internal-org-admin", ORG_ADMIN, MATRIX],
    // D34 reversed (user, 2026-11-15): the auditor also reads the pending and
    // stale lists.
    [
      "internal-auditor",
      AUDITOR,
      [...CONFIG.filter((s) => s !== "members"), "pending-access"],
    ],
    ["a team-scope admin", TEAM_ADMIN, MATRIX],
    ["a department-scope admin", DEPT_ADMIN, MATRIX],
    ["a plain viewer", PLAIN_VIEWER, []],
  ] as const)(
    "%s sees exactly the permitted sections",
    async (_n, viewer, shown) => {
      stubAccessApi(baseRoutes());
      renderSections(viewer);
      for (const slug of ALL) {
        if ((shown as readonly Slug[]).includes(slug)) {
          expect(
            await screen.findByRole("heading", {
              level: 2,
              name: HEADINGS[slug],
            }),
          ).toBeInTheDocument();
        } else {
          expect(headingOf(slug)).not.toBeInTheDocument();
        }
      }
    },
  );

  it("does not fetch data for a section the viewer cannot see", async () => {
    const api = stubAccessApi(baseRoutes());
    renderSections(AUDITOR);
    await screen.findByRole("heading", { level: 2, name: "Audit log" });
    expect(api.calls.filter((c) => c.path.startsWith("/api/teams/"))).toEqual(
      [],
    );
  });

  it("anchors each section by its slug, including #role-grants for the step-up redirect", async () => {
    stubAccessApi(baseRoutes());
    renderSections(ADMIN);
    await screen.findByRole("heading", { level: 2, name: "Role grants" });
    for (const slug of ALL) {
      const anchor = document.getElementById(slug);
      expect(anchor?.tagName).toBe("SECTION");
      expect(
        within(anchor as HTMLElement).getByRole("heading", { level: 2 }),
      ).toHaveTextContent(HEADINGS[slug]);
    }
  });

  it("gives an auditor the configuration sections read-only", async () => {
    stubAccessApi(baseRoutes());
    renderSections(AUDITOR);
    await screen.findByRole("row", { name: /Alice Adams/ });
    for (const name of [
      /add mapping/i,
      /^grant role$/i,
      /create password user/i,
      /record approval/i,
      /save links/i,
    ]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("gives an internal-admin the write controls", async () => {
    const user = userEvent.setup();
    stubAccessApi(baseRoutes());
    renderSections(ADMIN);
    await pickAlice(user); // D-ST2: Save links shows after a pick
    for (const name of [
      /add mapping/i,
      /^grant role$/i,
      /create password user/i,
      /record approval/i,
      /save links/i,
    ]) {
      expect(await screen.findByRole("button", { name })).toBeInTheDocument();
    }
  });
});

// D27 editors (Access Control - Usage-identity mapping rules): placed as a
// SIBLING of the Identity links section inside AccessSections, in its own
// `<section id="identity-mapping">` with an `<h2>` "Identity mapping", wrapping
// <IdentityMapRulesEditor isAdmin> and <IdentityLinkSuggestions isAdmin>
// (components/settings/). Visible exactly when Identity links is; isAdmin is
// true only for an internal-admin (the auditor gets them read-only).
describe("AccessSections - identity mapping editors (D27)", () => {
  function withMapRoutes(): RouteTable {
    return {
      ...baseRoutes(),
      "GET /api/governance/identity-map-rules": { rules: [], version: 0 },
      "GET /api/governance/identity-map-rules/suggestions": { items: [] },
    };
  }

  it.each([
    ["internal-admin", ADMIN, true],
    ["internal-auditor", AUDITOR, false],
  ] as const)(
    "%s sees both editors beside Identity links",
    async (_n, viewer, canEdit) => {
      stubAccessApi(withMapRoutes());
      renderSections(viewer);
      const section = await screen.findByRole("heading", {
        level: 2,
        name: "Identity mapping",
      });
      const wrapper = document.getElementById(
        "identity-mapping",
      ) as HTMLElement;
      expect(wrapper.tagName).toBe("SECTION");
      expect(wrapper).toContainElement(section);
      expect(
        await within(wrapper).findByRole("heading", {
          name: /usage-identity mapping rules/i,
        }),
      ).toBeInTheDocument();
      expect(
        within(wrapper).getByRole("heading", { name: /suggested links/i }),
      ).toBeInTheDocument();
      expect(document.getElementById("identity-links")).not.toContainElement(
        wrapper,
      );
      expect(
        Boolean(within(wrapper).queryByRole("button", { name: /add rule/i })),
      ).toBe(canEdit);
    },
  );

  it.each([
    ["internal-org-admin", ORG_ADMIN],
    ["a team-scope admin", TEAM_ADMIN],
    ["a plain viewer", PLAIN_VIEWER],
  ] as const)("%s sees neither editor", async (_n, viewer) => {
    const api = stubAccessApi(withMapRoutes());
    renderSections(viewer);
    await vi.waitFor(() => expect(api.calls.length).toBeGreaterThanOrEqual(0));
    expect(
      screen.queryByRole("heading", { name: "Identity mapping" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /suggested links/i }),
    ).not.toBeInTheDocument();
    expect(
      api.calls.filter((c) => c.path.includes("identity-map-rules")),
    ).toEqual([]);
  });
});

describe("AccessSections - one failure never breaks the others (Rule 40.4)", () => {
  it.each([
    ["members", "GET /api/teams/team-pay/members", /couldn't load .*members/i],
    [
      "team-admins",
      "GET /api/teams/team-pay/admins",
      /couldn't load .*team admins/i,
    ],
    [
      "visibility",
      "GET /api/teams/team-pay/visibility",
      /couldn't load .*visibility/i,
    ],
    ["pending-access", "GET /api/access/pending", /couldn't load .*pending/i],
    [
      "group-mappings",
      "GET /api/group-mappings",
      /couldn't load .*group mappings/i,
    ],
    ["role-grants", "GET /api/role-grants", /couldn't load .*role grants/i],
    [
      "password-users",
      "GET /api/password-users",
      /couldn't load .*password users/i,
    ],
    [
      "per-user-approval",
      "GET /api/governance/per-user-approval",
      /couldn't load .*approval/i,
    ],
    ["audit-log", "GET /api/audit", /couldn't load .*audit log/i],
  ] as const)(
    "%s: a failing request shows that section's alert and Retry, and every other section still renders",
    async (slug, endpoint, message) => {
      stubAccessApi({
        ...baseRoutes(),
        [endpoint]: () => fail(500, "INTERNAL"),
      });
      renderSections(ADMIN);
      const alert = await screen.findByText(message);
      const failed = document.getElementById(slug) as HTMLElement;
      expect(failed).toContainElement(alert);
      expect(
        within(failed).getByRole("button", { name: "Retry" }),
      ).toBeInTheDocument();
      for (const other of ALL.filter((s) => s !== slug)) {
        expect(
          within(document.getElementById(other) as HTMLElement).queryByText(
            /couldn't load/i,
          ),
        ).not.toBeInTheDocument();
        expect(headingOf(other)).toBeInTheDocument();
      }
    },
  );

  // D-ST2: identity links load only after a pick, so the failure is triggered by one.
  it("identity-links: a failing request after a pick shows that section's alert and Retry", async () => {
    const user = userEvent.setup();
    stubAccessApi({
      ...baseRoutes(),
      "GET /api/identities/oid-alice/links": () => fail(500, "INTERNAL"),
    });
    renderSections(ADMIN);
    await pickAlice(user);
    const alert = await screen.findByText(/couldn't load .*identity links/i);
    const failed = document.getElementById("identity-links") as HTMLElement;
    expect(failed).toContainElement(alert);
    expect(
      within(failed).getByRole("button", { name: "Retry" }),
    ).toBeInTheDocument();
    for (const other of ALL.filter((s) => s !== "identity-links")) {
      expect(headingOf(other)).toBeInTheDocument();
    }
  });

  it("Retry refetches the failed section", async () => {
    const user = userEvent.setup();
    let calls = 0;
    stubAccessApi({
      ...baseRoutes(),
      "GET /api/group-mappings": () =>
        ++calls === 1 ? fail(500, "INTERNAL") : ok(page([groupMappingItem()])),
    });
    renderSections(ADMIN);
    await user.click(
      await within(
        document.getElementById("group-mappings") ?? document.body,
      ).findByRole("button", { name: "Retry" }),
    );
    expect(
      await screen.findByRole("row", { name: /11111111/ }),
    ).toBeInTheDocument();
  });

  it("shows a Skeleton in every visible section while data loads", () => {
    vi.stubGlobal("fetch", vi.fn(NEVER));
    renderSections(ADMIN);
    // D-ST2: identity links load nothing on mount (search box, no list).
    for (const slug of ALL.filter(
      (s) => s !== "access-review" && s !== "identity-links",
    )) {
      const section = document.getElementById(slug) as HTMLElement;
      expect(section.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    }
  });
});

// Unit D (Design System "Settings Page", 2026-11-16): each Access sub-tab and
// the Audit tab render a subset. `sections?: readonly AccessSectionSlug[]`
// narrows what AccessSections renders to those slugs; the viewer's
// capabilities still gate every one (defence in depth), and a section that is
// not rendered fetches nothing. Without the prop all permitted sections render
// (the tests above).
describe("AccessSections - sections prop (unit D)", () => {
  it("renders only the named sections, in canonical order", async () => {
    const api = stubAccessApi(baseRoutes());
    renderWithProviders(
      <AccessSections
        viewer={ADMIN}
        stepUp={stepUp}
        sections={["role-grants", "group-mappings"]}
      />,
    );
    await screen.findByRole("heading", { level: 2, name: "Role grants" });
    const shown = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(shown).toEqual(["Group mappings", "Role grants"]);
    expect(api.calls.some((c) => c.path === "/api/password-users")).toBe(false);
    expect(api.calls.some((c) => c.path.startsWith("/api/teams/"))).toBe(false);
  });

  it("never renders a named section the viewer cannot use, and fetches nothing for it", () => {
    const api = stubAccessApi(baseRoutes());
    renderWithProviders(
      <AccessSections
        viewer={ORG_ADMIN}
        stepUp={stepUp}
        sections={["role-grants", "audit-log"]}
      />,
    );
    expect(headingOf("role-grants")).not.toBeInTheDocument();
    expect(headingOf("audit-log")).not.toBeInTheDocument();
    expect(api.calls).toEqual([]);
  });

  it("an empty list renders nothing", () => {
    const api = stubAccessApi(baseRoutes());
    renderWithProviders(
      <AccessSections viewer={ADMIN} stepUp={stepUp} sections={[]} />,
    );
    expect(screen.queryAllByRole("heading")).toEqual([]);
    expect(api.calls).toEqual([]);
  });

  it("keeps each section's anchor slug so the hash resolver can scroll to it", async () => {
    stubAccessApi(baseRoutes());
    renderWithProviders(
      <AccessSections
        viewer={ADMIN}
        stepUp={stepUp}
        sections={["password-users"]}
      />,
    );
    await screen.findByRole("heading", { level: 2, name: "Password users" });
    expect(document.getElementById("password-users")?.tagName).toBe("SECTION");
  });
});

// Unit TM1, D-TM2 (Design System - Management pages, Team, "List, then the team"): AccessSections
// takes an optional `teamId` and passes it to Members, Team admins, Visibility
// and Pending access, so none of them shows a team or scope dropdown. Without
// it the sections keep their dropdowns (Settings -> Access). Prop contract:
// `<AccessSections viewer stepUp teamId="team-risk" sections=[...] />`.
describe("AccessSections with a teamId prop (TM1 D-TM2)", () => {
  const teamSections = [
    "members",
    "team-admins",
    "visibility",
    "pending-access",
  ] as const;
  const riskRoutes = (): RouteTable => ({
    ...baseRoutes(),
    "GET /api/teams/team-risk/members": page([
      memberItem({ oid: "oid-bob", teamId: "team-risk" }),
    ]),
    "GET /api/teams/team-risk/admins": page([]),
    "GET /api/teams/team-risk/visibility": {
      teamId: "team-risk",
      teamLevel: "visible",
      userLevel: "own",
      version: 0,
      updatedAt: "2026-11-10T09:00:00.000Z",
    },
  });

  it("renders no Team or Scope dropdown in the four team sections and reads the route's team", async () => {
    const api = stubAccessApi(riskRoutes());
    renderWithProviders(
      <AccessSections
        viewer={ADMIN}
        stepUp={stepUp}
        teamId="team-risk"
        sections={teamSections}
      />,
    );
    await screen.findByRole("row", { name: /Bob Brown/ });
    await screen.findByLabelText("User level");
    expect(screen.queryByLabelText("Team")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Scope")).not.toBeInTheDocument();
    expect(api.to("GET /api/teams/team-risk/admins").length).toBeGreaterThan(0);
    expect(
      api.to("GET /api/teams/team-risk/visibility").length,
    ).toBeGreaterThan(0);
    expect(api.to("GET /api/teams/team-pay/members")).toEqual([]);
    expect(api.to("GET /api/teams/team-pay/admins")).toEqual([]);
    expect(api.to("GET /api/teams/team-pay/visibility")).toEqual([]);
  });

  // Design System - "List, then the team", Pending and stale access: GET
  // /api/access/pending and /stale take an optional teamId query and the
  // filter runs on the server; AccessSections only passes the route's team.
  it("passes the team to Pending access: both lists are requested with ?teamId=<route team>", async () => {
    const rows = [
      {
        kind: "affiliation",
        emailOrUpn: "risk.hire@example.com",
        teamId: "team-risk",
        createdBy: "oid-admin",
        createdAt: "2026-11-10T09:00:00.000Z",
        version: 1,
      },
      {
        kind: "affiliation",
        emailOrUpn: "pay.hire@example.com",
        teamId: "team-pay",
        createdBy: "oid-admin",
        createdAt: "2026-11-10T09:00:00.000Z",
        version: 1,
      },
    ];
    const serverFiltered = (call: { search: string }) => {
      const id = new URLSearchParams(call.search).get("teamId");
      return ok(
        page(
          id === null
            ? rows
            : rows.filter((r) => r.kind === "affiliation" && r.teamId === id),
        ),
      );
    };
    const api = stubAccessApi({
      ...riskRoutes(),
      "GET /api/access/pending": serverFiltered,
      "GET /api/access/stale": serverFiltered,
    });
    renderWithProviders(
      <AccessSections
        viewer={ADMIN}
        stepUp={stepUp}
        teamId="team-risk"
        sections={["pending-access"]}
      />,
    );
    await screen.findByRole("row", { name: /risk\.hire@/ });
    expect(screen.queryByRole("row", { name: /pay\.hire@/ })).toBeNull();
    for (const key of ["GET /api/access/pending", "GET /api/access/stale"]) {
      const searches = api.to(key).map((c) => c.search);
      expect(searches.length).toBeGreaterThan(0);
      for (const q of searches) {
        expect(new URLSearchParams(q).get("teamId")).toBe("team-risk");
      }
    }
  });

  // Q-B2 (review r1; Design System - "List, then the team", Department
  // visibility on the team page): `departmentId` is the team's department.
  it("a department lead gets the department's Visibility panel on the team page; a team-only lead does not", async () => {
    stubAccessApi({
      ...baseRoutes(),
      "GET /api/departments/dept-eng/visibility": {
        departmentId: "dept-eng",
        departmentLevel: "hidden",
        maxUserLevel: "own",
        version: 2,
        updatedAt: "2026-11-10T09:00:00.000Z",
      },
    });
    const lead = renderWithProviders(
      <AccessSections
        viewer={DEPT_ADMIN}
        stepUp={stepUp}
        teamId="team-pay"
        departmentId="dept-eng"
        sections={["visibility"]}
      />,
    );
    expect(await screen.findByLabelText("Department totals")).toBeVisible();
    lead.unmount();
    renderWithProviders(
      <AccessSections
        viewer={TEAM_ADMIN}
        stepUp={stepUp}
        teamId="team-pay"
        departmentId="dept-eng"
        sections={["visibility"]}
      />,
    );
    await screen.findByLabelText("User level");
    expect(screen.queryByLabelText("Department totals")).toBeNull();
  });

  it("without the prop the Members, Team admins and Visibility dropdowns remain", async () => {
    stubAccessApi(baseRoutes());
    renderWithProviders(
      <AccessSections
        viewer={ADMIN}
        stepUp={stepUp}
        sections={["members", "team-admins", "visibility"]}
      />,
    );
    await screen.findByLabelText("Team");
    expect(screen.getAllByLabelText("Scope")).toHaveLength(2);
  });
});

// Design System - Team page, round 3 (unit TP1), FieldHelp table, T-TP6.
// Guard: AccessSections.tsx puts the help beside the Members and Team admins
// section headings (not inside the h2, so headingOf() keeps matching).
describe("AccessSections FieldHelp on the section headings (T-TP6)", () => {
  it.each(["Members", "Team admins"] as const)(
    "%s has its help text and the h2 keeps its exact name",
    async (field) => {
      stubAccessApi(baseRoutes());
      renderSections(ADMIN);
      expect(
        await screen.findByRole("heading", { level: 2, name: field }),
      ).toBeInTheDocument();
      await expectFieldHelp(field);
    },
  );
});
