import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { getLiteLLMUserOwner } from "@/lib/data/access/identity-links";
import {
  BASE_URL,
  HOST,
  expectError,
  expectNoSentinels,
  setupViewsSuite,
  signInWithRoles,
  stubLiteLLMEnv,
} from "@/test/fakes/fake-litellm-views";
import type { RouteHandler } from "@/test/fakes/fake-litellm-views";
import { signInAs } from "@/test/fixtures/scope-fixtures";
import type { CallerName } from "@/test/fixtures/scope-fixtures";
import { ctxAt, ok } from "@/test/support/access-test-support";
import {
  installSyncFake,
  seedPendingLinksViaSync,
  writeCalls,
} from "@/test/support/litellm-user-sync-support";
import type { SyncUser } from "@/test/support/litellm-user-sync-support";
import { TEST_TABLE_NAME, testDoc } from "@/test/support/test-support";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (`/api/identities/pending-links`: GET for `internal-admin`,
// `internal-org-admin` and `internal-auditor`, 25 rows a page, opaque cursor;
// DELETE `{ email, version }` for admin and org-admin, removes the pending link
// and releases its claim, audited `identity.litellm-pending.remove`),
// "Permission matrix" (read pending LiteLLM links: auditor reads; remove: admin
// and org-admin only), "LiteLLM user sync" (*Pending LiteLLM links*: the
// partition `PENDING#{key}` is shared with pending members and admin scopes;
// *Clean-up*), Tests T-SY9, T-SY10, T-SY11. The 401, 400 shape, no-store and
// the auditor's DELETE refusal are the shared route-contract suite's
// (registry entries in test/route-registry.ts, Rule 60.23); this file adds the
// lead and the route-specific cases. LiteLLM is the in-process fake (Rule
// 60.24).
//
// Assumed response shape: GET `data` is `{ items, cursor? }`, one item per
// pending link `{ email?, litellmUserId, version, createdAt }`: `email` only
// when the placeholder key is an email; a placeholder keyed by an SSO
// reference shows no email, only its `litellmUserId`, and the DELETE body is
// `{ email, version }` or `{ litellmUserId, version }` (Access Control -
// LiteLLM user sync, ~line 1033: `sso_user_id` is never returned, logged or
// stored in clear; S20, T-SY1; the stored key is `PENDING#sso:<sha256 hex of
// the lower-cased sso_user_id>`).
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const PATH = "/api/identities/pending-links";
const AUDIT_DAY = "2026-11-14";
const state = setupViewsSuite();

const userN = (i: number): SyncUser => ({
  id: `lu-pend-${i}`,
  email: `pend${String(i).padStart(2, "0")}@company.com`,
});
const THIRTY = Array.from({ length: 30 }, (_v, i) => userN(i));

async function load() {
  stubLiteLLMEnv();
  return import("./route");
}
async function read(handler: RouteHandler, query = "") {
  const res = await handler(
    new Request(`${BASE_URL}${PATH}${query}`, { headers: { host: HOST } }),
    { params: Promise.resolve({}) },
  );
  const text = await res.clone().text();
  return { res, text, body: JSON.parse(text) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
async function list(who: CallerName | "noRole", query = "") {
  if (who === "noRole") await signInWithRoles([]);
  else signInAs(who);
  return read((await load()).GET as RouteHandler, query);
}
async function remove(who: CallerName, body: unknown) {
  signInAs(who);
  const handler = (await load()).DELETE as RouteHandler;
  const res = await handler(
    new Request(`${BASE_URL}${PATH}`, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        host: HOST,
        origin: BASE_URL,
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  );
  const text = await res.clone().text();
  return { res, text, body: JSON.parse(text) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
async function removals() {
  const { listAuditRecords } = await import("@/lib/data/access/audit");
  return (await listAuditRecords(AUDIT_DAY)).filter(
    (r) => r.action === "identity.litellm-pending.remove",
  );
}
const stored = async (pk: string, sk: string) =>
  (
    await testDoc().send(
      new GetCommand({ TableName: TEST_TABLE_NAME, Key: { PK: pk, SK: sk } }),
    )
  ).Item;

describe("GET /api/identities/pending-links (Not signed in yet)", () => {
  it.each(["admin", "orgAdmin", "auditor"] as CallerName[])(
    "%s reads 25 rows a page with an opaque cursor, the second page has the rest, LiteLLM is not called (T-SY9)",
    async (who) => {
      await seedPendingLinksViaSync(state, THIRTY);
      const first = await list(who);
      expect(first.res.status).toBe(200);
      expect(first.res.headers.get("cache-control")).toBe("private, no-store");
      expect(first.body.data.items).toHaveLength(25);
      expect(typeof first.body.data.cursor).toBe("string");
      expectNoSentinels(first.text);

      const second = await list(
        who,
        `?cursor=${encodeURIComponent(first.body.data.cursor)}`,
      );
      expect(second.body.data.items).toHaveLength(5);
      expect(second.body.data.cursor).toBeUndefined();

      const items = [...first.body.data.items, ...second.body.data.items];
      expect(items.map((i: { email: string }) => i.email).sort()).toEqual(
        THIRTY.map((u) => u.email).sort(),
      );
      expect(items[0]).toMatchObject({
        litellmUserId: expect.stringMatching(/^lu-pend-/),
        version: expect.any(Number),
      });
      expect(state.fake.calls).toHaveLength(0);
    },
  );

  it.each([
    "teamAdminA",
    "deptAdminEng",
    "memberA",
    "viewerNone",
    "noRole",
  ] as const)("%s (a lead, a user, no role) gets 403 (T-SY9)", async (who) => {
    installSyncFake(state);
    await expectError((await list(who)).res, 403, "FORBIDDEN");
  });

  it("a pending member of the same email is not a pending link: it never breaks or shows in the list (Pending LiteLLM links: shared partition)", async () => {
    await seedPendingLinksViaSync(state, [userN(1)]);
    const { createPendingItem } = await import("@/lib/data/access/pending");
    ok(
      await createPendingItem(
        {
          kind: "affiliation",
          emailOrUpn: userN(1).email ?? "",
          teamId: "team-a",
        },
        ctxAt(undefined, "req-pending-member"),
      ),
    );
    const { res, body } = await list("admin");
    expect(res.status).toBe(200);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]).toMatchObject({ litellmUserId: "lu-pend-1" });
  });
});

describe("DELETE /api/identities/pending-links (Remove)", () => {
  async function versionOf(email: string) {
    const rows = (await list("admin")).body.data.items as Array<{
      email: string;
      version: number;
    }>;
    const row = rows.find((r) => r.email === email);
    if (!row) throw new Error(`no pending link for ${email}`);
    return row.version;
  }

  it.each(["admin", "orgAdmin"] as CallerName[])(
    "%s removes the pending link, releases its claim, writes one identity.litellm-pending.remove record, and leaves LiteLLM alone (T-SY10, T-SY11)",
    async (who) => {
      await seedPendingLinksViaSync(state, [userN(1), userN(2)]);
      const email = userN(1).email ?? "";
      const version = await versionOf(email);
      const { res } = await remove(who, { email, version });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");

      expect(await stored(`PENDING#${email}`, "LITELLMLINK")).toBeUndefined();
      expect(await getLiteLLMUserOwner("lu-pend-1")).toBeNull();
      expect(
        await stored(`PENDING#${userN(2).email}`, "LITELLMLINK"),
      ).toBeDefined();
      const records = await removals();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ result: "success" });
      expect(state.fake.calls).toHaveLength(0);
      expect(writeCalls(state)).toEqual([]);
    },
  );

  it("removes only the LiteLLM link: a pending member under the same email stays (shared partition)", async () => {
    await seedPendingLinksViaSync(state, [userN(1)]);
    const email = userN(1).email ?? "";
    const { createPendingItem } = await import("@/lib/data/access/pending");
    ok(
      await createPendingItem(
        { kind: "affiliation", emailOrUpn: email, teamId: "team-a" },
        ctxAt(undefined, "req-pending-member"),
      ),
    );
    const version = await versionOf(email);
    const { res } = await remove("admin", { email, version });
    expect(res.status).toBe(200);
    expect(await stored(`PENDING#${email}`, "AFFILIATION")).toBeDefined();
  });

  it("the email is matched case-insensitively (Pending links are keyed by the lower-cased email)", async () => {
    await seedPendingLinksViaSync(state, [userN(1)]);
    const email = userN(1).email ?? "";
    const version = await versionOf(email);
    const { res } = await remove("admin", {
      email: email.toUpperCase(),
      version,
    });
    expect(res.status).toBe(200);
    expect(await stored(`PENDING#${email}`, "LITELLMLINK")).toBeUndefined();
  });

  it("a stale version is 409 CONFLICT and an unknown email is 404 NOT_FOUND; nothing changes (version rule of every write)", async () => {
    await seedPendingLinksViaSync(state, [userN(1)]);
    const email = userN(1).email ?? "";
    const version = await versionOf(email);
    await expectError(
      (await remove("admin", { email, version: version + 1 })).res,
      409,
      "CONFLICT",
    );
    await expectError(
      (await remove("admin", { email: "nobody@company.com", version: 1 })).res,
      404,
      "NOT_FOUND",
    );
    expect(await stored(`PENDING#${email}`, "LITELLMLINK")).toBeDefined();
    expect(await removals()).toHaveLength(0);
  });

  it.each(["teamAdminA", "deptAdminEng", "memberA"] as CallerName[])(
    "%s (a lead or a user) gets 403 before parsing, one denied record, nothing removed (T-SY9, Rule 10.3)",
    async (who) => {
      await seedPendingLinksViaSync(state, [userN(1)]);
      const email = userN(1).email ?? "";
      const { res } = await remove(who, { nonsense: true });
      await expectError(res, 403, "FORBIDDEN");
      expect(await stored(`PENDING#${email}`, "LITELLMLINK")).toBeDefined();
      const denied = (await removals()).filter((r) => r.result === "denied");
      expect(denied).toHaveLength(1);
      expect(denied[0]).toMatchObject({
        route: { method: "DELETE", pattern: PATH },
        code: "FORBIDDEN",
      });
    },
  );
});

// Access Control - LiteLLM user sync, ~line 1033 ("never returned, logged or
// stored in clear"), S20, T-SY1.
describe("a placeholder keyed by an SSO reference (S20, T-SY1)", () => {
  const SSO = "SSO-Route-Sentinel-31";
  const SSO_USER: SyncUser = {
    id: "lu-sso-1",
    email: "sso.person@company.com",
    sso: SSO,
  };
  const MAIL_USER: SyncUser = {
    id: "lu-mail-1",
    email: "mail.person@company.com",
  };
  const hashed = createHash("sha256").update(SSO.toLowerCase()).digest("hex");
  const shows = (text: string) =>
    [SSO, SSO.toLowerCase(), "sso-route-sentinel"].some((v) =>
      text.toLowerCase().includes(v),
    );

  it("GET returns no SSO value anywhere: the SSO-keyed row shows its litellmUserId and no email, the email row shows the email", async () => {
    await seedPendingLinksViaSync(state, [SSO_USER, MAIL_USER]);
    const { res, text, body } = await list("admin");
    expect(res.status).toBe(200);
    expect(shows(text)).toBe(false);
    expect(text).not.toContain("sso:");
    expect(text).not.toContain(hashed);
    const items = body.data.items as Array<Record<string, unknown>>;
    const sso = items.find((i) => i.litellmUserId === "lu-sso-1");
    const mail = items.find((i) => i.litellmUserId === "lu-mail-1");
    expect(sso).toBeDefined();
    expect(sso?.email).toBeUndefined();
    expect(mail?.email).toBe("mail.person@company.com");
  });

  it("the auditor's GET shows no SSO value either (T-SY9)", async () => {
    await seedPendingLinksViaSync(state, [SSO_USER]);
    const { text } = await list("auditor");
    expect(shows(text)).toBe(false);
  });

  it("the placeholder is stored under PENDING#sso:<sha256 hex>, never under the raw reference", async () => {
    await seedPendingLinksViaSync(state, [SSO_USER]);
    expect(await stored(`PENDING#sso:${hashed}`, "LITELLMLINK")).toBeDefined();
    expect(await stored(`PENDING#${SSO.toLowerCase()}`, "LITELLMLINK")).toBe(
      undefined,
    );
  });

  it.each(["admin", "orgAdmin"] as CallerName[])(
    "%s removes it by { litellmUserId, version }: the placeholder and the claim go, and the record and the response carry no SSO value",
    async (who) => {
      await seedPendingLinksViaSync(state, [SSO_USER, MAIL_USER]);
      const rows = (await list("admin")).body.data.items as Array<{
        litellmUserId: string;
        version: number;
      }>;
      const row = rows.find((r) => r.litellmUserId === "lu-sso-1");
      const { res, text, body } = await remove(who, {
        litellmUserId: "lu-sso-1",
        version: row?.version ?? 0,
      });
      expect(res.status).toBe(200);
      expect(body.data).toMatchObject({ litellmUserId: "lu-sso-1" });
      expect(shows(text)).toBe(false);
      expect(await stored(`PENDING#sso:${hashed}`, "LITELLMLINK")).toBe(
        undefined,
      );
      expect(await getLiteLLMUserOwner("lu-sso-1")).toBeNull();
      expect(
        await stored(`PENDING#${MAIL_USER.email}`, "LITELLMLINK"),
      ).toBeDefined();
      const records = await removals();
      expect(records).toHaveLength(1);
      expect(shows(JSON.stringify(records))).toBe(false);
    },
  );

  it("a stale version is 409 and an unknown litellmUserId is 404; nothing changes", async () => {
    await seedPendingLinksViaSync(state, [SSO_USER]);
    await expectError(
      (await remove("admin", { litellmUserId: "lu-sso-1", version: 99 })).res,
      409,
      "CONFLICT",
    );
    await expectError(
      (await remove("admin", { litellmUserId: "lu-nobody", version: 1 })).res,
      404,
      "NOT_FOUND",
    );
    expect(await stored(`PENDING#sso:${hashed}`, "LITELLMLINK")).toBeDefined();
  });

  it("a body naming neither an email nor a litellmUserId is 400 (validate at the boundary, Rule 60.16)", async () => {
    await seedPendingLinksViaSync(state, [SSO_USER]);
    await expectError(
      (await remove("admin", { version: 1 })).res,
      400,
      "BAD_REQUEST",
    );
  });
});
