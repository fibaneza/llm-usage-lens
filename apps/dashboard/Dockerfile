# Dashboard image for ECS Fargate (docs/specs/2026-11-10-platform.md - Runtime).
# Build from the repo root: docker build -f apps/dashboard/Dockerfile .

FROM node:24.22.3-alpine3.24@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY infra/package.json infra/package.json
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @llm-usage-lens/dashboard...

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/dashboard apps/dashboard
# Optional URL prefix, compiled into the bundles (Platform spec - Base path,
# BP-D6); empty serves from /. next.config.ts validates it, since env
# validation is skipped here.
ARG NEXT_PUBLIC_BASE_PATH=""
# Env validation is skipped only here; runtime env comes from the task definition.
ENV SKIP_ENV_VALIDATION=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH} \
    # Build-time placeholder only; no client code reads NEXT_PUBLIC_APP_URL today.
    NEXT_PUBLIC_APP_URL=http://localhost:3000
# The build stage copies only tsconfig.base.json, packages/shared and apps/dashboard
# (repo-root scripts/ is never copied), and the root .dockerignore drops **/e2e and
# *.test.ts(x). apps/dashboard/test/ and probe/ are still copied and import
# ../../e2e/ (absent) and the repo-root scripts/ (absent), and the tsconfig include
# covers them, so next build's type check would fail. Exclude them for the image
# build only; the app code is type-checked as usual.
RUN node -e "const f='apps/dashboard/tsconfig.json',c=JSON.parse(require('fs').readFileSync(f,'utf8'));c.exclude=[...c.exclude,'e2e','probe','test','playwright.config.ts','vitest.config.ts','**/*.test.ts','**/*.test.tsx'];require('fs').writeFileSync(f,JSON.stringify(c,null,2))" \
 && mkdir -p apps/dashboard/public \
 && pnpm --filter @llm-usage-lens/dashboard build \
 && pnpm --filter @llm-usage-lens/dashboard run build:jobs

FROM node:24.22.3-alpine3.24@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS runner
WORKDIR /repo
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Smaller runtime surface: the server starts with `node` alone, so the npm,
# npx, corepack and yarn bundled in the base image (and their dependencies,
# the source of the base image's CVEs) are removed; the OS packages are patched.
# apk upgrade is unpinned on purpose: it takes the base image's patched Alpine packages at build time (the base image is pinned by digest, so builds are reproducible up to Alpine security updates).
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
 && addgroup -S -g 1001 app && adduser -S -u 1001 -G app app
COPY --from=build --chown=app:app /repo/apps/dashboard/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/dashboard/.next/static apps/dashboard/.next/static
COPY --from=build --chown=app:app /repo/apps/dashboard/public apps/dashboard/public
# The scheduled LiteLLM user sync job: one self-contained bundle, run with
# `node apps/dashboard/jobs/sync-litellm-users.cjs` by the schedule's command
# override (Platform spec - Scheduled job, unit SYNC2).
COPY --from=build --chown=app:app /repo/apps/dashboard/jobs/sync-litellm-users.cjs apps/dashboard/jobs/sync-litellm-users.cjs
# The baked-in app config (System Architecture — Configuration file): the loader
# reads apps/dashboard/config/config.yaml relative to its own module, and the
# standalone trace does not carry a file that is only read at runtime.
COPY --from=build --chown=root:root --chmod=0444 /repo/apps/dashboard/config/config.yaml apps/dashboard/config/config.yaml
# COPY --chmod also applied 0444 to the created config/ directory, so the
# non-root user could not traverse it to read config.yaml.
RUN chmod 0555 apps/dashboard/config
USER app
EXPOSE 3000
CMD ["node", "apps/dashboard/server.js"]
