import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Test-only: a cross-worker mutex for the e2e specs that change or depend on
// the one stored LiteLLM connection / toggle (reset-spend-users,
// manage-users-links, dev-login). Playwright runs spec files on parallel
// workers (`fullyParallel`), and `describe.configure({ mode: "serial" })` only
// orders tests inside one file, so a spec that stores the connection and
// restores it ("not configured" again) could pull the state out from under a
// spec running at the same time (RS1 review U-W1). The lock is a directory
// created with `mkdir` (atomic) under the OS temp dir; one run's workers share
// it. A lock whose owner process is gone, or that is older than STALE_MS, is
// taken over. Lives under test/ (not e2e/support) so it adds no shared e2e file.
const STALE_MS = 5 * 60_000;
const DEFAULT_DIR = join(tmpdir(), "llm-usage-lens-e2e-litellm-state.lock");

type Options = { dir?: string; timeoutMs?: number; pollMs?: number };

function ownerAlive(pid: unknown): boolean {
  if (typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function isStale(dir: string): boolean {
  let ageMs: number;
  try {
    ageMs = Date.now() - statSync(dir).mtimeMs;
  } catch {
    return true;
  }
  if (ageMs > STALE_MS) return true;
  try {
    const owner = JSON.parse(readFileSync(join(dir, "owner.json"), "utf8")) as {
      pid?: unknown;
    };
    return !ownerAlive(owner.pid);
  } catch {
    // The owner file is written right after mkdir; give it a moment.
    return ageMs > 5_000;
  }
}

async function acquire(opts: Required<Options>): Promise<() => void> {
  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    try {
      mkdirSync(opts.dir);
      writeFileSync(
        join(opts.dir, "owner.json"),
        JSON.stringify({ pid: process.pid }),
      );
      return () => rmSync(opts.dir, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (isStale(opts.dir)) {
      rmSync(opts.dir, { recursive: true, force: true });
      continue;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for the LiteLLM e2e state lock`);
    }
    await new Promise((resolve) => setTimeout(resolve, opts.pollMs));
  }
}

export async function withLiteLLMStateLock<T>(
  run: () => Promise<T>,
  options: Options = {},
): Promise<T> {
  const release = await acquire({
    dir: options.dir ?? DEFAULT_DIR,
    timeoutMs: options.timeoutMs ?? 45_000,
    pollMs: options.pollMs ?? 50,
  });
  try {
    return await run();
  } finally {
    release();
  }
}
