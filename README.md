# Bedrock Cost Tracker

Dashboard and serverless collector for Amazon Bedrock cost and usage, built as a pnpm monorepo. See [CLAUDE.md](CLAUDE.md) for project conventions, [ONBOARDING.md](ONBOARDING.md) for contributor setup, and [docs/specs/](docs/specs/) for the source-of-truth specs.

## Quick start

```bash
corepack enable
pnpm install
pnpm dev
```

The dashboard runs at http://localhost:3000.

## Local data (DynamoDB Local)

The dashboard reads from DynamoDB Local in development. Start it:

```bash
docker compose up -d dynamodb-local
```

That form works inside `.devcontainer`. From the host, point at the compose file:

```bash
docker compose -f .devcontainer/docker-compose.yml up -d dynamodb-local
```

Then create the table and load seed data:

```bash
pnpm db:create-table   # idempotent
pnpm db:seed           # realistic data: departments, teams, users, services, 30 days
```

Other seed variants:

- `pnpm db:seed:empty` - accounts only, no rollups (resets the table)
- `pnpm db:seed:large` - stress test: 50 accounts, 90 days
- `pnpm db:seed:ranking` - 100 accounts x 30 days

The scripts default to `http://localhost:8000` and must never target real AWS.

**macOS host note:** the compose service's `-dbPath /data` volume may be unwritable. Run an in-memory instance instead:

```bash
docker run -d -p 8000:8000 amazon/dynamodb-local:2.5.4 -jar DynamoDBLocal.jar -inMemory -sharedDb
```

## Tests

| Command | Runs |
|---|---|
| `pnpm test:unit` | Unit and component tests (no DynamoDB needed) |
| `pnpm test:integration` | Data-access tests against DynamoDB Local on `:8000` |
| `pnpm test` | Both Vitest projects (needs DynamoDB Local, created and seeded) |
| `pnpm test:e2e` | Headless Playwright E2E |

The pre-push hook runs the unit project only; CI runs everything against a DynamoDB Local service.
