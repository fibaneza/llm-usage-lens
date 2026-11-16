import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { ctxAt, ok } from "@/lib/data/access/access-test-support";
import { resetDeniedAudit } from "@/lib/data/access/audit";
import { putIdentityLink } from "@/lib/data/access/identity-links";
import {
  completePasswordSetupWrite,
  findSetupLink,
  getPasswordCredential,
} from "@/lib/data/access/password-credentials-store";
import {
  createPasswordUser,
  disablePasswordUser,
  getPasswordUser,
  listPasswordUsers,
  sha256Hex,
  userKey,
} from "@/lib/data/access/password-users";
import { grantRole, listRoleGrants } from "@/lib/data/access/role-grants";
import {
  auditToday,
  deniedToday,
  expectData,
  expectError,
  invoke,
  nonAuditItems,
  signInAs,
  type Caller,
} from "@/test/governance-route-support";
import {
  TEST_TABLE_NAME,
  clearTable,
  ensureTestTable,
  testDoc,
} from "@/test/test-support";

import { DELETE, PATCH } from "./password-users/[email]/route";
import { POST as RESET } from "./password-users/[email]/reset/route";
import { POST as TOTP_RESET } from "./password-users/[email]/totp-reset/route";
import { DELETE as REVOKE_ROLE } from "./role-grants/[oid]/[role]/route";
import { GET, POST } from "./password-users/route";

// Source: docs/specs/2026-11-10-access-control.md - "Password users"
// (Accounts: only internal-admin creates, disables, re-enables, resets or
// deletes; email lower-cased; clash with another identity's email, usage
// identity or alias -> 409; the last enabled password internal-admin is
// protected -> 409 while Entra is not configured. Setup D22: the link
// https://<host>/account/setup#<32-byte token> appears in exactly one
// response, no-store, never stored or shown again; a reset or delete
// invalidates it. Passwords: a hash is never returned. TOTP D23),
// "API routes (additions)" (/api/password-users*: GET admin or auditor,
// writes internal-admin), "Enforcement" items 2 (403 before parsing, identical
// 404), 4 (private, no-store), 6 (same-origin, Zod, version -> 409), "Audit
// log" (every write audited; one `denied` record per authorization refusal,
// none on 400/404/409, D17/T22), threats T24, T26, T28.
// Spec: Access Control "API routes (additions)". Only `@/auth` is mocked.
//
// Response shapes this suite fixes (the contract leaves them open):
//   list item   { email, displayName, status, totpEnrolled, createdAt, version }
//               status is "enabled" | "disabled" | "pending-setup" | "sso-bound";
//               "pending-setup" = enabled and no password set yet.
//   GET         { data: { items, cursor? } }
//   POST        { data: { user: <list item>, setupLink } }
//   reset       { data: { user: <list item>, setupLink } }
//   PATCH, totp-reset   { data: <list item> };  DELETE  { data: <anything> }
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/env", () => ({
  env: new Proxy({}, { get: (_t, key) => process.env[String(key)] }),
}));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

const LIST = "/api/password-users";
const one = (email: string) => `/api/password-users/${email}`;
const CURSOR_SECRET = "test-cursor-secret";
// Seeds are dated long ago so their audit records never land on "today".
const SEED_NOW = new Date("2020-01-01T00:00:00.000Z");
const PASSWORD_HASH = "$argon2id$v=19$SENTINEL-PASSWORD-HASH";
const TOTP_CIPHER = "SENTINEL-TOTP-CIPHER";
const LINK = /^https:\/\/localhost:3000\/account\/setup#([A-Za-z0-9_-]{43})$/;
const SECRET_WORDS =
  /argon2|SENTINEL|passwordHash|totpCipher|totpSecret|tokenHash|setupTokenHash|"token"/i;

type Row = {
  email: string;
  displayName: string;
  status: string;
  totpEnrolled: boolean;
  createdAt: string;
  version: number;
};
type Issued = { user: Row; setupLink: string };

let seq = 0;
const seedCtx = () => ctxAt(SEED_NOW, `req-seed-${++seq}`);

async function seedUser(
  email = "alice@example.com",
  sso?: { expectedUpn?: string; expectedOid?: string },
) {
  return ok(
    await createPasswordUser(
      { email, displayName: "Alice", ...(sso ? { sso } : {}) },
      seedCtx(),
    ),
  );
}

// A user who finished setup: password hash and an enrolled TOTP secret.
async function seedActiveUser(email = "alice@example.com") {
  const created = await seedUser(email);
  ok(
    await completePasswordSetupWrite(
      {
        email,
        tokenHash: sha256Hex(created.setupToken),
        passwordHash: PASSWORD_HASH,
        totp: { cipher: TOTP_CIPHER, step: 7 },
      },
      seedCtx(),
    ),
  );
  return created.user;
}

async function seedAdmin(email: string) {
  const { user } = await seedUser(email);
  ok(
    await grantRole(
      { oid: user.oid, role: "internal-admin", reason: "seed" },
      seedCtx(),
    ),
  );
  return user;
}

async function setRawStatus(email: string, status: string) {
  await testDoc().send(
    new UpdateCommand({
      TableName: TEST_TABLE_NAME,
      Key: userKey(email),
      UpdateExpression: "SET #s = :s",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":s": status },
    }),
  );
}

const rows = async () =>
  ok(await listPasswordUsers({ cursorSecret: CURSOR_SECRET })).items;

function configureEntra(on: boolean) {
  const vars = {
    AUTH_MICROSOFT_ENTRA_ID_ID: "client-id",
    AUTH_MICROSOFT_ENTRA_ID_SECRET: "client-secret",
    AUTH_MICROSOFT_ENTRA_ID_ISSUER:
      "https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/v2.0",
  };
  for (const [name, value] of Object.entries(vars)) {
    vi.stubEnv(name, on ? value : "");
  }
}

// Reads the raw body text (for the secret scan) and the parsed data.
async function readData<T>(res: Response, statuses = [200]) {
  const text = await res.clone().text();
  const data = await expectData<T>(res, statuses);
  return { text, data };
}

// No hash, TOTP secret, token or token hash may appear in a serialised body.
function expectNoSecrets(text: string, tokens: string[] = []) {
  expect(text).not.toMatch(SECRET_WORDS);
  for (const token of tokens) {
    expect(text).not.toContain(token);
    expect(text).not.toContain(sha256Hex(token));
  }
}

const tokenOf = (link: string) => LINK.exec(link)![1]!;

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetDeniedAudit();
  configureEntra(false);
  signInAs("admin");
});
afterEach(() => vi.unstubAllEnvs());

// ---------------------------------------------------------------------------
// GET /api/password-users
// ---------------------------------------------------------------------------
describe("GET /api/password-users", () => {
  const list = () => invoke(GET, { method: "GET", path: LIST });

  it("401 without a session", async () => {
    signInAs(null);
    await expectError(await list(), 401, "UNAUTHORIZED");
  });

  it.each(["viewer", "orgAdmin", "noRoles"] as const)(
    "403 FORBIDDEN for %s, with no user data in the body",
    async (caller) => {
      await seedUser();
      signInAs(caller);
      const res = await list();
      expect(await res.clone().text()).not.toContain("alice@example.com");
      await expectError(res, 403, "FORBIDDEN");
    },
  );

  it.each(["admin", "auditor"] as const)(
    "%s lists the users as { data: { items } } with no-store",
    async (caller) => {
      await seedUser();
      signInAs(caller);
      const { data } = await readData<{ items: Row[]; cursor?: string }>(
        await list(),
      );
      expect(data.items).toEqual([
        {
          email: "alice@example.com",
          displayName: "Alice",
          status: "pending-setup",
          totpEnrolled: false,
          createdAt: SEED_NOW.toISOString(),
          version: 1,
        },
      ]);
      expect(data.cursor).toBeUndefined();
    },
  );

  it("an empty list is 200 with no items", async () => {
    const { data } = await readData<{ items: Row[] }>(await list());
    expect(data.items).toEqual([]);
  });

  it("shows enabled, disabled, pending-setup and sso-bound, and TOTP enrolment", async () => {
    await seedActiveUser("active@example.com");
    await seedUser("pending@example.com");
    await seedActiveUser("off@example.com");
    await setRawStatus("off@example.com", "disabled");
    await seedActiveUser("bound@example.com");
    await setRawStatus("bound@example.com", "sso-bound");
    const { data } = await readData<{ items: Row[] }>(await list());
    const by = Object.fromEntries(data.items.map((r) => [r.email, r]));
    expect(by["active@example.com"]).toMatchObject({
      status: "enabled",
      totpEnrolled: true,
    });
    expect(by["pending@example.com"]).toMatchObject({
      status: "pending-setup",
      totpEnrolled: false,
    });
    expect(by["off@example.com"]).toMatchObject({ status: "disabled" });
    expect(by["bound@example.com"]).toMatchObject({ status: "sso-bound" });
  });

  it("never contains a hash, TOTP secret, token or token hash (serialised body)", async () => {
    const a = await seedActiveUser("active@example.com");
    const pending = await seedUser("pending@example.com");
    signInAs("auditor");
    const { text } = await readData(await list());
    expectNoSecrets(text, [pending.setupToken]);
    expect(text).not.toContain(PASSWORD_HASH);
    expect(text).not.toContain(TOTP_CIPHER);
    expect(text).not.toContain("/account/setup");
    expect(text).toContain(a.email);
  });

  it("is read live, not cached: a user created after a first list appears in the next", async () => {
    await readData(await list());
    await seedUser();
    const { data } = await readData<{ items: Row[] }>(await list());
    expect(data.items).toHaveLength(1);
  });

  it("paginates with ?limit and an opaque cursor, following it to the end", async () => {
    await seedUser("a@example.com");
    await seedUser("b@example.com");
    await seedUser("c@example.com");
    const { data: first } = await readData<{ items: Row[]; cursor?: string }>(
      await invoke(GET, { method: "GET", path: `${LIST}?limit=2` }),
    );
    expect(first.items).toHaveLength(2);
    expect(typeof first.cursor).toBe("string");
    expect(first.cursor).not.toContain("LOCALUSER");
    const { data: second } = await readData<{ items: Row[]; cursor?: string }>(
      await invoke(GET, {
        method: "GET",
        path: `${LIST}?limit=2&cursor=${encodeURIComponent(first.cursor!)}`,
      }),
    );
    expect(second.items).toHaveLength(1);
    expect(second.cursor).toBeUndefined();
    expect(
      [...first.items, ...second.items].map((r) => r.email).sort(),
    ).toEqual(["a@example.com", "b@example.com", "c@example.com"]);
  });

  it.each([
    ["a tampered cursor", "limit=2&cursor=not-a-real-cursor"],
    ["a zero limit", "limit=0"],
    ["a non-numeric limit", "limit=abc"],
    ["a negative limit", "limit=-1"],
  ])("400 BAD_REQUEST for %s (never BAD_CURSOR)", async (_name, query) => {
    await seedUser();
    await expectError(
      await invoke(GET, { method: "GET", path: `${LIST}?${query}` }),
      400,
      "BAD_REQUEST",
    );
  });
});

// ---------------------------------------------------------------------------
// POST /api/password-users
// ---------------------------------------------------------------------------
describe("POST /api/password-users", () => {
  const create = (body: unknown, extra = {}) =>
    invoke(POST, { method: "POST", path: LIST, body, ...extra });
  const input = (email = "alice@example.com") => ({
    email,
    displayName: "Alice",
  });

  it("creates the user lower-cased, returns the setup link once, and writes one localuser.create success record", async () => {
    const { data, text } = await readData<Issued>(
      await create(input("Alice@Example.COM")),
      [200, 201],
    );
    expect(data.user).toMatchObject({
      email: "alice@example.com",
      displayName: "Alice",
      status: "pending-setup",
      totpEnrolled: false,
      version: 1,
    });
    expect(data.setupLink).toMatch(LINK);
    const token = tokenOf(data.setupLink);
    // The token appears only inside the link.
    expect(text.split(token)).toHaveLength(2);
    expect(text).not.toContain(sha256Hex(token));
    expect(text).not.toMatch(SECRET_WORDS);
    expect(await getPasswordUser("alice@example.com")).not.toBeNull();
    const records = await auditToday();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "localuser.create",
      result: "success",
      category: "change",
      actor: "oid-admin",
    });
    expect(JSON.stringify(records)).not.toContain(token);
  });

  it("the token is 32 random bytes, live in the store, and never stored in clear", async () => {
    const { data } = await readData<Issued>(await create(input()), [200, 201]);
    const token = tokenOf(data.setupLink);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(await findSetupLink(sha256Hex(token))).toMatchObject({
      email: "alice@example.com",
    });
    expect(JSON.stringify(await nonAuditItems())).not.toContain(token);
  });

  it("two creations get different links", async () => {
    const a = await readData<Issued>(
      await create(input("a@example.com")),
      [200, 201],
    );
    const b = await readData<Issued>(
      await create(input("b@example.com")),
      [200, 201],
    );
    expect(a.data.setupLink).not.toBe(b.data.setupLink);
  });

  it("accepts an SSO reference and reserves it", async () => {
    await readData(
      await create({
        ...input("a@example.com"),
        sso: { expectedUpn: "Shared@Example.com", expectedOid: "oid-aaa" },
      }),
      [200, 201],
    );
    expect(await getPasswordUser("a@example.com")).toMatchObject({
      sso: { expectedUpn: "shared@example.com", expectedOid: "oid-aaa" },
    });
    await expectError(
      await create({
        ...input("b@example.com"),
        sso: { expectedUpn: "shared@example.com" },
      }),
      409,
      "CONFLICT",
    );
  });

  describe("409 CONFLICT, nothing new audited, no link in the body", () => {
    const expectRefused = async (res: Response) => {
      const audit0 = (await auditToday()).length;
      const text = await res.clone().text();
      await expectError(res, 409, "CONFLICT");
      expect(text).not.toContain("/account/setup");
      expect((await auditToday()).length).toBe(audit0);
    };

    it("an email that is already a password user (any case)", async () => {
      await seedUser();
      const before = await nonAuditItems();
      await expectRefused(await create(input("ALICE@example.com")));
      expect(await nonAuditItems()).toEqual(before);
    });

    it("an email that is another identity's usage identity", async () => {
      ok(
        await putIdentityLink(
          {
            oid: "00000000-0000-4000-8000-000000000001",
            usageIdentities: ["taken@example.com"],
            aliases: [],
            version: null,
          },
          seedCtx(),
        ),
      );
      await expectRefused(await create(input("taken@example.com")));
      expect(await getPasswordUser("taken@example.com")).toBeNull();
    });

    it("an email that is another identity's alias", async () => {
      ok(
        await putIdentityLink(
          {
            oid: "00000000-0000-4000-8000-000000000001",
            usageIdentities: [],
            aliases: ["alias@example.com"],
            version: null,
          },
          seedCtx(),
        ),
      );
      await expectRefused(await create(input("alias@example.com")));
      expect(await getPasswordUser("alias@example.com")).toBeNull();
    });
  });

  it("401 without a session, before anything is read or written", async () => {
    signInAs(null);
    await expectError(await create(input()), 401, "UNAUTHORIZED");
    expect(await nonAuditItems()).toEqual([]);
    expect(await auditToday()).toEqual([]);
  });

  it("403 for an admin write with a missing or foreign Origin, before parsing; the table is untouched", async () => {
    for (const origin of [null, "https://evil.example.test", "null"]) {
      for (const body of [input(), "{not json"]) {
        await expectError(await create(body, { origin }), 403, "FORBIDDEN");
      }
    }
    expect(await nonAuditItems()).toEqual([]);
  });

  it("400 for a wrong content type; accepts application/json with a charset", async () => {
    await expectError(
      await create(input(), { contentType: "text/plain" }),
      400,
      "BAD_REQUEST",
    );
    expect(await nonAuditItems()).toEqual([]);
    await readData(
      await create(input(), {
        contentType: "application/json; charset=utf-8",
      }),
      [200, 201],
    );
  });

  it.each([
    ["invalid JSON", "{not json"],
    ["an empty object", {}],
    ["a non-object body", "[]"],
    ["a missing email", { displayName: "Alice" }],
    ["a missing display name", { email: "alice@example.com" }],
    ["an empty display name", { email: "alice@example.com", displayName: "" }],
    ["a non-email", { email: "not-an-email", displayName: "A" }],
    ["an email with a space", { email: "a b@example.com", displayName: "A" }],
    ["a non-string email", { email: 5, displayName: "A" }],
    [
      "an over-long email",
      { email: `${"x".repeat(300)}@example.com`, displayName: "A" },
    ],
    [
      "a non-string sso.expectedUpn",
      { email: "a@example.com", displayName: "A", sso: { expectedUpn: 3 } },
    ],
  ])(
    "400 BAD_REQUEST for %s; nothing stored, no audit record, no denied record",
    async (_name, body) => {
      await expectError(await create(body), 400, "BAD_REQUEST");
      expect(await nonAuditItems()).toEqual([]);
      expect(await auditToday()).toEqual([]);
      expect(await deniedToday()).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------
// PATCH /api/password-users/[email]
// ---------------------------------------------------------------------------
describe("PATCH /api/password-users/[email]", () => {
  const patch = (email: string, body: unknown, extra = {}) =>
    invoke(PATCH, {
      method: "PATCH",
      path: one(email),
      params: { email },
      body,
      ...extra,
    });
  const updates = async () =>
    (await auditToday()).filter((r) => r.action === "localuser.update");

  it("disables then re-enables, bumping the version, one localuser.update success record each, no secrets", async () => {
    const user = await seedActiveUser();
    const off = await readData<Row>(
      await patch(user.email, { enabled: false, version: 2 }),
    );
    expectNoSecrets(off.text);
    expect(off.data).toMatchObject({
      email: "alice@example.com",
      status: "disabled",
      version: 3,
    });
    const on = await readData<Row>(
      await patch(user.email, { enabled: true, version: 3 }),
    );
    expect(on.data).toMatchObject({ status: "enabled", version: 4 });
    const records = await updates();
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ result: "success", actor: "oid-admin" });
  });

  it("the path email is decoded and lower-cased: %40 and upper case reach the stored user", async () => {
    await seedUser();
    const { data } = await readData<Row>(
      await patch("Alice%40Example.COM", { enabled: false, version: 1 }),
    );
    expect(data).toMatchObject({
      email: "alice@example.com",
      status: "disabled",
    });
    const back = await readData<Row>(
      await patch("ALICE@example.com", { enabled: true, version: 2 }),
    );
    expect(back.data.email).toBe("alice@example.com");
  });

  it("409 CONFLICT for a stale version; the user is unchanged and nothing is audited", async () => {
    await seedUser();
    await expectError(
      await patch("alice@example.com", { enabled: false, version: 9 }),
      409,
      "CONFLICT",
    );
    expect(await rows()).toEqual([
      expect.objectContaining({ version: 1, status: "pending-setup" }),
    ]);
    expect(await updates()).toEqual([]);
  });

  it("409 CONFLICT when replaying the same version after a successful update", async () => {
    await seedUser();
    await readData(
      await patch("alice@example.com", { enabled: false, version: 1 }),
    );
    await expectError(
      await patch("alice@example.com", { enabled: false, version: 1 }),
      409,
      "CONFLICT",
    );
  });

  it("409 CONFLICT for an sso-bound user", async () => {
    await seedUser();
    await setRawStatus("alice@example.com", "sso-bound");
    await expectError(
      await patch("alice@example.com", { enabled: false, version: 1 }),
      409,
      "CONFLICT",
    );
    expect(await updates()).toEqual([]);
  });

  describe("the last enabled password internal-admin (Entra not configured)", () => {
    it("409 CONFLICT when disabling the only enabled password admin; stays enabled, nothing audited", async () => {
      const admin = await seedAdmin("root@example.com");
      await seedUser("other@example.com");
      await expectError(
        await patch(admin.email, { enabled: false, version: 1 }),
        409,
        "CONFLICT",
      );
      expect((await rows()).find((r) => r.email === admin.email)).toMatchObject(
        { status: "pending-setup", version: 1 },
      );
      expect(await updates()).toEqual([]);
    });

    it("allows disabling one of two enabled password admins, then refuses the second", async () => {
      await seedAdmin("one@example.com");
      await seedAdmin("two@example.com");
      await readData(
        await patch("one@example.com", { enabled: false, version: 1 }),
      );
      await expectError(
        await patch("two@example.com", { enabled: false, version: 1 }),
        409,
        "CONFLICT",
      );
    });

    // F5 (run-r4b decisions): the lockout invariant is atomic. Two concurrent
    // disables of the only two enabled admins must conflict, never both pass
    // (Access Control spec - Password users, last enabled password admin).
    it("F5: two concurrent disables of the only two enabled admins: one 200, one 409 CONFLICT, one stays enabled", async () => {
      await seedAdmin("one@example.com");
      await seedAdmin("two@example.com");
      const results = await Promise.all([
        patch("one@example.com", { enabled: false, version: 1 }),
        patch("two@example.com", { enabled: false, version: 1 }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      await expectError(
        results.find((r) => r.status === 409)!,
        409,
        "CONFLICT",
      );
      const enabled = (await rows()).filter((r) => r.status !== "disabled");
      expect(enabled).toHaveLength(1);
    });

    it("a disabled admin does not count: the remaining enabled one is protected", async () => {
      await seedAdmin("one@example.com");
      await seedAdmin("two@example.com");
      await setRawStatus("two@example.com", "disabled");
      await expectError(
        await patch("one@example.com", { enabled: false, version: 1 }),
        409,
        "CONFLICT",
      );
    });

    it("a non-admin password user can always be disabled", async () => {
      await seedAdmin("root@example.com");
      await seedUser("plain@example.com");
      await readData(
        await patch("plain@example.com", { enabled: false, version: 1 }),
      );
    });

    it("the protection ends once Entra is configured", async () => {
      await seedAdmin("root@example.com");
      configureEntra(true);
      await readData(
        await patch("root@example.com", { enabled: false, version: 1 }),
      );
    });

    it("re-enabling is never blocked", async () => {
      await seedAdmin("root@example.com");
      configureEntra(true);
      await readData(
        await patch("root@example.com", { enabled: false, version: 1 }),
      );
      configureEntra(false);
      await readData(
        await patch("root@example.com", { enabled: true, version: 2 }),
      );
    });
  });

  it("404 NOT_FOUND for an unknown email, an identical body whichever email, nothing echoed; no audit record", async () => {
    const a = await expectError(
      await patch("ghost-a@example.com", { enabled: false, version: 1 }),
      404,
      "NOT_FOUND",
    );
    const b = await expectError(
      await patch("ghost-b@example.com", { enabled: false, version: 1 }),
      404,
      "NOT_FOUND",
    );
    expect(a).toEqual(b);
    expect(a.error.message).toBe("Not found");
    expect(JSON.stringify(a)).not.toContain("ghost");
    expect(await auditToday()).toEqual([]);
  });

  it("401 without a session", async () => {
    await seedUser();
    signInAs(null);
    await expectError(
      await patch("alice@example.com", { enabled: false, version: 1 }),
      401,
      "UNAUTHORIZED",
    );
  });

  it("403 for an admin write with a foreign Origin, before parsing", async () => {
    await seedUser();
    await expectError(
      await patch(
        "alice@example.com",
        { enabled: false, version: 1 },
        { origin: "https://evil.example.test" },
      ),
      403,
      "FORBIDDEN",
    );
    expect((await rows())[0]).toMatchObject({ version: 1 });
  });

  it("400 for a wrong content type", async () => {
    await seedUser();
    await expectError(
      await patch(
        "alice@example.com",
        { enabled: false, version: 1 },
        { contentType: "text/plain" },
      ),
      400,
      "BAD_REQUEST",
    );
  });

  it.each([
    ["invalid JSON", "{not json"],
    ["a missing enabled", { version: 1 }],
    ["a non-boolean enabled", { enabled: "false", version: 1 }],
    ["a missing version", { enabled: false }],
    ["a non-integer version", { enabled: false, version: 1.5 }],
    ["a negative version", { enabled: false, version: -1 }],
    ["a string version", { enabled: false, version: "1" }],
  ])("400 BAD_REQUEST for %s; no audit, no denied record", async (_n, body) => {
    await seedUser();
    await expectError(
      await patch("alice@example.com", body),
      400,
      "BAD_REQUEST",
    );
    expect(await updates()).toEqual([]);
    expect(await deniedToday()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/password-users/[email]
// ---------------------------------------------------------------------------
describe("DELETE /api/password-users/[email]", () => {
  // Enforcement item 6: every versioned write carries the version it read;
  // a freshly created user is at version 1.
  const del = (email: string, extra = {}) =>
    invoke(DELETE, {
      method: "DELETE",
      path: one(email),
      params: { email },
      body: { version: 1 },
      ...extra,
    });
  const deletes = async () =>
    (await auditToday()).filter((r) => r.action === "localuser.delete");

  it("deletes the user, invalidates the setup link and writes one localuser.delete success record", async () => {
    const { user, setupToken } = await seedUser();
    const { text } = await readData(await del(user.email));
    expectNoSecrets(text, [setupToken]);
    expect(await getPasswordUser(user.email)).toBeNull();
    expect(await findSetupLink(sha256Hex(setupToken))).toBeNull();
    expect(await rows()).toEqual([]);
    const records = await deletes();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ result: "success", actor: "oid-admin" });
  });

  // Enforcement item 6 (optimistic concurrency on every mutable item): the
  // delete names the version it saw; 4R.4 review warning.
  it("409 CONFLICT for a stale version; the user remains and nothing is audited", async () => {
    await seedUser();
    await expectError(
      await del("alice@example.com", { body: { version: 9 } }),
      409,
      "CONFLICT",
    );
    expect(await getPasswordUser("alice@example.com")).not.toBeNull();
    expect(await deletes()).toEqual([]);
  });

  it("409 CONFLICT when the user changed after it was read (a disable bumps the version)", async () => {
    await seedUser();
    await readData(
      await invoke(PATCH, {
        method: "PATCH",
        path: one("alice@example.com"),
        params: { email: "alice@example.com" },
        body: { enabled: false, version: 1 },
      }),
    );
    await expectError(await del("alice@example.com"), 409, "CONFLICT");
    expect(await getPasswordUser("alice@example.com")).not.toBeNull();
    await readData(await del("alice@example.com", { body: { version: 2 } }));
    expect(await getPasswordUser("alice@example.com")).toBeNull();
  });

  it.each([
    ["no body", undefined],
    ["a missing version", {}],
    ["a negative version", { version: -1 }],
    ["a non-integer version", { version: 1.5 }],
    ["a string version", { version: "1" }],
    ["a body that is not JSON", "{not json"],
  ])("400 BAD_REQUEST for %s; the user remains", async (_n, body) => {
    await seedUser();
    await expectError(
      await del("alice@example.com", { body }),
      400,
      "BAD_REQUEST",
    );
    expect(await getPasswordUser("alice@example.com")).not.toBeNull();
    expect(await deletes()).toEqual([]);
  });

  it("the path email is decoded and lower-cased", async () => {
    await seedUser();
    await readData(await del("ALICE%40Example.com"));
    expect(await getPasswordUser("alice@example.com")).toBeNull();
  });

  it("releases the email so it can be created again", async () => {
    await seedUser();
    await readData(await del("alice@example.com"));
    await readData(
      await invoke(POST, {
        method: "POST",
        path: LIST,
        body: { email: "alice@example.com", displayName: "Again" },
      }),
      [200, 201],
    );
  });

  describe("the last enabled password internal-admin (Entra not configured)", () => {
    it("409 CONFLICT for the only enabled password admin; it remains and nothing is audited", async () => {
      await seedAdmin("root@example.com");
      await expectError(await del("root@example.com"), 409, "CONFLICT");
      expect(await rows()).toHaveLength(1);
      expect(await deletes()).toEqual([]);
    });

    it("allows deleting one of two admins, then refuses the second", async () => {
      await seedAdmin("one@example.com");
      await seedAdmin("two@example.com");
      await readData(await del("one@example.com"));
      await expectError(await del("two@example.com"), 409, "CONFLICT");
    });

    // F5 (run-r4b decisions): atomic last-admin check on delete.
    it("F5: two concurrent deletes of the only two enabled admins: one 200, one 409 CONFLICT, one admin remains", async () => {
      await seedAdmin("one@example.com");
      await seedAdmin("two@example.com");
      const results = await Promise.all([
        del("one@example.com"),
        del("two@example.com"),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      await expectError(
        results.find((r) => r.status === 409)!,
        409,
        "CONFLICT",
      );
      expect(await rows()).toHaveLength(1);
    });

    it("the protection ends once Entra is configured", async () => {
      await seedAdmin("root@example.com");
      configureEntra(true);
      await readData(await del("root@example.com"));
      expect(await rows()).toEqual([]);
    });

    it("a non-admin password user can always be deleted", async () => {
      await seedAdmin("root@example.com");
      await seedUser("plain@example.com");
      await readData(await del("plain@example.com"));
    });
  });

  it("an sso-bound user can be deleted", async () => {
    await seedUser();
    await setRawStatus("alice@example.com", "sso-bound");
    await readData(await del("alice@example.com"));
    expect(await getPasswordUser("alice@example.com")).toBeNull();
  });

  it("404 NOT_FOUND for an unknown email, identical bodies, no audit record", async () => {
    const a = await expectError(
      await del("ghost-a@example.com"),
      404,
      "NOT_FOUND",
    );
    const b = await expectError(
      await del("ghost-b@example.com"),
      404,
      "NOT_FOUND",
    );
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toContain("ghost");
    expect(await auditToday()).toEqual([]);
  });

  it("401 without a session; the user remains", async () => {
    await seedUser();
    signInAs(null);
    await expectError(await del("alice@example.com"), 401, "UNAUTHORIZED");
    expect(await rows()).toHaveLength(1);
  });

  it("403 for an admin write with no Origin, before anything is read; the user remains", async () => {
    await seedUser();
    await expectError(
      await del("alice@example.com", { origin: null }),
      403,
      "FORBIDDEN",
    );
    expect(await rows()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// POST /api/password-users/[email]/reset
// ---------------------------------------------------------------------------
describe("POST /api/password-users/[email]/reset", () => {
  const reset = (email: string, extra = {}) =>
    invoke(RESET, {
      method: "POST",
      path: `${one(email)}/reset`,
      params: { email },
      ...extra,
    });

  it("returns a new link once and invalidates the old one; one localuser.update success record without the token", async () => {
    const created = await readData<Issued>(
      await invoke(POST, {
        method: "POST",
        path: LIST,
        body: { email: "alice@example.com", displayName: "Alice" },
      }),
      [200, 201],
    );
    const oldToken = tokenOf(created.data.setupLink);
    const auditBefore = (await auditToday()).length;
    const { data, text } = await readData<Issued>(
      await reset("alice@example.com"),
    );
    expect(data.setupLink).toMatch(LINK);
    const newToken = tokenOf(data.setupLink);
    expect(newToken).not.toBe(oldToken);
    expect(Buffer.from(newToken, "base64url")).toHaveLength(32);
    expect(text.split(newToken)).toHaveLength(2);
    expect(text).not.toContain(oldToken);
    expect(text).not.toContain(sha256Hex(newToken));
    expect(text).not.toMatch(SECRET_WORDS);
    expect(data.user).toMatchObject({ email: "alice@example.com", version: 2 });
    expect(await findSetupLink(sha256Hex(oldToken))).toBeNull();
    expect(await findSetupLink(sha256Hex(newToken))).toMatchObject({
      email: "alice@example.com",
    });
    const records = await auditToday();
    expect(records).toHaveLength(auditBefore + 1);
    const resets = records.filter((r) => r.action === "localuser.update");
    expect(resets).toHaveLength(1);
    expect(resets[0]).toMatchObject({ result: "success", actor: "oid-admin" });
    expect(JSON.stringify(records)).not.toContain(newToken);
    expect(JSON.stringify(await nonAuditItems())).not.toContain(newToken);
  });

  it("the path email is decoded and lower-cased", async () => {
    await seedUser();
    const { data } = await readData<Issued>(await reset("ALICE%40Example.com"));
    expect(data.user.email).toBe("alice@example.com");
  });

  it("works for a user who finished setup and leaks neither hash nor TOTP secret", async () => {
    await seedActiveUser();
    const { text, data } = await readData<Issued>(
      await reset("alice@example.com"),
    );
    expect(text).not.toContain(PASSWORD_HASH);
    expect(text).not.toContain(TOTP_CIPHER);
    expect(data.setupLink).toMatch(LINK);
  });

  it("a later list shows no link or token", async () => {
    await seedUser();
    const { data } = await readData<Issued>(await reset("alice@example.com"));
    const { text } = await readData(
      await invoke(GET, { method: "GET", path: LIST }),
    );
    expect(text).not.toContain(tokenOf(data.setupLink));
    expect(text).not.toContain("/account/setup");
  });

  it("409 CONFLICT for an sso-bound user; nothing audited", async () => {
    await seedUser();
    await setRawStatus("alice@example.com", "sso-bound");
    await expectError(await reset("alice@example.com"), 409, "CONFLICT");
    expect(
      (await auditToday()).filter((r) => r.action === "localuser.update"),
    ).toEqual([]);
  });

  it("404 NOT_FOUND for an unknown email, identical bodies, no audit record", async () => {
    const a = await expectError(
      await reset("ghost-a@example.com"),
      404,
      "NOT_FOUND",
    );
    const b = await expectError(
      await reset("ghost-b@example.com"),
      404,
      "NOT_FOUND",
    );
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toContain("ghost");
    expect(await auditToday()).toEqual([]);
  });

  it("401 without a session", async () => {
    await seedUser();
    signInAs(null);
    await expectError(await reset("alice@example.com"), 401, "UNAUTHORIZED");
  });

  it("403 for an admin write with a foreign Origin; the old link still works", async () => {
    const { user, setupToken } = await seedUser();
    await expectError(
      await reset(user.email, { origin: "https://evil.example.test" }),
      403,
      "FORBIDDEN",
    );
    expect(await findSetupLink(sha256Hex(setupToken))).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// POST /api/password-users/[email]/totp-reset
// ---------------------------------------------------------------------------
describe("POST /api/password-users/[email]/totp-reset", () => {
  const totpReset = (email: string, extra = {}) =>
    invoke(TOTP_RESET, {
      method: "POST",
      path: `${one(email)}/totp-reset`,
      params: { email },
      ...extra,
    });

  it("clears the TOTP enrolment, keeps the password, audits one localuser.update, and returns no secret or link", async () => {
    await seedActiveUser();
    expect(await rows()).toEqual([
      expect.objectContaining({ totpEnrolled: true }),
    ]);
    const { data, text } = await readData<Row>(
      await totpReset("alice@example.com"),
    );
    expectNoSecrets(text);
    expect(text).not.toContain("/account/setup");
    expect(data).toMatchObject({
      email: "alice@example.com",
      totpEnrolled: false,
      version: 3,
    });
    const credential = await getPasswordCredential("alice@example.com");
    expect(credential?.totpCipher).toBeUndefined();
    expect(credential?.totpLastStep).toBeUndefined();
    expect(credential?.passwordHash).toBe(PASSWORD_HASH);
    expect(await rows()).toEqual([
      expect.objectContaining({ totpEnrolled: false, status: "enabled" }),
    ]);
    const records = (await auditToday()).filter(
      (r) => r.action === "localuser.update",
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ result: "success", actor: "oid-admin" });
    expect(JSON.stringify(records)).not.toContain(TOTP_CIPHER);
  });

  it("is allowed for a user with no enrolment and is still audited", async () => {
    await seedUser();
    const { data } = await readData<Row>(await totpReset("alice@example.com"));
    expect(data.totpEnrolled).toBe(false);
    expect(
      (await auditToday()).filter((r) => r.action === "localuser.update"),
    ).toHaveLength(1);
  });

  it("the path email is decoded and lower-cased", async () => {
    await seedActiveUser();
    const { data } = await readData<Row>(
      await totpReset("ALICE%40Example.com"),
    );
    expect(data.email).toBe("alice@example.com");
  });

  it("409 CONFLICT for an sso-bound user; the enrolment remains", async () => {
    await seedActiveUser();
    await setRawStatus("alice@example.com", "sso-bound");
    await expectError(await totpReset("alice@example.com"), 409, "CONFLICT");
    expect((await getPasswordCredential("alice@example.com"))?.totpCipher).toBe(
      TOTP_CIPHER,
    );
  });

  it("404 NOT_FOUND for an unknown email, identical bodies, no audit record", async () => {
    const a = await expectError(
      await totpReset("ghost-a@example.com"),
      404,
      "NOT_FOUND",
    );
    const b = await expectError(
      await totpReset("ghost-b@example.com"),
      404,
      "NOT_FOUND",
    );
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toContain("ghost");
    expect(await auditToday()).toEqual([]);
  });

  it("401 without a session; the enrolment remains", async () => {
    await seedActiveUser();
    signInAs(null);
    await expectError(
      await totpReset("alice@example.com"),
      401,
      "UNAUTHORIZED",
    );
    expect((await rows())[0]).toMatchObject({ totpEnrolled: true });
  });

  it("403 for an admin write with no Origin; the enrolment remains", async () => {
    await seedActiveUser();
    await expectError(
      await totpReset("alice@example.com", { origin: null }),
      403,
      "FORBIDDEN",
    );
    expect((await rows())[0]).toMatchObject({ totpEnrolled: true });
  });
});

// ---------------------------------------------------------------------------
// Last-admin invariants across routes (D32, T33)
// ---------------------------------------------------------------------------
describe("last enabled internal-admin across the revoke and disable routes (Roles; Enforcement item 8; T33)", () => {
  const revokeAdminRole = (oid: string) =>
    invoke(REVOKE_ROLE, {
      method: "DELETE",
      path: `/api/role-grants/${oid}/internal-admin`,
      params: { oid, role: "internal-admin" },
      body: { version: 1 },
    });
  const disable = (email: string) =>
    invoke(PATCH, {
      method: "PATCH",
      path: one(email),
      params: { email },
      body: { enabled: false, version: 1 },
    });
  const grants = async () =>
    ok(await listRoleGrants({ cursorSecret: CURSOR_SECRET })).items;

  // 4R.4 review warning: only an enabled holder keeps the system administrable
  // (a disabled password user cannot sign in), so only it counts.
  it("revoking the only enabled admin's grant is 409 when the other holder is a disabled password user; the grant stays", async () => {
    const alice = await seedAdmin("alice@example.com");
    await seedAdmin("bob@example.com");
    ok(await disablePasswordUser("bob@example.com", seedCtx(), 1));
    const audit0 = (await auditToday()).length;
    await expectError(await revokeAdminRole(alice.oid), 409, "CONFLICT");
    expect((await grants()).map((g) => g.oid)).toContain(alice.oid);
    expect(await auditToday()).toHaveLength(audit0);
  });

  it("revoking an admin's grant is allowed when the other holder is an enabled password user", async () => {
    const alice = await seedAdmin("alice@example.com");
    await seedAdmin("bob@example.com");
    await readData(await revokeAdminRole(alice.oid));
    expect((await grants()).map((g) => g.oid)).not.toContain(alice.oid);
  });

  it("T33: a concurrent revoke of one admin's grant and disable of the other admin: neither order may leave no enabled admin", async () => {
    const alice = await seedAdmin("alice@example.com");
    const bob = await seedAdmin("bob@example.com");
    const results = await Promise.all([
      revokeAdminRole(alice.oid),
      disable("bob@example.com"),
    ]);
    const statuses = results.map((r) => r.status);
    expect(statuses).toContain(409);
    expect(statuses.filter((status) => status === 200).length).toBeLessThan(2);
    const aliceHolds = (await grants()).some((g) => g.oid === alice.oid);
    const bobEnabled = (await getPasswordUser(bob.email))?.status === "enabled";
    expect(aliceHolds || bobEnabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cross-route rules on every write
// ---------------------------------------------------------------------------
const WRITES = [
  {
    name: "POST /api/password-users",
    handler: POST,
    method: "POST",
    path: LIST,
    pattern: "/api/password-users",
    action: "localuser.create",
    params: {},
    body: { email: "new@example.com", displayName: "New" },
    byEmail: false,
  },
  {
    name: "PATCH /api/password-users/[email]",
    handler: PATCH,
    method: "PATCH",
    path: one("alice@example.com"),
    pattern: "/api/password-users/[email]",
    action: "localuser.update",
    params: { email: "alice@example.com" },
    body: { enabled: false, version: 1 },
    byEmail: true,
  },
  {
    name: "DELETE /api/password-users/[email]",
    handler: DELETE,
    method: "DELETE",
    path: one("alice@example.com"),
    pattern: "/api/password-users/[email]",
    action: "localuser.delete",
    params: { email: "alice@example.com" },
    body: { version: 1 },
    byEmail: true,
  },
  {
    name: "POST /api/password-users/[email]/reset",
    handler: RESET,
    method: "POST",
    path: `${one("alice@example.com")}/reset`,
    pattern: "/api/password-users/[email]/reset",
    action: "localuser.update",
    params: { email: "alice@example.com" },
    body: undefined,
    byEmail: true,
  },
  {
    name: "POST /api/password-users/[email]/totp-reset",
    handler: TOTP_RESET,
    method: "POST",
    path: `${one("alice@example.com")}/totp-reset`,
    pattern: "/api/password-users/[email]/totp-reset",
    action: "localuser.update",
    params: { email: "alice@example.com" },
    body: undefined,
    byEmail: true,
  },
] as const;

describe.each(WRITES)("$name: authorization order and audit", (w) => {
  const call = (extra: Record<string, unknown> = {}) =>
    invoke(w.handler, {
      method: w.method,
      path: w.path,
      params: w.params,
      body: w.body,
      ...extra,
    });

  describe.each(["auditor", "orgAdmin", "viewer", "noRoles"] as const)(
    "as %s (authorization refusal)",
    (caller: Caller) => {
      beforeEach(() => signInAs(caller));

      it("403 FORBIDDEN, the table is untouched, exactly one denied record with the fixed route pattern and no email", async () => {
        await seedActiveUser();
        const before = await nonAuditItems();
        const audit0 = (await auditToday()).length;
        await expectError(await call(), 403, "FORBIDDEN");
        expect(await nonAuditItems()).toEqual(before);
        expect(await auditToday()).toHaveLength(audit0 + 1);
        const denied = await deniedToday();
        expect(denied).toHaveLength(1);
        expect(denied[0]).toMatchObject({
          action: w.action,
          result: "denied",
          category: "security",
          code: "FORBIDDEN",
          actor: `oid-${caller.toLowerCase()}`,
          route: { method: w.method, pattern: w.pattern },
        });
        expect(JSON.stringify(denied[0])).not.toContain("alice@example.com");
        expect(JSON.stringify(denied[0])).not.toContain("new@example.com");
      });

      it("403 comes before parsing and any read: a malformed path email, body, content type and origin all stay 403", async () => {
        await seedActiveUser();
        const before = await nonAuditItems();
        for (const extra of [
          { params: { email: "bad email" }, body: "{not json" },
          { contentType: "text/plain" },
          { origin: "https://evil.example.test" },
          { origin: null },
        ]) {
          resetDeniedAudit();
          await expectError(await call(extra), 403, "FORBIDDEN");
        }
        expect(await nonAuditItems()).toEqual(before);
      });
    },
  );

  it("401 without a session: nothing read, written or audited", async () => {
    await seedActiveUser();
    const before = await nonAuditItems();
    const audit0 = (await auditToday()).length;
    signInAs(null);
    await expectError(await call(), 401, "UNAUTHORIZED");
    expect(await nonAuditItems()).toEqual(before);
    expect((await auditToday()).length).toBe(audit0);
    expect(await deniedToday()).toEqual([]);
  });

  it("401 beats 403: no session with a foreign Origin is still 401", async () => {
    signInAs(null);
    await expectError(
      await call({ origin: "https://evil.example.test" }),
      401,
      "UNAUTHORIZED",
    );
  });
});

describe.each(WRITES.filter((w) => w.byEmail))(
  "$name: path email validation",
  (w) => {
    it.each([
      ["a non-email", "not-an-email"],
      ["a host with no dot", "a@b"],
      ["a space", "a b@example.com"],
      ["an over-long email", `${"x".repeat(300)}@example.com`],
      ["a malformed percent escape", "%E0%A4%A"],
      ["markup", "a<script>@example.com"],
    ])(
      "400 BAD_REQUEST for %s; nothing audited, no denied record",
      async (_n, email) => {
        await seedActiveUser();
        const before = await nonAuditItems();
        await expectError(
          await invoke(w.handler, {
            method: w.method,
            path: one("x"),
            params: { email },
            body: w.body,
          }),
          400,
          "BAD_REQUEST",
        );
        expect(await nonAuditItems()).toEqual(before);
        expect(await deniedToday()).toEqual([]);
        expect(await auditToday()).toEqual([]);
      },
    );
  },
);
