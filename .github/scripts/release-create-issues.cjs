'use strict';
const { parseBlock, parseTier } = require('./lib/parse-summary.cjs');

/**
 * Creates GitHub issues for HIGH/MEDIUM security findings and HIGH
 * code-review findings found in a release audit.
 *
 * Injected by actions/github-script:
 *   { github, context, core, env }
 *   env.AUDIT_OUTPUT  - steps.audit.outputs.result
 *   env.COMMIT_SHA    - github.sha
 *   env.RELEASE_TAG   - github.ref_name
 *   env.REPO          - github.repository
 */
module.exports = async function run({ github, context, core, env }) {
  const output = env.AUDIT_OUTPUT ?? '';
  const sha = env.COMMIT_SHA;
  const shortSha = sha.slice(0, 7);
  const tag = env.RELEASE_TAG;
  const repo = env.REPO;
  const commitUrl = `https://github.com/${repo}/commit/${sha}`;
  const created = [];

  // Ensure labels exist (idempotent).
  for (const [name, color, description] of [
    ['security', 'E4E669', 'Security-related issue'],
    ['high-severity', 'D93F0B', 'High severity finding'],
    ['medium-severity', 'FBCA04', 'Medium severity finding'],
    ['code-review', 'D4C5F9', 'Code review finding from automated audit'],
  ]) {
    try {
      await github.rest.issues.createLabel({
        owner: context.repo.owner,
        repo: context.repo.repo,
        name,
        color,
        description,
      });
    } catch (_) { /* label exists */ }
  }

  const commitLine = `**Commit:** [\`${shortSha}\`](${commitUrl}) — release \`${tag}\``;
  const closingLine = `Investigate and fix on a follow-up branch; the audit re-runs on the next release tag.`;

  // --- Security findings ---
  const secBlock = parseBlock(output, 'security-summary');
  if (!secBlock) {
    console.log('No security-summary block found.');
  } else {
    for (const tier of [
      { name: 'HIGH', label: 'high-severity', heading: 'High-Severity' },
      { name: 'MEDIUM', label: 'medium-severity', heading: 'Medium-Severity' },
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

      const { data: issue } = await github.rest.issues.create({
        owner: context.repo.owner,
        repo: context.repo.repo,
        title: `[Security] ${tier.name} findings in release \`${tag}\` @ ${shortSha}`,
        body,
        labels: ['security', tier.label],
        assignees: ['fibaneza'],
      });
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

      const { data: issue } = await github.rest.issues.create({
        owner: context.repo.owner,
        repo: context.repo.repo,
        title: `[Code Review] HIGH findings in release \`${tag}\` @ ${shortSha}`,
        body,
        labels: ['code-review', 'high-severity'],
        assignees: ['fibaneza'],
      });
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
};
