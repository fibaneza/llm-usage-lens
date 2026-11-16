#!/usr/bin/env node
// Cross-worktree semaphore for `pnpm test:e2e`: concurrent runs share the dev
// servers (3211 app on table bedrock-usage, 3213 role-probe on table
// bedrock-usage-probe-r5; 3212 is the fake LiteLLM) and DynamoDB Local, so they
// must take turns. The lock wraps the whole `playwright test` command, both
// projects included, so the probe server never runs outside it. Dev tooling,
// so it reads process.env directly (Rule 50.2).
import { execFileSync, spawn } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const command = process.argv.slice(2);
if (command.length === 0) {
  process.stderr.write("usage: e2e-lock.mjs <command...>\n");
  process.exit(2);
}

const env = process.env;
const run = (cmd, args) => spawn(cmd, args, { stdio: "inherit" });

if (env.E2E_LOCK === "off") {
  const child = run(command[0], command.slice(1));
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 128 : 1)));
  child.on("error", (err) => {
    process.stderr.write(`e2e-lock: ${err.message}\n`);
    process.exit(127);
  });
} else {
  await main();
}

function git(...args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function numEnv(name, fallback) {
  const n = Number(env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function readOwner(lockDir) {
  try {
    return JSON.parse(readFileSync(join(lockDir, "owner.json"), "utf8"));
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== "ESRCH";
  }
}

function staleReason(lockDir, staleMs) {
  const owner = readOwner(lockDir);
  if (owner && typeof owner.pid === "number" && !pidAlive(owner.pid)) {
    return `owner pid ${owner.pid} is not running`;
  }
  let startedMs;
  if (owner && owner.startedAt) startedMs = Date.parse(owner.startedAt);
  if (startedMs === undefined || Number.isNaN(startedMs)) {
    try {
      startedMs = statSync(lockDir).mtimeMs;
    } catch {
      return "lock vanished";
    }
  }
  if (Date.now() - startedMs > staleMs)
    return `older than ${Math.round(staleMs / 60000)} min`;
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const lockDir =
    env.E2E_LOCK_DIR ??
    join(
      git("rev-parse", "--path-format=absolute", "--git-common-dir"),
      "e2e-run.lock",
    );
  const pollMs = numEnv("E2E_LOCK_POLL_MS", 15_000);
  const staleMs = numEnv("E2E_LOCK_STALE_MIN", 45) * 60_000;
  const waitMs = numEnv("E2E_LOCK_WAIT_MIN", 60) * 60_000;
  const waitStart = Date.now();
  let announced = false;
  let owned = false;
  let child = null;

  const release = () => {
    if (!owned) return;
    owned = false;
    const owner = readOwner(lockDir);
    if (owner && owner.pid !== process.pid) return;
    rmSync(join(lockDir, "owner.json"), { force: true });
    try {
      rmdirSync(lockDir);
    } catch {
      // directory already gone or not empty; nothing more to release
    }
  };
  process.on("exit", release);
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      if (child) child.kill(sig);
      else {
        release();
        process.exit(128 + (sig === "SIGINT" ? 2 : 15));
      }
    });
  }

  for (;;) {
    try {
      mkdirSync(lockDir);
      owned = true;
      writeFileSync(
        join(lockDir, "owner.json"),
        JSON.stringify({
          pid: process.pid,
          worktree: git("rev-parse", "--show-toplevel"),
          branch: git("rev-parse", "--abbrev-ref", "HEAD"),
          startedAt: new Date().toISOString(),
          owner: env.E2E_LOCK_OWNER,
        }),
      );
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
    const reason = staleReason(lockDir, staleMs);
    if (reason) {
      process.stderr.write(`e2e-lock: taking over stale lock (${reason})\n`);
      // rename is atomic, so only one concurrent stealer wins
      const graveyard = `${lockDir}.stale-${process.pid}`;
      try {
        renameSync(lockDir, graveyard);
        rmSync(graveyard, { recursive: true, force: true });
      } catch {
        // another process took it first; loop and retry
      }
      continue;
    }
    if (Date.now() - waitStart >= waitMs) {
      process.stderr.write(
        `e2e-lock: gave up after ${Math.round(waitMs / 60000)} min waiting for ${lockDir}\n`,
      );
      process.exit(75);
    }
    if (!announced) {
      announced = true;
      const o = readOwner(lockDir);
      const who = o
        ? `${o.owner ? `${o.owner} ` : ""}pid ${o.pid}, ${o.branch} @ ${o.worktree}, since ${o.startedAt}`
        : "unknown holder";
      process.stdout.write(`e2e-lock: waiting for another e2e run (${who})\n`);
    }
    await sleep(pollMs);
  }

  child = run(command[0], command.slice(1));
  const code = await new Promise((resolve) => {
    child.on("error", (err) => {
      process.stderr.write(`e2e-lock: ${err.message}\n`);
      resolve(127);
    });
    child.on("exit", (c, signal) =>
      resolve(c ?? (signal === "SIGINT" ? 130 : 143)),
    );
  });
  release();
  process.exit(code);
}
