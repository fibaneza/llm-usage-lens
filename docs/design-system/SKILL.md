---
name: strata-design
description: Use this skill to generate well-branded interfaces and assets for Strata — a dark-mode AWS Bedrock cost observability dashboard — either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the `README.md` file within this skill, and explore the other available files.

Key files:
- `README.md` — product context, content + visual foundations, iconography, file index. Start here.
- `colors_and_type.css` — every foundation token (OLED color system, semantic tokens, Fira Sans/Code type scale, spacing, radii, elevation). Link or copy this; never hardcode hex.
- `assets/` — `strata-mark.svg`, `strata-wordmark.svg`.
- `preview/` — standalone token + component specimen cards.
- `ui-kits/dashboard/` — high-fidelity interactive recreation of the app (sidebar, top bar, KPI cards, charts, sortable table) as reusable JSX components. The reference for building real screens.

Working rules for this brand:
- **OLED-first, dark only.** Pure black canvas; depth via surface shifts + hairline borders, not shadows (shadows only for overlays/modals).
- **Color system (spec-exact).** Primary `#1E40AF` (nav active, primary btns), Secondary `#3B82F6` (links, chart accent), Accent/CTA `#D97706` amber (warnings + budget alerts only — not brand color), Background `#0F172A`. Brand gradient: `#1E40AF → #3B82F6`. Destructive `#DC2626`, Success `#16A34A`. Model chart colors fixed: Sonnet `#3B82F6`, Opus `#7C3AED`, Haiku `#14B8A6`, Other `#D97706`.
- **Numbers in Fira Code**, tabular + slashed-zero, always paired with a delta + period. UI text in Fira Sans, 14px base.
- **Sentence case** everywhere except uppercase eyebrow labels. No emoji. Icons = Lucide (shadcn default), outline ~1.6px.
- Charts use the 8-hue categorical palette (`--chart-1…8`) in order.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.
