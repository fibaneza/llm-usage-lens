// Test-only stand-ins for `next/cache`. The real `unstable_cache` and
// `revalidateTag` throw outside a Next.js request, so tests mock the module:
//  - `passThroughNextCache`: no caching (integration tests that clear the
//    table between cases).
//  - `fakeNextCache`: an in-memory memoizing cache keyed by keyParts + call
//    args, with tag invalidation, plus recorders for assertions.
// Not imported by production code.
type CacheOptions = { revalidate?: number | false; tags?: string[] };
type AnyFn = (...args: never[]) => Promise<unknown>;
type LooseFn = (...args: unknown[]) => Promise<unknown>;

export const passThroughNextCache = {
  unstable_cache: <F extends AnyFn>(fn: F): F => fn,
  revalidateTag: (): void => {},
  revalidatePath: (): void => {},
  updateTag: (): void => {},
};

const store = new Map<string, { value: unknown; tags: string[] }>();

export const cacheRegistrations: {
  keyParts: string[];
  options: CacheOptions;
}[] = [];
export const revalidatedTags: string[] = [];
export const revalidations: { tag: string; profile: unknown }[] = [];

// Next 16 refuses to cache a single unstable_cache entry above 2 MB (not
// cached under `next start`, E1003 under `next dev`). The fake mirrors the
// "not cached" outcome and records the offender so tests can assert none.
export const MAX_CACHE_ENTRY_BYTES = 2 * 1024 * 1024;
export const cacheEntrySizes: { keyParts: string[]; bytes: number }[] = [];
export const oversizedEntries: { keyParts: string[]; bytes: number }[] = [];

export function resetFakeCache(): void {
  store.clear();
  revalidatedTags.length = 0;
  revalidations.length = 0;
  cacheEntrySizes.length = 0;
  oversizedEntries.length = 0;
}

function invalidate(tag: string, profile?: unknown): void {
  revalidatedTags.push(tag);
  revalidations.push({ tag, profile });
  for (const [key, entry] of store) {
    if (entry.tags.includes(tag)) store.delete(key);
  }
}

export const fakeNextCache = {
  unstable_cache: <F extends AnyFn>(
    fn: F,
    keyParts: string[] = [],
    options: CacheOptions = {},
  ): F => {
    cacheRegistrations.push({ keyParts, options });
    const cached = async (...args: unknown[]) => {
      const key = JSON.stringify([keyParts, args]);
      const hit = store.get(key);
      if (hit) return hit.value;
      const value = await (fn as unknown as LooseFn)(...args);
      const bytes = Buffer.byteLength(JSON.stringify(value) ?? "");
      cacheEntrySizes.push({ keyParts, bytes });
      if (bytes > MAX_CACHE_ENTRY_BYTES) {
        oversizedEntries.push({ keyParts, bytes });
        return value;
      }
      store.set(key, { value, tags: options.tags ?? [] });
      return value;
    };
    return cached as unknown as F;
  },
  revalidateTag: (tag: string, profile?: unknown): void =>
    invalidate(tag, profile),
  updateTag: (tag: string): void => invalidate(tag),
  revalidatePath: (): void => {},
};
