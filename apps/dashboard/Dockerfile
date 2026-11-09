# Dashboard image for ECS Fargate (docs/specs/2026-11-10-platform.md - Runtime).
# Build from the repo root: docker build -f apps/dashboard/Dockerfile .

FROM node:22-alpine AS base
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
# Env validation is skipped only here; runtime env comes from the task definition.
ENV SKIP_ENV_VALIDATION=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    # Build-time placeholder only; no client code reads NEXT_PUBLIC_APP_URL today.
    NEXT_PUBLIC_APP_URL=http://localhost:3000
RUN mkdir -p apps/dashboard/public \
 && pnpm --filter @llm-usage-lens/dashboard build

FROM node:22-alpine AS runner
WORKDIR /repo
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S -g 1001 app && adduser -S -u 1001 -G app app
COPY --from=build --chown=app:app /repo/apps/dashboard/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/dashboard/.next/static apps/dashboard/.next/static
COPY --from=build --chown=app:app /repo/apps/dashboard/public apps/dashboard/public
USER app
EXPOSE 3000
CMD ["node", "apps/dashboard/server.js"]
