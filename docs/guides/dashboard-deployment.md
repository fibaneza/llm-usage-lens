# Dashboard Deployment Guide — Next.js on Netlify

Operational runbook for the Next.js dashboard (`apps/dashboard`): how it is
built and hosted, the environment it needs, and the CLI commands to deploy and
undeploy it on **Netlify**.

> Design source of truth: [docs/specs/2026-05-15-design-system.md](../specs/2026-05-15-design-system.md) and
> [docs/specs/2026-05-15-system-architecture.md](../specs/2026-05-15-system-architecture.md). This guide is the
> *operational* companion.

---

## 1. Hosting model

The dashboard is hosted on **Netlify** with `@netlify/plugin-nextjs`. Netlify
runs Next.js Server Components and Route Handlers as serverless functions; the
collector and DynamoDB stay in AWS (see [docs/guides/aws-infrastructure.md](aws-infrastructure.md)).

The repo is a **pnpm monorepo** — the dashboard is one workspace under
`apps/dashboard` and depends on `@bedrock-usage/shared`. Netlify must build from
the repo root so pnpm can resolve the workspace, with the base directory
pointed at the app.

---

## 2. AWS credentials on Netlify — important

The dashboard's server code reads DynamoDB through the AWS SDK. In AWS-native
hosting this uses IAM roles or SSO. **Netlify functions cannot assume an AWS IAM
role**, so the dashboard needs explicit AWS credentials supplied as environment
variables.

**Approach:** create a dedicated IAM user with a **read-only, table-scoped**
policy — `dynamodb:GetItem`, `Query`, `Scan` on the `bedrock-usage` table and
its GSI1 only, nothing else. Store its access key in Netlify env vars.

> **Pending decision — not yet an approved exception.** Rule 50.1 ("never use
> static `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`") covers all real-AWS
> access, including this dashboard's server — not only the collector. The specs
> keep dashboard hosting a future decision (implementation-phases spec, CD
> section), so this key is a **proposal**: it becomes an exception only when the
> System Architecture spec (*Authentication & Access*) records it and Rule 50.1
> cites that entry. Do not deploy with it before then.

The proposal: a host with no role mechanism gets a tightly-scoped key.
Mitigations:

- Read-only and scoped to one table — a leak cannot write data or reach other
  resources.
- Rotate the key on a schedule.
- The collector continues to use roles/OIDC — it is unaffected.

**Settings writes.** Phase 3.3 added `POST`/`PATCH`/`DELETE /api/accounts`,
which write `AccountMeta` items (`PutItem` with a condition, `UpdateItem`). A
read-only key makes those routes fail with a 500 — every read page still
works. Whether Phase 4.9 widens the key or uses a separate write principal is
part of the same spec decision. Who may write is decided: only the `Admin`
app role (System Architecture spec — *Authentication & Access*, 2026-10-29).

---

## 3. Build settings

Configure in `netlify.toml` at the repo root (or the Netlify UI):

```toml
[build]
  base = "."                         # repo root — pnpm workspace lives here
  command = "pnpm --filter dashboard build"
  publish = "apps/dashboard/.next"

[[plugins]]
  package = "@netlify/plugin-nextjs"

[build.environment]
  NETLIFY_USE_PNPM = "true"
  NODE_VERSION = "22"
```

If Netlify's monorepo detection is used instead, set the **base directory** to
`apps/dashboard` in the UI and let the plugin infer the rest — but the
root-level `base` above is more reliable for pnpm workspace resolution.

---

## 4. Environment variables

Set these in **Site settings → Environment variables** (never commit values).
Names mirror `.env.example`.

| Variable | Purpose |
|----------|---------|
| `AUTH_SECRET` | Auth.js session encryption secret |
| `AUTH_URL` | Deployed site URL (e.g. `https://<site>.netlify.app`) |
| `AUTH_MICROSOFT_ENTRA_ID_ID` | Entra ID app client ID |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | Entra ID app client secret |
| `AUTH_MICROSOFT_ENTRA_ID_ISSUER` | Tenant-specific issuer `https://login.microsoftonline.com/<Directory (tenant) ID>/v2.0`: lowercase GUID, no trailing slash; `common`, `organizations` and `consumers` fail the build (System Architecture spec — *Authentication & Access*) |
| `AUTH_DEV_LOGIN` | **Must be unset** in production — any non-empty value fails startup (dev-only local login) |
| `AWS_REGION` | `ap-southeast-2` (the DynamoDB table's Region) |
| `AWS_ACCESS_KEY_ID` | Scoped read-only IAM user key (see §2) |
| `AWS_SECRET_ACCESS_KEY` | Scoped read-only IAM user secret (see §2) |
| `DYNAMODB_TABLE_NAME` | `bedrock-usage` |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME` | OpenTelemetry OTLP export (Grafana Cloud) |
| `NEXT_PUBLIC_APP_URL` | Deployed site URL |

Do not override `NODE_ENV` in production: the dev-only login is kept out of production by `NODE_ENV=production` (set by `next start`) together with an unset `AUTH_DEV_LOGIN`.

`DYNAMODB_ENDPOINT` is **not** set in production — it is for DynamoDB Local
only. Leaving it unset makes the SDK target real AWS DynamoDB.

Env vars are validated at build time by `@t3-oss/env-nextjs`; a missing
variable fails the Netlify build with a clear error.

Also register the deployed URL as a **redirect URI** in the Entra ID app
registration: `https://<site>.netlify.app/api/auth/callback/microsoft-entra-id`.

---

## 5. Prerequisites

```sh
# Netlify CLI
npm install -g netlify-cli
netlify --version
netlify login                       # opens a browser to authenticate
```

---

## 6. Deploy

### First-time link

```sh
# From the repo root
netlify link                        # connect this repo to a Netlify site
# or: netlify sites:create --name bedrock-cost-dashboard
```

### Deploy to production

```sh
netlify deploy --build --prod
```

`--build` runs the build command on Netlify's side; `--prod` promotes it to the
live URL. Omit `--prod` for a draft deploy with a unique preview URL.

### Continuous deploys

Once the site is linked to the GitHub repo, Netlify auto-builds on push. The CLI
deploy above is for manual / break-glass releases. Keep the GitHub Actions
`quality`, `test`, and `build` jobs as the pre-merge gate; Netlify's own build
is the deploy step.

### Verify

```sh
netlify open:site                    # open the live URL
netlify logs:function                # tail server function logs
```

Check: the site loads, Microsoft Entra ID sign-in works, and a data page
renders rollups from DynamoDB.

---

## 7. Undeploy

```sh
# Roll back to a previous deploy (non-destructive)
netlify rollback

# Stop auto-deploys but keep the site — unlink from the repo in the UI,
# or take the site down entirely:
netlify sites:delete --name bedrock-cost-dashboard
```

`netlify sites:delete` is irreversible — it removes the site, its deploys, and
its environment variables. After deleting the site, also **deactivate the
scoped IAM user's access key** in AWS so the orphaned credential cannot be used:

```sh
aws iam update-access-key --user-name <dashboard-reader-user> \
  --access-key-id <key-id> --status Inactive --profile <observability-profile>
```

---

## 8. Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| Build fails: `AUTH_MICROSOFT_ENTRA_ID_ISSUER must be https://login.microsoftonline.com/<tenant GUID, lowercase>/v2.0` | The issuer uses `common`/`organizations`/`consumers`, a domain name, an uppercase GUID or a trailing slash. Copy the Directory (tenant) ID from the app registration |
| Build fails resolving `@bedrock-usage/shared` | Base directory not the repo root, or pnpm not enabled — check §3 |
| Build fails with a missing-env-var error | `@t3-oss/env-nextjs` validation — set the variable in Netlify (see §4) |
| Sign-in redirect loop or `redirect_uri_mismatch` | Entra ID app registration missing the Netlify callback URL, or `AUTH_URL` wrong |
| Data pages error with an AWS credentials / `AccessDenied` message | Scoped IAM key missing, inactive, or its policy too narrow |
| Data pages try to reach `localhost:8000` | `DYNAMODB_ENDPOINT` is set in production — remove it |

---

## Related docs

- [docs/guides/aws-infrastructure.md](aws-infrastructure.md) — the collector and AWS-side IaC
- [docs/guides/auth-setup.md](auth-setup.md) — Auth.js + Microsoft Entra ID and AWS credentials
- [docs/specs/2026-05-15-design-system.md](../specs/2026-05-15-design-system.md) — tech stack and design decisions
