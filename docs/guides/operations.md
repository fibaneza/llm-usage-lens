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
| Task failures / restarts | Tasks stopping or restarting | `aws ecs list-tasks --desired-status STOPPED`, then `describe-tasks` for `stoppedReason`; app log group for the crash. The environment is validated when the server starts, so a missing or invalid variable stops the task at boot and the first app log lines name it. A failed deploy rolls back (circuit breaker) |
| Target-group unhealthy hosts and 5xx (create mode only) | Targets fail `/api/health` or return 5xx | Target group health in the console; app log group. In import mode the shared ALB's own alarms apply |
| Application 5xx | Log metric filter on the app log group | Logs Insights on the app log group for the failing route and stack. `/api/health` returns `200` with `status: degraded` when DynamoDB is unreachable, so look at its body too |
| Security events | Metric filter on `/llm-usage-lens/<env>/audit`: global-role grants, master-user sign-ins, failures, lockouts | Logs Insights on the audit log group; confirm each event against an expected admin action. Unexpected: treat as an incident (Access Control spec - *Threat model*) |
| LiteLLM user sync failed (only with `litellmUserSyncSchedule`) | An EventBridge rule on the ECS task state change: the scheduled job's task stopped with a non-zero exit code, or failed to start | The job's log lines in the app log group (the run id is on every record); `aws ecs describe-tasks` for `stoppedReason` and the container exit code. A truncated plan or the 10-minute deadline exits non-zero by design |
| No successful LiteLLM user sync in 2 days (same condition) | The success log line is missing (missing data breaches), so the job did not start or kept failing (a skipped run, toggle off or lease held, counts as completed). The alarm starts in ALARM right after deploy, until the first successful run | Management → Users and the audit log for the last `litellm.user.sync` record; the toggle `syncLiteLLMUsers`; the EventBridge Scheduler schedule's state |

`/api/health` needs no session and exposes no data, only
`ok`/`degraded` and per-dependency status.

## LiteLLM user sync schedule

Only with the `litellmUserSyncSchedule` input (Platform spec — *Scheduled
job — LiteLLM user sync*). The schedule runs one Fargate task from the
dashboard task definition with the command override
`node apps/dashboard/jobs/sync-litellm-users.cjs`; it places people by the
same rules as an on-demand Apply and never writes to LiteLLM.

- **Run it once by hand:** `aws ecs run-task` with the dashboard cluster,
  the task-definition family, the private subnets, the service's security
  group, public IP disabled and that command override (a user action; it
  takes the same lease, so it cannot overlap a run).
- **Switch it off:** turn the `syncLiteLLMUsers` toggle off in Settings →
  LiteLLM (the job then skips with exit 0 and writes a `skipped` summary), or
  remove the input (or set it to `off`) and redeploy, which deletes the
  schedule, its role, the rule and the alarm.
- **Time:** 18:00 UTC is 04:00 AEST and 05:00 AEDT in Sydney.
- **Cost:** EventBridge Scheduler has no charge at one invocation a day; one
  Fargate task of one to two minutes a day is a few cents a month.

## Redeploy

- **New code:** run the `llm-usage-lens-deploy.yml` workflow (`environment` =
  dev or prod). It builds the image tagged with the commit SHA, pushes it, and
  deploys the DashboardServiceStack.
- **Roll back:** redeploy a previous SHA with
  `cdk deploy LlmUsageLens-<env>-App --exclusively -c imageTag=<previous-sha> ...`.
- **Restart without a change:** `aws ecs update-service --cluster <cluster>
  --service <service> --force-new-deployment`.

## Change the configuration file

Organisation settings (LiteLLM operation defaults, display options, data
retention) live in `apps/dashboard/config/config.yaml`, which ships inside
the image ([System Architecture — *Configuration file*](../specs/2026-05-15-system-architecture.md)).
A key set there wins over the value saved in Settings, and its control shows
"Set in config.yaml" and is locked.

1. Edit `apps/dashboard/config/config.yaml` on a branch; never add secrets,
   account IDs, roles or grants (the server refuses to start).
2. Run the gates locally (`pnpm check`); an invalid file fails the start and
   names the key path, never the value.
3. Land on `main` and redeploy (see *Redeploy*). The file is read once at
   start, so every change needs a new deployment or restart.

Removing a key unlocks the setting and restores the value saved in Settings.
`APP_CONFIG_FILE` points the server at a different file (for a mounted
file); unset or empty means the baked-in one.

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

Order: **FoundationStack, then DashboardServiceStack**. Undeploy in reverse.

- **Deploy:** see [dashboard-deployment.md](dashboard-deployment.md) section 6.
- **Undeploy DashboardServiceStack:** `cdk destroy LlmUsageLens-<env>-App --exclusively`. In import
  mode this removes only the target group, listener rule and ingress rule it
  added; the shared ALB is untouched. The audit log group is retained, so a
  redeploy first needs it imported or removed (see *Known gaps and retained
  resources*).
- **Undeploy FoundationStack:** it has termination protection and `RETAIN` on the
  table and CMK. Disable termination protection on the stack deliberately
  first. Destroying the stack still **keeps the DynamoDB table and the
  KMS key** (and their data); deleting those is a separate, explicit manual
  step. Destroy the DashboardServiceStack first.

## Break-glass data access

The table resource policy refuses every principal except the dashboard task
role, the collector role and `opsRoleArn` (Platform spec — *Data isolation*).
`opsRoleArn` is the break-glass permission set: use it only when the
dashboard cannot do the job (a corrupt item the app cannot read, an incident
investigation, a restore check).

1. **Decide and record.** Open an incident or change record with the reason
   and the expected actions before signing in. A second person agrees.
2. **Sign in** through IAM Identity Center with MFA and pick the break-glass
   permission set. Read or change only what the record names; never copy
   password hashes, TOTP ciphertext or audit items out of the account.
3. **Prefer reads.** A change made here bypasses the dashboard's audit log, so
   write the before and after values into the incident record.
4. **Review afterwards.** Within a working day, list the session's DynamoDB
   data events in CloudTrail (filter on the role) and attach them to the
   record. Any use without a record is a security incident.
5. **Quarterly:** confirm the permission set is still assigned to the named
   people only, and that `opsRoleArn` still matches its role ARN.

Changing the table policy itself is a FoundationStack deploy; an edit made
outside CDK shows in CloudTrail as `PutResourcePolicy` and is reverted by the
next deploy.

## Known gaps and retained resources

- The application 5xx metric filter matches structured JSON request logs
  (`$.status >= 500`). The dashboard does not emit them yet, so that alarm
  stays quiet until a logging unit adds structured request logs.
- The audit log group `/llm-usage-lens/<env>/audit` is **retained** when the
  DashboardServiceStack is destroyed (400-day audit retention). Redeploying the DashboardServiceStack
  then fails on the name clash: import the existing group or delete it by
  hand first. This is a user action.

## Cost posture

Fargate tasks, ECR storage and CloudWatch Logs (audit group kept 400 days),
plus the internal ALB only in create mode. ECS Container Insights is a paid CloudWatch feature (custom metrics),
required by the running-task alarm. No NAT gateway, VPC endpoints,
cache, WAF or certificate cost. CloudTrail data events on the table (for
break-glass review) are billed per event; dashboard traffic makes them a
small, accepted cost. The KMS CMK and DynamoDB are accepted costs
(CLAUDE.md - *Cost posture*).
