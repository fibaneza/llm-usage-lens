'use strict';
const { parseBlock, parseTier } = require('./lib/parse-summary.cjs');

/**
 * Posts a security findings comment on a PR and submits a REQUEST_CHANGES
 * review when HIGH findings are present.
 *
 * Injected by actions/github-script:
 *   { github, context, core, env }
 *   env.REVIEW_OUTPUT  - review job's review_result output (full-PR + security step)
 *   env.PR_NUMBER      - github.event.pull_request.number
 *   env.REPO           - github.repository
 *   env.HEAD_REF       - github.head_ref
 *   env.BASE_REF       - github.base_ref
 *   env.HEAD_SHA       - github.event.pull_request.head.sha
 */
module.exports = async function run({ github, context, core, env }) {
  const output = env.REVIEW_OUTPUT ?? '';
  const block = parseBlock(output, 'security-summary');
  if (!block) {
    console.log('No security-summary block found.');
    return;
  }

  const prNumber = parseInt(env.PR_NUMBER, 10);
  if (!Number.isFinite(prNumber)) {
    throw new Error(`Invalid PR_NUMBER env var: '${env.PR_NUMBER}'`);
  }
  const sha = env.HEAD_SHA ?? '';
  const shortSha = sha.slice(0, 7) || '(unknown)';
  const repo = env.REPO;
  const prUrl = `https://github.com/${repo}/pull/${prNumber}`;

  const tiers = [
    { name: 'HIGH', heading: 'High-Severity' },
    { name: 'MEDIUM', heading: 'Medium-Severity' },
  ];

  let highCount = 0;
  const sections = [];

  for (const tier of tiers) {
    const { count, findings } = parseTier(block, tier.name);
    if (tier.name === 'HIGH') highCount = count;
    if (count === 0) {
      console.log(`No ${tier.name} findings.`);
      continue;
    }

    sections.push(`### ${tier.heading} Findings (${count})`);
    sections.push(...findings.map(f => `- ${f}`));
    sections.push('');
  }

  if (sections.length === 0) {
    console.log('No HIGH/MEDIUM findings — no PR comment or review.');
    return;
  }

  const commentBody = [
    `## Security review`,
    ``,
    `**PR:** [#${prNumber}](${prUrl}) — \`${env.HEAD_REF}\` → \`${env.BASE_REF}\` @ \`${shortSha}\``,
    ``,
    ...sections,
    `See inline review comments for file/line context and suggested fixes.`,
  ].join('\n');

  const { data: comment } = await github.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: prNumber,
    body: commentBody,
  });

  if (highCount > 0) {
    try {
      await github.rest.pulls.createReview({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: prNumber,
        event: 'REQUEST_CHANGES',
        body: `${highCount} HIGH severity security finding(s) detected. See ${comment.html_url} for details.`,
      });
    } catch (err) {
      // A failed createReview must not prevent setFailed below — the
      // workflow gate is the authoritative reject signal. Log and continue.
      console.log(`REQUEST_CHANGES review failed (${err.status}): ${err.message}`);
    }
    core.setFailed(`${highCount} HIGH severity security finding(s) — rejecting PR`);
  }

  await core.summary
    .addHeading('Security Review')
    .addLink('PR comment with findings', comment.html_url)
    .write();
};
