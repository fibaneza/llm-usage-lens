import { request } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

import { buildSessionToken } from "../e2e/support/session";

import {
  FAKE_ACCOUNT_ID,
  FAKE_DASHBOARD_TEAM_ID,
  FAKE_LITELLM_BASE_URL,
  FAKE_LITELLM_TEAM_ID,
  PROBE_BASE_URL,
  SETUP_ADMIN_OID,
} from "./probe-constants";

// Source: docs/specs/2026-11-10-litellm.md - "End-to-end probe" (Results: the
// named fake mode runs the same walk against a fake). The real mode relies on
// the runbook's one-time setup (the llmul-probe team linked in Settings); the
// fake mode has to create its own equivalent, through the dashboard's real
// Admin routes with a forged Admin session: the connection to the fake, a
// fixture account for the dashboard team, and the team link. Teardown removes
// the link and deactivates the account; the connection is pointed back at the
// previous URL when that still answers (the e2e dev-login spec re-saves its
// own connection when it differs).
const SESSION_COOKIE = "authjs.session-token";

type Row = { oid: string; version: number };
type Json = {
  data?: {
    items?: Row[];
    baseUrl: string | null;
    version: number;
  };
};

async function adminApi(): Promise<APIRequestContext> {
  const token = await buildSessionToken({
    oid: SETUP_ADMIN_OID,
    roles: ["internal-admin"],
  });
  return request.newContext({
    baseURL: PROBE_BASE_URL,
    extraHTTPHeaders: {
      cookie: `${SESSION_COOKIE}=${token}`,
      origin: PROBE_BASE_URL,
    },
  });
}

async function must(
  what: string,
  res: import("@playwright/test").APIResponse,
  ok: number[] = [200, 201],
): Promise<Json> {
  if (!ok.includes(res.status())) {
    throw new Error(`fake probe setup: ${what} answered ${res.status()}`);
  }
  return (await res.json()) as Json;
}

// The walk's fixed Lead and member oids (litellm-probe.spec.ts). Their team
// scope and membership are removed with the row `version` the DELETE routes
// require, so a rerun starts clean even if a walk left them behind.
const WALK_OIDS = [
  "00000000-0000-4000-8000-0000000b0002",
  "00000000-0000-4000-8000-0000000b0003",
];

async function clearWalkAccess(api: APIRequestContext) {
  for (const kind of ["admins", "members"] as const) {
    const path = `/api/teams/${FAKE_DASHBOARD_TEAM_ID}/${kind}`;
    const listed = await api.get(path);
    if (listed.status() !== 200) continue;
    const rows = ((await listed.json()) as Json).data?.items;
    for (const row of rows ?? []) {
      if (WALK_OIDS.includes(row.oid)) {
        await api.delete(`${path}/${row.oid}`, {
          data: { version: row.version },
        });
      }
    }
  }
}

// eslint-disable-next-line import/no-default-export -- Playwright requires a default export
export default async function globalSetup() {
  const api = await adminApi();
  const connection = (
    await must("read connection", await api.get("/api/litellm/connection"))
  ).data;
  if (!connection) throw new Error("fake probe setup: no connection data");
  const before = connection;

  await must(
    "save connection",
    await api.put("/api/litellm/connection", {
      data: {
        baseUrl: FAKE_LITELLM_BASE_URL,
        version: before.version === 0 ? null : before.version,
      },
    }),
  );

  const created = await api.post("/api/accounts", {
    data: {
      accountId: FAKE_ACCOUNT_ID,
      accountName: "llmul-probe",
      departmentId: "dept-probe",
      departmentName: "Probe",
      teamId: FAKE_DASHBOARD_TEAM_ID,
      teamName: "Probe team",
      region: "ap-southeast-2",
    },
  });
  // 400 "Account already exists": left (deactivated) by an earlier run; the
  // team views do not filter on `active`, so it is reused as it is.
  await must("create account", created, [200, 201, 400]);

  await clearWalkAccess(api);
  await api.delete(`/api/litellm/team-links/${FAKE_DASHBOARD_TEAM_ID}`);
  await must(
    "link team",
    await api.put(`/api/litellm/team-links/${FAKE_DASHBOARD_TEAM_ID}`, {
      data: { litellmTeamId: FAKE_LITELLM_TEAM_ID, version: null },
    }),
  );
  await api.dispose();

  return async () => {
    const admin = await adminApi();
    await clearWalkAccess(admin);
    await admin.delete(`/api/litellm/team-links/${FAKE_DASHBOARD_TEAM_ID}`);
    await admin.delete(`/api/accounts/${FAKE_ACCOUNT_ID}`);
    if (before.baseUrl !== null) {
      const current = (await (
        await admin.get("/api/litellm/connection")
      ).json()) as Json;
      // Best effort: the old URL may not be running; the connection test then
      // refuses and the fake URL stays (see the header comment).
      await admin.put("/api/litellm/connection", {
        data: {
          baseUrl: before.baseUrl,
          version: current.data?.version ?? null,
        },
      });
    }
    await admin.dispose();
  };
}
