import type { FakeCall, FakeHandler } from "./fake-litellm";
import { viewsHandler } from "./fake-litellm-views";
import type { ViewsFakeOptions } from "./fake-litellm-views";

// Test-only canned LiteLLM daily-activity answers for the L6 combined suites
// (Rule 60.24: in-process, no network; not imported by production code).
// Shapes follow docs/litellm/openapi.json: results[].metrics.spend and
// results[].breakdown.providers[p].metrics.spend; /user/daily/activity pages
// by `page` / `page_size` and says so in metadata.has_more (LiteLLM spec -
// Combined usage -> LiteLLM reads used, LT34). Everything else is the L3
// views fake.

export type DailyRowFixture = {
  date: string;
  metrics: { spend: number };
  breakdown: {
    providers: Record<string, { metrics: { spend: number } }>;
  };
};

export const dailyRow = (
  spend: number,
  providers: Record<string, number> = {},
  date = "2026-10-02",
): DailyRowFixture => ({
  date,
  metrics: { spend },
  breakdown: {
    providers: Object.fromEntries(
      Object.entries(providers).map(([p, s]) => [p, { metrics: { spend: s } }]),
    ),
  },
});

export type CombinedFakeOptions = ViewsFakeOptions & {
  // Rows of GET /team/daily/activity/aggregated by the exact `team_ids` query
  // value; "*" answers any other value (default: no rows).
  teamDaily?: Record<string, DailyRowFixture[]>;
  // Pages of GET /user/daily/activity: page n answers userPages[n - 1], with
  // metadata.has_more true on every page but the last (default: one empty page).
  userPages?: DailyRowFixture[][];
  // Every page claims has_more (the 10-page cap, LT34).
  endlessUserPages?: boolean;
};

export function combinedHandler(opts: CombinedFakeOptions = {}): FakeHandler {
  const inner = viewsHandler(opts);
  return (call: FakeCall, attempt: number) => {
    if (opts.outage) return "network-error";
    const q = new URL(call.url).searchParams;
    const route = `${call.method} ${call.path}`;
    if (route === "GET /team/daily/activity/aggregated") {
      const rows =
        opts.teamDaily?.[q.get("team_ids") ?? q.get("team_id") ?? ""] ??
        opts.teamDaily?.["*"] ??
        [];
      return { status: 200, body: { results: rows, metadata: {} } };
    }
    if (route === "GET /user/daily/activity") {
      const page = Number(q.get("page") ?? "1");
      const pages = opts.userPages ?? [[]];
      const last = page >= pages.length;
      return {
        status: 200,
        body: {
          results:
            opts.endlessUserPages === true
              ? [dailyRow(1)]
              : (pages[page - 1] ?? []),
          metadata: {
            page,
            has_more: opts.endlessUserPages === true ? true : !last,
          },
        },
      };
    }
    return inner(call, attempt);
  };
}
