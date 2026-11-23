import AxeBuilder from "@axe-core/playwright";
import {
  type APIResponse,
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  test,
} from "@playwright/test";

import { E2E_BASE_URL, E2E_LITELLM_BASE_URL } from "./support/constants";
import { deleteStoredIdentity, seedStoredIdentity } from "./support/identity";
import { waitForHydration } from "./support/hydration";
import { signInAsTestUser } from "./support/session";
import { deleteStoredLiteLLMConnection } from "../test/fixtures/e2e-litellm-connection-seed";
import {
  deleteStoredPasswordUser,
  seedStoredPasswordUser,
  setStoredIdentityUpn,
} from "../test/fixtures/e2e-password-user-seed";
import { withLiteLLMStateLock } from "../test/fixtures/e2e-litellm-state-lock";

// Sources: Design System - "The user page (unit US2)": D-US6 (the blocks),
// D-US7 (every action uses an existing route; a caller sees only the actions
// they may use), D-US8 (name edit, password user only, with the version it was
// shown), D-US10 / D-US12 (the SSO reference: admin and auditor read, an
// org-admin does not), D-US11 (roles per caller; open to internal-admin,
// internal-org-admin and internal-auditor, anyone else and an unknown oid the
// 404), "Known limits" (a role grant needing recent authentication asks
// "Confirm it's you"); Access Control T-US1 and the `GET /api/identities/[oid]`
// API row; Responsive (Rule 40.6: no sideways scroll at 375 and 1440).
// Detail is in UserDetailContent.test.tsx and the route tests (Rule 60.24a);
// this covers the real shell, the server read after each real write, the 404
// and axe/overflow.
//
// Seed approach. The page is a server read of DynamoDB Local, which the
// browser cannot stub, so a richer person is built through the real routes
// with an admin session: the Entra identity from `seedStoredIdentity`, then
// POST member / lead / role-grant / links and PUT litellm-link (the LiteLLM
// read is the e2e fake server, the connection and toggle are stored under the
// cross-worker LiteLLM state lock exactly as reset-spend-users.spec.ts does).
// The browser-side LiteLLM reads and the reset POST are fulfilled from
// fixtures (Rule 60.24). The password-user cases need an identity whose
// authMethod is "password" with its stored password user, which no existing
// support function writes; they use
// `test/fixtures/e2e-password-user-seed.ts`.
// The suite is fullyParallel and hooks run per worker, so each test seeds its
// own worker-unique person (name, email, usage key, LiteLLM id) and removes it
// afterwards. The person's email and name cannot collide with the dev-login
// spec's seeded identities or with the seeded directory (the IDENTS list the
// people pages read), and the LiteLLM state lock keeps the stored connection
// consistent for manage-users-links and dev-login.
// `tag` is `w<worker>-<test id prefix>`: unique per worker and per test, so a
// link item or grant left by one case never reaches the next (coordinator
// ruling). Ids stay far under the 128-character path-id limit.
// The usage key is a non-person key: a person-kind key of nobody is refused
// with 409 "A key belongs to a person" (Access Control T16).
function personFor(tag: string) {
  return {
    oid: `e2e-us2-person-${tag}`,
    email: `us2.person.${tag}@example.test`,
    upn: `us2.person.${tag}@sso.example.test`,
    displayName: "US2 Person",
    lastSeenRoles: [] as string[],
    litellmUserId: `ll-us2-${tag}`,
    usageKey: `us2-usage-${tag}`,
  };
}

function passwordPersonFor(tag: string) {
  return {
    oid: `local:e2e-us2-password-${tag}`,
    email: `us2.password.${tag}@example.test`,
    displayName: "US2 Password Person",
    expectedUpn: `us2.password.${tag}@sso.example.test`,
  };
}

function testTag(): string {
  const { workerIndex, testId } = test.info();
  return `w${workerIndex}-${testId.replace(/[^a-z0-9]/gi, "").slice(0, 10)}`;
}

async function expectNoBlockingViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target.join(" ")),
      })),
  ).toEqual([]);
}

async function expectNoHorizontalScroll(page: Page, label: string) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
    label,
  ).toBe(true);
}

const BLOCKS = [
  "Profile",
  "Sign-in",
  "LiteLLM",
  "Team",
  "Global roles",
  "Usage identities",
];

// Every action button of the page by accessible name (D-US7).
const ACTIONS = {
  grantRole: /^grant role/i,
  revokeRole: /^revoke (admin|org admin) from/i,
  saveLinks: /^save links/i,
  editName: /^edit name/i,
  move: /^move .* to another team/i,
  remove: /^remove from team/i,
  makeLead: /^make team lead/i,
  revokeLead: /^revoke lead of/i,
  unlink: /^unlink/i,
  resetSpend: /^reset spend for/i,
  removeKey: /^remove (usage identity|alias)/i,
};

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
async function call(
  context: BrowserContext,
  method: Method,
  path: string,
  data?: unknown,
): Promise<APIResponse> {
  return context.request.fetch(path, {
    method,
    headers: { origin: E2E_BASE_URL },
    ...(data === undefined ? {} : { data }),
  });
}
async function callOk(
  context: BrowserContext,
  method: Method,
  path: string,
  data?: unknown,
) {
  const res = await call(context, method, path, data);
  expect(
    res.ok(),
    `${method} ${path}: ${res.status()} ${await res.text()}`,
  ).toBe(true);
  return res;
}

async function signInAdmin(context: BrowserContext) {
  await context.clearCookies();
  await signInAsTestUser(context, {
    roles: ["internal-admin"],
    authTime: Math.floor(Date.now() / 1000),
  });
}

// One role per fresh context and page: Auth.js re-issues the session cookie
// on every response, so a cookie swap on a context whose page still has
// prefetches in flight lets a late Set-Cookie restore the previous role.
async function asRole<T>(
  browser: Browser,
  session: Parameters<typeof signInAsTestUser>[1],
  run: (page: Page, context: BrowserContext) => Promise<T>,
): Promise<T> {
  const ctx = await browser.newContext();
  try {
    await signInAsTestUser(ctx, session);
    return await run(await ctx.newPage(), ctx);
  } finally {
    await ctx.close();
  }
}

type OrgUnits = { teams: { id: string; name: string }[] };
async function twoTeams(context: BrowserContext) {
  const res = await callOk(context, "GET", "/api/access/org-units");
  const { data } = (await res.json()) as { data: OrgUnits };
  const [teamA, teamB] = [...data.teams].sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!teamA || !teamB) {
    throw new Error("the e2e seed must hold at least two teams");
  }
  return { teamA, teamB };
}

type Person = ReturnType<typeof personFor>;
type Plan = { member?: boolean; grant?: boolean; link?: boolean };
type Detail = {
  memberTeamId: string | null;
  memberVersion: number;
  leadScopes: { scopeType: string; scopeId: string; version: number }[];
  roleGrants?: { role: string; version: number }[];
  litellm: { state: string };
  linkVersion: number;
  usageIdentities?: string[];
  aliases?: string[];
};

// An admin session with recent authentication is the caller.
async function seedPerson(context: BrowserContext, person: Person, plan: Plan) {
  await signInAdmin(context);
  const teams = await twoTeams(context);
  if (plan.member) {
    await callOk(context, "POST", `/api/teams/${teams.teamA.id}/members`, {
      oid: person.oid,
    });
  }
  if (plan.grant) {
    await callOk(context, "POST", "/api/role-grants", {
      oid: person.oid,
      role: "internal-org-admin",
      reason: "US2 e2e seed",
    });
  }
  if (plan.link) {
    // An earlier unlink leaves the link item at a higher version.
    const current = (await (
      await callOk(context, "GET", `/api/identities/${person.oid}`)
    ).json()) as { data: Detail };
    await callOk(context, "PUT", `/api/identities/${person.oid}/litellm-link`, {
      litellmUserId: person.litellmUserId,
      mode: "manual",
      reason: "US2 e2e seed",
      version: current.data.linkVersion,
    });
  }
  return teams;
}

// Undoes whatever a case left, from the read the page itself uses, so no
// affiliation, scope, grant or link outlives the identity (idempotent).
async function cleanupPerson(context: BrowserContext, oid: string) {
  await signInAdmin(context);
  const res = await call(context, "GET", `/api/identities/${oid}`);
  if (res.status() === 404) return;
  expect(res.ok(), `read ${oid}: ${res.status()}`).toBe(true);
  const { data } = (await res.json()) as { data: Detail };
  const failures: unknown[] = [];
  const step = async (run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      failures.push(error);
    }
  };
  for (const grant of data.roleGrants ?? []) {
    await step(async () => {
      await callOk(context, "DELETE", `/api/role-grants/${oid}/${grant.role}`, {
        version: grant.version,
      });
    });
  }
  for (const scope of data.leadScopes) {
    const segment = scope.scopeType === "team" ? "teams" : "departments";
    await step(async () => {
      await callOk(
        context,
        "DELETE",
        `/api/${segment}/${scope.scopeId}/admins/${oid}`,
        { version: scope.version },
      );
    });
  }
  if (data.memberTeamId !== null) {
    const teamId = data.memberTeamId;
    await step(async () => {
      await callOk(context, "DELETE", `/api/teams/${teamId}/members/${oid}`, {
        version: data.memberVersion,
      });
    });
  }
  let linkVersion = data.linkVersion;
  if (data.litellm.state === "linked") {
    await step(async () => {
      const unlinked = await callOk(
        context,
        "DELETE",
        `/api/identities/${oid}/litellm-link`,
        { version: linkVersion },
      );
      linkVersion = ((await unlinked.json()) as { data: { version: number } })
        .data.version;
    });
  }
  if ((data.usageIdentities?.length ?? 0) + (data.aliases?.length ?? 0) > 0) {
    await step(async () => {
      await callOk(context, "PUT", `/api/identities/${oid}/links`, {
        usageIdentities: [],
        aliases: [],
        version: linkVersion,
      });
    });
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, `cleaning up ${oid}`);
  }
}

// The reset-spend case and the link seed read the stored LiteLLM connection and
// toggle on the server, which page.route cannot reach: store the e2e fake
// connection and switch resetMemberSpend on for the run, then restore BOTH,
// under the cross-worker state lock (same contract as reset-spend-users.spec.ts
// withResetEnabled, review R4 / U-W1).
async function withLiteLLMReady(
  context: BrowserContext,
  run: () => Promise<void>,
) {
  await withLiteLLMStateLock(async () => {
    const headers = { origin: E2E_BASE_URL };
    await signInAdmin(context);
    const connection = (await (
      await context.request.get("/api/litellm/connection")
    ).json()) as { data: { baseUrl: string | null; version: number } };
    const previousUrl = connection.data.baseUrl;
    type View = {
      data: {
        version: number;
        operations: { resetMemberSpend: { enabled: boolean } };
      };
    };
    const read = async () =>
      (await (
        await context.request.get("/api/litellm/toggles")
      ).json()) as View;
    let before: View["data"] | undefined;
    let failure: unknown;
    try {
      if (previousUrl !== E2E_LITELLM_BASE_URL) {
        const saved = await context.request.put("/api/litellm/connection", {
          headers,
          data: {
            baseUrl: E2E_LITELLM_BASE_URL,
            version:
              connection.data.version === 0 ? null : connection.data.version,
          },
        });
        expect(saved.status(), await saved.text()).toBe(200);
      }
      before = (await read()).data;
      const turnOn = await context.request.put("/api/litellm/toggles", {
        headers,
        data: {
          version: before.version === 0 ? null : before.version,
          toggles: { resetMemberSpend: true },
        },
      });
      expect(turnOn.status(), await turnOn.text()).toBe(200);
      await run();
    } catch (error) {
      failure = error;
    }

    const restoreFailures: unknown[] = [];
    const restore = async (step: () => Promise<void>) => {
      try {
        await step();
      } catch (error) {
        restoreFailures.push(error);
      }
    };
    const expectOk = async (res: APIResponse, what: string) =>
      expect(res.ok(), `${what}: ${res.status()} ${await res.text()}`).toBe(
        true,
      );
    await restore(async () => {
      if (before === undefined) return;
      await signInAdmin(context);
      const now = (await read()).data;
      await expectOk(
        await context.request.put("/api/litellm/toggles", {
          headers,
          data:
            before.version === 0
              ? { version: now.version, reset: true }
              : {
                  version: now.version,
                  toggles: {
                    resetMemberSpend:
                      before.operations.resetMemberSpend.enabled,
                  },
                },
        }),
        "restoring the resetMemberSpend toggle",
      );
    });
    await restore(async () => {
      if (previousUrl === null) {
        await deleteStoredLiteLLMConnection();
      } else if (previousUrl !== E2E_LITELLM_BASE_URL) {
        const current = (await (
          await context.request.get("/api/litellm/connection")
        ).json()) as { data: { version: number } };
        await expectOk(
          await context.request.put("/api/litellm/connection", {
            headers,
            data: { baseUrl: previousUrl, version: current.data.version },
          }),
          "restoring the LiteLLM connection",
        );
      }
    });

    if (failure !== undefined && restoreFailures.length > 0) {
      throw new AggregateError(
        [failure, ...restoreFailures],
        "the case failed and the restore also failed",
      );
    }
    if (failure !== undefined) throw failure;
    if (restoreFailures.length > 0) {
      throw new AggregateError(restoreFailures, "restoring the LiteLLM state");
    }
  });
}

// The browser-side reads and the one write the Reset spend dialog makes
// (Rule 60.24: no real LiteLLM; the same shapes as reset-spend-users.spec.ts).
async function stubResetDialog(
  page: Page,
  team: { id: string; name: string },
): Promise<string[]> {
  const posts: string[] = [];
  await page.route(/\/api\/litellm\/users\/[^/]+\/memberships$/, (route) =>
    route.fulfill({
      json: {
        data: {
          items: [
            { teamId: team.id, teamName: team.name, spend: 6, maxBudget: 10 },
          ],
        },
      },
    }),
  );
  await page.route(
    /\/api\/litellm\/teams\/[^/]+\/members\/[^/]+\/reset-spend$/,
    (route) => {
      posts.push(
        `${route.request().method()} ${decodeURIComponent(new URL(route.request().url()).pathname)}`,
      );
      return route.fulfill({
        json: { data: { oid: "oid", litellmUserId: "ll" } },
      });
    },
  );
  return posts;
}

const region = (page: Page, name: string) => page.getByRole("region", { name });

test.describe("Management -> Users -> a person (unit US2)", () => {
  let person = personFor("w0");
  let pageUrl = "";
  let passwordPerson = passwordPersonFor("w0");
  let passwordSeeded = false;

  test.beforeEach(async () => {
    const tag = testTag();
    person = personFor(tag);
    passwordPerson = passwordPersonFor(tag);
    passwordSeeded = false;
    pageUrl = `/dashboard/manage/users/${person.oid}`;
    await seedStoredIdentity(person);
    await setStoredIdentityUpn(person.oid, person.upn);
  });
  test.afterEach(async ({ context }) => {
    const failures: unknown[] = [];
    const attempt = async (run: () => Promise<void>) => {
      try {
        await run();
      } catch (error) {
        failures.push(error);
      }
    };
    await attempt(() => cleanupPerson(context, person.oid));
    await attempt(() => deleteStoredIdentity(person.oid));
    if (passwordSeeded) {
      await attempt(() => deleteStoredPasswordUser(passwordPerson));
    }
    passwordSeeded = false;
    if (failures.length > 0) {
      throw new AggregateError(failures, "afterEach cleanup failed");
    }
  });

  async function openPassword(seed: { version?: number; boundAt?: string }) {
    await seedStoredPasswordUser({
      ...passwordPerson,
      version: seed.version ?? 1,
      ...(seed.boundAt ? { boundAt: seed.boundAt } : {}),
    });
    passwordSeeded = true;
    return `/dashboard/manage/users/${passwordPerson.oid}`;
  }

  test("an admin sees every block of the person with the Entra read-only note (D-US6, D-US8)", async ({
    context,
    page,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(pageUrl);
    await waitForHydration(page);

    for (const name of BLOCKS) {
      await expect(region(page, name)).toBeVisible();
    }
    const profile = region(page, "Profile");
    await expect(profile.getByText("US2 Person")).toBeVisible();
    await expect(profile.getByText(person.email)).toBeVisible();
    await expect(
      profile.getByText(/comes from Entra at every sign-in/i),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: ACTIONS.editName }),
    ).toHaveCount(0);
  });

  test("a missing created date reads 'unknown', not a dash (D-US6, 2026-11-24 rulings)", async ({
    context,
    page,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-auditor"] });
    await page.goto(pageUrl);
    await waitForHydration(page);
    // The seeded identity predates `createdAt`.
    await expect(region(page, "Profile").getByText("unknown")).toBeVisible();
  });

  // ---- U-B1: every action, with the result on the page -----------------------

  test("an admin edits a password user's name with the version shown, and the new name stays after a reload (D-US8, Q-B1)", async ({
    context,
    page,
  }) => {
    const url = await openPassword({ version: 1 });
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await page.goto(url);
    await waitForHydration(page);

    const profile = region(page, "Profile");
    await expect(profile.getByText(passwordPerson.displayName)).toBeVisible();
    await page
      .getByRole("button", {
        name: `Edit name of ${passwordPerson.displayName}`,
      })
      .click();
    await profile.getByLabel("Display name").fill("  US2 Renamed  ");
    const patch = page.waitForRequest(
      (r) => r.method() === "PATCH" && r.url().includes("/api/password-users/"),
    );
    await profile.getByRole("button", { name: "Save" }).click();
    expect((await patch).postDataJSON()).toEqual({
      displayName: "US2 Renamed",
      version: 1,
    });
    await expect(
      profile.getByText("US2 Renamed", { exact: true }),
    ).toBeVisible();

    await page.reload();
    await waitForHydration(page);
    await expect(
      region(page, "Profile").getByText("US2 Renamed", { exact: true }),
    ).toBeVisible();
  });

  test("a name edit from a stale page is refused with the 'changed since you loaded it' message (Q-B1, Access Control Enforcement 6)", async ({
    context,
    page,
  }) => {
    const url = await openPassword({ version: 1 });
    await signInAsTestUser(context, {
      roles: ["internal-admin"],
      authTime: Math.floor(Date.now() / 1000),
    });
    await page.goto(url);
    await waitForHydration(page);
    await page
      .getByRole("button", {
        name: `Edit name of ${passwordPerson.displayName}`,
      })
      .click();
    // Another admin renames first, so the page's version is stale.
    await callOk(
      context,
      "PATCH",
      `/api/password-users/${encodeURIComponent(passwordPerson.email)}`,
      { displayName: "Changed elsewhere", version: 1 },
    );
    const profile = region(page, "Profile");
    await profile.getByLabel("Display name").fill("US2 Late Edit");
    await profile.getByRole("button", { name: "Save" }).click();
    await expect(profile.getByRole("alert")).toContainText(
      /changed since you loaded it/i,
    );
  });

  test("an admin grants a role with a reason and it is listed; Revoke removes it (D-US7, Access Control Roles)", async ({
    context,
    page,
  }) => {
    await seedPerson(context, person, { member: false });
    await page.goto(pageUrl);
    await waitForHydration(page);
    const roles = region(page, "Global roles");
    await expect(roles.getByText("No roles granted here.")).toBeVisible();

    await roles.getByRole("button", { name: "Grant role" }).click();
    const dialog = page.getByRole("dialog", { name: "Grant role" });
    await dialog.getByLabel("Role").selectOption({ label: "Org admin" });
    await dialog.getByLabel("Reason").fill("US2 e2e grant");
    await dialog.getByRole("button", { name: "Grant", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(roles.getByText("Org admin", { exact: true })).toBeVisible();

    await roles
      .getByRole("button", {
        name: `Revoke Org admin from ${person.displayName}`,
      })
      .click();
    const confirm = page.getByRole("dialog", { name: "Revoke role" });
    await confirm.getByRole("button", { name: "Revoke", exact: true }).click();
    await expect(confirm).toBeHidden();
    await expect(roles.getByText("No roles granted here.")).toBeVisible();
  });

  test("a role grant on a session without recent authentication opens the 'Confirm it's you' step-up (Known limits, Access Control Recent authentication)", async ({
    context,
    page,
  }) => {
    await signInAsTestUser(context, { roles: ["internal-admin"] });
    await page.goto(pageUrl);
    await waitForHydration(page);
    const roles = region(page, "Global roles");
    await roles.getByRole("button", { name: "Grant role" }).click();
    const grant = page.getByRole("dialog", { name: "Grant role" });
    await grant.getByLabel("Reason").fill("US2 e2e needs re-auth");
    await grant.getByRole("button", { name: "Grant", exact: true }).click();
    const stepUp = page.getByRole("dialog", { name: "Confirm it's you" });
    await expect(stepUp).toBeVisible();
    await expect(
      stepUp.getByRole("button", { name: "Confirm with Microsoft" }),
    ).toBeVisible();
    await stepUp.getByRole("button", { name: "Cancel" }).click();
    await expect(stepUp).toBeHidden();
    await grant.getByRole("button", { name: "Cancel" }).click();
    await expect(grant).toBeHidden();
    await expect(roles.getByText("No roles granted here.")).toBeVisible();
  });

  test("Move changes the member team and Remove takes the person out of it (D-US7 moveMember)", async ({
    context,
    page,
  }) => {
    const { teamA, teamB } = await seedPerson(context, person, {
      member: true,
    });
    await page.goto(pageUrl);
    await waitForHydration(page);
    const team = region(page, "Team");
    await expect(team.getByText(teamA.name, { exact: true })).toBeVisible();

    await team
      .getByRole("button", {
        name: `Move ${person.displayName} to another team`,
      })
      .click();
    const move = page.getByRole("dialog", { name: "Move to another team" });
    await move
      .getByLabel("Destination team")
      .selectOption({ label: teamB.name });
    await move.getByRole("button", { name: "Move", exact: true }).click();
    await expect(move).toBeHidden();
    await expect(team.getByText(teamB.name, { exact: true })).toBeVisible();

    await team
      .getByRole("button", { name: `Remove from team ${teamB.name}` })
      .click();
    const remove = page.getByRole("dialog", { name: "Remove from team" });
    await remove.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(remove).toBeHidden();
    await expect(team.getByText("No team.")).toBeVisible();
  });

  test("Make team lead makes this exact person lead of their member team and Revoke removes it (D-US7 teamAdmins, R2)", async ({
    context,
    page,
  }) => {
    const { teamA } = await seedPerson(context, person, { member: true });
    await page.goto(pageUrl);
    await waitForHydration(page);
    const team = region(page, "Team");

    await team
      .getByRole("button", { name: `Make team lead of ${teamA.name}` })
      .click();
    await expect(team.getByText("Lead", { exact: true })).toBeVisible();
    await expect(
      team.getByRole("button", { name: /^make team lead/i }),
    ).toHaveCount(0);

    await team
      .getByRole("button", { name: `Revoke lead of ${teamA.name}` })
      .click();
    const revoke = page.getByRole("dialog", { name: "Revoke lead" });
    await revoke.getByRole("button", { name: "Revoke", exact: true }).click();
    await expect(revoke).toBeHidden();
    await expect(team.getByText("Lead", { exact: true })).toHaveCount(0);
    await expect(
      team.getByRole("button", { name: `Make team lead of ${teamA.name}` }),
    ).toBeVisible();
  });

  test("Save links stores an added usage identity and it is still listed after a reload (D-US11 identityLinks)", async ({
    context,
    page,
  }) => {
    await signInAdmin(context);
    await page.goto(pageUrl);
    await waitForHydration(page);
    const links = region(page, "Usage identities");
    await expect(links.getByText(person.usageKey)).toHaveCount(0);

    await links.getByLabel("New usage identity").fill(person.usageKey);
    await links.getByRole("button", { name: "Add usage identity" }).click();
    await expect(links.getByText(person.usageKey)).toBeVisible();
    await links.getByRole("button", { name: ACTIONS.saveLinks }).click();
    await expect(links.getByRole("status")).toHaveText("Saved.");

    await page.reload();
    await waitForHydration(page);
    await expect(
      region(page, "Usage identities").getByText(person.usageKey),
    ).toBeVisible();
  });

  test("Unlink removes the LiteLLM link and the Reset spend that depended on it (D-US7, D-US9)", async ({
    context,
    page,
  }) => {
    await withLiteLLMReady(context, async () => {
      await seedPerson(context, person, { link: true });
      await page.goto(pageUrl);
      await waitForHydration(page);
      const litellm = region(page, "LiteLLM");
      await expect(litellm.getByText(person.litellmUserId)).toBeVisible();
      await expect(
        litellm.getByRole("button", { name: ACTIONS.resetSpend }),
      ).toBeVisible();

      await litellm.getByRole("button", { name: ACTIONS.unlink }).click();
      const dialog = page.getByRole("alertdialog", {
        name: "Remove this link?",
      });
      await dialog.getByRole("button", { name: "Remove link" }).click();
      await expect(dialog).toBeHidden();
      await expect(litellm.getByText(person.litellmUserId)).toHaveCount(0);
      await expect(
        litellm.getByRole("button", { name: ACTIONS.resetSpend }),
      ).toHaveCount(0);
      await cleanupPerson(context, person.oid);
    });
  });

  test("Reset spend opens the dialog and a confirm calls the reset route for that team and person (D-US7, RS1)", async ({
    context,
    page,
  }) => {
    await withLiteLLMReady(context, async () => {
      const { teamA } = await seedPerson(context, person, {
        member: true,
        link: true,
      });
      const posts = await stubResetDialog(page, teamA);
      await page.goto(pageUrl);
      await waitForHydration(page);

      await region(page, "LiteLLM")
        .getByRole("button", { name: `Reset spend for ${person.displayName}` })
        .click();
      const dialog = page.getByRole("alertdialog", {
        name: `Reset spend for ${person.displayName}?`,
      });
      await expect(dialog).toBeVisible();
      await dialog
        .getByRole("button", { name: `Reset spend in ${teamA.name}` })
        .click();
      await expect(dialog).toContainText("Spend reset to $0.00");
      expect(posts).toEqual([
        `POST /api/litellm/teams/${teamA.id}/members/${person.oid}/reset-spend`,
      ]);
      await cleanupPerson(context, person.oid);
    });
  });

  // ---- U-B2: role checks on the richer person --------------------------------

  test("admin has every action, auditor none, org-admin edits team and LiteLLM but only reads roles and identities, a lead gets the 404 (D-US7, D-US11, T-US1)", async ({
    browser,
    context,
  }) => {
    await withLiteLLMReady(context, async () => {
      const { teamB } = await seedPerson(context, person, {
        member: true,
        grant: true,
        link: true,
      });
      await callOk(context, "POST", `/api/teams/${teamB.id}/admins`, {
        oid: person.oid,
      });
      const read = (await (
        await callOk(context, "GET", `/api/identities/${person.oid}`)
      ).json()) as { data: Detail };
      await callOk(context, "PUT", `/api/identities/${person.oid}/links`, {
        usageIdentities: [person.usageKey],
        aliases: [],
        litellmUserId: person.litellmUserId,
        version: read.data.linkVersion,
      });

      const open = async (
        roles: string[],
        check: (page: Page) => Promise<void>,
      ) =>
        asRole(browser, { roles }, async (page) => {
          await page.goto(pageUrl);
          await waitForHydration(page);
          for (const name of BLOCKS) {
            await expect(region(page, name)).toBeVisible();
          }
          await check(page);
        });
      const count = (page: Page, name: RegExp) =>
        page.getByRole("button", { name });

      await open(["internal-admin"], async (page) => {
        for (const name of [
          ACTIONS.grantRole,
          ACTIONS.revokeRole,
          ACTIONS.saveLinks,
          ACTIONS.move,
          ACTIONS.remove,
          ACTIONS.makeLead,
          ACTIONS.revokeLead,
          ACTIONS.unlink,
          ACTIONS.resetSpend,
          ACTIONS.removeKey,
        ]) {
          await expect(count(page, name).first(), String(name)).toBeVisible();
        }
      });

      // D-US11: reads roles and identities, edits team and LiteLLM, no SSO.
      await open(["internal-org-admin"], async (page) => {
        await expect(
          region(page, "Global roles").getByText("Org admin"),
        ).toBeVisible();
        await expect(
          region(page, "Usage identities").getByText(person.usageKey),
        ).toBeVisible();
        for (const name of [
          ACTIONS.grantRole,
          ACTIONS.revokeRole,
          ACTIONS.saveLinks,
          ACTIONS.removeKey,
          ACTIONS.editName,
        ]) {
          await expect(count(page, name), String(name)).toHaveCount(0);
        }
        for (const name of [
          ACTIONS.move,
          ACTIONS.remove,
          ACTIONS.revokeLead,
          ACTIONS.unlink,
          ACTIONS.resetSpend,
        ]) {
          await expect(count(page, name).first(), String(name)).toBeVisible();
        }
        await expect(page.getByText(/expected upn/i)).toHaveCount(0);
      });

      await open(["internal-auditor"], async (page) => {
        for (const name of Object.values(ACTIONS)) {
          await expect(count(page, name), String(name)).toHaveCount(0);
        }
        await expect(
          region(page, "Global roles").getByText("Org admin"),
        ).toBeVisible();
      });

      // T-US1: a team lead is not a reader; the same 404 page.
      await asRole(
        browser,
        { roles: [], oid: "local:team-lead@localhost" },
        async (page) => {
          const refused = await page.goto(pageUrl);
          expect(refused?.status()).toBe(404);
        },
      );
      await cleanupPerson(context, person.oid);
    });
  });

  test("a password user's SSO reference: admin and auditor read it with 'Signs in with SSO since', an org-admin sees only 'Signs in with a password', and a bound user has no name edit (D-US10, D-US12, R1)", async ({
    browser,
  }) => {
    const url = await openPassword({
      version: 3,
      boundAt: "2026-11-12T08:00:00.000Z",
    });
    for (const roles of [["internal-admin"], ["internal-auditor"]]) {
      await asRole(browser, { roles }, async (page) => {
        await page.goto(url);
        await waitForHydration(page);
        const signIn = region(page, "Sign-in");
        await expect(
          signIn.getByText("Signs in with a password"),
        ).toBeVisible();
        await expect(
          signIn.getByText(passwordPerson.expectedUpn),
        ).toBeVisible();
        await expect(
          signIn.getByText("Signs in with SSO since 2026-11-12"),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: ACTIONS.editName }),
        ).toHaveCount(0);
      });
    }

    await asRole(browser, { roles: ["internal-org-admin"] }, async (page) => {
      await page.goto(url);
      await waitForHydration(page);
      const signIn = region(page, "Sign-in");
      await expect(signIn.getByText("Signs in with a password")).toBeVisible();
      await expect(signIn.getByText(passwordPerson.expectedUpn)).toHaveCount(0);
      await expect(signIn.getByText(/signs in with sso since/i)).toHaveCount(0);
    });
  });

  test("a viewer gets the 404 and an unknown oid is the same 404 for an admin (T-US1)", async ({
    browser,
  }) => {
    await asRole(browser, { roles: ["internal-viewer"] }, async (page) => {
      const refused = await page.goto(pageUrl);
      expect(refused?.status()).toBe(404);
    });
    await asRole(browser, { roles: ["internal-admin"] }, async (page) => {
      const unknown = await page.goto("/dashboard/manage/users/no-such-person");
      expect(unknown?.status()).toBe(404);
    });
  });

  // ---- U-B3: axe and overflow at 375 and 1440, dialogs open -----------------

  for (const width of [375, 1440]) {
    test(`at ${width}px the page, Grant role, Move and Reset spend have no serious axe violation and no sideways scroll (Rule 40.6)`, async ({
      context,
      page,
    }) => {
      await withLiteLLMReady(context, async () => {
        const { teamA } = await seedPerson(context, person, {
          member: true,
          grant: true,
          link: true,
        });
        await stubResetDialog(page, teamA);
        await page.setViewportSize({ width, height: 900 });
        await page.goto(pageUrl);
        await waitForHydration(page);
        await expect(region(page, "Team")).toBeVisible();

        await expectNoBlockingViolations(page);
        await expectNoHorizontalScroll(page, "the page");

        await region(page, "Global roles")
          .getByRole("button", { name: "Grant role" })
          .click();
        await expect(
          page.getByRole("dialog", { name: "Grant role" }),
        ).toBeVisible();
        await expectNoBlockingViolations(page);
        await expectNoHorizontalScroll(page, "with Grant role open");
        await page.keyboard.press("Escape");

        await region(page, "Team")
          .getByRole("button", { name: ACTIONS.move })
          .click();
        await expect(
          page.getByRole("dialog", { name: "Move to another team" }),
        ).toBeVisible();
        await expectNoBlockingViolations(page);
        await expectNoHorizontalScroll(page, "with Move open");
        await page.keyboard.press("Escape");

        await region(page, "LiteLLM")
          .getByRole("button", { name: ACTIONS.resetSpend })
          .click();
        const reset = page.getByRole("alertdialog", {
          name: `Reset spend for ${person.displayName}?`,
        });
        await expect(
          reset.getByRole("list", { name: "Team memberships" }),
        ).toBeVisible();
        await expectNoBlockingViolations(page);
        await expectNoHorizontalScroll(page, "with Reset spend open");
        await cleanupPerson(context, person.oid);
      });
    });
  }
});
