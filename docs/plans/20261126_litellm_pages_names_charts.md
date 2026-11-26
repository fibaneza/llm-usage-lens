# Run plan — the LiteLLM user and team pages: names in the breadcrumb, spend over time (unit LP3)

Written by the planner on 2026-11-26 for the coordinator and one worker
session. Package: `temp/planner/litellm-pages-charts/` (`plan.md`,
`spec-changes.md`, `brief-lp3.md`, `workflow-litellm_worker.md`). `main`
when written: `2e6c349d` (LP1, LP2 and OC1 landed; OC2 and FX2 in flight;
OC3 queued).

## 1. The ask (the user, 2026-11-26)

- In `/dashboard/manage/litellm/users/<id>`: "it should display the user
  alias or email next to LiteLLM users, not the id"; "Daily spend should be
  a timeline chart - similar to organization tab".
- In `/dashboard/manage/litellm/teams/<id>`: "it should display the team
  alias or email next to LiteLLM teams, not the id"; "include a daily spend
  timeline chart - similar to organization tab".

## 2. What exists

- Both pages render `PageHeader` with the breadcrumb "LiteLLM users › `<id>`"
  or "LiteLLM teams › `<id>`"
  (`components/litellm/proxy-user/ProxyUserPageContent.tsx`,
  `components/litellm/proxy-team/ProxyTeamPageContent.tsx`). The id is
  also in each page's Summary panel.
- The user page's one read, `GET /api/litellm/users/[litellmUserId]`
  (`LiteLLMUserDetailResponseSchema`), carries `email` (LiteLLM's
  `user_email`, or the id when LiteLLM has none) and `daily` rows of
  `date` and `spend`; `daily` is omitted while the Organisation cap hides
  per-user cost (LD23). It carries no alias: the gateway's `/user/info`
  schema does not read `user_alias`, which LiteLLM's user table has
  (`docs/litellm/openapi.json`, `LiteLLM_UserTable`).
- "Daily spend" on the user page is the table `DailySpend`
  (`ProxyUserDailyPanel.tsx`). The read behind it (`getUserDailySpend`,
  `reduceDaily`) also has requests and tokens per day; the route drops
  them.
- The team page's one read, `GET /api/litellm/proxy-teams/[litellmTeamId]`
  (`LiteLLMProxyTeamResponseSchema`), carries `alias` and no daily
  figures; it takes no date range. The page has no spend-by-day section.
  A LiteLLM team has no email.
- The Organisation tab's chart (OC1, with OC2's Bucket size switch) is
  `OrgSpendPanel` on `SpendTimelineChart`; OC2 exports the weekly grouping
  `weeklyBuckets` from `components/litellm/organisation/format.ts`.
- `getTeamDailySpend` (`/team/daily/activity/aggregated`) is an
  allowlisted read the Organisation route already uses per team.

## 3. Decisions

Agent decisions (2026-11-26, Rule 00.3) unless marked **user**.

| Id | Decision | Reason |
|---|---|---|
| D-P-1 | The last breadcrumb item of the LiteLLM user page is the user's **alias**, else the **email**, else the id (**user**) | The ask |
| D-P-2 | The last breadcrumb item of the LiteLLM team page is the team's **alias**, else the id (**user**) | The ask; a LiteLLM team has no email |
| D-P-3 | The name is resolved **on the server**, by the existence check the page already makes (`proxyUserExists`, `proxyTeamExists`: one `getUser` or `getTeam` call each): the check also returns the name, and the page passes it to the breadcrumb. The gateway's `/user/info` schema learns `user_alias`. No route's answer changes for this | No call added, no loading state, and the name is right on first paint |
| D-P-4 | Where the check makes no call (open access mode, LiteLLM not configured, the operation off) or the call fails, the item is the id, as today. A name is upstream text: rendered as text, on one line, truncated with the full value in `title`. The id stays in the Summary panel | The check's existing rules |
| D-P-5 | One shared panel, `SpendTimelinePanel`, titled "Spend over time", with the Organisation chart's switches except *Breakdown*: *Metric* (Spend, Tokens, Requests), *Bucket size* (Daily, Weekly), *View* (Chart, Table), kept in the URL (`metric`, `bucket`, `view`). One series in the primary token; every UTC day of the range on the axis; an option without data is disabled: "Not reported by LiteLLM" (**user**: "similar to organization tab") | One component for both pages; the same rules as OC1 and OC2 |
| D-P-6 | On the user page the panel replaces the "Daily spend" table; the table is its Table view. It stays absent while the cap hides per-user cost (**user**) | The ask; LD23 unchanged |
| D-P-7 | The user detail answer's `daily` rows gain optional `requests` and `tokens`, from the same read, under the same cap as the spend | The Metric switch needs them; no new visibility: the same callers already see that user's daily spend |
| D-P-8 | The team page gains the panel between Summary and Members (**user**) | The ask |
| D-P-9 | A new read route, `GET /api/litellm/proxy-teams/[litellmTeamId]/daily?dateFrom&dateTo`: the same roles and refusal order as the team read (`internal-admin`, `internal-org-admin`, `internal-auditor`; a Lead `403`); one LiteLLM call, `getTeamDailySpend`; rows of `date`, `spend`, `requests`, `tokens`; `daily` omitted under the cap, as the team read omits spend; LiteLLM not configured answers an empty list with no call (LD37); the operation off answers `403` before any call (LD19); the 90-day cap on the range | The team read has no range, and a failed daily read must not take the Summary down (Rule 40.4). The same roles already see each team's daily figures on the Organisation tab |
| D-P-10 | The new route makes no existence call: an unknown team id answers an empty list. The page itself is already the missing page for an unknown id | Its callers can list every team; a second call would only spend budget |
| D-P-11 | The panel reuses `SpendTimelineChart`, `weeklyBuckets` and the formatters of `organisation/format.ts` by import. `OrgSpendPanel` is not rebuilt on the shared panel in this unit | No copy (Rule 60); OC3 is editing `OrgSpendPanel` |
| D-P-12 | Not in this unit: usage tiles, a breakdown by model or by member, My usage and the app Team page | Not asked; the last two are what is left of Q-F-2 |

No open question.

## 4. Unit

| Unit | Title | Session | Worktree | Branch | Starts when | Review |
|---|---|---|---|---|---|---|
| LP3 | LiteLLM user and team pages: names in the breadcrumb, spend over time | `litellm_worker` | `lp3` | `feature/litellm-pages-names-charts` | OC2 on `main` | quality + spec-guardian + UI; security scope on the two routes (T-LP11, T-LP12) |

Start check: `git log --oneline main | grep -ci 'oc2'` is at least 1
(`weeklyBuckets` and the Bucket size switch come from OC2). The unit
applies its spec text in its first commit.

## 5. What it delivers

- `lib/litellm/operations.ts`: `user_alias` in the `/user/info` user
  schema.
- `lib/litellm/proxy-user-exists.ts`, `lib/litellm/proxy-team-exists.ts`:
  the answer also carries the name; `app/dashboard/manage/litellm/[tab]/[id]/page.tsx`
  passes it on.
- `packages/shared/src/schemas/litellm-views.ts`: the wider `daily` rows
  on the user detail answer; a new `LiteLLMProxyTeamDailyResponseSchema`.
- `app/api/litellm/users/[litellmUserId]/route.ts`: `requests` and
  `tokens` in `daily`.
- `app/api/litellm/proxy-teams/[litellmTeamId]/daily/route.ts` (new),
  registered in `test/route-registry.ts`.
- `components/litellm/SpendTimelinePanel.tsx` (new).
- `components/litellm/proxy-user/`: the breadcrumb name;
  `ProxyUserDailyPanel` on the shared panel.
- `components/litellm/proxy-team/`: the breadcrumb name; a new
  `ProxyTeamDailyPanel` with its own read hook, placed after Summary.

## 6. Ownership

Paths under `apps/dashboard/` unless they start with `packages/`.

| Unit | Owns |
|---|---|
| LP3 | `components/litellm/SpendTimelinePanel.tsx` and its test (new); `components/litellm/proxy-user/**`; `components/litellm/proxy-team/**`; `app/api/litellm/users/[litellmUserId]/route.ts` and its test (the `daily` lines only); `app/api/litellm/proxy-teams/[litellmTeamId]/daily/**` (new); `lib/litellm/operations.ts` (the `user_alias` field only); `lib/litellm/proxy-user-exists.ts`, `lib/litellm/proxy-team-exists.ts` and their tests; `app/dashboard/manage/litellm/[tab]/[id]/page.tsx` and its test; `e2e/litellm-user-page.spec.ts`; `e2e/litellm-team-page.spec.ts` |

| Declared overlap | Units | Rule |
|---|---|---|
| `components/litellm/organisation/format.ts`, `components/charts/SpendTimelineChart.tsx` | LP3, OC3 | LP3 imports them and edits neither. If the panel needs something they do not export, LP3 asks the coordinator instead of editing |
| `packages/shared/src/schemas/litellm-views.ts`, `test/route-registry.ts` | LP3, OC3 | Append-only (kind A) |
| The specs and implementation-phases | LP3 and units in flight | Append-only (kind A) |

`test/route-registry.ts` is test infrastructure and a shared schema
changes: the full Vitest runs once at the final commit. No e2e shared file
is touched: the targeted specs run once (`litellm-user-page`,
`litellm-team-page`, `litellm-users-tab`, `manage-litellm-teams`,
`litellm-a11y`).

## 7. Tests

Written into the spec text by the unit's first commit (spec-changes §2 and
§3); a test cites the spec section and id, never this plan.

| Id | Proves |
|---|---|
| T-LP11 | **Security.** The user detail route: `daily` rows carry `requests` and `tokens`; under the cap `daily` is absent with them; no LiteLLM call added; the role table unchanged |
| T-LP12 | **Security.** The team daily route: `200` for the three reading roles and `403` for a Lead and a member, before input parsing; registered in the route registry (the shared contract: `401`, `400`, `Cache-Control`); a range over 90 days is `400`; the operation off is `403` before any call; not configured is `200` with an empty list and no call; under the cap `daily` is absent; exactly one LiteLLM call; rows carry `date`, `spend`, `requests`, `tokens` and no key, key alias, user or member field |
| T-LP13 | The user page's breadcrumb: the alias, else the email, else the id; the id where the check makes no call or the call fails; one call as before; an unknown id is still the missing page; one line, truncated, the full value in `title` |
| T-LP14 | The team page's breadcrumb: the alias, else the id; the same no-call and failure cases |
| T-LP15 | `SpendTimelinePanel`: the three switches and their URL parameters; Weekly bars are the sums of their days and the total equals the daily total; an option without data is disabled with "Not reported by LiteLLM"; the Table view shows the same numbers; every UTC day of the range has a slot; the empty state |
| T-LP16 | The pages: on the user page the panel stands where the "Daily spend" table stood and is absent under the cap; on the team page it stands after Summary, is absent under the cap, and a failed daily read leaves Summary, Members and the link panel up |
| T-LP17 | E2E: both pages for the three reading roles: the breadcrumb name, the chart, Weekly by click; axe at 375px and desktop |

## 8. Orchestration

- 2 Red, 2 Green, 1 fix reserve = 5 agents, 2 at once, sonnet.
- Gate per `temp/planner/process/adopted-run-rules.md`; before `ready`,
  `temp/planner/mgmt-round2/review-lessons.md`.
- LP3 and OC3 may run at the same time (§6).

## 9. Guards and out of scope

- One new read route; no write, no gateway operation, no allowlist entry,
  no permission beyond the team read's.
- No key, key alias, member or per-user figure in the team daily answer.
- The cap (LD23) is unchanged: what it hides today stays hidden.
- `OrgSpendPanel`, `organisation/**`, `SpendTimelineChart.tsx` and
  `DailySpend.tsx` are not edited (`DailySpend` still serves My usage and
  the app Team page).
- Out of scope: D-P-12; `OrgSpendPanel` on the shared panel (a clean-up
  after OC3).

## 10. Completion and the `/goal` line

Complete when LP3 is on `main`, its Verify line in implementation-phases is
ticked with evidence, and CI is green.

- `litellm_worker`: `/goal LP3 of docs/plans/20261126_litellm_pages_names_charts.md is ready: at a green branch gate with its handover sent`
