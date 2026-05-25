# Bedrock simulator

Standalone test harness that invokes real Amazon Bedrock models from a dedicated AWS sandbox account so the Bedrock Cost Dashboard collector (Phase 6) has CloudWatch metrics, CloudTrail events, Cost Explorer line items, Guardrail evaluations, and model-invocation-log payloads to ingest.

**This is not part of the Bedrock Cost Dashboard project.** It does not participate in the dashboard's build phases (`.claude/rules/30-phase-discipline.md`) and is not in the pnpm workspace.

## Documentation

- Spec: [`docs/specs/<date>-bedrock-simulator.md`](../../docs/specs/) — design, infrastructure inventory, attribution model, security boundary, regulatory posture.
- Guide: [`docs/guides/bedrock-simulator.md`](../../docs/guides/bedrock-simulator.md) — prerequisites runbook, deploy/run/destroy procedures, recovery procedures, troubleshooting, cost guardrails.

## GitHub workflows

All three are `workflow_dispatch` only, bound to the `bedrock-simulator-sandbox` GitHub Environment (required-reviewer protection):

| Workflow | Purpose |
|---|---|
| [`bedrock-simulator-deploy.yml`](../../.github/workflows/bedrock-simulator-deploy.yml) | Validate, build, deploy the SAM stack; run post-deploy stack-status + resource + smoke checks. |
| [`bedrock-simulator-run.yml`](../../.github/workflows/bedrock-simulator-run.yml) | Invoke the deployed Lambda once with operator-chosen `totalCalls` and `guardrailRatio`. |
| [`bedrock-simulator-destroy.yml`](../../.github/workflows/bedrock-simulator-destroy.yml) | Empty the logging bucket, disable model invocation logging, then `sam delete` the stack. |

See the guide for the full deploy/run/destroy procedure and recovery for `ROLLBACK_COMPLETE` / `DELETE_FAILED` / drift scenarios.
