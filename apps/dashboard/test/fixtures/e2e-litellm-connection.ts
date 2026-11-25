import type { Browser, BrowserContext } from "@playwright/test";

import {
  E2E_BASE_URL,
  E2E_LITELLM_BASE_URL,
} from "../../e2e/support/constants";
import { signInAsTestUser } from "../../e2e/support/session";
import { deleteStoredLiteLLMConnection } from "./e2e-litellm-connection-seed";
import { withLiteLLMStateLock } from "./e2e-litellm-state-lock";

// Test-only: stores the e2e fake LiteLLM connection for one run and restores
// the table as it found it, under the cross-worker state lock, so a case that
// needs the Users page to report LiteLLM configured does not depend on what an
// earlier spec left behind (Rule 60.24). Same contract as withLiteLLMReady in
// manage-user-page.spec.ts, without the toggle (syncLiteLLMUsers and
// createUser default on, LiteLLM spec - allowlist). The case signs itself in.
// The admin steps run in a fresh context closed afterwards, never the test's:
// a cookie swap on a context whose page may still have requests in flight
// flakes under CI=1 (the role switch), so the test's own context is untouched.
export async function withStoredLiteLLMConnection(
  browser: Browser,
  run: () => Promise<void>,
): Promise<void> {
  await withLiteLLMStateLock(async () => {
    const headers = { origin: E2E_BASE_URL };
    const asAdmin = async <T>(
      step: (context: BrowserContext) => Promise<T>,
    ): Promise<T> => {
      const context = await browser.newContext({ baseURL: E2E_BASE_URL });
      try {
        await signInAsTestUser(context, {
          roles: ["internal-admin"],
          authTime: Math.floor(Date.now() / 1000),
        });
        return await step(context);
      } finally {
        await context.close();
      }
    };
    const read = async (context: BrowserContext) => {
      const res = await context.request.get("/api/litellm/connection");
      if (!res.ok()) throw new Error(`reading the connection: ${res.status()}`);
      return (
        (await res.json()) as {
          data: { baseUrl: string | null; version: number };
        }
      ).data;
    };
    const put = async (
      context: BrowserContext,
      baseUrl: string,
      version: number,
    ) => {
      const res = await context.request.put("/api/litellm/connection", {
        headers,
        data: { baseUrl, version: version === 0 ? null : version },
      });
      if (!res.ok()) {
        throw new Error(
          `storing the connection: ${res.status()} ${await res.text()}`,
        );
      }
    };

    const before = await asAdmin(async (context) => {
      const seen = await read(context);
      if (seen.baseUrl !== E2E_LITELLM_BASE_URL) {
        await put(context, E2E_LITELLM_BASE_URL, seen.version);
      }
      return seen;
    });
    let failure: unknown;
    try {
      await run();
    } catch (error) {
      failure = error;
    }

    let restoreFailure: unknown;
    try {
      if (before.baseUrl === null) {
        await deleteStoredLiteLLMConnection();
      } else if (before.baseUrl !== E2E_LITELLM_BASE_URL) {
        const previous = before.baseUrl;
        await asAdmin(async (context) =>
          put(context, previous, (await read(context)).version),
        );
      }
    } catch (error) {
      restoreFailure = error;
    }
    if (failure !== undefined && restoreFailure !== undefined) {
      throw new AggregateError(
        [failure, restoreFailure],
        "the case failed and the restore also failed",
      );
    }
    if (failure !== undefined) throw failure;
    if (restoreFailure !== undefined) throw restoreFailure;
  });
}
