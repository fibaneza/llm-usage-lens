# syntax=docker/dockerfile:1
# Node.js 24 LTS — matches the stack requirement in docs/specs/2026-05-15-design-system.md
FROM mcr.microsoft.com/devcontainers/javascript-node:24

# Bash + pipefail for every shell-form RUN. Docker best-practices doc:
# "/bin/sh -c only evaluates the exit code of the last operation" — without
# pipefail a failing `curl` in a `curl | gpg` pipe is silently swallowed.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Build-only: keep apt-get install non-interactive without leaking to runtime.
ARG DEBIAN_FRONTEND=noninteractive

# Host login name, passed from docker-compose (defaults to the image's 'node').
# Not hardcoded — see docker-compose.yml `args: USERNAME: ${USER:-node}`.
ARG USERNAME=node

# Project folder name, passed from docker-compose (defaults to the compose project name).
ARG PROJECT_FOLDER_NAME

# Expose the project path as an environment variable for use in the statusline script.
ENV PROJECT_PATH=/workspace/${PROJECT_FOLDER_NAME}

# ----------------------------------------------------------------------------------------------
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

# ----------------------------------------------------------------------------------------------
# Azure CLI (`az`) — follows Microsoft's documented apt install steps:
# https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-linux?pivots=apt
# Installing via the devcontainer feature is simpler but uses Microsoft's install script which is less transparent and adds ~3 GB to the image size.
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

# ----------------------------------------------------------------------------------------------
# Container-scoped Claude Code settings: enable the project's statusline
# script. /etc/claude-code/managed-settings.json is the system-managed
# settings location and is NOT bind-mounted from the host, so this config
# applies only inside the container without touching ~/.claude on the host.
# The workspace bind-mount in docker-compose.yml exposes the script at
# /workspace/.devcontainer/claude/statusline-command.sh.
RUN set -eux; \
    mkdir -p /etc/claude-code; \
    printf '{\n  "statusLine": {\n    "type": "command",\n    "command": "${PROJECT_PATH}/.devcontainer/claude/statusline-command.sh",\n    "padding": 0\n  }\n}\n' \
    > /etc/claude-code/managed-settings.json
