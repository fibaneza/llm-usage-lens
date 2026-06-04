# Rule 31 — GitHub Flow

Source of truth for branching strategy, PR lifecycle, and release process.
Phase-specific branching is governed by [Rule 30](30-phase-discipline.md) —
Rule 30 wins for `feature/phase-<n>-<slug>` branches.

## Long-lived branches

`main` is the **only** long-lived branch. `master` and `develop` are
forbidden. All work branches off `main` and merges back to `main` via
pull request.

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

## PR lifecycle

1. Branch from `main`.
2. Commit with Conventional Commits.
3. **Open as a draft by default** (`gh pr create --draft`). New PRs start as
   drafts so work-in-progress doesn't trigger the Claude PR review or signal
   readiness prematurely.
4. Mark ready-for-review (`gh pr ready`) when the branch is complete and its
   checklist passes.
5. Claude PR review runs automatically once the PR is marked ready
   (`claude-pr-review.yml` skips drafts).
6. Human review (required — see branch protection below).
7. **Squash-merge** into `main`. The PR title becomes the sole commit
   message on `main`, so **PR titles MUST follow Conventional Commits**.
8. Delete the branch.

## PR description requirements

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

## Branch protection (required on `main`)

Configure under Settings → Branches → Branch protection rules:

- Require pull request before merging (1 approval minimum).
- Require status checks to pass: `ci: claude pr review`, `ci: pr title lint`.
- Require linear history.
- Allow squash-merge only — disable merge commits and rebase-merge in
  Settings → General → Pull Requests.
- Restrict force-push and direct push to `main`.
- Recommended once the team is larger than one: enable "Require review
  from Code Owners".

## Known limitation — incremental pushes and security findings

`synchronize` events (subsequent pushes to a PR) do not emit a
`security-summary` block, so the PR-comment / `REQUEST_CHANGES` flow
only fires on full events (opened, reopened, ready\_for\_review,
force-push). The release-tag audit is the authoritative safety net for
anything that slips through. See `.github/README.md` for details.

## Cross-references

- [Rule 30](30-phase-discipline.md) — phase discipline; `feature/phase-<n>-<slug>` naming wins for phase work.
- [Rule 50](50-security-and-secrets.md) — Rule 50.5: never `--no-verify`.
- [`.github/README.md`](../../.github/README.md) — detailed walkthrough of the review workflows.
