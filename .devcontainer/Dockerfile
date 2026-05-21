# syntax=docker/dockerfile:1
# Node.js 22 LTS — matches the stack requirement in docs/specs/2026-05-15-design-system.md
FROM mcr.microsoft.com/devcontainers/javascript-node:22

# Bash + pipefail for every shell-form RUN. Docker best-practices doc:
# "/bin/sh -c only evaluates the exit code of the last operation" — without
# pipefail a failing `curl` in a `curl | gpg` pipe is silently swallowed.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Build-only: keep apt-get install non-interactive without leaking to runtime.
ARG DEBIAN_FRONTEND=noninteractive

# Host login name, passed from docker-compose (defaults to the image's 'node').
# Not hardcoded — see docker-compose.yml `args: USERNAME: ${USER:-node}`.
ARG USERNAME=node

# Rename the built-in 'node' user to match the host user. The devcontainer
# `updateRemoteUserUID` setting then syncs this user's UID/GID to the host, so
# bind-mounted ~/.ssh and ~/.claude are readable and git SSH auth works.
RUN set -eux; \
    if [ "$USERNAME" != "node" ]; then \
        usermod -l "$USERNAME" node; \
        groupmod -n "$USERNAME" node; \
        usermod -d "/home/$USERNAME" -m "$USERNAME"; \
        if [ -f /etc/sudoers.d/node ]; then \
            mv /etc/sudoers.d/node "/etc/sudoers.d/$USERNAME"; \
            sed -i "s/node/$USERNAME/g" "/etc/sudoers.d/$USERNAME"; \
        fi; \
    fi

# Python 3 + uv (provides `uvx`) for MCP servers shipped as Python tools.
# `jq` is also installed here — required by .devcontainer/claude/statusline-command.sh
# which parses Claude Code's statusLine JSON input.
# Installed system-wide so they're on PATH for every user in the container.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends python3 python3-venv jq; \
    rm -rf /var/lib/apt/lists/*; \
    curl -LsSf https://astral.sh/uv/install.sh | sh; \
    cp /root/.local/bin/uv /root/.local/bin/uvx /usr/local/bin/; \
    rm -rf /root/.local

# Azure CLI (`az`) — follows Microsoft's documented apt install steps:
# https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-linux?pivots=apt
# Supported suites today: Debian bullseye/bookworm, Ubuntu jammy/noble.
# The base image is Debian 13 (trixie), which Microsoft does not publish a
# repo for yet — their troubleshooting docs ("No package for your
# distribution") explicitly say to pin `AZ_REPO="bookworm"` in that case.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl apt-transport-https gnupg; \
    mkdir -p /etc/apt/keyrings; \
    curl -sLS https://packages.microsoft.com/keys/microsoft.asc \
        | gpg --dearmor -o /etc/apt/keyrings/microsoft.gpg; \
    chmod go+r /etc/apt/keyrings/microsoft.gpg; \
    printf 'Types: deb\nURIs: https://packages.microsoft.com/repos/azure-cli/\nSuites: bookworm\nComponents: main\nArchitectures: %s\nSigned-by: /etc/apt/keyrings/microsoft.gpg\n' \
        "$(dpkg --print-architecture)" \
        > /etc/apt/sources.list.d/azure-cli.sources; \
    apt-get update; \
    apt-get install -y --no-install-recommends azure-cli; \
    rm -rf /var/lib/apt/lists/*

# AWS CLI v2 — official bundled installer (the only AWS-supported install
# method on Debian). Architecture-aware so it works on amd64 and arm64 hosts.
# `unzip` is purged at the end of the same layer — best-practices guidance is
# to remove build-only tooling in the layer that introduced it.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends unzip curl ca-certificates; \
    case "$(dpkg --print-architecture)" in \
        amd64) AWS_ARCH=x86_64 ;; \
        arm64) AWS_ARCH=aarch64 ;; \
        *) echo "Unsupported arch for AWS CLI" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${AWS_ARCH}.zip" -o /tmp/awscliv2.zip; \
    unzip -q /tmp/awscliv2.zip -d /tmp; \
    /tmp/aws/install; \
    rm -rf /tmp/aws /tmp/awscliv2.zip; \
    apt-get purge -y --auto-remove unzip; \
    rm -rf /var/lib/apt/lists/*

# Bun — required by the claude-mem plugin's stop hook (summarize script).
# Installed system-wide so it's on PATH for all users. The official installer
# unpacks a .zip release, so `unzip` is a hard prerequisite — install it for
# the duration of this layer and purge it at the end (the AWS CLI layer above
# already removed its own copy).
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends unzip; \
    curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash; \
    chmod a+x /usr/local/bin/bun; \
    ln -sf /usr/local/bin/bun /usr/local/bin/bunx; \
    apt-get purge -y --auto-remove unzip; \
    rm -rf /var/lib/apt/lists/*

# Container-scoped Claude Code settings: enable the project's statusline
# script. /etc/claude-code/managed-settings.json is the system-managed
# settings location and is NOT bind-mounted from the host, so this config
# applies only inside the container without touching ~/.claude on the host.
# The workspace bind-mount in docker-compose.yml exposes the script at
# /workspace/.devcontainer/claude/statusline-command.sh.
RUN set -eux; \
    mkdir -p /etc/claude-code; \
    printf '{\n  "statusLine": {\n    "type": "command",\n    "command": "/workspace/.devcontainer/claude/statusline-command.sh",\n    "padding": 0\n  }\n}\n' \
        > /etc/claude-code/managed-settings.json

# Pre-create ~/.claude owned by the user. The docker-compose.yml `claude-data`
# named volume mounts here; Docker seeds a fresh named volume with the
# ownership/permissions of this image directory, so creating it as $USERNAME
# now stops the volume from defaulting to root:root and locking the user out.
RUN set -eux; \
    mkdir -p "/home/$USERNAME/.claude"; \
    chown "$USERNAME:$USERNAME" "/home/$USERNAME/.claude"

USER $USERNAME

# Claude Code CLI on PATH. Git is already provided by the base image.
# Installed AFTER the USER switch so the global package is owned by $USERNAME
# (not root) — this lets `npm install -g @anthropic-ai/claude-code` updates run
# at runtime without sudo or hitting EACCES on a root-owned package dir.
RUN npm install -g @anthropic-ai/claude-code
