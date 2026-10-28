# Rule 31 — GitHub Flow

Source of truth for branching strategy, the integration workflow, and the
release process.
Phase-specific branching is governed by [Rule 30](30-phase-discipline.md) —
Rule 30 wins for `feature/phase-<n>-<slug>` branches.

## Long-lived branches

`main` is the **only** long-lived branch. `master` and `develop` are
forbidden. All work branches off `main` and is squash-merged back into
**local** `main` (see *Integration workflow*). The primary checkout stays on
`main`; topic branches live in worktrees under `.claude/worktrees/`.

## Branch naming

| Work type | Pattern | Example |
|---|---|---|
| Phase 1–6 feature work | `feature/phase-<n>-<slug>` | `feature/phase-1-foundation` |
| General feature | `feature/<slug>` | `feature/dark-mode-toggle` |
| Bug fix | `fix/<slug>` | `fix/cost-rollup-null-check` |
| CI / GitHub Actions | `ci/<slug>` | `ci/github-flow-refactor` |
| Documentation | `docs/<slug>` | `docs/auth-setup-guide` |
| Chore / maintenance | `chore/<slug>` | `chore/bump-actions-versions` |

**Grandfathered:** existing branches that predate this rule (`agents/*`,
`explain-git-worktree-spanish`) are not renamed. The convention applies to
new branches only.

## Commit messages

Every commit must follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <description>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.

Never bypass the commit-msg hook (`--no-verify`) — Rule 50.5.

## Integration workflow (local `main`)

1. **Branch from an up-to-date local `main` into a worktree** —
   `git worktree add .claude/worktrees/<slug> -b <branch> main` (or the Agent
   tool's worktree isolation, then `git checkout -b <branch> main` inside it,
   since agent worktrees start from `origin/main`). Never edit on `main`
   directly in the primary checkout.
2. **Commit with Conventional Commits** on the topic branch; hooks run
   (Rule 50.5).
3. **Gate before merging** — on the topic branch: `pnpm typecheck`,
   `pnpm lint`, `pnpm format:check`, `pnpm exec vitest run` (with DynamoDB
   Local), plus the CI-env `pnpm build` for dashboard changes and
   `/verify-phase <n>` for phase work. Rule 70 reviews must have approved.
4. **Squash-merge into local `main`.** Claude may do this without asking each
   time once the user has authorised the merge:
   `git merge --squash <branch> && git commit` with a Conventional Commits
   subject (what a PR title would have been) and a short body. One squash
   commit per branch; resolve conflicts in favour of what is already on
   `main` plus the branch's new lines, then re-run the gates on `main`.
5. **Never push `main`.** Pushing `main` is the user's action; CI
   (`bedrock-dashboard-build.yml` on `push: main`) runs then. The only push
   Claude makes is deleting merged remote topic branches (step 7). Never
   `git push --force`, never rewrite `main`'s history.
6. **Clean up after the merge** — `git worktree remove .claude/worktrees/<slug>`,
   then `git branch -D <branch>` (squash-merged branches are not ancestors of
   `main`, so `-d` refuses; confirm `git diff main <branch>` shows only what
   `main` superseded first). Also delete orphaned `worktree-agent-*` branches
   with no unique commits and run `git worktree prune`. Never delete a branch
   with unmerged work.
7. **Clean up the remote too.** If the topic branch was pushed, close its PR
   with a comment pointing at the squash commit (`gh pr close <n> --comment …`)
   and delete the remote branch (`git push origin --delete <branch>`), then
   `git fetch --prune`. Until the user pushes `main`, that work exists only in
   local `main` — say so when reporting the cleanup.

**Optional PR path.** When the user wants GitHub CI or the Claude PR review
*before* a change lands, push the topic branch, open a draft PR
(`gh pr create --draft`), mark it ready when its checklist passes, and
squash-merge it (`gh pr merge --squash`) once checks are green and there is
no open HIGH finding — no human review required. The PR title must follow
Conventional Commits. Afterwards fast-forward local `main` from `origin/main`.

## PR description requirements (optional PR path)

Every PR description must include:

- **Summary** — what changed and why (1–3 bullets).
- **Linked issue** — `Closes #<n>` if applicable.
- **Test plan** — checklist of what to verify before merge.
- **Reviewer guidance** — where to start reading; any risky areas.
- **Phase** (when applicable) — the phase number and spec section this
  PR belongs to (Rule 00 — cite the spec).

Use the PR template (`.github/pull_request_template.md`); GitHub
pre-fills it on every new PR.

## Release process

Releases are cut from `main` only, by pushing a git tag.

| Tag format | When to use |
|---|---|
| `vMAJOR.MINOR.PATCH` | Final release |
| `vMAJOR.MINOR.PATCH-rc.N` | Release candidate |
| `vMAJOR.MINOR.PATCH-beta.N` | Beta / preview |

Cut a release:

```bash
gh release create vX.Y.Z --generate-notes
# or
git tag -a vX.Y.Z -m "Release vX.Y.Z" && git push origin vX.Y.Z
```

Pushing any of the three tag patterns triggers `claude-code-review.yml`
(the release audit), which scopes the review to commits since the
previous release tag. The first release tag establishes the baseline and
triggers no Claude invocation.

## Branch protection on `main`

Not enforced on the current free private repo. Because the user pushes local
`main` directly, **do not** enable "Require pull request before merging" or
"Restrict direct push to `main`" if protection is ever turned on. Keep:

- Require linear history (squash commits only).
- Restrict force-push to `main`.
- Allow squash-merge only for PRs on the optional PR path.

## Known limitation — review coverage

Local squash-merges skip the Claude PR review entirely; CI and gitleaks run
only when the user pushes `main`. The release-tag audit
(`claude-code-review.yml`) is the authoritative Claude review of what landed.
On the optional PR path:

`synchronize` events (subsequent pushes to a PR) do not emit a
`security-summary` block, so the PR-comment / `REQUEST_CHANGES` flow
only fires on full events (opened, reopened, ready\_for\_review,
force-push). The release-tag audit is the authoritative safety net for
anything that slips through. See `.github/README.md` for details.

## Cross-references

- [Rule 30](30-phase-discipline.md) — phase discipline; `feature/phase-<n>-<slug>` naming wins for phase work.
- [Rule 50](50-security-and-secrets.md) — Rule 50.5: never `--no-verify`.
- [`.github/README.md`](../../.github/README.md) — detailed walkthrough of the review workflows.
