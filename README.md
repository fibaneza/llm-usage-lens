# LLM Usage Lens

[![llm-usage-lens: ci - build](https://github.com/fibaneza/llm-usage-lens/actions/workflows/llm-usage-lens-build.yml/badge.svg?branch=main)](https://github.com/fibaneza/llm-usage-lens/actions/workflows/llm-usage-lens-build.yml)

Enterprise observability dashboard and serverless collector for **Amazon Bedrock** and **LiteLLM** cost, usage, and attribution. Built as a pnpm monorepo with Next.js 16, DynamoDB, OpenTelemetry, and AWS CDK.

See [CLAUDE.md](CLAUDE.md) for project conventions, [ONBOARDING.md](ONBOARDING.md) for contributor setup, and [docs/specs/](docs/specs/) for the source-of-truth specs.

---

## Features

- **Multi-dimensional Attribution:** Track LLM spend and token consumption across departments, teams, users, services, models, and inference profiles.
- **Enterprise Access Control (RBAC):** Role-based authorization (`internal-admin`, `internal-org-admin`, `internal-team-admin`, `internal-auditor`, `internal-viewer`) with Microsoft Entra ID SSO integration and local dev authentication outside production.
- **LiteLLM Gateway Integration:** Proxy connection, spend tracking, user/team management, and API key governance alongside native Bedrock usage.
- **Built-in Observability Pipeline:** Self-hosted DevContainer observability stack with OpenTelemetry Collector, Prometheus, Loki, and pre-provisioned Grafana dashboards.
- **Infrastructure as Code:** AWS CDK stacks (`FoundationStack`, `DashboardServiceStack`) deploying to ECS Fargate behind an Application Load Balancer (ALB).

---

## Monorepo Layout

```
.
├── apps/
│   ├── dashboard/            # Next.js 16 (App Router) analytics dashboard & API routes
│   └── collector/            # AWS Lambda hourly collector for real Bedrock data (Phase 6)
├── packages/
│   └── shared/               # Shared domain schemas, pricing tables, and normalizers
├── infra/                    # AWS CDK platform infrastructure (ECS Fargate, ALB, CloudWatch)
├── scripts/                  # DynamoDB table management and realistic data seeders
├── tools/
│   └── bedrock-simulator/    # Standalone AWS SAM test harness for generating Bedrock traffic
├── .devcontainer/            # DevContainer configuration, Docker Compose, and OTel/Grafana stack
└── docs/                     # Specifications (docs/specs/) and runbooks (docs/guides/)
```

---

## Quick Start

### Prerequisites

- **Node.js** >= 22
- **pnpm** (enabled via `corepack enable`)
- **Docker** (for DynamoDB Local and local observability stack)

### 1. Install dependencies

```bash
corepack enable
pnpm install
```

### 2. Configure environment variables

Copy the template to `.env.local`:

```bash
cp apps/dashboard/.env.example apps/dashboard/.env.local
```

The template is pre-configured for local development with `APP_ENV=dev`, local mock login (`AUTH_DEV_LOGIN=true`), and a development `AUTH_SECRET`.

### 3. Start local data store (DynamoDB Local)

Inside `.devcontainer`:

```bash
docker compose up -d dynamodb-local
```

From the host machine:

```bash
docker compose -f .devcontainer/docker-compose.yml up -d dynamodb-local
```

### 4. Create the table and load seed data

```bash
pnpm db:create-table   # idempotent table creation
pnpm db:seed           # realistic data: departments, teams, users, services (30 days)
```

Other seed variants:
- `pnpm db:seed:empty` — accounts only, resets rollups
- `pnpm db:seed:large` — stress test: 50 accounts x 90 days
- `pnpm db:seed:ranking` — stress test: 100 accounts x 30 days

> **macOS host note:** If the Docker volume's permissions fail on macOS, run an in-memory instance instead:
> ```bash
> docker run -d -p 8000:8000 amazon/dynamodb-local:2.5.4 -jar DynamoDBLocal.jar -inMemory -sharedDb
> ```

### 5. Start the development server

```bash
pnpm dev
```

Visit [http://localhost:3000](http://localhost:3000) and click **Sign in with Dev User** (select any role to test scoped views).

---

## Environment Hierarchy

Dashboard environment variables live in `apps/dashboard/` and follow this precedence (highest priority first):

1. **Process Environment (`process.env`):** Shell variables, CLI overrides (e.g. in `pnpm build:ci`), and container env.
2. **`.env.<NODE_ENV>.local`:** e.g. `.env.development.local` (git-ignored).
3. **`.env.local`:** Personal developer overrides and real secrets (git-ignored).
4. **`.env.<APP_ENV>`:** `.env.dev` or `.env.prod` layered by Next.js based on `APP_ENV`.
5. **`.env.<NODE_ENV>`:** Mode defaults (`.env.development`, `.env.production`).
6. **`.env`:** Base shared local defaults.
7. **Schema Defaults:** Fallbacks validated by `@t3-oss/env-nextjs` in `apps/dashboard/env.ts`.

---

## Development Scripts & Testing

| Command | Purpose |
|---|---|
| `pnpm dev` | Starts the Next.js dev server on `http://localhost:3000` |
| `pnpm build` | Compiles the Next.js production build |
| `pnpm build:ci` | Builds with placeholder environment variables for CI validation |
| `pnpm check` | **Full pre-merge gate:** runs `typecheck`, `lint`, `format:check`, `vitest run`, and `build:ci` |
| `pnpm typecheck` | Type-checks monorepo packages (`tsc --noEmit`) and root scripts |
| `pnpm lint` | ESLint v9 flat config check |
| `pnpm format:check` | Checks formatting with Prettier (`pnpm format` to auto-fix) |
| `pnpm test:unit` | Runs Vitest unit & component tests (jsdom, no DynamoDB needed) |
| `pnpm test:integration` | Runs Vitest integration tests against DynamoDB Local on `:8000` |
| `pnpm test` | Runs both Vitest projects (requires DynamoDB Local) |
| `pnpm test:e2e` | Runs headless Playwright end-to-end tests in `apps/dashboard/e2e` |

### Git Hooks & CI

- **Pre-commit:** Scans staged files with Gitleaks for secrets, then runs `lint-staged` (ESLint `--fix` + Prettier).
- **Commit-msg:** Validates commit message format against Conventional Commits via Commitlint.
- **Pre-push:** Runs `pnpm typecheck` and `pnpm test:unit` when dashboard paths change, plus simulator checks when `tools/bedrock-simulator/` changes.
- **CI Workflow:** The `llm-usage-lens-build.yml` workflow runs full typechecking, linting, formatting, integration tests against DynamoDB Local, and `build:ci`.

---

## DevContainer & Observability Stack

When developing inside the provided VS Code DevContainer, an integrated observability stack is automatically available:

- **Dashboard:** [http://localhost:3000](http://localhost:3000)
- **Grafana:** [http://localhost:3001](http://localhost:3001) (Pre-configured dashboards; admin password seeded in `.devcontainer/grafana/grafana_admin_password.txt`)
- **Prometheus:** [http://localhost:9090](http://localhost:9090)
- **Loki:** [http://localhost:3100](http://localhost:3100)
- **OpenTelemetry Collector:** Ports `4317` (gRPC) and `4318` (HTTP)
- **DynamoDB Local:** Port `8000` (on demand)

See [.devcontainer/README.md](.devcontainer/README.md) for pipeline details and telemetry configuration.

---

## Documentation Index

- **Specifications:**
  - [System Architecture](docs/specs/2026-05-15-system-architecture.md)
  - [Data Model & DynamoDB Design](docs/specs/2026-05-15-data-model.md)
  - [Design System (Strata)](docs/specs/2026-05-15-design-system.md)
  - [Implementation Phases](docs/specs/2026-05-15-implementation-phases.md)
  - [Access Control & RBAC](docs/specs/2026-11-10-access-control.md)
  - [LiteLLM Integration](docs/specs/2026-11-10-litellm.md)
  - [ECS Platform & CDK Infrastructure](docs/specs/2026-11-10-platform.md)
- **Runbooks & Guides:**
  - [Auth Setup (Entra ID & AWS Credentials)](docs/guides/auth-setup.md)
  - [Dashboard Deployment Runbook](docs/guides/dashboard-deployment.md)
  - [LiteLLM Administration](docs/guides/litellm-admin.md)
  - [Bedrock Simulator Runbook](docs/guides/bedrock-simulator.md)
  - [Git Hooks & Secret Scanning](docs/guides/git-hooks.md)
