'use strict';

/**
 * Extracts and parses a fenced summary block from Claude's review output.
 *
 * @param {string} output - Full review output string.
 * @param {string} fence  - Fence name, e.g. 'security-summary'.
 * @returns {string|null} Block body text, or null when the block is absent.
 */
function parseBlock(output, fence) {
  const re = new RegExp('```' + fence + '\\n([\\s\\S]*?)```');
  const m = output.match(re);
  return m ? m[1] : null;
}

/**
 * Extracts count + findings list for one severity tier from a block body.
 *
 * @param {string} text     - Block body returned by parseBlock().
 * @param {string} tierName - Tier name in the block, e.g. 'HIGH'.
 * @returns {{ count: number, findings: string[] }}
 */
function parseTier(text, tierName) {
  const countMatch = text.match(new RegExp(`^${tierName}:\\s*(\\d+)`, 'm'));
  const count = countMatch ? parseInt(countMatch[1], 10) : 0;

  // Terminate the list at the next known tier header or end-of-block — not at
  // any `WORD:` line, so a finding such as "- TODO: ..." doesn't truncate it.
  const findingsRe = new RegExp(
    `${tierName}_FINDINGS:\\n([\\s\\S]*?)(?=\\n(?:HIGH|MEDIUM|LOW)(?:_FINDINGS)?:|$)`
  );
  const findingsMatch = text.match(findingsRe);
  const findings = findingsMatch
    ? findingsMatch[1]
        .trim()
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && l !== '- none' && l !== 'none')
    : [];

  return { count, findings };
}

module.exports = { parseBlock, parseTier };
