import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(__dirname, "e2e-lock.mjs");
let base: string;
let lockDir: string;

const env = (extra: Record<string, string> = {}) => ({
  ...process.env,
  E2E_LOCK: "on",
  E2E_LOCK_DIR: lockDir,
  E2E_LOCK_POLL_MS: "50",
  ...extra,
});

const runLock = (args: string[], extra: Record<string, string> = {}) =>
  spawnSync("node", [SCRIPT, ...args], { env: env(extra), encoding: "utf8" });

const spawnLock = (args: string[], extra: Record<string, string> = {}) =>
  spawn("node", [SCRIPT, ...args], {
    env: env(extra),
    stdio: ["ignore", "pipe", "pipe"],
  });

const exited = (p: ReturnType<typeof spawn>) =>
  new Promise<number | null>((resolve) =>
    p.on("exit", (code) => resolve(code)),
  );

const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end)
    await new Promise((r) => setTimeout(r, 20));
  return cond();
};

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "e2e-lock-"));
  lockDir = join(base, "e2e-run.lock");
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe("e2e-lock", () => {
  it("holds the lock with owner.json while the command runs, then releases it", () => {
    const probe = `const fs=require("fs");const o=JSON.parse(fs.readFileSync(process.env.E2E_LOCK_DIR+"/owner.json","utf8"));process.exit(o.owner==="me"&&typeof o.pid==="number"&&o.startedAt?0:9)`;
    const r = runLock(["node", "-e", probe], { E2E_LOCK_OWNER: "me" });
    expect(r.status).toBe(0);
    expect(existsSync(lockDir)).toBe(false);
  });

  it("propagates the child's exit code and releases the lock on failure", () => {
    const r = runLock(["node", "-e", "process.exit(3)"]);
    expect(r.status).toBe(3);
    expect(existsSync(lockDir)).toBe(false);
  });

  it("makes a second acquirer wait until the first releases", async () => {
    const first = spawnLock(["node", "-e", "setTimeout(()=>{},700)"]);
    const firstExit = exited(first);
    expect(await until(() => existsSync(join(lockDir, "owner.json")))).toBe(
      true,
    );
    const second = spawnLock(["node", "-e", "process.exit(0)"]);
    let out = "";
    second.stdout?.on("data", (d) => (out += d));
    const started = Date.now();
    expect(await exited(second)).toBe(0);
    expect(Date.now() - started).toBeGreaterThan(300);
    expect(out).toContain("waiting for another e2e run");
    await firstExit;
    expect(existsSync(lockDir)).toBe(false);
  });

  it("takes over a stale lock whose owner pid is dead", () => {
    mkdirSync(lockDir);
    writeFileSync(
      join(lockDir, "owner.json"),
      JSON.stringify({
        pid: 2 ** 22 + 12345,
        startedAt: new Date().toISOString(),
      }),
    );
    const r = runLock(["node", "-e", "process.exit(0)"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("stale");
    expect(existsSync(lockDir)).toBe(false);
  });

  it("does not steal a live, fresh lock and exits 75 after the wait budget", () => {
    mkdirSync(lockDir);
    writeFileSync(
      join(lockDir, "owner.json"),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    const r = runLock(["node", "-e", "process.exit(0)"], {
      E2E_LOCK_WAIT_MIN: "0.005",
    });
    expect(r.status).toBe(75);
    expect(existsSync(join(lockDir, "owner.json"))).toBe(true);
  });

  it("runs without a lock when E2E_LOCK=off", () => {
    const r = runLock(["node", "-e", "process.exit(4)"], { E2E_LOCK: "off" });
    expect(r.status).toBe(4);
    expect(existsSync(lockDir)).toBe(false);
  });
});
