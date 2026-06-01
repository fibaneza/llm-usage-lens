#!/usr/bin/env bash
set -euo pipefail

export ECC_DISABLED_MCPS="github,context7,exa,playwright,sequential-thinking,memory"

# Configure git user from environment variables
git config --global user.name "${GIT_USER_NAME}"
git config --global user.email "${GIT_USER_EMAIL}"

# Keep pnpm's store on the container home (native ext4 volume), not the repo
# root — pnpm's copyfile throws ESTALE (-116) on the Docker host bind mount.
pnpm config set store-dir "$HOME/.pnpm-store" --location=user

# Marketplaces — sources Claude Code resolves plugins from.
claude plugin marketplace add anthropics/claude-code                    # First-party Claude Code commands and built-ins
claude plugin marketplace add anthropics/claude-plugins-official        # Anthropic's curated plugin index (context7, superpowers, ...)
# claude plugin marketplace add https://github.com/affaan-m/ECC         # affaan-m/ECC plugin marketplace
claude plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill      # Hosts the ui-ux-pro-max design-intelligence skill
claude plugin marketplace add obra/superpowers                          # obra's superpowers marketplace (TDD, brainstorming, planning skills)
claude plugin marketplace add thedotmack/claude-mem                     # Hosts claude-mem (persistent cross-session memory)

# Plugins — installed into this devcontainer's ~/.claude.
# claude plugin install auth0@claude-plugins-official    	            # Add authentication to any app with Auth0.
claude plugin install aws-agents                                   	    # AWS AgentCore workflows: build / deploy / debug / harden / optimize / connect
claude plugin install aws-serverless@claude-plugins-official    	    # Design, build, deploy, test, and debug serverless applications with AWS Serverless services.
claude plugin install claude-md-management@claude-plugins-official      # Tools to maintain and improve CLAUDE.md files
claude plugin install claude-mem@thedotmack                        	    # Persistent memory + observation timeline across sessions
claude plugin install code-review@claude-plugins-official          	    # Code review skills: automated code analysis, suggestions, best practices
claude plugin install code-simplifier@claude-plugins-official          	# Agent that simplifies and refines code for clarity, consistency, and maintainability while preserving functionality
claude plugin install context7@claude-plugins-official             	    # Up-to-date library/framework docs lookup (Context7 MCP)
# claude plugin install ecc@ecc                                      	# The harness-native operator system for agentic work.
claude plugin install deploy-on-aws@claude-plugins-official    	        # Deploy applications to AWS with architecture recommendations, cost estimates, and IaC deployment.
claude plugin install feature-dev@claude-plugins-official               # Specialized agents for codebase exploration, architecture design, and quality review
claude plugin install frontend-design@claude-plugins-official      	    # Frontend design skills: UI components, layouts, accessibility
claude plugin install github@claude-plugins-official      	            # GitHub integration skills: repository management, issues, pull requests/compa
claude plugin install hookify@claude-plugins-official            	    # Easily create custom hooks to prevent unwanted behaviors by analyzing conversation patterns or from explicit instructions.
claude plugin install mcp-server-dev@claude-plugins-official    	    # Skills for designing and building MCP servers that work seamlessly with Claude.
claude plugin install pr-review-toolkit@claude-plugins-official         # Pull request review toolkit: automated PR analysis, suggestions, best practices
claude plugin install security-guidance@claude-plugins-official    	    # Security guidance skills: automated security analysis, suggestions, best practices
claude plugin install skill-creator@claude-plugins-official          	# Create new skills, improve existing skills, and measure skill performance.
claude plugin install superpowers@claude-plugins-official          	    # Process skills: brainstorming, TDD, debugging, code review, plans
# claude plugin install typescript-lsp@claude-plugins-official    	    # TypeScript/JavaScript language server for enhanced code intelligence
claude plugin install ui-ux-pro-max@ui-ux-pro-max-skill            	    # UI/UX design system intelligence (styles, palettes, components, charts)

# Disable noisy ecc MCP servers by clearing the plugin's own .mcp.json files.
# The settings.json "disabled": true override does not suppress plugin-registered servers;
# directly emptying mcpServers in both the marketplace and cache copies is the only reliable method.
# echo '{"mcpServers":{}}' | jq . > ~/.claude/plugins/marketplaces/ecc/.mcp.json
# find ~/.claude/plugins/cache/ecc -name ".mcp.json" -exec sh -c 'echo "{\"mcpServers\":{}}" | jq . > "$1"' _ {} \;

# Tools — installed system-wide for workflow linting.
bash <(curl -sSL https://raw.githubusercontent.com/rhysd/actionlint/main/scripts/download-actionlint.bash) latest /usr/local/bin  # Lint .github/workflows/*.yml with: actionlint
gh extension install nicholasgasior/gh-label-sync                        # Sync GitHub labels from .github/labels.yml with: gh label-sync sync --file .github/labels.yml --dry-run
