# Strata Dashboard — UI Kit

High-fidelity, interactive recreation of the Strata web app: a light-mode Bedrock cost observability dashboard. This is the reference for building real screens — pixel-faithful, modular JSX components, click-through (not production code).

> No source repo/Figma existed when this was built — it realizes the written brief and the foundation tokens in `../../colors_and_type.css`. Reconcile against real source when it lands.

## Run
Open `index.html`. React + Babel are loaded from CDN; components compile in-browser. All tokens come from the shared `colors_and_type.css`.

## What it demonstrates
A single-app shell with working interactions:
- **Sidebar** — collapsible nav rail across the 9 page areas, active state in the blue→violet accent.
- **TopBar** — sticky header with global date range, filter chips, search, sync status, export.
- **KPI row** — `StatCard`s with metric, budget-aware delta, sparkline.
- **CostAreaChart** — stacked-area spend-over-time (Recharts-style), switchable Cost / Tokens / Invocations.
- **DonutChart** — share of spend by model.
- **ModelTable** — TanStack-style sortable/hoverable breakdown with inline share bars.
- Interactions: switch metric, sort the table, toggle the sidebar, change date range, dismiss filter chips.

## Components
| File | Component | Role |
|---|---|---|
| `Primitives.jsx` | `Icon`, `Button`, `Badge`, `Chip`, `Delta`, `Card`, `Money` | Shared atoms over the tokens. |
| `Sidebar.jsx` | `Sidebar` | Left nav rail + brand mark. |
| `TopBar.jsx` | `TopBar` | Sticky header: title, range, filters, search, export. |
| `StatCard.jsx` | `StatCard` | KPI tile with delta + sparkline. |
| `Charts.jsx` | `CostAreaChart`, `DonutChart` | Hand-built SVG charts in the chart palette. |
| `ModelTable.jsx` | `ModelTable` | Sortable cost-by-model table. |
| `App.jsx` | `App` | Composes the overview screen + state. |

Components export to `window` for cross-file use (see each file's footer).
