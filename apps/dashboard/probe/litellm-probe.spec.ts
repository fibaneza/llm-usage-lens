import { type APIRequestContext, expect, test } from "@playwright/test";

import { signInAsTestUser } from "../e2e/support/session";
import {
  deleteStoredIdentity,
  seedStoredIdentity,
} from "../e2e/support/identity";

import { assertProbeAllowed, probeKeyName, probeRunId } from "./probe-guard";

// Source: docs/specs/2026-11-10-litellm.md - "Polish and verification (L5)",
// End-to-end probe (LD28): "Per run", "Toggles" and "Cleanup". Runs only from
// probe/playwright.probe.config.ts (`pnpm probe:litellm`, or
// `pnpm probe:litellm:fake` for the named fake mode); never part of
// `pnpm test:e2e`, `pnpm check` or CI. It writes against the dashboard's own
// API routes (the page UI moves in B2); the chat requests go DIRECT to
// LiteLLM with the generated test key only, never the service key (LD18).
//
// Variables (probe/probe-guard.ts): LITELLM_PROBE=1, LITELLM_PROBE_MODE=fake
// (explicit, never a fallback), LITELLM_PROBE_BASE_URL (localhost:4000),
// LITELLM_PROBE_TEAM (the dashboard team id linked to the `llmul-probe`
// fixture team; default `team-probe` in fake mode), LITELLM_PROBE_MODEL (the
// cheapest model the fixture team allows; default `claude-haiku`).
const { mode } = assertProbeAllowed(process.env);
const RUN_ID = probeRunId();
const KEY_NAME = probeKeyName(RUN_ID);
const TEAM =
  process.env.LITELLM_PROBE_TEAM ?? (mode === "fake" ? "team-probe" : "");
const MODEL = process.env.LITELLM_PROBE_MODEL ?? "claude-haiku";
const CHATS = 5;
const MAX_TOKENS = 20;

// Fixed oids per role so a rerun overwrites its own identities (the identity
// rows are removed in cleanup).
const ADMIN = {
  oid: "00000000-0000-4000-8000-0000000b0001",
  roles: ["internal-admin"],
  email: `probe-admin-${RUN_ID}@example.test`,
};
const LEAD = {
  oid: "00000000-0000-4000-8000-0000000b0002",
  roles: ["internal-viewer"],
  email: `probe-lead-${RUN_ID}@example.test`,
};
const MEMBER = {
  oid: "00000000-0000-4000-8000-0000000b0003",
  roles: ["internal-viewer"],
  email: `probe-member-${RUN_ID}@example.test`,
};
const VIEWER = {
  oid: "00000000-0000-4000-8000-0000000b0004",
  roles: ["internal-viewer"],
  email: `probe-viewer-${RUN_ID}@example.test`,
};

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

test.describe.configure({ mode: "serial" });

test.describe(`LiteLLM probe ${RUN_ID} (${mode} mode)`, () => {
  let base = "";
  const generated: string[] = []; // token hashes of every key this run made
  let previousToggles: Record<string, boolean> = {};
  let togglesVersion = 0;
  let memberAdded = false;
  let leadScoped = false;
  // Versions returned by the POSTs; the dashboard DELETEs require { version }.
  let scopeVersion = 0;
  let membershipVersion = 0;
  let keyValue = "";
  let tokenId = "";

  // A signed-in API client per role: forged session as in e2e/dev-login.spec
  // (the dev login only signs in as a stored identity).
  async function as(
    who: typeof ADMIN,
    browserContext: import("@playwright/test").BrowserContext,
  ) {
    await browserContext.clearCookies();
    await signInAsTestUser(browserContext, {
      oid: who.oid,
      roles: who.roles,
      authTime: Math.floor(Date.now() / 1000),
    });
    return browserContext.request;
  }

  const write = (
    api: APIRequestContext,
    method: "post" | "put" | "patch" | "delete",
    path: string,
    data?: unknown,
  ) =>
    api[method](path, {
      headers: { origin: base },
      ...(data === undefined ? {} : { data }),
    });
  const json = async (res: import("@playwright/test").APIResponse) =>
    (await res.json()) as Json;

  // LD28 "Cleanup": a run after a killed run starts clean. The fixed walk oids
  // (0b0001-0b0004) are cleared of leftover Lead scope, dashboard membership,
  // LiteLLM team membership and llmul-probe-* keys, through the dashboard API,
  // in both modes. Toggles are NOT restored here: test 1 records them as found.
  async function clearLeftovers(
    browserContext: import("@playwright/test").BrowserContext,
  ) {
    const api = await as(ADMIN, browserContext);
    const problems: string[] = [];
    const check = async (
      what: string,
      res: import("@playwright/test").APIResponse,
    ) => {
      if (res.status() >= 300 && res.status() !== 404)
        problems.push(`${what}: ${res.status()} ${await res.text()}`);
    };
    const walkOids = [ADMIN, LEAD, MEMBER, VIEWER].map((p) => p.oid);

    // llmul-probe-* keys on the fixture team need deleteKey on for a moment.
    const keysRes = await api.get(`/api/litellm/teams/${TEAM}/keys`);
    if (keysRes.status() >= 300) {
      problems.push(`list keys: ${keysRes.status()} ${await keysRes.text()}`);
    } else {
      const stray = (((await json(keysRes)).data.items ?? []) as Json[]).filter(
        (k) => String(k.keyAlias ?? "").startsWith("llmul-probe-"),
      );
      if (stray.length > 0) {
        const togglesRes = await api.get("/api/litellm/toggles");
        const found = await json(togglesRes);
        const wasOn = found.data.operations.deleteKey.enabled as boolean;
        let version = found.data.version as number;
        let enabledByCleanup = false;
        try {
          if (!wasOn) {
            const on = await write(api, "put", "/api/litellm/toggles", {
              version: version === 0 ? null : version,
              toggles: { deleteKey: true },
            });
            await check("enable deleteKey for cleanup", on);
            if (on.status() < 300) {
              enabledByCleanup = true;
              version = (await json(on)).data?.version ?? version;
            }
          }
          for (const k of stray) {
            await check(
              `delete stray key ${k.tokenId}`,
              await write(
                api,
                "delete",
                `/api/litellm/teams/${TEAM}/keys/${k.tokenId}`,
              ),
            );
          }
        } finally {
          // Restored even when a delete throws; skipped when the enable never
          // took effect (a stale-version PUT would only add a second error).
          if (enabledByCleanup) {
            await check(
              "restore deleteKey",
              await write(api, "put", "/api/litellm/toggles", {
                version,
                toggles: { deleteKey: false },
              }),
            );
          }
        }
      }
    }

    for (const oid of walkOids) {
      await check(
        `remove LiteLLM member ${oid}`,
        await write(api, "delete", `/api/litellm/teams/${TEAM}/members/${oid}`),
      );
    }

    const members = await api.get(`/api/teams/${TEAM}/members`);
    if (members.status() >= 300) {
      problems.push(`list members: ${members.status()}`);
    } else {
      for (const row of ((await json(members)).data.items ?? []) as Json[]) {
        if (walkOids.includes(row.oid)) {
          await check(
            `dashboard membership ${row.oid}`,
            await write(
              api,
              "delete",
              `/api/teams/${TEAM}/members/${row.oid}`,
              { version: row.version },
            ),
          );
        }
      }
    }
    const admins = await api.get(`/api/teams/${TEAM}/admins`);
    if (admins.status() >= 300) {
      problems.push(`list admins: ${admins.status()}`);
    } else {
      for (const row of ((await json(admins)).data.items ?? []) as Json[]) {
        if (walkOids.includes(row.oid)) {
          await check(
            `lead scope ${row.oid}`,
            await write(api, "delete", `/api/teams/${TEAM}/admins/${row.oid}`, {
              version: row.version,
            }),
          );
        }
      }
    }
    expect(problems, "probe pre-run cleanup of the fixed walk oids").toEqual(
      [],
    );
  }

  test.beforeAll(async ({ browser }) => {
    base = String(test.info().project.use.baseURL);
    expect(
      TEAM,
      "set LITELLM_PROBE_TEAM to the dashboard team linked to llmul-probe",
    ).not.toBe("");
    for (const p of [ADMIN, LEAD, MEMBER, VIEWER]) {
      await seedStoredIdentity({
        oid: p.oid,
        email: p.email,
        displayName: `Probe ${RUN_ID}`,
        lastSeenRoles: p.roles,
      });
    }
    const context = await browser.newContext({ baseURL: base });
    try {
      await clearLeftovers(context);
    } finally {
      await context.close();
    }
  });

  test("Admin: the connection is the local LiteLLM, then the delete and spend-reset toggles are on for this run only", async ({
    context,
  }) => {
    const api = await as(ADMIN, context);
    if (mode === "real") {
      const conn = await json(await api.get("/api/litellm/connection"));
      // Second guard on the stored connection (LD17): the dashboard must also
      // point at localhost:4000, not only the probe's own URL.
      expect(new URL(conn.data.baseUrl).host).toBe("localhost:4000");
    }
    const toggles = await json(await api.get("/api/litellm/toggles"));
    togglesVersion = toggles.data.version;
    previousToggles = Object.fromEntries(
      ["deleteKey", "resetMemberSpend"].map((op) => [
        op,
        toggles.data.operations[op].enabled as boolean,
      ]),
    );
    const put = await write(api, "put", "/api/litellm/toggles", {
      version: togglesVersion === 0 ? null : togglesVersion,
      toggles: { deleteKey: true, resetMemberSpend: true },
    });
    expect(put.status()).toBe(200);
    togglesVersion = (await json(put)).data.version;
  });

  test("Admin: gives the Lead a team scope and the member a dashboard membership, then adds the member to the LiteLLM team", async ({
    context,
  }) => {
    const api = await as(ADMIN, context);
    const scope = await write(api, "post", `/api/teams/${TEAM}/admins`, {
      oid: LEAD.oid,
    });
    expect(scope.status(), await scope.text()).toBeLessThan(300);
    scopeVersion = (await json(scope)).data.version;
    leadScoped = true;
    const dash = await write(api, "post", `/api/teams/${TEAM}/members`, {
      oid: MEMBER.oid,
    });
    expect(dash.status(), await dash.text()).toBeLessThan(300);
    membershipVersion = (await json(dash)).data.version;
    const added = await write(
      api,
      "post",
      `/api/litellm/teams/${TEAM}/members`,
      { oid: MEMBER.oid },
    );
    expect(added.status(), await added.text()).toBe(201);
    memberAdded = true;
  });

  test("Lead: lowers the member's budget and limits", async ({ context }) => {
    const api = await as(LEAD, context);
    const budget = await write(
      api,
      "patch",
      `/api/litellm/teams/${TEAM}/members/${MEMBER.oid}/budget`,
      { maxBudgetInTeam: 0.01 },
    );
    expect(budget.status(), await budget.text()).toBe(200);
    const limits = await write(
      api,
      "patch",
      `/api/litellm/teams/${TEAM}/members/${MEMBER.oid}/limits`,
      { rpmLimit: 5, tpmLimit: 2000 },
    );
    expect(limits.status(), await limits.text()).toBe(200);
  });

  test("Lead: generates a key named llmul-probe-<run id>; the value is shown once", async ({
    context,
  }) => {
    const api = await as(LEAD, context);
    const res = await write(api, "post", `/api/litellm/teams/${TEAM}/keys`, {
      oid: MEMBER.oid,
      keyAlias: KEY_NAME,
    });
    expect(res.status(), await res.text()).toBe(201);
    const body = await json(res);
    keyValue = body.data.key;
    tokenId = body.data.tokenId;
    expect(keyValue).toMatch(/^sk-/);
    generated.push(tokenId);

    const listed = await json(await api.get(`/api/litellm/teams/${TEAM}/keys`));
    const row = (listed.data.items as Json[]).find(
      (k) => k.tokenId === tokenId,
    );
    expect(row?.keyAlias).toBe(KEY_NAME);
    // Shown once: the listing never carries the value (LT9).
    expect(JSON.stringify(listed)).not.toContain(keyValue);
  });

  test("Lead: blocks, unblocks and rotates the key; the rotated key replaces the first", async ({
    context,
  }) => {
    const api = await as(LEAD, context);
    const keyUrl = `/api/litellm/teams/${TEAM}/keys/${tokenId}`;
    expect((await write(api, "post", `${keyUrl}/block`)).status()).toBe(200);
    expect((await write(api, "post", `${keyUrl}/unblock`)).status()).toBe(200);
    const rotated = await write(api, "post", `${keyUrl}/rotate`, {});
    expect(rotated.status(), await rotated.text()).toBe(200);
    const body = await json(rotated);
    expect(body.data.key).toMatch(/^sk-/);
    expect(body.data.key).not.toBe(keyValue);
    keyValue = body.data.key;
    tokenId = body.data.tokenId;
    generated.push(tokenId);
  });

  test("Viewer: is refused a LiteLLM write with 403 before parsing (spec matrix: Viewer, no team)", async ({
    context,
  }) => {
    const api = await as(VIEWER, context);
    const res = await write(api, "post", `/api/litellm/teams/${TEAM}/keys`, {
      oid: MEMBER.oid,
    });
    expect(res.status()).toBe(403);
  });

  test("a few chat requests go straight to LiteLLM with the generated key, never the service key (LD18)", async ({
    playwright,
  }) => {
    const target = process.env.LITELLM_PROBE_BASE_URL;
    expect(target, "LITELLM_PROBE_BASE_URL").toBeTruthy();
    const litellm = await playwright.request.newContext({
      baseURL: target,
      extraHTTPHeaders: { authorization: `Bearer ${keyValue}` },
    });
    try {
      for (let i = 0; i < CHATS; i++) {
        const res = await litellm.post("/chat/completions", {
          data: {
            model: MODEL,
            max_tokens: MAX_TOKENS,
            messages: [
              { role: "user", content: `probe ${RUN_ID} ${i}: say ok` },
            ],
          },
        });
        expect(res.status(), `chat ${i}`).toBe(200);
      }
    } finally {
      await litellm.dispose();
    }
  });

  test("Lead: LiteLLM-reported spend appears for the member", async ({
    context,
  }) => {
    const api = await as(LEAD, context);
    await expect
      .poll(
        async () => {
          const members = await json(
            await api.get(`/api/litellm/teams/${TEAM}/members`),
          );
          const row = (members.data.items as Json[]).find(
            (m) => m.email === MEMBER.email,
          );
          return row?.spend ?? 0;
        },
        { timeout: 60_000, intervals: [2_000] },
      )
      .toBeGreaterThan(0);
  });

  test("Lead: resets the member's spend and reads 0 (resetMemberSpend)", async ({
    context,
  }) => {
    const api = await as(LEAD, context);
    const reset = await write(
      api,
      "post",
      `/api/litellm/teams/${TEAM}/members/${MEMBER.oid}/reset-spend`,
    );
    expect(reset.status(), await reset.text()).toBe(200);
    const members = await json(
      await api.get(`/api/litellm/teams/${TEAM}/members`),
    );
    const row = (members.data.items as Json[]).find(
      (m) => m.email === MEMBER.email,
    );
    expect(row?.spend).toBe(0);
  });

  // Cleanup runs after a failure too: delete every generated key, remove the
  // member, restore the toggles. Kept by design: audit records, spend logs and
  // (OSS) the LiteLLM user addTeamMember created.
  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext();
    const failures: string[] = [];
    const attempt = async (what: string, run: () => Promise<number>) => {
      try {
        const status = await run();
        if (status >= 300 && status !== 404)
          failures.push(`${what}: ${status}`);
      } catch (error) {
        failures.push(`${what}: ${String(error)}`);
      }
    };
    try {
      const api = await as(ADMIN, context);
      for (const token of generated) {
        await attempt(`delete key ${token}`, async () =>
          (
            await write(
              api,
              "delete",
              `/api/litellm/teams/${TEAM}/keys/${token}`,
            )
          ).status(),
        );
      }
      if (memberAdded) {
        await attempt("remove member", async () =>
          (
            await write(
              api,
              "delete",
              `/api/litellm/teams/${TEAM}/members/${MEMBER.oid}`,
            )
          ).status(),
        );
      }
      await attempt("dashboard membership", async () =>
        (
          await write(
            api,
            "delete",
            `/api/teams/${TEAM}/members/${MEMBER.oid}`,
            { version: membershipVersion },
          )
        ).status(),
      );
      if (leadScoped) {
        await attempt("lead scope", async () =>
          (
            await write(
              api,
              "delete",
              `/api/teams/${TEAM}/admins/${LEAD.oid}`,
              { version: scopeVersion },
            )
          ).status(),
        );
      }
      // Toggles are restored last: deleteKey must be on for the key cleanup.
      // Skipped when test 1 never recorded them (beforeAll failed): PUTting
      // undefined values would only add a misleading 400 to the real error.
      if (Object.keys(previousToggles).length > 0) {
        await attempt("restore toggles", async () =>
          (
            await write(api, "put", "/api/litellm/toggles", {
              version: togglesVersion === 0 ? null : togglesVersion,
              toggles: previousToggles,
            })
          ).status(),
        );
      }
    } finally {
      for (const p of [ADMIN, LEAD, MEMBER, VIEWER]) {
        await deleteStoredIdentity(p.oid);
      }
      await context.close();
    }
    expect(failures, "probe cleanup").toEqual([]);
  });
});
