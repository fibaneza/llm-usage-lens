// Test-only registry of every Route Handler under app/api: one typed entry per
// METHOD + route file, the single source the shared route-contract suite
// (app/api/__tests__/route-contract.integration.test.ts) iterates, and the lists
// write-routes.integration.test.ts takes its permission classes from. Not
// imported by production code.
//
// Source: Rule 60.23 (amended 2026-11-15: the cross-cutting route contract is
// asserted once, over a registry of every route; a new route registers here),
// Rule 10.3, Rule 50.4; Access Control spec - "Enforcement" items 2, 4, 6 and
// "Audit log" D17/T22.
//
// ADDING A ROUTE: register every exported method. The suite's parity check
// fails on an unregistered route file and on a stale entry. Entries are
// compared against the route files on THIS branch's disk.
// Frozen entries (`frozen: true`) are routes whose own test file or route file
// is on the frozen list: the suite gives them only today's sweep parity
// (401, 403 before parsing, Origin 403, no-store) and no new assertion.
import { createGroupMapping } from "@/lib/data/access/group-mappings";
import { completePasswordSetupWrite } from "@/lib/data/access/password-credentials-store";
import {
  createPasswordUser,
  sha256Hex,
} from "@/lib/data/access/password-users";
import { grantRole } from "@/lib/data/access/role-grants";
import { putTeamLink } from "@/lib/data/litellm/team-links";
import { ok } from "@/test/support/access-test-support";
import {
  PEOPLE,
  seedAdminScope,
  seedCtx,
  seedMember,
} from "@/test/support/matrix-route-support";
import { accounts } from "@/test/fixtures/scope-fixtures";
import { SESSIONS } from "@/test/support/governance-route-support";
import { putRaw } from "@/test/support/test-support";

export type RouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type RouteKind =
  | "public"
  | "read"
  | "admin-write"
  | "matrix-write"
  | "self-write"
  // Any signed-in role, own state only, keys from the session (unit M4).
  | "own-write";
export type RouteFamily = "core" | "litellm";
// Session shapes the suite knows how to sign in as (see the suite's CALLERS).
export type CallerName =
  | "admin"
  | "orgAdmin"
  | "auditor"
  | "viewer"
  | "noRoles"
  | "password"
  | "entraAdmin"
  | "masterAdmin"
  | "localAdmin";

export type RouteEntry = {
  // "PUT governance/password-sign-in/route.ts"
  key: string;
  method: RouteMethod;
  // Route file relative to app/api, "/" separated.
  file: string;
  // "/api/governance/password-sign-in" (dynamic segments stay as [name]).
  pattern: string;
  kind: RouteKind;
  family: RouteFamily;
  frozen: boolean;
  // True for the 4R.4 access-control writes (group mappings, governance,
  // password users, role grants, identity links).
  accessControl: boolean;
  // Creates the real target so a write that wrongly ran would change the table.
  seed?: () => Promise<void>;
  params: {
    // The real seeded ids.
    valid: Record<string, string>;
    // A malformed id (200 x characters).
    invalid: Record<string, string>;
  };
  // Query string of a successful read.
  query?: string;
  // Read routes with a query schema: a query that must answer 400.
  badQuery?: string;
  // A body that would succeed for a permitted caller (writes).
  validBody?: unknown;
  // Input for the 400 check when the route's own body is not what it parses
  // (a DELETE without a body is refused on its path parameter instead).
  badInput?: { body?: string; params?: Record<string, string> };
  // Statuses a permitted same-origin call with `validBody` answers; absent
  // when the route reaches a dependency this suite does not fake.
  successStatuses?: number[];
  // Needs a sign-in within 900 s (Access Control spec - D28; F3).
  reauth: boolean;
  // The `denied` audit a refusal writes (writes; D17/T22).
  denied?: { action: string };
  // Callers that must be refused (403) on a write.
  refusedCallers: CallerName[];
  // Callers that pass the permission gate on a write.
  permittedCallers: CallerName[];
  // Admin-only writes also say so in the 403 message.
  permission?: "internal-admin";
};

const ADMIN_REFUSED: CallerName[] = [
  "auditor",
  "orgAdmin",
  "viewer",
  "noRoles",
];
const MATRIX_REFUSED: CallerName[] = ["auditor", "viewer", "noRoles"];
const SELF_REFUSED: CallerName[] = [
  "entraAdmin",
  "masterAdmin",
  "localAdmin",
  "noRoles",
];

const PARAM = /\[(\w+)\]/g;
const DUMMY = "not-an-id";
const LONG = "x".repeat(200);

function paramNames(pattern: string): string[] {
  return [...pattern.matchAll(PARAM)].map((m) => m[1] ?? "");
}

function invalidFor(pattern: string): Record<string, string> {
  return Object.fromEntries(paramNames(pattern).map((name) => [name, LONG]));
}

type Base = {
  method: RouteMethod;
  file: string;
  validParams?: Record<string, string>;
  family?: RouteFamily;
  frozen?: boolean;
};

function patternOf(file: string): string {
  const dir = file.replace(/\/?route\.ts$/, "");
  return `/api${dir === "" ? "" : `/${dir}`}`;
}

function base(b: Base) {
  const pattern = patternOf(b.file);
  const frozen = b.frozen ?? false;
  const validParams =
    b.validParams ??
    Object.fromEntries(paramNames(pattern).map((name) => [name, DUMMY]));
  return {
    key: `${b.method} ${b.file}`,
    method: b.method,
    file: b.file,
    pattern,
    family: b.family ?? ("core" as RouteFamily),
    frozen,
    accessControl: false,
    params: { valid: validParams, invalid: invalidFor(pattern) },
    reauth: false,
    refusedCallers: [] as CallerName[],
    permittedCallers: [] as CallerName[],
  };
}

const RANGE = "dateFrom=2026-10-01&dateTo=2026-10-03";
const BAD_RANGE = "dateFrom=not-a-date&dateTo=2026-10-03";

function read(
  file: string,
  opts: Omit<Base, "method" | "file"> &
    Partial<Pick<RouteEntry, "query" | "badQuery" | "kind">> = {},
): RouteEntry {
  const { query, badQuery, kind, ...rest } = opts;
  return {
    ...base({ method: "GET", file, ...rest }),
    kind: kind ?? "read",
    ...(query !== undefined ? { query } : {}),
    ...(badQuery !== undefined ? { badQuery } : {}),
  };
}

type WriteOpts = Omit<Base, "method" | "file"> &
  Partial<
    Pick<
      RouteEntry,
      | "seed"
      | "validBody"
      | "badInput"
      | "successStatuses"
      | "reauth"
      | "accessControl"
    >
  > & { action?: string };

function adminWrite(
  method: RouteMethod,
  file: string,
  opts: WriteOpts = {},
): RouteEntry {
  const { action, ...rest } = opts;
  return {
    ...base({ method, file, ...opts }),
    kind: "admin-write",
    ...rest,
    reauth: opts.reauth ?? false,
    accessControl: opts.accessControl ?? false,
    ...(action ? { denied: { action } } : {}),
    refusedCallers: ADMIN_REFUSED,
    permittedCallers: ["admin"],
    permission: "internal-admin",
  };
}

function matrixWrite(
  method: RouteMethod,
  file: string,
  opts: WriteOpts = {},
): RouteEntry {
  const { action, ...rest } = opts;
  return {
    ...base({ method, file, ...opts }),
    kind: "matrix-write",
    ...rest,
    reauth: false,
    accessControl: false,
    ...(action ? { denied: { action } } : {}),
    refusedCallers: MATRIX_REFUSED,
    permittedCallers: ["admin", "orgAdmin"],
  };
}

const alice = PEOPLE.alice;

// ---- unit M4 seeds: keys and fields as the Data Model spec names them ----
const RESET_REQUEST_ID = "00000000-0000-4000-8000-0000000000b1";
const RESET_TOGGLES = {
  PK: "LITELLM#CONFIG",
  SK: "TOGGLES",
  version: 1,
  toggles: { resetMemberSpend: true },
  updatedAt: "2026-01-02T03:04:05.000Z",
};

async function linkTeam(teamId: string): Promise<void> {
  ok(
    await putTeamLink(
      { teamId, litellmTeamId: `lt-${teamId}`, version: null },
      seedCtx(),
    ),
  );
}

// The permitted callers of the request route are members of linked teams
// (Admin of team-a, org-admin of team-b) with the reset toggle on.
async function seedRequesters(): Promise<void> {
  await putRaw(RESET_TOGGLES);
  await linkTeam("team-a");
  await linkTeam("team-b");
  await seedMember(SESSIONS.admin.oid, "team-a");
  await seedMember(SESSIONS.orgAdmin.oid, "team-b");
}

// An open request by Alice (a member of the linked team-a) for approve/deny.
async function seedOpenRequest(): Promise<void> {
  await putRaw(RESET_TOGGLES);
  await linkTeam("team-a");
  await seedMember(alice.oid, "team-a");
  const createdAt = new Date().toISOString();
  const requestExpiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  await putRaw({
    PK: `BRREQ#${RESET_REQUEST_ID}`,
    SK: "META",
    gsi1pk: "BRREQS#TEAM#team-a",
    gsi1sk: `open#${createdAt}#${RESET_REQUEST_ID}`,
    requestId: RESET_REQUEST_ID,
    teamId: "team-a",
    departmentId: "dept-eng",
    litellmTeamId: "lt-team-a",
    requesterOid: alice.oid,
    reason: null,
    status: "open",
    createdAt,
    requestExpiresAt,
    decidedBy: null,
    decidedAt: null,
    resetId: null,
    version: 1,
    expiresAt: Math.floor(Date.now() / 1000) + 90 * 86_400,
  });
  await putRaw({
    PK: `BRREQOPEN#team-a#${alice.oid}`,
    SK: "OWNER",
    requestId: RESET_REQUEST_ID,
    requestExpiresAt,
    expiresAt: Math.floor(Date.now() / 1000) + 7 * 86_400,
  });
}

const TEAM = { id: "team-a" };
const DEPT = { id: "dept-eng" };
const teamAccount = accounts[0];
const ACCOUNT_ID = teamAccount ? teamAccount.accountId : "000000000000";

const newAccount = {
  accountId: "111122223333",
  accountName: "new-account",
  departmentId: "dept-finance",
  departmentName: "Finance",
  teamId: "team-ledger",
  teamName: "Ledger",
  region: "ap-southeast-2",
};

async function seedPasswordUser(): Promise<void> {
  ok(
    await createPasswordUser(
      { email: "alice@example.com", displayName: "Alice" },
      seedCtx(),
    ),
  );
}

// A TOTP-enrolled user: the Origin-refusal snapshot of the totp-reset route
// then proves the enrolment is left untouched (Access Control spec - TOTP D23).
async function seedEnrolledPasswordUser(): Promise<void> {
  const created = ok(
    await createPasswordUser(
      { email: "alice@example.com", displayName: "Alice" },
      seedCtx(),
    ),
  );
  ok(
    await completePasswordSetupWrite(
      {
        email: "alice@example.com",
        tokenHash: sha256Hex(created.setupToken),
        passwordHash: "$argon2id$v=19$SEED-PASSWORD-HASH",
        totp: { cipher: "SEED-TOTP-CIPHER", step: 7 },
      },
      seedCtx(),
    ),
  );
}

async function seedGroupMapping(): Promise<void> {
  ok(
    await createGroupMapping(
      {
        groupId: "g-existing",
        target: { type: "team", id: "team-a" },
        scopedRole: "member",
      } as never,
      seedCtx(),
    ),
  );
}

export const ROUTE_REGISTRY: RouteEntry[] = [
  // ---- public (Platform spec: GET /api/health has no session, no data) ----
  read("health/route.ts", { kind: "public" }),

  // ---- core reads ----
  read("access-review/route.ts"),
  read("access/org-units/route.ts", { frozen: true }),
  read("access/pending/route.ts", { frozen: true }),
  read("access/stale/route.ts", { frozen: true }),
  read("accounts/route.ts"),
  read("audit/route.ts", { badQuery: "day=not-a-day" }),
  // Unit M4 (Data Model - API Routes): every role may call these; the rows they
  // return are scoped, so a caller without scope gets 404 or an empty list.
  read("budget-reset-requests/route.ts", {
    query: "teamId=team-a&status=open",
    badQuery: "teamId=team-a&status=bogus",
  }),
  read("budget-reset-requests/mine/route.ts"),
  read("budget-resets/route.ts", { query: RANGE, badQuery: BAD_RANGE }),
  read("notifications/route.ts"),
  read("departments/route.ts", { query: RANGE, badQuery: BAD_RANGE }),
  read("departments/[id]/route.ts", {
    validParams: { id: "dept-eng" },
    query: RANGE,
    badQuery: BAD_RANGE,
  }),
  read("departments/[id]/admins/route.ts", { validParams: { id: "dept-eng" } }),
  read("departments/[id]/visibility/route.ts", {
    validParams: { id: "dept-eng" },
  }),
  read("governance/identity-map-rules/route.ts"),
  read("governance/identity-map-rules/suggestions/route.ts", {
    query: RANGE,
    badQuery: BAD_RANGE,
  }),
  read("governance/password-sign-in/route.ts"),
  read("governance/per-user-approval/route.ts"),
  read("group-mappings/route.ts"),
  read("identities/route.ts"),
  read("identities/[oid]/links/route.ts", {
    validParams: { oid: PEOPLE.alice.oid },
  }),
  read("me/route.ts"),
  read("me/usage/route.ts", { query: RANGE, badQuery: BAD_RANGE }),
  read("overview/route.ts", { query: RANGE, badQuery: BAD_RANGE }),
  read("password-users/route.ts"),
  read("ranking/route.ts", { query: RANGE, badQuery: BAD_RANGE }),
  read("role-grants/route.ts"),
  read("services/route.ts", { query: RANGE, badQuery: BAD_RANGE }),
  read("sync-status/route.ts"),
  read("teams/route.ts", { query: RANGE, badQuery: BAD_RANGE }),
  read("teams/[id]/route.ts", {
    validParams: { id: "team-a" },
    query: RANGE,
    badQuery: BAD_RANGE,
  }),
  read("teams/[id]/admins/route.ts", { validParams: { id: "team-a" } }),
  read("teams/[id]/members/route.ts", { validParams: { id: "team-a" } }),
  read("teams/[id]/visibility/route.ts", { validParams: { id: "team-a" } }),
  read("users/route.ts", { query: RANGE, badQuery: BAD_RANGE }),

  // ---- litellm reads (the gateway is faked; LiteLLM spec - API routes) ----
  read("litellm/audit/route.ts", { family: "litellm" }),
  read("litellm/connection/route.ts", { family: "litellm" }),
  read("litellm/me/route.ts", { family: "litellm", frozen: true }),
  read("litellm/org/route.ts", {
    family: "litellm",
    frozen: true,
    query: RANGE,
    badQuery: BAD_RANGE,
  }),
  read("litellm/users/route.ts", { family: "litellm", frozen: true }),
  read("litellm/users/[litellmUserId]/route.ts", {
    family: "litellm",
    frozen: true,
    validParams: { litellmUserId: "lu-1" },
    query: RANGE,
    badQuery: BAD_RANGE,
  }),
  read("litellm/models/route.ts", { family: "litellm" }),
  read("litellm/orphans/route.ts", { family: "litellm" }),
  read("litellm/team-links/route.ts", { family: "litellm" }),
  read("litellm/team-links/[teamId]/route.ts", {
    family: "litellm",
    validParams: { teamId: "team-a" },
  }),
  read("litellm/teams/[teamId]/route.ts", {
    family: "litellm",
    validParams: { teamId: "team-a" },
    query: RANGE,
    badQuery: BAD_RANGE,
  }),
  read("litellm/teams/[teamId]/keys/route.ts", {
    family: "litellm",
    validParams: { teamId: "team-a" },
  }),
  read("litellm/teams/[teamId]/members/route.ts", {
    family: "litellm",
    validParams: { teamId: "team-a" },
  }),
  read("litellm/teams/[teamId]/spend-logs/route.ts", {
    family: "litellm",
    validParams: { teamId: "team-a" },
    query: RANGE,
    badQuery: BAD_RANGE,
  }),
  read("litellm/toggles/route.ts", { family: "litellm" }),

  // ---- litellm L6 (LiteLLM spec - Combined usage and My usage -> Routes) ----
  read("litellm/gateway/route.ts", { family: "litellm" }),
  read("litellm/combined/organisation/route.ts", {
    family: "litellm",
    query: RANGE,
    badQuery: BAD_RANGE,
  }),
  read("litellm/combined/teams/route.ts", {
    family: "litellm",
    query: RANGE,
    badQuery: BAD_RANGE,
  }),
  read("litellm/combined/teams/[teamId]/route.ts", {
    family: "litellm",
    validParams: { teamId: "team-a" },
    query: RANGE,
    badQuery: BAD_RANGE,
  }),
  read("litellm/combined/me/route.ts", {
    family: "litellm",
    query: RANGE,
    badQuery: BAD_RANGE,
  }),

  // ---- admin-only writes, core ----
  adminWrite("POST", "accounts/route.ts", {
    action: "account.create",
    validBody: newAccount,
    successStatuses: [200, 201],
  }),
  adminWrite("PATCH", "accounts/[id]/route.ts", {
    action: "account.update",
    validParams: { id: ACCOUNT_ID },
    validBody: { accountName: "renamed" },
    successStatuses: [200],
  }),
  adminWrite("DELETE", "accounts/[id]/route.ts", {
    action: "account.deactivate",
    validParams: { id: ACCOUNT_ID },
    // The handler parses no body; the id is what it refuses.
    badInput: { params: { id: LONG } },
    successStatuses: [200],
  }),
  adminWrite("POST", "group-mappings/route.ts", {
    accessControl: true,
    action: "groupmap.create",
    validBody: {
      groupId: "g-new",
      target: { type: "team", id: "team-a" },
      scopedRole: "member",
    },
    successStatuses: [200, 201],
  }),
  adminWrite("PATCH", "group-mappings/[groupId]/route.ts", {
    accessControl: true,
    action: "groupmap.update",
    validParams: { groupId: "g-existing" },
    seed: seedGroupMapping,
    validBody: {
      groupId: "g-existing",
      target: { type: "team", id: "team-a" },
      scopedRole: "member",
      version: 1,
    },
    successStatuses: [200],
  }),
  adminWrite("DELETE", "group-mappings/[groupId]/route.ts", {
    accessControl: true,
    action: "groupmap.delete",
    validParams: { groupId: "g-existing" },
    seed: seedGroupMapping,
    validBody: { version: 1 },
    successStatuses: [200],
  }),
  adminWrite("PUT", "governance/password-sign-in/route.ts", {
    accessControl: true,
    reauth: true,
    action: "governance.passwordsignin.update",
    validBody: { enabled: true, version: 0 },
    successStatuses: [200],
  }),
  adminWrite("PUT", "governance/per-user-approval/route.ts", {
    accessControl: true,
    action: "governance.approval.update",
    validBody: { reference: "WC-2026-14", version: 0 },
    successStatuses: [200],
  }),
  adminWrite("PUT", "governance/identity-map-rules/route.ts", {
    accessControl: true,
    action: "identity.map.update",
    validBody: {
      rules: [{ pattern: "{name}-sso", template: "{name}@company.com" }],
      version: 0,
    },
    successStatuses: [200],
  }),

  // ---- admin-only access-control writes (4R.4) ----
  adminWrite("PUT", "identities/[oid]/links/route.ts", {
    accessControl: true,
    action: "identity.link.update",
    validParams: { oid: PEOPLE.alice.oid },
    validBody: {
      usageIdentities: ["alice@company.com"],
      aliases: [],
      version: 0,
    },
    successStatuses: [200],
  }),
  adminWrite("POST", "password-users/route.ts", {
    accessControl: true,
    reauth: true,
    action: "localuser.create",
    validBody: { email: "bob@example.com", displayName: "Bob" },
    successStatuses: [200, 201],
  }),
  adminWrite("PATCH", "password-users/[email]/route.ts", {
    accessControl: true,
    action: "localuser.update",
    validParams: { email: "alice@example.com" },
    seed: seedPasswordUser,
    validBody: { enabled: false, version: 1 },
    successStatuses: [200],
  }),
  adminWrite("DELETE", "password-users/[email]/route.ts", {
    accessControl: true,
    reauth: true,
    action: "localuser.delete",
    validParams: { email: "alice@example.com" },
    seed: seedPasswordUser,
    validBody: { version: 1 },
    successStatuses: [200],
  }),
  adminWrite("POST", "password-users/[email]/reset/route.ts", {
    accessControl: true,
    reauth: true,
    action: "localuser.update",
    validParams: { email: "alice@example.com" },
    seed: seedPasswordUser,
    // The handler parses no body; the path email is what it refuses.
    badInput: { params: { email: "not-an-email" } },
    validBody: {},
    successStatuses: [200],
  }),
  adminWrite("POST", "password-users/[email]/totp-reset/route.ts", {
    accessControl: true,
    reauth: true,
    action: "localuser.update",
    validParams: { email: "alice@example.com" },
    seed: seedEnrolledPasswordUser,
    // The handler parses no body; the path email is what it refuses.
    badInput: { params: { email: "not-an-email" } },
    validBody: {},
    successStatuses: [200],
  }),
  adminWrite("POST", "role-grants/route.ts", {
    accessControl: true,
    reauth: true,
    action: "role.grant",
    validBody: {
      oid: PEOPLE.alice.oid,
      role: "internal-org-admin",
      reason: "quarterly review",
    },
    successStatuses: [200, 201],
  }),
  adminWrite("DELETE", "role-grants/[oid]/[role]/route.ts", {
    accessControl: true,
    reauth: true,
    action: "role.revoke",
    validParams: { oid: PEOPLE.alice.oid, role: "internal-org-admin" },
    seed: async () => {
      ok(
        await grantRole(
          {
            oid: PEOPLE.alice.oid,
            role: "internal-org-admin",
            reason: "quarterly review",
          },
          seedCtx(),
        ),
      );
    },
    validBody: { version: 1 },
    successStatuses: [200],
  }),

  // ---- litellm writes: connection stays admin-only; toggles and team links
  // are internal-admin or internal-org-admin (LD24, LT22) and so register as
  // matrix writes below the admin-only ones ----
  adminWrite("PUT", "litellm/connection/route.ts", {
    family: "litellm",
    action: "litellm.connection.update",
    validBody: { baseUrl: "http://litellm.test:4000", version: null },
  }),
  // L6: the gateway configuration decides what the combined totals subtract,
  // so it is Admin only (org-admin 403, LT30); a refusal records a denied
  // litellm.gateway.update; it reaches no LiteLLM call.
  adminWrite("PUT", "litellm/gateway/route.ts", {
    family: "litellm",
    action: "litellm.gateway.update",
    validBody: {
      version: null,
      principals: [{ type: "iam-role", value: "litellm-gateway" }],
      accountIds: [],
    },
    successStatuses: [200],
  }),
  adminWrite("POST", "litellm/connection/test/route.ts", {
    family: "litellm",
    // LD24/LT22: an org-admin's refused test records a `denied` entry; the
    // test itself changes no state and writes no success record.
    action: "litellm.connection.test",
    validBody: {},
  }),
  matrixWrite("PUT", "litellm/team-links/[teamId]/route.ts", {
    family: "litellm",
    action: "litellm.teamlink.link",
    validParams: { teamId: "team-a" },
    validBody: { litellmTeamId: "lt-team-a", version: null },
  }),
  matrixWrite("DELETE", "litellm/team-links/[teamId]/route.ts", {
    family: "litellm",
    action: "litellm.teamlink.unlink",
    validParams: { teamId: "team-a" },
    seed: async () => {
      ok(
        await putTeamLink(
          { teamId: "team-a", litellmTeamId: "lt-team-a", version: null },
          seedCtx(),
        ),
      );
    },
    // The handler parses no body; the id is what it refuses.
    badInput: { params: { teamId: LONG } },
    successStatuses: [200],
  }),
  matrixWrite("PUT", "litellm/toggles/route.ts", {
    family: "litellm",
    action: "litellm.toggles.update",
    validBody: { version: null, toggles: { getTeam: false } },
  }),

  // ---- litellm member writes (L4; LiteLLM spec - Writes, Roles and rights):
  // a Lead in scope, org-admin and Admin write, so they register as matrix
  // writes (the Lead and out-of-scope rows live in each route's own file).
  // The routes without a body are refused on their path parameter instead.
  matrixWrite("POST", "litellm/teams/[teamId]/members/route.ts", {
    family: "litellm",
    action: "litellm.member.add",
    validParams: { teamId: "team-a" },
    validBody: { oid: alice.oid },
  }),
  matrixWrite("DELETE", "litellm/teams/[teamId]/members/[oid]/route.ts", {
    family: "litellm",
    action: "litellm.member.remove",
    validParams: { teamId: "team-a", oid: alice.oid },
    badInput: { params: { teamId: "team-a", oid: LONG } },
  }),
  matrixWrite("PATCH", "litellm/teams/[teamId]/members/[oid]/budget/route.ts", {
    family: "litellm",
    action: "litellm.member.budget",
    validParams: { teamId: "team-a", oid: alice.oid },
    validBody: { maxBudgetInTeam: 5 },
  }),
  matrixWrite("PATCH", "litellm/teams/[teamId]/members/[oid]/limits/route.ts", {
    family: "litellm",
    action: "litellm.member.limits",
    validParams: { teamId: "team-a", oid: alice.oid },
    validBody: { rpmLimit: 5 },
  }),
  matrixWrite(
    "POST",
    "litellm/teams/[teamId]/members/[oid]/reset-spend/route.ts",
    {
      family: "litellm",
      action: "litellm.member.reset-spend",
      validParams: { teamId: "team-a", oid: alice.oid },
      // resetMemberSpend defaults off (LD10); the permitted call must reach the
      // handler rather than be stopped by the toggle.
      seed: async () => {
        await putRaw({
          PK: "LITELLM#CONFIG",
          SK: "TOGGLES",
          version: 1,
          toggles: { resetMemberSpend: true },
          updatedAt: "2026-01-02T03:04:05.000Z",
        });
      },
      validBody: {},
      badInput: { params: { teamId: "team-a", oid: LONG } },
    },
  ),
  matrixWrite(
    "POST",
    "litellm/teams/[teamId]/members/[oid]/reset-budget/route.ts",
    {
      family: "litellm",
      action: "litellm.member.reset-budget",
      validParams: { teamId: "team-a", oid: alice.oid },
      validBody: {},
      badInput: { params: { teamId: "team-a", oid: LONG } },
    },
  ),
  matrixWrite("POST", "litellm/teams/[teamId]/members/[oid]/disable/route.ts", {
    family: "litellm",
    action: "litellm.member.disable",
    validParams: { teamId: "team-a", oid: alice.oid },
    validBody: {},
    badInput: { params: { teamId: "team-a", oid: LONG } },
  }),
  matrixWrite("POST", "litellm/teams/[teamId]/members/[oid]/enable/route.ts", {
    family: "litellm",
    action: "litellm.member.enable",
    validParams: { teamId: "team-a", oid: alice.oid },
    validBody: {},
    badInput: { params: { teamId: "team-a", oid: LONG } },
  }),

  // ---- litellm key and team-setting writes (L4 slices 2 and 3; LiteLLM spec -
  // Writes, Roles and rights): a Lead in scope, org-admin and Admin write, so
  // they register as matrix writes. createTeam stays Admin only (LD24).
  matrixWrite("POST", "litellm/teams/[teamId]/keys/route.ts", {
    family: "litellm",
    action: "litellm.key.generate",
    validParams: { teamId: "team-a" },
    validBody: { oid: alice.oid },
  }),
  matrixWrite("PATCH", "litellm/teams/[teamId]/keys/[tokenId]/route.ts", {
    family: "litellm",
    action: "litellm.key.update",
    validParams: { teamId: "team-a", tokenId: "a".repeat(64) },
    validBody: { rpmLimit: 3 },
  }),
  matrixWrite("DELETE", "litellm/teams/[teamId]/keys/[tokenId]/route.ts", {
    family: "litellm",
    action: "litellm.key.delete",
    validParams: { teamId: "team-a", tokenId: "a".repeat(64) },
    // deleteKey defaults off (LD10); the permitted call must reach the handler.
    seed: async () => {
      await putRaw({
        PK: "LITELLM#CONFIG",
        SK: "TOGGLES",
        version: 1,
        toggles: { deleteKey: true },
        updatedAt: "2026-01-02T03:04:05.000Z",
      });
    },
    badInput: { params: { teamId: "team-a", tokenId: LONG } },
  }),
  matrixWrite("POST", "litellm/teams/[teamId]/keys/[tokenId]/block/route.ts", {
    family: "litellm",
    action: "litellm.key.block",
    validParams: { teamId: "team-a", tokenId: "a".repeat(64) },
    validBody: {},
    badInput: { params: { teamId: "team-a", tokenId: LONG } },
  }),
  matrixWrite(
    "POST",
    "litellm/teams/[teamId]/keys/[tokenId]/unblock/route.ts",
    {
      family: "litellm",
      action: "litellm.key.unblock",
      validParams: { teamId: "team-a", tokenId: "a".repeat(64) },
      validBody: {},
      badInput: { params: { teamId: "team-a", tokenId: LONG } },
    },
  ),
  matrixWrite("POST", "litellm/teams/[teamId]/keys/[tokenId]/rotate/route.ts", {
    family: "litellm",
    action: "litellm.key.rotate",
    validParams: { teamId: "team-a", tokenId: "a".repeat(64) },
    validBody: {},
  }),
  matrixWrite("PATCH", "litellm/teams/[teamId]/budget/route.ts", {
    family: "litellm",
    action: "litellm.team.budget",
    validParams: { teamId: "team-a" },
    validBody: { maxBudget: 50 },
  }),
  matrixWrite("PATCH", "litellm/teams/[teamId]/limits/route.ts", {
    family: "litellm",
    action: "litellm.team.limits",
    validParams: { teamId: "team-a" },
    validBody: { rpmLimit: 30 },
  }),
  matrixWrite("PUT", "litellm/teams/[teamId]/models/route.ts", {
    family: "litellm",
    action: "litellm.team.models",
    validParams: { teamId: "team-a" },
    validBody: { models: ["claude-sonnet"] },
  }),
  adminWrite("POST", "litellm/teams/route.ts", {
    family: "litellm",
    action: "litellm.team.create",
    validBody: { teamId: "team-u", teamAlias: "U team" },
  }),

  // ---- matrix writes (Access Control spec - Permission matrix) ----
  matrixWrite("POST", "teams/[id]/members/route.ts", {
    action: "affiliation.add",
    validParams: TEAM,
    validBody: { oid: alice.oid },
    successStatuses: [200, 201],
  }),
  matrixWrite("DELETE", "teams/[id]/members/[oid]/route.ts", {
    action: "affiliation.remove",
    validParams: { id: "team-a", oid: alice.oid },
    seed: async () => {
      await seedMember(alice.oid, "team-a");
    },
    validBody: { version: 1 },
    successStatuses: [200],
  }),
  matrixWrite("POST", "teams/[id]/admins/route.ts", {
    action: "adminscope.grant",
    validParams: TEAM,
    validBody: { oid: alice.oid },
    successStatuses: [200, 201],
  }),
  matrixWrite("DELETE", "teams/[id]/admins/[oid]/route.ts", {
    action: "adminscope.revoke",
    validParams: { id: "team-a", oid: alice.oid },
    seed: async () => {
      await seedAdminScope(alice.oid, "team", "team-a");
    },
    validBody: { version: 1 },
    successStatuses: [200],
  }),
  matrixWrite("POST", "departments/[id]/admins/route.ts", {
    action: "adminscope.grant",
    validParams: DEPT,
    validBody: { oid: alice.oid },
    successStatuses: [200, 201],
  }),
  matrixWrite("DELETE", "departments/[id]/admins/[oid]/route.ts", {
    action: "adminscope.revoke",
    validParams: { id: "dept-eng", oid: alice.oid },
    seed: async () => {
      await seedAdminScope(alice.oid, "department", "dept-eng");
    },
    validBody: { version: 1 },
    successStatuses: [200],
  }),
  matrixWrite("PUT", "teams/[id]/visibility/route.ts", {
    action: "visibility.update",
    validParams: TEAM,
    validBody: {
      teamId: "team-a",
      teamLevel: "hidden",
      userLevel: "none",
      version: 0,
    },
    successStatuses: [200],
  }),
  matrixWrite("PUT", "departments/[id]/visibility/route.ts", {
    action: "visibility.update",
    validParams: DEPT,
    validBody: {
      departmentId: "dept-eng",
      departmentLevel: "visible",
      maxUserLevel: "all",
      version: 0,
    },
    successStatuses: [200],
  }),
  matrixWrite("POST", "affiliations/[oid]/move/route.ts", {
    action: "affiliation.move",
    validParams: { oid: alice.oid },
    seed: async () => {
      await seedMember(alice.oid, "team-a");
    },
    validBody: { fromTeamId: "team-a", toTeamId: "team-b", version: 1 },
    successStatuses: [200],
  }),

  // ---- unit M4: budget reset requests (Access Control - Permission matrix ->
  // Budget reset requests). The request is the caller's own member-team write;
  // approve and deny are the `member` matrix write of the reset routes. ----
  matrixWrite("POST", "budget-reset-requests/route.ts", {
    family: "litellm",
    action: "budgetreset.request.create",
    seed: seedRequesters,
    validBody: { reason: "I ran out of budget" },
    successStatuses: [201],
  }),
  matrixWrite("POST", "budget-reset-requests/[id]/approve/route.ts", {
    family: "litellm",
    action: "budgetreset.request.approve",
    validParams: { id: RESET_REQUEST_ID },
    seed: seedOpenRequest,
    validBody: {},
    badInput: { params: { id: LONG } },
  }),
  matrixWrite("POST", "budget-reset-requests/[id]/deny/route.ts", {
    family: "litellm",
    action: "budgetreset.request.deny",
    validParams: { id: RESET_REQUEST_ID },
    seed: seedOpenRequest,
    validBody: {},
    badInput: { params: { id: LONG } },
    successStatuses: [200],
  }),
  // Own state only, any signed-in role, not audited (Data Model - API Routes).
  {
    ...base({ method: "POST", file: "notifications/read/route.ts" }),
    kind: "own-write",
    family: "core" as RouteFamily,
    validBody: { all: true },
    successStatuses: [200],
    refusedCallers: [],
    permittedCallers: ["viewer", "admin"],
  },

  // ---- self-service write: a password user's own password ----
  {
    ...base({ method: "POST", file: "account/password/route.ts" }),
    kind: "self-write",
    validBody: {
      currentPassword: "old-password-1",
      newPassword: "new-password-2",
    },
    denied: { action: "localuser.update" },
    refusedCallers: SELF_REFUSED,
    permittedCallers: ["password"],
  },

  // ---- management improvements M3 (D15, D16): the directory and the LiteLLM
  // user link writes (admin and org-admin; own oid 403 in each route's file).
  read("identities/directory/route.ts"),
  matrixWrite("PUT", "identities/[oid]/litellm-link/route.ts", {
    family: "litellm",
    action: "identity.litellm-link.set",
    validParams: { oid: alice.oid },
    validBody: {
      litellmUserId: "lu-1",
      mode: "manual",
      reason: "Same person, other email",
      version: 0,
    },
  }),
  matrixWrite("DELETE", "identities/[oid]/litellm-link/route.ts", {
    family: "litellm",
    action: "identity.litellm-link.remove",
    validParams: { oid: alice.oid },
    validBody: { version: 1 },
  }),
  matrixWrite("POST", "litellm/users/route.ts", {
    family: "litellm",
    action: "litellm.user.create",
    validBody: { oid: alice.oid },
  }),
];

export const registryKeys = (): string[] => ROUTE_REGISTRY.map((e) => e.key);
export const entriesOfKind = (kind: RouteKind): RouteEntry[] =>
  ROUTE_REGISTRY.filter((e) => e.kind === kind);
export const writeEntries = (): RouteEntry[] =>
  ROUTE_REGISTRY.filter((e) => e.method !== "GET");
