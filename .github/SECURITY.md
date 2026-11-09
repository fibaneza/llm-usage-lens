# Security Policy

This project tracks AWS Bedrock cost and usage data. It handles AWS
credentials (via the default credential chain) and an Auth.js session
secret, so security reports are taken seriously.

## Reporting a vulnerability

**Do not report security vulnerabilities through public GitHub issues,
discussions, or pull requests.**

Use [GitHub's private vulnerability reporting][gh-pvr] to disclose privately:

1. Go to the repository's [Security tab][sec-tab].
2. Click **Report a vulnerability**.
3. Fill in the form with the details below.

A maintainer is automatically notified and only repository administrators
can read the report.

[gh-pvr]: https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability
[sec-tab]: https://github.com/fibaneza/llm-usage-lens/security

## What to include

A useful report includes as many of the following as possible:

- **Vulnerability type** — auth bypass, injection, SSRF, secrets exposure, etc.
- **Affected files / paths** in this repository (commit SHA or tag where reproducible).
- **Reproduction steps** — minimal, deterministic.
- **Impact** — what an attacker can do, under what conditions.
- **Proof-of-concept** — code, request, or screenshot if available.
- **Suggested mitigation** — optional, but appreciated.

## Response timeline

| Stage | Target |
| --- | --- |
| Acknowledgment of report | Within 3 business days |
| Initial assessment | Within 7 business days |
| Fix or mitigation plan | Communicated with the reporter |
| Public disclosure | After a fix ships, coordinated with the reporter |

The project is maintained by a single developer; timelines are best-effort.

## Supported versions

This project is **pre-release**. No tagged version exists yet — the first
release tag will be `v0.1.0` per [Rule 31 — GitHub Flow][rule-31]. Until
then, only `main` is supported, and fixes land directly on `main`.

Once releases exist, this table will list the supported lines:

| Version | Status |
| --- | --- |
| `main` (pre-release) | Supported |

[rule-31]: ../.claude/rules/31-github-flow.md

## Scope

**In scope** (this repository):

- The Next.js dashboard (`apps/dashboard/`) — Route Handlers, Auth.js, the server-only data boundary.
- The AWS Lambda collector (`apps/collector/`) — IAM scope, cross-account access, data handling.
- Shared packages (`packages/shared/`) — schemas, model normalization, env validation.
- Infrastructure-as-code (`infrastructure/`) — SAM templates, IAM policies.
- CI workflows (`.github/workflows/`) and review scripts (`.github/scripts/`).

**Out of scope:**

- The AWS Bedrock service itself (report to AWS via [aws.amazon.com/security][aws-sec]).
- Upstream dependencies — report directly to their maintainers. We track
  advisories via Dependabot and pick them up in normal PRs.
- Findings that require physical access, prior local administrator access,
  or social engineering against maintainers.

[aws-sec]: https://aws.amazon.com/security/vulnerability-reporting/

## Coordinated disclosure

Please give the maintainer a reasonable window to ship a fix before
publishing details. We will credit reporters in the resulting GitHub
Security Advisory unless anonymity is requested.

## Related project rules

- [Rule 10 — server-only data boundary](../.claude/rules/10-server-only-boundary.md) — DynamoDB and AWS SDK only in server code.
- [Rule 50 — security & secrets](../.claude/rules/50-security-and-secrets.md) — credential rules, no static AWS keys, gitleaks pre-commit, Auth.js session checks.
- [Rule 31 — GitHub Flow](../.claude/rules/31-github-flow.md) — branching, squash-merge, release tagging.
