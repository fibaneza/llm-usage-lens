'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseBlock, parseTier } = require('./parse-summary.cjs');

// --- parseBlock ---

test('parseBlock: returns block body for a valid fence', () => {
  const output = 'some prose\n```security-summary\nHIGH: 1\n```\ntrailing';
  const result = parseBlock(output, 'security-summary');
  assert.equal(result, 'HIGH: 1\n');
});

test('parseBlock: returns null when fence is absent', () => {
  const output = 'no fenced blocks here';
  assert.equal(parseBlock(output, 'security-summary'), null);
});

test('parseBlock: handles code-review-summary fence', () => {
  const output = '```code-review-summary\nHIGH: 0\nHIGH_FINDINGS:\n- none\n```';
  const result = parseBlock(output, 'code-review-summary');
  assert.ok(result.includes('HIGH: 0'));
});

// --- parseTier ---

test('parseTier: parses count and findings for HIGH tier', () => {
  const text = [
    'HIGH: 2',
    'MEDIUM: 0',
    'LOW: 1',
    'HIGH_FINDINGS:',
    '- Missing session check in /api/users',
    '- Static AWS key found in config.ts',
    'MEDIUM_FINDINGS:',
    '- none',
  ].join('\n');

  const { count, findings } = parseTier(text, 'HIGH');
  assert.equal(count, 2);
  assert.deepEqual(findings, [
    '- Missing session check in /api/users',
    '- Static AWS key found in config.ts',
  ]);
});

test('parseTier: returns count=0 and empty findings when tier is zero', () => {
  const text = 'HIGH: 0\nHIGH_FINDINGS:\n- none\n';
  const { count, findings } = parseTier(text, 'HIGH');
  assert.equal(count, 0);
  assert.deepEqual(findings, []);
});

test('parseTier: returns count=0 when tier line is absent', () => {
  const text = 'MEDIUM: 1\nMEDIUM_FINDINGS:\n- Some finding\n';
  const { count } = parseTier(text, 'HIGH');
  assert.equal(count, 0);
});

test('parseTier: handles malformed count gracefully (non-numeric defaults to 0)', () => {
  // The regex requires \d+ so non-numeric values produce no match → count = 0.
  const text = 'HIGH: abc\nHIGH_FINDINGS:\n- none\n';
  const { count } = parseTier(text, 'HIGH');
  assert.equal(count, 0);
});

test('parseTier: prose after the block does not bleed into findings', () => {
  const text = [
    'HIGH: 1',
    'HIGH_FINDINGS:',
    '- Real finding here',
    'MEDIUM: 0',
    'MEDIUM_FINDINGS:',
    '- none',
    'LOW: 0',
  ].join('\n');

  const { findings } = parseTier(text, 'HIGH');
  assert.deepEqual(findings, ['- Real finding here']);
});

// --- release-create-issues: env-driven assignee + labels ---

test('release-create-issues: respects ASSIGNEE and LABELS_SECURITY env overrides', async () => {
  const run = require('../release-create-issues.cjs');

  const createdIssues = [];
  const mockSummary = { write: async () => {} };
  mockSummary.addHeading = () => mockSummary;
  mockSummary.addLink = () => mockSummary;

  const mockGitHub = {
    rest: {
      issues: {
        createLabel: async () => {},
        create: async (params) => {
          createdIssues.push(params);
          return { data: { html_url: 'https://github.com/test/test/issues/1' } };
        },
      },
    },
  };

  await run({
    github: mockGitHub,
    context: { repo: { owner: 'test', repo: 'test' } },
    core: { warning: () => {}, summary: mockSummary },
    env: {
      AUDIT_OUTPUT: '```security-summary\nHIGH: 1\nMEDIUM: 0\nLOW: 0\nHIGH_FINDINGS:\n- Test vuln\nMEDIUM_FINDINGS:\n- none\n```',
      COMMIT_SHA: 'abc1234567890',
      RELEASE_TAG: 'v1.0.0',
      REPO: 'test/test',
      ASSIGNEE: 'alice,bob',
      LABELS_SECURITY: 'sec',
      LABELS_HIGH: 'high-severity',
      LABELS_MEDIUM: 'medium-severity',
      LABELS_CODE_REVIEW: 'code-review',
    },
  });

  assert.ok(createdIssues.length >= 1, 'Should have created at least one issue');
  const secIssue = createdIssues.find(i => i.labels.includes('sec'));
  assert.ok(secIssue, 'Should create issue with LABELS_SECURITY override');
  assert.deepEqual(secIssue.assignees, ['alice', 'bob'], 'Should assign to alice and bob');
});

// --- pr-comment-and-reject: REQUEST_CHANGES on HIGH > 0 ---

test('pr-comment-and-reject: submits REQUEST_CHANGES when HIGH > 0 and skips when HIGH = 0', async () => {
  const run = require('../pr-comment-and-reject.cjs');

  const makeMocks = () => {
    const calls = { createComment: [], createReview: [], setFailed: [] };
    const mockSummary = { write: async () => {} };
    mockSummary.addHeading = () => mockSummary;
    mockSummary.addLink = () => mockSummary;
    const github = {
      rest: {
        issues: {
          createComment: async (p) => {
            calls.createComment.push(p);
            return { data: { html_url: 'https://github.com/test/test/issues/1#comment-1' } };
          },
        },
        pulls: { createReview: async (p) => { calls.createReview.push(p); } },
      },
    };
    const core = {
      setFailed: (msg) => calls.setFailed.push(msg),
      summary: mockSummary,
    };
    return { github, core, calls };
  };

  const baseEnv = {
    PR_NUMBER: '42',
    REPO: 'test/test',
    HEAD_REF: 'feature/foo',
    BASE_REF: 'main',
    HEAD_SHA: 'deadbeef1234',
  };

  // Case 1: HIGH: 2 → should REQUEST_CHANGES and setFailed
  const { github: gh1, core: c1, calls: calls1 } = makeMocks();
  await run({
    github: gh1, context: { repo: { owner: 'test', repo: 'test' } }, core: c1,
    env: { ...baseEnv, REVIEW_OUTPUT: '```security-summary\nHIGH: 2\nMEDIUM: 0\nLOW: 0\nHIGH_FINDINGS:\n- Issue A\n- Issue B\nMEDIUM_FINDINGS:\n- none\n```' },
  });
  assert.equal(calls1.createReview.length, 1, 'Should submit one REQUEST_CHANGES review');
  assert.equal(calls1.createReview[0].event, 'REQUEST_CHANGES');
  assert.ok(calls1.setFailed.length > 0, 'Should call setFailed');

  // Case 2: HIGH: 0 → should not REQUEST_CHANGES or setFailed
  const { github: gh2, core: c2, calls: calls2 } = makeMocks();
  await run({
    github: gh2, context: { repo: { owner: 'test', repo: 'test' } }, core: c2,
    env: { ...baseEnv, REVIEW_OUTPUT: '```security-summary\nHIGH: 0\nMEDIUM: 1\nLOW: 0\nHIGH_FINDINGS:\n- none\nMEDIUM_FINDINGS:\n- Minor issue\n```' },
  });
  assert.equal(calls2.createReview.length, 0, 'Should not submit REQUEST_CHANGES when HIGH = 0');
  assert.equal(calls2.setFailed.length, 0, 'Should not call setFailed when HIGH = 0');
});
