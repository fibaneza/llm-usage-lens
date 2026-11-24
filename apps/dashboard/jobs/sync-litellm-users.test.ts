// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { releaseUserSyncLease } from "@/lib/data/litellm/user-sync-lock";
import { currentRunId, runLiteLLMUserSync } from "@/lib/litellm-user-sync/run";
import { writeSyncSummary } from "@/lib/litellm-user-sync/summary";

import { runSyncJob } from "./sync-litellm-users";

// Source: docs/specs/2026-11-10-platform.md - "Scheduled job - LiteLLM user
// sync (unit SYNC2)" (what it calls, toggle and lease at run time, exit and
// deadline, V13); docs/specs/2026-11-10-access-control.md - "LiteLLM user
// sync" (the scheduled run, S17), tests T-SY8 (job, unit) and T-SY12 (the job
// calls the one function and adds no call).
//
// Assumed contract: the entry exports `runSyncJob(): Promise<number>` (the exit
// code) and importing the module has no side effect; the file's own entry
// point calls `process.exit(await runSyncJob())`. The domain function is mocked
// here; the bundled entry runs for real in sync-litellm-users.integration.test.ts.
vi.mock("@/lib/litellm-user-sync/run", () => ({
  runLiteLLMUserSync: vi.fn(),
  currentRunId: vi.fn(),
}));
vi.mock("@/lib/data/litellm/user-sync-lock", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/data/litellm/user-sync-lock")
  >()),
  releaseUserSyncLease: vi.fn(async () => undefined),
}));

vi.mock("@/lib/litellm-user-sync/summary", () => ({
  writeSyncSummary: vi.fn(async () => undefined),
}));
// A unit test never reaches DynamoDB (Rule 60.22: the data layer is proved
// against DynamoDB Local in integration tests); fail loudly if one does.
vi.mock("@/lib/dynamodb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dynamodb")>()),
  getDocumentClient: () => {
    throw new Error("unit test reached DynamoDB");
  },
}));

const run = vi.mocked(runLiteLLMUserSync);
const summary = vi.mocked(writeSyncSummary);
const currentId = vi.mocked(currentRunId);
const release = vi.mocked(releaseUserSyncLease);

// Platform - Toggle and lease at run time: a skipped run leaves one summary
// record with `skipped`; the stop path leaves the same record with `lost-lease`.
const lostLeaseSummary = (runId: string) =>
  [
    expect.objectContaining({ actor: "system", requestId: runId }),
    runId,
    "schedule",
    { skipped: "lost-lease" },
  ] as const;

const DEADLINE_MS = 10 * 60_000;
const SECRET = "sk-job-test-secret-123";
const EMAIL = "alice.example@corp.example";

let logged: string[] = [];

beforeEach(() => {
  logged = [];
  const capture = (...args: unknown[]) => {
    logged.push(args.map((a) => String(a)).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "info").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    capture(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    capture(chunk);
    return true;
  });
  vi.stubEnv("LITELLM_SERVICE_KEY", SECRET);
  vi.stubEnv("AUTH_SECRET", "job-test-auth-secret-456");
  release.mockImplementation(async () => undefined);
  run.mockReset();
  currentId.mockReset();
  currentId.mockReturnValue("run-held");
  release.mockClear();
  summary.mockReset();
  summary.mockImplementation(async () => undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

const output = () => logged.join("\n");

const success = {
  ok: true as const,
  value: {
    runId: "run-1",
    applied: 3,
    remaining: 0,
    plan: {
      planHash: "h",
      truncated: false,
      users: [
        { litellmUserId: "lu-1", email: EMAIL, outcome: "link-existing" },
      ],
      removals: [],
      memberships: [],
      drift: [],
      notPlaced: [],
      notes: [],
      counts: {
        toLink: 1,
        toPend: 0,
        alreadyLinked: 0,
        skipped: 0,
        memberships: 0,
      },
    },
  },
};

describe("sync-litellm-users job", () => {
  it("calls runLiteLLMUserSync once with actor system, trigger schedule, mode apply and nothing else (T-SY12; Platform - What it calls)", async () => {
    run.mockResolvedValue(success as never);

    await runSyncJob();

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({
      actor: "system",
      trigger: "schedule",
      mode: "apply",
    });
  });

  it("exits 0 on a successful run (T-SY8; Platform - Exit and deadline)", async () => {
    run.mockResolvedValue(success as never);
    expect(await runSyncJob()).toBe(0);
  });

  it.each(["disabled", "locked"] as const)(
    "the run skipped (%s): exit 0 (T-SY8 - toggle off and lease held skip with exit 0; Platform - Toggle and lease at run time)",
    async (skipped) => {
      run.mockResolvedValue({
        ok: true,
        value: { runId: "run-1", skipped },
      } as never);
      expect(await runSyncJob()).toBe(0);
    },
  );

  it("a thrown failure exits non-zero (T-SY8; Platform - Exit and deadline)", async () => {
    run.mockRejectedValue(new Error("LiteLLM unavailable"));
    expect(await runSyncJob()).not.toBe(0);
  });

  it("a truncated plan exits non-zero (T-SY8; Platform - What it calls, V1)", async () => {
    run.mockResolvedValue({ ok: false, code: "PLAN_TRUNCATED" });
    expect(await runSyncJob()).not.toBe(0);
  });

  it.each(["SYNC_RUNNING", "PLAN_CHANGED"] as const)(
    "a refused run (%s) exits non-zero (T-SY8; Platform - Exit and deadline: a failure exits non-zero)",
    async (code) => {
      run.mockResolvedValue({ ok: false, code });
      expect(await runSyncJob()).not.toBe(0);
    },
  );

  it("the 10-minute deadline releases the lease and exits non-zero (T-SY8; Platform - Exit and deadline; V13; lost-lease summary per Platform - Toggle and lease at run time)", async () => {
    vi.useFakeTimers();
    run.mockReturnValue(new Promise(() => undefined));
    let code: number | undefined;
    const job = runSyncJob().then((c) => {
      code = c;
    });

    await vi.advanceTimersByTimeAsync(DEADLINE_MS - 1);
    expect(code).toBeUndefined();
    expect(release).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await job;
    expect(code).toBeDefined();
    expect(code).not.toBe(0);
    expect(release).toHaveBeenCalledWith("run-held");
    expect(summary).toHaveBeenCalledTimes(1);
    expect(summary).toHaveBeenCalledWith(...lostLeaseSummary("run-held"));
  });

  it("SIGTERM releases the lease and exits non-zero (T-SY8; Platform - Exit and deadline; V13; lost-lease summary per Platform - Toggle and lease at run time)", async () => {
    vi.useFakeTimers();
    run.mockReturnValue(new Promise(() => undefined));
    const job = runSyncJob();
    await vi.advanceTimersByTimeAsync(0);

    process.emit("SIGTERM");

    expect(await job).not.toBe(0);
    expect(release).toHaveBeenCalledWith("run-held");
    expect(summary).toHaveBeenCalledTimes(1);
    expect(summary).toHaveBeenCalledWith(...lostLeaseSummary("run-held"));
  });

  it("the deadline with no run holding the lease does not release (currentRunId undefined; Platform - Scheduled job: release only what the run holds; no summary either)", async () => {
    vi.useFakeTimers();
    currentId.mockReturnValue(undefined);
    run.mockReturnValue(new Promise(() => undefined));
    let code: number | undefined;
    const job = runSyncJob().then((c) => {
      code = c;
    });

    await vi.advanceTimersByTimeAsync(DEADLINE_MS);
    await job;

    expect(code).not.toBe(0);
    expect(release).not.toHaveBeenCalled();
    expect(summary).not.toHaveBeenCalled();
  });

  it("SIGTERM with no run holding the lease does not release (currentRunId undefined; T-SY8)", async () => {
    vi.useFakeTimers();
    currentId.mockReturnValue(undefined);
    run.mockReturnValue(new Promise(() => undefined));
    const job = runSyncJob();
    await vi.advanceTimersByTimeAsync(0);

    process.emit("SIGTERM");

    expect(await job).not.toBe(0);
    expect(release).not.toHaveBeenCalled();
    expect(summary).not.toHaveBeenCalled();
  });

  it.each(["deadline", "sigterm"] as const)(
    "a failed lease release on %s logs stop_failed with the error name and code, never the message, a secret or an email (Rule 50.6; Access Control - Records)",
    async (reason) => {
      vi.useFakeTimers();
      const failure = Object.assign(
        new Error(`lease for ${EMAIL} refused with ${SECRET}`),
        { name: "ProvisionedThroughputExceededException", code: "ThrottlingX" },
      );
      release.mockRejectedValue(failure);
      run.mockReturnValue(new Promise(() => undefined));
      const job = runSyncJob();
      if (reason === "deadline") {
        await vi.advanceTimersByTimeAsync(DEADLINE_MS);
      } else {
        await vi.advanceTimersByTimeAsync(0);
        process.emit("SIGTERM");
      }
      expect(await job).not.toBe(0);

      const stopFailed = logged.filter((l) =>
        l.includes("litellm_user_sync.stop_failed"),
      );
      expect(stopFailed).toHaveLength(1);
      const text = stopFailed[0] as string;
      expect(text).toContain("ProvisionedThroughputExceededException");
      expect(text).toContain("ThrottlingX");
      expect(text).not.toContain("refused");
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(EMAIL);
      expect(output()).not.toContain(SECRET);
      expect(output()).not.toContain(EMAIL);
    },
  );

  it("the deadline and SIGTERM release the lease with the run's own id (currentRunId defined; Platform - Exit and deadline)", async () => {
    vi.useFakeTimers();
    currentId.mockReturnValue("run-held");
    run.mockReturnValue(new Promise(() => undefined));
    const job = runSyncJob();
    await vi.advanceTimersByTimeAsync(DEADLINE_MS);
    await job;
    expect(release).toHaveBeenCalledWith("run-held");

    release.mockClear();
    currentId.mockReturnValue("run-held-2");
    const second = runSyncJob();
    await vi.advanceTimersByTimeAsync(0);
    process.emit("SIGTERM");
    await second;
    expect(release).toHaveBeenCalledWith("run-held-2");
  });

  it("the success line carries the counts and no email (Platform - Exit and deadline: one fixed structured line with the counts; Access Control - Records)", async () => {
    run.mockResolvedValue(success as never);

    await runSyncJob();

    const text = output();
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain("@");
    const line = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "")
      .at(-1);
    expect(line).toBeDefined();
    expect(() => JSON.parse(line ?? "")).not.toThrow();
    expect(line).toMatch(/applied/);
    expect(line).toMatch(/3/);
  });

  it("logs nothing secret on success or on failure (Rule 50.6; Platform - Scheduled job)", async () => {
    run.mockResolvedValueOnce(success as never);
    await runSyncJob();
    run.mockRejectedValueOnce(new Error("LiteLLM unavailable"));
    await runSyncJob();

    const text = output();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("job-test-auth-secret-456");
    expect(text).not.toContain(EMAIL);
  });
});
