# Rule 40 — Design system & stack

Source: `docs/specs/2026-05-15-design-system.md`.

## Stack (do not substitute without updating the spec)

- Next.js App Router, TypeScript strict, Node.js 22 LTS, pnpm
- Tailwind CSS v4, shadcn/ui (Radix), Lucide React
- Recharts (charts), TanStack Table (tables), TanStack Query (server state)
- nuqs (URL state), date-fns (dates), Zod v4 (validation)
- Auth.js v5 (Microsoft Entra ID), `@t3-oss/env-nextjs`, `next-safe-action`
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
   stands in for another.
3. **Lazy-load Recharts:** `next/dynamic(() => import(...), { ssr: false })`.
   Every chart is wrapped in `ResponsiveContainer`.
4. **Each page section is wrapped in its own `<Suspense>` and
   `ErrorBoundary`.** A failure in one section must not break the page.
5. **No global state libraries** (no Redux, no Zustand). State sources:
   - Server state → TanStack Query
   - URL state → nuqs
   - Local UI state → `useState`
6. **Breakpoints:** 375 / 768 / 1024 / 1440. Content max-width 1280px,
   centered.
7. **Typography:** Space Grotesk (UI) + JetBrains Mono (numeric/code),
   self-hosted from the `@fontsource-variable/*` packages via `next/font/local`
   (Design System — *Typography*). No build-time Google Fonts fetch.
8. **Icons:** Lucide React only, consistent stroke width.
