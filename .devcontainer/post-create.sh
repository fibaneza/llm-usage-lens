#!/usr/bin/env bash
set -euo pipefail

# Configure git user from environment variables
git config --global user.name "${GIT_USER_NAME}"
git config --global user.email "${GIT_USER_EMAIL}"

# Marketplaces — sources Claude Code resolves plugins from.
claude plugin marketplace add anthropics/claude-code               # First-party Claude Code commands and built-ins
claude plugin marketplace add anthropics/claude-plugins-official   # Anthropic's curated plugin index (context7, superpowers, ...)
# claude plugin marketplace add https://github.com/affaan-m/ECC      # affaan-m/ECC plugin marketplace
claude plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill # Hosts the ui-ux-pro-max design-intelligence skill
claude plugin marketplace add obra/superpowers                     # obra's superpowers marketplace (TDD, brainstorming, planning skills)
claude plugin marketplace add thedotmack/claude-mem                # Hosts claude-mem (persistent cross-session memory)

# Plugins — installed into this devcontainer's ~/.claude.
claude plugin install auth0@claude-plugins-official    	            # Add authentication to any app with Auth0. 
claude plugin install aws-agents                                   	# AWS AgentCore workflows: build / deploy / debug / harden / optimize / connect
claude plugin install aws-serverless@claude-plugins-official    	# Design, build, deploy, test, and debug serverless applications with AWS Serverless services.
claude plugin install claude-mem@thedotmack                        	# Persistent memory + observation timeline across sessions
claude plugin install code-review@claude-plugins-official          	# Code review skills: automated code analysis, suggestions, best practices
claude plugin install context7@claude-plugins-official             	# Up-to-date library/framework docs lookup (Context7 MCP)
# claude plugin install ecc@ecc                                      	# The harness-native operator system for agentic work.
claude plugin install deploy-on-aws@claude-plugins-official    	    # Deploy applications to AWS with architecture recommendations, cost estimates, and IaC deployment.
claude plugin install frontend-design@claude-plugins-official      	# Frontend design skills: UI components, layouts, accessibility
claude plugin install hookify@claude-plugins-official            	# Easily create custom hooks to prevent unwanted behaviors by analyzing conversation patterns or from explicit instructions.
claude plugin install mcp-server-dev@claude-plugins-official    	# Skills for designing and building MCP servers that work seamlessly with Claude.
claude plugin install pr-review-toolkit@claude-plugins-official     # Pull request review toolkit: automated PR analysis, suggestions, best practices
claude plugin install security-guidance@claude-plugins-official    	# Security guidance skills: automated security analysis, suggestions, best practices
claude plugin install superpowers@claude-plugins-official          	# Process skills: brainstorming, TDD, debugging, code review, plans
claude plugin install ui-ux-pro-max@ui-ux-pro-max-skill            	# UI/UX design system intelligence (styles, palettes, components, charts)

# Disable noisy ecc MCP servers by clearing the plugin's own .mcp.json files.
# The settings.json "disabled": true override does not suppress plugin-registered servers;
# directly emptying mcpServers in both the marketplace and cache copies is the only reliable method.
echo '{"mcpServers":{}}' | jq . > ~/.claude/plugins/marketplaces/ecc/.mcp.json
find ~/.claude/plugins/cache/ecc -name ".mcp.json" -exec sh -c 'echo "{\"mcpServers\":{}}" | jq . > "$1"' _ {} \;

###############################
### ECC Custom Installation ###
### Repo: https://github.com/affaan-m/ECC#option-2-manual-installation
###############################
export ECC_DISABLED_MCPS="github,context7,exa,playwright,sequential-thinking,memory"

# Clone the ECC repository for local development and reference.
git clone https://github.com/affaan-m/ECC.git ~/ECC
cd ~/ECC

# Install dependencies (pick your package manager)
bun install || npm install

# Copy agents to your Claude config
mkdir -p ~/.claude/agents/ecc
cp agents/e2e-runner.md ~/.claude/agents/ecc/
cp agents/security-reviewer.md ~/.claude/agents/ecc/
cp agents/seo-specialist.md ~/.claude/agents/ecc/
cp agents/silent-failure-hunter.md ~/.claude/agents/ecc/
cp agents/tdd-guide.md ~/.claude/agents/ecc/
cp agents/typescript-reviewer.md ~/.claude/agents/ecc/

# Copy rules directories (common + language-specific)
mkdir -p ~/.claude/rules/ecc
cp -R rules/common ~/.claude/rules/ecc/
cp -R rules/typescript ~/.claude/rules/ecc/

# Copy skills first (primary workflow surface)
# Recommended (new users): core/general skills only
mkdir -p ~/.claude/skills/ecc
cp -r .agents/skills/agent-sort ~/.claude/skills/ecc/
cp -r .agents/skills/article-writing  ~/.claude/skills/ecc/
cp -r .agents/skills/coding-standards  ~/.claude/skills/ecc/
cp -r .agents/skills/e2e-testing  ~/.claude/skills/ecc/
cp -r .agents/skills/frontend-patterns  ~/.claude/skills/ecc/
cp -r .agents/skills/mcp-server-patterns  ~/.claude/skills/ecc/
cp -r .agents/skills/nextjs-turbopack  ~/.claude/skills/ecc/
cp -r .agents/skills/security-review  ~/.claude/skills/ecc/
cp -r .agents/skills/tdd-workflow  ~/.claude/skills/ecc/

cp -r skills/ai-regression-testing  ~/.claude/skills/ecc/
cp -r skills/configure-ecc  ~/.claude/skills/ecc/
cp -r skills/dashboard-builder  ~/.claude/skills/ecc/
cp -r skills/deployment-patterns  ~/.claude/skills/ecc/
cp -r skills/design-system  ~/.claude/skills/ecc/
cp -r skills/e2e-testing  ~/.claude/skills/ecc/
cp -r skills/frontend-design-direction  ~/.claude/skills/ecc/
cp -r skills/frontend-patterns  ~/.claude/skills/ecc/
cp -r skills/git-workflow  ~/.claude/skills/ecc/
cp -r skills/mcp-server-patterns  ~/.claude/skills/ecc/
cp -r skills/nextjs-turbopack  ~/.claude/skills/ecc/
cp -r skills/parallel-execution-optimizer ~/.claude/skills/ecc/
cp -r skills/prompt-optimizer ~/.claude/skills/ecc/
cp -r skills/safety-guard ~/.claude/skills/ecc/
cp -r skills/security-review ~/.claude/skills/ecc/
cp -r skills/security-scan ~/.claude/skills/ecc/
cp -r skills/seo ~/.claude/skills/ecc/
cp -r skills/tdd-workflow ~/.claude/skills/ecc/
cp -r skills/team-builder ~/.claude/skills/ecc/

# Optional: keep maintained slash-command compatibility during migration
mkdir -p ~/.claude/commands/ecc
cp commands/cost-report.md ~/.claude/commands/ecc/
cp commands/ecc-guide.md ~/.claude/commands/ecc/
cp commands/feature-dev.md ~/.claude/commands/ecc/
cp commands/harness-audit.md ~/.claude/commands/ecc/
cp commands/instinct-status.md ~/.claude/commands/ecc/
cp commands/quality-gate.md ~/.claude/commands/ecc/
cp commands/refactor-clean.md ~/.claude/commands/ecc/
cp commands/test-coverage.md ~/.claude/commands/ecc/
cp commands/update-docs.md ~/.claude/commands/ecc/

# website: https://ecc.tools/skills
# npm i -g ecc-universal