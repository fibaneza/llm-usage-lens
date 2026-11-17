import "server-only";

import { runBounded } from "@llm-usage-lens/shared";

// runBounded that never answers while a task is still running: on the first
// failure no task starts another read (`stopped()` turns true), the tasks
// already in flight settle, and then the first error is rethrown. A request
// must not leave LiteLLM calls running after it responds (LiteLLM spec LD34).
export async function runBoundedSettled<T>(
  inputs: readonly T[],
  limit: number,
  task: (input: T, stopped: () => boolean) => Promise<void>,
): Promise<void> {
  const run: { failure: { error: unknown } | null } = { failure: null };
  const stopped = () => run.failure !== null;
  await runBounded(inputs, limit, async (input) => {
    if (stopped()) return;
    try {
      await task(input, stopped);
    } catch (error) {
      run.failure ??= { error };
    }
  });
  if (run.failure) throw run.failure.error;
}
