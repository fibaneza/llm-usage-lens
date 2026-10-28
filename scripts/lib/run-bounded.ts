// Runs `task` over `inputs` with at most `limit` in flight. Fail-fast: once any
// task rejects, no worker takes another input, and the original error rejects.
export async function runBounded<T>(
  inputs: readonly T[],
  limit: number,
  task: (input: T) => Promise<void>,
): Promise<void> {
  if (limit <= 0) {
    throw new RangeError(`limit must be positive, received ${limit}`);
  }
  const iterator = inputs.values();
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed) {
      const step = iterator.next();
      if (step.done) return;
      try {
        await task(step.value);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, inputs.length) }, worker),
  );
}
