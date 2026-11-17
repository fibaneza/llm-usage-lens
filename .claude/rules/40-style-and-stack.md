# Rule 40 — Design system & stack

Source: `docs/specs/2026-05-15-design-system.md`.

## Stack (do not substitute without updating the spec)

- Next.js App Router, TypeScript strict, Node.js 22 LTS, pnpm
- Tailwind CSS v4, shadcn/ui (Radix, via the `radix-ui` umbrella), Lucide React — new primitives are shadcn copies, not new packages (2026-11-16)
- Recharts (charts), TanStack Table (tables), TanStack Query (server state)
- nuqs (URL state), date-fns (dates), Zod v4 (validation)
- Auth.js v5 (Microsoft Entra ID), `@t3-oss/env-nextjs`, `next-safe-action`
- `yaml` (server-only parser for `config/config.yaml`, validated by Zod;
  System Architecture — *Configuration file*, 2026-11-17)
- OpenTelemetry (`@vercel/otel`)
- AWS CDK (TypeScript) for the dashboard platform in `infra/` (Platform spec);
  AWS SAM stays for the collector until its Phase 6 amendment
- ESLint v9 flat config (`eslint.config.ts`), Prettier, Husky + lint-staged,
  gitleaks, commitlint
- Tests: **Vitest** (not Jest) + React Testing Library; Playwright for E2E

## Rules

1. **Light mode is the default and primary theme** (enterprise SaaS analytics
   dashboard — clean, high-contrast, print-friendly). The design system spec
   lists "Dark mode as default" under **Anti-Patterns to Avoid** — do not add a
   dark theme in v1.
2. **No raw hex in components** — use the semantic color tokens / CSS
   variables defined in the design system spec. Chart series use the model
   CSS token from `packages/shared/src/models.ts`; non-model cost series use
   `--color-cost-non-model`; team series use `--color-team-1`…`--color-team-8`
   (Design System — *Chart Colors (Per Team)*). None of these families ever
   stands in for another. Density and shape come from the tokens too:
   `--text-cell`, `--text-kpi`, `--spacing-control` / `-row` / `-touch` /
   `-card`, `--radius-card`, `--radius-control`, `--shadow-overlay` in
   `app/globals.css` (Design System — *Typography*, *Layout*; 2026-11-16). No
   per-page overrides of primitive sizes.
3. **Lazy-load Recharts:** `next/dynamic(() => import(...), { ssr: false })`.
   Every chart is wrapped in `ResponsiveContainer`.
4. **Each page section is wrapped in its own `<Suspense>` and
   `ErrorBoundary`.** A failure in one section must not break the page.
5. **No global state libraries** (no Redux, no Zustand). State sources:
   - Server state → TanStack Query
   - URL state → nuqs
   - Local UI state → `useState`
6. **Breakpoints:** 375 / 768 / 1024 / 1440. The content area is fluid: no
   page-level max-width, gutters of 16 / 24 / 32px, and a 72ch measure for
   prose and forms (Design System — *Layout*, decided 2026-11-11). Compact
   density (2026-11-16): 14px body, 13px table cells, 32px controls on
   desktop, 44px touch targets below `md`.
7. **Typography:** Space Grotesk (UI) + JetBrains Mono (numeric/code),
   self-hosted from the `@fontsource-variable/*` packages via `next/font/local`
   (Design System — *Typography*). No build-time Google Fonts fetch.
8. **Icons:** Lucide React only, consistent stroke width.
9. **Page frame (2026-11-16):** the page `h1` stays in the top bar; the
   list and detail pages open with `PageHeader` (Overview, Me, LiteLLM and
   Settings get it in Slice B of the compact-workspace task); every section
   is a `Panel` with its own Suspense + ErrorBoundary; one filled primary
   button per view; tabs only for peer views with URL state; Settings uses
   route tabs (AWS accounts, Sync and data, LiteLLM, Access) on the one
   `Tabs` component (Design System — *Layout*, *Settings Page*).
10. **Sidebar order (2026-11-17; management improvements D1 and D7, user;
    D2 and D3, agent decisions).** Usage: Overview, My usage, Team usage, Ranking, Cost by
    department, Cost by team, Cost by service, Cost by user. Management:
    Users, Team, LiteLLM (route tabs Organisation, LiteLLM teams, LiteLLM
    users), Audit. Administration: Settings, last; Settings → LiteLLM holds
    configuration only (D3). The sidebar, `PageTitle` and `CommandMenu`
    share one filter; an item the caller may not see is absent and its
    route is `404` (Design System — *Navigation (Sidebar)*).
