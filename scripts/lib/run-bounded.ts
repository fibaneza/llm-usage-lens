// Runs `task` over `inputs` with at most `limit` in flight; rejects on the
// first failure.
export async function runBounded<T>(
  inputs: readonly T[],
  limit: number,
  task: (input: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < inputs.length) {
      const input = inputs[next];
      next += 1;
      await task(input as T);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, inputs.length) }, worker),
  );
}
