# Operations Runbook - Dashboard on ECS Fargate

Day-two procedures for the dashboard platform. Source:
[Platform spec](../specs/2026-11-10-platform.md) - *Operations*. Build and
first deploy: [dashboard-deployment.md](dashboard-deployment.md). All
commands are user actions (`aws sso login` first; Rule 50.1). Identifiers
below are placeholders (`123456789012`, Rule 50.9). Alarm notifications go to
the existing SNS topic supplied as `alarmTopicArn`.

## Alarms and first look

| Alarm | Meaning | First look |
|---|---|---|
| Running task count below desired | Fewer tasks running than the service wants (`ECS/ContainerInsights` `RunningTaskCount`) | ECS console, service Events tab: image pull, health-check or capacity errors. `aws ecs describe-services --cluster <cluster> --services <service>` |
| Task failures / restarts | Tasks stopping or restarting | `aws ecs list-tasks --desired-status STOPPED`, then `describe-tasks` for `stoppedReason`; app log group for the crash. A failed deploy rolls back (circuit breaker) |
| Target-group unhealthy hosts and 5xx (create mode only) | Targets fail `/api/health` or return 5xx | Target group health in the console; app log group. In import mode the shared ALB's own alarms apply |
| Application 5xx | Log metric filter on the app log group | Logs Insights on the app log group for the failing route and stack. `/api/health` returns `200` with `status: degraded` when DynamoDB is unreachable, so look at its body too |
| Security events | Metric filter on `/llm-usage-lens/<env>/audit`: global-role grants, master-user sign-ins, failures, lockouts | Logs Insights on the audit log group; confirm each event against an expected admin action. Unexpected: treat as an incident (Access Control spec - *Threat model*) |

`/api/health` needs no session and exposes no data, only
`ok`/`degraded` and per-dependency status.

## Redeploy

- **New code:** run the `llm-usage-lens-deploy.yml` workflow (`environment` =
  dev or prod). It builds the image tagged with the commit SHA, pushes it, and
  deploys the AppStack.
- **Roll back:** redeploy a previous SHA with
  `cdk deploy LlmUsageLens-<env>-App --exclusively -c imageTag=<previous-sha> ...`.
- **Restart without a change:** `aws ecs update-service --cluster <cluster>
  --service <service> --force-new-deployment`.

## Secret rotation

Tasks read secrets only at start, so rotate then force a new deployment.

- **`AUTH_SECRET`:** overwrite `/llm-usage-lens/<env>/app/auth-secret`
  (`aws ssm put-parameter --overwrite --type SecureString ...`), force a new
  deployment. All sessions are invalidated; users sign in again.
- **Entra client secret:** create the new secret in the Entra app
  registration, overwrite `/llm-usage-lens/<env>/app/entra-client-secret`,
  force a new deployment, verify sign-in, then delete the old secret in Entra.
- **LiteLLM service key:** parameter `/llm-usage-lens/<env>/litellm/service-key`
  (hand-managed `SecureString`, project CMK); rotation is in
  [litellm-admin.md](litellm-admin.md) §6 (new key → update SSM → force a new
  deployment → connection test → block and delete the old key). The task
  definition wiring lands in LiteLLM unit L1.
- **Master-user custody:** placeholder until Phase 4R.1 (R1) defines the
  Argon2id hash and TOTP parameters, who holds the break-glass credential and
  how it is rotated.

The CI deploy role cannot read these parameters.

## Deploy and undeploy

Order: **InfraStack, then AppStack**. Undeploy in reverse.

- **Deploy:** see [dashboard-deployment.md](dashboard-deployment.md) section 6.
- **Undeploy AppStack:** `cdk destroy LlmUsageLens-<env>-App --exclusively`. In import
  mode this removes only the target group, listener rule and ingress rule it
  added; the shared ALB is untouched. The audit log group is retained, so a
  redeploy first needs it imported or removed (see *Known gaps and retained
  resources*).
- **Undeploy InfraStack:** it has termination protection and `RETAIN` on the
  table and CMK. Disable termination protection on the stack deliberately
  first. Destroying the stack still **keeps the DynamoDB table and the
  KMS key** (and their data); deleting those is a separate, explicit manual
  step. Destroy the AppStack first.

## Known gaps and retained resources

- The application 5xx metric filter matches structured JSON request logs
  (`$.status >= 500`). The dashboard does not emit them yet, so that alarm
  stays quiet until a logging unit adds structured request logs.
- The audit log group `/llm-usage-lens/<env>/audit` is **retained** when the
  AppStack is destroyed (400-day audit retention). Redeploying the AppStack
  then fails on the name clash: import the existing group or delete it by
  hand first. This is a user action.

## Cost posture

Fargate tasks, ECR storage and CloudWatch Logs (audit group kept 400 days),
plus the internal ALB only in create mode. ECS Container Insights is a paid CloudWatch feature (custom metrics),
required by the running-task alarm. No NAT gateway, VPC endpoints,
cache, WAF or certificate cost. The KMS CMK and DynamoDB are accepted costs
(CLAUDE.md - *Cost posture*).
