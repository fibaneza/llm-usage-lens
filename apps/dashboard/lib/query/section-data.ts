import type {
  UseInfiniteQueryResult,
  UseQueryResult,
} from "@tanstack/react-query";

// Bridge between `useQuery` and `SectionBoundary` (Rule 40.4, 60.12): returns
// the data once loaded, `undefined` while it is pending, and throws a failed
// query's error so the section's own boundary shows its alert and Retry. Unlike
// `useSuspenseQuery` it never runs `queryFn` during SSR, where the relative
// `/api/*` fetch would fail. A background refetch error with data in hand keeps
// the stale data on screen.
export function sectionData<T>(
  query: UseQueryResult<T> | UseInfiniteQueryResult<T>,
): T | undefined {
  if (query.data !== undefined) return query.data;
  if (query.isError && !query.isFetching) throw query.error;
  return undefined;
}
