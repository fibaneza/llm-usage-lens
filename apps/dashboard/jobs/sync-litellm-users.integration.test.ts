import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { FakeCall } from "@/test/fakes/fake-litellm";
import { ENTRA_ISSUER } from "@/test/support/password-test-support";
import {
  TEST_TABLE_NAME,
  clearTable,
  testDoc,
} from "@/test/support/test-support";
import {
  allItems,
  newSyncState,
  nonReadCalls,
  syncHandler,
} from "@/test/support/user-sync-support";

// Source: docs/specs/2026-11-10-platform.md - "Scheduled job - LiteLLM user
// sync (unit SYNC2)" (entry apps/dashboard/jobs/sync-litellm-users.ts, esbuild
// bundle with the react-server condition and no alias for `server-only`, run
// with `node`; exit and deadline; V13, V14); Access Control - "LiteLLM user
// sync" (scheduled run S17; records) and test T-SY8 (job, integration: the
// bundled entry runs against DynamoDB Local and the fake LiteLLM), T-SY11 (the
// fake records zero write calls), T-SY12 (actor system, trigger schedule).
//
// Assumed names: the package script `build:jobs` in apps/dashboard/package.json
// writes apps/dashboard/jobs/sync-litellm-users.cjs (the path the schedule's
// command override runs). LiteLLM is a real local HTTP server driven by the
// shared sync fake handler; the child process gets only environment variables.
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../..");
const BUNDLE = join(HERE, "sync-litellm-users.cjs");
const EMPTY_CONFIG = join(HERE, "../test/fixtures/config/empty.yaml");
const EMAIL = "new.person@corp.example";
const SERVICE_KEY = "sk-fake-key-000";

type Fake = {
  server: Server;
  port: number;
  calls: FakeCall[];
  listRequested: Promise<void>;
  hangList: boolean;
  sockets: Set<import("node:net").Socket>;
};

let fake: Fake;

async function startFake(): Promise<Fake> {
  const state = newSyncState();
  state.users.push({ userId: "lu-new", email: EMAIL });
  const handler = syncHandler(state);
  let signalList: () => void = () => undefined;
  const listRequested = new Promise<void>((resolve) => {
    signalList = resolve;
  });
  const sockets = new Set<import("node:net").Socket>();
  const self = {
    calls: [] as FakeCall[],
    listRequested,
    hangList: false,
    sockets,
  } as Fake;
  self.server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const call: FakeCall = {
      url: url.href,
      host: String(req.headers.host ?? ""),
      method: (req.method ?? "GET").toUpperCase(),
      path: url.pathname,
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, String(v)]),
      ),
      body: undefined,
      redirect: undefined,
    };
    self.calls.push(call);
    if (self.hangList && call.path === "/user/list") {
      signalList();
      return;
    }
    const reply = handler(call, 1);
    if (reply === "network-error" || reply === "hang") {
      req.socket.destroy();
      return;
    }
    res.writeHead(reply.status, { "content-type": "application/json" });
    res.end(JSON.stringify(reply.body ?? {}));
  });
  self.server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((resolve) =>
    self.server.listen(0, "127.0.0.1", resolve),
  );
  self.port = (self.server.address() as AddressInfo).port;
  return self;
}

async function seedConnection(port: number) {
  await testDoc().send(
    new PutCommand({
      TableName: TEST_TABLE_NAME,
      Item: {
        PK: "LITELLM#CONFIG",
        SK: "CONNECTION",
        baseUrl: `http://127.0.0.1:${port}`,
        version: 1,
        updatedAt: "2026-11-24T10:00:00.000Z",
      },
    }),
  );
}

function jobEnv(port: number): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: "production",
    SKIP_ENV_VALIDATION: "true",
    APP_ENV: "dev",
    AUTH_ACCESS_MODE: "enforce",
    AUTH_SECRET: "integration-test-auth-secret",
    AUTH_MICROSOFT_ENTRA_ID_ID: "client-id-test",
    AUTH_MICROSOFT_ENTRA_ID_ISSUER: ENTRA_ISSUER,
    APP_CONFIG_FILE: EMPTY_CONFIG,
    AWS_REGION: "us-east-1",
    DYNAMODB_ENDPOINT: process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000",
    DYNAMODB_TABLE_NAME: TEST_TABLE_NAME,
    LITELLM_SERVICE_KEY: SERVICE_KEY,
    LITELLM_ALLOWED_HOSTS: `127.0.0.1:${port}`,
  };
}

type Exit = { code: number | null; signal: string | null; out: string };

function runJob(port: number): {
  done: Promise<Exit>;
  signal: (s: NodeJS.Signals) => void;
} {
  const child = spawn("node", [BUNDLE], {
    cwd: ROOT,
    env: jobEnv(port),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d: Buffer) => (out += d.toString()));
  child.stderr.on("data", (d: Buffer) => (out += d.toString()));
  const done = new Promise<Exit>((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal, out }));
  });
  return { done, signal: (s) => child.kill(s) };
}

const lockItem = async () =>
  (
    await testDoc().send(
      new GetCommand({
        TableName: TEST_TABLE_NAME,
        Key: { PK: "LITELLM#USERSYNC", SK: "LOCK" },
      }),
    )
  ).Item;

const syncRecords = async () =>
  (await allItems()).filter(
    (i) => i.PK !== undefined && i.action === "litellm.user.sync",
  );

beforeAll(async () => {
  // Platform - Scheduled job: the bundle step (react-server condition, no alias).
  const build = spawnSync(
    "pnpm",
    ["--filter", "@llm-usage-lens/dashboard", "run", "build:jobs"],
    { cwd: ROOT, encoding: "utf8" },
  );
  expect(build.status, "build:jobs exit code").toBe(0);
  expect(existsSync(BUNDLE), "bundle written").toBe(true);
  fake = await startFake();
}, 120_000);

afterAll(async () => {
  if (!fake) return;
  for (const s of fake.sockets) s.destroy();
  await new Promise<void>((resolve) => fake.server.close(() => resolve()));
});

beforeEach(async () => {
  await clearTable();
  fake.calls.length = 0;
  fake.hangList = false;
  await seedConnection(fake.port);
});

describe("sync-litellm-users bundle", () => {
  it("runs under plain node against DynamoDB Local and the fake LiteLLM: exit 0, one litellm.user.sync summary with trigger schedule and actor system, no write call to LiteLLM (T-SY8, T-SY11, T-SY12; Platform - Scheduled job)", async () => {
    const { code, out } = await runJob(fake.port).done;

    expect(code, out).toBe(0);
    const records = await syncRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      actor: "system",
      after: { trigger: "schedule" },
    });
    expect(fake.calls.length).toBeGreaterThan(0);
    expect(nonReadCalls({ calls: fake.calls })).toEqual([]);
    expect(await lockItem()).toBeUndefined();
  }, 60_000);

  it("the last stdout line is one structured success line with the counts, no email and no secret (Platform - Exit and deadline; Rule 50.6)", async () => {
    const { code, out } = await runJob(fake.port).done;

    expect(code, out).toBe(0);
    const line = out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "")
      .at(-1);
    expect(() => JSON.parse(line ?? "")).not.toThrow();
    expect(line).toMatch(/applied/);
    expect(out).not.toContain(EMAIL);
    expect(out).not.toContain(SERVICE_KEY);
  }, 60_000);

  it("the operation switched off: exit 0 and a summary with skipped disabled, LiteLLM never called (T-SY8; Platform - Toggle and lease at run time)", async () => {
    await testDoc().send(
      new PutCommand({
        TableName: TEST_TABLE_NAME,
        Item: {
          PK: "LITELLM#CONFIG",
          SK: "TOGGLES",
          version: 1,
          toggles: { syncLiteLLMUsers: false },
          updatedAt: "2026-11-24T10:00:00.000Z",
        },
      }),
    );

    const { code, out } = await runJob(fake.port).done;

    expect(code, out).toBe(0);
    expect(fake.calls).toEqual([]);
    const [record] = await syncRecords();
    expect(record).toMatchObject({
      after: { trigger: "schedule", skipped: "disabled" },
    });
  }, 60_000);

  it("the lease held by another run: exit 0, summary skipped locked, the other lease untouched (T-SY8; Platform - Toggle and lease at run time)", async () => {
    await testDoc().send(
      new PutCommand({
        TableName: TEST_TABLE_NAME,
        Item: {
          PK: "LITELLM#USERSYNC",
          SK: "LOCK",
          owner: "another-run",
          leaseUntil: new Date(Date.now() + 3 * 60_000).toISOString(),
        },
      }),
    );

    const { code, out } = await runJob(fake.port).done;

    expect(code, out).toBe(0);
    expect(fake.calls).toEqual([]);
    const [record] = await syncRecords();
    expect(record).toMatchObject({ after: { skipped: "locked" } });
    expect(await lockItem()).toMatchObject({ owner: "another-run" });
  }, 60_000);

  it("a LiteLLM outage exits non-zero and leaves no lease (T-SY8: a failure exits non-zero; Platform - Exit and deadline)", async () => {
    await testDoc().send(
      new PutCommand({
        TableName: TEST_TABLE_NAME,
        Item: {
          PK: "LITELLM#CONFIG",
          SK: "CONNECTION",
          baseUrl: "http://127.0.0.1:1",
          version: 2,
          updatedAt: "2026-11-24T10:00:00.000Z",
        },
      }),
    );

    const { code } = await runJob(fake.port).done;

    expect(code).not.toBe(0);
    expect(await lockItem()).toBeUndefined();
  }, 60_000);

  it("SIGTERM during a run releases the lease and exits non-zero (T-SY8; Platform - Exit and deadline; V13)", async () => {
    fake.hangList = true;
    const job = runJob(fake.port);
    await fake.listRequested;
    const held = await lockItem();
    expect(held).toMatchObject({ owner: expect.any(String) });

    job.signal("SIGTERM");
    const { code, signal } = await job.done;

    expect(code !== 0 || signal !== null).toBe(true);
    expect(code).not.toBeNull();
    expect(await lockItem()).toBeUndefined();
    // Never a silent stop: the spec names no "aborted" value, so the summary
    // for the interrupted run says lost-lease (Access Control - LiteLLM user
    // sync, the summary's `skipped`), under the run id that held the lease.
    const records = await syncRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      actor: "system",
      after: {
        trigger: "schedule",
        skipped: "lost-lease",
        runId: held?.owner,
      },
    });
  }, 60_000);
});
