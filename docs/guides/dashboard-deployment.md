# Dashboard Deployment Guide - ECS Fargate (CDK)

Operational runbook for building and deploying the Next.js dashboard
(`apps/dashboard`) on **AWS ECS Fargate**, defined in CDK under `infra/`.
This replaces the Netlify runbook (retired 2026-11-10, Phase 4R.P).

> Source of truth: the [Platform spec](../specs/2026-11-10-platform.md).
> Day-two procedures (alarms, rotation, undeploy) are in
> [operations.md](operations.md). **Deploying is always a user action**;
> agents run `cdk synth` only and never call AWS.

## 1. Hosting model

- Image built from `apps/dashboard/Dockerfile` (Next.js `output: "standalone"`,
  Node 22, non-root, port 3000), stored in the FoundationStack's ECR repository.
- Two stacks per environment (`dev` or `prod`), region `ap-southeast-2`
  (`COLLECTOR_REGION`, Rule 50.7):
  - `LlmUsageLens-<env>-Infra`: DynamoDB table, KMS CMK, ECS cluster, ECR
    repository, SSM parameters `/llm-usage-lens/<env>/infra/*`. Termination
    protection on; the table and CMK are `RETAIN`.
  - `LlmUsageLens-<env>-App`: task definition, Fargate service, log groups,
    alarms, roles, target group and listener rule, the CI deploy role.
- Stacks share values through SSM parameters, never CloudFormation exports.
- Credentials: the task role through the default chain; no static AWS keys
  (Rule 50.1). `DYNAMODB_ENDPOINT` is never set in the task.

## 2. Prerequisites (user actions)

- Existing VPC with private subnets and Transit Gateway routing (Entra ID
  sign-in egress); an ACM certificate; an SNS alarm topic.
- Either an existing ALB HTTPS listener (import mode) or a list of company
  CIDRs (create mode builds one internal ALB).
- The account's GitHub OIDC provider
  (`token.actions.githubusercontent.com`); create it once if absent.
- AWS SSO session: `aws sso login` with `AWS_PROFILE` set (Rule 50.1).
- CDK bootstrap for the account/region, run with a scoped
  `--cloudformation-execution-policies` (a customer-managed policy limited to
  what the stacks create), **not** `AdministratorAccess`. The CI deploy role
  assumes the bootstrap deploy role, so an over-broad execution policy
  widens what CI can do; leaving the default is a recorded residual risk.
- GitHub environments `dev` and `prod` (Settings, Environments). The CI role
  trust is scoped to `repo:<owner/repo>:environment:<env>`, so the deploy
  job only works from an environment of that name. Add protection rules
  (required reviewers) on `prod`.
- **Break-glass permission set (`prod`, recommended)** — Platform spec,
  *Data isolation*. In IAM Identity Center create a dedicated permission set
  (for example `LlmUsageLensBreakGlass`) with read and write on the
  `bedrock-usage` table and `kms:Decrypt` on the project CMK only; assign it
  to one or two named people, with MFA. Note its role ARN in the account (IAM
  roles, `AWSReservedSSO_LlmUsageLensBreakGlass_<suffix>`, under the path
  `/aws-reserved/sso.amazonaws.com/...`) for `opsRoleArn`. Re-provisioning
  the permission set changes the suffix: update `opsRoleArn` and redeploy
  the FoundationStack.
- **CloudTrail data events on the table** — on the account trail, an
  advanced event selector for DynamoDB data events on the table ARN, so
  break-glass reads and writes can be reviewed (small per-event cost).

## 3. Inputs (CDK context)

Pass with `-c key=value`; lists are comma-separated. Never commit real values
(Rule 50.9); examples use placeholders.

| Key | Mode | Example |
|---|---|---|
| `env` | both | `dev` or `prod` |
| `account` | both | `123456789012` |
| `vpcId` | both | `vpc-00000000000000000` |
| `availabilityZones` | both | `ap-southeast-2a,ap-southeast-2b` |
| `privateSubnetIds` | both | `subnet-00000000000000001,subnet-00000000000000002` |
| `certificateArn` | both | ACM certificate ARN |
| `dashboardHostname` | both | `llm-usage-lens.example.internal` |
| `alarmTopicArn` | both | existing SNS topic ARN |
| `entraClientId` | both | Entra application (client) ID (non-secret); the workflow reads `vars.ENTRA_CLIENT_ID` |
| `entraIssuer` | both | `https://login.microsoftonline.com/<tenant>/v2.0`; the workflow reads `vars.ENTRA_ISSUER` |
| `githubRepository` | both | `owner/repo` |
| `imageTag` | both | image tag, default `latest` |
| `masterUsername` | both | optional break-glass master user name; its hash and TOTP secret are hand-managed SSM SecureStrings under `/llm-usage-lens/<env>/auth/` |
| `opsRoleArn` | both | `prod`: the break-glass permission set's role ARN (section 2; recommended — synth warns when unset); `dev`: unset or your usual admin role |
| `dynamodbVpcEndpointId` | both | optional existing DynamoDB gateway endpoint, e.g. `vpce-00000000000000000` |
| `listenerArn`, `listenerRulePriority`, `albSecurityGroupId` | import | listener ARN, unique priority agreed with the ALB owner, the ALB's security group |
| `companyCidrs` | create | `10.0.0.0/8` (never `0.0.0.0/0`) |

Import mode is selected when `listenerArn` is present.

## 4. Secrets

Create these SSM SecureStrings yourself; CDK never creates or reads them:

```sh
aws ssm put-parameter --type SecureString --key-id <cmk-alias-or-arn> \
  --name /llm-usage-lens/<env>/app/auth-secret --value "$(openssl rand -base64 32)"
aws ssm put-parameter --type SecureString --key-id <cmk-alias-or-arn> \
  --name /llm-usage-lens/<env>/app/entra-client-secret --value '<Entra client secret>'
```

The task definition injects them as `AUTH_SECRET` and
`AUTH_MICROSOFT_ENTRA_ID_SECRET`. Non-secret Entra values and
`NEXT_PUBLIC_APP_URL` (`https://<dashboardHostname>`) are plain environment.
`AUTH_DEV_LOGIN` must stay unset in the task. Register
`https://<dashboardHostname>/api/auth/callback/microsoft-entra-id` as a redirect URI in the Entra
app registration.

## 5. Synth (safe, no AWS calls)

```sh
pnpm --filter @llm-usage-lens/infra synth -c env=dev -c account=123456789012 \
  -c vpcId=vpc-00000000000000000 ...   # all inputs from section 3
```

## 6. Deploy (user action)

Order: FoundationStack, then DashboardServiceStack.

1. `cdk deploy LlmUsageLens-<env>-Infra` (once; from `infra/`, with the
   inputs). Note the table, key, cluster and repository outputs in SSM.
2. Create the two secrets (section 4).
3. Build and push the image, then deploy the DashboardServiceStack. Locally:
   `docker build -f apps/dashboard/Dockerfile -t <repo-uri>:<tag> .`, `docker push`, then
   `cdk deploy LlmUsageLens-<env>-App --exclusively -c imageTag=<tag> ...`. The first DashboardServiceStack deploy
   also creates the CI deploy role; later deploys can run the
   `llm-usage-lens-deploy.yml` workflow (see [ACTIONS.md](../../.github/ACTIONS.md)).
4. Create the internal DNS record: `<dashboardHostname>` to the ALB
   (CNAME or alias). In create mode the ALB DNS name is a stack output; in
   import mode it is the shared ALB's.
. Verify the data isolation (Platform spec — *Data isolation*), in `dev`
   first: a `GetItem` on the table with an account admin role that is **not**
   `opsRoleArn` must return `AccessDeniedException`, and the dashboard must
   still sign in and load. Only then deploy the FoundationStack to `prod`.

Writes are accepted only when the browser's `Origin` host equals the `Host`
header the task receives (Access Control spec — *Enforcement* item 6). The
ALB forwards `Host` unchanged; keep the HTTPS listener on 443 and serve the
dashboard only at `<dashboardHostname>`, or account edits return `403`.

## 7. Undeploy

See [operations.md](operations.md) - *Deploy and undeploy*. The FoundationStack
retains the table and CMK by design.
