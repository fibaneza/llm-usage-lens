# Run plan — round 3 follow-ups: LiteLLM usage parity on Organisation (OC2), three small UI fixes (FX2)

Written by the planner on 2026-11-26 for the coordinator and two worker
sessions. Package: `temp/planner/round3-followups/` (`plan.md`,
`spec-changes.md`, `brief-oc2.md`, `brief-fx2.md`,
`workflow-improvements_worker.md`, `workflow-bedrock_worker.md`). `main`
when written: `0ec2d88c` (TP1); OC1 in review, LP2 in flight.

## 1. The ask (the user, 2026-11-26)

1. "Use Playwright and litellm running on localhost:4000/ui for reference:
   charts, presentation, options, user experience" — the user signed in
   to LiteLLM, so the comparison that `20261126_litellm_spend_charts.md`
   §9 left open is now done (§2).
2. "the role field in the sign in page there is an arrow that looks off on
   screen, need to be fixed".
3. On Settings → LiteLLM → Connection, with `http://localhost:4000` in the
   field and "No LiteLLM base URL is saved." beside *Test connection*:
   "this browser can't connect to litellm".
4. On the organisation line under "LLM Usage Lens" in the sidebar: "no need
   that text".

## 2. What LiteLLM's Usage page shows (v1.109.1, read in the browser)

The local LiteLLM had no usage in the range, so the charts were empty: the
structure and the options below are read from the page; the drawn chart
type is not.

| Part | LiteLLM | This app after OC1 |
|---|---|---|
| Tiles | Spend; Total Requests with "n ok · n failed"; Total Tokens; Avg cost / request. The team view: Total Spend, Total Requests, Successful Requests, Failed Requests, Total Tokens | Total spend, Requests, Tokens, Average cost per request. **No ok / failed** |
| Main chart | "Daily usage — Daily spend by model (top 8, rest grouped as Other)"; a one-line subtitle says what is drawn | "Spend over time"; total, or stacked by team (7 + Other). **No subtitle. No by-model** |
| Metric | Spend, Tokens, Requests (that order) | Spend, Requests, Tokens |
| Bucket size | Daily, Weekly | **Daily only** |
| Scale | Linear, Log | Linear only |
| View | "Table View / Chart View" on its ranked lists | Chart / Table on the main chart |
| Per-team table | "Spend Per Team": Team, **Share**, Spend, Successful, Failed, Tokens | Alias, Spend, Budget, Members, App team |
| Share | "Copy Share Link" | The switches are in the URL |
| Other panels | Top models, Top agents, Spend by Provider, Top Virtual Keys, Top Users by Spend, Spend Per User Within Team, Export Data, an assistant | Not shown |

## 3. The select arrow

On the sign-in page the Role field is a native `<select>` with the
browser's own arrow, which sits against the right border and ignores the
field's padding (`components/auth/SignInOptions.tsx:290`, `FIELD_CLASS`).
Seen in the running app at `/sign-in`. Every native select of the app has
the same arrow: the two `NativeSelect` components
(`components/settings/access/form-controls.tsx`,
`components/litellm/team/native-select.tsx`, used by more than ten forms) and
`components/table/CardSortControl.tsx`.

## 3a. The connection test

Settings → LiteLLM → Connection fills the Base URL field with the offered
default (`LLM_LENS_LITELLM_BASE_URL`, `http://localhost:4000`) when nothing
is saved (LiteLLM spec — *Security architecture* item 7, unit ST1). *Test
connection* sends an empty body, so it tests only the **saved** URL and
answers "No LiteLLM base URL is saved." although a URL is on screen
(`components/settings/litellm-panel/LiteLLMConnectionSection.tsx`, the
`test` mutation). The route already tests a URL from the body without
saving it (`app/api/litellm/connection/test/route.ts`, `baseUrl`, checked
against `LITELLM_ALLOWED_HOSTS`); the panel never sends one. *Save* tests
the URL and stores it only on success, so today the way through is *Save*.

## 3b. The sidebar brand line

`components/layout/AppSidebar.tsx` shows the organisation name under the
product name (`display.orgName` in `config.yaml` > the deprecated
`NEXT_PUBLIC_ORG_NAME` > "Organization"). It is read nowhere else
(`app/dashboard/layout.tsx:86`).

## 4. Decisions

Agent decisions (2026-11-26, Rule 00.3) unless marked **user**.

| Id | Decision | Reason |
|---|---|---|
| D-F-1 | Metric order becomes Spend, Tokens, Requests | As the reference |
| D-F-2 | **Bucket size: Daily / Weekly.** A week is Monday to Sunday in UTC; the first and last bar may be a part week and say so. Computed in the browser from the daily rows. URL: `bucket` | As the reference; 90 daily bars are hard to read |
| D-F-3 | **No log scale** | Stacked bars on a log axis misstate the parts, and a day with no spend cannot be drawn |
| D-F-4 | The Requests tile shows "n ok · n failed" beneath the figure | As the reference; the route already has both |
| D-F-5 | The chart panel gets a one-line subtitle that says what is drawn, for example "Daily spend by team, 7 largest stacked" | As the reference |
| D-F-6 | The LiteLLM teams table gains **Share** (of the total spend, with a thin bar), **Requests** and **Tokens**. Requests and Tokens are hidden below `lg` | "Spend Per Team" in the reference; the route has the figures per team |
| D-F-7 | Not copied: by provider, by key, by agent, by endpoint, top users, per-user-within-team, export, the assistant | Keys and per-user figures have their own pages and visibility rules here; the rest was not asked for |
| D-F-8 | By model stays a question (Q-F-1), now with a concrete proposal | LiteLLM's main chart is by model, but the shared normaliser matches Bedrock ids only (`anthropic.claude-…`); LiteLLM's names (`claude-haiku-4-5`, `bedrock/…`) would all fall into "Other" until `packages/shared/src/models.ts` learns them |
| D-F-9 | One `NativeSelect` in `components/ui/native-select.tsx`: `appearance-none`, a Lucide `ChevronDown` 12px from the right edge, right padding so the text never runs under it. Every native select of the app uses it (**user**: "need to be fixed") | One arrow, drawn by the app, the same in every browser; Rule 40.8 |
| D-F-10 | The two existing `NativeSelect` files keep their exports and render the new one, so the forms that import them are not edited | Fewest files changed |
| D-F-11 | *Test connection* tests **the URL in the field** (sent as `baseUrl`; an empty field tests the saved one, as today). While the field differs from the saved URL, or nothing is saved, a note under the field says "Not saved yet. Save tests this URL and stores it.", and an ok test of such a URL reads "ok, not saved yet" (**user**: "this browser can't connect to litellm") | The route already allows it, with the same host check; no new capability |
| D-F-12 | The sidebar brand shows the mark and "LLM Usage Lens" only; no organisation line (**user**: "no need that text") | The user's words |
| D-F-13 | `display.orgName` and `NEXT_PUBLIC_ORG_NAME` stay **accepted and ignored**: a config file or environment that still sets them loads as before. The resolver and the prop are removed (no dead code) | Refusing a deployed config file is a production matter (Q-F-3) |

### Open questions (each keeps its default until answered)

| Id | Question | Default |
|---|---|---|
| Q-F-1 | Break the chart down by model, as LiteLLM does? It needs the shared model normaliser to learn LiteLLM's model names, as its own unit (OC3) | Not now |
| Q-F-2 | (was Q-OC-2) The same chart in the four other places with the daily table? | Later |
| Q-F-3 | Remove `display.orgName` from the config file's schema too? A config file that still sets it would then be refused at start | Keep it accepted and ignored |

## 5. Units

| Unit | Title | Session | Worktree | Branch | Starts when | Review |
|---|---|---|---|---|---|---|
| OC2 | Organisation: weekly buckets, ok / failed, share and usage per team | `improvements_worker` | `oc2` | `feature/litellm-org-usage-parity` | OC1 on `main` | quality + spec-guardian + UI; security scope on the route's answer |
| FX2 | Three small UI fixes: the select arrow, the connection test, the sidebar brand line | `bedrock_worker` | `fx2` | `fix/round3-ui-fixes` | now | quality + spec-guardian + UI |

Start checks: `git log --oneline main | grep -ci 'oc1'` is 1 (OC2). FX2
has none. Both apply their own spec text in their first commit.

## 6. What each unit delivers

### OC2

- Route (`app/api/litellm/org/route.ts`): `totals.successfulRequests`;
  per LiteLLM team `requests` and `tokens` in `litellmTeams[]`. From the
  reads the route already makes; optional in the schema.
- `OrgSpendPanel.tsx`: the metric order; the Bucket size switch (`bucket`
  in the URL, default `daily` not written); the subtitle; weekly bars
  labelled by their first day ("Week of 17 Nov"), a part week marked in
  the tooltip and in the table view.
- `OrgUsageTiles.tsx`: "n ok · n failed" under Requests (absent when the
  answer carries no split).
- `OrganisationSection.tsx`: Share, Requests, Tokens in the LiteLLM teams
  table and on the mobile cards.

### FX2

- `components/ui/native-select.tsx` (new, the shadcn `native-select`
  pattern): a wrapper, the select with `appearance-none`, the chevron
  (`pointer-events-none`, `aria-hidden`), disabled and invalid states, the
  density tokens.
- `SignInOptions.tsx` (the Role field), `CardSortControl.tsx`, and the two
  existing `NativeSelect` files use it.
- `LiteLLMConnectionSection.tsx`: the field's value is lifted so that
  *Test connection* sends it; the "Not saved yet" note; the "ok, not saved
  yet" result. The routes are not edited.
- `AppSidebar.tsx`: the organisation line and the `orgName` prop go;
  `app/dashboard/layout.tsx` no longer resolves it; `resolveOrgName` and
  its tests go; the config schema keeps the key (D-F-13).

## 7. Ownership

Paths under `apps/dashboard/`.

| Unit | Owns |
|---|---|
| OC2 | `components/litellm/organisation/**`; `components/litellm/OrganisationSection.tsx`; `app/api/litellm/org/route.ts`; `e2e/litellm-org-chart.spec.ts` |
| FX2 | `components/ui/native-select.tsx` (new); `components/auth/SignInOptions.tsx` (the Role field only); `components/table/CardSortControl.tsx`; `components/settings/access/form-controls.tsx` (`NativeSelect` only); `components/litellm/team/native-select.tsx`; `e2e/sign-in-form.spec.ts` (one case); `components/settings/litellm-panel/LiteLLMConnectionSection.tsx` and its test; `components/layout/AppSidebar.tsx` and its test (the brand block and the `orgName` prop only); `app/dashboard/layout.tsx` (the `orgName` lines only); `lib/config/resolvers.ts` and its test (`resolveOrgName` only); `e2e/config-file.spec.ts` (the organisation-name case only) |

| Declared overlap | Units | Rule |
|---|---|---|
| Every file of OC2's row | OC1 (in review) | OC2 starts after OC1 is on `main` |
| `packages/shared/src/schemas/litellm-views.ts` | OC2, LP2 | Append-only (kind A) |
| The specs and implementation-phases | OC2, FX2, LP2 | Append-only (kind A) |

FX2 adds a file under `components/ui/**` and edits `components/layout/**`
and `app/dashboard/layout.tsx`, all on the e2e shared list: it runs the
**full** e2e once at its gate. OC2 runs its targeted specs once:
`litellm-org-chart`, `manage-litellm`, `litellm-a11y`.

## 8. Tests

Written into the spec text by each unit's first commit (spec-changes §2);
a test cites the spec section and id, never this plan.

| Unit | Id | Proves |
|---|---|---|
| OC2 | T-OC8 | The route: `totals.successfulRequests`, and per team `requests` and `tokens` that equal the sums of that team's days; no LiteLLM call added; the role table unchanged |
| OC2 | T-OC9 | Weekly: bars are Monday-to-Sunday UTC weeks whose values are the sums of their days; a part week is marked; the total equals the daily total; `bucket` in the URL restores it |
| OC2 | T-OC10 | The metric order; the subtitle for each metric, breakdown and bucket |
| OC2 | T-OC11 | The Requests tile's "n ok · n failed"; absent without the split |
| OC2 | T-OC12 | The teams table: Share sums to 100 % within rounding and is "—" with no spend; Requests and Tokens per team; hidden below `lg`; the cards at 375px |
| OC2 | T-OC13 | E2E: Weekly by click for the three reading roles; axe at 375px and desktop |
| FX2 | T-FX6 | `NativeSelect`: the browser arrow is off (`appearance-none`), one chevron inside the field, text padding on the right, the accessible name and keyboard behaviour unchanged, disabled and invalid states |
| FX2 | T-FX7 | The sign-in Role field, the card sort control and both existing `NativeSelect` exports render it; no bare `<select>` is left under `components/**` (structural) |
| FX2 | T-FX8 | E2E: the sign-in page at 375px and desktop, axe clean; the chevron's box lies inside the select's box with at least 8px to the right edge |
| FX2 | T-FX9 | *Test connection* sends the field's URL as `baseUrl`; an empty field sends no `baseUrl`; a refused URL shows the route's message |
| FX2 | T-FX10 | The "Not saved yet" note shows while the field differs from the saved URL or nothing is saved, and not otherwise; an ok test of an unsaved URL says it is not saved |
| FX2 | T-FX11 | The sidebar brand shows the product name only, expanded and in the mobile sheet; a config file that sets `display.orgName` still loads (E2E: the brand link's text) |

## 9. Orchestration

- OC2: 2 Red, 2 Green, 1 fix reserve = 5 agents, 2 at once. FX2: 1 Red,
  1 Green, 1 fix reserve = 3, 1 at once. Sonnet. Total 8.
- Gate per `temp/planner/process/adopted-run-rules.md`; before `ready`,
  `temp/planner/mgmt-round2/review-lessons.md`.
- Merge order: FX2 any time; OC2 after OC1. FX2 brings an e2e shared file:
  units in flight re-run their targeted specs once after merging it.

## 10. Guards and out of scope

- No new route, gateway operation, LiteLLM call, write or permission.
- No key, key alias or per-user figure in the new fields.
- FX2 edits no route, no `lib/litellm/**` file, `env.ts` or `auth.ts`.
- FX2 changes how a select looks, never its name, value, options or
  keyboard behaviour; the Radix `Select` (`components/ui/select.tsx`) is
  not touched.
- Out of scope: by model (Q-F-1), a log scale, export, the other pages'
  daily tables (Q-F-2).

## 11. Completion and the `/goal` lines

Complete when OC2 and FX2 are on `main`, their Verify lines in
implementation-phases are ticked with evidence, and CI is green.

- `improvements_worker`: `/goal OC2 of docs/plans/20261126_round3_followups.md is ready: at a green branch gate with its handover sent`
- `bedrock_worker`: `/goal FX2 of docs/plans/20261126_round3_followups.md is ready: at a green branch gate with its handover sent`
