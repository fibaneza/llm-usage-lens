"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

// `false` on the server and during hydration, `true` once the client has
// committed. Lets a component that reads a query already filled by another
// subscriber (e.g. the header sync badge) match the server HTML on its first
// render instead of hydrating with data the server never had.
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
