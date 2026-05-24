#!/usr/bin/env bash
set -euo pipefail

# Configure git user from environment variables
git config --global user.name "${GIT_USER_NAME}"
git config --global user.email "${GIT_USER_EMAIL}"

# Marketplaces — sources Claude Code resolves plugins from.
claude plugin marketplace add anthropics/claude-code               # First-party Claude Code commands and built-ins
claude plugin marketplace add thedotmack/claude-mem                # Hosts claude-mem (persistent cross-session memory)
claude plugin marketplace add anthropics/claude-plugins-official   # Anthropic's curated plugin index (context7, superpowers, ...)
claude plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill # Hosts the ui-ux-pro-max design-intelligence skill
claude plugin marketplace add obra/superpowers                     # obra's superpowers marketplace (TDD, brainstorming, planning skills)

# Plugins — installed into this devcontainer's ~/.claude.
claude plugin install context7@claude-plugins-official             # Up-to-date library/framework docs lookup (Context7 MCP)
claude plugin install claude-mem@thedotmack                        # Persistent memory + observation timeline across sessions
claude plugin install aws-agents                                   # AWS AgentCore workflows: build / deploy / debug / harden / optimize / connect
claude plugin install ui-ux-pro-max@ui-ux-pro-max-skill            # UI/UX design system intelligence (styles, palettes, components, charts)
claude plugin install superpowers@claude-plugins-official          # Process skills: brainstorming, TDD, debugging, code review, plans
claude plugin install frontend-design@claude-plugins-official      # Frontend design skills: UI components, layouts, accessibility
claude plugin install code-review@claude-plugins-official          # Code review skills: automated code analysis, suggestions, best practices
claude plugin install security-guidance@claude-plugins-official    # Security guidance skills: automated security analysis, suggestions, best practices
