# Claude Code Customization

The root `CLAUDE.md` and the specs in `docs/specs/` are the source of truth
for this project. **Read the relevant spec before writing any code.**

This directory ships project-specific customization for Claude Code:

- `.claude/rules/` — auto-applied instruction fragments enforcing the
  non-negotiable conventions from the specs (server-only boundary, UTC, USD,
  response shape, phase order, dark-mode design system, security).
- `.claude/commands/` — slash commands wired to the spec workflow
  (`/spec`, `/phase-status`, `/start-phase`, `/verify-phase`, `/new-route`,
  `/new-data-access`, `/seed`, `/lint`, `/commit`).
- `.claude/agents/spec-guardian.md` — a read-mostly reviewer subagent that
  checks plans and diffs against the specs.
- `.claude/output-styles/spec-cited.md` — concise, spec-citing response style.

Do **not** duplicate spec content here. If you need to update a rule, change
the spec first, then update the rule to match.
