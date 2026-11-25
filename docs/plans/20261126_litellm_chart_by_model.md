# Run plan — the Organisation chart by model name (unit OC3)

Written by the planner on 2026-11-26 for the coordinator and one worker
session; **revised the same day** after the user's answer to Q-M-1 ("By
model name"): the series are LiteLLM's model names, not the four model
families, and the family mapping is dropped. Package:
`temp/planner/litellm-by-model/` (`plan.md`, `spec-changes.md`,
`brief-oc3.md`, `workflow-improvements_worker.md`). `main` when written:
`7df54018` (OC1 landed; OC2 and FX2 briefed).

## 1. The ask (the user, 2026-11-26)

1. To "Break the Organisation chart down by model too, as LiteLLM does?":
   "Yes, plan it".
2. To "Chart series by model family, or by model name as LiteLLM draws
   it?": "By model name".

## 2. What exists

- LiteLLM's Usage page draws "Daily spend by model (top 8, rest grouped as
  Other)" with a side list "Top models" (read in the browser, v1.109.1).
- The Organisation route (`app/api/litellm/org/route.ts`) reads
  `getTeamDailySpend` once per LiteLLM team
  (`/team/daily/activity/aggregated`). Each day of that answer carries
  `breakdown.models`: an object keyed by model name whose values hold the
  same metrics as the day (`docs/litellm/openapi.json`: `DailySpendData`,
  `BreakdownMetrics`, `MetricWithMetadata`). The gateway keeps the rows
  whole (`DailyActivityResponse.results` is loose); `reduceDaily`
  (`lib/litellm/read-views.ts`) reads only `date` and `metrics`. **The
  per-model figures are already in the reads the page makes.**
- The same `breakdown` also carries `api_keys`, `entities`, `providers`,
  `endpoints`, and each model entry an `api_key_breakdown` and `metadata`.
  None of these may reach an answer.
- Chart colours today: four model-family tokens (`--color-model-*`) and
  eight team tokens (`--color-team-1..8`); a family never stands in for
  another (Rule 40.2). There is no palette for an open set of model names.
- The local LiteLLM had no usage, so its model names were not seen. They
  are shown as LiteLLM reports them; nothing depends on their form.

## 3. Decisions

Agent decisions (2026-11-26, Rule 00.3) unless marked **user**.

| Id | Decision | Reason |
|---|---|---|
| D-M-1 | The Organisation chart's *Breakdown* gains **By model** (`by=model`) (**user**: "Yes, plan it") | The ask |
| D-M-2 | The series are **LiteLLM's model names**: the eight largest of the range, then "Other models (n)" (**user**: "By model name") | The ask; as LiteLLM draws it |
| D-M-3 | "Largest" is by **spend over the range**, whatever the *Metric* and *Bucket size* switches show; ties by name. A model keeps its place and its colour when a switch changes | Colour follows the model, not the view; a switch must not repaint the chart |
| D-M-4 | A new palette for model names: `--color-llm-model-1` … `--color-llm-model-8` and `--color-llm-model-other` (§4), assigned in the order of D-M-3. Model names are an open set, so colour alone never identifies one: the legend, the tooltip and the table view carry the name | Rule 40.2 forbids borrowing the team or the family tokens; the values are checked (§4) |
| D-M-5 | A name is shown **as LiteLLM reports it**. The same model under two names (with and without a provider prefix) is two rows; nothing is merged or mapped to a family. An empty name reads "(no model name)" | No mapping to maintain; the real names were not seen. Superseded: the family mapping `normalizeLiteLLMModel` of the first version of this plan |
| D-M-6 | The source is `breakdown.models` of the reads the route already makes. The reducer reads the model name and the seven metrics, nothing else. `breakdown.model_groups` is not used | No call added; one name per model |
| D-M-7 | Where a day's total is larger than the sum of its models (LiteLLM sent no breakdown, or a partial one), the difference is its own series **"Not broken down"**, drawn hatched in `--color-muted-foreground`. It is never spread over the models, and nothing is scaled | Never invent a split (the spirit of Rule 20.3); a hatch cannot be taken for a model |
| D-M-8 | When no day of the range has a breakdown, *By model* is disabled with "Not reported by LiteLLM" and the Models table shows that sentence | The existing rule for an option without data |
| D-M-9 | A **Models** table under the chart: Model (with its series colour mark when it is one of the eight), Spend, Share, Requests, Tokens; the ten largest by spend, the rest as one row "n more models". It is shown in every breakdown | LiteLLM's "Top models" list |
| D-M-10 | The route's answer gains optional `dailyByModel[]` (`name`, `daily[]` of `date`, `spend`, `requests`, `tokens`; ordered by D-M-3; thirty names at most), `otherModels` (`count`, `daily[]`; the names past thirty) and `dailyUnattributed[]`. Sums over all LiteLLM teams | Additive; bounded |
| D-M-11 | A model name is upstream text: cut to 200 characters on the server, rendered as text, truncated in the legend and the cell with the full name in `title` | A name can be a long ARN |
| D-M-12 | *By model* works with *Metric*, *Bucket size* and *View* as the other breakdowns do; the subtitle reads "Daily spend by model, 8 largest stacked" | Consistency with OC1 and OC2 |
| D-M-13 | Organisation only | The other pages are Q-F-2 |

No open question.

## 4. The palette

Chosen with the categorical checks of the `dataviz` method (lightness
band, chroma floor, adjacent colour-blind separation, normal-vision
separation, contrast): all pass on the white card.

| Token | Hex | Contrast on `#FFFFFF` |
|---|---|---|
| `--color-llm-model-1` | `#1D6FD1` | 4.95:1 |
| `--color-llm-model-2` | `#D1541A` | 4.20:1 |
| `--color-llm-model-3` | `#0F8A66` | 4.33:1 |
| `--color-llm-model-4` | `#A87400` | 4.07:1 |
| `--color-llm-model-5` | `#C94F86` | 4.25:1 |
| `--color-llm-model-6` | `#2F7D1A` | 5.16:1 |
| `--color-llm-model-7` | `#6250D6` | 5.77:1 |
| `--color-llm-model-8` | `#CF3B3A` | 4.84:1 |
| `--color-llm-model-other` | `#6B7280` | 4.83:1 |

Every value passes WCAG 1.4.11 (3:1). None equals the value of a model,
team, cost, primary, success, warning or destructive token. The worst
adjacent pair for colour-blind readers (slots 3 and 4) is in the band
that needs a second encoding: the 2px gap between stacked segments, the
legend and the table view are that encoding.

## 5. Unit

| Unit | Title | Session | Worktree | Branch | Starts when | Review |
|---|---|---|---|---|---|---|
| OC3 | Organisation chart by model name, and the Models table | `improvements_worker` | `oc3` | `feature/litellm-org-by-model` | OC2 on `main` | quality + spec-guardian + UI; security scope on the reducer and the route's answer (T-OC15) |

Start check: `git log --oneline main | grep -ci 'oc2'` is at least 1. The
unit applies its spec text in its first commit.

## 6. What it delivers

- `app/globals.css`: the nine tokens of §4.
- `packages/shared/src/schemas/litellm-views.ts`: the optional fields of
  D-M-10.
- `lib/litellm/read-views.ts`: `reduceDailyByModel(rows)`: per row, the
  date and, for each key of `breakdown.models`, the name and the metrics.
  A row without `breakdown.models` gives no model rows; a wrong type is
  contract drift, as in `reduceDaily`.
- `app/api/litellm/org/route.ts`: from the same `daily.results`,
  `dailyByModel`, `otherModels`, `dailyUnattributed`; empty in the
  not-configured answer.
- `components/charts/SpendTimelineChart.tsx`: an optional hatched fill for
  a series.
- `components/litellm/organisation/OrgSpendPanel.tsx`: the third
  breakdown, its series, legend, subtitle and table view.
- `components/litellm/organisation/OrgModelsTable.tsx` (new) and its place
  in `components/litellm/OrganisationSection.tsx`, as its own `Panel`.

## 7. Ownership

Paths under `apps/dashboard/` unless they start with `packages/`.

| Unit | Owns |
|---|---|
| OC3 | `app/globals.css` (the nine new tokens only); `lib/litellm/read-views.ts` (the new reducer only) and a new `lib/litellm/read-views.test.ts`; `app/api/litellm/org/route.ts` and its test; `components/charts/SpendTimelineChart.tsx` and its test (the hatched fill only); `components/litellm/organisation/**`; `components/litellm/OrganisationSection.tsx`; `e2e/litellm-org-chart.spec.ts` |

| Declared overlap | Units | Rule |
|---|---|---|
| The Organisation files and the org route | OC2 | OC3 starts after OC2 is on `main` |
| `packages/shared/src/schemas/litellm-views.ts`, `lib/litellm/read-views.ts`, `app/globals.css` | OC3 and units in flight | Append-only (kind A) |
| The specs, Rule 40 and implementation-phases | OC3 and units in flight | Append-only (kind A) |

`app/globals.css` is on the e2e shared list: the **full** e2e runs once at
the gate. A shared schema changes: the full Vitest runs once at the final
commit.

## 8. Tests

Written into the spec text by the unit's first commit (spec-changes §2 to
§4); a test cites the spec section and id, never this plan.

| Id | Proves |
|---|---|
| T-OC14 | `reduceDailyByModel`: the name and metrics per day; a row without a breakdown gives none; a wrong type is contract drift |
| T-OC15 | **Security.** The route: `dailyByModel` sums each name over all teams and is ordered by range spend, ties by name; thirty names at most with `otherModels` for the rest; `dailyUnattributed` is the day's total less its models when above 1e-6, else absent; a name is cut to 200 characters; with `api_keys`, `entities`, `api_key_breakdown` and `metadata` in the upstream rows, none of their keys or values is in the answer; no LiteLLM call added; the role table unchanged; the not-configured answer carries empty lists |
| T-OC16 | The panel: *By model* stacks the eight largest names by range spend, "Other models (n)" and the hatched "Not broken down"; the order and each model's colour stay the same for every metric and bucket size; `by=model` in the URL restores it; the subtitle; the legend and the table view name each series; disabled with "Not reported by LiteLLM" when no day has a breakdown |
| T-OC17 | The Models table: the rows in spend order, the colour mark only on the names the chart draws, Share, the "n more models" row, "(no model name)", the empty sentence, a long name truncated with its `title`, the cards at 375px |
| T-OC18 | The palette: the nine tokens exist with the values of the spec, each at least 3:1 on the card, none equal to a model, team, cost, primary, success, warning or destructive token |
| T-OC19 | E2E: *By model* by click for the three reading roles; the Models table; axe at 375px and desktop |

## 9. Orchestration

- 2 Red, 2 Green, 1 fix reserve = 5 agents, 2 at once, sonnet.
- Gate per `temp/planner/process/adopted-run-rules.md`; before `ready`,
  `temp/planner/mgmt-round2/review-lessons.md`.
- Queue of `improvements_worker`: OC2, then OC3. OC3 brings an e2e shared
  file: units in flight re-run their targeted specs once after merging it.

## 10. Guards and out of scope

- No new route, gateway operation, LiteLLM call, write or permission; the
  allowlist is not edited.
- Nothing of `breakdown` other than `models[*].metrics` and the model name
  is read.
- `packages/shared/src/models.ts`, the model-family tokens and the team
  tokens are not changed; a model-name series never uses one of them.
- An example ARN in a test or the spec uses `000000000000` (Rule 50.9).
- Out of scope: mapping a name to a family or merging two names of one
  model; by provider, key or public model name; by model per team; the
  other pages (Q-F-2).

## 11. Completion and the `/goal` line

Complete when OC3 is on `main`, its Verify line in implementation-phases is
ticked with evidence, and CI is green.

- `improvements_worker`: `/goal OC3 of docs/plans/20261126_litellm_chart_by_model.md is ready: at a green branch gate with its handover sent`
