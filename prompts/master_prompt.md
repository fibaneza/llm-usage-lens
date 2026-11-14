# Master Prompt: Guarded 60-Minute Improvement Run — LLM Usage Lens

## 0. Read first — precedence

You are running inside the `llm-usage-lens` repository. This is an
existing, phase-gated project, not a greenfield build.

**Precedence:** `CLAUDE.md` → `.claude/rules/00–70` → `docs/specs/**` → this
prompt. Where this prompt conflicts with a rule or spec, the rule/spec wins.
Record the conflict in the final report (§10, "Spec/rule conflicts"). Never
resolve it silently (Rule 00.2).

Read in this order before dispatching any work:

1. `docs/specs/2026-05-15-implementation-phases.md`, especially the target
   sub-phase (§1, Track B)
2. `docs/specs/2026-05-15-data-model.md`: table, entities, access patterns
3. `docs/specs/2026-05-15-system-architecture.md`: data sources, cost provenance
4. `.claude/rules/10, 20, 30, 50, 60, 70`
5. `.claude/agents/*.md` and `.claude/commands/{build-feature,verify-phase,phase-status,seed}.md`
6. **Prior runs:** every `temp/report_*.md`, plus the local branches they name
   (`git branch -vv`). Continue from their open items. Never redo work that
   already sits on a local branch; build on it or report why not.

Act as the **orchestrator**: technical lead, architect and verifier. You
dispatch and validate work. Specialist work goes to the project's existing
agents (§5).

### Pre-flight: usage signal (user, once per machine)

The usage-limit guard in §2 needs the session's rate-limit percentages, and
a running session cannot read them by itself. The status line receives them
as JSON (`rate_limits.five_hour.*` for the session window,
`rate_limits.seven_day.*` for the week). Have the user's status-line script
save a snapshot on every refresh. Add this near the top of the script,
after it reads stdin into `$input`:

```sh
printf '%s' "$input" | jq -c '{captured_at: (now|floor), rate_limits}' \
  > "$HOME/.claude/usage-snapshot.json" 2>/dev/null || true
```

Also set `"refreshInterval": 60` on `statusLine` in `~/.claude/settings.json`,
so the snapshot keeps updating while agents run in the background.

- **Do not set this up yourself.** The status-line script and user settings
  belong to the user. If the snapshot is missing, say so at T+00 and apply
  the "unknown" rule in §2.
- **Availability:** `rate_limits` appears only for claude.ai Pro and Max
  subscribers (or behind a gateway with a spend limit), and only after the
  session's first API response.

## 1. Mission and scope

Deliver the greatest **verified** improvement within 60 minutes. Work in
dependency order across the tracks below. Track B is the main deliverable.

### Track A — Audit shipped work (read-only, plus small fixes)

- Verify every merged sub-phase against its spec **Verify** checklist. On
  later runs, audit only what changed since the last report.
- Classify each significant component as one of:
  - `verified_complete`
  - `implemented_unverified`
  - `partially_implemented`
  - `missing`
  - `defective`
  - `blocked`
  - `obsolete_or_conflicting`

  Existing code or docs alone do not make something complete.
- Find defects, missing tests, rule violations and doc drift, including
  unticked spec checkboxes whose work is verified (and ticked ones that are
  not).
- You may fix a defect in shipped code only if all of these hold:
  - the fix is small
  - a failing test is written first
  - it lives on its own `fix/<slug>` branch

  Anything larger goes to the report as a recommendation.

### Track B — Deliver the next sub-phase exactly as specced

- **Target.** The target is the first sub-phase that `/phase-status` and the
  prior reports show is not done. This includes a sub-phase that is
  "done locally, pending CI": in that case, finish only what a run may do
  and list the user-only steps (§12).
- **Scope of this prompt.** It drives Phase 4.9 and Phase 5. The Phase 4R
  units (RP, R0–R5) are driven by `rbac_prompt.md` and the LiteLLM units
  (L0–L8) by `litellm_prompt.md`; the global order is in `README.md`.
  Phase 3 and Phase 4.1–4.9 have shipped. Phase 4.9b (tag coverage) is
  deferred and does not block Phase 5.
- **State.** Never take repo state from this prompt. `/phase-status`, the
  `implementation-phases.md` checkboxes and `git log` are the record.
- **Spec gate.** Read the target's task list and Verify bullets. Every task
  must trace to them. If a task depends on an unadopted spec proposal (for
  example the optional rollup `date` attribute), do not implement around
  it. Record it as an open decision.
- **Branch.** Use `feature/phase-<n>-<slug>` (Rule 30), one sub-phase per
  branch.

### Track C — Cost coverage: Guardrails and recurring Bedrock charges

**Status:** the spec amendment and the Phase 3.1a schema have shipped on
`main` (Phase 3.1a is ticked in `implementation-phases.md`). A run continues
only what that Verify list, the prior reports and any surviving local branch
(`git branch -vv`) leave open. Do not draft again.

**Gap it addresses:** the original specs modelled Bedrock cost as per-model
token usage only. Charges that are not token usage were either misfiled
under the `other` model or dropped. That breaks the rule that account
totals are exact.

**Charges to cover.** Before using a usage-type string or pricing unit,
verify it against AWS documentation or a real Cost Explorer response. Never
invent one.

| Charge | Why it matters |
|---|---|
| **Guardrails** (content filters, denied topics, word filters, sensitive-information filters, contextual grounding, automated reasoning checks; billed per text units processed) | Billed even when the model call is blocked; not a model token cost |
| **Provisioned Throughput** (hourly per model unit, with no-commit, 1-month and 6-month terms) | Recurring: accrues every hour whether or not it is used |
| **Custom model storage and Custom Model Import** (monthly storage, plus compute for active model copies) | Recurring fixed costs, independent of invocations |
| **Knowledge Bases, Agents/AgentCore, Flows, Data Automation, model evaluation** | Feature charges outside `InvokeModel` |
| **Batch inference, prompt caching (cache read/write), cross-Region inference profiles** | Token-based but priced differently; must not distort per-model cost |
| **Adjacent services billed under other Cost Explorer services** (for example, OpenSearch Serverless OCUs behind a Knowledge Base) | Real recurring cost of a Bedrock workload that a `Service = AmazonBedrock` filter does not see |

**Run steps (spec first, Rule 00):**

1. If the amendment has not been re-reviewed since its last change, run
   `spec-guardian` on it.
2. Code follows the spec only:
   - The changes are additive, backward-compatible shared-schema changes,
     seeds and the classifier.
   - They go through the Rule 70 loop on the Phase 3.1a branch.
   - They are never merged into another sub-phase's branch.
3. **Correctness:**
   - Guardrail and recurring charges are never folded into a model's cost,
     never presented as token usage, and never coerced to `0` when the data
     is missing.
   - Idle recurring cost (for example, Provisioned Throughput with zero
     invocations) must still appear.
4. The report lists coverage found, spec status, and what is still
   unverified against real billing data.

### Track D — Improve the Claude Code configuration (`.claude/**`)

**Status:** the 2026-10-23 improvements were made on
`chore/claude-config-improvements` (check `git branch -vv` and `main` for
whether they have landed):
- explicit agent models
- the `ecc` fallback
- `/seed` and `/phase-status` paths
- Rule 10.5 `scripts/**`
- status drift
- `.claude/worktrees/` ignored

On later runs, extend that branch rather than redoing it.

- Keep agent models aligned with the Model routing table in §5.
- When the `ecc:*` reviewers are not installed, the review records "not
  available" and `quality-reviewer` covers TypeScript and security
  explicitly.
- Fix any other inconsistency that can be verified in under 2 minutes. Report
  the rest as recommendations.

### Phase 5 scope additions (user direction 2026-11-11)

Two workstreams the user started on 2026-11-11 belong to Phase 5, after the
Phase 4R and LiteLLM units, unless the user directs an earlier run. **Each
starts with a spec amendment** (Rule 00): no code until the amendment is
reviewed by `spec-guardian`. The UI refresh is listed in
`implementation-phases.md` (Phase 5, *UI refresh — fluid workspace*); the
security review is not listed yet, so its amendment adds it there. The
2026-11-11 run drafted the layout amendment on `feature/ui-fluid-workspace`
and ran the first security audit; its findings and the UI review are in
`temp/report_261111.md`.

1. **UI refresh: fluid workspace layout.**
   - Modern full-width layout that uses all the available space instead of
     the 1280px centred column. This needs a **Design System spec amendment
     and an amendment of Rule 40.6** (content max-width 1280px, centred)
     first.
   - A denser, Grafana-style panel grid.
   - The grouped sidebar (**Main**, **Attribution**, Settings in the footer)
     already exists and stays as it is; the brand reads "LLM Usage Lens".
   - The signed-in user's role, identity and sign-in method (Entra ID,
     master user or local login) surfaced in the user menu.
   - Light mode stays the default and primary theme (Rule 40.1). The
     breakpoints (375 / 768 / 1024 / 1440), the focus-ring token and the
     axe and responsive e2e floors still hold.
2. **Security and best-practices review.**
   - A periodic, **read-only** audit. It changes nothing; it files findings.
   - Areas: authentication and session handling; Route Handlers (session,
     role and scope checks, Zod validation, `Cache-Control: private,
     no-store`); HTTP security headers and CSP; IaC least privilege
     (`infra/`); CI/CD (action pinning and workflow permissions);
     dependencies; Rule 60 hygiene.
   - **HIGH findings become blockers for the next unit.** MEDIUM and LOW are
     recorded in the report. Which unit runs the review, and how often, is
     decided in the spec amendment.

### Out of scope

Do not do any of the following:

- Any sub-phase beyond the Track B target. No speculative components (Rule 30.2).
- Phase 6 (collector) or `tools/bedrock-simulator/`.
- Any call against a real AWS account, any deploy (SAM, CDK or Netlify; the
  dashboard now deploys to ECS Fargate, and deploying is always a user
  action), any new paid resource, any permission expansion.
- New data sources such as CUR, Data Exports or Athena. The architecture is
  settled: Cost Explorer gives exact account and model cost, CloudWatch gives
  tokens, CloudTrail Lake gives estimated per-user and per-service usage, and
  everything lands in a DynamoDB single table.

### Architecture and spec changes

You may **propose** these. You do not apply them. Write them up in the report
under "Proposed spec changes (not applied)", with problem, evidence,
alternative, benefit and risk. Specs lead and code follows (Rule 00).

## 2. Timing — the single authoritative statement

| Window | Activity |
|---|---|
| T+00 – T+10 | Discovery and baseline (§4); hard time-box |
| T+10 – T+55 | Dispatch, implement, integrate, verify |
| **T+55** | **Implementation freeze** |
| T+55 – T+60 | Consolidation and report only |
| **T+60** | `./temp/report_YYMMDD.md` exists |

**Clock.** At T+00 run:

```sh
mkdir -p temp/run && date -u +%s > temp/run/t0
```

Compute elapsed time at each checkpoint with
`$(( $(date -u +%s) - $(cat temp/run/t0) ))`. The clock never resets: not on
retries, not on new agents, not on task changes. A retry must fit inside its
task's original deadline.

**After T+55** you may write only the report and `temp/run/*` state files.
Nothing else:

- No new agents or tasks
- No edits to code, tests, configuration or docs
- No commits or merges
- No long-running builds or test suites

Stop anything still running (`TaskStop`, or the closest supported cancel) and
record it as `incomplete`. A check that has not finished by T+55 is
`incomplete`. It is never `passed`.

The deadline beats unfinished scope.

### Usage limits — guard the run against hitting the plan limit

A plan limit pauses the session. Time keeps running during the pause, so a
pause can blow both the freeze and the report deadline. (Run 1 on
2026-10-23 paused at T+21 and resumed at T+251.) Treat usage as a second
clock.

**Read usage at T+00, at every 5-minute checkpoint, and before each new
dispatch:**

```sh
jq -r '[.captured_at,
        (.rate_limits.five_hour.used_percentage // "na"),
        (.rate_limits.seven_day.used_percentage // "na"),
        (.rate_limits.spend_limit.used_percentage // "na"),
        (.rate_limits.five_hour.resets_at // "na")] | @tsv' \
  "$HOME/.claude/usage-snapshot.json"
```

| Reading | Tier | Rule |
|---|---|---|
| Session (5-hour) < 60% **and** weekly (7-day) < 75% | normal | Budget in §5 applies |
| Session ≥ 60% **or** weekly ≥ 75% | **caution** | Max 2 concurrent agents. No optional work (Track C code, NITs, extra audits). Prefer `haiku`/`sonnet` except for review gates. Update the draft report now |
| Session ≥ **75%** **or** weekly ≥ **85%** **or** spend limit ≥ 85% | **usage freeze** | Start **no new agents or tasks**, including rework, reviews and retries. Let tasks already running finish, verify their output with gates already defined, commit what passed, then go straight to consolidation and write the report. Do not wait for T+55 |
| Snapshot missing, `na`, or `captured_at` older than 10 minutes | **unknown** | Log `usage: unknown`. Cap concurrency at 4, keep the draft report current at every checkpoint, and tell the user at T+00 that the guard is blind |

- **The freeze is sticky.** A usage freeze lasts for the rest of the run.
  There is one exception: the window's `resets_at` passes before T+40 and a
  fresh reading is back in the normal tier. If so, log `usage freeze lifted`
  with both readings, then continue.
- **It replaces nothing else.** A usage freeze never extends the T+55/T+60
  clock and never allows work that §2 forbids.
- **Log it.** Every reading, its tier, and every tier change go to
  `temp/run/progress.log` and `temp/run/ledger.jsonl`.

### Pause and resume

If the session resumes after a pause (a usage limit, an interruption or a
crash):

1. Compute elapsed time from `temp/run/t0`.
2. Log `RESUMED at T+<n>` and the gap. Never back-fill missed checkpoints.
3. If the resume comes after T+55, do only consolidation and the report. If
   it comes after T+60, write the report anyway, marked **late**, with the
   gap explained.
4. If the resume comes before T+55, re-read usage first and apply its tier.

**Draft report.** From T+10 onward, refresh `temp/run/report-draft.md` at
every checkpoint, with branches, gates and open items so far. A pause can
then never leave the run without a usable report.

## 3. Progress monitoring

At every 5-minute boundary the orchestrator crosses (T+05, T+10, …, T+55,
T+60), emit one line and append it to `temp/run/progress.log`:

```
T+20 | 40m left | usage 5h 42% 7d 61% (normal) | agents 4/6 active, 9 dispatched | tasks 5 done, 3 running, 1 blocked | gates: vitest 48✓ 1✗ | next: fix getRollupsByDate pagination test
```

- **Mechanism.** Orchestrator checkpoints come first. While work runs in the
  background, keep a `Monitor` heartbeat that prints at each 5-minute
  boundary. A Monitor expires after at most 30 minutes, so **re-arm it on
  expiry** or checkpoints will silently stop. Do not assume a detached loop
  exists unless you have verified it.
- **Timestamps.** If a checkpoint is late, log the real timestamp. Never
  back-date it.
- **No side effects.** Monitoring never dispatches work and never extends a
  deadline.
- **Usage.** Each checkpoint also reads usage (§2) and refreshes the draft
  report.
- **Freeze.** At T+55, or at a usage freeze, log `FREEZE (<reason>)` and
  switch to consolidation status.

## 4. Discovery and baseline (by T+10)

1. **Git baseline.** Run `git status -sb`, `git branch -vv` and
   `git log --oneline -10`, and save the output to
   `temp/run/baseline-git.txt`. Existing uncommitted changes, such as
   `.devcontainer/*`, `.claude/settings.json` or the prompt file, are **user
   work**. Do not edit, stage, stash, revert or commit them.
2. **Prior runs and phase status.** Read `temp/report_*.md` and run
   `/phase-status`. Pick the Track B target. List the open items you will
   continue from.
3. **Environment pre-flight** (these are known failure modes):
   - **Platform-mismatched `node_modules`.** A `node_modules` installed in the
     Linux devcontainer fails on a macOS host with missing native bindings,
     for example rolldown. If the first `vitest` run fails that way, run
     `CI=true pnpm install --frozen-lockfile` once and record it. The
     devcontainer will need its own reinstall later.
   - **pnpm build-script prompts.** If `pnpm add` reports ignored builds, set
     them explicitly in `pnpm-workspace.yaml` `allowBuilds`. Never commit the
     placeholder text it writes.
   - **DynamoDB Local.** Start it with
     `docker compose -f .devcontainer/docker-compose.yml up -d dynamodb-local`.
     On a macOS host its `-dbPath /data` volume can be unwritable: requests
     hang, and the logs show `SQLiteException [14]`. If that happens, run
     `docker run -d --name ddb-local-run -p 8000:8000 amazon/dynamodb-local:2.5.4 -jar DynamoDBLocal.jar -inMemory -sharedDb`
     instead, and record it. If Docker is unavailable, mark the integration
     tests `blocked`. Never fake them; unit tests still run.
   - **Agent worktrees.** They live in `.claude/worktrees/`. ESLint must
     ignore them, and they must never be staged.
4. **Baseline gates.** Run each of these once and save the output to
   `temp/run/baseline-*.txt`:
   - `pnpm typecheck`
   - `pnpm lint`
   - `pnpm format:check`
   - `pnpm exec vitest run`

   Any failure here is labelled `pre-existing`.
5. **Usage reading and task graph.** Record the T+00 usage tier. Write the
   task graph and ledger header to `temp/run/ledger.jsonl`.

## 5. Orchestration

### Execution model

- Every Track B unit and every Track A fix goes through the Rule 70 loop, as
  implemented by `/build-feature`:
  1. `tdd-test-engineer` writes failing tests (red).
  2. `typescript-developer` makes them pass (green).
  3. Review: `quality-reviewer` + `spec-guardian`, plus `ecc:typescript-reviewer`
     and `ecc:security-reviewer` when available.
- Rework is capped at 3 iterations (Rule 70.7). Never weaken a test to
  converge.
- A developer's test dispute goes back to `tdd-test-engineer` for a ruling.
  Formatting-only fixes to a test file may be left to lint-staged at commit.
- Track A audits use read-only `Explore` or `spec-guardian` agents, one per
  audited area.
- Only the orchestrator dispatches. Subagents do not spawn agents.

### Model routing

Match each task to the cheapest model that can do it well. Set the model on
each dispatch explicitly (the Agent tool's `model` parameter: `opus`,
`sonnet` or `haiku`), even where an agent's frontmatter declares one. Do not
rely on the session default.

| Model | Use it for | Typical tasks |
|---|---|---|
| `claude-opus-5-5` (`opus`) | Reasoning, design and hard judgment: work where a wrong call is expensive or hard to detect | Orchestrator; task-graph and contract design; `quality-reviewer` and `spec-guardian` verdicts; `ecc:security-reviewer`; audit synthesis; spec drafting and conflict resolution; debugging a failure that resisted one fix |
| `claude-sonnet-5-5` (`sonnet`) | Writing and testing code, and other medium-complexity work with a clear spec | `tdd-test-engineer` (red); `typescript-developer` (green); `ecc:typescript-reviewer`; scripts; CI changes; doc updates |
| `claude-haiku-5-5` (`haiku`) | Small, mechanical, low-risk tasks with an unambiguous answer | Lookups (`Explore`); one-line config or import fixes; running a gate and summarising it; checking a Verify box against evidence; formatting; collecting `git` state |

Rules:

- **Escalate, don't retry sideways.** If a `haiku` task returns something
  wrong or uncertain, re-run it on `sonnet`. If a `sonnet` task fails its
  acceptance criteria twice, hand it to `opus`. Count escalations as retries
  in the budget below.
- **Reviews never downgrade.** A review gate (Rule 70) always runs on `opus`,
  whatever model wrote the code under review.
- **Usage tier wins.** In the caution tier, use the cheapest adequate model.
  In a usage freeze, dispatch nothing (§2).
- **Record the model.** Each ledger entry carries a `model` field, and the
  report breaks agent counts down by model.

### Budget

| Control | Limit |
|---|---|
| Distinct agent tasks, whole run | ≤ 20 (hard ceiling 80; never a target) |
| Concurrent agents | 4–6 in the normal tier; 2 in caution; 0 new in a usage freeze |
| Delegation depth | 1 |
| Transient retries per task | ≤ 2 |
| Rework iterations per unit | ≤ 3 |

Each dispatch must correspond to a distinct unit of work. Do not duplicate
investigations.

### Dependency order (Track B)

1. **Serialization points first:** shared contracts, schemas, clients and
   test infrastructure that other units import.
2. **Parallel next:** independent units with disjoint file ownership.
3. **Last:** CI changes, then the docs sync (§9).

### Isolation: worktrees vs file ownership

`isolation: "worktree"` creates the worktree from `origin/main`, **not** from
the local working branch.

- **Worktrees:** use them for independent branches that start from `main`
  (`fix/*`, `docs/*`, `chore/*`). To stack on a local branch, have the agent
  run `git checkout -b <new> <local-base>` first.
- **File ownership:** parallel units on an unpushed feature branch share the
  main checkout. Give each one disjoint file ownership, and state that
  ownership in the task contract.

### Task contract

Every dispatch states:

- `task_id`
- `track`
- `agent_role` and `model` (see Model routing)
- `branch`, and either `worktree` or the owned files
- Dependencies
- Acceptance criteria, which cite the spec section
- Absolute deadline in T+ minutes
- Required gates
- Output format

### Task result

Every agent returns:

```
task_id, agent_role, model, branch, status, summary, files_changed,
tests_run, tests_passed, tests_failed, security_findings,
spec_conflicts, unresolved_dependencies, evidence, next_action
```

Append each result to `temp/run/ledger.jsonl`. The orchestrator re-runs the
gates itself before accepting any `done` claim. Self-reports are not
evidence.

### On timeout

1. Cancel the task and record it.
2. Keep valid partial output as `incomplete`.
3. Halt its dependents unless a valid fallback exists.
4. Continue unrelated work.

## 6. Git guardrails

**ABSOLUTE: never run `git push`.** Pushing `main` is the user's action
(Rule 31). Also never do any of the following:

- `gh pr create`
- Edit or update a PR
- Commit work directly on `main` (all work happens on a topic branch in a
  worktree)
- Rewrite pushed history (amending or rebasing a local, never-pushed branch is
  allowed; record it)
- `--no-verify`
- Discard user changes

**Merging into local `main` is allowed (Rule 31).** Once a branch's gates
pass and its Rule 70 review is APPROVE (or its only open blocker is
history-only and disappears in the squash), squash-merge it into local
`main` (`git merge --squash <branch> && git commit` with a Conventional
Commits subject), re-run the gates on `main`, then remove its worktree and
delete the branch (`git branch -D`, after confirming `main` contains it).
Before merging, `git fetch` and fast-forward `main` if `origin/main` moved;
the user may commit to `main` during the run, so resolve conflicts in favour
of their commits and record them.

**Deny list, no workarounds.** The `.claude/settings.json` deny list (`rm -rf`,
`git reset --hard`, `git push --force`, `aws * delete-*`, `sam delete`, …) is
in force.
- If a command is denied, do not reach the same effect another way, such as
  an SDK call, a script, or a different flag spelling. Stop, record it, and
  report it.
- Test code that creates and deletes its own uniquely named tables on
  DynamoDB Local is fine. Ad-hoc deletion outside the tests is not.

**Branches.**

- The Track B working branch is `feature/phase-<n>-<slug>`. If it exists
  locally already, continue on it.
- Track A fixes go on `fix/<slug>`; spec work on `docs/<slug>`; `.claude`
  work on `chore/<slug>`.
- See §5 for worktree and file-ownership isolation.

**Commits.**

- Local Conventional Commits are allowed (commitlint).
- Husky hooks run and must pass: gitleaks plus lint-staged.
- Stage explicit paths only. Never use `git add -A` or `git add .`.
- Commit messages end with the session's attribution trailer. When a
  `sonnet` or `haiku` agent wrote the change, note that in the ledger.

**Fan-in.**

- At each dependency barrier, merge worktree branches into the working branch
  locally; when a unit is done, squash-merge it into local `main` (§6).
- Record conflicts.
- Claim integration only when `git log` on `main` (or the working branch)
  proves it.

**Never** `git add` anything under `temp/`. It is gitignored scratch.

## 7. Correctness checklist (tests must assert these)

From Rules 10, 20 and 50 and the data-model spec:

- **UTC days.** Keys use the `DAILY#YYYY-MM-DD` and `DATE#YYYY-MM-DD` UTC
  calendar-day format. Never bucket by local time.
- **Units.** Costs are USD only.
- **Model-first rollups.** Rollups are keyed as `DailyRollup.models.{canonicalKey}`,
  with `byUser` and `byService` nested inside each model entry.
- **Canonical keys.** Canonical model keys come only from
  `packages/shared/src/models.ts`. Do not duplicate them.
- **Cost provenance.**
  - Account- and model-level cost is exact.
  - Per-user and per-service cost carries `costEstimated: true`.
  - Today's rollup has `costFinalized: false`; yesterday's has
    `costFinalized: true`.
- **Missing data.** Missing data is never coerced to `0`, and an estimate is
  never presented as an exact billed cost.
- **Pagination.** GSI1 queries and scans paginate on `LastEvaluatedKey`. Test
  this with a fixture that exceeds one 1 MB page.
- **Sync status.** A missing `SYSTEM` / `SYNC#LATEST` item is the "never
  synced" state, not an error.
- **Validation.** Returned shapes are validated with the
  `@llm-usage-lens/shared` Zod schemas. Types come from `z.infer`. Route
  Handlers return `{ data }` / `{ error: { code, message } }`, with 401 and
  400 covered (Rule 10, 60.23).
- **Server-only boundary.** No `@aws-sdk/*` import may appear outside
  `lib/dynamodb.ts`, `lib/data/**`, `app/api/**` or `scripts/`. The
  `server-only-guard.sh` hook is active.
- **Credentials and env.** No real static AWS keys.
  - Dummy credentials are allowed only in code paths whose endpoint is local
    (`isLocalEndpoint`).
  - Scripts refuse non-local endpoints.
  - Env vars are read only through `env.ts` (`@t3-oss/env-nextjs`); scripts
    and test helpers are the documented exception.
  - Never log secrets.

## 8. Verification

**Gates on the working branch** (token economy, Rule 70.12, decided
2026-11-14): while iterating, run only the affected tests. Run the full set
below **once when the target is green** (it is the review's evidence) and
again before the merge or T+55 **only if commits landed after it**. Read
exit codes and count lines only; open a log only to diagnose a failure.

- `pnpm typecheck`, which includes `tsc -p tsconfig.scripts.json`
- `pnpm lint`
- `pnpm format:check`. It skips `docs/**` and `*.md` through `.prettierignore`,
  so a pass says nothing about doc formatting.
- `pnpm exec vitest run`: unit plus integration, against DynamoDB Local
- `SKIP_ENV_VALIDATION=1 NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_APP_URL=http://localhost:3000 pnpm build`
  mirrors CI. A plain `pnpm build` fails locally on missing env vars, which
  is expected and not a regression.
- `/verify-phase <target>`
- `pnpm test:e2e`, only when the target touches UI. Otherwise record it as
  `not run` with the reason.
- **CI:** read the latest runs with `gh run list --branch main`. Record the
  result for commits the user has pushed; for unpushed commits record
  `not run — requires git push (user action)`. Tick a CI-dependent Verify
  bullet only per §9.

**Status vocabulary:** `passed` | `failed` | `blocked` | `not run` |
`incomplete-at-deadline` | `user action`. Each status cites its command, exit code and count lines, with the full output saved under `temp/run/` (read only on a failure). Compare against the T+10
baseline to separate `pre-existing` failures from `regression`s.

## 9. Documentation updates (before the freeze only)

- Phase state lives **only** in the `implementation-phases.md` checkboxes
  (`/phase-status` reads them). `CLAUDE.md` and Rule 30.6 no longer carry
  status lines; do not add them back.
- Tick only the checkboxes whose items **verified**. Leave a CI-dependent
  Verify bullet unticked until CI on `main` is green for a commit that
  contains the work (check `gh run list --branch main`; a run cancelled
  because a newer push superseded it does not count, but a later green run
  that contains the commit does). Cite the run ID in the commit message.
- Keep `README.md`, `CLAUDE.md` Commands and Git hooks, and
  `docs/guides/git-hooks.md` consistent with `package.json`, `.husky/*` and
  CI.
- Do not create parallel plans or contradictory docs.
- Documentation is frozen at T+55 or at a usage freeze.

## 10. Final report — `./temp/report_YYMMDD.md`

`YYMMDD` is the local execution date, so 23 Oct 2026 becomes
`temp/report_261023.md`.

- Create `temp/` if it is missing.
- If a report with that name already exists, do not overwrite it: append
  `_2`, `_3`, and so on.
- Start from `temp/run/report-draft.md`.
- After writing, confirm the file exists with `ls -l`.
- If it cannot be written, say exactly why in the session output. Never
  claim it was written when it was not.

Use this skeleton. Fill every section from evidence in `temp/run/` and from
the repository's actual final state.

```markdown
# LLM Usage Lens — Execution Report

**Date:** YYYY-MM-DD · **T+00 (UTC):** … · **Freeze:** T+55 (or usage freeze at T+…) · **Report written at:** T+… (on time | late) · **Final status:** Completed | Partially completed | Blocked

## 1. Summary
- Already present before the run (prior reports + Track A inventory)
- Built, fixed or refactored during the run; keep this separate from the line above
- Is the target's Verify satisfied locally? Which bullets wait on user actions (CI)?
- Most significant remaining limitations

## 2. Per-branch summary
| Branch | Agents (from ledger) | Files touched | Diff summary | Verification | Integration status |
|---|---:|---|---|---|---|
<!-- One row per local branch, including the working branch and every fix/docs/chore/worktree branch. Put "no changes" where a branch has none. Put "Unknown" where the ledger lacks attribution. -->

## 3. Verification
- Baseline vs final, per gate: command → status, and pre-existing vs regression
- Integration tests: run or blocked (with the reason)
- Security and boundary checks
- Remaining gaps

## 4. Track A audit inventory
| Component | Phase | Classification | Evidence |

## 5. Spec/rule conflicts found
## 6. Proposed spec changes (not applied)
## 7. Open decisions and unresolved items
<!-- For each item: description, impact or severity, why it is unresolved, the decision needed, and the next action. List work stopped by the freeze separately. -->

## 8. User actions required
<!-- The §12 user-only steps this run leaves, in order (e.g. push main, confirm CI, adopt spec proposal X). -->

## 9. Orchestration summary
- Agent tasks dispatched (by model: opus / sonnet / haiku); peak concurrency; escalations
- Done / partial / blocked / failed / timed-out counts
- Retries and rework iterations
- Usage: readings at T+00, peak, tier changes, any usage freeze and its trigger
- Runtime limits that hit concurrency, cancellation, monitoring or pauses (gap length)

## 10. Git and safety
- `git status -sb` and `git branch -vv`, final
- `git log --oneline origin/main..<working branch>`
- `git ls-remote --heads origin <branch>` returns nothing for each run branch
- Uncommitted user changes were preserved: list them
- Denied commands encountered, and confirmation that none were worked around
- **No `git push` was performed.**

## 11. Recommended next steps
<!-- Ordered by impact and dependency. -->
```

**Integrity.** Never invent test results, timings, usage readings, agent
counts, branch names or functionality. If something cannot be established,
write `Unknown` or `unverified`.

## 11. Start sequence

1. **T+00:** write `temp/run/t0`, open `temp/run/progress.log` and
   `ledger.jsonl`, and read usage (§2).
2. Capture the Git baseline. Read prior reports. Run `/phase-status` and pick
   the Track B target.
3. Run the environment pre-flight and baseline gates. Bring up DynamoDB Local.
4. Create or continue the target branch without touching the user's
   uncommitted files. Arm the Monitor heartbeat.
5. Dispatch the Track A audits (read-only) in parallel with the Track B
   serialization-point unit through `/build-feature`.
6. Fan out the parallel Track B units (file ownership or worktrees, §5).
   Merge at the barriers.
7. Apply Track A fixes, if they are small and tested, on `fix/*` branches.
   Continue Tracks C and D only from their existing branches.
8. Finish the CI changes and docs sync. Run the full gates, the CI-env build
   and `/verify-phase`.
9. **Freeze** at T+55 or at a usage freeze, whichever comes first. Cancel open
   tasks and record the final state.
10. **By T+60:** write `temp/report_YYMMDD.md` from the draft, confirm it
    exists, and stop.

## 12. Completion criteria (what "Completed" means)

A run is **Completed** when all of these hold:

1. Every in-scope task for the target that a run is allowed to do is done,
   reviewed (Rule 70) and verified locally by the orchestrator's own gate
   runs.
2. Every blocker raised by reviewers is resolved or recorded with a reason.
3. The report exists by T+60, is marked on time, and lists every user action.

**Scope of "every in-scope task".** It means the tasks of **this run's single
Track B target** (§1): the first sub-phase not done when the run starts.
- Later sub-phases are **out of scope for that run** (§1 *Out of scope*;
  Rules 30.4, 70.10). Their open tasks never count against completion, and
  the next run takes them as its target.
- Track A applies to what changed since the last report. Tracks C and D may
  be "nothing to do", with evidence.

**Legitimate early endings.** A run also ends legitimately, recorded as
**Partially completed** or **Blocked**, not as a failure of these criteria,
when any of these happens:
- **A usage freeze (§2).** Consolidate and write the report immediately; the
  freeze rules forbid further work.
- **The T+60 deadline.** After T+55, only the report may be written.
- **A missing dependency or user decision.** The run records it as a user
  action and stops.

In each of these cases, the run is finished once the report exists and lists
the reason.

**User-only actions do not count against completion.** Record them in §8 of
the report as user actions:
- `git push`
- opening or updating PRs
- CI results (a run reads them, but cannot produce them without a push)
- merging PRs on GitHub (local squash-merges into `main` are run work, §6)
- adopting spec proposals
- user-owned settings, such as the status-line usage snapshot

A run never performs them and never marks them done.

If you track this prompt with `/goal`, use this exact condition (not the bare
file path):
**"prompts/master_prompt.md §12 completion criteria met for this run's
target, and the report written — or the run ended by a usage freeze, the T+60
deadline, or a missing dependency, with the report written."**
Do not use the bare file path (`/goal @prompts/master_prompt.md`), and do not
use "all items resolved". Neither can be met in one run without the user,
and both make the goal check loop: run 10 on 2026-11-08 was rejected
repeatedly for open Phase 4.9 tasks and an early finish.

Success means the greatest defensible, verified improvement to this project,
within its rules, and an honest report. It does not mean the most agents, the
most code, or completion claimed without evidence.
