# Run plan — LiteLLM Organisation: spend as a timeline chart (unit OC1)

Written by the planner on 2026-11-26 for the coordinator and one worker
session. Package: `temp/planner/litellm-charts/` (`plan.md`,
`spec-changes.md`, `brief-oc1.md`, `workflow-improvements_worker.md`).
`main` when written: `717890b0` (UP1); LP1 and TP1 in review, LP2 queued
(`docs/plans/20261125_management_round3.md`).

## 1. The ask (the user, 2026-11-26, in their words)

"When i click on litellm organization and display a table of spends, i
prefer to display as a chart, timeline for example." — "Use Playwright and
litellm running on localhost:4000/ui for reference: charts, presentation,
options, user experience".

## 2. What exists

| Fact | Evidence |
|---|---|
| The Organisation tab shows one tile (Total spend), then the table "Daily spend by UTC day" (one row per day: 30 rows on the default range), then the LiteLLM teams table | `components/litellm/OrganisationSection.tsx`; `components/litellm/DailySpend.tsx` |
| The route already reads, per LiteLLM team and per UTC day, **spend, requests (total, successful, failed) and tokens**, and returns only the summed daily spend | `app/api/litellm/org/route.ts:106–135` (`rangeOf`, `byDate`); `lib/litellm/read-views.ts:300–325` (`DailyRow`) |
| The route answers only to the organisation-wide readers (`internal-admin`, `internal-org-admin`, `internal-auditor`); everyone else `403` | `app/api/litellm/org/route.ts:52–57` |
| A lazy bar chart for one daily series exists | `components/charts/DailyCostBarChart.tsx`, `LazyCharts.tsx` |
| A palette for team series exists: `--color-team-1` … `--color-team-8` | Design System — *Chart Colors (Per Team)*; `app/globals.css:87–94` |
| LiteLLM's contract returns per day `metrics` (spend, tokens, requests) and a `breakdown` by model, provider and key | `docs/litellm/openapi.json` 1.109.1: `DailySpendData`, `SpendMetrics`, `BreakdownMetrics` |

**The reference.** The LiteLLM UI at `localhost:4000/ui` asks for a
username and password. An agent does not type a password into another
product's sign-in, so the planner did not see its Usage page. LiteLLM's
public pages describe that page in words only (daily spend trends,
per-model, per-provider and per-key breakdowns, tiles for successful and
failed requests) and name no chart type. This plan therefore follows the
API contract above and this app's Design System. Section 9 says how the
comparison is done once the user has signed in.

In the running app on 2026-11-26 the tab showed "LiteLLM not configured"
(the local data had been reset by test runs), so the table is described
from the code.

## 3. Decisions

Agent decisions (2026-11-26, Rule 00.3) unless marked **user**.

| Id | Decision | Reason |
|---|---|---|
| D-OC-1 | The Organisation tab shows spend over time as a **bar chart, one bar per UTC day**, in place of the daily table (**user**: "display as a chart, timeline") | Daily buckets are discrete; the app's daily chart is already a bar chart |
| D-OC-2 | A **Chart / Table** switch keeps the table: same numbers, one click away | A chart alone is not readable by a screen reader or copyable; Rule 60.30 |
| D-OC-3 | **Breakdown: Total / By team.** By team stacks the LiteLLM teams: the seven largest in the range, then "Other teams" | The route has each team's days in memory; eight palette tokens exist |
| D-OC-4 | **Metric: Spend / Requests / Tokens**, from the figures the same LiteLLM answer already carries | "options" (the user); no extra LiteLLM call |
| D-OC-5 | Tiles above the chart: Total spend, Requests, Tokens, Average cost per request | The usual summary of a usage page; all computed from the same answer |
| D-OC-6 | The axis covers **every UTC day of the range**; a day LiteLLM reports nothing for has no bar | A timeline with gaps removed misleads |
| D-OC-7 | `GET /api/litellm/org` gains optional fields (per-day requests and tokens, range totals, `dailyByTeam`). No new route, no new gateway operation, no new LiteLLM call; the role check is unchanged | The data is already read; additive, so the other callers and every e2e stub keep parsing |
| D-OC-8 | The three choices are URL state (`nuqs`): `metric`, `by`, `view`; defaults are not written to the URL | Rule 40.5; a link reproduces the view |
| D-OC-9 | Colours: Total takes the primary token; team series take `--color-team-1…7` in order of size, "Other teams" takes `--color-team-8`. Never a model colour | Rule 40.2 |
| D-OC-10 | Only the Organisation tab in this unit. The other four places with the daily table (My usage, the Team page spend panel, the LiteLLM team and user pages) are a later unit, if the user wants it (Q-OC-2) | Rule 30.2; LP2 and TP1 own those files now |
| D-OC-11 | No breakdown by model in this unit (Q-OC-1) | LiteLLM's model names are not mapped to this app's canonical models yet (Rule 20.5); that needs a spec decision first |
| D-OC-12 | The unit applies its own spec text in its first commit; `spec-guardian` joins the review | One unit; no separate spec unit |

### Open questions (each keeps its default until answered)

| Id | Question | Default |
|---|---|---|
| Q-OC-1 | Also break the chart down by model? | Not now |
| Q-OC-2 | Use the same chart in the other four places that show the daily table? | Later, as a second unit, after LP2 lands |

## 4. The unit

| Unit | Title | Session | Worktree | Branch | Starts when | Review |
|---|---|---|---|---|---|---|
| OC1 | Organisation: spend timeline chart | `improvements_worker` | `oc1` | `feature/litellm-org-spend-chart` | LP1 on `main` | quality + spec-guardian + UI; security scope on the route's answer (T-OC1) |

Start check: `git log --oneline main | grep -ci 'lp1'` is 1. LP1 owns
`OrganisationSection.tsx` until it lands; OC1 builds on what LP1 leaves
(no App teams table; team names as links).

## 5. What OC1 delivers

- **Route** (`app/api/litellm/org/route.ts`): the answer also carries
  - `daily[]`: each day gains `requests` and `tokens`;
  - `totals`: gains `requests`, `tokens`, `failedRequests`;
  - `dailyByTeam[]`: `{ litellmTeamId, alias, daily: [{ date, spend,
    requests, tokens }] }`, one entry per LiteLLM team.
  All from the reads the route makes today. Not configured → empty lists.
- **Schema** (`packages/shared`): the new fields are optional, so an
  answer without them still parses.
- **Chart** (`components/charts/SpendTimelineChart.tsx`, lazy, in
  `ResponsiveContainer`): bars per UTC day over the whole range; stacked
  when it gets several series; tooltip with the day ("24 Nov, UTC"), each
  series' value and the day's total; `role="img"` with a label that names
  the metric, the range and the total; no animation under reduced motion.
- **Panel** (`components/litellm/organisation/OrgSpendPanel.tsx`): the
  heading "Spend over time", the three switches (Metric, Breakdown, View),
  the legend in By team, the chart or the table. An option whose data the
  answer does not carry is disabled and says why.
- **Tiles** (`components/litellm/organisation/OrgUsageTiles.tsx`): Total
  spend, Requests, Tokens, Average cost per request ("—" with no
  requests).
- **Organisation tab**: tiles, the panel, then the LiteLLM teams table.
  The "LiteLLM not configured", "No teams" and "LiteLLM unavailable"
  states are unchanged.
- 375px: the switches wrap, 44px targets, the chart keeps its height, no
  horizontal page scroll.

## 6. Ownership

Paths under `apps/dashboard/` unless they start with `packages/` or
`docs/`.

| Unit | Owns |
|---|---|
| OC1 | `components/charts/SpendTimelineChart.tsx` (new); `components/charts/LazyCharts.tsx` (one export); `components/charts/chart-data.ts` (a number formatter, if none fits); `components/litellm/organisation/**` (new); `components/litellm/OrganisationSection.tsx`; `app/api/litellm/org/route.ts`; `e2e/litellm-org-chart.spec.ts` (new) |

| Declared overlap | With | Rule |
|---|---|---|
| `components/litellm/OrganisationSection.tsx` and its test; the Organisation cases of `e2e/manage-litellm.spec.ts`, `e2e/litellm-a11y.spec.ts` | LP1 | OC1 starts after LP1 is on `main`; the e2e assertions on the daily table are "broken on purpose" (kind B) |
| `packages/shared/src/schemas/litellm-views.ts` and its test | LP2 (the user detail schema) | Append-only (kind A); either merge order |
| `components/teams/TeamsLiteLLMPanel.tsx`, `components/manage/users/LiteLLMUsersList.tsx` | read the same route | Not edited; the new fields are optional |
| the three specs and implementation-phases | LP2, TP1 | Append-only (kind A) |

E2E: no file on the shared list changes, so the targeted specs run once:
`litellm-org-chart`, `manage-litellm`, `litellm-a11y`.

## 7. Tests

Written into the spec text by the unit's first commit (spec-changes §2.3);
a test cites the spec section and id, never this plan.

| Id | Proves |
|---|---|
| T-OC1 | The route: per-day `requests` and `tokens`; range totals; for every day the sum of `dailyByTeam` equals `daily` (within 1e-6) and each team's days sum to its `spend`; no LiteLLM call is added (the call count on the fake equals the count before the change, for the same teams); the role table is unchanged (`401`; `403` for a lead and a member, before parsing); not configured → empty lists and no call |
| T-OC2 | The schema: an answer with the new fields and one without both parse; a negative or non-numeric figure does not |
| T-OC3 | The chart: one slot per UTC day of the range, a bar only for reported days; several series stack; colours come from tokens (no hex in the source); the `role="img"` label; the empty state; no animation under reduced motion |
| T-OC4 | The panel: defaults Spend, Total, Chart; each switch changes the view and the URL, and a URL with the three values restores it; By team shows seven teams and "Other teams" for nine; the Table view shows the same numbers; an option without data is disabled with its reason |
| T-OC5 | The tiles: the four figures; "—" for the average with no requests |
| T-OC6 | The tab: no daily table by default; tiles, panel and the teams table in that order; the three states unchanged |
| T-OC7 | E2E for `internal-admin`, `internal-org-admin` and `internal-auditor`: the chart is shown; By team and Table by click; axe clean at 375px and desktop in both views; no horizontal page scroll at 375px |

## 8. Orchestration

- One workflow (`workflow-improvements_worker.md`), with the user's opt-in.
  Agents: 2 Red, 2 Green, 1 fix reserve = 5; 2 at once; sonnet.
- Gate per `temp/planner/process/adopted-run-rules.md`; before `ready`,
  `temp/planner/mgmt-round2/review-lessons.md`.
- Merge order: after LP1; before or after LP2 and TP1.

## 9. The comparison with the LiteLLM UI

The user signs in at `localhost:4000/ui` in the browser the planner drives
(or says which choices of LiteLLM's Usage page they want copied). The
planner then reads the page, lists what differs from §3 and §5 (chart
type, tooltip, tiles, options) and revises this plan and the brief before
OC1 starts. OC1 waits for LP1 in any case, so this costs no time. Without
it, OC1 builds this plan as written.

## 10. Guards and out of scope

- No new route, gateway operation, LiteLLM call or write.
- The route's roles are not changed; no figure goes to a lead or a member.
- No key, key alias or per-user figure in the new fields.
- No raw hex; no model colour for a team; the chart is lazy-loaded.
- Out of scope: by model, by provider, by key; export; the other pages'
  daily tables; changing `DailySpend.tsx` (four other places use it).

## 11. Completion and the `/goal` line

Complete when OC1 is on `main`, its Verify line in implementation-phases
is ticked with evidence, and CI is green on the push.

- `improvements_worker`: `/goal OC1 of docs/plans/20261126_litellm_spend_charts.md is ready: at a green branch gate with its handover sent`
