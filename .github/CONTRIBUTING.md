# Contributing

This document is the single entrypoint for contributors. It points at the
authoritative rules in [`.claude/rules/`](../.claude/rules/) and the
workflow walkthrough in [`.github/README.md`](./README.md) rather than
duplicating them.

## Project state

The repository is **pre-Phase-1** for application code. The devcontainer,
observability stack, `.claude/` rules, and CI workflows are in place; no
`apps/`, no `packages/`, no `package.json` yet. See
[`CLAUDE.md`](../CLAUDE.md) for the full status snapshot and reading order.

Phase work follows a strict build order (Foundation → Layout Shell → Data
Layer → Pages 4.1–4.9 → Polish → Lambda Collector). See
[Rule 30 — phase discipline](../.claude/rules/30-phase-discipline.md).

## Local setup

The project ships a devcontainer with the full toolchain pre-installed
(Node 22, pnpm, OpenTelemetry stack, DynamoDB Local, Claude Code, plugins,
and `actionlint`). Open the repo in VS Code with the Dev Containers
extension and let `.devcontainer/post-create.sh` run.

Outside the devcontainer, install Node 22 LTS and pnpm; the rest is
optional.

## Branching

This project uses **GitHub Flow** — see
[Rule 31](../.claude/rules/31-github-flow.md) for the full convention.

| Work type | Pattern |
|---|---|
| Phase 1–6 feature | `feature/phase-<n>-<slug>` |
| General feature | `feature/<slug>` |
| Bug fix | `fix/<slug>` |
| CI / Actions | `ci/<slug>` |
| Documentation | `docs/<slug>` |
| Chore | `chore/<slug>` |

`main` is the only long-lived branch. Branch from an up-to-date `main`,
commit, open a PR, squash-merge back to `main`. Never commit directly to
`main` (Rule 30.5).

## Commit messages

Every commit must follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <description>

[optional body]
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.

The `commit-msg` Husky hook (Phase 1+) and the [`pr-title-lint.yml`](./workflows/pr-title-lint.yml)
workflow both enforce this. Never bypass hooks with `--no-verify` (Rule 50.5).

## Pull requests

1. **Open as a draft by default** — `gh pr create --draft`. New PRs start as
   drafts (the PR review skips drafts), so work-in-progress stays quiet until
   you explicitly mark it ready.
2. **Fill in the PR template** — Summary, Linked issue, Test plan, Reviewer guidance, Phase. The template pre-fills on every new PR; see [`pull_request_template.md`](./pull_request_template.md).
3. **PR title must follow Conventional Commits** — the title becomes the
   sole commit message on `main` after squash-merge, and
   [`pr-title-lint.yml`](./workflows/pr-title-lint.yml) blocks non-CC titles.
4. **Mark ready-for-review** (`gh pr ready`) when the branch is complete. This
   fires the full Claude PR review.
5. **One phase / one Phase 4 sub-phase per PR** (Rule 30.4). Don't bundle.

## Review process

Every PR gets two layers of review:

- **Automated** — [`claude-pr-review.yml`](./workflows/claude-pr-review.yml)
  posts inline comments with one-click suggestions; HIGH security findings
  trigger a `REQUEST_CHANGES` review that blocks merge. See
  [`.github/README.md`](./README.md) for the full workflow walkthrough.
- **Human** — required by branch protection (1 approval). Reviewers check
  against the rules below.

A release audit ([`claude-code-review.yml`](./workflows/claude-code-review.yml))
also runs when a release tag is pushed, scoping its review to commits since
the previous release tag.

For non-trivial code, the project's three-agent TDD loop
(`test-engineer` → `typescript-developer` → `quality-reviewer`) runs via
the `/build-feature` slash command — tests are written first, then the
implementation makes them pass. See
[Rule 70](../.claude/rules/70-agent-workflow.md).

## Coding standards

The rules below are always loaded; read the relevant ones before writing
code. Don't re-derive them from CLAUDE.md — they are the source of truth.

- [Rule 00 — specs are the source of truth](../.claude/rules/00-spec-source-of-truth.md) — cite the spec for non-trivial decisions
- [Rule 10 — server-only data boundary](../.claude/rules/10-server-only-boundary.md) — DynamoDB and AWS SDK live in server code only
- [Rule 20 — data model conventions](../.claude/rules/20-data-model-conventions.md) — UTC, USD, model-first rollups, response shape
- [Rule 40 — design system & stack](../.claude/rules/40-style-and-stack.md) — light mode default, semantic tokens, lazy-loaded charts
- [Rule 50 — security & secrets](../.claude/rules/50-security-and-secrets.md) — no static AWS keys, Auth.js session checks, never `--no-verify`
- [Rule 60 — coding standards](../.claude/rules/60-coding-standards.md) — strict TypeScript, no `any`, validate at the boundary, Vitest

## Testing

Tests use **Vitest** (not Jest), with React Testing Library for components
and Playwright for E2E (Phase 5+). See Rule 60 for the testing conventions.

- Tests live next to the code as `*.test.ts` / `*.test.tsx`, or under `__tests__/`.
- Test behaviour, not implementation.
- Zod schemas need both valid and invalid cases.
- Data-access tests run against DynamoDB Local, not mocks.
- Route Handler tests must cover the `401` (unauthenticated) and `400` (bad input) paths.
- 80% coverage minimum.

Run tests with `pnpm exec vitest run` (Phase 1+).

## Security

Report vulnerabilities privately — see [`SECURITY.md`](./SECURITY.md). Do
not open public GitHub issues for security findings.

## Issue reporting

For non-security bugs and feature requests, open a GitHub issue. Include
reproduction steps, expected vs actual behaviour, and any relevant logs or
screenshots.

At triage, issues get an `effort:` label estimating size:

| Label | Meaning |
|---|---|
| `effort: XS` | Trivial change, under 1 hour |
| `effort: S` | Small, half a day or less |
| `effort: M` | Medium, 1–2 days |
| `effort: L` | Large, 3–5 days |
| `effort: XL` | Extra large — consider breaking down before starting |

## Further reading

- [`CLAUDE.md`](../CLAUDE.md) — project status, reading order, spec index
- [`.github/README.md`](./README.md) — workflow walkthrough, cost characteristics, troubleshooting
- [`docs/specs/`](../docs/specs/) — architecture, data model, design system, implementation phases
- [`docs/guides/`](../docs/guides/) — auth setup, AWS infrastructure, deployment runbooks
