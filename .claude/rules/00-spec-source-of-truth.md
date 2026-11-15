# Rule 00 — Specs are the source of truth

The `docs/specs/` and `docs/guides/` directories define this project. Before
proposing or writing code, **read the spec section relevant to the task** and
cite it in your response.

## Spec index

| Topic | File | When to read |
|---|---|---|
| AWS pipeline, accounts, collector flow | `docs/specs/2026-05-15-system-architecture.md` | Anything touching AWS, the collector, or cross-account access |
| DynamoDB table, entities, access patterns, model normalization | `docs/specs/2026-05-15-data-model.md` | Anything reading or writing DynamoDB, building Route Handlers, or working with model IDs |
| Tech stack, visual system, component inventory, performance patterns | `docs/specs/2026-05-15-design-system.md` | Anything visual, any new component, any chart |
| 6-phase build plan with verification checklists | `docs/specs/2026-05-15-implementation-phases.md` | **Always**, to confirm the work belongs to the current phase |
| Auth.js + Microsoft Entra ID + AWS credential setup | `docs/guides/auth-setup.md` | Anything touching sign-in or AWS credentials |
| Collector operational runbook, SAM deploy/undeploy | `docs/guides/aws-infrastructure.md` | Phase 6 collector work |
| Roles, scopes, membership, visibility, audit, threat model | `docs/specs/2026-11-10-access-control.md` | Anything touching sign-in, roles, authorization, Settings access sections or the audit log |
| AWS hosting, CDK stacks, task-role policy | `docs/specs/2026-11-10-platform.md` | Anything under `infra/`, deployment or AWS permissions for the dashboard |
| LiteLLM administration, gateway allowlist, service key, LiteLLM-reported cost | `docs/specs/2026-11-10-litellm.md`, `docs/guides/litellm-admin.md`, `docs/litellm/openapi.json` | Anything under `lib/litellm/`, `/api/litellm/**` or the LiteLLM page and Settings panel |
| Dashboard deployment runbook (Netlify; superseded by the Platform spec) | `docs/guides/dashboard-deployment.md` | Deployment work until Phase 4R.P rewrites it |
| Bedrock simulator (standalone test harness) | `docs/specs/2026-05-24-bedrock-simulator.md`, `docs/guides/bedrock-simulator.md` | Anything under `tools/bedrock-simulator/` |
| Dynamic workflows (piloted per implementation-phases — *Workflow pilots*) | `docs/guides/dynamic-workflows.md` | Proposing multi-agent workflow orchestration |
| GitHub / Actions practice | `docs/guides/github-best-practices.md` | Workflow, branching, or PR changes |
| Local git hooks (Husky) | `docs/guides/git-hooks.md` | Changing or debugging hooks |
| Guided learning path | `docs/guides/learning-path.md` | Onboarding or explaining the build order |

## Rules

1. **Cite the spec.** When you make a non-trivial recommendation, reference the
   spec section it comes from (e.g. "per Data Model spec — Access Patterns").
2. **Specs lead, code follows.** If reality and the spec disagree, surface the
   conflict and propose updating one of them — never silently diverge.
3. **No duplication in `.claude/`.** Rules in this directory summarise the
   spec; they do not replace it.
