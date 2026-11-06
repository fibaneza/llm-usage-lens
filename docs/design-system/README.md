# Strata — Bedrock Cost Observability Design System

> **Provenance.** This is a design-reference bundle exported from Claude Design
> (claude.ai/design) and vendored here for implementation reference. It is **not**
> a spec: the source of truth remains `docs/specs/**` (Rule 00). Where this bundle
> and the specs disagree, the specs win. The bundle's own copy of the specs and
> its design-tool metadata (`_ds_bundle.js`, `_ds_manifest.json`,
> `_adherence.oxlintrc.json`) were dropped on import to avoid duplication.

> **Working name.** "Strata" was chosen by the design agent (geological *layers* → ties to **Bedrock**, stratified cost data). Our product brand is **Bedrock Cost**; treat "Strata" as the design system's working title only.

Strata is a **serverless observability dashboard** that tracks **AWS Bedrock** AI-model usage and cost across an organization, broken down by team, user, service, and model — refreshed hourly by a Lambda collector pipeline.

This repository **is** the design system: foundation tokens, brand guidance, preview cards, and a high-fidelity UI kit recreating the product's core view.

---

## Product context

- **Surface:** one web app — a light-mode enterprise analytics dashboard.
- **Background:** `#F5F7FF` (soft blue-gray canvas). Surfaces are `#FFFFFF` (cards) → `#EEF0FC` → `#E2E5F4`.
- **Stack:** Next.js App Router · TypeScript strict · Tailwind v4 · shadcn/ui · Recharts · TanStack Table · TanStack Query · nuqs (URL-synced filters) · Auth.js + Microsoft Entra ID.
- **State:** Server state in TanStack Query, URL state in nuqs, local state in `useState`. No Redux/Zustand.
- **Icons:** Lucide React (shadcn default) — outline ~1.75px stroke, 24px grid.
- **Hard rule:** **no raw hex in product components** — semantic CSS tokens only (see `colors_and_type.css`).

### Sources
- **Codebase:** `aws-bedrock-cost-tracker/` (local mount — pre-implementation, no `apps/` yet)
- **Specs read:** `docs/specs/2026-05-15-design-system.md`, `system-architecture.md`, `implementation-phases.md`
- **Figma:** none provided

---

## CONTENT FUNDAMENTALS

Voice: precise internal tool for engineers and FinOps partners. Calm, factual, numbers-first.

- **Person.** Second person sparingly ("You're over budget"). Mostly impersonal and declarative — the data leads.
- **Tone.** Neutral, exact, slightly terse. No hype words, no exclamation marks.
- **Casing.** Sentence case everywhere — headings, buttons, menu items. Only exception: uppercase eyebrow labels (`TOTAL SPEND · MTD`).
- **Numbers.** JetBrains Mono + tabular figures, always. Currency with symbol + thousands separators. Abbreviated on KPIs (`$48.2K`), full precision in tables (`$1,284.50`). Always pair with delta + period: `+18.3% vs. prior 30d`.
- **Deltas.** Up-spend = bad (rose `--neg`), down-spend = good (emerald `--pos`). Colour reflects budget impact, not arithmetic sign.
- **Model IDs.** Verbatim: `Claude 3.5 Sonnet`, `anthropic.claude-3-5-sonnet-20241022`. Never paraphrase.
- **No emoji.** Status = colour + Lucide glyph + delta arrow.
- **Empty states.** Honest and short: "No invocations in this range." "No sync has run yet." (never treat a missing `SyncStatus` as an error).

---

## VISUAL FOUNDATIONS

Light analytics aesthetic: soft blue-gray canvas, white card surfaces, generous tabular numerals, one warm amber accent for alerts, an indigo gradient brand signature.

- **Background.** `#F5F7FF`. No gradients, no images, no texture on canvas.
- **Colour system.**
  - **Primary** `#4F46E5` (indigo-600) — nav active states, primary buttons (solid or via gradient).
  - **Secondary** `#6366F1` (indigo-500) — links, secondary actions.
  - **Accent/CTA** `#D97706` (amber) — **warnings, highlights, budget alerts only** — NOT the brand color.
  - **Brand gradient** `#3730A3 → #4F46E5` — primary buttons, logo mark, hero emphasis.
  - **Destructive** `#E11D48` (rose-600) — errors, high cost alerts.
  - **Success** `#059669` (emerald-600) — positive trends, spend-down indicators.
  - **Ring** `rgba(79,70,229,0.35)` — 2px focus rings.
- **Model chart colors (fixed per model):**
  - Claude Opus: `#7C3AED` (deep purple)
  - Claude Sonnet: `#3B82F6` (blue)
  - Claude Haiku: `#14B8A6` (teal)
  - Other: `#D97706` (amber)
- **Typography.** **Space Grotesk for headings and all UI copy** (page titles, section headers, labels, buttons). **JetBrains Mono for all numeric/data content and code**. Both from Google Fonts. (The app self-hosts both families — Design System spec, *Typography*; this vendored reference still shows the Google Fonts import.)
  - Type scale: 12 / 14 / 16 / 18 / 24 / 32 / 48px.
  - Base body: 14px in dense UI contexts.
  - All numbers in JetBrains Mono with `font-feature-settings: 'tnum' 1, 'zero' 1`.
- **Spacing.** 4px/8px grid. Card padding 16–24px. Table rows ~40px.
- **Borders & cards.** Cards = `--surface-1` (`#FFFFFF`) + 1px `--border` (`#E2E8F0`) + `border-radius: 8px`. On hover: border becomes transparent, replaced by an **indigo ring** (`rgba(79,70,229,0.2)`) + 2px lift.
- **Elevation.** Depth via border + surface shift. Shadows only for overlays, menus, modals.
- **Hover / press.** 1px `translateY(-2px)` lift + indigo border ring. Buttons: primary gradient on hover. 150–300ms ease-out.
- **Focus.** 2px `--ring` (`rgba(79,70,229,0.35)`) outline.
- **Motion.** 150–300ms, ease-out entering / ease-in exiting. Respect `prefers-reduced-motion`. No bounces.
- **Charts.** Recharts, lazy-loaded with `next/dynamic` + `ssr: false`. Always wrapped in `ResponsiveContainer`. Gridlines `rgba(15,23,42,0.06)`. Legends always visible and near chart.
- **Tables.** TanStack Table. Sticky header, right-aligned numeric columns, hairline row dividers, no zebra. Collapses to card layout below `md` breakpoint.
- **Layout.** Fixed left sidebar (collapsible icon rail) + sticky top bar (org name · sync status · date range · search · user menu). Content max-width 1280px centered.

---

## ICONOGRAPHY

- **Set:** Lucide React — shadcn default. Outline style, ~1.75px stroke, 24px grid, rendered at 16–18px in UI.
- **CDN (previews):** `https://unpkg.com/lucide@latest/dist/umd/lucide.min.js`
- **Production:** `lucide-react` package.
- **Nav glyphs:** `layout-dashboard` (Overview), `trophy` (Ranking), `building-2` (Departments), `users-round` (Teams), `server` (Services), `user` (Users), `settings-2` (Settings).
- **Data glyphs:** `dollar-sign`, `activity`, `cpu`, `trending-up/down`, `bar-chart-3`, `pie-chart`, `layers`.
- **UI glyphs:** `calendar`, `filter`, `search`, `download`, `arrow-up-right` / `arrow-down-right`, `chevron-down`, `more-horizontal`, `circle-dot` (sync live), `log-out`, `panel-left-open/close`.
- **No emoji anywhere.** Status = colour + glyph.
- **Logo mark:** `assets/strata-mark.svg` — three offset stacked bars, blue→navy gradient. `assets/strata-wordmark.svg` — mark + "Strata" in Space Grotesk SemiBold.

---

## Index

| Path | Contents |
|---|---|
| `README.md` | This file |
| `colors_and_type.css` | All foundation tokens — spec-exact colors, type scale, spacing, radii, elevation |
| `SKILL.md` | Agent Skill manifest |
| `assets/strata-mark.svg` | Logo mark |
| `assets/strata-wordmark.svg` | Logo + wordmark |
| `preview/` | Specimen cards (Design System tab) |
| `ui-kits/dashboard/` | Interactive dashboard UI kit |

### UI kits
- **`ui-kits/dashboard/`** — the Strata web app: collapsible sidebar (7 spec-accurate nav items), top bar (org name + sync badge + user menu + date range), KPI cards with sparklines, stacked-area cost chart, donut chart, sortable cost-by-model table with model-specific colors. Click-through interactive.
