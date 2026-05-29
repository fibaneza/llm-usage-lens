'use strict';
const { parseBlock, parseTier } = require('./lib/parse-summary.cjs');

/**
 * Creates GitHub issues for HIGH/MEDIUM security findings and HIGH
 * code-review findings found in a release audit.
 *
 * Injected by actions/github-script:
 *   { github, context, core, env }
 *   env.AUDIT_OUTPUT       - steps.audit.outputs.result
 *   env.COMMIT_SHA         - github.sha
 *   env.RELEASE_TAG        - github.ref_name
 *   env.REPO               - github.repository
 *   env.ASSIGNEE           - comma-separated usernames (optional; omit to skip assignment)
 *   env.LABELS_SECURITY    - label name for security issues    (default: 'security')
 *   env.LABELS_HIGH        - label name for high severity      (default: 'high-severity')
 *   env.LABELS_MEDIUM      - label name for medium severity    (default: 'medium-severity')
 *   env.LABELS_CODE_REVIEW - label name for code-review issues (default: 'code-review')
 *
 * Returns { createdCount, issueUrls } for the action's output step.
 */
module.exports = async function run({ github, context, core, env }) {
  const output = env.AUDIT_OUTPUT ?? '';
  const sha = env.COMMIT_SHA ?? '';
  const shortSha = sha.slice(0, 7) || '(unknown)';
  const tag = env.RELEASE_TAG;
  const repo = env.REPO;
  const commitUrl = `https://github.com/${repo}/commit/${sha}`;
  const created = [];

  // Env-driven project configuration (safe defaults keep existing behaviour).
  const assignees = env.ASSIGNEE
    ? env.ASSIGNEE.split(',').map(s => s.trim()).filter(Boolean)
    : [];
  const labelSecurity = env.LABELS_SECURITY || 'security';
  const labelHigh = env.LABELS_HIGH || 'high-severity';
  const labelMedium = env.LABELS_MEDIUM || 'medium-severity';
  const labelCodeReview = env.LABELS_CODE_REVIEW || 'code-review';

  // Ensure labels exist (idempotent). GitHub returns 422 when a label of
  // the same name already exists — that's the expected case after the first
  // run, so swallow only that status. Any other error (401/403/5xx) bubbles
  // up so a misconfigured token doesn't silently produce unlabelled issues.
  for (const [name, color, description] of [
    [labelSecurity, 'E4E669', 'Security-related issue'],
    [labelHigh, 'D93F0B', 'High severity finding'],
    [labelMedium, 'FBCA04', 'Medium severity finding'],
    [labelCodeReview, 'D4C5F9', 'Code review finding from automated audit'],
  ]) {
    try {
      await github.rest.issues.createLabel({
        owner: context.repo.owner,
        repo: context.repo.repo,
        name,
        color,
        description,
      });
    } catch (err) {
      if (err.status !== 422) throw err;
    }
  }

  const commitLine = `**Commit:** [\`${shortSha}\`](${commitUrl}) — release \`${tag}\``;
  const closingLine = `Investigate and fix on a follow-up branch; the audit re-runs on the next release tag.`;

  // --- Security findings ---
  const secBlock = parseBlock(output, 'security-summary');
  if (!secBlock) {
    console.log('No security-summary block found.');
  } else {
    for (const tier of [
      { name: 'HIGH', label: labelHigh, heading: 'High-Severity' },
      { name: 'MEDIUM', label: labelMedium, heading: 'Medium-Severity' },
    ]) {
      const { count, findings } = parseTier(secBlock, tier.name);
      if (count === 0) {
        console.log(`No ${tier.name} security findings.`);
        continue;
      }

      const body = [
        `## ${tier.heading} Security Findings`,
        ``,
        commitLine,
        ``,
        `### Findings (${count} ${tier.name})`,
        ...findings.map(f => `- ${f}`),
        ``,
        closingLine,
      ].join('\n');

      const issuePayload = {
        owner: context.repo.owner,
        repo: context.repo.repo,
        title: `[Security] ${tier.name} findings in release \`${tag}\` @ ${shortSha}`,
        body,
        labels: [labelSecurity, tier.label],
      };
      if (assignees.length > 0) issuePayload.assignees = assignees;

      const { data: issue } = await github.rest.issues.create(issuePayload);
      core.warning(`${tier.name} security issue created: ${issue.html_url}`);
      created.push({ label: `Security ${tier.name}`, url: issue.html_url });
    }
  }

  // --- Code-review findings (HIGH only) ---
  const crBlock = parseBlock(output, 'code-review-summary');
  if (!crBlock) {
    console.log('No code-review-summary block found.');
  } else {
    const { count, findings } = parseTier(crBlock, 'HIGH');
    if (count === 0) {
      console.log('No HIGH code-review findings.');
    } else {
      const body = [
        `## High-Severity Code Review Findings`,
        ``,
        commitLine,
        ``,
        `### Findings (${count} HIGH)`,
        ...findings.map(f => `- ${f}`),
        ``,
        closingLine,
      ].join('\n');

      const issuePayload = {
        owner: context.repo.owner,
        repo: context.repo.repo,
        title: `[Code Review] HIGH findings in release \`${tag}\` @ ${shortSha}`,
        body,
        labels: [labelCodeReview, labelHigh],
      };
      if (assignees.length > 0) issuePayload.assignees = assignees;

      const { data: issue } = await github.rest.issues.create(issuePayload);
      core.warning(`HIGH code-review issue created: ${issue.html_url}`);
      created.push({ label: 'Code Review HIGH', url: issue.html_url });
    }
  }

  if (created.length > 0) {
    const summary = core.summary.addHeading('Issues Created');
    for (const { label, url } of created) {
      summary.addLink(label, url);
    }
    await summary.write();
  }

  return { createdCount: created.length, issueUrls: created.map(c => c.url) };
};
