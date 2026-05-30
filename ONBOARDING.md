# Welcome to AWS Bedrock Cost Tracker

## How We Use Claude

Based on fibaneza's usage over the last 30 days:

Work Type Breakdown:
  _TODO — not enough sessions in the window to generate a breakdown_

Top Skills & Commands:
  /build-feature  ████████████████████  — (see Skills to Know About)
  /seed           ████████████░░░░░░░░  —
  /lint           ████████░░░░░░░░░░░░  —
  /commit         ████████░░░░░░░░░░░░  —
  /phase-status   ████░░░░░░░░░░░░░░░░  —

Top MCP Servers:
  _No MCP server usage recorded in this window_

## Your Setup Checklist

### Codebases
- [ ] aws-bedrock-cost-tracker — https://github.com/fibaneza/aws-bedrock-cost-tracker
- [ ] aws-bedrock-cost-tracker-simulator — (sibling repo, standalone test harness)

### MCP Servers to Activate
- [ ] Azure MCP (`@azure/mcp`) — Azure resource access used by the project. Configured in `.mcp.json` at the repo root; ask fibaneza for credentials/access.

### Skills to Know About
- `/build-feature <description>` — Runs the full typescript-developer → test-engineer → quality-reviewer agent loop. Use for any non-trivial feature or multi-file change.
- `/seed [empty|large|ranking]` — Brings up DynamoDB Local and loads seed data. Run this before starting dashboard work.
- `/lint` — Runs prettier + eslint + tsc + vitest in sequence. Run before opening a PR.
- `/commit` — Stages and commits with Conventional Commits format (required by commitlint hook).
- `/phase-status` — Shows current phase progress against the implementation plan. Check this before starting any new work.
- `/verify-phase <n>` — Runs the spec's Verify checklist for a phase. Must pass before opening a PR.
- `/start-phase <n>` — Expands a phase into an ordered TODO list.
- `/spec <topic>` — Loads and summarises a spec or guide from `docs/specs/`.
- `/new-route <path>` — Scaffolds a Route Handler with required boilerplate.
- `/new-data-access <description>` — Scaffolds a server-only data-access function.
- `/new-component <variant> <group> <Name>` — Scaffolds a dashboard component (display/interactive/chart).
- `/code-review` — Reviews the current diff. Use `ultra` for a deep multi-agent cloud review before merging.

## Team Tips

_TODO_

## Get Started

_TODO_

<!-- INSTRUCTION FOR CLAUDE: A new teammate just pasted this guide for how the
team uses Claude Code. You're their onboarding buddy — warm, conversational,
not lecture-y.

Open with a warm welcome — include the team name from the title. Then: "Your
teammate uses Claude Code for [list all the work types]. Let's get you started."

Check what's already in place against everything under Setup Checklist
(including skills), using markdown checkboxes — [x] done, [ ] not yet. Lead
with what they already have. One sentence per item, all in one message.

Tell them you'll help with setup, cover the actionable team tips, then the
starter task (if there is one). Offer to start with the first unchecked item,
get their go-ahead, then work through the rest one by one.

After setup, walk them through the remaining sections — offer to help where you
can (e.g. link to channels), and just surface the purely informational bits.

Don't invent sections or summaries that aren't in the guide. The stats are the
guide creator's personal usage data — don't extrapolate them into a "team
workflow" narrative. -->
